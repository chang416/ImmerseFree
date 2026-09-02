(function initializePageTranslationUI(global) {
  // 這些訊息會被寫進內容腳本的浮動進度條，那裡沒有 DOM 掃描式翻譯，
  // 所以在產生訊息時就查表。popup 載入這個檔時 ImmerseFree 命名空間不存在，
  // 就原樣回傳，交給 popup 自己的 i18n 掃描處理。
  function t(text) {
    return global.ImmerseFree?.t?.(text) ?? text;
  }

  const UNSUPPORTED_MESSAGE = "請先切換到要翻譯的一般網頁";

  function pageTranslationAvailability(value) {
    try {
      const url = new URL(String(value ?? ""));
      const available = ["http:", "https:", "file:"].includes(url.protocol);
      return available
        ? { available: true, message: "" }
        : { available: false, message: t(UNSUPPORTED_MESSAGE) };
    } catch {
      return { available: false, message: t(UNSUPPORTED_MESSAGE) };
    }
  }

  function createTranslationProgress(totalValue) {
    const total = Math.max(0, Math.floor(Number(totalValue) || 0));
    let completed = 0;
    let state = total ? "running" : "complete";
    let error = "";

    return Object.freeze({
      complete(amount = 1) {
        if (state !== "running") return this.snapshot();
        completed = Math.min(total, completed + Math.max(0, Math.floor(Number(amount) || 0)));
        if (completed >= total) state = "complete";
        return this.snapshot();
      },
      fail(message) {
        state = "error";
        error = String(message || t("翻譯失敗"));
        return this.snapshot();
      },
      snapshot() {
        const percent = total ? Math.round((completed / total) * 100) : 100;
        const message = state === "error"
          ? error
          : state === "complete"
            ? t(`翻譯完成，共 ${total} 段`)
            : completed
              ? t(`正在翻譯 ${completed} / ${total} 段`)
              : t(`正在準備 0 / ${total} 段`);
        return { state, completed, total, percent, message };
      }
    });
  }

  const pageTranslationUI = Object.freeze({
    createTranslationProgress,
    pageTranslationAvailability
  });
  global.ImmerseFreePageTranslationUI = pageTranslationUI;
})(globalThis);
