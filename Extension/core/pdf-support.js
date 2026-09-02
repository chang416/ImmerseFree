export function scannedPdfMessage() {
  return "這是掃描型或圖片型 PDF，而且本機 OCR 也無法辨識出可翻譯文字，因此目前無法翻譯。可能是頁面解析度過低、文字過小，或檔案格式不支援。";
}

export function pdfOpenErrorMessage(error) {
  const name = String(error?.name ?? "");
  const message = String(error?.message ?? "");
  if (name === "PasswordException" || /password|encrypted|密碼|加密/i.test(message)) {
    return "這份 PDF 已加密或需要密碼，目前無法讀取文字。請先解除密碼保護後再試。";
  }
  if (name === "InvalidPDFException" || /invalid pdf|damaged|corrupt/i.test(message)) {
    return "這個檔案不是有效的 PDF，或 PDF 已損壞，因此無法翻譯。";
  }
  if (/伺服器沒有回傳 PDF|不是 PDF/i.test(message)) {
    return "這個連結沒有回傳可讀取的 PDF 檔案，因此無法翻譯。請先下載真正的 PDF 後再開啟。";
  }
  return message || "無法讀取這份 PDF。請確認檔案完整且沒有加密。";
}

export function pdfTranslationErrorMessage(error) {
  const message = String(error?.message ?? error ?? "翻譯失敗");
  if (/模型回傳格式異常|JSON Parse error|Unexpected (?:identifier|token)/i.test(message)) {
    return "模型回傳格式異常，已自動重試但仍未成功。這不是 PDF 檔案格式問題，也不代表額度用完；請再試一次或切換模型。";
  }
  if (/429|quota|RESOURCE_EXHAUSTED|rate.?limit|額度|速率限制/i.test(message)) {
    return "翻譯模型的免費額度或速率限制已達上限。已完成的內容會保留，請稍後重試或切換模型／金鑰。";
  }
  return message;
}
