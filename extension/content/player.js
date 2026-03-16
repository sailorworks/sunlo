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
 * Fetches TTS audio via SSE from the backend and plays it in real-time.
 * @param {string} text - Full article text
 * @param {string} voiceId - Smallest AI voice ID
 * @param {AudioStreamPlayer} player - Audio player instance
 * @param {AbortSignal} signal - For cancellation
 * @param {function} onProgress - Called with { phase, elapsed, total }
 * @returns {Promise<void>} Resolves when all audio finishes playing
 */
async function streamTTSAndPlay(text, voiceId, player, signal, onProgress) {
  const res = await fetch(`${TTS_SERVER}/api/tts-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice_id: voiceId }),
    signal,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`TTS failed (${res.status}): ${err}`);
  }

  player.reset();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  if (onProgress) onProgress({ phase: "streaming" });

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const payload = JSON.parse(line.slice(6));
        if (payload.error) throw new Error(`TTS error: ${payload.error}`);
        if (payload.done) break;
        if (payload.audio) {
          player.appendChunk(payload.audio);
        }
      } catch (e) {
        if (e.message.startsWith("TTS error")) throw e;
      }
    }
  }

  if (onProgress) onProgress({ phase: "playing" });
  await player.waitUntilDone();
  if (onProgress) onProgress({ phase: "done" });
}
