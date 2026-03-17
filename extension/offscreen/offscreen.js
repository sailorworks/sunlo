/**
 * offscreen.js — Handles TTS streaming directly with Smallest AI SSE endpoint.
 *
 * This offscreen document calls the Smallest AI SSE endpoint directly,
 * avoiding localhost streaming issues caused by Chrome killing connections.
 *
 * Pattern adapted from: cookbook/text-to-speech/streaming/javascript/stream_sse.js
 */

const SSE_URL = "https://api.smallest.ai/waves/v1/lightning-v3.1/stream";
const KEY_URL = "http://localhost:3456/api/key";

let currentAbortController = null;
let cachedApiKey = null;

console.log("[TTP-OFF] ✅ Offscreen document loaded.");

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

async function handleTTSStream(text, voiceId, tabId) {
  console.log(`[TTP-OFF] ▶ Starting TTS stream. Text length: ${text.length}, Voice: ${voiceId}`);

  currentAbortController = new AbortController();
  const { signal } = currentAbortController;

  try {
    const apiKey = await getApiKey();

    console.log("[TTP-OFF] 📡 Calling Smallest AI SSE endpoint directly...");
    const response = await fetch(SSE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: text,
        voice_id: voiceId,
        sample_rate: 24000,
        speed: 1.0,
      }),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Smallest AI API error (${response.status}): ${errorText}`);
    }

    console.log("[TTP-OFF] ✅ SSE connection established to Smallest AI.");

    // Send "connected" status back
    chrome.runtime.sendMessage({
      type: "OFFSCREEN_TTS_CHUNK",
      tabId,
      payload: { status: "connected" },
    });

    // Read the SSE stream (same pattern as stream_sse.js cookbook)
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let chunkCount = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;

        try {
          const payload = JSON.parse(line.slice(5).trim());

          if (payload.done) {
            console.log(`[TTP-OFF] 🛑 Stream complete. Sent ${chunkCount} audio chunks.`);
            chrome.runtime.sendMessage({
              type: "OFFSCREEN_TTS_CHUNK",
              tabId,
              payload: { done: true },
            });
            return;
          }

          if (payload.audio) {
            chunkCount++;
            if (chunkCount === 1) {
              console.log(`[TTP-OFF] 🎵 First audio chunk received! Base64 length: ${payload.audio.length}`);
            }
            if (chunkCount % 10 === 0) {
              console.log(`[TTP-OFF] 🎵 Sent ${chunkCount} audio chunks so far...`);
            }

            chrome.runtime.sendMessage({
              type: "OFFSCREEN_TTS_CHUNK",
              tabId,
              payload: { audio: payload.audio },
            });
          }
        } catch (parseErr) {
          // Skip malformed lines
        }
      }
    }

    // If we get here without a done event, still signal completion
    if (chunkCount > 0) {
      console.log(`[TTP-OFF] 🛑 Stream ended (no done event). Sent ${chunkCount} audio chunks.`);
      chrome.runtime.sendMessage({
        type: "OFFSCREEN_TTS_CHUNK",
        tabId,
        payload: { done: true },
      });
    }

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

// Listen for messages from the background script
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
