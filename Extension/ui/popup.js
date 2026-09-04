// i18n-core 要先於 diagnostics-core：後者載入時把錯誤碼的英文訊息註冊進字典。
import "../core/i18n-core.js";
import "../core/diagnostics-core.js";
import "../core/page-translation-ui.js";
import "../core/content-injection.js";
import "../core/subtitle-store-core.js";
// glossary-core 必須排在 subtitle-glossary-core 前面。W2-4 把共用邏輯搬進
// 通用層之後，轉接層載入時查不到它會**直接丟例外**，而這裡是 ES module：
// 一個 import 丟例外，整個 popup.js 就一行都不會執行——按鈕沒有事件、
// 設定沒有讀進來、畫面卻長得完全正常（HTML 是靜態的）。症狀是「點翻譯這個
// 網頁完全沒反應、也沒有任何錯誤訊息」。
import "../core/glossary-core.js";
import "../core/subtitle-glossary-core.js";
import "../core/srt-core.js";
// docx-core 依賴 srt-core 的 sanitizeFileBase（檔名清洗只能有一份），排它後面。
import "../core/docx-core.js";
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
const diagnostics = globalThis.ImmerseFreeDiagnosticsCore;

// 錯誤一律查表。W1-4 之前，同一個失敗在 popup、頁面進度條與選項頁各有一句
// 自己的說法（有的是引擎原話、有的是我們包裝過的），使用者對不起來也回報
// 不清楚。現在只要錯誤帶得出 code，這三個地方顯示的就是註冊表裡同一句；
// 沒有 code 的（第三方例外、瀏覽器原生錯誤）才退回原始訊息。
function describeFailure(error) {
  return diagnostics?.describeError(error) ?? String(error?.message ?? error ?? "");
}

// 背景頁／內容腳本的回應把 code 放在 response.code，丟成例外時要一起帶著，
// 否則 catch 到的只是一句字串，查不了表。
function failureFromResponse(response, fallbackMessage) {
  return Object.assign(
    new Error(response?.error ?? fallbackMessage),
    { code: response?.code ?? "" }
  );
}

const { pageTranslationAvailability } = globalThis.ImmerseFreePageTranslationUI;
const { beginSiteAccessRequest, ensureContentScript } = globalThis.ImmerseFreeContentInjection;
const subtitleStore = globalThis.ImmerseFreeSubtitleStore;
const srt = globalThis.ImmerseFreeSrtCore;
// 雙語 Word 匯出（W4-1）：OOXML 組裝在 core，zip 用 popup.html 載進來的
// vendor fflate（classic script，掛在 globalThis）。兩者任一沒載到就只是
// 這顆按鈕報錯，其他功能不受影響。
const docx = globalThis.ImmerseFreeDocxCore;
const fflate = globalThis.fflate;
const exportRow = document.querySelector("#subtitle-export-row");
const exportModeSelect = document.querySelector("#subtitle-export-mode");
const exportButton = document.querySelector("#export-subtitle");
const exportNote = document.querySelector("#subtitle-export-note");
const glossaryCore = globalThis.ImmerseFreeSubtitleGlossary;
const glossaryRow = document.querySelector("#glossary-row");
const glossaryPanel = document.querySelector("#glossary-panel");
const glossaryDomain = document.querySelector("#glossary-domain");
const glossaryVideoList = document.querySelector("#glossary-video-list");
const glossaryGlobalList = document.querySelector("#glossary-global-list");
let exportRecord;
// 打開面板時的原始術語（存檔時用來判斷哪幾列被改過 → 標 userEdited）。
let glossaryVideoId = "";
let glossaryOriginalTerms = [];
let glossaryDomainValue = "";
let settings = await getSettings();

