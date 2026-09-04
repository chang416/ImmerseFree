(function initializeSubtitleLinebreakCore(global) {
  // 前端換行器。
  //
  // 2B 之後翻譯的單位是「完整句子」，一句中文常常放不進一行，所以換行由前端
  // 自己決定，不再指望模型或播放器。規則照電視字幕的習慣：一行 14–18 個
  // 全形字、最多兩行、優先在標點後斷、行首不放標點、英文單字不從中間切。
  //
  // 純函式，不碰 DOM。真正把行寫進節點的是 renderLines（薄薄一層，
  // youtube 與串流兩條顯示路徑共用，避免同樣的邏輯抄兩份）。
  const DEFAULTS = Object.freeze({
    maxCharsPerLine: 16,
    maxLines: 2,
    // 標點斷行的下限：斷點若讓第一行短到不足這個比例，寧可不斷（不然畫面上
    // 會出現「三個字一行、十四個字一行」這種難看的排版）。
    minLineRatio: 0.45,
    // 顯示層動態算行寬時的夾限，對應中文一行 14–18 字的習慣。
    minCharsPerLine: 14,
    maxCharsPerLineLimit: 18
  });

  // 優先在這些標點之後斷行。
  const BREAK_AFTER = new Set(["，", "。", "！", "？", "；", "：", "、", "…"]);
  // 這些字元不能出現在行首（收尾括號引號也算）。
  const NO_LEAD = new Set([
    "，", "。", "！", "？", "；", "：", "、", "…", "‥", "·",
    ",", ".", "!", "?", ";", ":",
    ")", "]", "}", '"', "'", "»", "”", "’",
    "）", "】", "」", "』", "》", "〕", "〞", "％", "%"
  ]);

  function normalizeText(value) {
    return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

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

  function isWordCharacter(character) {
    return /[A-Za-z0-9]/.test(String(character ?? ""));
  }

  function isWordJoiner(character) {
    return character === "'" || character === "’" || character === "-";
  }

  // 切成「不可再切的單位」：一個英文單字、一個中文字、一個標點、一個空格。
  // 英文單字整顆進來，所以永遠不會從中間被切開。
  function tokenize(text) {
    const units = [];
    let index = 0;
    while (index < text.length) {
      const character = text[index];
      if (character === " ") {
        units.push({ text: " ", width: 0.5, space: true });
        index += 1;
        continue;
      }
      if (isWordCharacter(character)) {
        let end = index + 1;
        while (end < text.length) {
          if (isWordCharacter(text[end])) {
            end += 1;
            continue;
          }
          if (isWordJoiner(text[end]) && end + 1 < text.length && isWordCharacter(text[end + 1])) {
            end += 2;
            continue;
          }
          break;
        }
        const word = text.slice(index, end);
        units.push({ text: word, width: word.length * 0.5 });
        index = end;
        continue;
      }
      units.push({ text: character, width: isWideCharacter(character) ? 1 : 0.5 });
      index += 1;
    }
    return units;
  }

  function widthOf(units) {
    return units.reduce((total, unit) => total + unit.width, 0);
  }

  function unitsToText(units) {
    let start = 0;
    let end = units.length;
    while (start < end && units[start].space) start += 1;
    while (end > start && units[end - 1].space) end -= 1;
    return units.slice(start, end).map((unit) => unit.text).join("");
  }

  function firstVisible(units) {
    return units.find((unit) => !unit.space);
  }

  // 溢出時決定切在哪裡。預設是「現在這行全留、下一個單位換行」，
  // 但若行內有標點，改切在最後一個標點之後——那才是語意上的停頓處。
  function splitLine(units, maxCharsPerLine, minLineRatio) {
    for (let index = units.length - 1; index > 0; index -= 1) {
      if (!BREAK_AFTER.has(units[index].text)) continue;
      const kept = units.slice(0, index + 1);
      if (widthOf(kept) < maxCharsPerLine * minLineRatio) break;
      const carry = units.slice(index + 1);
      const lead = firstVisible(carry);
      // 切完之後行首變成標點就不算好切點，往前再找。
      if (lead && NO_LEAD.has(lead.text)) continue;
      return { kept, carry };
    }
    return { kept: units.slice(), carry: [] };
  }

  function joinLineTexts(previous, next) {
    if (!previous) return next;
    if (!next) return previous;
    const left = previous[previous.length - 1];
    const right = next[0];
    if (isWideCharacter(left) || isWideCharacter(right)) return `${previous}${next}`;
    return `${previous} ${next}`;
  }

  function breakLines(text, options = {}) {
    const maxLines = Math.max(1, Math.round(Number(options.maxLines) || DEFAULTS.maxLines));
    const maxCharsPerLine = Math.max(4, Number(options.maxCharsPerLine) || DEFAULTS.maxCharsPerLine);
    const minLineRatio = Number.isFinite(options.minLineRatio) ? options.minLineRatio : DEFAULTS.minLineRatio;
    const normalized = normalizeText(text);
    if (!normalized) return [];

    const units = tokenize(normalized);
    const lines = [];
    let line = [];
    let width = 0;

    for (const unit of units) {
      if (!line.length && unit.space) continue;
      const exceeds = line.length > 0 && width + unit.width > maxCharsPerLine;
      // 行首不得是標點：寧可讓這一行多出半個字寬，也不要把逗號丟到下一行開頭。
      if (exceeds && !NO_LEAD.has(unit.text)) {
        const { kept, carry } = splitLine(line, maxCharsPerLine, minLineRatio);
        lines.push(kept);
        line = carry;
        width = widthOf(carry);
        if (!line.length && unit.space) continue;
      }
      line.push(unit);
      width += unit.width;
    }
    if (line.length) lines.push(line);

    const rendered = lines.map(unitsToText).filter(Boolean);
    if (rendered.length <= maxLines) return rendered;
    // 裝不下就把剩下的全部倒進最後一行，交給顯示層既有的字級/截斷邏輯處理。
    // 換行器只負責切行，不負責縮小或吃掉內容。
    const head = rendered.slice(0, maxLines - 1);
    const tail = rendered.slice(maxLines - 1).reduce(joinLineTexts, "");
    return [...head, tail];
  }

  // 顯示層依播放器寬度與字級算出一行放得下幾個全形字，夾在 14–18 之間。
  function resolveCharsPerLine(availableWidthPx, fontSizePx, options = {}) {
    const width = Number(availableWidthPx);
    const fontSize = Number(fontSizePx);
    const min = Number(options.minCharsPerLine) || DEFAULTS.minCharsPerLine;
    const max = Number(options.maxCharsPerLineLimit) || DEFAULTS.maxCharsPerLineLimit;
    if (!Number.isFinite(width) || !Number.isFinite(fontSize) || width <= 0 || fontSize <= 0) {
      return DEFAULTS.maxCharsPerLine;
    }
    return Math.max(min, Math.min(max, Math.floor(width / fontSize)));
  }

  // 把切好的行寫進節點。每行一個 block span，行與行之間不靠 <br>，
  // 這樣行高與背景在 YouTube 與串流兩邊都一致。
  function renderLines(node, text, options = {}) {
    if (!node) return [];
    const lines = breakLines(text, options);
    const document = node.ownerDocument ?? globalThis.document;
    while (node.firstChild) node.removeChild(node.firstChild);
    if (!lines.length) return lines;
    for (const line of lines) {
      const span = document.createElement("span");
      span.className = "immersefree-subtitle-line";
      span.textContent = line;
      node.append(span);
    }
    return lines;
  }

  const subtitleLinebreakCore = Object.freeze({
    DEFAULTS,
    BREAK_AFTER,
    NO_LEAD,
    normalizeText,
    isWideCharacter,
    tokenize,
    breakLines,
    resolveCharsPerLine,
    renderLines
  });
  global.ImmerseFreeSubtitleLinebreak = subtitleLinebreakCore;
  if (typeof module !== "undefined" && module.exports) module.exports = subtitleLinebreakCore;
})(globalThis);
