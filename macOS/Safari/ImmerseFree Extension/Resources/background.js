importScripts(
  "core/i18n-core.js",
  // 錯誤碼註冊表要排在 i18n-core 之後：它載入時會把每個 code 的英文訊息
  // 註冊進 i18n 字典，字典還沒建立的話就會靜默註冊不到（介面切英文時
  // 錯誤訊息會露出中文）。
  "core/diagnostics-core.js",
  "core/bridge-core.js",
  "core/settings-core.js",
  "core/language-core.js",
  "core/provider-core.js",
  "core/batch-core.js",
  // 術語表：通用層 → 預設庫 → 字幕轉接層，順序不能換。字幕層載入時會去讀
  // globalThis.ImmerseFreeGlossaryCore，通用層還沒載入就會直接丟例外
  // （刻意不靜默退化：術語表整個沒作用但畫面一切正常，是最難查的那種壞法）。
  "core/glossary-core.js",
  "core/glossary-presets.js",
  "core/subtitle-glossary-core.js",
  // 快取鍵的公式只有一份，網頁層與背景層共用（見 buildTranslationRequestKey）。
  "core/page-translation-cache.js",
  // 只為了 resolveVideoId：字幕快取要綁影片，而影片 id 的解析規則已經在
  // 字幕儲存層寫過一次，兩邊各寫一份遲早分岔。
  "core/subtitle-store-core.js",
  "core/study-core.js"
);

const api = globalThis.browser ?? globalThis.chrome;
const { DEFAULT_SETTINGS, sanitizeSettings } = globalThis.ImmerseFreeSettingsCore;
const { bridgeFetch } = globalThis.ImmerseFreeBridgeCore;
const providerCore = globalThis.ImmerseFreeProviderCore;
const { translateWithAntigravity, translateWithCustomApi, translateWithGemini, translateWithOpenCode, completeText, listCustomApiModels } = providerCore;
const {
  isProviderConfigured,
  classifyProviderFailure,
  providerError,
  providerLabel,
  providerProfile,
  runWithProviderProfile,
  PROVIDER_ERROR_CODES
} = providerCore;
const diagnostics = globalThis.ImmerseFreeDiagnosticsCore;
const { DIAGNOSTIC_CODES } = diagnostics;
const study = globalThis.ImmerseFreeStudyCore;
const glossaryCore = globalThis.ImmerseFreeSubtitleGlossary;
// 通用層與預設庫：網頁／PDF／劃詞那條要用（字幕那條走 glossaryCore 的轉接）。
const glossary = globalThis.ImmerseFreeGlossaryCore;
const glossaryPresets = globalThis.ImmerseFreeGlossaryPresets;
const { translateInReliableBatches, batchProfile } = globalThis.ImmerseFreeBatchCore;
const { isAlreadyTargetLanguage } = globalThis.ImmerseFreeLanguage;
const { buildTranslationRequestKey } = globalThis.ImmerseFreePageTranslationCache;
const subtitleStore = globalThis.ImmerseFreeSubtitleStore;
const cache = new Map();

// ============================================================ 診斷事件緩衝（W1-4）
//
// Service Worker 隨時會被回收，純記憶體的環形緩衝等於「使用者打開診斷頁時
// 剛好是空的」。所以記憶體是正本、storage.session 是備份：每次記錄後節流寫回，
// SW 重啟時先把它讀回來。
//
// 為什麼是 session 不是 local：這些是除錯用的執行期紀錄，瀏覽器關掉就沒有
// 保留的意義，塞進 local 只會跟譯文快取搶配額。舊版瀏覽器沒有 storage.session
// 時退回 local 的同一個鍵（會多留一次瀏覽階段，無害）。
const DIAGNOSTICS_KEY = "diagnosticEvents";
const DIAGNOSTICS_FLUSH_MS = 1000;
const diagnosticEvents = diagnostics.createEventBuffer({ limit: diagnostics.EVENT_LIMIT });
const diagnosticsStore = api.storage.session ?? api.storage.local;
let diagnosticsFlushTimer = null;
let diagnosticsHydrated = false;

async function hydrateDiagnostics() {
  if (diagnosticsHydrated) return;
  diagnosticsHydrated = true;
  try {
    const stored = await diagnosticsStore.get({ [DIAGNOSTICS_KEY]: [] });
    diagnosticEvents.restore(stored?.[DIAGNOSTICS_KEY]);
  } catch {
    // 讀不回來就從空的開始。診斷紀錄壞掉不該讓任何功能失敗。
  }
}
void hydrateDiagnostics();

function flushDiagnostics() {
  if (diagnosticsFlushTimer) return;
  diagnosticsFlushTimer = setTimeout(() => {
    diagnosticsFlushTimer = null;
    diagnosticsStore.set({ [DIAGNOSTICS_KEY]: diagnosticEvents.list() }).catch(() => {});
  }, DIAGNOSTICS_FLUSH_MS);
}

// ---------------------------------------------------------------- 統計計數器（W4-2）
//
// 事件緩衝只留 50 筆，比率類指標拿它算會隨使用時間漂移（翻一頁就沖掉前面
// 全部）。所以計數器另存一份單調累加值，而且放 storage.local 不放 session：
// 「快取命中率」這種數字要跨瀏覽階段才有意義。值只可能是非負整數
// （sanitizeMetrics 白名單），塞不進任何文字。
const METRICS_KEY = "diagnosticMetrics";
const metricsCounters = diagnostics.createMetricsCounters();
let metricsFlushTimer = null;
let metricsHydrated = false;

async function hydrateMetrics() {
  if (metricsHydrated) return;
  metricsHydrated = true;
  try {
    const stored = await api.storage.local.get({ [METRICS_KEY]: null });
    if (stored?.[METRICS_KEY]) metricsCounters.restore(stored[METRICS_KEY]);
  } catch {
    // 讀不回來就從 0 開始。統計壞掉不該讓任何功能失敗。
  }
}
void hydrateMetrics();

function flushMetrics() {
  if (metricsFlushTimer) return;
  metricsFlushTimer = setTimeout(() => {
    metricsFlushTimer = null;
    api.storage.local.set({ [METRICS_KEY]: metricsCounters.snapshot() }).catch(() => {});
  }, DIAGNOSTICS_FLUSH_MS);
}

function bumpMetric(key, amount = 1) {
  metricsCounters.bump(key, amount);
  flushMetrics();
}

function addMetrics(delta) {
  metricsCounters.add(delta);
  flushMetrics();
}

// 唯一的記錄入口。**只吃這五個欄位**——sanitizeEvent 是白名單制，
// 就算這裡多傳了什麼（錯誤訊息、原文、譯文）也進不去（見 diagnostics-core
// 的隱私註解）。呼叫端不需要自己過濾，也不該自己過濾。
function recordDiagnostic(fields) {
  const event = diagnosticEvents.record(fields);
  // 有些指標本來就有事件（RICHTEXT_FALLBACK／DICT_FALLBACK），計數點就掛在
  // 這裡：唯一的入口 → 不會漏記，也不會因為兩處各記一次而重複計數。
  const metricKey = diagnostics.CODE_METRIC_KEYS[event.code];
  if (metricKey) bumpMetric(metricKey, 1);
  flushDiagnostics();
  return event;
}

