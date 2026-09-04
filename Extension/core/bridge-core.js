(function initializeBridgeCore(global) {
  // 本機 Bridge（預設 127.0.0.1:27843）沒開時，fetch 會直接 reject 出
  // 「TypeError: Failed to fetch」。那句話對使用者毫無意義：他既不知道有一個
  // 本機服務，也不知道要去啟動它。所有打 Bridge 的地方一律走這裡，
  // 讓「連不上」變成一句看得懂、而且說得出下一步的訊息。
  //
  // 只寫一份的理由：背景頁、provider、PDF 閱讀器各有一條打 Bridge 的路徑，
  // 只在其中一條加防護，另外兩條照樣把原生 TypeError 丟到畫面上。
  const OFFLINE_MESSAGES = {
    "zh-Hant": "本機 Bridge 服務未啟動，請先執行 ImmerseFree 的 Start／安裝腳本啟動它，再重試一次。",
    en: "The local ImmerseFree Bridge service is not running. Run the Start / install script to launch it, then try again."
  };

  function bridgeUiLanguage(settings) {
    const setting = settings && typeof settings === "object" ? settings.uiLanguage : settings;
    const resolve = global.ImmerseFreeI18nCore?.resolveLanguage;
    if (typeof resolve === "function") return resolve(setting ?? "auto", global.navigator?.language ?? "");
    return setting === "en" ? "en" : "zh-Hant";
  }

  function bridgeOfflineMessage(settings) {
    return OFFLINE_MESSAGES[bridgeUiLanguage(settings)] ?? OFFLINE_MESSAGES.en;
  }

  // Bridge 側對每一次 CLI 呼叫最多花「總逾時 × (1 + 重試次數)」的時間；
  // 這裡的上限只是最後一道保險，避免 Bridge 自己卡死時擴充功能無限期等下去
  // （fetch 沒有預設逾時，會一直轉圈，使用者只看得到「翻譯不會出來」）。
  const BRIDGE_REQUEST_TIMEOUT_MS = 420_000;

  const TIMEOUT_MESSAGES = {
    "zh-Hant": "本機 Bridge 服務超過 7 分鐘沒有回應，已中止這次請求。請確認它還活著（重跑 Start 腳本），或到選項頁改用其他翻譯引擎。",
    en: "The local ImmerseFree Bridge did not respond within 7 minutes, so this request was aborted. Restart it with the Start script, or switch engines in the options page."
  };

  // fetch 只在「請求根本送不出去」時 reject（連線被拒、DNS、CORS 前置失敗），
  // HTTP 4xx/5xx 是正常 resolve。所以只有 reject 這條路要換成 Bridge 未啟動的
  // 說明；HTTP 錯誤仍由呼叫端照原本的方式處理。
  async function bridgeFetch(url, options, settings) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    // 呼叫端自己帶 signal 時以它為準，不要把它蓋掉。
    const useOwnSignal = controller && !options?.signal;
    const timer = useOwnSignal
      ? setTimeout(() => controller.abort(), BRIDGE_REQUEST_TIMEOUT_MS)
      : null;
    try {
      return await fetch(url, useOwnSignal ? { ...options, signal: controller.signal } : options);
    } catch (error) {
      const message = String(error?.message ?? "");
      // 逾時中止與「服務沒開」是兩件事，訊息不能共用：前者要去看 Bridge
      // 是不是卡住，後者要去啟動它。混成同一句會把人指向錯的地方。
      if (error?.name === "AbortError" || error?.name === "TimeoutError") {
        if (!useOwnSignal) throw error;
        throw new Error(TIMEOUT_MESSAGES[bridgeUiLanguage(settings)] ?? TIMEOUT_MESSAGES.en);
      }
      const unreachable = error instanceof TypeError
        || /failed to fetch|networkerror|load failed|connection refused/i.test(message);
      if (unreachable) throw new Error(bridgeOfflineMessage(settings));
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const bridgeCore = Object.freeze({ bridgeFetch, bridgeOfflineMessage, BRIDGE_REQUEST_TIMEOUT_MS });
  global.ImmerseFreeBridgeCore = bridgeCore;
  if (typeof module !== "undefined" && module.exports) module.exports = bridgeCore;
})(globalThis);
