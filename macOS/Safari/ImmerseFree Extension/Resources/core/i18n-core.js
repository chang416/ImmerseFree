(function initializeI18nCore(global) {
  // 介面語言。
  //
  // 這個專案的前端本來整份寫死繁體中文。要開源給其他國家的人用，最省事又
  // 最不容易改壞的做法不是把幾百處字串改成 t("key")——那要動到每一個檔案，
  // 而且每加一個字串就多一個忘記翻的機會——而是留一份「原文 → 譯文」字典。
  //
  // 兩種用法共用這一份字典：
  //  1. 擴充功能自己的頁面（popup、options、PDF 閱讀器）：ui/i18n.js 開頁時
  //     掃一次 DOM 換掉，之後用 MutationObserver 跟著動態產生的文字換。
  //  2. 內容腳本的浮動 UI（進度條、翻譯卡）：不能掃 DOM——那會把使用者正在
  //     讀的網頁一起翻掉——所以在字串寫進畫面前呼叫 ImmerseFree.t() 查表。
  //
  // 字典裡沒有的字串一律原樣保留，所以模型 id、使用者輸入不會被誤動。

  const MESSAGES = {
    en: {
      // ── popup ─────────────────────────────────────────────
      "讀取翻譯模型": "Loading models",
      "Coming soon": "Coming soon",
      "模型": "Model",
      "原文": "From",
      "譯文": "To",
      "自動偵測": "Detect",
      "英文": "English",
      "日文": "Japanese",
      "韓文": "Korean",
      "泰文": "Thai",
      "簡體中文": "Simplified Chinese",
      "繁體中文": "Traditional Chinese",
      "繁中（台灣）": "Chinese (Taiwan)",
      "繁體中文（台灣）": "Traditional Chinese (Taiwan)",
      "翻譯這個網頁": "Translate this page",
      "準備翻譯": "Ready",
      "PDF 文件": "PDF document",
      "反白文字": "Selection",
      "拖曳選取，放開就翻譯": "Select text, release to translate",
      "關": "Off",
      "開": "On",
      "懸停段落": "Hover",
      "不用反白，停留 0.7 秒": "No selecting — just rest 0.7s on a paragraph",
      "翻譯品質": "Translation quality",
      "開啟設定": "Open settings",
      "翻譯設定": "Translation settings",
      "交換語言": "Swap languages",
      "翻譯工具": "Tools",
      "翻譯設定已更新": "Translation settings updated",
      "找不到目前分頁": "No active tab",
      "操作失敗": "Action failed",
      "完成": "Done",
      "翻譯中": "Translating",
      "正在讀取網頁段落": "Reading page paragraphs",
      "此分頁尚未載入翻譯功能，請重新整理網頁後再試": "This tab has not loaded the extension yet. Refresh the page and try again.",
      "網頁翻譯失敗": "Page translation failed",
      "滑鼠懸停段落 0.7 秒即可翻譯": "Rest on a paragraph for 0.7s to translate",
      "懸停翻譯已關閉": "Hover translation off",
      "反白文字後，放開滑鼠就會翻譯": "Select text and release to translate",
      "反白翻譯已關閉": "Selection translation off",
      "OpenCode Free · 清單自動更新": "OpenCode Free · list updates itself",
      "Antigravity · 使用登入額度": "Antigravity · uses your signed-in quota",
      "Gemini API · 尚未設定": "Gemini API · not configured",
      "自訂 API": "Custom API",
      "OpenCode 免費模型": "OpenCode free models",
      "自備 API key": "Bring your own API key",

      // ── popup：尚未開放的功能列（刻意保留的入口，按下去只說 Coming soon）──
      "AI 字幕": "AI subtitles",
      "使用模型翻譯影片字幕": "Translate video subtitles with a model",
      "雙軌字幕": "Dual subtitles",
      "使用 Netflix、Disney+ 原有字幕軌": "Use Netflix / Disney+ built-in subtitle tracks",
      "影集學習": "Episode study",
      "整理這一集的單字與句型": "Collect vocabulary and sentence patterns from this episode",

      // ── 注入內容腳本（popup 按下翻譯時的狀態與錯誤）────────
      "請先切換到要翻譯的一般網頁": "Switch to a normal web page first",
      "正在確認所有網站權限": "Checking site access",
      "正在載入網頁翻譯功能": "Loading the page translator",
      "請在 Safari 的權限視窗選擇「永遠允許在每個網站」":
        "Choose “Always Allow on Every Website” in Safari's permission dialog",
      "目前瀏覽器不支援自動載入翻譯功能": "This browser cannot load the translator automatically",
      "翻譯功能已載入，但分頁沒有回應；請重新整理此頁後再試":
        "The translator loaded but this tab is not responding. Refresh the page and try again.",

      // ── 內容腳本的浮動 UI（進度條與翻譯卡）──────────────────
      "網頁翻譯": "Page translation",
      "翻譯未完成": "Translation incomplete",
      "翻譯失敗": "Translation failed",
      "尚未開始": "Not started",
      "目前頁面找不到可翻譯的文字段落": "No translatable text was found on this page",
      "模型回傳空白翻譯": "The model returned an empty translation",
      "請先在設定中允許網頁雙語翻譯": "Turn on bilingual page translation in the settings first",
      "已移除網頁翻譯": "Page translation removed",
      "已翻譯選取文字": "Selected text translated",
      "快速翻譯": "Quick translation",
      "關閉": "Close",
      "複製譯文": "Copy translation",
      "已複製": "Copied",
      "已翻譯": "Translated",
      "翻譯結果不是設定的目標語言，請稍後再試":
        "The result was not in your target language. Please try again.",

      // ── options ───────────────────────────────────────────
      "ImmerseFree 設定": "ImmerseFree settings",
      "翻譯與模型設定": "Translation and model settings",
      "翻譯服務": "Translation service",
      "使用服務": "Service",
      "OpenCode：免費模型": "OpenCode: free models",
      "自訂 API（OpenAI 相容）": "Custom API (OpenAI-compatible)",
      "Antigravity 模型": "Antigravity model",
      "本機模型服務": "Local bridge service",
      "需先登入 Antigravity CLI。翻譯會使用該帳戶的額度，不會使用 Gemini API key。":
        "Requires the Antigravity CLI to be signed in. Translation uses that account's quota, not a Gemini API key.",
      "OpenCode token／API key（留空時使用本機 OpenCode CLI）": "OpenCode token / API key (leave empty to use the local OpenCode CLI)",
      "免費模型": "Free model",
      "更新免費模型清單": "Refresh free model list",
      "只顯示目前仍供應且輸入、輸出成本皆為 0 的模型。免費服務可能有速率限制，請勿翻譯機密內容。":
        "Only models that are still served and cost zero for both input and output are listed. Free services may rate-limit; do not translate confidential material.",
      "Gemini API keys（一行一把）": "Gemini API keys (one per line)",
      "尚未填入金鑰": "No keys entered yet",
      "模型 ID": "Model ID",
      "每次呼叫會輪替金鑰；遇到額度或金鑰錯誤會自動換下一把。若金鑰屬於同一 Google 專案，配額可能仍共用。":
        "Keys rotate on every call and switch automatically on quota or key errors. Keys from the same Google project may still share a quota.",
      "API key（本機服務如 Ollama 可留空）": "API key (leave empty for local services such as Ollama)",
      "抓取這把金鑰可用的模型": "Fetch models available to this key",
      "尚未抓取模型清單": "Model list not fetched yet",
      "顯示名稱（選填，會顯示在工具列選單）": "Display name (optional, shown in the toolbar menu)",
      "任何相容 OpenAI": "Anything compatible with the OpenAI",
      "介面的服務都能用：OpenAI、Groq、 Together、OpenRouter、DeepSeek、以及本機的 Ollama 或 LM Studio。填 base URL 到":
        "interface works: OpenAI, Groq, Together, OpenRouter, DeepSeek, and local Ollama or LM Studio. Enter the base URL up to",
      "為止即可。": "and nothing more.",
      "語言": "Languages",
      "介面語言": "Interface language",
      "跟隨瀏覽器": "Follow browser",
      "翻譯風格": "Translation style",
      "自然流暢": "Natural",
      "忠實原文": "Literal",
      "學術精準": "Academic",
      "自訂翻譯偏好": "Custom translation preferences",
      "例如：金融術語保留英文縮寫；人名不翻譯；語氣保持正式。":
        "For example: keep financial acronyms in English; do not translate personal names; keep the tone formal.",
      "功能": "Features",
      "允許網頁雙語翻譯": "Allow bilingual page translation",
      "反白文字後立即翻譯": "Translate as soon as text is selected",
      "滑鼠懸停段落 0.7 秒後翻譯": "Translate after hovering a paragraph for 0.7s",
      "輸入框連按三次空白時翻譯": "Translate in text fields after three spaces",
      "設定搬家": "Move your settings",
      "匯出檔會包含 API 金鑰。請妥善保管，再於另一台 Windows 或 Mac 匯入。":
        "The export file contains your API keys. Keep it safe, then import it on another Windows or Mac machine.",
      "匯出設定": "Export settings",
      "匯入設定": "Import settings",
      "支持開發者": "Support the developer",
      "我是一名大學生。維護這類開源專案最大的負擔，是軟體與 AI 服務昂貴的訂閱費。如果你願意支持 ImmerseFree，可以透過 Buy Me a Coffee 小額贊助。贊助完全自願，也不會解鎖額外功能。":
        "I am a university student. The biggest burden of maintaining open-source projects like this is the cost of software and AI subscriptions. If you would like to support ImmerseFree, you can make a small contribution through Buy Me a Coffee. Contributions are optional and do not unlock extra features.",
      "前往 Buy Me a Coffee": "Open Buy Me a Coffee",
      "儲存並測試": "Save and test",
      "一行一把（用逗號或空格分隔也可以）": "One per line (commas or spaces work too)",
      "例如：OpenAI、Groq、我的 Ollama": "e.g. OpenAI, Groq, My Ollama",
      "請先填寫 API base URL": "Enter the API base URL first",
      "抓取中…": "Fetching…",
      "需要授權存取這個網域才能連線": "Permission for this domain is required to connect",
      "無法取得模型清單": "Could not fetch the model list",
      "這個端點沒有回傳任何模型，請直接輸入模型 id": "This endpoint returned no models — type the model id directly",
      "已匯入設定": "Settings imported",
      "目前無法取得免費模型清單": "The free model list is unavailable right now",
      "正在測試…": "Testing…",
      "API 測試失敗": "API test failed",
      "這不是有效的 JSON 檔": "This is not a valid JSON file",
      "這不是 ImmerseFree 的設定檔": "This is not an ImmerseFree settings file",

      // ── PDF 閱讀器 ────────────────────────────────────────
      "ImmerseFree：PDF 翻譯": "ImmerseFree: PDF translation",
      "PDF 翻譯": "PDF translation",
      "服務": "Service",
      "選擇 PDF": "Choose PDF",
      "只看譯文": "Translation only",
      "返回並排": "Back to side by side",
      "翻譯整份": "Translate all",
      "開啟 PDF 文件": "Open a PDF",
      "拖入本機 PDF，或從擴充功能開啟目前的 PDF。":
        "Drop a local PDF here, or open the current PDF from the extension.",
      "停止": "Stop",
      "翻譯本頁": "Translate this page",
      "檢查文字層": "Checking text layer",
      "正在讀取 PDF 文字層": "Reading the PDF text layer",
      "檢查原生文字": "Checking native text",
      "本機 OCR 辨識中": "Running local OCR",
      "視覺模型辨識中（會上傳本頁影像）": "Running the vision model (this page's image is uploaded)",
      "視覺模型": "Vision model",
      "本機 OCR": "Local OCR",
      "原生文字": "Native text",
      "已是目標語言": "Already in the target language",
      "無法擷取": "Could not extract",
      "翻譯完成": "Translation complete",
      "已停止，完成內容已保留": "Stopped — finished pages are kept",
      "無法開啟 PDF": "Could not open the PDF",
      "Google Drive PDF": "Google Drive PDF",
      "Antigravity 視覺辨識": "Antigravity vision OCR",
      "無法建立 OCR 圖片": "Could not create the OCR image",
      "伺服器沒有回傳 PDF 檔案": "The server did not return a PDF file",
      "不是 PDF": "Not a PDF",
      "無法讀取 PDF": "Could not read the PDF",
      "這個檔案不是 PDF，目前無法翻譯。請選擇副檔名為 .pdf 的檔案。":
        "This file is not a PDF, so it cannot be translated. Choose a file whose name ends in .pdf.",
      "這是掃描型或圖片型 PDF，而且本機 OCR 也無法辨識出可翻譯文字，因此目前無法翻譯。可能是頁面解析度過低、文字過小，或檔案格式不支援。":
        "This is a scanned or image-only PDF and local OCR could not read any translatable text from it. The pages may be too low-resolution, the type too small, or the format unsupported.",
      "這份 PDF 已加密或需要密碼，目前無法讀取文字。請先解除密碼保護後再試。":
        "This PDF is encrypted or password-protected, so its text cannot be read. Remove the protection and try again.",
      "這個檔案不是有效的 PDF，或 PDF 已損壞，因此無法翻譯。":
        "This file is not a valid PDF, or the PDF is damaged, so it cannot be translated.",
      "這個連結沒有回傳可讀取的 PDF 檔案，因此無法翻譯。請先下載真正的 PDF 後再開啟。":
        "This link did not return a readable PDF, so it cannot be translated. Download the actual PDF and open that instead.",
      "無法讀取這份 PDF。請確認檔案完整且沒有加密。":
        "This PDF could not be read. Check that the file is complete and not encrypted.",
      "模型回傳格式異常，已自動重試但仍未成功。這不是 PDF 檔案格式問題，也不代表額度用完；請再試一次或切換模型。":
        "The model kept returning a malformed response even after an automatic retry. This is not a PDF problem and does not mean your quota ran out — try again or switch models.",
      "翻譯模型的免費額度或速率限制已達上限。已完成的內容會保留，請稍後重試或切換模型／金鑰。":
        "The model's free quota or rate limit has been reached. Finished content is kept — retry later or switch model / key.",

      // ── 各引擎共用的錯誤訊息 ───────────────────────────────
      "模型回傳格式異常：無法解析翻譯結果": "The model returned a malformed response: the translation could not be parsed",
      "所有 Gemini API key 目前都無法使用": "None of the Gemini API keys can be used right now",
      "所有 Gemini API key 目前都在冷卻或無法使用": "Every Gemini API key is cooling down or unusable right now",
      "尚未填寫自訂 API 的 base URL": "The custom API base URL has not been set",
      "尚未選擇自訂 API 的模型": "No model has been chosen for the custom API",
      "自訂 API 沒有回傳文字內容": "The custom API returned no text",
      "OpenCode API key 無效或已過期。請換一把新的金鑰，或清空金鑰並安裝本機 OpenCode CLI":
        "The OpenCode API key is invalid or expired. Enter a new key, or clear it and install the local OpenCode CLI."
    }
  };

  // 帶數字或變數的訊息沒辦法用整句比對，改用樣式比對。
  const PATTERNS = {
    en: [
      [/^Gemini API · (\d+) 把金鑰輪替$/, "Gemini API · rotating $1 keys"],
      [/^偵測到 (\d+) 把金鑰：(.+)$/, "Found $1 keys: $2"],
      [/^已匯入設定（含 (\d+) 把 Gemini 金鑰）$/, "Settings imported ($1 Gemini keys)"],
      [/^已匯出「(.+)」（內含 API 金鑰，請妥善保管）$/, "Exported “$1” (contains API keys — keep it safe)"],
      [/^已更新，共 (\d+) 個免費模型$/, "Updated — $1 free models"],
      [/^「(.+)」已經下架，改用「(.+)」$/, "“$1” was retired; using “$2” instead"],
      [/^這把金鑰可用 (\d+) 個模型，直接在上面的欄位選或輸入$/, "This key can use $1 models — pick or type one above"],
      [/^(.+) · 尚未設定模型$/, "$1 · no model set"],
      [/^（已存 (\d+) 把 Gemini 金鑰）$/, " ($1 Gemini keys saved)"],
      [/ · 登入額度$/, " · signed-in quota"],
      [/ · 免費$/, " · free"],
      [/ · 自訂$/, " · custom"],
      [/ · API$/, " · API"],

      // 網頁翻譯的進度與結果
      [/^已翻譯 (\d+) 段$/, "Translated $1 paragraphs"],
      [/^已還原快取翻譯，共 (\d+) 段，沒有新增內容$/, "Restored $1 cached paragraphs — nothing new to translate"],
      [/^頁面上這 (\d+) 段本來就是目標語言，沒有重複翻譯$/,
        "$1 paragraphs were already in the target language and were left as they are"],
      [/^模型回傳 (\d+) 段翻譯，應為 (\d+) 段$/, "The model returned $1 translations but $2 were expected"],
      [/^翻譯完成，共 (\d+) 段$/, "Done — $1 paragraphs"],
      [/^正在翻譯 (\d+) \/ (\d+) 段$/, "Translating $1 / $2 paragraphs"],
      [/^正在準備 0 \/ (\d+) 段$/, "Preparing 0 / $1 paragraphs"],
      [/^這個分頁還在跑舊版 (.+)（目前是 (.+)）。請按 F5 重新整理這個分頁。$/,
        "This tab is still running version $1 (current is $2). Press F5 to reload it."],
      [/^Safari 無法要求網站權限：(.+)$/, "Safari could not request site access: $1"],

      // PDF 閱讀器
      [/^原始 PDF，第 (\d+) 頁$/, "Original PDF, page $1"],
      [/^載入第 (\d+) 頁$/, "Loading page $1"],
      [/^譯文，第 (\d+) 頁$/, "Translation, page $1"],
      [/^正在處理 (\d+) \/ (\d+) 頁$/, "Processing page $1 of $2"],
      [/^完成 (\d+) \/ (\d+) 頁；未完成：(.+)（可按「翻譯本頁」重試）$/,
        "Finished $1 of $2 pages; failed: $3 (press “Translate this page” to retry)"],
      [/^PDF 第 (\d+) 頁尚未完成繪製，請重新翻譯本頁。$/,
        "Page $1 of the PDF has not finished rendering. Translate this page again."],
      [/^無法從 Google Drive 讀取 PDF。請確認已登入、檔案允許下載，或先下載後拖入此頁。(.*)$/,
        "The PDF could not be read from Google Drive. Check that you are signed in and the file allows downloads, or download it and drop it here. $1"],
      [/^本機模型服務無法連線（HTTP (\d+)）$/, "The local bridge service could not be reached (HTTP $1)"],
      [/^(.+)無法使用（HTTP (\d+)）$/, "$1 is unavailable (HTTP $2)"]
    ]
  };

  function resolveLanguage(setting, browserLanguage = "") {
    if (setting === "en" || setting === "zh-Hant") return setting;
    return /^zh\b/i.test(String(browserLanguage)) ? "zh-Hant" : "en";
  }

  // 樣式替換時，捕捉到的片段本身也可能是需要翻譯的中文（例如引擎名稱），
  // 所以每個群組都先查一次字典再填回去，否則會出現半英半中的句子。
  function applyPattern(text, pattern, replacement, table) {
    return text.replace(pattern, (...args) => {
      const groups = args.slice(1, -2);
      let result = replacement;
      groups.forEach((group, index) => {
        const value = typeof group === "string" ? (table[group.trim()] ?? group) : "";
        result = result.split(`$${index + 1}`).join(value);
      });
      return result;
    });
  }

  function translate(text, language) {
    if (language === "zh-Hant") return null;
    const table = MESSAGES[language];
    if (!table) return null;
    const trimmed = String(text).trim();
    if (!trimmed) return null;
    if (Object.prototype.hasOwnProperty.call(table, trimmed)) return table[trimmed];
    // HTML 裡為了排版折行的長句，文字節點會夾帶換行與縮排，
    // 直接比對永遠對不上，所以連續空白一律正規化成一個空格再查一次。
    const collapsed = trimmed.replace(/\s+/g, " ");
    if (collapsed !== trimmed && Object.prototype.hasOwnProperty.call(table, collapsed)) return table[collapsed];
    for (const [pattern, replacement] of PATTERNS[language] ?? []) {
      for (const candidate of collapsed === trimmed ? [trimmed] : [trimmed, collapsed]) {
        if (pattern.test(candidate)) return applyPattern(candidate, pattern, replacement, table);
      }
    }
    return null;
  }

  const i18nCore = Object.freeze({ MESSAGES, PATTERNS, resolveLanguage, translate });
  global.ImmerseFreeI18nCore = i18nCore;
  if (typeof module !== "undefined" && module.exports) module.exports = i18nCore;
})(globalThis);
