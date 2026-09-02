export function hasUsablePdfText(lines) {
  const items = (lines || []).map((line) => String(line?.text ?? "").trim()).filter(Boolean);
  const text = items.join(" ");
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const digits = text.match(/\p{N}/gu)?.length ?? 0;
  const words = text.match(/\p{L}{2,}/gu)?.length ?? 0;
  const visible = text.replace(/\s/g, "").length;
  if (letters >= 20 && words >= 3 && letters / Math.max(visible, 1) >= 0.35) return true;
  return items.length >= 10 && letters + digits >= 40 && words >= 2;
}

export function buildPdfBlocks(inputLines) {
  const lines = (inputLines || [])
    .map(normalizeLine)
    .filter((line) => line.text)
    .sort((a, b) => a.top - b.top || a.left - b.left);
  if (!lines.length) return [];
  const medianHeight = median(lines.map((line) => line.height).filter((value) => value > 0)) || 0.014;
  const rows = combineRowFragments(lines, medianHeight);
  const blocks = [];
  for (const region of ["header", "main", "sidebar", "footer"]) {
    for (const row of rows.filter((item) => item.region === region)) {
      const previous = blocks.at(-1)?.region === region ? blocks.at(-1) : null;
      const heading = looksLikeHeading(row, medianHeight);
      const gap = previous ? row.top - (previous.bottom ?? previous.top + previous.height) : Infinity;
      const canJoin = previous
        && !previous.heading
        && !heading
        && gap <= Math.max(0.009, medianHeight * 0.72)
        && Math.abs(previous.left - row.left) <= 0.09;
      if (canJoin) {
        previous.text = joinPdfText(previous.text, row.text);
        previous.bottom = Math.max(previous.bottom, row.top + row.height);
        previous.width = Math.max(previous.width, row.left + row.width - previous.left);
        previous.height = previous.bottom - previous.top;
        previous.lineCount += 1;
        continue;
      }
      blocks.push({
        id: `pdf-block-${blocks.length + 1}`,
        text: row.text,
        region: row.region,
        kind: blockKind(row, heading, medianHeight),
        heading,
        left: row.left,
        top: row.top,
        width: row.width,
        height: row.height,
        bottom: row.top + row.height,
        lineCount: 1
      });
    }
  }
  return blocks;
}

export function isTranslatablePdfBlock(block) {
  const text = String(block?.text ?? "").trim();
  if (!text) return false;
  if (/^\d{1,2}\s+\p{L}{3,9}\s+\d{4}\b/u.test(text)) return false;
  const withoutContacts = text
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, " ")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, " ");
  const words = withoutContacts.match(/\p{L}{2,}/gu) ?? [];
  return words.length >= 1 && words.join("").length >= 3;
}

function normalizeLine(line) {
  return {
    text: String(line?.text ?? "").replace(/\s+/g, " ").trim(),
    left: clamp(Number(line?.left ?? line?.x ?? 0), 0, 1),
    top: clamp(Number(line?.top ?? 0), 0, 1),
    width: clamp(Number(line?.width ?? 0), 0, 1),
    height: clamp(Number(line?.height ?? 0.014), 0.002, 0.2),
    confidence: Number(line?.confidence ?? 1)
  };
}

function combineRowFragments(lines, medianHeight) {
  const byRegion = new Map();
  for (const line of lines) {
    const region = lineRegion(line);
    const list = byRegion.get(region) ?? [];
    list.push({ ...line, region });
    byRegion.set(region, list);
  }
  const rows = [];
  for (const list of byRegion.values()) {
    list.sort((a, b) => a.top - b.top || a.left - b.left);
    for (const line of list) {
      const previous = rows.at(-1);
      const sameRow = previous
        && previous.region === line.region
        && Math.abs(previous.top - line.top) <= Math.max(0.004, medianHeight * 0.38)
        && line.left >= previous.left
        && line.left - (previous.left + previous.width) <= 0.12;
      if (sameRow) {
        previous.text += ` | ${line.text}`;
        previous.width = Math.max(previous.width, line.left + line.width - previous.left);
        previous.height = Math.max(previous.height, line.height);
      } else {
        rows.push({ ...line });
      }
    }
  }
  return rows.sort((a, b) => a.top - b.top || regionOrder(a.region) - regionOrder(b.region) || a.left - b.left);
}

function lineRegion(line) {
  if (line.top < 0.20) return "header";
  if (line.top > 0.87) return "footer";
  if (line.left >= 0.62) return "sidebar";
  return "main";
}

function regionOrder(region) {
  return { header:0, main:1, sidebar:2, footer:3 }[region] ?? 4;
}

function looksLikeHeading(line, medianHeight) {
  const letters = line.text.match(/\p{L}/gu) ?? [];
  const uppercase = line.text.match(/\p{Lu}/gu) ?? [];
  const uppercaseRatio = uppercase.length / Math.max(letters.length, 1);
  return line.height >= medianHeight * 1.45
    || (line.text.length <= 70 && uppercaseRatio >= 0.72);
}

function blockKind(line, heading, medianHeight) {
  if (line.text.includes(" | ") && (line.text.match(/\d/g)?.length ?? 0) >= 3) return "table";
  if (heading && line.height >= medianHeight * 1.7) return "title";
  if (heading) return "heading";
  return "paragraph";
}

function joinPdfText(current, next) {
  if (/-$/.test(current) && /^\p{Ll}/u.test(next)) return `${current.slice(0, -1)}${next}`;
  return `${current} ${next}`;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