await loadModelCatalog();
renderSettings();
document.querySelector("#translate-page").addEventListener("click", () => startContentAction("IMMERSEFREE_TRANSLATE_PAGE"));
document.querySelector("#toggle-ai-subtitles").addEventListener("click", () => toggleSubtitleMode("ai"));
document.querySelector("#toggle-dual-subtitles").addEventListener("click", () => toggleSubtitleMode("dual"));
document.querySelector("#open-study").addEventListener("click", openStudy);
document.querySelector("#subtitle-status").addEventListener("click", runAudit);
exportButton.addEventListener("click", exportSubtitle);
document.querySelector("#open-glossary").addEventListener("click", toggleGlossaryPanel);
document.querySelector("#glossary-close").addEventListener("click", () => { glossaryPanel.hidden = true; });
document.querySelector("#glossary-add").addEventListener("click", () => {
  glossaryVideoList.append(createGlossaryRow({ source: "", target: "", pinned: false }, true));
});
document.querySelector("#glossary-add-global").addEventListener("click", () => {
  glossaryGlobalList.append(createGlossaryRow({ source: "", target: "", pinned: true }, false));
});
document.querySelector("#glossary-save").addEventListener("click", saveGlossary);
document.querySelector("#audit-close").addEventListener("click", () => { document.querySelector("#audit").hidden = true; });
void syncOnOpen();

// 打開 popup 時同步一次：字幕按鍵要顯示目前的實際狀態，影集學習在不支援的
// 站台上要直接標示出來，不要讓人按了才知道。
async function syncOnOpen() {
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    if (!isStudySite(tab.url)) {
      document.querySelector("#open-study").disabled = true;
      document.querySelector("#study-note").textContent = "只支援 Disney+ 和 Netflix";
      document.querySelector("#toggle-dual-subtitles").disabled = true;
      document.querySelector("#dual-subtitle-note").textContent = "只支援 Disney+ 和 Netflix";
    }
    await refreshSubtitleButtons(tab);
    await refreshSubtitleExport(tab);
    await refreshGlossary(tab);
  } catch {
    // 分頁還沒準備好，維持預設狀態。
  }
  await refreshProviderState();
}

// 轉移不能是沉默的。背景頁換了引擎之後，這裡把「已改用 ○○」直接寫在引擎那一行
// （順便標出正在冷卻的引擎），否則使用者只會覺得「怎麼突然變快／變慢了」。
// 冷卻與最近一次轉移都存在背景頁，popup 只是把它讀出來畫。
async function refreshProviderState() {
  const node = document.querySelector("#provider-state");
  if (!node) return;
  let state;
  try {
    const response = await api.runtime.sendMessage({ type: "IMMERSEFREE_GET_PROVIDER_STATE" });
    state = response?.ok ? response.state : null;
  } catch {
    return;
  }
  if (!state) return;
  // 先把那一行還原成「引擎 · 模型」，再往後接。少了這一步，翻譯進行中每輪
  // 輪詢都會再接一次，同一句「已改用 ○○」會愈疊愈長。
  renderSettings();
  const notes = [];
  // 只講「這一分鐘內剛發生」的轉移。半小時前那一次已經不是現在的狀況，
  // 掛在畫面上只會讓人以為引擎現在還是壞的。
  const recent = state.lastFallback && Date.now() - Number(state.lastFallback.at) < 10 * 60_000
    ? state.lastFallback
    : null;
  if (recent) notes.push(`已改用 ${recent.toLabel}（${recent.fromLabel} 失敗）`);
  for (const item of state.cooling ?? []) {
    if (recent && item.provider === recent.from) continue;
    notes.push(`${item.label ?? item.provider} 冷卻中，約 ${item.seconds} 秒`);
  }
  if (!state.fallbackEnabled) notes.push("自動轉移已關閉");
  if (notes.length) node.textContent = `${node.textContent} · ${notes.join(" · ")}`;
}

// 匯出區只在「這支影片真的有翻譯紀錄」時才出現。
//
// 紀錄由內容腳本寫在 chrome.storage.local，popup 用同一套 resolveVideoId
// 從分頁網址算出鍵值直接讀，不必經過內容腳本（影片頁沒注入時也讀得到）。
async function refreshSubtitleExport(tab) {
  exportRecord = undefined;
  if (!subtitleStore || !srt || !exportRow) return;
  exportRow.hidden = true;
  const videoId = subtitleStore.resolveVideoId(tab?.url ?? "");
  if (!videoId || videoId.startsWith("url:")) return;
  const record = await subtitleStore.readRecord(api.storage.local, videoId);
  const translated = (record?.cues ?? []).filter((cue) => cue.translatedText).length;
  if (!translated) return;
  exportRecord = record;
  exportModeSelect.value = srt.normalizeMode(settings.subtitleExportMode);
  // 整軌到手才敢說是「完整」。串流平台邊播邊下載字幕，只翻了一部分時
  // 按鈕要照實說它匯出的是片段，不要讓人以為拿到的是整集。
  exportButton.textContent = record.trackComplete ? "匯出完整 SRT" : "匯出已翻譯片段";
  exportNote.textContent = `已翻譯 ${translated} 句`;
  exportRow.hidden = false;
}

