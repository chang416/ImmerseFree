(function initializeSettingsCore(global) {
  const PROVIDER_IDS = Object.freeze(["antigravity", "opencode", "gemini", "custom"]);

  // 預設術語庫的領域 id。**正本在 core/glossary-presets.js 的 DOMAIN_IDS**，
  // 這裡寫一份是為了讓設定層不必相依於幾百條術語資料（設定會在 popup、選項頁、
  // 內容腳本各載入一次）。兩張表分岔的話症狀是「勾了領域卻沒有套用」，
  // 而且不會有任何錯誤訊息，所以 tests/glossary.test.cjs 逐項比對這兩份清單。
  const GLOSSARY_DOMAIN_IDS = Object.freeze(["tech", "finance", "medical"]);

  // ── 雙語顯示主題（W3-1）──────────────────────────────────────
  // 主題 id 就是 content.css 裡 data-imf-theme 的值，名字全部自創，
  // 與對手擴充的 class 家族零重疊（tests/theme-display-w3-1.test.cjs
  // 靜態掃描把關）。classic 是預設：左框線＋CJK 印刷細節（標點擠壓、行高）。
  const THEME_IDS = Object.freeze([
    "classic",    // 經典邊線（預設）
    "underline",  // 底線
    "dashed",     // 虛線底線
    "wavy",       // 波浪底線
    "highlight",  // 高亮
    "quote",      // 引用塊
    "faded",      // 弱化
    "italic",     // 斜體
    "bold",       // 粗體
    "card",       // 紙片
    "divider",    // 分隔線
    "plain"       // 無裝飾
  ]);

  // 顯示模式：雙語對照／僅譯文。「僅譯文」只是把原文 display:none，
  // 節點一個都不拆——切回雙語時原文原樣回來（W3-1 驗收條件 b）。
  const DISPLAY_MODES = Object.freeze(["bilingual", "translationOnly"]);

  const DEFAULT_SETTINGS = Object.freeze({
    provider: "antigravity",
    // 引擎池（W1-2）。轉移鏈永遠以「使用者選的那一個」開頭，後面才照這個順序
    // 補；沒設金鑰／沒填網址的引擎會被自動跳過，不會製造無意義的錯誤。
    providerOrder: Object.freeze(["antigravity", "opencode", "gemini", "custom"]),
    // 預設開。關掉之後失敗就是失敗，不會偷偷換引擎——有些人只想用自己指定的
    // 那一家（例如只信任本機模型），沉默轉移對他們是驚嚇不是服務。
    providerFallbackEnabled: true,
    // 引擎冷卻表：{ [providerId]: 冷卻到期的毫秒時間戳 }。這不是使用者設定，
    // 是執行期狀態，但必須跟著 storage 走——Service Worker 隨時會被殺掉，
    // 放記憶體的話 429 冷卻每次醒來就歸零，等於沒有冷卻。
    providerDisabledUntil: Object.freeze({}),
    // 介面語言。auto 跟著瀏覽器走，這樣開源之後其他國家的人裝上就是英文。
    uiLanguage: "auto",
    sourceLanguage: "auto",
    targetLanguage: "zh-Hant",
    translationStyle: "natural",
    customPrompt: "",
    pageTranslationEnabled: true,
    subtitleTranslationEnabled: true,
    // 雙軌字幕：不翻譯也不花 token，直接把平台自己的另一條字幕軌抓下來疊上去。
    // 預設配繁中；如果你在播放器裡選的本來就是中文，會自動改配 fallback。
    dualSubtitleLanguage: "zh-Hant",
    dualSubtitleFallbackLanguage: "en",
    // 影集學習要學的那個語言，也就是原文字幕那條。
    studySourceLanguage: "en",
    showOriginalSubtitle: false,
    // 匯出 SRT 時預設選哪一種：zh（只有譯文）、source（只有原文）、bilingual（雙語）。
    // 記住上次的選擇，常匯出的人不必每次重選。
    subtitleExportMode: "zh",
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
    // ── 術語表（W2-4）────────────────────────────────────────
    // 字幕的術語表一直都在，不受這個開關管；這裡管的是「網頁、PDF、劃詞
    // 要不要也套用」。預設開：譯法前後不一致是一般人最先看出來的翻譯瑕疵。
    glossaryEnabled: true,
    // 自建預設術語庫（core/glossary-presets.js）。預設開，但只在命中時注入，
    // 沒講到那個詞的段落一個 token 都不會多。關掉就是一條都不注入。
    glossaryPresetsEnabled: true,
    glossaryPresetDomains: Object.freeze(["tech", "finance", "medical"]),
    // ── 雙語顯示（W3-1）─────────────────────────────────────
    translationTheme: "classic",
    displayMode: "bilingual",
    // 側邊懸浮球。預設開；位置貼邊記百分比，換螢幕大小也不會跑出畫面外。
    floatingBallEnabled: true,
    floatingBallPos: Object.freeze({ side: "right", y: 50 }),
    // ── 網站規則庫（W3-2）────────────────────────────────────
    // 內建 25 條站台規則（core/site-rules.json）的總開關。關掉之後所有
    // 站台一律走預設門檻與預設收集範圍——有人只想要「所有網站行為一致」。
    siteRulesEnabled: true,
    // 使用者自訂規則，存的是**他在選項頁貼的那一段 JSON 原文**，不是解析
    // 後的物件。理由：文字框要能原樣顯示他打的東西（縮排、欄位順序），
    // 存成物件再序列化回去，每次打開都被重新排版一次，看起來像被改過。
    // 合法性由選項頁在存檔前擋，執行期再驗一次（壞規則不套用，不拋例外）。
    userSiteRules: "",
    cacheLimit: 2000
  });

  // 懸浮球位置。side 只有左右兩貼邊；y 是視窗高度百分比，夾在 2–98 之間
  // （0 與 100 會讓球有一半在畫面外，抓不回來）。四捨五入到小數 2 位：
  // 拖曳結束當下套用的就是這個「已正規化」的值，重新整理後再套同一個值，
  // 座標誤差才會是 0（驗收條件 c）——存原始 float 的話兩邊各算一次會有浮點差。
  function normalizeFloatingBallPos(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const side = source.side === "left" ? "left" : "right";
    const raw = Number(source.y);
    const y = Number.isFinite(raw) ? Math.round(Math.min(98, Math.max(2, raw)) * 100) / 100 : 50;
    return { side, y };
  }

  // 順序表可能來自三個地方：storage 的陣列、選項頁隱藏欄位的逗號字串、
  // 匯入的舊設定檔（根本沒有這個欄位）。三種都要收得起來，而且**一定**回傳
  // 四個引擎的完整排列——少一個就等於那個引擎永遠不會被當備援，而畫面上
  // 完全看不出來。
  function normalizeProviderOrder(value) {
    const raw = Array.isArray(value)
      ? value
      : String(value ?? "").split(/[\s,;]+/);
    const seen = [];
    for (const item of raw) {
      const id = String(item ?? "").trim();
      if (PROVIDER_IDS.includes(id) && !seen.includes(id)) seen.push(id);
    }
    for (const id of PROVIDER_IDS) if (!seen.includes(id)) seen.push(id);
    return seen;
  }

  // 領域清單跟備援順序一樣有三種來源：storage 的陣列、選項頁的逗號字串、
  // 匯入的舊設定檔（根本沒有這個欄位）。差別在這裡**不補齊**——沒勾就是沒勾，
  // 自動補回三個領域等於使用者取消不掉。認不得的 id 直接丟。
  function normalizeGlossaryDomains(value) {
    const raw = Array.isArray(value) ? value : String(value ?? "").split(/[\s,;]+/);
    const seen = [];
    for (const item of raw) {
      const id = String(item ?? "").trim();
      if (GLOSSARY_DOMAIN_IDS.includes(id) && !seen.includes(id)) seen.push(id);
    }
    return seen;
  }

  function normalizeProviderCooldowns(value, now = Date.now()) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const result = {};
    for (const id of PROVIDER_IDS) {
      const until = Number(source[id]);
      // 過期的直接丟掉：留著只會讓這張表無限長大，而且讀的人還要再判一次。
      if (Number.isFinite(until) && until > now) result[id] = Math.round(until);
    }
    return result;
  }

  function sanitizeSettings(value) {
    const settings = { ...DEFAULT_SETTINGS, ...value };
    for (const key of [
      "sourceLanguage",
      "targetLanguage",
      "translationStyle",
      "customPrompt",
      "dualSubtitleLanguage",
      "dualSubtitleFallbackLanguage",
      "studySourceLanguage",
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
      "subtitleTranslationEnabled",
      "showOriginalSubtitle",
      "selectionTranslationEnabled",
      "hoverTranslationEnabled",
      "inputTranslationEnabled",
      "opencodeStructuredOutput",
      "providerFallbackEnabled",
      "glossaryEnabled",
      "glossaryPresetsEnabled",
      "floatingBallEnabled",
      "siteRulesEnabled"
    ]) {
      settings[key] = Boolean(settings[key]);
    }
    // 自訂規則的原文。這裡**只做長度上限**，不做「解析不過就清空」——
    // 清空等於使用者辛苦打的規則被靜默吃掉；解析不過的後果是那段規則
    // 不生效（site-rules-core 執行期會丟掉不合法的），文字仍然留著可以修。
    settings.userSiteRules = String(settings.userSiteRules ?? "").slice(0, 40000);
    // 主題與顯示模式：認不得的值一律回預設。存到不存在的主題不會壞，
    // 但 CSS 一條規則都不會命中，畫面看起來就是「主題沒生效」而查不出原因。
    if (!THEME_IDS.includes(settings.translationTheme)) {
      settings.translationTheme = DEFAULT_SETTINGS.translationTheme;
    }
    if (!DISPLAY_MODES.includes(settings.displayMode)) {
      settings.displayMode = DEFAULT_SETTINGS.displayMode;
    }
    settings.floatingBallPos = normalizeFloatingBallPos(settings.floatingBallPos);
    settings.glossaryPresetDomains = normalizeGlossaryDomains(settings.glossaryPresetDomains);
    settings.providerOrder = normalizeProviderOrder(settings.providerOrder);
    settings.providerDisabledUntil = normalizeProviderCooldowns(settings.providerDisabledUntil);
    const LANGUAGES = ["zh-Hant", "zh-Hans", "en", "ja", "ko", "th"];
    if (!LANGUAGES.includes(settings.dualSubtitleLanguage)) {
      settings.dualSubtitleLanguage = DEFAULT_SETTINGS.dualSubtitleLanguage;
    }
    if (!LANGUAGES.includes(settings.dualSubtitleFallbackLanguage)) {
      settings.dualSubtitleFallbackLanguage = DEFAULT_SETTINGS.dualSubtitleFallbackLanguage;
    }
    if (!LANGUAGES.includes(settings.studySourceLanguage)) {
      settings.studySourceLanguage = DEFAULT_SETTINGS.studySourceLanguage;
    }
    // 引擎必須是認得的那幾個。存到不存在的引擎會讓每次翻譯都丟
    // 「Unknown provider」，而畫面上完全看不出哪裡設錯。
    if (!["antigravity", "opencode", "gemini", "custom"].includes(settings.provider)) {
      settings.provider = DEFAULT_SETTINGS.provider;
    }
    if (!["auto", "zh-Hant", "en"].includes(settings.uiLanguage)) {
      settings.uiLanguage = DEFAULT_SETTINGS.uiLanguage;
    }
    if (!["zh", "source", "bilingual"].includes(settings.subtitleExportMode)) {
      settings.subtitleExportMode = DEFAULT_SETTINGS.subtitleExportMode;
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
    if (!["natural", "literal", "academic", "subtitle"].includes(settings.translationStyle)) {
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

  const settingsCore = Object.freeze({
    DEFAULT_SETTINGS,
    PROVIDER_IDS,
    GLOSSARY_DOMAIN_IDS,
    THEME_IDS,
    DISPLAY_MODES,
    normalizeFloatingBallPos,
    sanitizeSettings,
    normalizeGlossaryDomains,
    normalizeProviderOrder,
    normalizeProviderCooldowns,
    buildSettingsExport,
    parseSettingsImport
  });
  global.ImmerseFreeSettingsCore = settingsCore;
  if (typeof module !== "undefined" && module.exports) module.exports = settingsCore;
})(globalThis);
