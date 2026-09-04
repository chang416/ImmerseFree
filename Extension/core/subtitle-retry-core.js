(function initializeSubtitleRetryCore(global) {
  const TRANSIENT_RETRY_MS = 5_000;
  const QUOTA_RETRY_MS = 60_000;

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

  global.ImmerseFreeSubtitleRetryCore = Object.freeze({
    canRetryCue,
    cooldownMessage,
    createRetryEntry,
    isCoolingDown,
    retryDelayFor
  });
})(globalThis);
