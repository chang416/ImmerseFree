(function initializeShared(global) {
  const api = global.browser ?? global.chrome;
  const namespace = global.ImmerseFree ?? {};
  global.ImmerseFree = namespace;

  namespace.api = api;
  namespace.sendMessage = async function sendMessage(message) {
    const response = await api.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error ?? "Extension request failed");
    return response;
  };

  // 內容腳本的浮動 UI（進度條、翻譯卡）不能用選項頁那套「掃描整個 DOM 換字」
  // 的做法——那會連使用者正在讀的網頁一起翻。所以這裡改成在寫進畫面之前
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
})(globalThis);
