# Article to Podcast 🎧 (Twitter TTS Extension)

**Turn long Twitter/X articles into audio — powered by Smallest AI Lightning TTS.**

One click. Any long article becomes a podcast you can listen to while scrolling, streaming directly to your browser with low latency.

---

## 🧭 User Flow

**Install → Set key → Listen**

`User installs extension` ➜  
`Chrome opens API key setup tab` ➜  
`User pastes Smallest AI API key & saves` ➜  
`Key stored in chrome.storage.local` ➜  
`User opens Twitter/X article or thread` ➜  
`“🔊 Listen to article/thread” button appears` ➜  
`User clicks Listen, audio player shows` ➜  
`Audio streams from Smallest AI & plays` ➜  
`User can pause/stop or change key via extension icon`

---

## 🚀 Quick Start

### 1. Load the Chrome Extension

1. Open Chrome and type `chrome://extensions` in the URL bar.
2. Toggle **Developer mode** on (top right corner).
3. Click **Load unpacked** and select the `extension/` folder from this repository.
4. On first install, a new tab will open with a Smallest AI **API key setup** screen. Paste your key and hit **Save**.

### 2. Listen!

A floating **🔊 Listen to article** button will appear in the bottom corner of long posts.  
Click it! The extension will generate and stream high-quality audio back to you seamlessly via an injected audio player UI.

---

## 🏗 Architecture & Data Flow

This extension leverages Chrome's Manifest V3 **Offscreen Documents** to bypass aggressive background-script network timeouts, allowing for a stable, long-lived Server-Sent Events (SSE) connection directly to Smallest AI.

```mermaid
flowchart TD
  user[User] -->|installs| chromeExtensions[ChromeExtensions]
  chromeExtensions -->|onInstalled| onboardingTab[OnboardingTab "popup.html (API key UI)"]

  onboardingTab -->|save key| chromeStorage[chrome.storage.local]

  user -->|visits X article/thread| contentScript[content.js]
  contentScript --> extractor[extractor.js]
  extractor -->|article text| contentScript

  contentScript -->|START_TTS via Port| backgroundSW[background.js]
  backgroundSW -->|read key| chromeStorage
  backgroundSW -->|text + key| offscreenDoc[offscreen.js]

  offscreenDoc -->|SSE POST| smallestAPI["Smallest AI TTS API"]
  smallestAPI -->|PCM audio chunks| offscreenDoc

  offscreenDoc -->|TTS_CHUNK messages| backgroundSW
  backgroundSW -->|relay TTS_CHUNK| contentScript
  contentScript --> player[player.js]
  player -->|playback| user
```

### How text becomes audio:
1. **Extraction:** The `content.js` script observes the DOM and uses `extractor.js` to grab clean text from articles.
2. **Key Fetch:** On first install, the extension opens an onboarding tab (`popup.html`) where you paste your Smallest AI API key. The key is stored locally via `chrome.storage.local`. When you hit "play", the background service worker reads this key and passes it to the offscreen document.
3. **Chunking:** The offscreen document chunks the extracted text into blocks of ≤250 characters (Smallest AI's best practices) to prevent API timeouts.
4. **Direct SSE Stream:** `offscreen.js` sends chunk requests sequentially to `api.smallest.ai/.../stream`.
5. **Byte Buffering:** As base64 chunks drip in over SSE, the offscreen document decodes them to raw PCM bytes, buffers them to ~32KB blocks to reduce message overhead, and re-encodes to base64.
6. **Playback:** The `player.js` receives the buffered base64 strings, decodes them back to `Float32Array` values, and plays them gaplessly at 24000 Hz using the fast Web Audio API.

---

## 📂 Codebase Breakdown

| Component | File | Purpose |
|-----------|------|---------|
| **UI & Orchestration** | `extension/content/content.js` | Injects the floating "Listen" button & playback UI. Displays live chunk generation progress. |
| **DOM Parser** | `extension/content/extractor.js` | Parses the complex React DOM of Twitter/X to detect X Articles cleanly. |
| **Web Audio API** | `extension/content/player.js` | Gapless PCM chunk player handling 24kHz audio using `AudioContext` and buffering states. |
| **Offscreen Streamer** | `extension/offscreen/offscreen.js` | The streaming engine. Connects to Smallest AI via SSE, chunks long texts, buffers audio bytes, and relays safely to the player. |
| **Service Worker** | `extension/background/background.js` | Creates the Offscreen Document and manages passing messages between `content.js` and `offscreen.js`. |
| **Key Storage** | `extension/popup/popup.{html,js}` | Onboarding UI where the user pastes their Smallest AI API key, stored locally via `chrome.storage.local`. |

---

## 🔑 Get your API Key

1. Visit [app.smallest.ai](https://app.smallest.ai/)
2. Sign up / log in to your dashboard.
3. Navigate to the **API Keys** tab and create a new key.
4. When the extension opens the onboarding tab (or when you click the extension icon), paste your key into the **API key** field and click **Save**. The key is stored only in your browser’s extension storage and used solely to call Smallest AI’s TTS API.

---

*Built with [Smallest AI](https://smallest.ai)* ⚡️