// 批次編號協議的觀察（W2-3）走同一個入口。provider-core 兩邊都會載入
// （背景頁與內容腳本），事件緩衝只在背景頁，所以它不自己記錄，只把觀察
// 交給註冊進來的人——內容腳本那邊沒有註冊，於是完全不做事。
providerCore.setProtocolListener(recordDiagnostic);

// 拆批率的計數點（W4-2）。batch-core 在內容腳本也會載入，但只有背景頁
// 註冊這個 listener——註冊兩邊會讓同一批被算兩次。
globalThis.ImmerseFreeBatchCore.setBatchListener((event) => {
  if (event?.kind === "dispatch") bumpMetric("batches", 1);
  if (event?.kind === "split") bumpMetric("batchSplits", 1);
});

async function getDiagnostics() {
  await hydrateDiagnostics();
  await hydrateMetrics();
  const settings = await getSettings().catch(() => ({}));
  const events = diagnosticEvents.list();
  const counters = metricsCounters.snapshot();
  return {
    events,
    providers: diagnostics.summarizeProviders(events),
    // 統計區塊（W4-2）：counters 是原始累加值，metrics 是算好的六個指標。
    // 兩者都只有數字，匯出 JSON 直接用得上。
    counters,
    metrics: diagnostics.computeMetrics(counters, events),
    limit: diagnosticEvents.limit,
    version: api.runtime.getManifest?.()?.version ?? "",
    provider: settings.provider ?? "",
    uiLanguage: settings.uiLanguage ?? "auto",
    chain: resolveProviderChain(settings, settings.providerDisabledUntil ?? {}, Date.now())
      .map((id) => providerLabel(id, settings))
      .join(" \u2192 ")
  };
}

async function clearDiagnostics() {
  diagnosticEvents.clear();
  metricsCounters.clear();
  await diagnosticsStore.set({ [DIAGNOSTICS_KEY]: [] }).catch(() => {});
  await api.storage.local.set({ [METRICS_KEY]: metricsCounters.snapshot() }).catch(() => {});
  return true;
}

async function getSettings() {
  const stored = await api.storage.local.get(DEFAULT_SETTINGS);
  return sanitizeSettings(stored);
}

api.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") api.runtime.openOptionsPage().catch(() => {});
  setupContextMenus().catch(() => {});
});

async function setupContextMenus() {
  if (!api.contextMenus) return;
  await api.contextMenus.removeAll();
  api.contextMenus.create({ id: "immersefree-translate-selection", title: "翻譯選取文字", contexts: ["selection"] });
  api.contextMenus.create({ id: "immersefree-translate-page", title: "翻譯這個網頁", contexts: ["page"] });
  api.contextMenus.create({ id: "immersefree-ai-subtitle", title: "開關 AI 字幕", contexts: ["page"] });
  api.contextMenus.create({ id: "immersefree-dual-subtitle", title: "開關雙軌字幕", contexts: ["page"] });
  api.contextMenus.create({ id: "immersefree-open-pdf", title: "用 ImmerseFree 開啟 PDF", contexts: ["link", "page"] });
}

api.contextMenus?.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === "immersefree-translate-selection") {
    api.tabs.sendMessage(tab.id, { type: "IMMERSEFREE_TRANSLATE_SELECTION", text: info.selectionText }).catch(() => {});
  } else if (info.menuItemId === "immersefree-translate-page") {
    api.tabs.sendMessage(tab.id, { type: "IMMERSEFREE_TRANSLATE_PAGE" }).catch(() => {});
  } else if (info.menuItemId === "immersefree-ai-subtitle") {
    api.tabs.sendMessage(tab.id, { type: "IMMERSEFREE_TOGGLE_AI_SUBTITLES" }).catch(() => {});
  } else if (info.menuItemId === "immersefree-dual-subtitle") {
    api.tabs.sendMessage(tab.id, { type: "IMMERSEFREE_TOGGLE_DUAL_SUBTITLES" }).catch(() => {});
  } else if (info.menuItemId === "immersefree-open-pdf") {
    const source = info.linkUrl || info.pageUrl || tab.url || "";
    api.tabs.create({ url: `${api.runtime.getURL("reader/pdf.html")}?src=${encodeURIComponent(source)}` });
  }
});

