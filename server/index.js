require("dotenv").config();
const express = require("express");
const cors = require("cors");
const WebSocket = require("ws");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3456;
const WS_URL =
  "wss://waves-api.smallest.ai/api/v1/lightning-v3.2/get_speech/stream?timeout=180";

// ── Text chunking (adapted from smallest-node-sdk WavesClient) ──────────────
const SENTENCE_END = /.*[-.—!?,;:…।|]$/;

function chunkText(text, maxChunkSize = 250) {
  const chunks = [];
  text = text.trim();

  while (text) {
    if (text.length <= maxChunkSize) {
      chunks.push(text.trim());
      break;
    }

    const slice = text.substring(0, maxChunkSize);
    let breakIdx = -1;

    for (let i = slice.length - 1; i >= 0; i--) {
      if (SENTENCE_END.test(slice.substring(0, i + 1))) {
        breakIdx = i;
        break;
      }
    }

    if (breakIdx === -1) {
      const lastSpace = slice.lastIndexOf(" ");
      breakIdx = lastSpace !== -1 ? lastSpace : maxChunkSize - 1;
    }

    chunks.push(text.substring(0, breakIdx + 1).trim());
    text = text.substring(breakIdx + 1).trim();
  }

  return chunks;
}

// ── POST /api/tts-stream ────────────────────────────────────────────────────
// Accepts { text, voice_id } → streams back SSE with base64 audio chunks.
// Pattern taken from debate-arena speak-stream/route.js
app.post("/api/tts-stream", async (req, res) => {
  const { text, voice_id } = req.body;

  if (!text || !voice_id) {
    return res.status(400).json({ error: "text and voice_id are required" });
  }

  const apiKey = process.env.SMALLEST_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "SMALLEST_API_KEY not configured on server" });
  }

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const chunks = chunkText(text);
  let chunkIndex = 0;
  let closed = false;

  const sendSSE = (data) => {
    if (closed) return;
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {}
  };

  const processNextChunk = () => {
    if (closed || chunkIndex >= chunks.length) {
      if (!closed) {
        sendSSE({ done: true });
        closed = true;
        res.end();
      }
      return;
    }

    const chunkText = chunks[chunkIndex];
    chunkIndex++;

    let ws;
    try {
      ws = new WebSocket(WS_URL, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } catch (err) {
      sendSSE({ error: `WebSocket creation failed: ${err.message}` });
      closed = true;
      res.end();
      return;
    }

    const timeout = setTimeout(() => {
      sendSSE({ error: "TTS chunk timeout" });
      try { ws.close(); } catch {}
      processNextChunk();
    }, 30000);

    ws.on("open", () => {
      ws.send(JSON.stringify({ text: chunkText, voice_id }));
      ws.send(JSON.stringify({ flush: true }));
    });

    ws.on("message", (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.status === "chunk" && data.data?.audio) {
          sendSSE({ audio: data.data.audio });
        } else if (data.status === "complete") {
          clearTimeout(timeout);
          try { ws.close(); } catch {}
          // Process the next chunk sequentially
          processNextChunk();
        } else if (data.status === "error") {
          clearTimeout(timeout);
          sendSSE({ error: data.error?.message || "TTS error" });
          try { ws.close(); } catch {}
          processNextChunk();
        }
      } catch {}
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      sendSSE({ error: err.message });
      processNextChunk();
    });

    ws.on("close", () => {
      clearTimeout(timeout);
    });
  };

  // Handle client disconnect
  req.on("close", () => {
    closed = true;
  });

  // Start processing
  processNextChunk();
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`🎧 Twitter TTS server running on http://localhost:${PORT}`);
});
