(function initializePageTranslationCache(global) {
  const VERSION = 1;
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
    return settings.geminiModel;
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
      customPrompt: normalizePageSource(settings.customPrompt ?? "")
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
    buildPageTranslationKey,
    createPageTranslationEntry,
    hydratePageTranslationCache,
    serializePageTranslationCache,
    createPageTranslationCacheStore
  });
  global.ImmerseFreePageTranslationCache = pageTranslationCache;
})(globalThis);
