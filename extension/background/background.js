/**
 * background.js — Minimal service worker for the extension.
 *
 * For the MVP, this just sets the badge when the extension is installed.
 * Future: could handle message routing, caching, etc.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Thread to Podcast] Extension installed.");
});
