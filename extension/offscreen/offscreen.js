/**
 * offscreen.js — Handles TTS streaming directly with Smallest AI SSE endpoint.
 *
 * - Pre-chunks text to 250 chars max (per Smallest AI docs)
 * - Sends sequential SSE requests for each chunk
 * - Buffers raw PCM bytes before re-encoding to valid base64 and sending to player
 *
 * Pattern adapted from: cookbook/text-to-speech/streaming/javascript/stream_sse.js
 */

const SSE_URL = "https://api.smallest.ai/waves/v1/lightning-v3.1/stream";
const KEY_URL = "http://localhost:3456/api/key";
const MAX_CHUNK_SIZE = 250;
const BYTE_BUFFER_SIZE = 32768; // Buffer ~32KB of raw PCM bytes before sending

let currentAbortController = null;
let cachedApiKey = null;

console.log("[TTP-OFF] ✅ Offscreen document loaded.");

// ── Helper: decode base64 to Uint8Array ─────────────────────────────────────
function base64ToBytes(base64) {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

// ── Helper: encode Uint8Array to base64 ─────────────────────────────────────
function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ── Text chunking (per Smallest AI best practices: max 250 chars) ───────────
function chunkText(text, maxChunkSize = MAX_CHUNK_SIZE) {
  const chunks = [];
  text = text.trim();
  const punctuation = ".,:;।!?";

  while (text) {
    if (text.length <= maxChunkSize) {
      chunks.push(text.trim());
      break;
    }

    let chunkEnd = maxChunkSize;
    let foundPunct = false;

    // Search backward from maxChunkSize for punctuation
    for (let i = chunkEnd; i > Math.max(chunkEnd - 50, 0); i--) {
      if (i < text.length && punctuation.includes(text[i])) {
        chunkEnd = i + 1;
        foundPunct = true;
        break;
      }
    }

    // If no punctuation found, look for space
    if (!foundPunct) {
      for (let i = chunkEnd; i > Math.max(chunkEnd - 50, 0); i--) {
        if (i < text.length && text[i] === " ") {
          chunkEnd = i;
          break;
        }
      }
    }

    chunks.push(text.substring(0, chunkEnd).trim());
    text = text.substring(chunkEnd).trim();
  }

  return chunks;
}

async function getApiKey() {
  if (cachedApiKey) return cachedApiKey;

  console.log("[TTP-OFF] 🔑 Fetching API key from local server...");
  const response = await fetch(KEY_URL);
  if (!response.ok) {
    throw new Error(`Failed to get API key: ${response.status}`);
  }
  const data = await response.json();
  cachedApiKey = data.api_key;
  console.log("[TTP-OFF] 🔑 API key retrieved successfully.");
  return cachedApiKey;
}

// ── Send a buffered audio batch to the player ───────────────────────────────
function flushAudioBuffer(byteChunks, tabId) {
  // Combine all byte chunks into one Uint8Array
  const totalLength = byteChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of byteChunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  // Re-encode to valid base64
  const base64 = bytesToBase64(combined);

  console.log(`[TTP-OFF] 📤 Sending audio batch: ${totalLength} bytes (${base64.length} base64 chars)`);

  chrome.runtime.sendMessage({
    type: "OFFSCREEN_TTS_CHUNK",
    tabId,
    payload: { audio: base64 },
  });
}

// ── Stream a single text chunk via SSE ──────────────────────────────────────
async function streamSingleChunk(text, apiKey, tabId, signal) {
  console.log(`[TTP-OFF] 🌐 Calling Smallest AI SSE for: "${text.substring(0, 50)}..." (${text.length} chars)`);

  const response = await fetch(SSE_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: text,
      voice_id: "magnus",
      sample_rate: 24000,
      speed: 1.0,
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Smallest AI API error (${response.status}): ${errorText}`);
  }

  console.log(`[TTP-OFF] ✅ SSE response received (status ${response.status}). Reading stream...`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let byteChunks = []; // Accumulate raw byte arrays
  let bufferedBytes = 0;
  let audioChunksSent = 0;
  let sseDataLinesProcessed = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop(); // Keep incomplete line

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;

      try {
        const payload = JSON.parse(line.slice(5).trim());

        if (payload.done) {
          console.log(`[TTP-OFF] ✅ Chunk stream done. Processed ${sseDataLinesProcessed} SSE data lines.`);
          // Flush any remaining buffered audio
          if (byteChunks.length > 0) {
            flushAudioBuffer(byteChunks, tabId);
            audioChunksSent++;
            byteChunks = [];
            bufferedBytes = 0;
          }
          return audioChunksSent;
        }

        if (payload.audio) {
          sseDataLinesProcessed++;
          // Decode this base64 chunk to raw bytes
          const rawBytes = base64ToBytes(payload.audio);
          byteChunks.push(rawBytes);
          bufferedBytes += rawBytes.length;

          // Send when buffer is large enough
          if (bufferedBytes >= BYTE_BUFFER_SIZE) {
            flushAudioBuffer(byteChunks, tabId);
            audioChunksSent++;
            byteChunks = [];
            bufferedBytes = 0;
          }
        }
      } catch (parseErr) {
        // Skip malformed lines silently
      }
    }
  }

  // Flush any remaining audio after stream ends without "done" event
  if (byteChunks.length > 0) {
    console.log(`[TTP-OFF] 📤 Flushing final ${bufferedBytes} bytes for this chunk.`);
    flushAudioBuffer(byteChunks, tabId);
    audioChunksSent++;
  }

  console.log(`[TTP-OFF] 📊 Chunk result: ${sseDataLinesProcessed} SSE lines → ${audioChunksSent} audio batches sent.`);
  return audioChunksSent;
}

async function handleTTSStream(text, voiceId, tabId) {
  console.log(`[TTP-OFF] ▶ Starting TTS stream. Text length: ${text.length}, Voice: ${voiceId}`);

  currentAbortController = new AbortController();
  const { signal } = currentAbortController;

  try {
    const apiKey = await getApiKey();

    // Pre-chunk text per Smallest AI best practices (max 250 chars)
    const textChunks = chunkText(text, MAX_CHUNK_SIZE);
    console.log(`[TTP-OFF] 📝 Split text into ${textChunks.length} chunks (max ${MAX_CHUNK_SIZE} chars each).`);

    // Send "connected" status
    chrome.runtime.sendMessage({
      type: "OFFSCREEN_TTS_CHUNK",
      tabId,
      payload: { status: "connected" },
    });

    let totalAudioBatchesSent = 0;

    // Process each text chunk sequentially
    for (let i = 0; i < textChunks.length; i++) {
      if (signal.aborted) break;

      const chunk = textChunks[i];
      console.log(`[TTP-OFF] ⚙️ Processing text chunk ${i + 1}/${textChunks.length} (${chunk.length} chars)`);

      // Send progress update to the player
      chrome.runtime.sendMessage({
        type: "OFFSCREEN_TTS_CHUNK",
        tabId,
        payload: {
          progress: {
            currentChunk: i + 1,
            totalChunks: textChunks.length,
          },
        },
      });

      const sent = await streamSingleChunk(chunk, apiKey, tabId, signal);
      totalAudioBatchesSent += sent;

      console.log(`[TTP-OFF] 📊 Overall progress: ${i + 1}/${textChunks.length} text chunks done, ${totalAudioBatchesSent} audio batches sent total.`);
    }

    console.log(`[TTP-OFF] 🛑 All ${textChunks.length} text chunks processed. Sent ${totalAudioBatchesSent} audio batches total.`);

    chrome.runtime.sendMessage({
      type: "OFFSCREEN_TTS_CHUNK",
      tabId,
      payload: { done: true },
    });

  } catch (err) {
    if (err.name === "AbortError") {
      console.log("[TTP-OFF] ⏹ Stream aborted by user.");
      return;
    }
    console.error("[TTP-OFF] ❌ Error:", err.message);
    chrome.runtime.sendMessage({
      type: "OFFSCREEN_TTS_CHUNK",
      tabId,
      payload: { error: err.message },
    });
  } finally {
    currentAbortController = null;
  }
}

// ── Listen for messages from the background script ──────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "OFFSCREEN_START_TTS") {
    console.log("[TTP-OFF] 📩 Received OFFSCREEN_START_TTS");
    handleTTSStream(message.text, message.voice_id, message.tabId);
    sendResponse({ ok: true });
  } else if (message.type === "OFFSCREEN_STOP_TTS") {
    console.log("[TTP-OFF] ⏹ Received OFFSCREEN_STOP_TTS");
    if (currentAbortController) {
      currentAbortController.abort();
    }
    sendResponse({ ok: true });
  }
  return false;
});
