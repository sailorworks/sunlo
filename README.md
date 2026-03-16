# Thread to Podcast 🎧

**Turn long Twitter/X threads into audio — powered by Smallest AI TTS.**

One click. Any long thread becomes a podcast you can listen to while scrolling.

---

## Quick Start

### 1. Start the backend server

```bash
cd server
cp .env.example .env
# Add your Smallest AI API key to .env
npm install
npm start
```

The server runs on `http://localhost:3456`.

### 2. Load the Chrome extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `extension/` folder
4. Navigate to any long Twitter/X thread (5+ tweets)

### 3. Listen!

A floating **🔊 Listen to thread** button appears on long threads.  
Click it — audio starts streaming immediately.

---

## How it Works

```
Twitter Page → Content Script detects long thread
                    ↓
             Extracts all tweet text
                    ↓
             Sends to Express backend
                    ↓
             Backend → Smallest AI Waves API (WebSocket)
                    ↓
             Audio streams back as SSE chunks
                    ↓
             Web Audio API plays in real-time
```

## Architecture

| Component | File | Purpose |
|-----------|------|---------|
| **Backend** | `server/index.js` | Express server, text chunking, WebSocket → SSE bridge |
| **Extractor** | `extension/content/extractor.js` | Detect threads, extract tweet text |
| **Player** | `extension/content/player.js` | Web Audio API streaming playback |
| **Content Script** | `extension/content/content.js` | UI injection, orchestration |
| **Styles** | `extension/content/styles.css` | Player UI matching Twitter's theme |

## Get API Key

1. Visit [console.smallest.ai](https://console.smallest.ai)
2. Sign up / log in
3. Go to **API Keys** tab → Create a new key
4. Add it to `server/.env` as `SMALLEST_API_KEY`

---

Built with [Smallest AI](https://smallest.ai) Lightning TTS.
