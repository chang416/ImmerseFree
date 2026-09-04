(function initializeSrtCore(global) {
  // SRT 匯出。純函式，輸入是 subtitle-store-core 的 cue 陣列（毫秒制），
  // 輸出是可以直接餵給播放器的 SRT 字串。
  //
  // 時間取 sentenceGroup 的起訖：本階段一個 cue 就是一組，所以等同 cue 起訖；
  // 2B 把數個 cue 併成一句之後，這裡不用改就會自動用整句的起訖時間。
  const MODES = Object.freeze(["zh", "source", "bilingual"]);
  const LINE_BREAK = "\r\n";
  // Windows 與 macOS 都不接受的檔名字元，外加控制字元。
  const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

  function pad(value, length) {
    return String(value).padStart(length, "0");
  }

  function formatTimecode(milliseconds) {
    const total = Math.max(0, Math.round(Number(milliseconds) || 0));
    const hours = Math.floor(total / 3600000);
    const minutes = Math.floor(total / 60000) % 60;
    const seconds = Math.floor(total / 1000) % 60;
    return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(total % 1000, 3)}`;
  }

  function cleanLine(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function normalizeMode(value) {
    return MODES.includes(value) ? value : "zh";
  }

  // 接起同一組的文字。dropRepeats 為真時收斂「連續重複的同一段字」——
  // 語意合併後每個成員都存著整句譯文，不收斂就會一句印很多遍。
  function joinParts(parts = [], dropRepeats = false) {
    const kept = [];
    for (const part of parts) {
      if (!part) continue;
      if (dropRepeats && kept[kept.length - 1] === part) continue;
      kept.push(part);
    }
    return kept.join(" ");
  }

  // 同一個 sentenceGroupId 的 cue 併成一個字幕塊：起訖取整組的最早與最晚，
  // 文字照時間順序接起來。
  function groupCues(cues = []) {
    const groups = new Map();
    for (const cue of cues) {
      if (!cue) continue;
      const key = cue.sentenceGroupId || cue.id || `${cue.startMs}-${cue.endMs}`;
      const startMs = Math.max(0, Math.round(Number(cue.startMs) || 0));
      const endMs = Math.max(startMs, Math.round(Number(cue.endMs) || 0));
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          id: key,
          startMs,
          endMs,
          sourceParts: [cleanLine(cue.sourceText)],
          translatedParts: [cleanLine(cue.translatedText)]
        });
        continue;
      }
      existing.startMs = Math.min(existing.startMs, startMs);
      existing.endMs = Math.max(existing.endMs, endMs);
      existing.sourceParts.push(cleanLine(cue.sourceText));
      existing.translatedParts.push(cleanLine(cue.translatedText));
    }
    return [...groups.values()]
      .map((group) => ({
        id: group.id,
        startMs: group.startMs,
        endMs: group.endMs,
        sourceText: joinParts(group.sourceParts),
        // 2B 起譯文是「整句」，同一組的每個成員 cue 都存著同一份完整譯文
        // （播到任何一段都要看得到整句）。這裡若照原文那樣直接接起來，
        // 匯出的 SRT 就會把同一句印三遍——所以譯文這一側要收斂連續重複。
        translatedText: joinParts(group.translatedParts, true)
      }))
      .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  }

  // 沒翻到的 cue 在中文與雙語模式一律跳過。輸出空白字幕塊只會讓播放器
  // 在畫面上閃一片空白，比少一句更難看出哪裡出問題。
  function blockText(group, mode) {
    if (mode === "source") return group.sourceText;
    if (!group.translatedText) return "";
    if (mode === "zh") return group.translatedText;
    return group.sourceText
      ? `${group.sourceText}${LINE_BREAK}${group.translatedText}`
      : group.translatedText;
  }

  function buildSrt(cues = [], mode = "zh") {
    const resolved = normalizeMode(mode);
    let index = 0;
    let output = "";
    for (const group of groupCues(cues)) {
      const text = blockText(group, resolved);
      if (!text) continue;
      index += 1;
      output += `${index}${LINE_BREAK}`;
      output += `${formatTimecode(group.startMs)} --> ${formatTimecode(group.endMs)}${LINE_BREAK}`;
      output += `${text}${LINE_BREAK}${LINE_BREAK}`;
    }
    return output;
  }

  function countBlocks(cues = [], mode = "zh") {
    const resolved = normalizeMode(mode);
    return groupCues(cues).filter((group) => blockText(group, resolved)).length;
  }

  // 檔名主幹的清洗規則。**所有匯出（SRT／docx／PDF）都必須共用這一支**：
  // 各自寫一套的結果是同一個標題在三個按鈕下產出三種檔名，而其中一種
  // 在 Windows 上下載失敗又看不出原因（W4-1 驗收條件）。
  function sanitizeFileBase(title, fallback = "subtitle") {
    return cleanLine(title)
      .replace(ILLEGAL_FILENAME_CHARS, " ")
      .replace(/\s+/g, " ")
      .replace(/\.+$/, "")
      .trim()
      .slice(0, 80)
      .trim()
      || cleanLine(fallback).replace(ILLEGAL_FILENAME_CHARS, "_")
      || "subtitle";
  }

  // 檔名：<影片標題或 ID>.<模式>.srt。非法字元一律換掉，
  // 否則使用者會拿到一個下載失敗、又看不出原因的按鈕。
  function buildFileName(title, mode, fallback = "subtitle") {
    return `${sanitizeFileBase(title, fallback)}.${normalizeMode(mode)}.srt`;
  }

  const srtCore = Object.freeze({
    MODES,
    LINE_BREAK,
    formatTimecode,
    groupCues,
    buildSrt,
    countBlocks,
    buildFileName,
    sanitizeFileBase,
    normalizeMode
  });
  global.ImmerseFreeSrtCore = srtCore;
  if (typeof module !== "undefined" && module.exports) module.exports = srtCore;
})(globalThis);