api.commands?.onCommand.addListener(async (command) => {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (command === "translate-page") api.tabs.sendMessage(tab.id, { type: "IMMERSEFREE_TRANSLATE_PAGE" }).catch(() => {});
  if (command === "translate-selection") api.tabs.sendMessage(tab.id, { type: "IMMERSEFREE_TRANSLATE_SELECTION" }).catch(() => {});
  if (command === "toggle-ai-subtitle") api.tabs.sendMessage(tab.id, { type: "IMMERSEFREE_TOGGLE_AI_SUBTITLES" }).catch(() => {});
  if (command === "toggle-dual-subtitle") api.tabs.sendMessage(tab.id, { type: "IMMERSEFREE_TOGGLE_DUAL_SUBTITLES" }).catch(() => {});
});

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "IMMERSEFREE_TRANSLATE") {
    handleTranslation(message, sender)
      // usedProvider／fallbackCount 一路傳到呼叫端：轉移不能是沉默的，
      // 進度列與 popup 要說得出「已改用 X」。
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message, code: error.code ?? "" }));
    return true;
  }
  // 內容腳本回報一筆診斷事件（W2-2 的 RICHTEXT_FALLBACK 走這裡）。
  //
  // 事件緩衝住在背景頁，內容腳本沒有別的路可以記。收進來的東西一樣走
  // sanitizeEvent 的白名單，所以就算呼叫端多塞了原文或譯文也進不去
  // （見 diagnostics-core 的隱私註解）——這個入口不會變成資料外洩的破口。
  if (message?.type === "IMMERSEFREE_RECORD_DIAGNOSTIC") {
    hydrateDiagnostics()
      .then(() => {
        recordDiagnostic(message.event);
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message, code: error.code ?? "" }));
    return true;
  }
  // 內容腳本回報一組統計增量（快取命中／未命中、字幕合併組數）。
  // sanitizeMetrics 是白名單＋非負整數，型別上就塞不進任何文字。
  if (message?.type === "IMMERSEFREE_RECORD_METRICS") {
    hydrateMetrics()
      .then(() => {
        addMetrics(message.metrics);
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message, code: error.code ?? "" }));
    return true;
  }
  if (message?.type === "IMMERSEFREE_GET_DIAGNOSTICS") {
    getDiagnostics()
      .then((report) => sendResponse({ ok: true, ...report }))
      .catch((error) => sendResponse({ ok: false, error: error.message, code: error.code ?? "" }));
    return true;
  }
  if (message?.type === "IMMERSEFREE_CLEAR_DIAGNOSTICS") {
    clearDiagnostics()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message, code: error.code ?? "" }));
    return true;
  }
  if (message?.type === "IMMERSEFREE_GET_PROVIDER_STATE") {
    getProviderState()
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: error.message, code: error.code ?? "" }));
    return true;
  }
  if (message?.type === "IMMERSEFREE_GET_SETTINGS") {
    getSettings()
      .then((settings) => sendResponse({ ok: true, settings: redactSettings(settings) }))
      .catch((error) => sendResponse({ ok: false, error: error.message, code: error.code ?? "" }));
    return true;
  }
  if (message?.type === "IMMERSEFREE_TEST_PROVIDER") {
    testProvider()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message, code: error.code ?? "" }));
    return true;
  }
  if (message?.type === "IMMERSEFREE_UPDATE_SETTINGS") {
    updateSettings(message.settings)
      .then((settings) => sendResponse({ ok: true, settings: redactSettings(settings) }))
      .catch((error) => sendResponse({ ok: false, error: error.message, code: error.code ?? "" }));
    return true;
  }
  if (message?.type === "IMMERSEFREE_ANALYZE_GLOSSARY") {
    analyzeGlossary(message)
      .then((glossary) => sendResponse({ ok: true, glossary }))
      .catch((error) => sendResponse({ ok: false, error: error.message, code: error.code ?? "" }));
    return true;
  }
  // 劃詞的單字查詢（W3-3）。降級在這一側做完才回覆，見 handleDictionary。
  if (message?.type === "IMMERSEFREE_DICTIONARY") {
    handleDictionary(message, sender)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message, code: error.code ?? "" }));
    return true;
  }
  if (message?.type === "IMMERSEFREE_STUDY_GENERATE") {
    generateStudy(message.profile)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message, code: error.code ?? "" }));
    return true;
  }
  if (message?.type === "IMMERSEFREE_LIST_CUSTOM_MODELS") {
    // 走背景頁而不是選項頁直接 fetch：主機權限掛在擴充功能上，
    // 背景頁是唯一保證拿得到的地方。
    getSettings()
      .then((settings) => listCustomApiModels({ ...settings, ...(message.settings ?? {}) }))
      .then((models) => sendResponse({ ok: true, models }))
      .catch((error) => sendResponse({ ok: false, error: error.message, code: error.code ?? "" }));
    return true;
  }
  if (message?.type === "IMMERSEFREE_GET_MODEL_CATALOG") {
    getModelCatalog(Boolean(message.refresh))
      .then((catalog) => sendResponse({ ok: true, catalog }))
      .catch((error) => sendResponse({ ok: false, error: error.message, code: error.code ?? "", catalog: fallbackCatalog() }));
    return true;
  }
  return false;
});

async function handleTranslation(message, sender) {
  const segments = validateSegments(message.segments);
  const settings = await getSettings();
  const context = sanitizeContext(message.context);
  // 網頁／PDF／劃詞的術語表在這裡掛上去。挑選在背景頁做而不是在三個內容腳本
  // 各做一次：那樣遲早分岔，而分岔的症狀是「網頁有套術語、劃詞沒有」——
  // 使用者只會覺得「有時候會有時候不會」，查起來非常花時間。
  await attachDocumentGlossary(context, settings, segments);
  const videoId = resolveVideoIdentity(context, sender);
  const keys = segments.map((text) => cacheKey(text, settings, context, videoId));
  // 回傳值從這個陣列組，不從 cache 反查。轉移發生時譯文會存在「實際成功的
  // 那個引擎」的格子裡，而 keys[] 算的是「使用者選的引擎」——照 keys 反查
  // 會拿到 undefined。
  const results = new Array(segments.length);
  const missing = [];
  const missingIndexes = [];
  keys.forEach((key, index) => {
    if (isAlreadyTargetLanguage(segments[index], settings.targetLanguage)) {
      cache.set(key, segments[index]);
      results[index] = segments[index];
      return;
    }
    if (cache.has(key)) {
      results[index] = cache.get(key);
      return;
    }
    missing.push(segments[index]);
    missingIndexes.push(index);
  });
  let usedProvider = settings.provider;
  let fallbackCount = 0;
  if (missing.length) {
    const outcome = await dispatchProvider(missing, settings, context, sender);
    // 快取鍵含 provider 維度（見 page-translation-cache.buildTranslationRequestKey）。
    // 轉移之後**只能**寫進實際成功那個引擎的 key：把 B 家的譯文塞進 A 家的格子，
    // 下次使用者選 A 就會撿到不是 A 翻的東西，而且完全看不出來。
    const writeSettings = outcome.usedProvider === settings.provider
      ? settings
      : { ...settings, provider: outcome.usedProvider };
    outcome.translations.forEach((text, i) => {
      const index = missingIndexes[i];
      results[index] = text;
      cache.set(cacheKey(segments[index], writeSettings, context, videoId), text);
    });
    trimCache(settings.cacheLimit);
    usedProvider = outcome.usedProvider;
    fallbackCount = outcome.fallbackCount;
  }
  return {
    translations: results,
    usedProvider,
    fallbackCount,
    fallbackNotice: fallbackCount > 0 ? `已改用 ${providerLabel(usedProvider, settings)}` : ""
  };
}

// ============================================================ 引擎池與失敗轉移
//
// 兩層韌性疊在一起，順序不可對調（判準與字樣在 provider-core.js 的引擎池那一節）：
//
//   1. batch-core.recoverCountMismatch（內層，先跑）——救「格式錯」。
//      模型回的條數對不上／JSON 壞掉 → 原樣重試一次 → 二分拆批。
//      **同一個引擎**處理，不換引擎：成因是這批太長被截斷，換一家也一樣長。
//   2. callProviderPool（外層，後跑）——救「引擎故障」。
//      429、逾時、連不到、CLI 掛掉 → 換下一個引擎。拆批救不了這一類。
//
// 兩層的分界寫在 classifyProviderFailure：FORMAT_MISMATCH 標成「不可轉移」，
// 於是它會原樣穿過轉移層、落到 batch-core 手上；引擎故障類 batch-core 認不得，
// 會原樣往上丟給轉移層。任何一邊改了字樣，另一邊要一起改，否則會出現
// 「兩層都不接手」的洞。
//
// 轉移只發生在**批的邊界**：callProviderPool 是 translateInReliableBatches 的
// 每批回呼，所以一批之內不會換引擎，字幕不會出現前半句 A 家、後半句 B 家。
//
// 預算：整趟 dispatch 最多 MAX_PROVIDER_FALLBACKS 次跨引擎轉移（不是每批各 2 次）。
// 用完就把整個 run 標成 exhausted，之後的批次直接拋同一個錯誤、不再打任何引擎——
// 少了這一步，batch-core 會把失敗批拆成兩半再送一次，一路遞迴到單句，
// 「有預算上限」就變成沒有上限。
const MAX_PROVIDER_FALLBACKS = 2;

