(function initializeSubtitleMergeCore(global) {
  // 語意合併器。
  //
  // 0.7.0 之前，字幕是「每 8 個原始 cue 直接送翻」。原始 cue 是播放器為了
  // 排版切出來的，一句話常被切成兩三段（"I think" / "we should leave now."），
  // 模型看到的是半句，翻出來的中文自然接不起來。這個檔在送翻之前先把
  // 屬於同一句的 cue 併成一組，翻譯以「完整句子」為單位；組內每個成員 cue
  // 都拿到同一句譯文，播到任何一段都看得到整句。
  //
  // 純函式，不碰 DOM、不碰 storage。單位一律毫秒（與 subtitle-store-core 一致）。
  const DEFAULTS = Object.freeze({
    // 前後 cue 間隔超過這個值，就當成兩句話（換人講、換場景）。
    maxGapMs: 400,
    // 一組的總時長上限。再長就算語意連著也要切，否則字幕會壓在畫面上不動。
    maxDurationMs: 7000,
    // 合併後的字數上限（字元數）。超過就切，避免一次塞給模型太長的句子。
    maxChars: 160
  });

  // 常見縮寫：結尾的句點不是句尾。沒有這層防護，"Mr." "e.g." 會讓
  // 一句話被硬切成兩句。只收「當句尾出現機率極低」的字，像 "no." "co."
  // 這種同時是常用單字的一律不收，否則會反過來把真正的句尾誤判成縮寫。
  const ABBREVIATIONS = new Set([
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "approx",
    "inc", "ltd", "dept", "fig", "gen", "sgt", "lt", "col", "rev", "hon",
    "mt", "ave", "e.g", "i.e", "a.m", "p.m", "ph.d"
  ]);

  const SENTENCE_END = new Set([".", "!", "?", "。", "！", "？", "…", "‥", "？", "！"]);
  // 結尾的收尾符號要先剝掉再看句尾標點：`He left."` 的句點在引號裡面。
  const CLOSERS = new Set([
    '"', "'", ")", "]", "}", "»", "”", "’", "」", "』", "》", "）", "】", "〕", "〞"
  ]);
  const SOUND_WRAPPERS = [
    ["[", "]"], ["(", ")"], ["（", "）"], ["【", "】"], ["〔", "〕"]
  ];
  const SOUND_MARKS = new Set(["♪", "♫", "＃", "#"]);

  function normalizeText(value) {
    return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  function normalizeMs(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return 0;
    return Math.round(number);
  }

  function isLetter(character) {
    return /[A-Za-z]/.test(String(character ?? ""));
  }

  // 全形（中日韓文字與全形標點）算一個字寬，其餘算半形。換行器也用同一套判斷。
  function isWideCharacter(character) {
    const code = String(character ?? "").codePointAt(0);
    if (!Number.isFinite(code)) return false;
    return (code >= 0x1100 && code <= 0x115f)
      || (code >= 0x2e80 && code <= 0x303e)
      || (code >= 0x3041 && code <= 0x33ff)
      || (code >= 0x3400 && code <= 0x4dbf)
      || (code >= 0x4e00 && code <= 0x9fff)
      || (code >= 0xa000 && code <= 0xa4cf)
      || (code >= 0xac00 && code <= 0xd7a3)
      || (code >= 0xf900 && code <= 0xfaff)
      || (code >= 0xfe30 && code <= 0xfe4f)
      || (code >= 0xff00 && code <= 0xff60)
      || (code >= 0xffe0 && code <= 0xffe6);
  }

  function stripClosers(text) {
    let end = text.length;
    while (end > 0 && CLOSERS.has(text[end - 1])) end -= 1;
    return text.slice(0, end);
  }

  // "U.S." "N.A.T.O." 這種每個字母都帶點的縮寫，最後那個點同樣不是句尾。
  function isInitialism(token) {
    if (!token) return false;
    const parts = token.split(".");
    return parts.length > 0 && parts.every((part) => part.length === 1 && isLetter(part));
  }

  function endsSentence(value) {
    const text = stripClosers(normalizeText(value));
    if (!text) return false;
    const last = text[text.length - 1];
    if (!SENTENCE_END.has(last)) return false;
    if (last !== ".") return true;
    const token = text.slice(0, -1).split(" ").pop() ?? "";
    if (!token) return true;
    const lower = token.toLowerCase();
    if (ABBREVIATIONS.has(lower)) return false;
    return !isInitialism(token);
  }

  // 空字幕與純音效標記（[music]、（笑）、♪）自成一組：它們沒有語意可以接下去，
  // 併進句子只會讓譯文多出一段莫名其妙的字。
  function isSoundCue(value) {
    const text = normalizeText(value);
    if (!text) return true;
    if (SOUND_MARKS.has(text[0]) || SOUND_MARKS.has(text[text.length - 1])) return true;
    for (const [open, close] of SOUND_WRAPPERS) {
      if (text.startsWith(open) && text.endsWith(close)) return true;
    }
    return false;
  }

  // 中文之間直接相連，其餘用空格接。
  function joinText(previous, next) {
    if (!previous) return next;
    if (!next) return previous;
    const left = previous[previous.length - 1];
    const right = next[0];
    if (isWideCharacter(left) || isWideCharacter(right)) return `${previous}${next}`;
    return `${previous} ${next}`;
  }

  function canMerge(group, cue, config) {
    if (group.sound || cue.sound) return false;
    if (cue.startMs - group.endMs > config.maxGapMs) return false;
    if (endsSentence(group.text)) return false;
    if (Math.max(cue.endMs, group.endMs) - group.startMs > config.maxDurationMs) return false;
    return joinText(group.text, cue.text).length <= config.maxChars;
  }

  // 輸入：毫秒制 cue 陣列（{id?, startMs, endMs, text}）。
  // 輸出：[{groupId, startMs, endMs, text, memberCueIds}]，
  // groupId 沿用組內第一個 cue 的 id（呼叫端傳的是 subtitle-store 的 cueId），
  // 沒有 id 時退回穩定的索引字串，讓純測試也跑得動。
  function mergeCues(cues = [], options = {}) {
    const config = { ...DEFAULTS, ...options };
    const groups = [];
    let current;
    (Array.isArray(cues) ? cues : []).forEach((raw, index) => {
      const id = String(raw?.id || raw?.cueId || `cue-${index}`);
      const startMs = normalizeMs(raw?.startMs);
      const cue = {
        id,
        startMs,
        endMs: Math.max(startMs, normalizeMs(raw?.endMs)),
        text: normalizeText(raw?.text ?? raw?.sourceText),
        sound: isSoundCue(raw?.text ?? raw?.sourceText)
      };
      if (current && canMerge(current, cue, config)) {
        current.text = joinText(current.text, cue.text);
        current.endMs = Math.max(current.endMs, cue.endMs);
        current.memberCueIds.push(cue.id);
        return;
      }
      current = {
        groupId: cue.id,
        startMs: cue.startMs,
        endMs: cue.endMs,
        text: cue.text,
        sound: cue.sound,
        memberCueIds: [cue.id]
      };
      groups.push(current);
    });
    return groups.map((group) => ({
      groupId: group.groupId,
      startMs: group.startMs,
      endMs: group.endMs,
      text: group.text,
      memberCueIds: group.memberCueIds.slice()
    }));
  }

  // 呼叫端常常需要「第 n 個 cue 屬於哪一組」。回傳與 cue 陣列等長的組索引。
  function buildGroupIndex(cues = [], groups = []) {
    const byId = new Map();
    groups.forEach((group, groupIndex) => {
      for (const id of group.memberCueIds) byId.set(id, groupIndex);
    });
    return (Array.isArray(cues) ? cues : []).map((cue, index) => {
      const id = String(cue?.id || cue?.cueId || `cue-${index}`);
      return byId.has(id) ? byId.get(id) : -1;
    });
  }

  const subtitleMergeCore = Object.freeze({
    DEFAULTS,
    ABBREVIATIONS,
    normalizeText,
    normalizeMs,
    isWideCharacter,
    endsSentence,
    isSoundCue,
    joinText,
    mergeCues,
    buildGroupIndex
  });
  global.ImmerseFreeSubtitleMerge = subtitleMergeCore;
  if (typeof module !== "undefined" && module.exports) module.exports = subtitleMergeCore;
})(globalThis);
