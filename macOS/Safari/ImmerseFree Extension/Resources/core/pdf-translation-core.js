export function buildPdfTranslationUnits(layers = [], maxChars = 1800) {
  const limit = Math.max(100, Math.min(1990, Number(maxChars) || 1800));
  const units = [];
  for (const layer of layers) {
    const sourceText = String(layer?.sourceText ?? "");
    const parts = splitPreservingText(sourceText, limit);
    parts.forEach((part, partIndex) => {
      units.push({
        layerId: String(layer?.id ?? ""),
        partIndex,
        partCount: parts.length,
        sourceText: part
      });
    });
  }
  return units;
}

export function mergePdfTranslationUnits(units = [], translations = []) {
  if (units.length !== translations.length) throw new Error("PDF 翻譯分段數量不一致");
  const grouped = new Map();
  units.forEach((unit, index) => {
    const list = grouped.get(unit.layerId) ?? [];
    list[unit.partIndex] = String(translations[index] ?? "");
    grouped.set(unit.layerId, list);
  });
  return new Map([...grouped].map(([layerId, parts]) => [layerId, parts.join("")]));
}

export async function runPdfPageSequence(pageCount, translatePage, options = {}) {
  const completed = [];
  const failures = [];
  let cancelled = false;
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    if (options.isCancelled?.()) {
      cancelled = true;
      break;
    }
    options.onPageStart?.(pageNumber, pageCount);
    try {
      await translatePage(pageNumber);
      completed.push(pageNumber);
      options.onPageComplete?.(pageNumber, pageCount);
    } catch (error) {
      failures.push({ pageNumber, error });
      options.onPageFailure?.(pageNumber, error, pageCount);
    }
  }
  return { completed, failures, cancelled };
}

export async function selectPdfTextSource({
  nativeLines = [],
  isUsable = defaultIsUsable,
  readOcr,
  readVision,
  onStatus = () => {}
} = {}) {
  if (isUsable(nativeLines)) return { source: "native", lines: nativeLines };

  let lastError;
  onStatus("ocr");
  if (readOcr) {
    try {
      const ocrLines = await readOcr();
      if (isUsable(ocrLines)) return { source: "ocr", lines: ocrLines };
      lastError = new Error("本機 OCR 沒有辨識出可翻譯文字");
    } catch (error) {
      lastError = error;
    }
  }

  if (readVision) {
    onStatus("vision-pending");
    try {
      const visionLines = await readVision();
      if (isUsable(visionLines)) {
        onStatus("vision");
        return { source: "vision", lines: visionLines };
      }
      lastError = new Error("視覺模型沒有辨識出可翻譯文字");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("PDF 沒有可翻譯文字");
}

function splitPreservingText(text, maxChars) {
  if (!text) return [];
  const parts = [];
  let start = 0;
  while (start < text.length) {
    const hardEnd = Math.min(text.length, start + maxChars);
    let end = hardEnd;
    if (hardEnd < text.length) {
      const earliestPreferred = start + Math.floor(maxChars * 0.55);
      for (let index = hardEnd; index > earliestPreferred; index -= 1) {
        if (/\s|[.!?。！？；;：:]/u.test(text[index - 1])) {
          end = index;
          break;
        }
      }
    }
    if (end <= start) end = hardEnd;
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}

function defaultIsUsable(lines) {
  return Array.isArray(lines) && lines.some((line) => String(line?.text ?? "").trim().length > 1);
}