// 最近一次轉移，給 popup 顯示「已改用 X」。Service Worker 被回收後這個變數會
// 歸零，所以同時寫進 storage；兩者都拿不到時 popup 就只顯示原本的引擎。
let lastProviderFallback = null;

async function dispatchProvider(segments, settings, context) {
  const run = createProviderRun(settings);
  // 批量從 batch-core 拿，不再寫死 8（W2-3）。字幕與網頁走不同的 profile：
  // 字幕一批 12（畫面在等，要更快回來），其餘一批 16。
  // 內容腳本那邊已經照同一組數字切過一次，這裡通常是原樣通過；
  // 兩邊共用同一支 planBatches 就是為了不讓「切兩次」變成「請求兩倍」。
  const translations = await translateInReliableBatches(
    segments,
    context,
    (batch, batchContext) => callProviderPool(batch, batchContext, run),
    batchProfile(context?.mode)
  );
  return {
    translations,
    usedProvider: run.usedProvider,
    fallbackCount: run.fallbackCount,
    attempts: run.attempts
  };
}

function createProviderRun(settings, now = Date.now()) {
  const cooldowns = settings.providerDisabledUntil ?? {};
  const chain = resolveProviderChain(settings, cooldowns, now);
  const head = chain[0] ?? settings.provider;
  return {
    settings,
    chain,
    index: 0,
    budget: MAX_PROVIDER_FALLBACKS,
    // 開頭就不是使用者選的那一個（唯一的成因是它還在冷卻），對使用者來說
    // 一樣是「換了引擎」，所以照樣算一次，UI 才不會沉默換家。
    fallbackCount: head === settings.provider ? 0 : 1,
    usedProvider: head,
    attempts: [],
    exhausted: false,
    exhaustedError: null
  };
}

// 轉移鏈：使用者選的排第一，後面照 providerOrder 補。
// - 沒設金鑰的 gemini、沒填網址的 custom 直接不進鏈（送出去只會拿回
//   「API key is missing」，那不是故障，是它根本不在池子裡）。
// - 使用者**自己選的**那個例外，不管設沒設好都留在第一位：他挑了 Gemini 卻
//   沒貼金鑰時，該看到「Gemini API key is missing」，不是「沒有可用的引擎」。
// - 冷卻中的跳過；全部都在冷卻時，挑最快恢復的那個試一次（回一句真的錯誤
//   訊息，比回「無可用引擎」有用）。
function resolveProviderChain(settings, cooldowns = {}, now = Date.now()) {
  const selected = settings.provider;
  const order = Array.isArray(settings.providerOrder) ? settings.providerOrder : [];
  if (!settings.providerFallbackEnabled) return [selected];
  const candidates = [
    selected,
    ...order.filter((id) => id !== selected && isProviderConfigured(id, settings))
  ];
  const ready = candidates.filter((id) => !((Number(cooldowns[id]) || 0) > now));
  if (ready.length) return ready;
  return [[...candidates].sort((a, b) => (Number(cooldowns[a]) || 0) - (Number(cooldowns[b]) || 0))[0]];
}

async function callProviderPool(segments, context, run) {
  if (run.exhausted) throw run.exhaustedError;
  let lastFailure = null;
  while (run.index < run.chain.length) {
    const providerId = run.chain[run.index];
    // 同一個引擎自己的重試次數由描述表決定（目前四家都是 0：每家底下已經
    // 各有一層重試——Bridge 對 opencode 重試 1 次＋短路器，Gemini 多金鑰輪替）。
    const sameProviderAttempts = 1 + Math.max(0, providerProfile(providerId)?.retry ?? 0);
    let failure = null;
    let failureError = null;
    for (let attempt = 0; attempt < sameProviderAttempts; attempt += 1) {
      // 每一次嘗試（成功或失敗）都記一筆診斷事件。成功也要記，否則診斷頁的
      // 「成功率」分母只有失敗次數，永遠是 0%。記的欄位只有 code／引擎／
      // 批大小／耗時——**沒有任何一段原文或譯文**（見 recordDiagnostic）。
      const startedAt = Date.now();
      try {
        const translated = await runWithProviderProfile(
          providerId,
          () => callSelectedProvider(segments, { ...run.settings, provider: providerId }, context)
        );
        run.usedProvider = providerId;
        run.attempts.push({ provider: providerId, ok: true });
        recordDiagnostic({
          code: "TRANSLATION_OK",
          provider: providerId,
          batchSize: segments.length,
          durationMs: Date.now() - startedAt,
          ok: true
        });
        return translated;
      } catch (error) {
        failure = classifyProviderFailure(error, providerId);
        failureError = error;
        // 分類器的判斷要留在錯誤物件本身。少了這一行，錯誤原樣往上丟時
        // （不可轉移、或整條鏈只有一個引擎）到 popup 手上就只剩一句字串，
        // 查不了註冊表——「同一個 code 同一句話」的鏈條會在這裡斷掉。
        // 已經有 code 的不覆蓋：Bridge 自己分的那 9 個比我們對映後的更具體。
        if (!error.code) error.code = failure.code;
        run.attempts.push({ provider: providerId, ok: false, code: failure.code });
        recordDiagnostic({
          code: failure.code,
          provider: providerId,
          batchSize: segments.length,
          durationMs: Date.now() - startedAt,
          ok: false
        });
        if (failure.cooldownSeconds) await noteProviderCooldown(providerId, failure.cooldownSeconds);
        // 不可轉移＝換誰都會撞同一道牆（BAD_REQUEST），或者這是拆批那層的活
        // （FORMAT_MISMATCH）。兩種都原樣往上丟，不要包裝、不要換引擎。
        if (!failure.transferable) throw error;
      }
    }
    lastFailure = { failure, error: failureError };
    const nextIndex = run.index + 1;
    if (nextIndex >= run.chain.length || run.budget <= 0) break;
    run.budget -= 1;
    run.fallbackCount += 1;
    run.index = nextIndex;
    run.usedProvider = run.chain[nextIndex];
    noteProviderFallback(providerId, run.chain[nextIndex], failure, run.settings);
  }
  run.exhausted = true;
  // 只試過**一個**引擎時（關掉自動轉移、或鏈上只有它），「所有引擎都失敗了」
  // 是句誤導的話，而且它會蓋掉唯一真正有用的下一步——例如 BRIDGE_OFFLINE 的
  // 「去啟動那個服務」會變成 PROVIDER_POOL_EXHAUSTED 的「去確認至少有一個
  // 引擎能用」。這種情況原樣往上丟，code 也保持原本那個。
  const failedProviders = new Set(run.attempts.filter((item) => !item.ok).map((item) => item.provider));
  const single = failedProviders.size <= 1 && lastFailure?.error;
  run.exhaustedError = single ? lastFailure.error : poolExhaustedError(run, lastFailure);
  if (!single) {
    recordDiagnostic({
      code: PROVIDER_ERROR_CODES.POOL_EXHAUSTED,
      provider: run.chain[run.index] ?? run.settings.provider,
      batchSize: segments.length,
      ok: false
    });
  }
  throw run.exhaustedError;
}

