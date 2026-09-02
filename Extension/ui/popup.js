import "../core/page-translation-ui.js";
import "../core/content-injection.js";
import { getSettings, saveSettings } from "../core/settings.js";
import { extractPdfFileId, normalizePdfSource } from "../core/pdf-source.js";

const api = globalThis.browser ?? globalThis.chrome;
const status = document.querySelector("#status");
const provider = document.querySelector("#provider");
const sourceLanguage = document.querySelector("#source-language");
const targetLanguage = document.querySelector("#target-language");
const selectionButton = document.querySelector("#toggle-selection");
const hoverButton = document.querySelector("#toggle-hover");
const translatePageButton = document.querySelector("#translate-page");
const translatePageLabel = translatePageButton.querySelector("span");
const pageProgress = document.querySelector("#page-progress");
const pageProgressText = document.querySelector("#page-progress-text");
const pageProgressCount = document.querySelector("#page-progress-count");
const pageProgressMeter = document.querySelector("#page-progress-meter");
const { pageTranslationAvailability } = globalThis.ImmerseFreePageTranslationUI;
const { beginSiteAccessRequest, ensureContentScript } = globalThis.ImmerseFreeContentInjection;
let settings = await getSettings();

await loadModelCatalog();
renderSettings();
document.querySelector("#translate-page").addEventListener("click", () => startContentAction("IMMERSEFREE_TRANSLATE_PAGE"));
// 影片字幕與影集學習還沒進 MVP。入口留著並反灰，按下去說清楚它還沒開放，
// 比整個藏起來更誠實——使用者才知道這些功能存在、只是還沒到。
for (const id of ["#ai-subtitle-row", "#dual-subtitle-row", "#study-row"]) {
  document.querySelector(id)?.addEventListener("click", () => setStatus("Coming soon", "pending"));
}
document.querySelector("#open-settings").addEventListener("click", () => api.runtime.openOptionsPage());
document.querySelector("#open-more-settings").addEventListener("click", () => api.runtime.openOptionsPage());
document.querySelector("#translate-pdf").addEventListener("click", openPdfReader);
document.querySelector("#swap-languages").addEventListener("click", swapLanguages);
provider.addEventListener("change", saveQuickSettings);
sourceLanguage.addEventListener("change", saveQuickSettings);
targetLanguage.addEventListener("change", saveQuickSettings);
hoverButton.addEventListener("click", toggleHover);
selectionButton.addEventListener("click", toggleSelection);

function renderSettings() {
  provider.value = `${settings.provider}::${selectedModel(settings)}`;
  sourceLanguage.value = settings.sourceLanguage;
  targetLanguage.value = settings.targetLanguage;
  selectionButton.setAttribute("aria-pressed", String(settings.selectionTranslationEnabled));
  document.querySelector("#selection-state").textContent = settings.selectionTranslationEnabled ? "開" : "關";
  hoverButton.setAttribute("aria-pressed", String(settings.hoverTranslationEnabled));
  document.querySelector("#hover-state").textContent = settings.hoverTranslationEnabled ? "開" : "關";
  const providerState = document.querySelector("#provider-state");
  if (settings.provider === "opencode") providerState.textContent = "OpenCode Free · 清單自動更新";
  else if (settings.provider === "antigravity") providerState.textContent = "Antigravity · 使用登入額度";
  else if (settings.provider === "custom") {
    const label = settings.customApiLabel || "自訂 API";
    providerState.textContent = settings.customModel
      ? `${label} · ${settings.customModel}`
      : `${label} · 尚未設定模型`;
  }
  else {
    const keyCount = String(settings.geminiApiKeys ?? "").split(/[\s,;]+/).filter(Boolean).length
      + (settings.geminiApiKey ? 1 : 0);
    providerState.textContent = keyCount ? `Gemini API · ${keyCount} 把金鑰輪替` : "Gemini API · 尚未設定";
  }
}

async function saveQuickSettings() {
  const [providerId, model] = provider.value.split("::");
  const modelPatch = providerId === "opencode"
    ? { opencodeModel: model }
    : providerId === "antigravity"
      ? { antigravityModel: model }
      : providerId === "custom"
        ? { customModel: model }
        : { geminiModel: model };
  settings = await saveSettings({
    ...settings,
    ...modelPatch,
    provider: providerId,
    sourceLanguage: sourceLanguage.value,
    targetLanguage: targetLanguage.value
  });
  renderSettings();
  await notifyTabSettings();
  setStatus("翻譯設定已更新", "success");
}

