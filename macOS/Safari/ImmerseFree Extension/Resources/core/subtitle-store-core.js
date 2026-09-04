(function initializeSubtitleStoreCore(global) {
  // 字幕翻譯紀錄。
  //
  // 0.7.0 之前，翻譯過的句子只活在記憶體裡：background 的 cache 用「字幕文字」
  // 當 key（background.js:225），SW 一睡就沒了，而且不同影片只要有同一句台詞
  // （"Okay."、"Let's go."）就會互相撞在一起。這個檔把權威來源換成
  // 「影片 + 時間軸 + 文字」算出來的 cueId，並且落到 chrome.storage.local，
  // 所以 SW 重啟、關掉分頁再回來都不必重翻。
  //
  // 單位一律毫秒。subtitle-format-core 吐的是秒，呼叫端在邊界用 toMs 轉，
  // 不要讓秒制流進這裡；dual-subtitle.js / study-core.js 的秒制契約不受影響。
  const STORAGE_PREFIX = "immersefreeSubtitles:";
  const INDEX_KEY = "immersefreeSubtitlesIndex";
  const MAX_VIDEOS = 1;
  const FLUSH_DELAY_MS = 2000;
  // 串流平台的字幕是邊播邊下載的。最後一句的結束時間離片長還差這麼多以內，
  // 就當作整集都到手了，可以匯出完整 SRT。
  const COMPLETE_TOLERANCE_MS = 60_000;

  function normalizeText(value) {
    return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  function normalizeMs(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return 0;
    return Math.round(number);
  }

  function toMs(seconds) {
    return normalizeMs(Number(seconds) * 1000);
  }

  function toSeconds(milliseconds) {
    return normalizeMs(milliseconds) / 1000;
  }

  // djb2。這裡只需要「同文字必同雜湊、不同文字幾乎必不同」，
  // 不需要密碼學強度，所以不用 SubtleCrypto（那是非同步的，會傳染整條路徑）。
  function hashText(value) {
    const text = normalizeText(value);
    let hash = 5381;
    for (let index = 0; index < text.length; index += 1) {
      hash = (((hash << 5) + hash) ^ text.charCodeAt(index)) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  // 影片 ID 的取法：
  // - YouTube：?v=、/shorts/、/live/、/embed/、youtu.be/<id>
  // - Netflix：/watch/<數字 id>（?trackId= 這類參數每次都不同，不能進 id）
  // - Disney+：/video/<guid>（前面可能有 /zh-hant 之類的語系前綴，所以只找 video 段）
  // - 其他或平台改版取不到時：站台 + pathname 的雜湊。用 pathname 而不是完整
  //   URL，是因為 query 常帶播放進度與追蹤參數，同一支影片每次進來都會變。
  function resolveVideoId(href) {
    let url;
    try {
      url = new URL(String(href ?? ""));
    } catch {
      return "";
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (/(^|\.)youtube\.com$/.test(host) || host === "youtu.be") {
      const id = url.searchParams.get("v")
        || url.pathname.match(/^\/(?:shorts|live|embed)\/([^/?]+)/)?.[1]
        || (host === "youtu.be" ? url.pathname.slice(1).split("/")[0] : "");
      if (id) return `yt:${id}`;
    }
    if (/(^|\.)netflix\.com$/.test(host)) {
      const id = url.pathname.match(/\/watch\/(\d+)/)?.[1];
      if (id) return `nf:${id}`;
    }
    if (/(^|\.)disneyplus\.com$/.test(host)) {
      const id = url.pathname.match(/\/video\/([^/?]+)/)?.[1];
      if (id) return `dp:${id}`;
    }
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return `url:${host}:${hashText(path)}`;
  }

  function storageKey(videoId) {
    return `${STORAGE_PREFIX}${videoId}`;
  }

  // cueId = 影片 ID + 起訖毫秒 + 文字短雜湊。時間軸讓同一句台詞在不同位置
  // 得到不同的 id（"Okay." 出現二十次也不會互相覆蓋），文字雜湊讓字幕軌
  // 被平台換掉時對不上而重翻，不會拿舊譯文貼新台詞。
  function makeCueId(videoId, cue = {}) {
    const startMs = normalizeMs(cue.startMs);
    const endMs = normalizeMs(cue.endMs);
    const text = cue.sourceText ?? cue.text ?? "";
    return `${videoId}@${startMs}-${endMs}-${hashText(text)}`;
  }

  // 2B 的語意合併會把數個 cue 併成一句，屆時同一句的 cue 共用 sentenceGroupId。
  // 本階段一個 cue 就是一組，欄位先就位，SRT 匯出已經照 group 取起訖時間。
  function normalizeCue(videoId, cue = {}) {
    const startMs = normalizeMs(cue.startMs);
    const endMs = Math.max(startMs, normalizeMs(cue.endMs));
    const sourceText = normalizeText(cue.sourceText ?? cue.text);
    const id = cue.id || makeCueId(videoId, { startMs, endMs, sourceText });
    return {
      id,
      startMs,
      endMs,
      sourceText,
      translatedText: typeof cue.translatedText === "string" ? cue.translatedText : "",
      sentenceGroupId: cue.sentenceGroupId || id
    };
  }

  function emptyRecord(videoId, meta = {}) {
    return {
      videoId,
      title: String(meta.title ?? ""),
      sourceLang: String(meta.sourceLang ?? ""),
      targetLang: String(meta.targetLang ?? ""),
      updatedAt: 0,
      trackComplete: false,
      cues: []
    };
  }

  // 既有譯文優先保留：重進影片時 recordCues 會再送一次整軌，
  // 不保留的話等於每次都清空重翻。
  // popup 可以在內容腳本還活著的時候改術語表（兩邊都直接寫 storage）。
  // 內容腳本手上那份 record 是幾秒前讀的，照原樣寫回去就會把使用者剛存的
  // 編輯蓋掉。寫入前把儲存端標了 pinned / userEdited 的項目撈回來，
  // 自動分析的結果只能填補空位。
  function preserveUserTerms(storedGlossary, nextGlossary) {
    const storedTerms = Array.isArray(storedGlossary?.terms) ? storedGlossary.terms : [];
    const keepers = storedTerms.filter((term) => term?.source && (term.pinned || term.userEdited));
    if (!keepers.length) return nextGlossary ?? storedGlossary;
    const next = nextGlossary && typeof nextGlossary === "object" ? nextGlossary : {};
    const nextTerms = Array.isArray(next.terms) ? next.terms : [];
    const seen = new Set(keepers.map((term) => String(term.source).toLowerCase()));
    const merged = [...keepers];
    for (const term of nextTerms) {
      const key = String(term?.source ?? "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(term);
    }
    return { domain: next.domain || storedGlossary?.domain || "", terms: merged };
  }

  function mergeCues(existing = [], incoming = []) {
    const merged = new Map();
    for (const cue of existing) merged.set(cue.id, cue);
    for (const cue of incoming) {
      const previous = merged.get(cue.id);
      merged.set(cue.id, previous
        ? { ...previous, ...cue, translatedText: cue.translatedText || previous.translatedText }
        : cue);
    }
    return [...merged.values()].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  }

  // LRU：只留最近用過的 MAX_VIDEOS 支，其餘連同它的紀錄一起刪。
  function pruneIndex(entries = [], max = MAX_VIDEOS) {
    const seen = new Map();
    for (const entry of entries) {
      if (!entry?.videoId) continue;
      const updatedAt = normalizeMs(entry.updatedAt);
      const previous = seen.get(entry.videoId);
      if (!previous || updatedAt >= previous.updatedAt) seen.set(entry.videoId, { videoId: entry.videoId, updatedAt });
    }
    const ordered = [...seen.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    return { kept: ordered.slice(0, max), dropped: ordered.slice(max) };
  }

  function evaluateTrackCompleteness({ cues = [], durationMs = 0, toleranceMs = COMPLETE_TOLERANCE_MS } = {}) {
    if (cues.length < 2) return false;
    const duration = normalizeMs(durationMs);
    if (!duration) return false;
    const lastEnd = cues.reduce((latest, cue) => Math.max(latest, normalizeMs(cue.endMs)), 0);
    return lastEnd >= duration - toleranceMs;
  }

  async function readRecord(storage, videoId) {
    if (!storage || !videoId) return undefined;
    const key = storageKey(videoId);
    const stored = await storage.get(key);
    const record = stored?.[key];
    if (!record || typeof record !== "object" || !Array.isArray(record.cues)) return undefined;
    return record;
  }

  // popup 改術語表用。只碰 glossary 欄位，其餘紀錄原樣寫回，
  // 不動 index（術語表編輯不代表這支影片剛看過）。
  async function writeGlossary(storage, videoId, glossary) {
    if (!storage || !videoId) return false;
    const key = storageKey(videoId);
    const stored = await storage.get(key);
    const record = stored?.[key];
    if (!record || typeof record !== "object") return false;
    record.glossary = glossary && typeof glossary === "object"
      ? { domain: String(glossary.domain ?? ""), terms: Array.isArray(glossary.terms) ? glossary.terms : [] }
      : undefined;
    await storage.set({ [key]: record });
    return true;
  }

  // 有狀態的那一層。storage/now/排程都由外面注入，測試才跑得起來
  // （node 沒有 chrome.storage，也不該真的等兩秒）。
  function createStore(options = {}) {
    const storage = options.storage;
    const now = typeof options.now === "function" ? options.now : () => Date.now();
    const flushDelayMs = Number.isFinite(options.flushDelayMs) ? options.flushDelayMs : FLUSH_DELAY_MS;
    const schedule = options.schedule ?? ((run, delay) => setTimeout(run, delay));
    const cancel = options.cancel ?? ((handle) => clearTimeout(handle));
    const maxVideos = Number.isFinite(options.maxVideos) ? options.maxVideos : MAX_VIDEOS;

    let record;
    let cues = new Map();
    let dirty = false;
    let timer;
    let pending = Promise.resolve();

    function cancelTimer() {
      if (timer === undefined) return;
      cancel(timer);
      timer = undefined;
    }

    // 節流：每句翻完就寫一次 storage，一支兩百句的影片就是兩百次寫入。
    // 統一延後合併成一次批次寫。
    function touch() {
      if (!record) return;
      dirty = true;
      if (timer !== undefined) return;
      timer = schedule(() => {
        timer = undefined;
        void flush();
      }, flushDelayMs);
    }

    function adopt(next) {
      record = next;
      cues = new Map(record.cues.map((cue) => [cue.id, cue]));
    }

    async function open(meta = {}) {
      const videoId = String(meta.videoId ?? "");
      if (!videoId) return undefined;
      if (record?.videoId === videoId) {
        if (meta.title && !record.title) record.title = String(meta.title);
        return record;
      }
      await flush();
      const stored = await readRecord(storage, videoId);
      // 目標語言換了就不能再用舊譯文——同一個 cueId 在中文與日文下是兩種內容。
      const reusable = stored
        && (!meta.targetLang || !stored.targetLang || stored.targetLang === meta.targetLang);
      adopt(reusable
        ? {
          ...emptyRecord(videoId, meta),
          ...stored,
          title: String(meta.title ?? stored.title ?? ""),
          sourceLang: String(meta.sourceLang ?? stored.sourceLang ?? ""),
          targetLang: String(meta.targetLang ?? stored.targetLang ?? ""),
          cues: stored.cues.map((cue) => normalizeCue(videoId, cue))
        }
        : emptyRecord(videoId, meta));
      return record;
    }

    function recordCues(list = []) {
      if (!record) return [];
      const normalized = list.map((cue) => normalizeCue(record.videoId, cue));
      record.cues = mergeCues(record.cues, normalized);
      cues = new Map(record.cues.map((cue) => [cue.id, cue]));
      touch();
      return normalized.map((cue) => cue.id);
    }

    function recordTranslation(cueId, translatedText) {
      if (!record || !cueId) return false;
      const cue = cues.get(cueId);
      const text = String(translatedText ?? "");
      if (!cue || !text || cue.translatedText === text) return false;
      cue.translatedText = text;
      touch();
      return true;
    }

    // 影片級術語表。每支影片只分析一次，結果就掛在這支影片的紀錄上。
    function setGlossary(glossary) {
      if (!record) return false;
      record.glossary = glossary && typeof glossary === "object"
        ? { domain: String(glossary.domain ?? ""), terms: Array.isArray(glossary.terms) ? glossary.terms : [] }
        : undefined;
      touch();
      return true;
    }

    function getGlossary() {
      return record?.glossary;
    }

    function setTrackComplete(value) {
      if (!record || record.trackComplete === Boolean(value)) return;
      record.trackComplete = Boolean(value);
      touch();
    }

    function getTranslation(cueId) {
      return cues.get(cueId)?.translatedText || "";
    }

    function getTranslations(ids = []) {
      return ids.map((id) => getTranslation(id));
    }

    function getRecord() {
      return record;
    }

    async function flush() {
      cancelTimer();
      if (!dirty || !record || !storage) return;
      dirty = false;
      const snapshot = record;
      snapshot.updatedAt = now();
      // 連續 flush 排隊，避免兩次寫入同時讀寫 index 造成後寫的蓋掉前寫的。
      pending = pending.then(async () => {
        // 術語表可能被 popup 在這幾秒內改過，寫回前先跟儲存端合併一次。
        const storedRecord = await readRecord(storage, snapshot.videoId);
        const glossary = preserveUserTerms(storedRecord?.glossary, snapshot.glossary);
        if (glossary) snapshot.glossary = glossary;
        const stored = await storage.get(INDEX_KEY);
        const index = Array.isArray(stored?.[INDEX_KEY]) ? stored[INDEX_KEY] : [];
        const { kept, dropped } = pruneIndex(
          [...index, { videoId: snapshot.videoId, updatedAt: snapshot.updatedAt }],
          maxVideos
        );
        await storage.set({ [storageKey(snapshot.videoId)]: snapshot, [INDEX_KEY]: kept });
        if (dropped.length) await storage.remove(dropped.map((entry) => storageKey(entry.videoId)));
      }).catch((error) => {
        // 寫不進去不該讓字幕翻譯整條斷掉，下一次 touch 會再試。
        dirty = true;
        console.warn("ImmerseFree：字幕翻譯紀錄寫入失敗。", error);
      });
      await pending;
    }

    return {
      open,
      flush,
      recordCues,
      recordTranslation,
      setTrackComplete,
      setGlossary,
      getGlossary,
      getTranslation,
      getTranslations,
      getRecord,
      get videoId() { return record?.videoId ?? ""; }
    };
  }

  const subtitleStoreCore = Object.freeze({
    STORAGE_PREFIX,
    INDEX_KEY,
    MAX_VIDEOS,
    FLUSH_DELAY_MS,
    COMPLETE_TOLERANCE_MS,
    normalizeText,
    normalizeMs,
    toMs,
    toSeconds,
    hashText,
    resolveVideoId,
    storageKey,
    makeCueId,
    normalizeCue,
    emptyRecord,
    mergeCues,
    pruneIndex,
    evaluateTrackCompleteness,
    preserveUserTerms,
    readRecord,
    writeGlossary,
    createStore
  });
  global.ImmerseFreeSubtitleStore = subtitleStoreCore;
  if (typeof module !== "undefined" && module.exports) module.exports = subtitleStoreCore;
})(globalThis);