// 全部失敗時回的是「分類過的整體錯誤」，不是最後一個引擎的原始訊息——
// 後者會讓使用者以為只有那一家壞了，而事實是整條鏈都試過了。
function poolExhaustedError(run, lastFailure) {
  const tried = [...new Set(run.attempts.filter((item) => !item.ok).map((item) => item.provider))]
    .map((id) => providerLabel(id, run.settings));
  const detail = String(lastFailure?.error?.message ?? "").trim() || "沒有更多細節";
  const message = tried.length > 1
    ? `${tried.join("、")} 都無法翻譯這一批（已用完 ${MAX_PROVIDER_FALLBACKS} 次跨引擎轉移的預算）。最後一個錯誤：${detail}`
    : `${tried[0] ?? "翻譯引擎"} 無法翻譯這一批：${detail}`;
  const error = providerError(message, PROVIDER_ERROR_CODES.POOL_EXHAUSTED);
  error.lastCode = lastFailure?.failure?.code ?? PROVIDER_ERROR_CODES.UNKNOWN;
  error.providerAttempts = run.attempts;
  return error;
}

// 429／逾時／連不上 → 讓這個引擎冷卻一段時間，冷卻中不再被選中。
// 秒數優先聽對方的 retry-after，沒有才用預設 60 秒（判準在 provider-core）。
// 冷卻表寫進 storage：Service Worker 隨時會被回收，放記憶體等於沒有冷卻。
async function noteProviderCooldown(providerId, seconds) {
  try {
    const until = Date.now() + Math.max(1, seconds) * 1000;
    const stored = await api.storage.local.get({ providerDisabledUntil: {} });
    const next = { ...(stored?.providerDisabledUntil ?? {}) };
    if ((Number(next[providerId]) || 0) < until) next[providerId] = until;
    await api.storage.local.set({ providerDisabledUntil: next });
  } catch {
    // 冷卻只是最佳化，寫不進去也不該讓這次翻譯失敗——但要留痕：
    // 靜默的 catch 是「同一個引擎每一批都重撞 429」這種症狀的常見成因。
    recordDiagnostic({ code: "CACHE_WRITE_FAILED", provider: providerId, ok: false });
  }
}

function noteProviderFallback(from, to, failure, settings) {
  // 轉移次數的計數點（W4-2）。事件表也看得到（fallbackFrom/fallbackTo），
  // 但那只有最近 50 筆；這裡是累計值。
  bumpMetric("providerHandoffs", 1);
  // 轉移事件本身也進診斷表：只有「從哪個引擎換到哪個」兩個 id，
  // failure.message 刻意不傳（它可能夾帶引擎回話）。
  recordDiagnostic({
    code: failure?.code ?? PROVIDER_ERROR_CODES.UNKNOWN,
    provider: from,
    fallbackFrom: from,
    fallbackTo: to,
    ok: false
  });
  lastProviderFallback = {
    at: Date.now(),
    from,
    to,
    fromLabel: providerLabel(from, settings),
    toLabel: providerLabel(to, settings),
    code: failure?.code ?? "",
    message: failure?.message ?? ""
  };
  api.storage.local.set({ lastProviderFallback }).catch(() => {});
}

async function getProviderState() {
  const settings = await getSettings();
  const stored = await api.storage.local.get({ lastProviderFallback: null }).catch(() => ({}));
  const now = Date.now();
  const cooldowns = settings.providerDisabledUntil ?? {};
  return {
    provider: settings.provider,
    providerLabel: providerLabel(settings.provider, settings),
    fallbackEnabled: settings.providerFallbackEnabled,
    chain: resolveProviderChain(settings, cooldowns, now),
    cooling: Object.entries(cooldowns)
      .filter(([, until]) => Number(until) > now)
      .map(([id, until]) => ({
        provider: id,
        // 畫面上要出現的是「Antigravity」，不是內部代號 antigravity。
        label: providerLabel(id, settings),
        seconds: Math.ceil((Number(until) - now) / 1000)
      })),
    lastFallback: lastProviderFallback ?? stored?.lastProviderFallback ?? null
  };
}

// 免費模型的汰換很勤，存起來的那個隨時可能被下架。翻譯前先跟目前的清單對一次，
// 不在清單裡就換成還活著的第一個並存回去，使用者不用自己去選項頁重選。
async function resolveOpenCodeSettings(settings) {
  let catalog;
  try {
    catalog = await getModelCatalog(false);
  } catch {
    return settings;
  }
  const models = catalog?.opencode ?? [];
  if (!models.length) return settings;
  const chosen = models.find((model) => model.id === settings.opencodeModel) ?? models[0];
  const resolved = {
    ...settings,
    opencodeModel: chosen.id,
    opencodeProtocol: chosen.protocol === "responses" ? "responses" : "chat",
    opencodeStructuredOutput: Boolean(chosen.structuredOutput)
  };
  if (
    resolved.opencodeModel !== settings.opencodeModel ||
    resolved.opencodeProtocol !== settings.opencodeProtocol ||
    resolved.opencodeStructuredOutput !== settings.opencodeStructuredOutput
  ) {
    await api.storage.local.set({
      opencodeModel: resolved.opencodeModel,
      opencodeProtocol: resolved.opencodeProtocol,
      opencodeStructuredOutput: resolved.opencodeStructuredOutput
    });
  }
  return resolved;
}

async function callSelectedProvider(segments, settings, context) {
  switch (settings.provider) {
    case "opencode":
      return translateWithOpenCode(segments, await resolveOpenCodeSettings(settings), context);
    case "gemini":
      return translateWithGemini(segments, settings, context);
    case "antigravity":
      return translateWithAntigravity(segments, settings, context);
    case "custom":
      return translateWithCustomApi(segments, settings, context);
    default:
      throw providerError(`Unknown provider: ${settings.provider}`, PROVIDER_ERROR_CODES.UNSUPPORTED);
  }
}

