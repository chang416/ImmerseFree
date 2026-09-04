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

  // options.progressive：長頁改成「視窗內優先」翻譯之後，total 是整頁段數，
  // 但當下真正排進隊列的只有看得到的那些。若還是報「x / 全頁段數」，
  // 進度條會停在 3% 不動好幾分鐘，看起來像當掉——實際上該屏早就翻完了。
  // 所以另外記一個 revealed（已進入視野而排進隊列的段數）當分母。
  function createTranslationProgress(totalValue, options = {}) {
    const total = Math.max(0, Math.floor(Number(totalValue) || 0));
    const progressive = Boolean(options?.progressive);
    let completed = 0;
    let revealed = progressive ? 0 : total;
    let state = total ? "running" : "complete";
    let error = "";

    const clamp = (value) => Math.min(total, Math.max(0, Math.floor(Number(value) || 0)));

    return Object.freeze({
      complete(amount = 1) {
        if (state !== "running") return this.snapshot();
        completed = Math.min(total, completed + Math.max(0, Math.floor(Number(amount) || 0)));
        if (completed > revealed) revealed = completed;
        if (completed >= total) state = "complete";
        return this.snapshot();
      },
      // 排程器每次把新的一批段落放進隊列時呼叫，讓分母跟著長。
      reveal(count) {
        if (state !== "running") return this.snapshot();
        revealed = Math.max(revealed, clamp(count));
        return this.snapshot();
      },
      fail(message) {
        state = "error";
        error = String(message || t("翻譯失敗"));
        return this.snapshot();
      },
      snapshot() {
        const scope = progressive ? revealed : total;
        const percent = scope ? Math.round((completed / scope) * 100) : 100;
        const message = state === "error"
          ? error
          : state === "complete"
            ? t(`翻譯完成，共 ${total} 段`)
            : progressive
              ? t(`已翻 ${completed} / 可見 ${revealed} 段`)
              : completed
                ? t(`正在翻譯 ${completed} / ${total} 段`)
                : t(`正在準備 0 / ${total} 段`);
        return { state, completed, total, revealed, scope, percent, message, progressive };
      }
    });
  }

  const pageTranslationUI = Object.freeze({
    createTranslationProgress,
    pageTranslationAvailability
  });
  global.ImmerseFreePageTranslationUI = pageTranslationUI;
})(globalThis);
