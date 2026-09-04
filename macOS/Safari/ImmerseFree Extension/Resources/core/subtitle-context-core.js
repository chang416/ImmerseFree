(function initializeSubtitleContextCore(global) {
  // 字幕翻譯的三層上下文。
  //
  // 0.7.0 之前送給模型的 context 是 {mode:"subtitle", title: document.title,
  // previous: 最近 8 條}。document.title 在 YouTube 上是「標題 - YouTube」，
  // 在 Netflix 上根本只有「Netflix」，等於沒有影片資訊；previous 又是逐條原始
  // cue（半句）。這個檔把它拆成三層，各自有明確來源與上限：
  //
  //   影片層：title / channel / description / sourceLang / targetLang
  //           取不到的欄位整個省略，不塞空字串——空字串進 prompt 只會讓模型
  //           以為「這支影片沒有頻道」，比不寫更糟。
  //   術語層：只帶本批原文命中的術語（挑選在 subtitle-glossary-core）。
  //   對話層：最近 6–10 個「已完成語意句」的雙語對（2B 之後翻譯單位就是語意句）。
  //
  // 另外附極短句判定：畫面停留時間撐不住的句子要求模型把譯文壓短，
  // 不另開 API 呼叫，跟著同一批的 prompt 走。

  const MAX_TITLE_CHARS = 240;
  const MAX_CHANNEL_CHARS = 120;
  const MAX_DESCRIPTION_CHARS = 200;
  const MAX_DIALOGUE_CHARS = 600;
  const MAX_COMPACT_ITEMS = 40;
  // 6–10 之間；8 是跟既有 previous 上限一致的值，換算成語意句大約是 30–60 秒對話。
  const DIALOGUE_LIMIT = 8;
  // 每秒字元數。超過就是「唸得比看得快」，譯文照字面翻會來不及讀完。
  const COMPACT_MAX_CPS = 20;
  // 不管字多字少，停留不到這麼久就一律要求精簡。
  const COMPACT_MIN_DURATION_MS = 1200;

  function clean(value, max) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  }

  // 取不到的欄位不會出現在回傳物件裡（不是空字串）。
  function normalizeVideoInfo(value) {
    const source = value && typeof value === "object" ? value : {};
    const info = {};
    const title = clean(source.title, MAX_TITLE_CHARS);
    if (title) info.title = title;
    const channel = clean(source.channel, MAX_CHANNEL_CHARS);
    if (channel) info.channel = channel;
    const description = clean(source.description, MAX_DESCRIPTION_CHARS);
    if (description) info.description = description;
    const sourceLang = clean(source.sourceLang, 20);
    if (sourceLang && sourceLang !== "auto") info.sourceLang = sourceLang;
    const targetLang = clean(source.targetLang, 20);
    if (targetLang) info.targetLang = targetLang;
    return info;
  }

  function normalizeDialogue(list, limit = DIALOGUE_LIMIT) {
    const max = Number.isFinite(limit) ? limit : DIALOGUE_LIMIT;
    return (Array.isArray(list) ? list : [])
      .map((pair) => ({
        source: String(pair?.source ?? "").slice(0, MAX_DIALOGUE_CHARS),
        translation: String(pair?.translation ?? "").slice(0, MAX_DIALOGUE_CHARS)
      }))
      .filter((pair) => pair.source && pair.translation)
      .slice(-max);
  }

  function charactersPerSecond(text, durationMs) {
    const duration = Number(durationMs);
    const length = String(text ?? "").trim().length;
    if (!Number.isFinite(duration) || duration <= 0 || !length) return 0;
    return length / (duration / 1000);
  }

  function needsCompact(group, options = {}) {
    const maxCps = Number.isFinite(options.maxCps) ? options.maxCps : COMPACT_MAX_CPS;
    const minDurationMs = Number.isFinite(options.minDurationMs) ? options.minDurationMs : COMPACT_MIN_DURATION_MS;
    const text = String(group?.text ?? "").trim();
    if (!text) return false;
    const durationMs = Number(group?.endMs) - Number(group?.startMs);
    if (!Number.isFinite(durationMs) || durationMs <= 0) return false;
    if (durationMs < minDurationMs) return true;
    return charactersPerSecond(text, durationMs) > maxCps;
  }

  // 回傳「需要精簡的原文」清單，不是索引。background 會把 segments 再切一次 8
  // 一批（background.js:139 dispatchProvider），索引會整個對不上；用原文比對
  // 才撐得過重新分批與拆批重試。
  function selectCompactTexts(groups, options = {}) {
    const seen = new Set();
    const texts = [];
    for (const group of Array.isArray(groups) ? groups : []) {
      if (!needsCompact(group, options)) continue;
      const text = String(group?.text ?? "").trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      texts.push(text);
    }
    return texts;
  }

  function buildSubtitleContext(input = {}) {
    const video = normalizeVideoInfo(input.video);
    const glossary = (Array.isArray(input.terms) ? input.terms : [])
      .map((term) => ({
        source: clean(term?.source, 80),
        target: clean(term?.target, 80)
      }))
      .filter((term) => term.source && term.target);
    const compact = [];
    const seen = new Set();
    for (const item of Array.isArray(input.compactTexts) ? input.compactTexts : []) {
      const text = String(item ?? "").trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      compact.push(text);
      if (compact.length >= MAX_COMPACT_ITEMS) break;
    }
    return {
      mode: "subtitle",
      // title 留著：background.js:227 的 cacheKey 與其他既有讀取都還看這個欄位。
      title: video.title ?? "",
      video,
      glossary,
      dialogue: normalizeDialogue(input.dialogue, input.dialogueLimit),
      compact
    };
  }

  const contextCore = Object.freeze({
    DIALOGUE_LIMIT,
    COMPACT_MAX_CPS,
    COMPACT_MIN_DURATION_MS,
    MAX_DESCRIPTION_CHARS,
    clean,
    normalizeVideoInfo,
    normalizeDialogue,
    charactersPerSecond,
    needsCompact,
    selectCompactTexts,
    buildSubtitleContext
  });
  global.ImmerseFreeSubtitleContext = contextCore;
  if (typeof module !== "undefined" && module.exports) module.exports = contextCore;
})(globalThis);
