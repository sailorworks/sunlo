/**
 * background.js — Service worker relay for the extension.
 *
 * Creates an offscreen document to handle the long-running streaming fetch
 * (since MV3 service workers get aggressively killed by Chrome).
 * This script just relays messages between the content script and the offscreen doc.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log("[TTP-BG] Extension installed.");
});

let creatingOffscreen = null;

async function ensureOffscreenDocument() {
  const offscreenUrl = "offscreen/offscreen.html";

  // Check if we already have an offscreen document
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(offscreenUrl)]
  });

  if (existingContexts.length > 0) {
    return; // Already exists
  }

  // Avoid race conditions with multiple creation attempts
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: offscreenUrl,
    reasons: ["WORKERS"],
    justification: "Streaming TTS audio directly from Smallest AI SSE endpoint"
  });

  await creatingOffscreen;
  creatingOffscreen = null;
  // Give the offscreen document time to load its JS and register listeners
  await new Promise(resolve => setTimeout(resolve, 100));
  console.log("[TTP-BG] ✅ Offscreen document created.");
}

// Listen for port connections from the content script
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "tts-stream") return;

  console.log("[TTP-BG] 🔌 Port connected from content script.");
  const tabId = port.sender.tab.id;

  port.onMessage.addListener(async (message) => {
    if (message.type === "START_TTS") {
      console.log("[TTP-BG] ▶ Relaying START_TTS to offscreen document...");

      try {
        await ensureOffscreenDocument();

        // Forward to offscreen document
        chrome.runtime.sendMessage({
          type: "OFFSCREEN_START_TTS",
          text: message.text,
          voice_id: message.voice_id,
          tabId: tabId
        });
      } catch (err) {
        console.error("[TTP-BG] ❌ Failed to create offscreen doc:", err);
        try {
          port.postMessage({ type: "TTS_ERROR", error: err.message });
        } catch (e) { /* port closed */ }
      }

    } else if (message.type === "STOP_TTS") {
      console.log("[TTP-BG] ⏹ Relaying STOP_TTS to offscreen document...");
      chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP_TTS" });
    }
  });

  port.onDisconnect.addListener(() => {
    console.log("[TTP-BG] 🔌 Port disconnected.");
  });
});

// Listen for chunks from the offscreen document and relay to the correct tab
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "OFFSCREEN_TTS_CHUNK" && message.tabId) {
    // Relay to the content script in the correct tab
    chrome.tabs.sendMessage(message.tabId, {
      type: "TTS_CHUNK",
      payload: message.payload
    }).catch(() => {
      // Tab may have been closed
    });
  } else if (message.type === "STOP_TTS_STREAM") {
    // Manually intercept a global stop command from the frontend 
    console.log("[TTP-BG] ⏹ Received STOP_TTS_STREAM, relaying to offscreen...");
    chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP_TTS" }).catch(() => {});
  }
});
