(function initializeContentInjection(global) {
  const ALL_SITES = { origins: ["<all_urls>"] };
  // 這份清單必須與 manifest.json 的 content_scripts.js 完全一致（同樣的檔案、
  // 同樣的順序）。動態注入走的是這裡，少一個檔或多一個不存在的檔，
  // executeScript 會整批失敗，使用者按下翻譯時只看得到一句看不懂的錯誤。
  const SCRIPT_FILES = [
    "core/i18n-core.js",
    "core/page-translation-ui.js",
    "core/page-translation-cache.js",
    "core/language-core.js",
    "core/shared.js",
    "content/page-translator.js",
    "content/interaction-translator.js",
    "content/main.js"
  ];

  function beginSiteAccessRequest(api) {
    try {
      return Promise.resolve(api.permissions.request(ALL_SITES));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async function ensureContentScript(api, tab, onStatus = () => {}, siteAccessRequest) {
    if (!tab?.id || !isInjectablePage(tab.url)) {
      throw new Error("請先切換到要翻譯的一般網頁");
    }
    const alive = await ping(api, tab.id);
    if (alive.alive) {
      // 重新載入擴充功能時，已經開著的分頁會繼續跑「舊的」內容腳本，
      // 要重新整理頁面才會換成新版。舊腳本 ping 得通，所以不比版本的話
      // 會一路走下去，最後在呼叫新功能時炸出看不懂的 TypeError。
      const expected = api.runtime.getManifest?.().version ?? "";
      if (expected && alive.version && alive.version !== expected) {
        throw new Error(`這個分頁還在跑舊版 ${alive.version}（目前是 ${expected}）。請按 F5 重新整理這個分頁。`);
      }
      return { injected: false };
    }

    onStatus("正在確認所有網站權限");
    let granted = false;
    try {
      granted = siteAccessRequest
        ? await siteAccessRequest
        : await api.permissions.contains(ALL_SITES);
    } catch (error) {
      throw new Error(`Safari 無法要求網站權限：${error.message}`);
    }
    if (!granted) {
      throw new Error("請在 Safari 的權限視窗選擇「永遠允許在每個網站」");
    }
    if (!api.scripting?.executeScript || !api.scripting?.insertCSS) {
      throw new Error("目前瀏覽器不支援自動載入翻譯功能");
    }

    onStatus("正在載入網頁翻譯功能");
    await api.scripting.insertCSS({
      target: { tabId: tab.id, allFrames: true },
      files: ["content/content.css"]
    });
    await api.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: SCRIPT_FILES
    });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      // ping 現在回傳物件，一定要看 alive 欄位；直接判斷物件本身會永遠為真。
      if ((await ping(api, tab.id)).alive) return { injected: true };
      await delay(100);
    }
    throw new Error("翻譯功能已載入，但分頁沒有回應；請重新整理此頁後再試");
  }

  async function ping(api, tabId) {
    try {
      const response = await api.tabs.sendMessage(tabId, { type: "IMMERSEFREE_PING" });
      return response?.ok ? { alive: true, version: response.version ?? "" } : { alive: false };
    } catch {
      return { alive: false };
    }
  }

  function isInjectablePage(value) {
    try {
      return ["http:", "https:", "file:"].includes(new URL(String(value ?? "")).protocol);
    } catch {
      return false;
    }
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  const contentInjection = Object.freeze({ beginSiteAccessRequest, ensureContentScript, isInjectablePage });
  global.ImmerseFreeContentInjection = contentInjection;
})(globalThis);
