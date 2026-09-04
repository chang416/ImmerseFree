(function initializePageTranslationCache(global) {
  // 2 = 加入 glossaryHash 維度之後的鍵格式。版本一跳，hydrate 就會整份丟掉
  // 舊快取——舊的 key 用新公式再也算不出來，留著只是佔配額。
  const VERSION = 2;
  const PAGE_TRANSLATION_CACHE_STORAGE_KEY = "immerseFreePageTranslationCache";
  const KEY_PATTERN = new RegExp(`^p${VERSION}:[0-9a-f]{16}$`, "i");
  const DEFAULT_LIMITS = Object.freeze({
    // A daily report can contain more than 1,200 paragraphs. The byte cap is
    // the primary guard; this entry cap leaves room for a few reports while
    // still keeping local storage bounded.
    maxEntries: 6000,
    maxBytes: 8 * 1024 * 1024,
    maxTranslatedCharacters: 6000,
    maxPreviewCharacters: 160
  });

  // This cache is deliberately separate from the background translation cache.
  // The background cache is an ephemeral request optimisation; this one is a
  // user-visible page workspace and must survive a service-worker restart.
  function normalizePageSource(value) {
    const text = String(value ?? "");
    const normalized = typeof text.normalize === "function" ? text.normalize("NFKC") : text;
    return normalized.replace(/\s+/gu, " ").trim();
  }

  function normalizeTranslatedText(value) {
    // NFKC is useful for source fingerprints, but it would turn punctuation
    // such as the full-width colon in a Traditional Chinese translation into
    // a different glyph. Keep the model's translated text intact apart from
    // insignificant whitespace.
    return String(value ?? "").replace(/\s+/gu, " ").trim();
  }

  // A deterministic non-cryptographic fingerprint is sufficient here: the
  // source itself is never used as a storage key. Two independent 32-bit FNV
  // lanes keep the accidental collision risk low without requiring an async
  // crypto operation for every DOM paragraph.
  function fingerprint(value) {
    const text = String(value ?? "");
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      first ^= code;
      first = Math.imul(first, 0x01000193);
      second ^= code + index;
      second = Math.imul(second, 0x85ebca6b);
      second ^= second >>> 13;
    }
    return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
  }

  function selectedModel(settings = {}) {
    if (settings.provider === "opencode") return settings.opencodeModel;
    if (settings.provider === "antigravity") return settings.antigravityModel;
    // 自訂端點漏了這一支，換模型時 key 不會變（拿的是 geminiModel），
    // 使用者換完模型還會撿到舊模型的譯文。背景頁的 selectedModel 有這一支，
    // 兩邊必須一致。
    if (settings.provider === "custom") return settings.customModel;
    return settings.geminiModel;
  }

  // 術語表指紋。同一組術語不論陣列順序都要得到同一個值，否則 key 會因為
  // 順序抖動而白白 miss；反過來，只要有一條術語的譯法改了就必須變。
  function normalizeGlossaryTerms(value) {
    if (!Array.isArray(value)) return [];
    const unique = new Map();
    for (const item of value) {
      const source = normalizePageSource(item?.source ?? "");
      const target = normalizePageSource(item?.target ?? "");
      if (!source || !target) continue;
      unique.set(`${source.toLowerCase()}\u241f${target}`, `${source}\u241f${target}`);
    }
    return [...unique.values()].sort();
  }

  function glossaryHash(value) {
    const terms = normalizeGlossaryTerms(value);
    return terms.length ? fingerprint(terms.join("\u241e")) : "";
  }

  function keySettings(settings = {}) {
    // Include every setting that can alter a page translation. Deliberately do
    // not include URL/title: the same paragraph should hit after an SPA route
    // change or after a report is moved to another URL.
    return {
      sourceLanguage: String(settings.sourceLanguage ?? "auto").trim(),
      targetLanguage: String(settings.targetLanguage ?? "zh-Hant").trim(),
      translationStyle: String(settings.translationStyle ?? "natural").trim(),
      provider: String(settings.provider ?? "").trim(),
      model: String(selectedModel(settings) ?? "").trim(),
      customPrompt: normalizePageSource(settings.customPrompt ?? ""),
      // W1-3 先開的預留維度，W2-4 已接上真值：網頁／PDF／劃詞的術語表由背景頁
      // 挑好之後掛進 scope.glossary（見 background.js 的 cacheScope）。沒有命中
      // 任何術語的段落算出來仍是空字串，一般網頁的命中率不受影響；改了某一條
      // 術語的譯法，只有用得到那條術語的段落會 miss、重翻一次。
      glossaryHash: glossaryHash(settings.glossary)
    };
  }

  function buildPageTranslationKey(sourceText, settings = {}) {
    const source = normalizePageSource(sourceText);
    const config = keySettings(settings);
    return `p${VERSION}:${fingerprint(JSON.stringify({ source, config }))}`;
  }

  function sourceHash(sourceText) {
    return fingerprint(normalizePageSource(sourceText));
  }

  // ── 請求層快取鍵（背景頁的記憶體快取用）──────────────────────
  //
  // 設計原則：內容為 key、設定為 namespace。只有「會影響譯文、而且同一句話
  // 再遇到時仍然相同」的維度才進 key：
  //   設定面（keySettings）provider／model／來源語言／目標語言／風格／
  //     自訂 prompt／術語表指紋
  //   請求面（scope）mode、strictTargetLanguage、這一句有沒有被要求壓縮、
  //     字幕模式的 videoId
  //
  // 刻意不進 key 的是 context.previous／context.dialogue／title／影片簡介
  // 這些每一批都不一樣的欄位。原本的背景層 key 把整個 context
  // JSON.stringify 進去，而對話脈絡每批都變，於是同一句話永遠算出新的 key、
  // 永遠 miss——快取存在但命中率趨近 0，而且完全不會報錯。
  //
  // 取捨（刻意接受）：拿掉對話脈絡維度之後，「同一句話在不同上下文可能被翻成
  // 不同譯文」這件事會被快取抹平，第二次出現時直接沿用第一次的譯文。快取的
  // 單位因此是「同設定、同影片、同一句原文」。這是划算的：省下來的是整批
  // 重打，而字幕裡重複出現的短句本來就該譯得一致。
  //
  // 字幕模式一定要帶 videoId：兩支不同影片的 "Let's go." 是兩件事，少了這個
  // 維度就會互相污染（舊版靠 context 序列化半遮掩，碰撞其實一直存在）。
  // 反過來網頁模式一定不能帶，否則 SPA 換路由、同一段文字換網址就會重翻。
  function requestScope(scope = {}) {
    const mode = String(scope.mode ?? "page").trim().slice(0, 20) || "page";
    const normalized = {
      mode,
      strict: Boolean(scope.strictTargetLanguage),
      compact: Boolean(scope.compact),
      glossaryHash: glossaryHash(scope.glossary)
    };
    // 富文本維度（W2-2）。含行內佔位符的段落與同一句純文字是兩件事：
    // prompt 不同（多了佔位符規則）、回來的譯文形狀也不同。共用同一格的話，
    // 純文字譯文會被套進富文本還原流程、當場硬校驗失敗退回——功能靜默失效。
    //
    // **只有為真時才加這個欄位**（與 videoId 同一種寫法）。無條件加上去的話，
    // 每一個既有的純文字快取鍵都會算出新值，等於把整份快取一次作廢——
    // 那是使用者看得到的「明明翻過卻又重翻一次」，而且沒有任何錯誤訊息。
    if (scope.rich) normalized.rich = true;
    // 預設術語庫維度（波 2 收尾）。背景頁不需要它——它手上有實際命中的那幾條，
    // 全部進了 glossaryHash。內容腳本自己的記憶體快取沒有預設庫那份資料
    // （536 條放進每一個網頁的內容腳本太浪費），只知道「開了哪幾個領域」，
    // 所以用領域清單當那一份的指紋：勾選一變就必須重翻，維度本身很粗但方向
    // 是對的（寧可多翻一次，也不要改了設定卻沿用舊譯文）。
    //
    // 同樣**只有非空時才加**：沒有這個欄位的呼叫端算出來的 key 與以前逐字相同。
    const presetDomains = (Array.isArray(scope.presetDomains) ? scope.presetDomains : [])
      .map((id) => String(id ?? "").trim())
      .filter(Boolean)
      .sort();
    if (presetDomains.length) normalized.presetDomains = presetDomains.join(",");
    if (mode === "subtitle") normalized.videoId = String(scope.videoId ?? "").trim().slice(0, 160);
    return normalized;
  }

  function buildTranslationRequestKey(sourceText, settings = {}, scope = {}) {
    const source = normalizePageSource(sourceText);
    const config = keySettings(settings);
    return `r${VERSION}:${fingerprint(JSON.stringify({ source, config, scope: requestScope(scope) }))}`;
  }

  function toLimits(value = {}) {
    const maxEntries = Number(value.maxEntries);
    const maxBytes = Number(value.maxBytes);
    const maxTranslatedCharacters = Number(value.maxTranslatedCharacters);
    const maxPreviewCharacters = Number(value.maxPreviewCharacters);
    return {
      maxEntries: Number.isFinite(maxEntries) && maxEntries > 0
        ? Math.floor(maxEntries) : DEFAULT_LIMITS.maxEntries,
      maxBytes: Number.isFinite(maxBytes) && maxBytes > 0
        ? Math.floor(maxBytes) : DEFAULT_LIMITS.maxBytes,
      maxTranslatedCharacters: Number.isFinite(maxTranslatedCharacters) && maxTranslatedCharacters > 0
        ? Math.floor(maxTranslatedCharacters) : DEFAULT_LIMITS.maxTranslatedCharacters,
      maxPreviewCharacters: Number.isFinite(maxPreviewCharacters) && maxPreviewCharacters > 0
        ? Math.floor(maxPreviewCharacters) : DEFAULT_LIMITS.maxPreviewCharacters
    };
  }

  function createPageTranslationEntry(sourceText, translatedText, settings = {}, now = Date.now(), limits = {}) {
    const safeLimits = toLimits(limits);
    const source = normalizePageSource(sourceText);
    const translation = normalizeTranslatedText(translatedText);
    const config = keySettings(settings);
    return {
      version: VERSION,
      sourceHash: sourceHash(source),
      sourcePreview: source.slice(0, safeLimits.maxPreviewCharacters),
      sourceLength: source.length,
      translatedText: translation.slice(0, safeLimits.maxTranslatedCharacters),
      targetLanguage: config.targetLanguage,
      translationStyle: config.translationStyle,
      provider: config.provider,
      model: config.model,
      createdAt: Number.isFinite(Number(now)) ? Number(now) : Date.now(),
      lastUsed: Number.isFinite(Number(now)) ? Number(now) : Date.now()
    };
  }

  function safeText(value, maxLength) {
    const text = String(value ?? "");
    return text.slice(0, maxLength);
  }

  function safeTimestamp(value, fallback = 0) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : fallback;
  }

  function sanitizeEntry(value, limits = {}) {
    const safeLimits = toLimits(limits);
    if (!value || typeof value !== "object") return null;
    const translatedText = safeText(value.translatedText, safeLimits.maxTranslatedCharacters).trim();
    const sourceHashValue = safeText(value.sourceHash, 64).trim();
    if (!translatedText || !sourceHashValue) return null;
    return {
      version: VERSION,
      sourceHash: sourceHashValue,
      sourcePreview: safeText(value.sourcePreview, safeLimits.maxPreviewCharacters),
      sourceLength: Math.max(0, Math.floor(Number(value.sourceLength) || 0)),
      translatedText,
      targetLanguage: safeText(value.targetLanguage, 40),
      translationStyle: safeText(value.translationStyle, 40),
      provider: safeText(value.provider, 40),
      model: safeText(value.model, 160),
      createdAt: safeTimestamp(value.createdAt),
      lastUsed: safeTimestamp(value.lastUsed, safeTimestamp(value.createdAt))
    };
  }

  function byteLength(value) {
    const text = JSON.stringify(value);
    try {
      return new TextEncoder().encode(text).length;
    } catch {
      return text.length * 2;
    }
  }

  function entriesOf(state) {
    return state?.entries instanceof Map ? state.entries : new Map();
  }

  function prunePageTranslationCache(state, limits = {}) {
    const safeLimits = toLimits(limits);
    const entries = entriesOf(state);
    const sorted = [...entries.entries()]
      .sort(([, left], [, right]) => {
        const byRecent = (Number(right.lastUsed) || 0) - (Number(left.lastUsed) || 0);
        return byRecent || String(left.sourceHash).localeCompare(String(right.sourceHash));
      })
      .slice(0, safeLimits.maxEntries);

    const kept = new Map();
    for (const [key, entry] of sorted) {
      kept.set(String(key), entry);
    }
    // The newest entries are retained first. If adding an entry would exceed
    // the byte budget, drop the oldest remaining entries until it fits.
    while (kept.size && byteLength(serializePageTranslationCache({ entries: kept }, safeLimits)) > safeLimits.maxBytes) {
      const oldestKey = [...kept.keys()].at(-1);
      kept.delete(oldestKey);
    }
    state.entries = kept;
    state.version = VERSION;
    return state;
  }

  function hydratePageTranslationCache(raw, limits = {}) {
    const safeLimits = toLimits(limits);
    const state = { version: VERSION, entries: new Map() };
    if (!raw || typeof raw !== "object") return state;
    if (Number(raw.version) !== VERSION) return state;
    const values = raw.entries && typeof raw.entries === "object" ? raw.entries : {};
    const pairs = Array.isArray(values)
      ? values.map((entry) => [entry?.key, entry])
      : Object.entries(values);
    for (const [key, value] of pairs) {
      if (typeof key !== "string" || !KEY_PATTERN.test(key)) continue;
      const entry = sanitizeEntry(value, safeLimits);
      if (entry) state.entries.set(key, entry);
    }
    return prunePageTranslationCache(state, safeLimits);
  }

  function serializePageTranslationCache(state, limits = {}) {
    const safeLimits = toLimits(limits);
    const source = state?.entries instanceof Map ? state.entries : new Map();
    const entries = {};
    for (const [key, value] of source.entries()) {
      if (!KEY_PATTERN.test(String(key))) continue;
      const entry = sanitizeEntry(value, safeLimits);
      if (entry) entries[key] = entry;
    }
    return { version: VERSION, entries };
  }

  function cacheGet(state, key, now = Date.now()) {
    const entry = entriesOf(state).get(String(key));
    if (!entry) return null;
    entry.lastUsed = safeTimestamp(now, Date.now());
    return entry;
  }

  function cachePut(state, key, entry, limits = {}) {
    if (!state || !(state.entries instanceof Map)) return state;
    const safeEntry = sanitizeEntry(entry, limits);
    if (!safeEntry || !KEY_PATTERN.test(String(key))) return state;
    state.entries.set(String(key), safeEntry);
    return prunePageTranslationCache(state, limits);
  }

  function storageApi(api) {
    return api?.storage?.local ?? null;
  }

  function createPageTranslationCacheStore(api, options = {}) {
    const limits = toLimits(options);
    const storage = storageApi(api);
    let state = { version: VERSION, entries: new Map() };
    let readyPromise;
    let writeQueue = Promise.resolve();

    async function ready() {
      if (!readyPromise) {
        readyPromise = (async () => {
          if (!storage?.get) return state;
          try {
            const result = await storage.get(PAGE_TRANSLATION_CACHE_STORAGE_KEY);
            state = hydratePageTranslationCache(result?.[PAGE_TRANSLATION_CACHE_STORAGE_KEY], limits);
          } catch {
            // Private browsing/Safari can expose storage but reject it. The
            // page translator must keep working with a memory-only cache.
            state = { version: VERSION, entries: new Map() };
          }
          return state;
        })();
      }
      return readyPromise;
    }

    function persist() {
      if (!storage?.set) return Promise.resolve();
      const payload = serializePageTranslationCache(state, limits);
      writeQueue = writeQueue
        .catch(() => {})
        .then(() => storage.set({ [PAGE_TRANSLATION_CACHE_STORAGE_KEY]: payload }))
        .catch(() => {});
      return writeQueue;
    }

    return Object.freeze({
      ready,
      async get(key) {
        await ready();
        // SPA 的 MutationObserver 可能在幾秒內命中數十次。讀取時只更新
        // 記憶體裡的 LRU；等真正新增譯文時再跟著 put 一起落盤，避免每次
        // DOM 變動都重寫整個（最高 8 MB）快取。
        return cacheGet(state, key);
      },
      async getMany(keys) {
        await ready();
        const hits = new Map();
        for (const key of keys ?? []) {
          const value = cacheGet(state, key);
          if (value) hits.set(String(key), value);
        }
        return hits;
      },
      async put(key, entry) {
        await ready();
        cachePut(state, key, entry, limits);
        await persist();
      },
      async putMany(values) {
        await ready();
        // Batch writes are common for a page translation. Sanitize every
        // record first and prune once; pruning after each paragraph would
        // repeatedly serialize the entire report and become quadratic.
        for (const [key, entry] of values ?? []) {
          const safeEntry = sanitizeEntry(entry, limits);
          if (safeEntry && KEY_PATTERN.test(String(key))) state.entries.set(String(key), safeEntry);
        }
        prunePageTranslationCache(state, limits);
        await persist();
      },
      snapshot() {
        return serializePageTranslationCache(state, limits);
      }
    });
  }

  const pageTranslationCache = Object.freeze({
    VERSION,
    DEFAULT_LIMITS,
    PAGE_TRANSLATION_CACHE_STORAGE_KEY,
    normalizePageSource,
    glossaryHash,
    buildPageTranslationKey,
    buildTranslationRequestKey,
    createPageTranslationEntry,
    hydratePageTranslationCache,
    serializePageTranslationCache,
    createPageTranslationCacheStore
  });
  global.ImmerseFreePageTranslationCache = pageTranslationCache;
})(globalThis);
