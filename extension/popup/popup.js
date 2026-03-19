const STORAGE_KEY = "smallestApiKey";

console.log("[TTP-POPUP] ✅ Popup loaded.");

function setStatus(message, type = "info") {
  const el = document.getElementById("ttp-status");
  if (!el) return;
  el.textContent = message || "";
  el.classList.remove("ttp-status--error", "ttp-status--ok");
  if (type === "error") el.classList.add("ttp-status--error");
  if (type === "ok") el.classList.add("ttp-status--ok");
}

function setKeyState(label) {
  const el = document.getElementById("ttp-key-state");
  if (!el) return;
  el.textContent = label || "";
}

function init() {
  const input = document.getElementById("ttp-api-key-input");
  const saveBtn = document.getElementById("ttp-save-btn");
  const root = document.getElementById("ttp-popup-root");

  if (!input || !saveBtn) {
    console.log("[TTP-POPUP] ⚠ Missing input or button elements.");
    return;
  }

  console.log("[TTP-POPUP] 🔍 Loading stored API key from chrome.storage.local...");

  chrome.storage.local.get(STORAGE_KEY, (result) => {
    const existing = result[STORAGE_KEY];
    if (existing) {
      console.log("[TTP-POPUP] 🔑 Existing API key found in storage.");
      input.value = existing;
      setKeyState("Key saved");
    } else {
      console.log("[TTP-POPUP] ℹ️ No API key found in storage yet.");
      setKeyState("No key set");
    }
  });

  saveBtn.addEventListener("click", () => {
    const value = (input.value || "").trim();
    console.log("[TTP-POPUP] 💾 Save clicked. Value length:", value.length);

    if (!value) {
      setStatus("API key cannot be empty.", "error");
      setKeyState("No key set");
      return;
    }

    setStatus("Saving...");
    chrome.storage.local.set({ [STORAGE_KEY]: value }, () => {
      if (chrome.runtime.lastError) {
        console.error("[TTP-POPUP] ❌ Failed to save key:", chrome.runtime.lastError);
        setStatus("Failed to save key. See console.", "error");
        return;
      }

      console.log("[TTP-POPUP] ✅ API key saved to chrome.storage.local.");
      setStatus("Key saved. You can now use Listen to article.", "ok");
      setKeyState("Key saved");

      if (root) {
        console.log("[TTP-POPUP] 🎬 Starting close animation...");
        root.classList.add("is-closing");
        setTimeout(() => {
          console.log("[TTP-POPUP] 🪟 Closing popup window after animation.");
          window.close();
        }, 180);
      }
    });
  });
}

document.addEventListener("DOMContentLoaded", init);

