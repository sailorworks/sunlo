/**
 * extractor.js — Detects long-form Twitter/X content and extracts text.
 *
 * Supports TWO formats:
 * 1. Twitter Articles — long-form posts (uses innerText of main content area)
 * 2. Twitter Threads — chains of reply tweets from the same user
 */

const ThreadExtractor = (() => {
  const TWEET_SELECTOR = 'article[data-testid="tweet"]';
  const TEXT_SELECTOR = 'div[data-testid="tweetText"]';
  const MIN_TWEETS = 5;
  const MIN_TEXT_LENGTH = 1500;
  const MIN_ARTICLE_LENGTH = 300;

  // Lines to strip from innerText extraction
  const TRASH_LINES = [
    /^home$/i, /^explore$/i, /^notifications$/i, /^messages$/i,
    /^grok$/i, /^communities$/i, /^premium$/i, /^profile$/i,
    /^more$/i, /^post$/i, /^subscribe$/i, /^sign up$/i,
    /^log in$/i, /^follow$/i, /^following$/i, /^share$/i,
    /^copy link$/i, /^bookmark$/i, /^like$/i, /^reply$/i,
    /^repost$/i, /^quote$/i, /^show more$/i, /^see new/i,
    /^post your reply/i, /^replying to/i, /^click to follow/i,
    /^who to follow/i, /^trending/i, /^what's happening/i,
    /^terms of service/i, /^privacy policy/i, /^cookie policy/i,
    /^accessibility$/i, /^ads info$/i, /^\d+$/, // bare numbers
    /^\d{1,2}:\d{2}\s*(AM|PM)/i,  // timestamps
    /^\d+\s*(replies|reposts|likes|views|quotes)/i, // engagement counts
    /^·$/,  // separator dots
    /^@\w+$/,  // bare @handles
    /^article$/i,  // the "Article" heading itself
    /^conversation$/i,
    /^relevant people$/i,
    /©\s*\d{4}/i,  // copyright
    /^search$/i,
    /^verified account$/i,
  ];

  function isTrashLine(line) {
    const trimmed = line.trim();
    if (trimmed.length < 3) return true; // single chars, empty
    return TRASH_LINES.some((p) => p.test(trimmed));
  }

  function isArticlePage() {
    const headings = document.querySelectorAll('[role="heading"]');
    for (const h of headings) {
      if (h.innerText?.trim() === "Article") {
        console.log("[TTP] 📰 Detected Article page via heading");
        return true;
      }
    }
    const articleLinks = document.querySelectorAll('a[href*="/article/"]');
    if (articleLinks.length > 0) {
      console.log("[TTP] 📰 Detected Article page via /article/ link");
      return true;
    }
    return false;
  }

  /**
   * Extract text from a Twitter Article using innerText approach.
   * Instead of hunting for specific selectors, we:
   * 1. Get the innerText of the primary content column
   * 2. Split into lines
   * 3. Filter out known UI/nav lines
   * 4. Keep the actual article content
   */
  function extractArticle() {
    console.log("[TTP] ──── Extracting ARTICLE (innerText mode) ────");

    // Twitter's layout: the main content is in the primary column
    // Try to find it via data-testid or fall back to <main>
    const primaryCol =
      document.querySelector('[data-testid="primaryColumn"]') ||
      document.querySelector('main') ||
      document.body;

    const rawText = primaryCol.innerText || "";
    console.log(`[TTP]   Raw innerText length: ${rawText.length} chars`);

    // Split into lines and filter
    const allLines = rawText.split("\n");
    console.log(`[TTP]   Total lines: ${allLines.length}`);

    const keptLines = [];
    let inContent = false;

    for (const line of allLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Start capturing after we see the article title or content markers
      // We detect content start by seeing a non-trash line that's reasonably long
      if (!inContent && trimmed.length > 30 && !isTrashLine(trimmed)) {
        inContent = true;
      }

      // Stop capturing at "Conversation" heading or reply section
      if (inContent && /^conversation$/i.test(trimmed)) {
        console.log("[TTP]   → Hit 'Conversation' boundary, stopping.");
        break;
      }

      if (inContent && !isTrashLine(trimmed)) {
        keptLines.push(trimmed);
      }
    }

    console.log(`[TTP]   Kept lines after filtering: ${keptLines.length}`);
    keptLines.forEach((line, i) => {
      console.log(
        `[TTP]   Line ${i + 1}: "${line.substring(0, 100)}${line.length > 100 ? "..." : ""}" (${line.length} chars)`
      );
    });

    const fullText = keptLines.join("\n\n");
    const isArticle = fullText.length >= MIN_ARTICLE_LENGTH;

    console.log("[TTP] ──── Article extraction result ────");
    console.log(`[TTP]   Total text length: ${fullText.length} (need >= ${MIN_ARTICLE_LENGTH})`);
    console.log(`[TTP]   Is article: ${isArticle}`);
    console.log("[TTP] ──────────────────────────────────────");

    return {
      isArticle,
      text: fullText,
      tweetCount: keptLines.length,
      type: "article",
    };
  }

  /**
   * Extract text from a Twitter Thread.
   */
  function extractThread() {
    console.log("[TTP] ──── Extracting THREAD ────");

    const tweetEls = document.querySelectorAll(TWEET_SELECTOR);
    console.log(`[TTP] Found ${tweetEls.length} tweet containers`);

    const texts = [];
    tweetEls.forEach((tweet, i) => {
      const textEl = tweet.querySelector(TEXT_SELECTOR);
      if (textEl) {
        const t = textEl.innerText.trim();
        console.log(
          `[TTP]   Tweet ${i + 1}: "${t.substring(0, 80)}${t.length > 80 ? "..." : ""}" (${t.length} chars)`
        );
        if (t) texts.push(t);
      } else {
        console.log(`[TTP]   Tweet ${i + 1}: no tweetText element found`);
      }
    });

    const fullText = texts.join("\n\n");
    const isArticle = texts.length >= MIN_TWEETS && fullText.length >= MIN_TEXT_LENGTH;

    console.log("[TTP] ──── Thread extraction result ────");
    console.log(`[TTP]   Tweets with text: ${texts.length} (need >= ${MIN_TWEETS})`);
    console.log(`[TTP]   Total text length: ${fullText.length} (need >= ${MIN_TEXT_LENGTH})`);
    console.log(`[TTP]   Is article: ${isArticle}`);
    console.log("[TTP] ─────────────────────────────────────");

    return { isArticle, text: fullText, tweetCount: texts.length, type: "thread" };
  }

  function extract() {
    console.log("[TTP] ──── Running extraction on:", window.location.href, "────");
    if (isArticlePage()) {
      return extractArticle();
    } else {
      return extractThread();
    }
  }

  return { extract, MIN_TWEETS, MIN_TEXT_LENGTH };
})();
