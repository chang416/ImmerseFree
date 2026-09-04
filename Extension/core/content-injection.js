(function initializeContentInjection(global) {
  const ALL_SITES = { origins: ["<all_urls>"] };
  // 這份清單必須與 manifest.json 的 content_scripts.js 完全一致（同樣的檔案、
  // 同樣的順序）。動態注入走的是這裡，少一個檔或多一個不存在的檔，
  // executeScript 會整批失敗，使用者按下翻譯時只看得到一句看不懂的錯誤。
  const SCRIPT_FILES = [
    "core/i18n-core.js",
    // 錯誤碼註冊表（W1-4）。排在 i18n-core 之後：載入時要把每個 code 的英文
    // 訊息註冊進字典。內容腳本要它，是因為頁面上的失敗訊息必須跟 popup、
    // 診斷頁講同一句話——同一個 code 不能有兩種說法。
    "core/diagnostics-core.js",
    "core/page-translation-ui.js",
    "core/page-translation-cache.js",
    "core/language-core.js",
    "core/shared.js",
    // 批量常數的唯一來源（W2-3）。page-translator.js 與 subtitle-translator.js
    // 都在 IIFE 開頭就把它抓進 const，所以一定要排在兩者之前；排反了會直接
    // 丟例外（讀 undefined 的 batchProfile），整批注入失敗。
    // **這一行漏掉的話，整個網頁／字幕翻譯都起不來**——W2-1 的教訓：
    // manifest 與這份清單少同步一處，動態注入那條路就整批炸。
    "core/batch-core.js",
    // 這兩個要排在字幕顯示層（youtube/streaming）之前：那兩個檔在 IIFE 一開始
    // 就把換行器抓進 const，晚載入就抓到 undefined，字幕會整句擠成一行。
    "core/subtitle-linebreak-core.js",
    "core/subtitle-merge-core.js",
    "core/video-subtitle-core.js",
    "core/youtube-subtitle-core.js",
    "core/subtitle-retry-core.js",
    "core/streaming-subtitle-core.js",
    "core/subtitle-format-core.js",
    "core/subtitle-store-core.js",
    // 三層上下文與影片術語表：subtitle-translator.js 在 IIFE 開頭就抓進 const，
    // 一定要排在它前面。術語表通用層（W2-4）又要排在字幕轉接層前面——
    // 轉接層載入時就會去讀它，順序反了會直接丟例外，整批注入失敗。
    "core/glossary-core.js",
    "core/subtitle-glossary-core.js",
    "core/subtitle-context-core.js",
    "core/manifest-core.js",
    // 行內富文本核心（W2-2）。segmentation-core 的 extractSegmentParts 會去讀
    // globalThis.ImmerseFreeRichTextCore，所以要排在它前面；排反了不會丟例外，
    // 而是**整站的連結與粗體靜默地全部翻不出來**（退回純文字路徑），
    // 功能像是沒做——這種失敗比丟例外難查得多。
    "core/rich-text-core.js",
    // 分段核心（W2-1）。page-translator.js 在 IIFE 開頭就把它抓進 const，
    // 排在後面的話抓到 undefined，收集候選時會整個丟例外。
    "core/segmentation-core.js",
    // 網站規則庫（W3-2）。page-translator.js 在 IIFE 開頭就把它抓進 const，
    // 排在後面的話抓到 undefined——那不會丟例外（有 `siteRules ?` 保護），
    // 而是**所有站台規則靜默失效**：門檻、排除清單、白名單全部沒生效，
    // 功能像是沒做。這種失敗比丟例外難查得多。
    // 規則內容本身在 core/site-rules.json，走 manifest 的
    // web_accessible_resources 由 fetch 讀，不在這份腳本清單裡。
    "core/site-rules-core.js",
    // 播放器語境判準（W4-1）。page-translator.js 在 IIFE 開頭就把它抓進 const，
    // 一定要排在它前面。漏掉不會丟例外（有 `playerContext?.` 保護），而是退回
    // 只排除嚴格清單——那條退路刻意**不含** [class*='subtitle']／[class*='caption']，
    // 少排除一塊只是多翻一行；用寬鬆清單當退路才會讓整區文字永遠翻不出來。
    "core/player-context-core.js",
    "content/page-translator.js",
    "content/subtitle-translator.js",
    "content/interaction-translator.js",
    "content/dual-subtitle.js",
    // 側邊懸浮球（W3-1）。要在 page-translator 之後（點球會呼叫
    // bridge.pageTranslator）、main.js 之前（習慣上 main 收尾）。
    // manifest.json 的 content_scripts 清單必須跟這裡完全同步。
    "content/floating-ball.js",
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
