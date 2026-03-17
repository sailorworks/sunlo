require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3456;

// ── GET /api/key ─────────────────────────────────────────────────────────────
// Provides the Smallest AI API key to the extension.
// The extension calls the Smallest AI SSE endpoint directly.
app.get("/api/key", (req, res) => {
  const apiKey = process.env.SMALLEST_API_KEY;
  if (!apiKey) {
    console.error("[Server] ❌ SMALLEST_API_KEY is missing!");
    return res.status(500).json({ error: "SMALLEST_API_KEY not configured" });
  }
  console.log("[Server] 🔑 API key requested by extension.");
  res.json({ api_key: apiKey });
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`🎧 Twitter TTS server running on http://localhost:${PORT}`);
  console.log(`   Extension will fetch API key from GET /api/key`);
  console.log(`   Audio streams directly from Smallest AI (no proxy).`);
});
