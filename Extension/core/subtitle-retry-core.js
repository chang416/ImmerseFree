(function initializeSubtitleRetryCore(global) {
  const TRANSIENT_RETRY_MS = 5_000;
  const QUOTA_RETRY_MS = 60_000;
  const DEFAULT_TIMEOUT_MS = 45_000;

  function createRetryEntry(error, now = Date.now()) {
    const quota = isQuotaError(error);
    return {
      state: "failed",
      retryAt: now + retryDelayFor(error),
      kind: quota ? "quota" : "temporary",
      message: String(error?.message ?? "字幕翻譯失敗")
    };
  }

  function canRetryCue(value, now = Date.now()) {
    return value === undefined || (isRetryEntry(value) && value.retryAt <= now);
  }

  function isCoolingDown(value, now = Date.now()) {
    return isRetryEntry(value) && value.retryAt > now;
  }

  function retryDelayFor(error) {
    return isQuotaError(error)
      ? QUOTA_RETRY_MS
      : TRANSIENT_RETRY_MS;
  }

  function cooldownMessage(value, now = Date.now()) {
    if (!isRetryEntry(value)) return "字幕翻譯暫時無法使用";
    const seconds = Math.max(1, Math.ceil((value.retryAt - now) / 1_000));
    return value.kind === "quota"
      ? `免費額度冷卻中，約 ${seconds} 秒後自動重試`
      : `字幕服務暫時忙碌，約 ${seconds} 秒後自動重試`;
  }

  function isQuotaError(error) {
    return /quota|rate.?limit|resource exhausted|cooling|冷卻|額度|速率限制/i.test(String(error?.message ?? error ?? ""));
  }

  function isRetryEntry(value) {
    return Boolean(value && typeof value === "object" && value.state === "failed" && Number.isFinite(value.retryAt));
  }

  // 所有會等外部服務的字幕流程都必須有明確上限。Promise 本身沒有取消能力，
  // 但 race 仍能讓呼叫端在期限到時離開 loading 狀態，避免 UI 永遠等不到結果。
  function withTimeout(task, timeoutMs = DEFAULT_TIMEOUT_MS, label = "字幕服務") {
    const limit = Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
    let timer;
    const operation = typeof task === "function" ? Promise.resolve().then(task) : Promise.resolve(task);
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`${label}逾時（${Math.ceil(limit / 1000)} 秒）`);
        error.code = "TIMEOUT";
        reject(error);
      }, limit);
    });
    return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
  }

  global.ImmerseFreeSubtitleRetryCore = Object.freeze({
    canRetryCue,
    cooldownMessage,
    createRetryEntry,
    isCoolingDown,
    retryDelayFor,
    withTimeout
  });
})(globalThis);
