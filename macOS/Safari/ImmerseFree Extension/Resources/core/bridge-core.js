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

  // fetch 只在「請求根本送不出去」時 reject（連線被拒、DNS、CORS 前置失敗），
  // HTTP 4xx/5xx 是正常 resolve。所以只有 reject 這條路要換成 Bridge 未啟動的
  // 說明；HTTP 錯誤仍由呼叫端照原本的方式處理。
  async function bridgeFetch(url, options, settings) {
    try {
      return await fetch(url, options);
    } catch (error) {
      const message = String(error?.message ?? "");
      const unreachable = error instanceof TypeError
        || /failed to fetch|networkerror|load failed|connection refused/i.test(message);
      if (unreachable) throw new Error(bridgeOfflineMessage(settings));
      throw error;
    }
  }

  const bridgeCore = Object.freeze({ bridgeFetch, bridgeOfflineMessage });
  global.ImmerseFreeBridgeCore = bridgeCore;
  if (typeof module !== "undefined" && module.exports) module.exports = bridgeCore;
})(globalThis);