async function exportSubtitle() {
  if (!exportRecord || !srt) return;
  const mode = srt.normalizeMode(exportModeSelect.value);
  try {
    const content = srt.buildSrt(exportRecord.cues, mode);
    const blocks = srt.countBlocks(exportRecord.cues, mode);
    if (!blocks) throw Object.assign(new Error(diagnostics.messageFor("SUBTITLE_EXPORT_EMPTY")), { code: "SUBTITLE_EXPORT_EMPTY" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    link.download = srt.buildFileName(exportRecord.title, mode, exportRecord.videoId);
    link.click();
    // 立刻撤銷會讓下載在某些版本被取消，等一拍再放。
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    if (settings.subtitleExportMode !== mode) {
      settings = await saveSettings({ ...settings, subtitleExportMode: mode });
    }
    setStatus(`已匯出 ${blocks} 句字幕`, "success");
  } catch (error) {
    setStatus(describeFailure(error), "error");
  }
}
// ── 影片術語表 ──────────────────────────────────────────────
//
// 自動分析的結果存在這支影片的字幕紀錄裡（record.glossary），全域釘選另存
// 一個鍵。這裡讀的是同一份 storage，不必經內容腳本，所以影片頁還沒注入
// 也編輯得到。使用者改過或釘選的項目存檔時標成 userEdited，下一次自動分析
// 只能補空位、蓋不掉它。
async function refreshGlossary(tab) {
  glossaryVideoId = "";
  glossaryOriginalTerms = [];
  if (!subtitleStore || !glossaryCore || !glossaryRow) return;
  glossaryRow.hidden = true;
  glossaryPanel.hidden = true;
  const videoId = subtitleStore.resolveVideoId(tab?.url ?? "");
  if (!videoId || videoId.startsWith("url:")) return;
  const record = await subtitleStore.readRecord(api.storage.local, videoId);
  if (!record) return;
  glossaryVideoId = videoId;
  const glossary = glossaryCore.normalizeGlossary(record.glossary);
  glossaryOriginalTerms = glossary.terms;
  document.querySelector("#glossary-note").textContent = glossary.terms.length
    ? `已收錄 ${glossary.terms.length} 個術語`
    : "固定這支影片的專有名詞譯法";
  glossaryRow.hidden = false;
}

async function toggleGlossaryPanel() {
  if (!glossaryPanel.hidden) {
    glossaryPanel.hidden = true;
    return;
  }
  try {
    const record = await subtitleStore.readRecord(api.storage.local, glossaryVideoId);
    const glossary = glossaryCore.normalizeGlossary(record?.glossary);
    glossaryOriginalTerms = glossary.terms;
    glossaryDomainValue = glossary.domain;
    glossaryDomain.textContent = glossary.domain ? `領域：${glossary.domain}` : "";
    glossaryDomain.hidden = !glossary.domain;
    renderGlossaryList(glossaryVideoList, glossary.terms, true);
    renderGlossaryList(glossaryGlobalList, await glossaryCore.readGlobalGlossary(api.storage.local), false);
    glossaryPanel.hidden = false;
  } catch (error) {
    setStatus(describeFailure(error), "error");
  }
}

function renderGlossaryList(container, terms, withPin) {
  container.textContent = "";
  if (!terms.length) {
    const empty = document.createElement("p");
    empty.className = "glossary-empty";
    empty.textContent = "還沒有術語";
    container.append(empty);
    return;
  }
  for (const term of terms) container.append(createGlossaryRow(term, withPin));
}

function createGlossaryRow(term, withPin) {
  const row = document.createElement("div");
  row.className = "glossary-item";
  const source = document.createElement("input");
  source.className = "glossary-source";
  source.value = term.source ?? "";
  // 用「原文詞」而不是「原文」：後者在介面字典裡已經是語言選單的標籤（From），
  // 借用會讓英文介面把這個輸入框標成 From。
  source.placeholder = "原文詞";
  source.setAttribute("aria-label", "原文詞");
  const target = document.createElement("input");
  target.className = "glossary-target";
  target.value = term.target ?? "";
  target.placeholder = "固定譯法";
  target.setAttribute("aria-label", "固定譯法");
  row.append(source, target);
  if (withPin) {
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "glossary-icon glossary-pin";
    pin.setAttribute("aria-pressed", String(Boolean(term.pinned)));
    pin.setAttribute("aria-label", "釘選這個術語");
    pin.append(Object.assign(document.createElement("i"), { className: "ph ph-push-pin" }));
    pin.addEventListener("click", () => {
      pin.setAttribute("aria-pressed", pin.getAttribute("aria-pressed") === "true" ? "false" : "true");
    });
    row.append(pin);
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "glossary-icon glossary-delete";
  remove.setAttribute("aria-label", "刪除這個術語");
  remove.textContent = "×";
  remove.addEventListener("click", () => row.remove());
  row.append(remove);
  return row;
}

function collectGlossaryRows(container) {
  return [...container.querySelectorAll(".glossary-item")].map((row) => ({
    source: row.querySelector(".glossary-source")?.value ?? "",
    target: row.querySelector(".glossary-target")?.value ?? "",
    pinned: row.querySelector(".glossary-pin")?.getAttribute("aria-pressed") === "true"
  }));
}

async function saveGlossary() {
  try {
    const videoTerms = glossaryCore.markUserEdits(glossaryOriginalTerms, collectGlossaryRows(glossaryVideoList));
    const globalTerms = await glossaryCore.writeGlobalGlossary(
      api.storage.local,
      collectGlossaryRows(glossaryGlobalList)
    );
    // 領域是自動分析的產物，使用者不編輯它，原樣寫回。
    await subtitleStore.writeGlossary(api.storage.local, glossaryVideoId, { domain: glossaryDomainValue, terms: videoTerms });
    glossaryOriginalTerms = videoTerms;
    document.querySelector("#glossary-note").textContent = videoTerms.length
      ? `已收錄 ${videoTerms.length} 個術語`
      : "固定這支影片的專有名詞譯法";
    setStatus(`已儲存 ${videoTerms.length} 個影片術語、${globalTerms.length} 個全域術語`, "success");
  } catch (error) {
    setStatus(describeFailure(error), "error");
  }
}

document.querySelector("#open-settings").addEventListener("click", () => api.runtime.openOptionsPage());
document.querySelector("#open-more-settings").addEventListener("click", () => api.runtime.openOptionsPage());
document.querySelector("#translate-pdf").addEventListener("click", openPdfReader);
document.querySelector("#translate-epub").addEventListener("click", openEpubReader);
document.querySelector("#export-docx").addEventListener("click", exportPageDocx);
document.querySelector("#swap-languages").addEventListener("click", swapLanguages);
provider.addEventListener("change", saveQuickSettings);
sourceLanguage.addEventListener("change", saveQuickSettings);
targetLanguage.addEventListener("change", saveQuickSettings);
hoverButton.addEventListener("click", toggleHover);
selectionButton.addEventListener("click", toggleSelection);
document.querySelector("#mode-bilingual").addEventListener("click", () => setDisplayMode("bilingual"));
document.querySelector("#mode-translation-only").addEventListener("click", () => setDisplayMode("translationOnly"));

// 顯示模式快切（W3-1）。存進 storage 後內容腳本自己聽 storage.onChanged 換
// 屬性，這裡不必逐分頁廣播；「僅譯文」只是把原文 display:none，隨時切得回來。
async function setDisplayMode(mode) {
  if (settings.displayMode === mode) return;
  settings = await saveSettings({ ...settings, displayMode: mode });
  renderSettings();
  setStatus(mode === "translationOnly" ? "僅顯示譯文（原文暫時隱藏，隨時可切回）" : "已恢復雙語對照", "success");
}

function renderSettings() {
  provider.value = `${settings.provider}::${selectedModel(settings)}`;
  sourceLanguage.value = settings.sourceLanguage;
  targetLanguage.value = settings.targetLanguage;
  selectionButton.setAttribute("aria-pressed", String(settings.selectionTranslationEnabled));
  document.querySelector("#selection-state").textContent = settings.selectionTranslationEnabled ? "開" : "關";
  hoverButton.setAttribute("aria-pressed", String(settings.hoverTranslationEnabled));
  document.querySelector("#hover-state").textContent = settings.hoverTranslationEnabled ? "開" : "關";
  document.querySelector("#mode-bilingual").setAttribute("aria-pressed", String(settings.displayMode !== "translationOnly"));
  document.querySelector("#mode-translation-only").setAttribute("aria-pressed", String(settings.displayMode === "translationOnly"));
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

async function openEpubReader() {
  await api.tabs.create({ url: api.runtime.getURL("reader/epub.html") });
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
    if (!tab?.id) throw Object.assign(new Error(diagnostics.messageFor("TAB_NOT_FOUND")), { code: "TAB_NOT_FOUND" });
    const availability = pageTranslationAvailability(tab.url);
    if (!availability.available) throw new Error(availability.message);
    await ensureContentScript(api, tab, (message) => setStatus(message, "pending"), siteAccessRequest);
    if (type === "IMMERSEFREE_TRANSLATE_PAGE") {
      await translateCurrentPage(tab);
      return;
    }
    const response = await api.tabs.sendMessage(tab.id, { type });
    if (!response?.ok) throw failureFromResponse(response, "操作失敗");
    setStatus(response.message ?? "完成", "success");
  } catch (error) {
    setStatus(describeFailure(error), "error");
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
      // 翻譯進行中就換了引擎的話，這一行要當場變，不必等使用者重開 popup。
      await refreshProviderState();
    } catch {}
    if (!stopped) timer = setTimeout(poll, 350);
  };
  poll();
  try {
    const response = await api.tabs.sendMessage(tab.id, { type:"IMMERSEFREE_TRANSLATE_PAGE" });
    if (!response?.ok) throw failureFromResponse(response, "網頁翻譯失敗");
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
    // 「receiving end does not exist」是瀏覽器原生的訊息，沒有 code 可查，
    // 所以在這裡補一個：使用者要看的是「重新整理網頁」，不是那句英文。
    const notReady = /receiving end|message port|connection|respond/i.test(String(error?.message));
    const code = notReady ? "PAGE_SCRIPT_NOT_READY" : String(error?.code ?? "");
    const message = notReady ? diagnostics.messageFor("PAGE_SCRIPT_NOT_READY") : describeFailure(error);
    renderPageProgress({ state:"error", completed:0, total:0, message });
    throw Object.assign(new Error(message), { code });
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


async function toggleSubtitleMode(mode) {
  const siteAccessRequest = beginSiteAccessRequest(api);
  const button = document.querySelector(mode === "dual" ? "#toggle-dual-subtitles" : "#toggle-ai-subtitles");
  button.disabled = true;
  setStatus("", "");
  try {
    const tab = await activeTab();
    await ensureContentScript(api, tab, (message) => setStatus(message, "pending"), siteAccessRequest);
    const response = await api.tabs.sendMessage(tab.id, {
      type: mode === "dual" ? "IMMERSEFREE_TOGGLE_DUAL_SUBTITLES" : "IMMERSEFREE_TOGGLE_AI_SUBTITLES"
    });
    if (!response?.ok) throw failureFromResponse(response, "操作失敗");
    setStatus(response.message ?? "完成", "success");
    await refreshSubtitleButtons(tab);
  } catch (error) {
    setStatus(describeFailure(error), "error");
    try { await refreshSubtitleButtons(await activeTab()); } catch {}
  } finally {
    button.disabled = false;
  }
}

async function activeTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw Object.assign(new Error(diagnostics.messageFor("TAB_NOT_FOUND")), { code: "TAB_NOT_FOUND" });
  const availability = pageTranslationAvailability(tab.url);
  if (!availability.available) throw new Error(availability.message);
  return tab;
}

// 打開 popup 時先問分頁現在的狀態，按鍵文字才不會跟實際情況對不上。
async function refreshSubtitleButtons(tab) {
  try {
    const states = await api.tabs.sendMessage(tab.id, { type: "IMMERSEFREE_GET_SUBTITLE_STATES" });
    if (!states?.ok) return;
    const ai = document.querySelector("#toggle-ai-subtitles");
    const dual = document.querySelector("#toggle-dual-subtitles");
    ai.textContent = states.ai ? "關閉" : "開啟";
    dual.textContent = states.dual ? "關閉" : "開啟";
    ai.setAttribute("aria-pressed", String(Boolean(states.ai)));
    dual.setAttribute("aria-pressed", String(Boolean(states.dual)));
    setSubtitleIndicator(states.ai && states.dual ? "conflict" : states.dual ? "dual" : states.ai ? "ai" : "off");
  } catch {
    // 內容腳本還沒注入，這時就是還沒開始用，顯示成未開啟。
    setSubtitleIndicator("off");
  }
}

function setSubtitleIndicator(mode) {
  const status = document.querySelector("#subtitle-status");
  status.dataset.mode = mode;
  status.querySelector("span").textContent = mode === "ai" ? "AI 字幕運作中 · 使用模型額度"
    : mode === "dual" ? "雙軌字幕運作中 · 不使用模型額度"
      : mode === "conflict" ? "字幕模式衝突"
        : "字幕未開啟";
}

// 影集學習只在有完整字幕軌的串流平台上有意義。
function isStudySite(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return /(^|\.)(disneyplus\.com|netflix\.com)$/.test(host);
  } catch {
    return false;
  }
}

async function openStudy() {
  const siteAccessRequest = beginSiteAccessRequest(api);
  const button = document.querySelector("#open-study");
  button.disabled = true;
  setStatus("正在抓這一集的雙語字幕…", "pending");
  try {
    const tab = await activeTab();
    if (!isStudySite(tab.url)) throw new Error("影集學習目前只支援 Disney+ 和 Netflix");
    await ensureContentScript(api, tab, (message) => setStatus(message, "pending"), siteAccessRequest);
    const response = await api.tabs.sendMessage(tab.id, { type: "IMMERSEFREE_COLLECT_STUDY" });
    if (!response?.ok) throw failureFromResponse(response, "抓字幕失敗");
    await api.storage.local.set({
      studyEpisode: {
        title: response.title ?? "",
        url: response.url ?? tab.url,
        pairs: response.pairs ?? [],
        learnLanguage: response.learnLanguage ?? "",
        helpLanguage: response.helpLanguage ?? "",
        collectedAt: Date.now()
      }
    });
    setStatus(`抓到 ${response.pairs.length} 句，開啟學習頁`, "success");
    await api.tabs.create({ url: api.runtime.getURL("ui/study.html") });
  } catch (error) {
    setStatus(describeFailure(error), "error");
  } finally {
    button.disabled = false;
  }
}


// ── 匯出雙語 Word（W4-1）─────────────────────────────────────
//
// 「讀完能帶走」的第二條路（第一條是 SRT）。配對從內容腳本拿——以畫面上
// 真的插進去的譯文節點為準，所以匯出的內容一定等於使用者看到的內容。
// docx 的 OOXML 組裝與檔名清洗都在 core（core/docx-core.js），這裡只做
// 訊息往返與下載。
async function exportPageDocx() {
  const siteAccessRequest = beginSiteAccessRequest(api);
  const button = document.querySelector("#export-docx");
  button.disabled = true;
  setStatus("正在收集這一頁的譯文…", "pending");
  try {
    if (!docx || !fflate) throw new Error("匯出模組沒有載入，請重新載入擴充功能後再試");
    const tab = await activeTab();
    await ensureContentScript(api, tab, (message) => setStatus(message, "pending"), siteAccessRequest);
    const response = await api.tabs.sendMessage(tab.id, { type: "IMMERSEFREE_COLLECT_PAGE_PAIRS" });
    if (!response?.ok) throw failureFromResponse(response, "收集譯文失敗");
    const pairs = response.pairs ?? [];
    // 一段都沒有的時候講清楚下一步，不要只說「失敗」——最常見的原因是
    // 還沒按過「翻譯這個網頁」。
    if (!pairs.length) throw new Error("這一頁還沒有譯文可以匯出。請先按「翻譯這個網頁」。");
    const title = response.title || tab.title || "translation";
    const { zipObject, pairCount } = docx.buildDocxZipEntries({
      title,
      sections: [{ pairs }],
      at: Date.now()
    });
    const bytes = fflate.zipSync(zipObject);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    }));
    link.download = docx.buildDocxFileName(title);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    setStatus(`已匯出 ${pairCount} 段雙語 Word`, "success");
  } catch (error) {
    setStatus(describeFailure(error), "error");
  } finally {
    button.disabled = false;
  }
}

