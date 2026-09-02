import { getSettings, saveSettings } from "../core/settings.js";

const api = globalThis.browser ?? globalThis.chrome;
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

await load();
provider.addEventListener("change", updateProviderFields);
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
    else input.value = value;
  }
  updateProviderFields();
  renderKeyCount();
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
}

async function saveAndTest(event) {
  event.preventDefault();
  submitButton.disabled = true;
  setStatus("正在測試…", "pending");
  try {
    const data = Object.fromEntries(new FormData(form));
    for (const key of ["pageTranslationEnabled", "selectionTranslationEnabled", "hoverTranslationEnabled", "inputTranslationEnabled"]) {
      data[key] = form.elements.namedItem(key).checked;
    }
    Object.assign(data, openCodeModelTraits(data.opencodeModel));
    if (data.provider === "custom" && data.customApiBaseUrl) {
      await ensureCustomApiPermission(String(data.customApiBaseUrl).trim());
    }
    await saveSettings(data);
    const response = await api.runtime.sendMessage({ type: "IMMERSEFREE_TEST_PROVIDER" });
    if (!response?.ok) throw new Error(response?.error ?? "API 測試失敗");
    const keyNote = data.geminiApiKeys ? `（已存 ${parsedGeminiKeys().length} 把 Gemini 金鑰）` : "";
    setStatus(`${response.model} 成功：${response.translation}（${response.latencyMs} ms）${keyNote}`, "success");
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
