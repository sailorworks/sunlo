/**
 * content.js — Main content script for the Twitter TTS extension.
 */

(() => {
  // Prevent double-injection
  if (window.__ttpInjected) return;
  window.__ttpInjected = true;

  console.log("[TTP] ✅ Content script loaded on:", window.location.href);

  const VOICE_ID = "magnus"; // Default Smallest AI voice
  let player = null;
  let abortController = null;
  let progressInterval = null;
  let currentPhase = "idle";

  // ── Inject floating "Listen" button ──────────────────────────────────────
  function injectListenButton(result) {
    if (document.getElementById("ttp-listen-btn")) return;
    const label = result.type === "article" ? "article" : `${result.tweetCount} tweets`;
    console.log(`[TTP] 🔊 Injecting listen button (${label})`);

    const btn = document.createElement("button");
    btn.id = "ttp-listen-btn";
    btn.innerHTML = `
      <span class="ttp-icon">🔊</span>
      <span>Listen to ${result.type === "article" ? "article" : "thread"}</span>
      <span class="ttp-badge">${label}</span>
    `;
    btn.addEventListener("click", handlePlay);
    document.body.appendChild(btn);
  }

  function removeListenButton() {
    const btn = document.getElementById("ttp-listen-btn");
    if (btn) {
      console.log("[TTP] Removing listen button");
      btn.remove();
    }
  }

  // ── Inject the player UI ─────────────────────────────────────────────────
  function injectPlayerUI() {
    if (document.getElementById("ttp-player")) return;
    console.log("[TTP] 🎧 Injecting player UI");

    const panel = document.createElement("div");
    panel.id = "ttp-player";
    panel.innerHTML = `
      <div id="ttp-player-header">
        <div class="ttp-title">
          <div class="ttp-dot"></div>
          <span>🎧 Listening to thread</span>
        </div>
        <button id="ttp-player-close">✕</button>
      </div>
      <div id="ttp-player-controls">
        <button class="ttp-ctrl-btn" id="ttp-skip-back" title="Back 10s">⏪</button>
        <button class="ttp-ctrl-btn ttp-play-pause" id="ttp-play-pause" title="Pause">⏸</button>
        <button class="ttp-ctrl-btn" id="ttp-skip-fwd" title="Forward 10s">⏩</button>
      </div>
      <div id="ttp-player-progress">
        <div id="ttp-progress-bar-container">
          <div id="ttp-progress-bar"></div>
        </div>
        <div id="ttp-time-display">
          <span id="ttp-time-current">0:00</span>
          <span id="ttp-time-total">--:--</span>
        </div>
      </div>
      <div id="ttp-player-status">
        <span>Streaming audio<span class="ttp-streaming-dots"></span></span>
      </div>
      <div id="ttp-player-footer">Powered by Smallest AI</div>
    `;
    document.body.appendChild(panel);

    document.getElementById("ttp-player-close").addEventListener("click", handleStop);
    document.getElementById("ttp-play-pause").addEventListener("click", handleTogglePause);
  }

  function removePlayerUI() {
    const panel = document.getElementById("ttp-player");
    if (panel) panel.remove();
  }

  function updatePlayerStatus(text) {
    const el = document.getElementById("ttp-player-status");
    if (el) el.innerHTML = `<span>${text}</span>`;
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function startProgressUpdater() {
    if (progressInterval) clearInterval(progressInterval);
    progressInterval = setInterval(() => {
      if (!player) return;
      const current = player.getCurrentTime();
      const total = player.getTotalDuration();
      const currentEl = document.getElementById("ttp-time-current");
      const totalEl = document.getElementById("ttp-time-total");
      const barEl = document.getElementById("ttp-progress-bar");
      if (currentEl) currentEl.textContent = formatTime(current);
      if (totalEl && total > 0) totalEl.textContent = formatTime(total);
      if (barEl && total > 0) {
        const pct = Math.min((current / total) * 100, 100);
        barEl.style.width = `${pct}%`;
      }
    }, 300);
  }

  function stopProgressUpdater() {
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
  }

  // ── Handlers ─────────────────────────────────────────────────────────────
  async function handlePlay() {
    console.log("[TTP] ▶ Play clicked — extracting text...");
    const { text, tweetCount } = ThreadExtractor.extract();
    if (!text) {
      console.log("[TTP] ⚠ No text extracted, aborting.");
      return;
    }
    console.log(`[TTP] Extracted ${tweetCount} tweets, ${text.length} chars. Starting TTS...`);

    removeListenButton();
    injectPlayerUI();

    player = new AudioStreamPlayer();
    abortController = new AbortController();
    currentPhase = "streaming";
    startProgressUpdater();

    try {
      await streamTTSAndPlay(text, VOICE_ID, player, abortController.signal, ({ phase, currentChunk, totalChunks }) => {
        currentPhase = phase;
        console.log(`[TTP] Phase: ${phase}${currentChunk ? ` (chunk ${currentChunk}/${totalChunks})` : ""}`);
        if (phase === "streaming") {
          updatePlayerStatus('Connecting<span class="ttp-streaming-dots"></span>');
        } else if (phase === "generating") {
          const chunkInfo = currentChunk && totalChunks
            ? ` (${currentChunk}/${totalChunks} chunks)`
            : "";
          updatePlayerStatus(`Generating audio${chunkInfo}<span class="ttp-streaming-dots"></span>`);
        } else if (phase === "playing") {
          updatePlayerStatus("🔊 Playing audio...");
        } else if (phase === "done") {
          updatePlayerStatus("✓ Finished");
          currentPhase = "done";
          stopProgressUpdater();
          const barEl = document.getElementById("ttp-progress-bar");
          if (barEl) barEl.style.width = "100%";
        }
      });
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("[TTP] ❌ Error:", err);
        updatePlayerStatus(`⚠ Error: ${err.message}`);
      }
    }
  }

  function handleTogglePause() {
    if (!player) return;
    const btn = document.getElementById("ttp-play-pause");
    if (player.isPaused()) {
      player.resume();
      currentPhase = "playing";
      if (btn) btn.textContent = "⏸";
      updatePlayerStatus("Playing audio...");
    } else {
      player.pause();
      currentPhase = "paused";
      if (btn) btn.textContent = "▶";
      updatePlayerStatus("Paused");
    }
  }

  function handleStop() {
    console.log("[TTP] ⏹ Stop clicked");
    if (abortController) abortController.abort();
    if (player) player.stop();
    stopProgressUpdater();
    removePlayerUI();
    currentPhase = "idle";
    player = null;
    abortController = null;
    checkForArticle();
  }

  // ── Article detection ────────────────────────────────────────────────────
  function checkForArticle() {
    console.log("[TTP] 🔍 Checking for article on:", window.location.href);
    const result = ThreadExtractor.extract();
    if (result.isArticle) {
      console.log(`[TTP] ✅ ${result.type === "article" ? "Article" : "Thread"} detected! Showing listen button.`);
      injectListenButton(result);
    } else {
      console.log("[TTP] ❌ Not an article (or too short). No button shown.");
      removeListenButton();
    }
  }

  // ── Twitter SPA navigation detection ─────────────────────────────────────
  let lastUrl = location.href;
  let checkCount = 0;

  function onNavigation() {
    console.log("[TTP] 🧭 Navigation detected:", location.href);
    if (currentPhase !== "idle") handleStop();
    removeListenButton();
    checkCount = 0;

    // Check multiple times as Twitter loads content progressively
    const delays = [1000, 2000, 4000, 7000];
    delays.forEach((delay) => {
      setTimeout(() => {
        checkCount++;
        console.log(`[TTP] 🔄 Scheduled check #${checkCount} (after ${delay}ms)`);
        checkForArticle();
      }, delay);
    });
  }

  // Observe URL changes (Twitter SPA)
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      onNavigation();
    }
  });
  urlObserver.observe(document.body, { childList: true, subtree: true });

  // ── Initial check ────────────────────────────────────────────────────────
  console.log("[TTP] 🚀 Running initial checks...");
  setTimeout(() => {
    console.log("[TTP] 🔄 Initial check #1 (2s)");
    checkForArticle();
  }, 2000);
  setTimeout(() => {
    console.log("[TTP] 🔄 Initial check #2 (5s)");
    checkForArticle();
  }, 5000);
  setTimeout(() => {
    console.log("[TTP] 🔄 Initial check #3 (10s)");
    checkForArticle();
  }, 10000);
})();
