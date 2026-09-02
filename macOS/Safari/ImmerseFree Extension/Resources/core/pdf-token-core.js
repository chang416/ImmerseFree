const PDF_NUMBER_PATTERN = /(?:[A-Z]{1,5}\$)?[<>~≈]?\d[\d,]*(?:\.\d+)?(?:\.[A-Z]{1,5})?(?:(?:%|x|bps|pp|K|M|B|T|E|A))?/g;

export function protectPdfNumbers(text) {
  const tokens = [];
  const maskedText = String(text ?? "").replace(PDF_NUMBER_PATTERN,(value) => {
    const placeholder = `⟦IMMERSEFREE-${letters(tokens.length)}⟧`;
    tokens.push({ placeholder, value });
    return placeholder;
  });
  return { maskedText, tokens };
}

export function restorePdfNumbers(translatedText,tokens = []) {
  let text = String(translatedText ?? "");
  const missing = [];
  for (const token of tokens) {
    if (text.includes(token.placeholder)) {
      text = text.replaceAll(token.placeholder,token.value);
    } else {
      missing.push(token.value);
    }
  }
  if (missing.length) text = `${text}（保留數值：${missing.join("、")}）`;
  return { text, missing };
}

export function pdfNumberSignature(text) {
  return (String(text ?? "").match(PDF_NUMBER_PATTERN) ?? []).map(normalizeNumberToken).sort();
}

export function hasSamePdfNumbers(source,translated) {
  return JSON.stringify(pdfNumberSignature(source)) === JSON.stringify(pdfNumberSignature(translated));
}

function normalizeNumberToken(value) {
  return String(value).replace(/\s+/g,"").toUpperCase();
}

function letters(index) {
  let value = Number(index) + 1;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + value % 26) + output;
    value = Math.floor(value / 26);
  }
  return output;
}
