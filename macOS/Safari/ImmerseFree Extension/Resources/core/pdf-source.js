export function extractPdfFileId(value) {
  try {
    const url = new URL(value);
    if (!/(^|\.)drive\.google\.com$/i.test(url.hostname)) return "";
    const pathMatch = url.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    return pathMatch?.[1] || url.searchParams.get("id") || "";
  } catch {
    return "";
  }
}

export function normalizePdfSource(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "chrome-extension:" && url.searchParams.has("file")) {
      return url.searchParams.get("file") || "";
    }
    const driveId = extractPdfFileId(url.href);
    if (driveId) return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(driveId)}&export=download&confirm=t`;
    if (/\.pdf(?:$|[?#])/i.test(url.href) || url.protocol === "file:") return url.href;
  } catch {}
  return "";
}

export function pdfFetchCandidates(value) {
  const driveId = extractPdfFileId(value);
  if (!driveId) return [value].filter(Boolean);
  return [
    `https://drive.usercontent.google.com/download?id=${encodeURIComponent(driveId)}&export=download&confirm=t`,
    `https://drive.google.com/uc?export=download&id=${encodeURIComponent(driveId)}&confirm=t`
  ];
}
