importScripts(
  "core/i18n-core.js",
  "core/bridge-core.js",
  "core/settings-core.js",
  "core/language-core.js",
  "core/provider-core.js",
  "core/batch-core.js"
);

const api = globalThis.browser ?? globalThis.chrome;
const { DEFAULT_SETTINGS, sanitizeSettings } = globalThis.ImmerseFreeSettingsCore;
const { bridgeFetch } = globalThis.ImmerseFreeBridgeCore;
const { translateWithAntigravity, translateWithCustomApi, translateWithGemini, translateWithOpenCode, listCustomApiModels } = globalThis.ImmerseFreeProviderCore;
const { translateInReliableBatches } = globalThis.ImmerseFreeBatchCore;
const { isAlreadyTargetLanguage } = globalThis.ImmerseFreeLanguage;
const cache = new Map();

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
  api.contextMenus.create({ id: "immersefree-open-pdf", title: "用 ImmerseFree 開啟 PDF", contexts: ["link", "page"] });
}

api.contextMenus?.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === "immersefree-translate-selection") {
    api.tabs.sendMessage(tab.id, { type: "IMMERSEFREE_TRANSLATE_SELECTION", text: info.selectionText }).catch(() => {});
  } else if (info.menuItemId === "immersefree-translate-page") {
    api.tabs.sendMessage(tab.id, { type: "IMMERSEFREE_TRANSLATE_PAGE" }).catch(() => {});
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
});

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "IMMERSEFREE_TRANSLATE") {
    handleTranslation(message, sender)
      .then((translations) => sendResponse({ ok: true, translations }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "IMMERSEFREE_GET_SETTINGS") {
    getSettings()
      .then((settings) => sendResponse({ ok: true, settings: redactSettings(settings) }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "IMMERSEFREE_TEST_PROVIDER") {
    testProvider()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "IMMERSEFREE_UPDATE_SETTINGS") {
    updateSettings(message.settings)
      .then((settings) => sendResponse({ ok: true, settings: redactSettings(settings) }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "IMMERSEFREE_LIST_CUSTOM_MODELS") {
    // 走背景頁而不是選項頁直接 fetch：主機權限掛在擴充功能上，
    // 背景頁是唯一保證拿得到的地方。
    getSettings()
      .then((settings) => listCustomApiModels({ ...settings, ...(message.settings ?? {}) }))
      .then((models) => sendResponse({ ok: true, models }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "IMMERSEFREE_GET_MODEL_CATALOG") {
    getModelCatalog(Boolean(message.refresh))
      .then((catalog) => sendResponse({ ok: true, catalog }))
      .catch((error) => sendResponse({ ok: false, error: error.message, catalog: fallbackCatalog() }));
    return true;
  }
  return false;
});

async function handleTranslation(message, sender) {
  const segments = validateSegments(message.segments);
  const settings = await getSettings();
  const context = sanitizeContext(message.context);
  const keys = segments.map((text) => cacheKey(text, settings, context));
  const missing = [];
  const missingIndexes = [];
  keys.forEach((key, index) => {
    if (isAlreadyTargetLanguage(segments[index], settings.targetLanguage)) {
      cache.set(key, segments[index]);
      return;
    }
    if (!cache.has(key)) {
      missing.push(segments[index]);
      missingIndexes.push(index);
    }
  });
  if (missing.length) {
    const translated = await dispatchProvider(missing, settings, context, sender);
    translated.forEach((text, i) => cache.set(keys[missingIndexes[i]], text));
    trimCache(settings.cacheLimit);
  }
  return keys.map((key) => cache.get(key));
}

async function dispatchProvider(segments, settings, context) {
  return translateInReliableBatches(
    segments,
    context,
    (batch, batchContext) => callSelectedProvider(batch, settings, batchContext),
    8
  );
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
      throw new Error(`Unknown provider: ${settings.provider}`);
  }
}

async function testProvider() {
  const settings = await getSettings();
  const started = performance.now();
  const [translation] = await dispatchProvider(
    ["The quick brown fox jumps over the lazy dog."],
    settings,
    "API connection test"
  );
  return {
    provider: settings.provider,
    model: selectedModel(settings),
    translation,
    latencyMs: Math.round(performance.now() - started)
  };
}

function validateSegments(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 40) {
    throw new Error("Translation request must contain 1-40 segments");
  }
  const segments = value.map((item) => String(item ?? "").trim());
  if (segments.some((item) => !item || item.length > 2000)) {
    throw new Error("Each segment must contain 1-2000 characters");
  }
  if (segments.reduce((sum, item) => sum + item.length, 0) > 12000) {
    throw new Error("Translation request is too large");
  }
  return segments;
}

function cacheKey(text, settings, context) {
  const model = selectedModel(settings);
  return [settings.provider, model, settings.targetLanguage, settings.translationStyle, JSON.stringify(context), text].join("\u241f");
}

async function updateSettings(patch) {
  const current = await getSettings();
  const allowed = new Set([
    "provider", "uiLanguage", "sourceLanguage", "targetLanguage", "translationStyle", "customPrompt",
    "pageTranslationEnabled", "selectionTranslationEnabled", "hoverTranslationEnabled",
    "inputTranslationEnabled", "opencodeModel", "opencodeProtocol", "opencodeStructuredOutput",
    "antigravityModel", "geminiModel"
  ]);
  const safePatch = Object.fromEntries(Object.entries(patch ?? {}).filter(([key]) => allowed.has(key)));
  const settings = sanitizeSettings({ ...current, ...safePatch });
  await api.storage.local.set(settings);
  return settings;
}

function sanitizeContext(value) {
  if (typeof value === "string") return { mode: "page", title: value.slice(0, 240) };
  const context = value && typeof value === "object" ? value : {};
  return {
    mode: String(context.mode ?? "page").slice(0, 20),
    title: String(context.title ?? "").slice(0, 240),
    strictTargetLanguage: Boolean(context.strictTargetLanguage),
    previous: Array.isArray(context.previous) ? context.previous.slice(-8).map((item) => ({
      source: String(item?.source ?? "").slice(0, 600),
      translation: String(item?.translation ?? "").slice(0, 600)
    })) : []
  };
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
  if (!response.ok) throw new Error(`本機模型服務無法連線（HTTP ${response.status}）`);
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