async function testProvider() {
  const settings = await getSettings();
  const started = performance.now();
  const outcome = await dispatchProvider(
    // 測試句要像真的會被翻的句子：有語氣、有代名詞、有時態。
    // 全字母句（pangram）只證明模型會吐字，看不出它翻得自不自然。
    ["Good morning! Would you like some coffee before we start?"],
    settings,
    "API connection test"
  );
  const usedProvider = outcome.usedProvider ?? settings.provider;
  return {
    provider: usedProvider,
    // 測試也會走轉移。model 要跟著實際成功的引擎報，不然畫面會說
    // 「gemini-3.5-flash-lite 成功」，而其實是 OpenCode 翻的。
    model: selectedModel({ ...settings, provider: usedProvider }),
    translation: outcome.translations[0],
    usedProvider,
    fallbackCount: outcome.fallbackCount ?? 0,
    fallbackNotice: (outcome.fallbackCount ?? 0) > 0
      ? `已改用 ${providerLabel(usedProvider, settings)}`
      : "",
    latencyMs: Math.round(performance.now() - started)
  };
}

// ------------------------------------------------------------------ 劃詞詞典（W3-3）
//
// 一次請求、兩種可能的回覆：
//   `{ mode: "dictionary", entry }`    模型照 schema 回話了
//   `{ mode: "translation", … }`       沒回話或回得不能用 → 已經改打翻譯
//
// **降級整個做在這一側**，理由有兩個。一是內容腳本載不到 provider-core
// （詞典的 prompt 與解析都在那裡，見 core/shared.js 的 lookupWord 註解）；
// 二是降級若要內容腳本再發一次訊息，service worker 休眠時那趟往返是好幾秒，
// 使用者會看到卡片先卡著再變成翻譯——同一次點擊看起來像壞了兩次。
//
// 降級的判準刻意寬：解析不出來、缺義項、連請求本身都失敗，全部降級。
// 尤其是最後一種——completeText 是單引擎直打（沒有引擎池、沒有拆批），
// 而翻譯那條有整套轉移與重試，所以「詞典打不通」很可能「翻譯打得通」。
// 兩者都不通時，錯誤會從翻譯那條原樣冒出來，卡片顯示的是那一句。
async function handleDictionary(message, sender) {
  const word = String(message?.word ?? "").replace(/\s+/g, " ").trim();
  if (!word || word.length > 64) {
    throw diagnostics.diagnosticError("Dictionary lookup needs a single word of 1-64 characters", "REQUEST_SEGMENT_LENGTH");
  }
  const settings = await getSettings();
  const context = sanitizeContext(message?.context);
  // 術語表照掛。使用者把 cache 定成「快取」之後，詞典卡的釋義也該是「快取」，
  // 不然同一個詞在網頁上與卡片上兩種說法，看起來像其中一邊壞了。
  await attachDocumentGlossary(context, settings, [word]);

  let reason = "";
  let entry = null;
  try {
    const raw = await completeText(providerCore.buildDictionaryPrompt(word, settings, context), settings);
    const parsed = providerCore.parseDictionaryEntry(raw, word);
    if (parsed.ok) entry = parsed.entry;
    else reason = parsed.reason;
  } catch (error) {
    reason = String(error?.code || "request-failed");
  }
  if (entry) {
    return { mode: "dictionary", entry, usedProvider: settings.provider, fallbackCount: 0 };
  }
  // 記一筆再降級。**不帶 provider**：詞典請求本身通常是成功的（模型有回話，
  // 只是沒照 schema），帶了會被 summarizeProviders 算進成功率的分母，
  // 把「格式不合」講成「引擎失敗」——那會讓診斷頁指向錯的方向。
  recordDiagnostic({ code: "DICT_FALLBACK", ok: true, batchSize: 1 });
  const fallback = await handleTranslation(
    { segments: [word], context: { ...(message?.context ?? {}), mode: "selection" } },
    sender
  );
  return { mode: "translation", ...fallback, dictionaryFallbackReason: reason };
}

function validateSegments(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 40) {
    throw diagnostics.diagnosticError("Translation request must contain 1-40 segments", "REQUEST_SEGMENT_COUNT");
  }
  const segments = value.map((item) => String(item ?? "").trim());
  if (segments.some((item) => !item || item.length > 2000)) {
    throw diagnostics.diagnosticError("Each segment must contain 1-2000 characters", "REQUEST_SEGMENT_LENGTH");
  }
  if (segments.reduce((sum, item) => sum + item.length, 0) > 12000) {
    throw diagnostics.diagnosticError("Translation request is too large", "REQUEST_TOO_LARGE");
  }
  return segments;
}

// 快取鍵的公式在 core/page-translation-cache.js（buildTranslationRequestKey），
// 那裡也寫了「哪些維度進 key、為什麼 previous/dialogue 不能進」的取捨理由。
// 這裡只負責把背景頁手上的 context 翻成那支函式要的 scope。
function cacheKey(text, settings, context, videoId) {
  return buildTranslationRequestKey(text, settings, cacheScope(text, context, videoId));
}

function cacheScope(text, context = {}, videoId = "") {
  const mode = context.mode === "subtitle" ? "subtitle" : "page";
  return {
    mode,
    strictTargetLanguage: context.strictTargetLanguage,
    // 被點名要壓縮的那幾句，譯文會不一樣，所以要跟沒被點名的分開存。
    compact: Array.isArray(context.compact) && context.compact.includes(String(text ?? "").trim()),
    // 只算「這一句真的用得到」的術語，用的是通用層同一支 matchTerms。
    // 若改成整批的術語清單，同一句在不同批就會算出不同的 key，
    // 那等於把剛修掉的 bug 換個地方再犯一次。
    //
    // W2-4：兩種模式都算。以前網頁模式恆為空陣列（術語表只存在於字幕），
    // 現在網頁也吃術語表，這個維度若還留空，改了術語譯法之後網頁會繼續
    // 撿到舊譯文——快取沒壞、翻譯沒壞，只是使用者改的東西不生效。
    glossary: glossaryCore?.matchTerms(context.glossary, [text]) ?? [],
    // W2-2：這一段有沒有帶行內富文本的佔位符。從**文字本身**判斷，不從訊息
    // 欄位判斷——內容腳本多一個旗標要傳，網頁／PDF／劃詞三支就有三個地方會忘。
    rich: /[⟦⟧]/.test(String(text ?? "")),
    videoId
  };
}

// 字幕快取一定要綁影片：兩支不同影片的 "Let's go." 是兩件事。content 端沒有
// 送 videoId，這裡從送訊息那個分頁的網址推導，用的是字幕儲存層同一支
// resolveVideoId。認不出來的站台退回「標題＋頻道」，再不行才用網址路徑；
// 三種都拿不到就回空字串（退回舊行為，不會比現況更糟）。
function resolveVideoIdentity(context, sender) {
  if (context?.mode !== "subtitle") return "";
  const url = String(sender?.url ?? sender?.tab?.url ?? "");
  const resolved = subtitleStore?.resolveVideoId?.(url) ?? "";
  if (resolved) return resolved;
  const video = context?.video ?? {};
  const label = [video.title, video.channel].filter(Boolean).join(" \u241f ");
  if (label) return `label:${label}`;
  try {
    const parsed = new URL(url);
    return `url:${parsed.host}${parsed.pathname}`;
  } catch {
    return "";
  }
}

