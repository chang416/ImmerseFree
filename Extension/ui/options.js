import { getSettings, saveSettings } from "../core/settings.js";
// 只為了 isProviderConfigured／providerLabel：備援清單要標出「這個引擎現在
// 到底能不能當備援」，而那個判準只能有一份，不能在選項頁再寫一次。
import "../core/provider-core.js";
// i18n-core 必須排在 diagnostics-core 前面：後者載入時會把每個錯誤碼的英文
// 訊息註冊進字典，字典還沒建好就會靜默註冊不到（切英文時診斷頁會露出中文）。
import "../core/i18n-core.js";
import "../core/diagnostics-core.js";
// 術語表通用層與預設庫（W2-4）。挑選、正規化、匯入匯出的邏輯全部在 core，
// 這一頁只負責畫出來與收使用者的輸入——選項頁再寫一套正規化，遲早會跟
// 背景頁實際採用的那一套分岔。
import "../core/glossary-core.js";
import "../core/glossary-presets.js";
// 網站規則（W3-2）。驗證、比對、疊加的邏輯全部在 core，這一頁只負責畫出來、
// 收使用者貼的 JSON、把驗證訊息原樣顯示。選項頁自己寫一套驗證，遲早會跟
// 內容腳本執行期實際採用的那一套分岔——症狀是「這裡說合法、實際沒生效」。
import "../core/site-rules-core.js";

const api = globalThis.browser ?? globalThis.chrome;
const providerCore = globalThis.ImmerseFreeProviderCore;
const diagnostics = globalThis.ImmerseFreeDiagnosticsCore;
const settingsCore = globalThis.ImmerseFreeSettingsCore;
const glossaryCore = globalThis.ImmerseFreeGlossaryCore;
const glossaryPresets = globalThis.ImmerseFreeGlossaryPresets;
const siteRulesCore = globalThis.ImmerseFreeSiteRulesCore;
const form = document.querySelector("#settings-form");
const provider = document.querySelector("#provider");
const status = document.querySelector("#status");
const submitButton = document.querySelector("#save-test");
const refreshOpenCodeButton = document.querySelector("#refresh-opencode-models");

// 免費模型清單完全由本機服務算出來，這裡不寫死任何模型 id。清單裡沒有的
// 舊選擇會自動換成第一個還活著的模型，使用者不必自己發現模型被下架了。
//
// 這行必須排在頂層的 load() 呼叫之前：load() 會去填這個變數，而模組頂層的
// await 會在後面的宣告被求值前就跑完，放在下面會踩到 TDZ，例外還會被 catch 吃掉。
let openCodeModels = [];
// 同理，備援順序也必須在 load() 之前宣告好（load() 會寫它）。
let providerOrder = [];

// 主題選擇器（W3-1）要在 load() 之前畫好：load() 用 form.elements 把存檔值
// 塞回欄位，radio 群組不存在的話 translationTheme 會被靜默跳過。
renderThemeGrid();
await load();
setupTabs();
provider.addEventListener("change", updateProviderFields);
document.querySelector("#providerFallbackEnabled").addEventListener("change", renderProviderOrder);
form.addEventListener("submit", saveAndTest);
refreshOpenCodeButton.addEventListener("click", () => refreshOpenCodeModels(true));
document.querySelector("#fetch-custom-models").addEventListener("click", fetchCustomModels);

