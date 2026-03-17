# Article to Podcast 🎧 (Twitter TTS Extension)

**Turn long Twitter/X articles and articles into audio — powered by Smallest AI Lightning TTS.**

One click. Any long article becomes a podcast you can listen to while scrolling, streaming directly to your browser with low latency.

---

## 🚀 Quick Start

### 1. Start the Secure Key Server

The extension needs your API key to connect to Smallest AI. To keep it secure and out of your client-side code, a tiny local server provides it.

```bash
cd server
cp .env.example .env
# Edit .env and paste your SMALLEST_API_KEY
npm install
npm start
```
*The server runs on `http://localhost:3456` and serves the key via `GET /api/key`.*

### 2. Load the Chrome Extension

1. Open Chrome and type `chrome://extensions` in the URL bar.
2. Toggle **Developer mode** on (top right corner).
3. Click **Load unpacked** and select the `extension/` folder from this repository.
4. Navigate to any X Article page.

### 3. Listen!

A floating **🔊 Listen to article** button will appear in the bottom corner of long posts.  
Click it! The extension will generate and stream high-quality audio back to you seamlessly via an injected audio player UI.

---

## 🏗 Architecture & Data Flow

This extension leverages Chrome's Manifest V3 **Offscreen Documents** to bypass aggressive background-script network timeouts, allowing for a stable, long-lived Server-Sent Events (SSE) connection directly to Smallest AI.

### How text becomes audio:
1. **Extraction:** The `content.js` script observes the DOM and uses `extractor.js` to grab clean text from articles.
2. **Key Fetch:** When you hit "play", the offscreen document safely requests the API key from your local server.
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
| **Key Server** | `server/index.js` | Minimal Express server to serve your secret API key safely (`GET /api/key`). |

---

## 🔑 Get your API Key

1. Visit [console.smallest.ai](https://console.smallest.ai)
2. Sign up / log in to your dashboard.
3. Navigate to the **API Keys** tab and create a new key.
4. Paste it into the `server/.env` file:
   ```env
   SMALLEST_API_KEY="your-secret-key-here"
   ```

---

*Built with [Smallest AI](https://smallest.ai)* ⚡️