// 一鍵指認畫面上每一行中文是誰畫的。
//
// 同時裝了好幾個翻譯類擴充功能時，光看畫面完全分不出來——每個都在字幕下面
// 加一行中文。這個直接掃畫面下半部帶文字的元素，用我們自己的標記把
// 「我們畫的」和「別人畫的」分開，省掉貼 Console 和開 allow pasting 的麻煩。
async function runAudit() {
  const panel = document.querySelector("#audit");
  const body = document.querySelector("#audit-body");
  panel.hidden = false;
  body.textContent = "掃描中…";
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw Object.assign(new Error(diagnostics.messageFor("TAB_NOT_FOUND")), { code: "TAB_NOT_FOUND" });
    const [result] = await api.scripting.executeScript({ target: { tabId: tab.id }, func: auditSubtitleOwners });
    renderAudit(result?.result);
  } catch (error) {
    body.textContent = `無法掃描：${error.message}`;
  }
}

// 這個函式會被序列化後注入分頁執行，所以必須完全自足，不能引用外面的任何東西。
function auditSubtitleOwners() {
  const own = (node) => {
    if (node.classList.contains("immersefree-streaming-translation")) {
      const source = node.dataset.immerseFreeSource;
      return {
        ours: true,
        owner: source === "dual" ? "ImmerseFree：雙軌字幕"
          : source === "ai" ? "ImmerseFree：AI 影片字幕"
            : "ImmerseFree：字幕列（無來源標記，代表跑的是舊版）"
      };
    }
    if (node.classList.contains("immersefree-page-translation")) return { ours: true, owner: "ImmerseFree：網頁翻譯插入的譯文" };
    if (node.classList.contains("immersefree-youtube-translation")) return { ours: true, owner: "ImmerseFree：YouTube 字幕" };
    if (node.closest("[data-immersefree-extension-root]")) return { ours: true, owner: "ImmerseFree：其他元素" };
    return { ours: false, owner: "" };
  };

  const hasChinese = (text) => /[一-鿿]/.test(text);
  const items = [];
  for (const node of document.querySelectorAll("body *")) {
    const rect = node.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 8) continue;
    if (rect.top < innerHeight * 0.45) continue;
    const style = getComputedStyle(node);
    if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") continue;
    // 只取直接持有文字的元素，避免把每一層外框都列出來。
    const text = [...node.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join("").trim();
    if (text.length < 2 || text.length > 200) continue;
    const info = own(node);
    let owner = info.owner;
    if (!info.ours) {
      // 不是我們的就盡量指出來源：先看是不是播放器自己的節點。
      const inPlayer = node.closest("[class*='subtitle'],[class*='caption'],[class*='timedtext'],[data-uia*='player']");
      owner = inPlayer ? "播放器自己的字幕" : "別的擴充功能（或頁面自己）插入的";
    }
    items.push({
      ours: info.ours,
      owner,
      chinese: hasChinese(text),
      top: Math.round(rect.top),
      text: text.slice(0, 70),
      className: String(node.className ?? "").slice(0, 70)
    });
  }
  items.sort((a, b) => a.top - b.top);
  return {
    items,
    ourLines: document.querySelectorAll(".immersefree-streaming-translation").length,
    pageTranslations: document.querySelectorAll(".immersefree-page-translation").length
  };
}

function renderAudit(result) {
  const body = document.querySelector("#audit-body");
  if (!result) {
    body.textContent = "沒有取得結果。";
    return;
  }
  const chinese = result.items.filter((item) => item.chinese);
  if (!chinese.length) {
    body.textContent = "現在畫面下半部沒有中文。等字幕出現時再點一次。";
    return;
  }
  body.replaceChildren(...chinese.map((item) => {
    const node = document.createElement("div");
    node.className = "audit-item";
    node.dataset.ours = String(item.ours);
    node.innerHTML =
      `<span class="audit-owner">${escapeHtml(item.owner)}</span>` +
      `<span class="audit-text">${escapeHtml(item.text)}</span>`;
    return node;
  }));
  const note = document.createElement("p");
  note.className = "audit-note";
  const stray = chinese.filter((item) => !item.ours).length;
  note.textContent = stray
    ? `其中 ${stray} 行不是 ImmerseFree 畫的。我們的字幕列共 ${result.ourLines} 條（正常是 0 或 1）。`
    : `全部都是 ImmerseFree 畫的。字幕列共 ${result.ourLines} 條。`;
  body.append(note);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