// 自訂端點可以是任何網域，主機權限得在使用者按下按鍵時當場請求，
// 否則背景頁 fetch 會被擋掉。
async function ensureCustomApiPermission(baseUrl) {
  try {
    const origin = new URL(baseUrl).origin + "/*";
    if (await api.permissions.contains({ origins: [origin] })) return true;
    return await api.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

async function fetchCustomModels() {
  const button = document.querySelector("#fetch-custom-models");
  const note = document.querySelector("#custom-model-count");
  const baseUrl = form.elements.namedItem("customApiBaseUrl").value.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    note.textContent = "請先填寫 API base URL";
    return;
  }
  button.disabled = true;
  note.textContent = "抓取中…";
  try {
    if (!(await ensureCustomApiPermission(baseUrl))) {
      throw new Error("需要授權存取這個網域才能連線");
    }
    const response = await api.runtime.sendMessage({
      type: "IMMERSEFREE_LIST_CUSTOM_MODELS",
      settings: {
        customApiBaseUrl: baseUrl,
        customApiKey: form.elements.namedItem("customApiKey").value.trim()
      }
    });
    if (!response?.ok) throw new Error(response?.error || "無法取得模型清單");
    const models = response.models ?? [];
    document.querySelector("#custom-model-list").replaceChildren(
      ...models.map((model) => { const option = document.createElement("option"); option.value = model.id; return option; })
    );
    note.textContent = models.length
      ? `這把金鑰可用 ${models.length} 個模型，直接在上面的欄位選或輸入`
      : "這個端點沒有回傳任何模型，請直接輸入模型 id";
  } catch (error) {
    note.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}
document.querySelector("#geminiApiKeys").addEventListener("input", renderKeyCount);
document.querySelector("#export-settings").addEventListener("click", exportSettingsToFile);
document.querySelector("#import-settings").addEventListener("click", () => document.querySelector("#import-file").click());
document.querySelector("#import-file").addEventListener("change", importSettingsFromFile);

// 設定搬家：金鑰存在 chrome.storage.local，不會跟 Google 帳號同步，
// 換電腦時靠這兩顆按鈕把整份設定（含金鑰）搬過去。
async function exportSettingsToFile() {
  const settings = await getSettings();
  const text = globalThis.ImmerseFreeSettingsCore.buildSettingsExport(settings, api.runtime.getManifest().version);
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "ImmerseFree-設定.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  setStatus("已匯出「ImmerseFree-設定.json」（內含 API 金鑰，請妥善保管）", "success");
}

async function importSettingsFromFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const settings = globalThis.ImmerseFreeSettingsCore.parseSettingsImport(await file.text());
    await saveSettings(settings);
    await load();
    const keyCount = settings.geminiApiKeys.split("\n").filter(Boolean).length;
    setStatus(keyCount ? `已匯入設定（含 ${keyCount} 把 Gemini 金鑰）` : "已匯入設定", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

// 把「解析到幾把、各是哪幾把的開頭」直接顯示出來。之前完全沒有回饋，
// 貼了九把但被解析成一團也不會有人知道。
function parsedGeminiKeys() {
  return String(form.elements.namedItem("geminiApiKeys").value ?? "")
    .split(/[\s,;]+/)
    .map((key) => key.trim())
    .filter(Boolean)
    .filter((key, index, all) => all.indexOf(key) === index);
}

function renderKeyCount() {
  const keys = parsedGeminiKeys();
  const node = document.querySelector("#gemini-key-count");
  if (!keys.length) {
    node.textContent = "尚未填入金鑰";
    return;
  }
  const preview = keys.map((key) => key.slice(0, 8) + "…").join("、");
  node.textContent = `偵測到 ${keys.length} 把金鑰：${preview}`;
}

async function load() {
  const settings = await getSettings();
  await refreshOpenCodeModels(false, settings.opencodeModel);
  for (const [key, value] of Object.entries(settings)) {
    const input = form.elements.namedItem(key);
    if (!input) continue;
    if (input.type === "checkbox") input.checked = Boolean(value);
    else if (key === "providerOrder") input.value = settingsCore.normalizeProviderOrder(value).join(",");
    else if (key === "providerDisabledUntil") continue;
    else input.value = value;
  }
  providerOrder = settingsCore.normalizeProviderOrder(settings.providerOrder);
  renderProviderOrder();
  updateProviderFields();
  renderKeyCount();
}

// ---------------------------------------------------------------- 雙語顯示主題（W3-1）
//
// 主題 id 的正本在 settings-core 的 THEME_IDS；這裡只有顯示名稱。預覽容器掛
// data-imf-theme、裡面放一段 .immersefree-page-translation，吃的是 head 引進來的
// content.css——預覽用的就是網頁上真正那套規則，不存在「預覽好看、實際不同」。
function renderThemeGrid() {
  // 顯示名稱表放在函式裡，不放模組頂層：renderThemeGrid() 在模組最上面、
  // await load() 之前就被呼叫（radio 群組要先存在），函式宣告會被提升、
  // 頂層 const 不會——放外面就是 TDZ ReferenceError，整個選項頁一行都不跑
  // （這正是上面 openCodeModels 註解警告過的同一種死法，實測踩過一次）。
  const THEME_LABELS = {
    classic: "經典邊線",
    underline: "底線",
    dashed: "虛線",
    wavy: "波浪線",
    highlight: "高亮",
    quote: "引用塊",
    faded: "弱化",
    italic: "斜體",
    bold: "粗體",
    card: "紙片",
    divider: "分隔線",
    plain: "無裝飾"
  };
  const grid = document.querySelector("#theme-grid");
  if (!grid) return;
  grid.replaceChildren(...settingsCore.THEME_IDS.map((id) => {
    const label = document.createElement("label");
    label.className = "theme-card";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "translationTheme";
    radio.value = id;

    const name = document.createElement("span");
    name.className = "theme-card-name";
    name.textContent = THEME_LABELS[id] ?? id;

    const preview = document.createElement("div");
    preview.className = "theme-card-preview";
    preview.dataset.imfTheme = id;
    const source = document.createElement("p");
    source.className = "theme-card-source";
    source.textContent = "Reading, after a certain age, diverts the mind.";
    const translation = document.createElement("p");
    // 預覽樣張走真的譯文 class；字串裡刻意含全形標點與中英夾雜，
    // 一眼看得出行高與標點擠壓（classic 的印刷層）長什麼樣。
    translation.className = "immersefree-page-translation";
    translation.textContent = "「到了某個年紀，閱讀會讓心思分歧」——樣張 Sample 123。";
    preview.append(source, translation);

    label.append(radio, name, preview);
    return label;
  }));
}

// ---------------------------------------------------------------- 引擎池順序
//
// 用上／下移而不是拖曳：拖曳在 4 列的清單上沒有好處，卻要處理鍵盤操作、
// 觸控、與 :focus 遺失。順序寫進 hidden input，因為儲存走的是 FormData——
// 只在記憶體裡改陣列的話，按下「儲存並測試」會把它整個丟掉。
function renderProviderOrder() {
  const list = document.querySelector("#provider-order-list");
  if (!list) return;
  const settings = Object.fromEntries(new FormData(form));
  list.replaceChildren(...providerOrder.map((id, index) => {
    const row = document.createElement("li");
    row.dataset.provider = id;

    const name = document.createElement("span");
    name.className = "provider-order-name";
    name.textContent = providerCore.providerLabel(id, settings);
    row.append(name);

    const state = document.createElement("span");
    state.className = "provider-order-state";
    // 這裡讀的是表單上的當下值，不是已存檔的設定：使用者剛貼完金鑰、還沒按
    // 儲存時，清單就該立刻說「可用」。
    state.textContent = providerCore.isProviderConfigured(id, settings) ? "可當備援" : "尚未設定，會跳過";
    row.append(state);

    row.append(moveButton(id, index, -1, "上移"), moveButton(id, index, 1, "下移"));
    return row;
  }));
  form.elements.namedItem("providerOrder").value = providerOrder.join(",");
  renderProviderPoolNote(settings);
}

function moveButton(id, index, delta, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = delta < 0 ? "↑" : "↓";
  button.setAttribute("aria-label", `${label} ${providerCore.providerLabel(id, {})}`);
  button.disabled = index + delta < 0 || index + delta >= providerOrder.length;
  button.addEventListener("click", () => {
    const next = [...providerOrder];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    providerOrder = next;
    renderProviderOrder();
  });
  return button;
}

function renderProviderPoolNote(settings) {
  const note = document.querySelector("#provider-pool-note");
  if (!note) return;
  const enabled = form.elements.namedItem("providerFallbackEnabled").checked;
  if (!enabled) {
    note.textContent = "自動轉移已關閉：選定的引擎失敗時就直接回報錯誤，不會改用其他引擎。";
    return;
  }
  const selected = String(settings.provider ?? "");
  const backups = providerOrder.filter((id) => id !== selected && providerCore.isProviderConfigured(id, settings));
  note.textContent = backups.length
    ? `目前的轉移鏈：${[selected, ...backups].map((id) => providerCore.providerLabel(id, settings)).join(" → ")}`
    : "目前沒有任何可用的備援引擎（其他引擎都還沒填金鑰或網址），失敗時只會回報錯誤。";
}

async function refreshOpenCodeModels(refresh = false, selectedModel = "") {
  refreshOpenCodeButton.disabled = true;
  try {
    const response = await api.runtime.sendMessage({ type: "IMMERSEFREE_GET_MODEL_CATALOG", refresh });
    const models = response?.catalog?.opencode || [];
    if (!models.length) throw new Error(response?.error || "目前無法取得免費模型清單");
    openCodeModels = models;
    const select = form.elements.namedItem("opencodeModel");
    const current = selectedModel || select.value;
    select.replaceChildren(...models.map((model) => new Option(model.name, model.id)));
    const stillAvailable = models.some((model) => model.id === current);
    select.value = stillAvailable ? current : models[0].id;
    if (refresh) setStatus(`已更新，共 ${models.length} 個免費模型`, "success");
    else if (current && !stillAvailable) {
      setStatus(`「${current}」已經下架，改用「${models[0].name}」`, "success");
    }
  } catch (error) {
    // 拿不到清單時，至少把使用者原本存的模型留在選單裡；否則 select.value 會變成
    // 空字串，接著按「儲存並測試」就會把原本的設定洗掉。
    const select = form.elements.namedItem("opencodeModel");
    const current = selectedModel || select.value;
    if (current && ![...select.options].some((option) => option.value === current)) {
      select.add(new Option(current, current), 0);
    }
    if (current) select.value = current;
    setStatus(error.message, "error");
  } finally {
    refreshOpenCodeButton.disabled = false;
  }
}

// 協定和 JSON 模式是模型的性質，不是使用者選項，所以跟著選到的模型一起存。
function openCodeModelTraits(modelId) {
  const model = openCodeModels.find((item) => item.id === modelId);
  return {
    opencodeProtocol: model?.protocol === "responses" ? "responses" : "chat",
    opencodeStructuredOutput: Boolean(model?.structuredOutput)
  };
}

function updateProviderFields() {
  document.querySelector("#antigravity-fields").hidden = provider.value !== "antigravity";
  document.querySelector("#opencode-fields").hidden = provider.value !== "opencode";
  document.querySelector("#gemini-fields").hidden = provider.value !== "gemini";
  document.querySelector("#custom-fields").hidden = provider.value !== "custom";
  // 轉移鏈的第一站就是這個選擇，所以換引擎時那段說明要跟著重算。
  renderProviderOrder();
}

async function saveAndTest(event) {
  event.preventDefault();
  submitButton.disabled = true;
  setStatus("正在測試…", "pending");
  try {
    const data = Object.fromEntries(new FormData(form));
    for (const key of ["pageTranslationEnabled", "subtitleTranslationEnabled", "showOriginalSubtitle", "selectionTranslationEnabled", "hoverTranslationEnabled", "inputTranslationEnabled", "providerFallbackEnabled", "floatingBallEnabled"]) {
      data[key] = form.elements.namedItem(key).checked;
    }
    // 未勾選的 checkbox 不會出現在 FormData，所以上面那一圈一定要包含每一個
    // 開關；漏掉哪一個，它就會在每次儲存時被 sanitizeSettings 當成 false。
    data.providerOrder = providerOrder;
    Object.assign(data, openCodeModelTraits(data.opencodeModel));
    if (data.provider === "custom" && data.customApiBaseUrl) {
      await ensureCustomApiPermission(String(data.customApiBaseUrl).trim());
    }
    await saveSettings(data);
    const response = await api.runtime.sendMessage({ type: "IMMERSEFREE_TEST_PROVIDER" });
    if (!response?.ok) throw new Error(response?.error ?? "API 測試失敗");
    const keyNote = data.geminiApiKeys ? `（已存 ${parsedGeminiKeys().length} 把 Gemini 金鑰）` : "";
    // 測試也會走轉移。若真的換了引擎，這句話一定要說出來——否則使用者會以為
    // 自己選的那個引擎是好的，實際上是備援在頂著。
    const fallbackNote = response.fallbackCount > 0 ? `［${response.fallbackNotice}］` : "";
    setStatus(`${fallbackNote}${response.model} 成功：${response.translation}（${response.latencyMs} ms）${keyNote}`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    submitButton.disabled = false;
  }
}

function setStatus(message, state) {
  status.textContent = message;
  status.dataset.state = state;
}

// ================================================================ 術語表分頁（W2-4）
//
// 這一頁管兩份東西，來源完全不同，不要混在一起想：
//   1. 三個開關（要不要在網頁套用、要不要吃預設庫、吃哪幾個領域）→ 存在
//      一般設定裡（storage 的設定鍵），跟語言、引擎那些放在一起。
//   2. 「我的術語」→ 存在 storage 的 immersefreeGlossaryGlobal，跟字幕的全域
//      釘選是同一份。字幕那條路徑本來就在讀它，所以這裡存下去，影片字幕
//      也立刻跟著套用，不必再同步一次。
//
// 預設庫本身不進 storage：它在程式碼裡（core/glossary-presets.js），每個人裝上
// 就有。存一份到 storage 只會讓「更新版本後預設庫沒跟著更新」變成新的 bug。

let glossaryTerms = [];
let glossaryDomains = [];

function glossaryNote(message, state = "") {
  const note = document.querySelector("#glossary-note");
  if (!note) return;
  note.textContent = message;
  note.dataset.state = state;
}

function setupGlossaryPanel() {
  document.querySelector("#glossary-add")?.addEventListener("click", addGlossaryTerm);
  document.querySelector("#glossary-new-target")?.addEventListener("keydown", (event) => {
    // Enter 直接送出。要求使用者打完譯法還得把手移到滑鼠上，加十條就煩了。
    if (event.key === "Enter") { event.preventDefault(); addGlossaryTerm(); }
  });
  document.querySelector("#glossary-save")?.addEventListener("click", saveGlossary);
  document.querySelector("#glossary-export")?.addEventListener("click", exportGlossaryToFile);
  document.querySelector("#glossary-import")?.addEventListener("click", () => {
    document.querySelector("#glossary-import-file").click();
  });
  document.querySelector("#glossary-import-file")?.addEventListener("change", importGlossaryFromFile);
  document.querySelector("#glossary-clear")?.addEventListener("click", clearGlossary);
  document.querySelector("#glossaryPresetsEnabled")?.addEventListener("change", renderGlossaryPresets);
}

async function loadGlossary() {
  const settings = await getSettings();
  document.querySelector("#glossaryEnabled").checked = Boolean(settings.glossaryEnabled);
  document.querySelector("#glossaryPresetsEnabled").checked = Boolean(settings.glossaryPresetsEnabled);
  glossaryDomains = settingsCore.normalizeGlossaryDomains(settings.glossaryPresetDomains);
  glossaryTerms = await glossaryCore.readGlobalGlossary(api.storage.local);
  renderGlossaryDomains();
  renderGlossaryPresets();
  renderGlossaryTerms();
  glossaryNote(`目前有 ${glossaryTerms.length} 條自訂術語`, "");
}

function renderGlossaryDomains() {
  const host = document.querySelector("#glossary-domains");
  if (!host) return;
  const counts = glossaryPresets.countByDomain();
  host.replaceChildren(...glossaryPresets.DOMAIN_IDS.map((id) => {
    const label = document.createElement("label");
    label.className = "check";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = glossaryDomains.includes(id);
    box.dataset.domain = id;
    box.addEventListener("change", () => {
      glossaryDomains = box.checked
        ? [...glossaryDomains, id]
        : glossaryDomains.filter((item) => item !== id);
      renderGlossaryPresets();
    });
    label.append(box, document.createTextNode(`${glossaryPresets.DOMAIN_LABELS[id]}（${counts[id]} 條）`));
    return label;
  }));
}

function renderGlossaryPresets() {
  const body = document.querySelector("#glossary-presets-table tbody");
  const note = document.querySelector("#glossary-preset-count");
  if (!body) return;
  const enabled = document.querySelector("#glossaryPresetsEnabled")?.checked;
  // 關掉開關時清單就空掉，不是灰掉：畫面上還列著幾百條、實際上一條都不套用，
  // 是最容易讓人以為「設定沒生效」的畫法。
  const terms = enabled ? glossaryPresets.termsForDomains(glossaryDomains) : [];
  if (note) {
    note.textContent = enabled
      ? `已啟用 ${terms.length} 條預設術語（全庫 ${glossaryPresets.PRESET_TERMS.length} 條）`
      : `預設術語庫已關閉，一條都不會套用（全庫 ${glossaryPresets.PRESET_TERMS.length} 條）`;
  }
  body.replaceChildren(...(terms.length
    ? terms.map((term) => {
      const tr = document.createElement("tr");
      tr.append(
        cell(term.source, "glossary-source"),
        cell(term.target),
        cell(glossaryPresets.DOMAIN_LABELS[term.domain] ?? term.domain)
      );
      return tr;
    })
    : [emptyRow(3)]));
}

function glossaryTextInput(value, onInput, label) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.spellcheck = false;
  input.setAttribute("aria-label", label);
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

function glossaryToggle(checked, onChange, label) {
  const td = document.createElement("td");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.setAttribute("aria-label", label);
  box.addEventListener("change", () => onChange(box.checked));
  td.append(box);
  return td;
}

function renderGlossaryTerms() {
  const body = document.querySelector("#glossary-terms tbody");
  if (!body) return;
  body.replaceChildren(...(glossaryTerms.length
    ? glossaryTerms.map((term, index) => {
      const tr = document.createElement("tr");
      // 停用的列整列變淡，一眼看得出「這條現在不算數」。
      if (term.disabled) tr.dataset.disabled = "true";

      const sourceCell = document.createElement("td");
      sourceCell.append(glossaryTextInput(term.source, (value) => { glossaryTerms[index].source = value; }, `原文詞 ${term.source}`));
      const targetCell = document.createElement("td");
      targetCell.append(glossaryTextInput(term.target, (value) => { glossaryTerms[index].target = value; }, `固定譯法 ${term.source}`));

      const removeCell = document.createElement("td");
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "刪除";
      remove.setAttribute("aria-label", `刪除 ${term.source}`);
      remove.addEventListener("click", () => {
        glossaryTerms.splice(index, 1);
        renderGlossaryTerms();
        glossaryNote("已從清單移除，記得按「儲存術語表」", "");
      });
      removeCell.append(remove);

      tr.append(
        sourceCell,
        targetCell,
        glossaryToggle(Boolean(term.pinned), (checked) => {
          glossaryTerms[index].pinned = checked;
          renderGlossaryTerms();
        }, `釘選 ${term.source}`),
        glossaryToggle(Boolean(term.disabled), (checked) => {
          if (checked) glossaryTerms[index].disabled = true;
          else delete glossaryTerms[index].disabled;
          renderGlossaryTerms();
        }, `停用 ${term.source}`),
        removeCell
      );
      return tr;
    })
    : [emptyRow(5)]));
}

function addGlossaryTerm() {
  const sourceInput = document.querySelector("#glossary-new-source");
  const targetInput = document.querySelector("#glossary-new-target");
  const term = glossaryCore.normalizeTerm({
    source: sourceInput.value,
    target: targetInput.value,
    userEdited: true
  });
  if (!term) {
    glossaryNote("原文詞和固定譯法都要填", "error");
    return;
  }
  const existing = glossaryTerms.findIndex((item) => item.source.toLowerCase() === term.source.toLowerCase());
  // 同一個詞再加一次是「我要改譯法」，不是「我要兩條」。悄悄多出一條重複項
  // 只會讓使用者以為新增沒生效。
  if (existing >= 0) {
    glossaryTerms[existing] = { ...glossaryTerms[existing], target: term.target, userEdited: true };
    glossaryNote(`已更新「${term.source}」的譯法`, "success");
  } else {
    glossaryTerms.push(term);
    glossaryNote(`已加入「${term.source}」，記得按「儲存術語表」`, "success");
  }
  sourceInput.value = "";
  targetInput.value = "";
  sourceInput.focus();
  renderGlossaryTerms();
}

// 釘選的排前面。命中的術語一次最多帶 40 條進 prompt（glossary-core 的
// MAX_PROMPT_TERMS），撞到上限時被丟掉的應該是沒釘選的那些。
function sortedGlossaryTerms() {
  return [...glossaryTerms].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
}

async function saveGlossary() {
  try {
    const settings = await getSettings();
    await saveSettings({
      ...settings,
      glossaryEnabled: document.querySelector("#glossaryEnabled").checked,
      glossaryPresetsEnabled: document.querySelector("#glossaryPresetsEnabled").checked,
      glossaryPresetDomains: glossaryDomains
    });
    glossaryTerms = await glossaryCore.writeGlobalGlossary(api.storage.local, sortedGlossaryTerms());
    renderGlossaryTerms();
    glossaryNote(`已儲存 ${glossaryTerms.length} 條術語`, "success");
  } catch (error) {
    glossaryNote(error.message, "error");
  }
}

async function exportGlossaryToFile() {
  // 匯出的是畫面上這一份（含還沒按儲存的編輯）。要求「先存再匯出」對使用者
  // 是多餘的一步，而且忘記存時匯出的檔案會跟眼前看到的不一樣。
  const text = glossaryCore.buildGlossaryExport(sortedGlossaryTerms(), {
    appVersion: api.runtime.getManifest().version
  });
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "ImmerseFree-術語表.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  glossaryNote(`已匯出「ImmerseFree-術語表.json」，共 ${glossaryTerms.length} 條`, "success");
}

async function importGlossaryFromFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const terms = glossaryCore.parseGlossaryImport(await file.text());
    glossaryTerms = await glossaryCore.writeGlobalGlossary(api.storage.local, terms);
    renderGlossaryTerms();
    glossaryNote(`已匯入 ${glossaryTerms.length} 條術語`, "success");
  } catch (error) {
    glossaryNote(error.message, "error");
  }
}

async function clearGlossary() {
  glossaryTerms = await glossaryCore.writeGlobalGlossary(api.storage.local, []);
  renderGlossaryTerms();
  glossaryNote("已清空自訂術語（預設術語庫不受影響）", "success");
}

// ================================================================ 網站規則分頁（W3-2）
//
// 這一頁的核心是一件事：**寫壞的規則不准存進去**。
//
// 理由不是潔癖。使用者自訂規則會被內容腳本在每一頁收集候選之前套用，
// 一條語法錯的選擇器丟給 querySelectorAll 會拋例外，那個位置在 try 之外，
// 結果是「裝了擴充之後某些網站完全翻不了」，而使用者根本不會聯想到是
// 三天前貼的那段 JSON。所以驗證擋在存檔前，訊息逐條原樣顯示。
//
// 驗證用的是 core/site-rules-core.js 的同一支 parseUserRules——內容腳本
// 執行期用的也是它。兩邊同源，才不會出現「選項頁說合法、實際沒生效」。

function siteRulesNote(message, state = "") {
  const note = document.querySelector("#site-rules-note");
  if (!note) return;
  note.textContent = message;
  note.dataset.state = state;
}

// 錯誤訊息用 <pre> 攤開，一行一條。塞進 output 那一行會變成一長串讀不懂的
// 句子——使用者要的是「第 2 條的 minChars 寫錯」這種可以直接去改的定位。
function showSiteRulesErrors(errors) {
  const box = document.querySelector("#site-rules-errors");
  if (!box) return;
  if (!errors?.length) {
    box.textContent = "";
    box.hidden = true;
    return;
  }
  box.textContent = errors.join("\n");
  box.hidden = false;
}

function setupSiteRulesPanel() {
  document.querySelector("#site-rules-save")?.addEventListener("click", () => void saveSiteRules());
  document.querySelector("#site-rules-check")?.addEventListener("click", () => checkSiteRules(true));
  document.querySelector("#site-rules-sample")?.addEventListener("click", insertSiteRulesSample);
  document.querySelector("#site-rules-clear")?.addEventListener("click", () => void clearSiteRules());
  // 打字時就驗，但**不存**。存檔要靠按鈕，否則使用者打到一半的規則會被
  // 存進去，下一頁就照著半成品規則翻。
  document.querySelector("#userSiteRules")?.addEventListener("input", () => checkSiteRules(false));
}

async function loadSiteRulesPanel() {
  const settings = await getSettings();
  const toggle = document.querySelector("#siteRulesEnabled");
  if (toggle) toggle.checked = settings.siteRulesEnabled !== false;
  const area = document.querySelector("#userSiteRules");
  if (area) area.value = String(settings.userSiteRules ?? "");
  await renderBuiltinSiteRules();
  checkSiteRules(false);
}

// 內建規則表。正本是 core/site-rules.json，選項頁是擴充自己的頁面，
// 可以直接 fetch runtime URL（內容腳本才需要 web_accessible_resources）。
async function renderBuiltinSiteRules() {
  const body = document.querySelector("#site-rules-builtin tbody");
  const count = document.querySelector("#site-rules-builtin-count");
  if (!body) return;
  const result = await siteRulesCore.loadBuiltinRules({
    fetchImpl: fetch,
    url: api.runtime.getURL("core/site-rules.json")
  });
  if (!result.rules.length) {
    body.replaceChildren(emptyRow(3));
    if (count) count.textContent = "讀不到內建規則檔";
    return;
  }
  body.replaceChildren(...result.rules.map((rule) => {
    const tr = document.createElement("tr");
    tr.append(cell(rule.id), cell(rule.matches.join("、")), cell(rule.note ?? "—"));
    return tr;
  }));
  if (count) count.textContent = `內建 ${result.rules.length} 條`;
}

// 回傳驗證結果，順便更新畫面。announce=false 是「打字中」的靜默模式：
// 空白不算錯（還沒打完），所以不會邊打邊跳紅字。
function checkSiteRules(announce) {
  const area = document.querySelector("#userSiteRules");
  const text = String(area?.value ?? "");
  const result = siteRulesCore.parseUserRules(text);
  if (!text.trim()) {
    showSiteRulesErrors([]);
    if (announce) siteRulesNote("目前沒有自訂規則", "");
    else siteRulesNote("", "");
    return result;
  }
  if (result.valid) {
    showSiteRulesErrors([]);
    siteRulesNote(`${result.rules.length} 條規則都合法`, "success");
  } else {
    showSiteRulesErrors(result.errors);
    siteRulesNote(`有 ${result.errors.length} 個問題，修好才能儲存`, "error");
  }
  return result;
}

async function saveSiteRules() {
  const area = document.querySelector("#userSiteRules");
  const text = String(area?.value ?? "");
  const result = siteRulesCore.parseUserRules(text);
  if (!result.valid) {
    // 非法就**不落存**。存進去再說「但沒生效」是最糟的組合：設定看起來
    // 有值、規則卻不作用，使用者會去懷疑功能壞了而不是自己寫錯。
    showSiteRulesErrors(result.errors);
    siteRulesNote(`沒有儲存：有 ${result.errors.length} 個問題要先修`, "error");
    return false;
  }
  const enabled = Boolean(document.querySelector("#siteRulesEnabled")?.checked);
  await saveSettings({ siteRulesEnabled: enabled, userSiteRules: text });
  showSiteRulesErrors([]);
  siteRulesNote(
    result.rules.length
      ? `已儲存 ${result.rules.length} 條自訂規則`
      : "已儲存（目前沒有自訂規則）",
    "success"
  );
  return true;
}

function insertSiteRulesSample() {
  // 範例表放在函式裡不放模組頂層：這一頁有一段「頂層 await load() 之前就
  // 呼叫某個函式」的既有結構，函式宣告會被提升、頂層 const 不會，放外面
  // 遲早踩到 TDZ ReferenceError 而整個選項頁一行都不跑（W3-1 實測踩過）。
  const sample = [
    {
      id: "my-news-site",
      matches: ["example.com", "*.example.com"],
      note: "側欄與推薦清單不翻；本文段落偏長，短句一律略過",
      "excludeSelectors.add": ["aside.recommend", "div.newsletter-cta"],
      minWords: 6
    }
  ];
  const area = document.querySelector("#userSiteRules");
  if (!area) return;
  area.value = JSON.stringify(sample, null, 2);
  checkSiteRules(true);
}

async function clearSiteRules() {
  const area = document.querySelector("#userSiteRules");
  if (area) area.value = "";
  await saveSettings({ userSiteRules: "" });
  showSiteRulesErrors([]);
  siteRulesNote("已清空我的規則（內建規則不受影響）", "success");
}

// ================================================================ 診斷分頁（W1-4）
//
// 這一頁回答三個問題：剛剛是誰失敗了、為什麼、下一步做什麼。
// 所有顯示文字都用 zh-Hant 寫進 DOM，介面語言設英文時由 ui/i18n.js 的
// 掃描器換掉——錯誤碼的英文訊息在 diagnostics-core 載入時就註冊進字典了，
// 所以這裡不需要（也不該）自己判斷語言。
function setupTabs() {
  const tabs = [
    { button: document.querySelector("#tab-settings"), panel: form },
    { button: document.querySelector("#tab-glossary"), panel: document.querySelector("#panel-glossary") },
    { button: document.querySelector("#tab-site-rules"), panel: document.querySelector("#panel-site-rules") },
    { button: document.querySelector("#tab-diagnostics"), panel: document.querySelector("#panel-diagnostics") }
  ];
  for (const { button, panel } of tabs) {
    if (!button || !panel) continue;
    button.addEventListener("click", () => {
      for (const other of tabs) {
        const selected = other.button === button;
        other.button.setAttribute("aria-selected", String(selected));
        other.panel.hidden = !selected;
      }
      if (panel.id === "panel-diagnostics") void refreshDiagnostics();
      if (panel.id === "panel-glossary") void loadGlossary();
      if (panel.id === "panel-site-rules") void loadSiteRulesPanel();
    });
  }
  setupGlossaryPanel();
  setupSiteRulesPanel();
  document.querySelector("#diagnostics-refresh")?.addEventListener("click", () => refreshDiagnostics(true));
  document.querySelector("#diagnostics-copy")?.addEventListener("click", copyDiagnosticsReport);
  document.querySelector("#diagnostics-export")?.addEventListener("click", exportMetricsJson);
  document.querySelector("#diagnostics-clear")?.addEventListener("click", clearDiagnostics);
}

// 最近一次抓到的診斷資料。複製報告時不重抓：使用者複製的必須是他眼前看到的
// 那一份，中間又多了幾筆會對不上。
// counters/metrics 一開始就給 0（不是 undefined）：統計表在還沒抓到資料時
// 也要顯示「0 次 / 尚無資料」，而不是一整片空白。
let diagnosticsSnapshot = {
  events: [],
  providers: [],
  counters: diagnostics.emptyMetrics(),
  metrics: diagnostics.computeMetrics({}, [])
};

function setDiagnosticsNote(message, state = "") {
  const note = document.querySelector("#diagnostics-note");
  if (!note) return;
  note.textContent = message;
  note.dataset.state = state;
}

async function refreshDiagnostics(announce = false) {
  try {
    const response = await api.runtime.sendMessage({ type: "IMMERSEFREE_GET_DIAGNOSTICS" });
    if (!response?.ok) throw new Error(response?.error ?? "拿不到診斷資料");
    diagnosticsSnapshot = response;
    renderDiagnostics(response);
    if (announce) setDiagnosticsNote(`已更新，共 ${response.events.length} 筆事件`, "success");
    else setDiagnosticsNote(`共 ${response.events.length} 筆事件`, "");
  } catch (error) {
    setDiagnosticsNote(diagnostics.describeError(error), "error");
  }
}

function cell(text, className = "") {
  const td = document.createElement("td");
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function emptyRow(columns) {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = columns;
  td.className = "diagnostics-empty";
  td.textContent = "尚無紀錄";
  tr.append(td);
  return tr;
}

// ---------------------------------------------------------------- 統計區塊（W4-2）
//
// 純數字，刻意不畫圖：這一區的用途是「把獨有功能的效果講成可查證的數字」，
// 圖表只會讓人看不出 12/40 與 3/10 的差別。
// 「組成」那一欄一定要有分子分母——只給一個 30% 的百分比，使用者無法判斷
// 它是 3/10 還是 300/1000，前者根本不該當結論。
function formatRate(rate) {
  return rate === null || rate === undefined ? "尚無資料" : diagnostics.formatPercent(rate);
}

function metricRows(metrics) {
  if (!metrics) return [];
  return [
    {
      label: "快取命中率",
      value: formatRate(metrics.cacheHitRate.rate),
      detail: `${metrics.cacheHitRate.hits} / ${metrics.cacheHitRate.total} 段`
    },
    {
      label: "引擎轉移次數",
      value: `${metrics.providerHandoffs.count} 次`,
      detail: `最近 50 筆事件中 ${metrics.providerHandoffs.recentFromEvents} 次`
    },
    {
      label: "拆批率",
      value: formatRate(metrics.batchSplitRate.rate),
      detail: `${metrics.batchSplitRate.splits} / ${metrics.batchSplitRate.batches} 批`
    },
    {
      label: "富文本降級次數",
      value: `${metrics.richTextFallbacks.count} 次`,
      detail: "RICHTEXT_FALLBACK"
    },
    {
      label: "詞典降級次數",
      value: `${metrics.dictFallbacks.count} 次`,
      detail: "DICT_FALLBACK"
    },
    {
      label: "字幕語意合併率",
      value: formatRate(metrics.subtitleMergeRate.rate),
      detail: `${metrics.subtitleMergeRate.groups} 組 / ${metrics.subtitleMergeRate.cues} 句`
    }
  ];
}

function renderMetrics(report) {
  const body = document.querySelector("#diagnostics-metrics tbody");
  if (!body) return;
  const rows = metricRows(report.metrics);
  body.replaceChildren(...(rows.length
    ? rows.map((row) => {
      const tr = document.createElement("tr");
      tr.append(cell(row.label), cell(row.value), cell(row.detail, "diagnostics-message"));
      return tr;
    })
    : [emptyRow(3)]));
}

// 一鍵匯出。給的是 buildMetricsJson 的產出：**只有數字**，沒有事件清單、
// 沒有網址、沒有標題，也沒有任何一段原文或譯文。
function exportMetricsJson() {
  const payload = diagnostics.buildMetricsJson(
    diagnosticsSnapshot.counters ?? {},
    diagnosticsSnapshot.events ?? [],
    { version: diagnosticsSnapshot.version, at: Date.now() }
  );
  const text = JSON.stringify(payload, null, 2);
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "ImmerseFree-統計.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  setDiagnosticsNote("已匯出「ImmerseFree-統計.json」（只有統計數字，沒有任何頁面內容）", "success");
}

function renderDiagnostics(report) {
  renderMetrics(report);
  const providerBody = document.querySelector("#diagnostics-providers tbody");
  const rows = report.providers ?? [];
  providerBody.replaceChildren(...(rows.length
    ? rows.map((row) => {
      const tr = document.createElement("tr");
      tr.append(
        cell(providerCore.providerLabel(row.provider, {})),
        cell(diagnostics.formatPercent(row.successRate)),
        cell(String(row.ok)),
        cell(String(row.failed)),
        cell(row.lastCode, "diagnostics-code")
      );
      return tr;
    })
    : [emptyRow(5)]));

  const eventBody = document.querySelector("#diagnostics-events tbody");
  // 新的排前面：使用者打開診斷頁時想看的是「剛剛發生了什麼」。
  const events = (report.events ?? []).slice().reverse();
  eventBody.replaceChildren(...(events.length
    ? events.map((event) => {
      const tr = document.createElement("tr");
      tr.dataset.severity = event.severity ?? diagnostics.severityOf(event.code);
      tr.append(
        cell(diagnostics.formatTime(event.at)),
        cell(diagnostics.severityLabel(tr.dataset.severity)),
        cell(event.code, "diagnostics-code"),
        cell(event.provider ? providerCore.providerLabel(event.provider, {}) : "—"),
        cell(String(event.batchSize || 0)),
        cell(`${event.durationMs || 0} ms`),
        cell(diagnostics.messageFor(event.code), "diagnostics-message")
      );
      return tr;
    })
    : [emptyRow(7)]));
}

async function copyDiagnosticsReport() {
  const text = diagnostics.buildDiagnosticsReport(diagnosticsSnapshot.events ?? [], {
    version: diagnosticsSnapshot.version,
    provider: diagnosticsSnapshot.provider,
    chain: diagnosticsSnapshot.chain,
    at: Date.now()
  });
  const area = document.querySelector("#diagnostics-report");
  try {
    await navigator.clipboard.writeText(text);
    setDiagnosticsNote("已複製診斷報告", "success");
    area.hidden = true;
  } catch {
    // 剪貼簿被權限或焦點擋掉時，至少把報告攤在畫面上讓人自己選取複製，
    // 而不是回一句「複製失敗」就沒了。
    area.value = text;
    area.hidden = false;
    area.select();
    setDiagnosticsNote("無法自動複製，報告已顯示在下方，請手動選取", "error");
  }
}

async function clearDiagnostics() {
  try {
    const response = await api.runtime.sendMessage({ type: "IMMERSEFREE_CLEAR_DIAGNOSTICS" });
    if (!response?.ok) throw new Error(response?.error ?? "清除失敗");
    diagnosticsSnapshot = {
      events: [],
      providers: [],
      counters: diagnostics.emptyMetrics(),
      metrics: diagnostics.computeMetrics({}, [])
    };
    renderDiagnostics(diagnosticsSnapshot);
    setDiagnosticsNote("已清除診斷紀錄", "success");
  } catch (error) {
    setDiagnosticsNote(diagnostics.describeError(error), "error");
  }
}