async function updateSettings(patch) {
  const current = await getSettings();
  const allowed = new Set([
    "provider", "uiLanguage", "sourceLanguage", "targetLanguage", "translationStyle", "customPrompt",
    "pageTranslationEnabled", "subtitleTranslationEnabled", "showOriginalSubtitle",
    "selectionTranslationEnabled", "hoverTranslationEnabled", "subtitleExportMode"
    , "inputTranslationEnabled", "dualSubtitleLanguage", "dualSubtitleFallbackLanguage", "opencodeModel", "opencodeProtocol", "opencodeStructuredOutput", "antigravityModel", "geminiModel"
    // 引擎池（W1-2）。忘了加進這張白名單的鍵會被靜默丟掉：訊息回 ok、
    // 設定卻沒變，畫面上完全看不出來。
    , "providerOrder", "providerFallbackEnabled", "providerDisabledUntil"
    // 術語表（W2-4）。同上：漏掉的鍵會被靜默丟掉——選項頁回「已儲存」、
    // 設定卻沒變，而且畫面上完全看不出來。
    , "glossaryEnabled", "glossaryPresetsEnabled", "glossaryPresetDomains"
    // 雙語顯示（W3-1）。同上：漏掉的鍵會被靜默丟掉——懸浮球每次拖完都回
    // 「已儲存」、重新整理球卻跳回原位，而且畫面上完全看不出來。
    , "translationTheme", "displayMode", "floatingBallEnabled", "floatingBallPos"
    // 網站規則庫（W3-2）。同上：漏掉的鍵會被靜默丟掉——選項頁回「已儲存」、
    // 規則卻一條都沒進去，而且畫面上完全看不出來。
    , "siteRulesEnabled", "userSiteRules"
  ]);
  const safePatch = Object.fromEntries(Object.entries(patch ?? {}).filter(([key]) => allowed.has(key)));
  const settings = sanitizeSettings({ ...current, ...safePatch });
  await api.storage.local.set(settings);
  return settings;
}

function sanitizeContext(value) {
  if (typeof value === "string") return { mode: value.includes("subtitle") ? "subtitle" : "page", title: value.slice(0, 240) };
  const context = value && typeof value === "object" ? value : {};
  const sanitized = {
    mode: String(context.mode ?? "page").slice(0, 20),
    title: String(context.title ?? "").slice(0, 240),
    strictTargetLanguage: Boolean(context.strictTargetLanguage),
    previous: Array.isArray(context.previous) ? context.previous.slice(-8).map((item) => ({
      source: String(item?.source ?? "").slice(0, 600),
      translation: String(item?.translation ?? "").slice(0, 600)
    })) : []
  };
  // 三層上下文只走字幕路徑，網頁模式不帶這些欄位（省 token，也少一份要維護的
  // 形狀）。註：cacheKey 已經改成只取指定維度（見 cacheScope），這裡多一個少一個
  // 欄位不會再牽動快取命中率——會牽動的只有 cacheScope 明列的那幾項。
  if (sanitized.mode !== "subtitle") return sanitized;
  sanitized.video = sanitizeVideoInfo(context.video);
  sanitized.glossary = Array.isArray(context.glossary)
    ? context.glossary.slice(0, 40).map((term) => ({
      source: String(term?.source ?? "").trim().slice(0, 80),
      target: String(term?.target ?? "").trim().slice(0, 80)
    })).filter((term) => term.source && term.target)
    : [];
  sanitized.dialogue = Array.isArray(context.dialogue)
    ? context.dialogue.slice(-10).map((item) => ({
      source: String(item?.source ?? "").slice(0, 600),
      translation: String(item?.translation ?? "").slice(0, 600)
    })).filter((pair) => pair.source && pair.translation)
    : [];
  sanitized.compact = Array.isArray(context.compact)
    ? context.compact.slice(0, 40).map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  return sanitized;
}

function sanitizeVideoInfo(value) {
  const source = value && typeof value === "object" ? value : {};
  const info = {};
  const assign = (key, max, skip) => {
    const text = String(source[key] ?? "").replace(/\s+/g, " ").trim().slice(0, max);
    if (text && text !== skip) info[key] = text;
  };
  assign("title", 240);
  assign("channel", 120);
  assign("description", 200);
  assign("sourceLang", 20, "auto");
  assign("targetLang", 20);
  return info;
}

// ============================================================ 全域術語表（W2-4）
//
// 使用者的全域術語存在 storage.local 的一個鍵裡，每翻一批就重讀一次是浪費——
// 但完全不重讀又會讓「剛在選項頁存好的術語」等到 Service Worker 重啟才生效。
// 折衷：記憶體快取 + storage.onChanged 立刻失效。TTL 只是最後一道保險，
// 用來收拾「別的擴充或別的視窗改了同一個鍵而事件沒送到」這種情況。
const GLOSSARY_CACHE_TTL_MS = 30_000;
let globalGlossaryCache = { terms: [], at: 0 };

api.storage.onChanged?.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[glossary.GLOBAL_STORAGE_KEY]) globalGlossaryCache = { terms: [], at: 0 };
});

async function readGlobalTerms() {
  const now = Date.now();
  if (globalGlossaryCache.at && now - globalGlossaryCache.at < GLOSSARY_CACHE_TTL_MS) {
    return globalGlossaryCache.terms;
  }
  const terms = await glossary.readGlobalGlossary(api.storage.local);
  globalGlossaryCache = { terms, at: now };
  return terms;
}

// 預設庫只有 en → zh-Hant 一組對照（見 glossary-presets.js 檔頭）。目標語言
// 不是繁中時整份跳過——把「cache → 快取」塞進一份要翻成日文的 prompt，
// 模型不會報錯，只會照著翻出一句中日夾雜的東西。
function presetTermsFor(settings) {
  if (!settings.glossaryPresetsEnabled) return [];
  if (settings.targetLanguage !== glossaryPresets.PRESET_LANGUAGES.target) return [];
  return glossaryPresets.termsForDomains(settings.glossaryPresetDomains);
}

// 只改 context.glossary，其餘欄位不碰。
async function attachDocumentGlossary(context, settings, segments) {
  if (!context) return context;
  if (context.mode === "subtitle") return attachSubtitleGlossary(context, settings, segments);
  if (!settings.glossaryEnabled) return context;
  const [globalTerms, presetTerms] = [await readGlobalTerms(), presetTermsFor(settings)];
  if (!globalTerms.length && !presetTerms.length) return context;
  const matched = glossary.selectTermsForTexts({ globalTerms, presetTerms, texts: segments });
  if (matched.length) context.glossary = matched.map((term) => ({ source: term.source, target: term.target }));
  return context;
}

