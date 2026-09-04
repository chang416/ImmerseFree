(function initializeShared(global) {
  const api = global.browser ?? global.chrome;
  const namespace = global.ImmerseFree ?? {};
  global.ImmerseFree = namespace;

  namespace.api = api;
  namespace.sendMessage = async function sendMessage(message) {
    const response = await api.runtime.sendMessage(message);
    // 背景頁回的 code 一定要接上來。少了它，錯誤走到 popup 時就只剩一句
    // 字串，查不了註冊表，「同一個 code 同一句話」的保證在這一層就斷掉。
    if (!response?.ok) throw Object.assign(new Error(response?.error ?? "Extension request failed"), { code: response?.code ?? "" });
    return response;
  };

  // 內容腳本的浮動 UI（進度條、翻譯卡、字幕列）不能用選項頁那套「掃描整個 DOM
  // 換字」的做法——那會連使用者正在讀的網頁一起翻。所以這裡改成在寫進畫面之前
  // 逐字串查表，字典仍然是同一份 i18n-core。
  let uiLanguageSetting = "auto";

  namespace.setUiLanguage = function setUiLanguage(value) {
    uiLanguageSetting = value ?? "auto";
  };

  namespace.t = function translateUiText(text) {
    const core = global.ImmerseFreeI18nCore;
    if (!core) return text;
    const language = core.resolveLanguage(uiLanguageSetting, global.navigator?.language ?? "");
    return core.translate(text, language) ?? text;
  };

  namespace.translate = async function translate(segments, context = {}) {
    const response = await namespace.sendMessage({ type: "IMMERSEFREE_TRANSLATE", segments, context });
    return response.translations;
  };

  // 單字查詢（W3-3）。回的是 `{ mode: "dictionary", entry }` 或
  // `{ mode: "translation", translations }`——**降級由背景頁決定並且已經做完**，
  // 呼叫端只要看 mode 決定畫哪一種卡。
  //
  // 為什麼不讓內容腳本自己判斷降級：詞典 prompt 與解析住在 provider-core，
  // 而 provider-core 不在內容腳本清單裡（57KB，全世界每一個頁面都載入太浪費）。
  // 降級若做在這一側，還要多一趟訊息往返才能改打翻譯，service worker 休眠時
  // 那趟往返就是好幾秒——使用者會看到卡片先卡住再變成翻譯。
  namespace.lookupWord = async function lookupWord(word, context = {}) {
    return namespace.sendMessage({ type: "IMMERSEFREE_DICTIONARY", word, context });
  };
})(globalThis);