async function loadModelCatalog() {
  let catalog;
  try {
    const response = await api.runtime.sendMessage({ type: "IMMERSEFREE_GET_MODEL_CATALOG" });
    catalog = response?.catalog;
    // 清單拿不到時仍有備援目錄可用，所以不會擋住畫面；但如果目前選的引擎
    // 本來就要靠本機 Bridge，使用者就必須知道 Bridge 沒開，否則他只會看到
    // 「選單裡的模型翻不動」而找不到原因。
    if (!response?.ok && response?.error && usesBridge(settings)) {
      setStatus(response.error, "error");
    }
  } catch {}
  if (!catalog) return;
  const currentValue = `${settings.provider}::${selectedModel(settings)}`;
  provider.replaceChildren();
  appendGroup("Antigravity", "antigravity", catalog.antigravity || []);
  appendGroup("OpenCode 免費模型", "opencode", catalog.opencode || []);
  appendGroup("自備 API key", "gemini", [{ id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite" }]);
  // 自訂 OpenAI 相容端點：設定裡填了模型就讓它出現在這個選單，
  // 使用者才能像切換其他引擎一樣直接切過去。
  if (settings.customModel) {
    appendGroup(settings.customApiLabel || "自訂 API", "custom", [{ id: settings.customModel, name: settings.customModel }]);
  }
  if (![...provider.options].some((option) => option.value === currentValue)) {
    const option = new Option(selectedModel(settings), currentValue);
    provider.append(option);
  }
}

function appendGroup(label, providerId, models) {
  if (!models.length) return;
  const group = document.createElement("optgroup");
  group.label = label;
  for (const model of models) {
      const suffix = providerId === "antigravity"
      ? " · 登入額度"
      : providerId === "opencode"
        ? " · 免費"
        : providerId === "custom"
          ? " · 自訂"
          : " · API";
    group.append(new Option(`${model.name}${suffix}`, `${providerId}::${model.id}`));
  }
  provider.append(group);
}

// Antigravity 一定要經過本機 Bridge；OpenCode 只有在沒填自己的金鑰、
// 走免費入口時才會經過。
function usesBridge(value) {
  if (value.provider === "antigravity") return true;
  return value.provider === "opencode" && !value.opencodeApiKey;
}

function selectedModel(value) {
  if (value.provider === "opencode") return value.opencodeModel;
  if (value.provider === "antigravity") return value.antigravityModel;
  if (value.provider === "custom") return value.customModel;
  return value.geminiModel;
}

async function swapLanguages() {
  if (sourceLanguage.value === "auto") {
    sourceLanguage.value = targetLanguage.value;
    targetLanguage.value = settings.sourceLanguage === "auto" ? "en" : settings.sourceLanguage;
  } else {
    const source = sourceLanguage.value;
    sourceLanguage.value = targetLanguage.value;
    targetLanguage.value = source;
  }
  await saveQuickSettings();
}

async function toggleHover() {
  settings = await saveSettings({ ...settings, hoverTranslationEnabled: !settings.hoverTranslationEnabled });
  renderSettings();
  await notifyTabSettings();
  setStatus(settings.hoverTranslationEnabled ? "滑鼠懸停段落 0.7 秒即可翻譯" : "懸停翻譯已關閉", "success");
}

async function toggleSelection() {
  settings = await saveSettings({ ...settings, selectionTranslationEnabled: !settings.selectionTranslationEnabled });
  renderSettings();
  await notifyTabSettings();
  setStatus(settings.selectionTranslationEnabled ? "反白文字後，放開滑鼠就會翻譯" : "反白翻譯已關閉", "success");
}

async function openPdfReader() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const source = extractPdfUrl(tab?.url ?? "");
  const url = new URL(api.runtime.getURL("reader/pdf.html"));
  if (source) url.searchParams.set("src", source);
  await api.tabs.create({ url: url.href });
}

function extractPdfUrl(value) {
  return extractPdfFileId(value) ? value : normalizePdfSource(value);
}

async function notifyTabSettings() {
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await api.tabs.sendMessage(tab.id, { type: "IMMERSEFREE_SETTINGS_CHANGED", settings });
  } catch {}
}

function startContentAction(type) {
  const siteAccessRequest = beginSiteAccessRequest(api);
  void sendToTab(type, siteAccessRequest);
}

async function sendToTab(type, siteAccessRequest) {
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("找不到目前分頁");
    const availability = pageTranslationAvailability(tab.url);
    if (!availability.available) throw new Error(availability.message);
    await ensureContentScript(api, tab, (message) => setStatus(message, "pending"), siteAccessRequest);
    if (type === "IMMERSEFREE_TRANSLATE_PAGE") {
      await translateCurrentPage(tab);
      return;
    }
    const response = await api.tabs.sendMessage(tab.id, { type });
    if (!response?.ok) throw new Error(response?.error ?? "操作失敗");
    setStatus(response.message ?? "完成", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function translateCurrentPage(tab) {
  translatePageButton.disabled = true;
  translatePageLabel.textContent = "翻譯中";
  renderPageProgress({ state:"running", completed:0, total:0, message:"正在讀取網頁段落" });
  let stopped = false;
  let timer;
  const poll = async () => {
    if (stopped) return;
    try {
      const response = await api.tabs.sendMessage(tab.id, { type:"IMMERSEFREE_GET_PAGE_PROGRESS" });
      if (response?.ok && response.progress?.state !== "idle") renderPageProgress(response.progress);
    } catch {}
    if (!stopped) timer = setTimeout(poll, 350);
  };
  poll();
  try {
    const response = await api.tabs.sendMessage(tab.id, { type:"IMMERSEFREE_TRANSLATE_PAGE" });
    if (!response?.ok) throw new Error(response?.error ?? "網頁翻譯失敗");
    if (response.result?.active) {
      renderPageProgress({
        state:"complete",
        completed:response.result.count,
        total:response.result.count,
        message:`翻譯完成，共 ${response.result.count} 段`
      });
    } else {
      pageProgress.hidden = true;
    }
    setStatus(response.message ?? "完成", "success");
  } catch (error) {
    const message = /receiving end|message port|connection|respond/i.test(String(error?.message))
      ? "此分頁尚未載入翻譯功能，請重新整理網頁後再試"
      : error.message;
    renderPageProgress({ state:"error", completed:0, total:0, message });
    throw new Error(message);
  } finally {
    stopped = true;
    clearTimeout(timer);
    translatePageButton.disabled = false;
    translatePageLabel.textContent = "翻譯這個網頁";
  }
}

function renderPageProgress(progress) {
  pageProgress.hidden = false;
  pageProgress.dataset.state = progress.state;
  pageProgressText.textContent = progress.message;
  pageProgressCount.textContent = progress.total ? `${progress.completed} / ${progress.total}` : "";
  pageProgressMeter.max = Math.max(1, progress.total || 1);
  pageProgressMeter.value = progress.total ? progress.completed : 0;
}

function setStatus(message, state) {
  status.textContent = message;
  status.dataset.state = state;
}