// 字幕的術語表由內容腳本備妥（自動分析 ＋ 影片內編輯 ＋ 全域釘選，三個來源已經
// 在 content/subtitle-translator.js 用同一支 resolveEffectiveTerms 疊好），背景頁
// **只補預設庫這一個來源**，其餘一律照收——那三個來源背景頁看不到（自動分析的
// 結果只存在那支影片的紀錄裡），重挑一次只會把它們弄丟。
//
// 疊法走通用層 selectTermsForTexts，不在這裡自己寫一次優先序：
// 內容腳本送來的那些當 globalTerms（優先序 3），預設庫當 presetTerms（優先序 0），
// 同一個 source 撞在一起時使用者那條贏——與網頁／PDF／劃詞完全同一套規則。
//
// 兩道開關都要開才注入：
//   glossaryEnabled       總開關，關掉＝預設庫一個字都不進 prompt
//   glossaryPresetsEnabled 預設庫自己的開關（presetTermsFor 裡判斷，另含目標語言）
// 關掉任何一個，字幕的行為就與 W2-4 之前**逐字相同**（測試守著）：
// 內容腳本送什麼、prompt 就是什麼。
function attachSubtitleGlossary(context, settings, segments) {
  if (!settings.glossaryEnabled) return context;
  const presetTerms = presetTermsFor(settings);
  if (!presetTerms.length) return context;
  const carried = Array.isArray(context.glossary) ? context.glossary : [];
  const matched = glossary.selectTermsForTexts({
    globalTerms: carried,
    presetTerms,
    texts: segments
  });
  // 只增不減。matched 理論上一定含全部 carried（內容腳本已經對同一批原文挑過
  // 一次，用的是同一支 matchTerms），但「理論上」不值得拿使用者自己設的術語去賭：
  // 這裡只把 origin=preset 的那幾條補上去，carried 一條都不動、順序也不動。
  const additions = matched.filter((term) => term.origin === "preset");
  if (!additions.length) return context;
  context.glossary = [...carried, ...additions.map((term) => ({ source: term.source, target: term.target }))]
    .slice(0, glossary.MAX_PROMPT_TERMS);
  return context;
}

// 影片術語表：整支影片只打這一次。字幕主流程不等它，失敗也不影響翻譯。
async function analyzeGlossary(message) {
  if (!glossaryCore) throw diagnostics.diagnosticError("術語分析模組未載入", "GLOSSARY_CORE_MISSING");
  const samples = (Array.isArray(message?.samples) ? message.samples : [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, glossaryCore.ANALYSIS_MAX_SAMPLES);
  if (samples.length < 3) throw diagnostics.diagnosticError("字幕樣本不足，略過術語分析", "GLOSSARY_SAMPLE_TOO_FEW");
  const settings = await getSettings();
  const prompt = glossaryCore.buildAnalysisPrompt(samples, {
    targetLanguage: settings.targetLanguage,
    title: message?.title,
    channel: message?.channel
  });
  const text = await completeText(prompt, settings);
  return glossaryCore.parseGlossaryJson(text);
}

function trimCache(limit) {
  while (cache.size > limit) cache.delete(cache.keys().next().value);
}

function redactSettings(settings) {
  return {
    ...settings,
    opencodeApiKey: settings.opencodeApiKey ? "configured" : "",
    geminiApiKey: settings.geminiApiKey ? "configured" : "",
    geminiApiKeys: settings.geminiApiKeys ? "configured" : "",
    customApiKey: settings.customApiKey ? "configured" : "",
  };
}

function selectedModel(settings) {
  if (settings.provider === "opencode") return settings.opencodeModel;
  if (settings.provider === "antigravity") return settings.antigravityModel;
  if (settings.provider === "custom") return settings.customModel;
  return settings.geminiModel;
}

async function getModelCatalog(refresh = false) {
  const settings = await getSettings();
  const suffix = refresh ? "?refresh=1" : "";
  const response = await bridgeFetch(
    `${settings.bridgeBaseUrl.replace(/\/$/, "")}/models${suffix}`,
    undefined,
    settings
  );
  if (!response.ok) throw diagnostics.diagnosticError(`本機模型服務無法連線（HTTP ${response.status}）`, "CATALOG_FETCH_FAILED", { httpStatus: response.status });
  const catalog = await response.json();
  const fallback = fallbackCatalog();
  return {
    antigravity: Array.isArray(catalog.antigravity) && catalog.antigravity.length ? catalog.antigravity : fallback.antigravity,
    opencode: Array.isArray(catalog.opencode) && catalog.opencode.length ? catalog.opencode : fallback.opencode,
    updatedAt: catalog.updatedAt || null,
    live: true
  };
}

// 只有在本機服務連不上時才會走到這裡。清單是空的比亂編一個已經下架的模型好，
// 至少選項頁會照實說「拿不到清單」，而不是讓人選一個打不通的模型。
function fallbackCatalog() {
  return {
    live: false,
    updatedAt: null,
    antigravity: [{ id: "gemini-3.6-flash-low", name: "Gemini 3.6 Flash (Low)", source: "antigravity" }],
    opencode: []
  };
}


// ------------------------------------------------------------------ 影集學習
//
// 一集大約五到八百句，一次全丟給模型會被截斷，所以分批處理再合併。
// 批次之間互相獨立，一批失敗不影響其他批，最後回報失敗數讓使用者自己判斷。
async function generateStudy(profileInput) {
  const profile = study.resolveLevel(profileInput);
  if (!profile) throw diagnostics.diagnosticError("程度資料不完整", "STUDY_PROFILE_INCOMPLETE");

  const stored = await api.storage.local.get("studyEpisode");
  const episode = stored?.studyEpisode;
  if (!episode?.pairs?.length) throw diagnostics.diagnosticError("沒有字幕資料，請回播放頁重新抓一次", "STUDY_NO_EPISODE");

  const settings = await getSettings();
  // 只留有原文的句子。沒配到中文的仍然有用，模型看得懂原文。
  const usable = episode.pairs.filter((pair) => String(pair.source ?? "").trim());
  const chunks = study.chunkCues(usable, 80);
  const results = [];
  let failed = 0;

  for (let i = 0; i < chunks.length; i += 1) {
    api.runtime.sendMessage({ type: "IMMERSEFREE_STUDY_PROGRESS", done: i, total: chunks.length }).catch(() => {});
    const prompt = study.buildStudyPrompt(chunks[i], profile, { title: episode.title });
    try {
      const text = await completeText(prompt, settings);
      results.push(study.parseStudyJson(text));
    } catch {
      failed += 1;
    }
  }
  api.runtime.sendMessage({ type: "IMMERSEFREE_STUDY_PROGRESS", done: chunks.length, total: chunks.length }).catch(() => {});

  if (!results.length) throw diagnostics.diagnosticError("每一批都失敗了。請確認翻譯引擎可用，或改用 Gemini API。", "STUDY_ALL_BATCHES_FAILED");
  const merged = study.mergeStudyResults(results);
  return {
    ...merged,
    failed,
    batches: chunks.length,
    level: profile.label,
    source: profile.source,
    title: episode.title ?? ""
  };
}
