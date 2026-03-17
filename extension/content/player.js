/**
 * player.js — Streaming audio player for the Chrome extension.
 * Adapted from the debate-arena's AudioStreamPlayer.
 *
 * Plays PCM16 base64 audio chunks via Web Audio API for gapless playback.
 * Also handles SSE fetch from the backend and exposes play/pause/stop controls.
 */

const TTS_SERVER = "http://localhost:3456";
const SAMPLE_RATE = 44100;

class AudioStreamPlayer {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.gainNode = null;
    this.scheduledTime = 0;
    this.isPlaying = false;
    this._paused = false;
    this._lastSource = null;
    this._endResolve = null;
    this._totalDuration = 0;
  }

  _ensureContext() {
    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.smoothingTimeConstant = 0.8;
      this.gainNode = this.ctx.createGain();
      this.gainNode.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  appendChunk(base64Audio) {
    this._ensureContext();
    this.isPlaying = true;

    const binaryStr = atob(base64Audio);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++)
      bytes[i] = binaryStr.charCodeAt(i);

    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

    const buffer = this.ctx.createBuffer(1, float32.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode);

    const startTime = Math.max(this.scheduledTime, this.ctx.currentTime);
    source.start(startTime);
    this.scheduledTime = startTime + buffer.duration;
    this._totalDuration += buffer.duration;
    this._lastSource = source;

    source.onended = () => {
      if (this._lastSource === source && this._endResolve) {
        this.isPlaying = false;
        this._endResolve();
        this._endResolve = null;
      }
    };
  }

  waitUntilDone() {
    if (!this.isPlaying || !this.ctx) return Promise.resolve();
    if (this.ctx.currentTime >= this.scheduledTime) {
      this.isPlaying = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this._endResolve = resolve;
    });
  }

  getCurrentTime() {
    if (!this.ctx) return 0;
    return this.ctx.currentTime;
  }

  getTotalDuration() {
    return this._totalDuration;
  }

  pause() {
    if (this.ctx && this.ctx.state === "running") {
      this.ctx.suspend();
      this._paused = true;
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
      this._paused = false;
    }
  }

  isPaused() {
    return this._paused;
  }

  reset() {
    this.scheduledTime = 0;
    this.isPlaying = false;
    this._paused = false;
    this._lastSource = null;
    this._endResolve = null;
    this._totalDuration = 0;
  }

  stop() {
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
      this.analyser = null;
      this.gainNode = null;
    }
    this._lastSource = null;
    this.scheduledTime = 0;
    this.isPlaying = false;
    this._paused = false;
    this._totalDuration = 0;
    if (this._endResolve) {
      this._endResolve();
      this._endResolve = null;
    }
  }
}

/**
 * Streams TTS from our backend by delegating to the background script
 * which uses an offscreen document for the actual fetch.
 * Audio chunks arrive via chrome.runtime.onMessage (broadcast from background).
 * Commands (START/STOP) are sent via a Port to the background.
 */
async function streamTTSAndPlay(text, voice_id, player, signal, onStatusChange) {
  console.log(`[TTP] 📡 Opening port to background script for voice: ${voice_id}, text length: ${text.length}`);

  return new Promise((resolve, reject) => {
    if (onStatusChange) onStatusChange({ phase: "streaming" });

    player.reset();
    let chunksReceived = 0;
    let streamDone = false;
    let settled = false;

    // Open a port to the background script for sending commands
    const port = chrome.runtime.connect({ name: "tts-stream" });

    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      try { port.disconnect(); } catch (e) { /* already disconnected */ }
    };

    const settle = (fn) => {
      if (settled) return;
      settled = true;
      fn();
    };

    // Listen for audio chunks relayed from the offscreen document via background
    const messageListener = (message) => {
      if (message.type !== "TTS_CHUNK") return;
      const payload = message.payload;

      if (payload.status === "connected") {
        console.log("[TTP] 📡 Background connected to server.");
        return;
      }

      if (payload.error) {
        console.error("[TTP] ❌ SSE Error:", payload.error);
        cleanup();
        settle(() => reject(new Error(`TTS error: ${payload.error}`)));
        return;
      }

      if (payload.done) {
        console.log(`[TTP] 🛑 Stream complete. Received ${chunksReceived} audio chunks.`);
        streamDone = true;
        // Wait for audio playback to finish before resolving
        player.waitUntilDone().then(() => {
          console.log("[TTP] ✅ Audio playback finished.");
          cleanup();
          if (onStatusChange) onStatusChange({ phase: "done" });
          settle(() => resolve());
        });
        return;
      }

      if (payload.audio) {
        chunksReceived++;
        if (chunksReceived === 1) {
          console.log(`[TTP] 🎵 First audio chunk received! Length: ${payload.audio.length}`);
          if (onStatusChange) onStatusChange({ phase: "playing" });
        }
        if (chunksReceived % 10 === 0) {
          console.log(`[TTP] 🎵 Received ${chunksReceived} audio chunks so far...`);
        }
        player.appendChunk(payload.audio);
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    port.onDisconnect.addListener(() => {
      // Give a small delay — chunks may still arrive via onMessage even after port disconnects
      setTimeout(() => {
        if (!streamDone && chunksReceived === 0) {
          console.error("[TTP] ❌ Port disconnected before any audio received.");
          cleanup();
          settle(() => reject(new Error("Background port disconnected unexpectedly.")));
        }
      }, 2000);
    });

    // Handle user abort
    signal.addEventListener("abort", () => {
      console.log("[TTP] 🛑 Audio stream aborted by user.");
      try { port.postMessage({ type: "STOP_TTS" }); } catch(e) {}
      cleanup();
      settle(() => reject(new DOMException("Aborted", "AbortError")));
    });

    // Send the start command through the port
    console.log("[TTP] 📡 Sending START_TTS via port...");
    port.postMessage({ type: "START_TTS", text, voice_id });
  });
}
