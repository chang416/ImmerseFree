(function initializeSettingsCore(global) {
  const DEFAULT_SETTINGS = Object.freeze({
    provider: "antigravity",
    // 介面語言。auto 跟著瀏覽器走，這樣開源之後其他國家的人裝上就是英文。
    uiLanguage: "auto",
    sourceLanguage: "auto",
    targetLanguage: "zh-Hant",
    translationStyle: "natural",
    customPrompt: "",
    pageTranslationEnabled: true,
    selectionTranslationEnabled: true,
    hoverTranslationEnabled: false,
    inputTranslationEnabled: true,
    opencodeApiKey: "",
    // 這只是第一次開起來的種子值。實際清單由本機服務從 catalog 算出來，
    // 選項頁和背景頁都會在模型消失時自動換成目前還活著的免費模型。
    opencodeModel: "mimo-v2.5-free",
    // 跟著選到的模型一起存，翻譯時就不必再查 catalog，服務沒開也能用。
    opencodeProtocol: "chat",
    opencodeStructuredOutput: false,
    opencodeBaseUrl: "https://opencode.ai/zen/v1",
    antigravityModel: "gemini-3.6-flash-low",
    bridgeBaseUrl: "http://127.0.0.1:27843",
    geminiApiKey: "",
    geminiApiKeys: "",
    geminiModel: "gemini-3.5-flash-lite",
    geminiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    // 自訂 OpenAI 相容服務。只要對得上 /chat/completions 這組介面就能用，
    // 不必等這個專案支援某一家——OpenAI、Groq、Together、OpenRouter、
    // DeepSeek、月之暗面、本機的 Ollama／LM Studio 都是同一套。
    customApiBaseUrl: "",
    customApiKey: "",
    customModel: "",
    customApiLabel: "",
    cacheLimit: 2000
  });

  function sanitizeSettings(value) {
    const settings = { ...DEFAULT_SETTINGS, ...value };
    for (const key of [
      "sourceLanguage",
      "targetLanguage",
      "translationStyle",
      "customPrompt",
      "opencodeModel",
      "opencodeProtocol",
      "opencodeBaseUrl",
      "antigravityModel",
      "bridgeBaseUrl",
      "geminiModel",
      "geminiBaseUrl",
      "customApiBaseUrl",
      "customModel",
      "customApiLabel"
    ]) {
      settings[key] = String(settings[key] ?? "").trim();
    }
    for (const key of ["opencodeApiKey", "geminiApiKey", "customApiKey"]) {
      settings[key] = String(settings[key] ?? "").trim();
    }
    // 金鑰本身不含空白、逗號、分號，所以不管使用者用什麼方式分隔——
    // 換行、逗號、空格、從表格貼——都拆得開。只認換行的話，
    // 一次貼九把會被黏成一團無效的大字串，而且沒有任何提示。
    settings.geminiApiKeys = String(settings.geminiApiKeys ?? "")
      .split(/[\s,;]+/)
      .map((key) => key.trim())
      .filter(Boolean)
      .filter((key, index, all) => all.indexOf(key) === index)
      .slice(0, 50)
      .join("\n");
    for (const key of [
      "pageTranslationEnabled",
      "selectionTranslationEnabled",
      "hoverTranslationEnabled",
      "inputTranslationEnabled",
      "opencodeStructuredOutput"
    ]) {
      settings[key] = Boolean(settings[key]);
    }
    // 引擎必須是認得的那幾個。存到不存在的引擎會讓每次翻譯都丟
    // 「Unknown provider」，而畫面上完全看不出哪裡設錯。
    if (!["antigravity", "opencode", "gemini", "custom"].includes(settings.provider)) {
      settings.provider = DEFAULT_SETTINGS.provider;
    }
    if (!["auto", "zh-Hant", "en"].includes(settings.uiLanguage)) {
      settings.uiLanguage = DEFAULT_SETTINGS.uiLanguage;
    }
    // 自訂端點只接受 http(s)，並且統一去掉結尾斜線，後面才好接路徑。
    settings.customApiBaseUrl = settings.customApiBaseUrl.replace(/\/+$/, "");
    if (settings.customApiBaseUrl && !/^https?:\/\//i.test(settings.customApiBaseUrl)) {
      settings.customApiBaseUrl = "";
    }
    settings.customApiLabel = settings.customApiLabel.slice(0, 40);
    if (!["chat", "responses"].includes(settings.opencodeProtocol)) {
      settings.opencodeProtocol = DEFAULT_SETTINGS.opencodeProtocol;
    }
    if (!["natural", "literal", "academic"].includes(settings.translationStyle)) {
      settings.translationStyle = "natural";
    }
    settings.customPrompt = settings.customPrompt.slice(0, 2000);
    if (!/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(settings.bridgeBaseUrl)) {
      settings.bridgeBaseUrl = DEFAULT_SETTINGS.bridgeBaseUrl;
    }
    settings.cacheLimit = Math.max(100, Math.min(10000, Number(settings.cacheLimit) || 2000));
    return settings;
  }

  // 設定搬家（例如 Windows → Mac）。金鑰存在 chrome.storage.local，不會跟著
  // Google 帳號同步，換電腦唯一的搬法就是匯出成檔案再匯入。
  const EXPORT_FORMAT = "immersefree-settings";
  // 講中文才飛是 ImmerseFree 的前身，欄位結構完全相同。舊版匯出的設定檔要能
  // 直接匯入，否則使用者換到新版就得重貼所有 API 金鑰。
  const LEGACY_EXPORT_FORMATS = ["chinese-can-fly-settings"];

  function buildSettingsExport(settings, appVersion) {
    return JSON.stringify({
      format: EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      appVersion: String(appVersion ?? ""),
      settings: sanitizeSettings(settings)
    }, null, 2);
  }

  function parseSettingsImport(text) {
    let payload;
    try {
      payload = JSON.parse(String(text ?? ""));
    } catch {
      throw new Error("這不是有效的 JSON 檔");
    }
    const accepted = payload?.format === EXPORT_FORMAT || LEGACY_EXPORT_FORMATS.includes(payload?.format);
    if (!accepted || typeof payload.settings !== "object" || payload.settings === null) {
      throw new Error("這不是 ImmerseFree 的設定檔");
    }
    return sanitizeSettings(payload.settings);
  }

  const settingsCore = Object.freeze({ DEFAULT_SETTINGS, sanitizeSettings, buildSettingsExport, parseSettingsImport });
  global.ImmerseFreeSettingsCore = settingsCore;
})(globalThis);
