(function initializeI18nCore(global) {
  // 介面語言。
  //
  // 這個專案的前端本來整份寫死繁體中文。要開源給其他國家的人用，最省事又
  // 最不容易改壞的做法不是把幾百處字串改成 t("key")——那要動到每一個檔案，
  // 而且每加一個字串就多一個忘記翻的機會——而是留一份「原文 → 譯文」字典，
  // 開頁時掃一次 DOM 換掉，之後用 MutationObserver 跟著動態產生的文字換。
  // 字典裡沒有的字串一律原樣保留，所以模型 id、使用者輸入不會被誤動。

  const MESSAGES = {
    en: {
      // ── 0.8.0 新增介面文字 ──────────────────────────────
      "影片": "Video",
      "失敗自動轉移": "Automatic failover",
      "某個引擎掛掉時（額度用完、本機服務沒開、逾時、CLI 連不上）自動改用下一個， 一整批翻譯不會因為單一引擎而全部失敗。轉移只發生在「批」與「批」之間，同一句話不會翻到一半換引擎。 一次翻譯最多額外嘗試 2 個引擎就停，不會無限輪；換過引擎時工具列會顯示「已改用 ○○」，不會偷偷換。":
        "When an engine fails (quota exhausted, local bridge not running, timeout, CLI unreachable) ImmerseFree moves to the next one, so a whole batch is never lost to a single engine. Switching happens between batches only: one sentence is never translated half-way by two engines. A single translation tries at most 2 extra engines and then stops, so it never loops forever; when an engine changes the toolbar shows \"Switched to ...\", never silently.",
      "引擎失敗時自動改用下一個（預設開啟）": "Switch to the next engine when one fails (on by default)",
      "備援順序（由上而下）。第一個永遠是你在上面選的那個引擎， 這裡排的是它失敗之後的遞補次序。沒填金鑰或網址的引擎會自動跳過。":
        "Fallback order, top to bottom. The first engine is always the one you selected above; this list is the order it falls back to. Engines without a key or a URL are skipped automatically.",
      "一段 JSON。可用欄位：": "A block of JSON. Available fields:",
      "。 欄位名後面加": ". Append",
      "是「疊加在內建規則之上」，加": "to add on top of the built-in rules, or",
      "是「把內建的某幾個拿掉」； 不加後綴就是整組換掉。": "to remove some of the built-in entries; with no suffix the whole set is replaced.",
      "三種寫法：": "accepts three forms:",
      "（只比這個網域）、": "(this domain only),",
      "（比到路徑）、": "(matches the path too),",
      "（子網域，": "(subdomains,",
      "不含": "excluding",
      "裸網域 example.com）。": "the bare domain example.com).",
      "譯文主題": "Translation theme",
      "支持開發者": "Support the developer",
      "我是一名大學生。維護這類開源專案最大的負擔，是軟體與 AI 服務昂貴的訂閱費。如果你願意支持 ImmerseFree，可以透過 Buy Me a Coffee 小額贊助。贊助完全自願，也不會解鎖額外功能。":
        "I am a university student. The biggest burden of maintaining open-source projects like this is the cost of software and AI subscriptions. If you would like to support ImmerseFree, you can make a small contribution through Buy Me a Coffee. Contributions are optional and do not unlock extra features.",
      "前往 Buy Me a Coffee": "Open Buy Me a Coffee",
      // ── popup ─────────────────────────────────────────────
      "讀取翻譯模型": "Loading models",
      "字幕未開啟": "Subtitles off",
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
      // ── 網站規則（W3-2）───────────────────────────────────
      // 「規則」這個詞在別的分頁沒出現過，不會撞鍵；「內建規則」與
      // 「我的規則」刻意用跟術語表同一組措辭（預設術語庫／我的術語），
      // 兩頁的心智模型一樣，使用者不必學兩套。
      "網站規則": "Site rules",
      "內建規則": "Built-in rules",
      "我的規則": "My rules",
      "規則": "Rule",
      "網域": "Domains",
      "為什麼要有這條": "Why it exists",
      "啟用網站規則（內建規則與你的自訂規則）": "Enable site rules (built-in plus your own)",
      "同一套門檻套在所有網站上一定有例外：程式碼平台的行號不該翻、影片首頁的三個字標題該翻、百科的公式不能動。網站規則就是逐站把這幾件事講清楚。": "One set of thresholds never fits every site: line numbers on a code host should stay, three-word video titles should be translated, encyclopedia formulas must not be touched. Site rules spell that out per site.",
      "規則只影響「翻哪裡、不翻哪裡、多短算一段」，不會把任何內容送到別的地方。": "Rules only decide what gets translated, what is skipped, and how short a paragraph may be. They never send content anywhere.",
      "ImmerseFree 自寫，隨擴充一起更新，不會連外下載。你的自訂規則會疊在它們之上。": "Written by ImmerseFree and shipped with the extension. Nothing is downloaded. Your own rules stack on top of them.",
      "儲存規則": "Save rules",
      "只驗證不儲存": "Validate only",
      "插入範例": "Insert example",
      "清空我的規則": "Clear my rules",
      "目前沒有自訂規則": "No custom rules yet",
      "讀不到內建規則檔": "Could not read the built-in rules file",
      "已清空我的規則（內建規則不受影響）": "Cleared your rules (built-in rules are untouched)",
      "已儲存（目前沒有自訂規則）": "Saved (no custom rules)",
      // ── 雙語顯示與懸浮球（W3-1）────────────────────────────
      "雙語對照": "Bilingual",
      "僅譯文": "Translation only",
      "僅顯示譯文（原文暫時隱藏，隨時可切回）": "Showing translation only (original hidden; switch back anytime)",
      "已恢復雙語對照": "Bilingual view restored",
      "雙語顯示": "Bilingual display",
      "顯示模式": "Display mode",
      "雙語對照（原文＋譯文）": "Bilingual (original + translation)",
      "僅顯示譯文（原文暫時隱藏，可隨時切回）": "Translation only (original hidden; reversible)",
      "在網頁側邊顯示懸浮球（可拖曳換位置；滑過展開翻譯／還原／僅譯文）": "Show the floating ball on pages (drag to move; hover for translate / restore / translation-only)",
      "譯文在網頁上的樣子。點一種主題立刻在下面預覽，儲存後套用到之後的翻譯（已翻好的頁面也會即時換裝）。": "How translations look on the page. Pick a theme to preview it below; saving applies it, and already-translated pages restyle instantly.",
      "經典邊線": "Classic border",
      "底線": "Underline",
      "虛線": "Dashed",
      "波浪線": "Wavy",
      "高亮": "Highlight",
      "引用塊": "Blockquote",
      "弱化": "Faded",
      "斜體": "Italic",
      "粗體": "Bold",
      "紙片": "Card",
      "分隔線": "Divider",
      "無裝飾": "Plain",
      "翻譯": "Translate",
      "還原": "Restore",
      // 懸浮球的關閉鈕叫「收起」——「關閉」這個鍵已被字幕開關用走（Turn off），
      // 字典是「原文→譯文」一對一，同字不同義只能靠換字。
      "收起": "Hide",
      "ImmerseFree 翻譯選單": "ImmerseFree translate menu",
      // ── 劃詞詞典模式（W3-3）────────────────────────────────
      // 「查詢中」而不是沿用「翻譯中」：使用者看到的是詞典卡，寫「翻譯中」
      // 會讓人以為按錯了。查不到那句也刻意講「詞典資料」而不是「查詢失敗」——
      // 降級之後畫面上其實有譯文可看，說失敗反而製造誤解。
      "單字查詢": "Dictionary",
      "查詢中": "Looking up",
      "查不到這個字的詞典資料": "No dictionary entry found for this word",
      // 詞典卡複製的是整張卡（字、音標、詞性、義項、例句），不只譯文，
      // 所以另起一個字樣；「複製譯文」那一句留給翻譯卡，一個字都不動。
      "複製整筆": "Copy entry",
      "PDF 文件": "PDF document",
      "反白文字": "Selection",
      "拖曳選取，放開就翻譯": "Select text, release to translate",
      "關": "Off",
      "開": "On",
      "懸停段落": "Hover",
      "不用反白，停留 0.7 秒": "No selecting, just rest 0.7s",
      "翻譯品質": "Translation quality",
      "AI 字幕": "AI subtitles",
      "使用模型翻譯影片字幕": "Translate video subtitles with a model",
      "開啟": "Turn on",
      "關閉": "Turn off",
      "關閉翻譯卡": "Close",
      "雙軌字幕": "Dual subtitles",
      "使用 Netflix、Disney+ 原有字幕軌": "Use Netflix / Disney+ built-in subtitle tracks",
      "影集學習": "Episode study",
      "整理這一集的單字與句型": "Collect vocabulary and sentence patterns from this episode",
      "開始": "Start",
      "匯出字幕": "Export subtitles",
      "把翻好的字幕存成 SRT": "Save the translated subtitles as SRT",
      "字幕格式": "Subtitle format",
      "中文字幕": "Translation only",
      "原文字幕": "Original only",
      "雙語字幕": "Bilingual",
      "匯出完整 SRT": "Export SRT",
      "匯出已翻譯片段": "Export translated part",
      "這個格式沒有可匯出的字幕": "Nothing to export in this format",
      // ── 影片術語表 ──
      "術語表": "Glossary",
      "固定這支影片的專有名詞譯法": "Lock in how this video's proper nouns are translated",
      "編輯": "Edit",
      "關閉術語表": "Close glossary",
      "這支影片": "This video",
      "新增術語": "Add term",
      "全域釘選": "Pinned everywhere",
      "所有影片一律套用": "Applied to every video",
      "新增全域術語": "Add global term",
      "儲存術語表": "Save glossary",
      "還沒有術語": "No terms yet",
      "原文詞": "Source term",
      "固定譯法": "Fixed translation",
      "釘選這個術語": "Pin this term",
      "刪除這個術語": "Delete this term",
      "畫面上的中文是誰畫的": "Who drew the Chinese on screen?",
      "點一下指認畫面上的中文是誰畫的": "Click to identify who drew the Chinese text on screen",
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
      "AI 字幕運作中 · 使用模型額度": "AI subtitles on · uses model quota",
      "雙軌字幕運作中 · 不使用模型額度": "Dual subtitles on · no model quota used",
      "字幕模式衝突": "Subtitle modes conflict",
      "只支援 Disney+ 和 Netflix": "Disney+ and Netflix only",
      "正在抓這一集的雙語字幕…": "Collecting this episode's bilingual subtitles…",
      "影集學習目前只支援 Disney+ 和 Netflix": "Episode study currently supports Disney+ and Netflix only",
      "抓字幕失敗": "Could not read subtitles",
      "掃描中…": "Scanning…",
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
      "播放器自己的字幕": "The player's own subtitles",
      "別的擴充功能（或頁面自己）插入的": "Inserted by another extension (or the page itself)",
      "沒有取得結果。": "No result.",
      "現在畫面下半部沒有中文。等字幕出現時再點一次。": "There is no Chinese in the lower half of the screen right now. Click again once subtitles appear.",
      "ImmerseFree：雙軌字幕": "ImmerseFree: dual subtitles",
      "ImmerseFree：AI 影片字幕": "ImmerseFree: AI video subtitles",
      "ImmerseFree：字幕列（無來源標記，代表跑的是舊版）": "ImmerseFree: subtitle line (no source tag, so an older build is running)",
      "ImmerseFree：網頁翻譯插入的譯文": "ImmerseFree: translation inserted by page translation",
      "ImmerseFree：YouTube 字幕": "ImmerseFree: YouTube subtitles",
      "ImmerseFree：其他元素": "ImmerseFree: other elements",

      "模型回傳空白翻譯": "The model returned an empty translation",
      "請先在設定中允許網頁雙語翻譯": "Turn on bilingual page translation in the settings first",
      "已移除網頁翻譯": "Page translation removed",
      "已翻譯選取文字": "Selected text translated",
      "快速翻譯": "Quick translation",
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
      "OpenCode token／API key（免費入口可留空）": "OpenCode token / API key (leave empty for the free tier)",
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
      "精簡字幕": "Concise subtitles",
      "自訂翻譯偏好": "Custom translation preferences",
      "例如：金融術語保留英文縮寫；人名不翻譯；語氣保持正式。":
        "For example: keep financial acronyms in English; do not translate personal names; keep the tone formal.",
      "使用 Disney+ 或 Netflix 現有的第二條字幕軌，不經模型，也不消耗額度。":
        "Uses the second subtitle track Disney+ or Netflix already ships. No model involved, no quota consumed.",
      "第二條字幕語言": "Second subtitle language",
      "播放器已顯示第二條語言時，改用": "When the player already shows that language, use",
      "切換播放器字幕後會依畫面文字自動判斷，不用重設。":
        "After switching subtitles in the player this is detected from the on-screen text, so nothing needs resetting.",
      "功能": "Features",
      "允許網頁雙語翻譯": "Allow bilingual page translation",
      "允許影片雙語字幕": "Allow bilingual video subtitles",
      "字幕保留原文": "Keep the original subtitle line",
      "反白文字後立即翻譯": "Translate as soon as text is selected",
      "滑鼠懸停段落 0.7 秒後翻譯": "Translate after hovering a paragraph for 0.7s",
      "輸入框連按三次空白時翻譯": "Translate in text fields after three spaces",
      "設定搬家": "Move your settings",
      "匯出檔會包含 API 金鑰。請妥善保管，再於另一台 Windows 或 Mac 匯入。":
        "The export file contains your API keys. Keep it safe, then import it on another Windows or Mac machine.",
      "匯出設定": "Export settings",
      "匯入設定": "Import settings",
      "儲存並測試": "Save and test",
      "一行一把（用逗號或空格分隔也可以）": "One per line (commas or spaces work too)",
      "例如：OpenAI、Groq、我的 Ollama": "e.g. OpenAI, Groq, My Ollama",
      "請先填寫 API base URL": "Enter the API base URL first",
      "抓取中…": "Fetching…",
      "需要授權存取這個網域才能連線": "Permission for this domain is required to connect",
      "無法取得模型清單": "Could not fetch the model list",
      "這個端點沒有回傳任何模型，請直接輸入模型 id": "This endpoint returned no models. Type the model id directly.",
      "已匯入設定": "Settings imported",
      "目前無法取得免費模型清單": "The free model list is unavailable right now",
      "正在測試…": "Testing…",
      "API 測試失敗": "API test failed",
      "這不是有效的 JSON 檔": "This is not a valid JSON file",
      "這不是 ImmerseFree 的設定檔": "This is not an ImmerseFree settings file",


      // ── 影集學習的程度描述（來自 study-core 的資料表）──────
      "CEFR A1（入門）": "CEFR A1 (Beginner)",
      "CEFR A2（基礎）": "CEFR A2 (Elementary)",
      "CEFR B1（中級）": "CEFR B1 (Intermediate)",
      "CEFR B2（中高級）": "CEFR B2 (Upper-Intermediate)",
      "CEFR C1（高級）": "CEFR C1 (Advanced)",
      "CEFR C2（精通）": "CEFR C2 (Mastery)",
      "約 500 到 1000 個常用字": "roughly 500-1,000 common words",
      "約 1000 到 2000 個常用字": "roughly 1,000-2,000 common words",
      "約 2000 到 3500 個常用字": "roughly 2,000-3,500 common words",
      "約 3500 到 6000 個常用字": "roughly 3,500-6,000 common words",
      "約 6000 到 9000 個字": "roughly 6,000-9,000 words",
      "接近母語者": "near-native",
      "最高頻的日常單字、單一詞義、現在式與過去式的基本句型":
        "the most frequent everyday words, single senses, and basic present and past sentence patterns",
      "日常生活與工作情境的高頻字、最常見的片語動詞、簡單的連接詞":
        "high-frequency words for daily life and work, the commonest phrasal verbs, and simple connectives",
      "常見片語動詞、搭配詞、口語中高頻的慣用說法、關係子句":
        "common phrasal verbs, collocations, frequent spoken idioms, and relative clauses",
      "慣用語、語氣與言外之意、細微的近義詞差異、道地的口語縮寫":
        "idioms, tone and implication, fine distinctions between near-synonyms, and natural spoken contractions",
      "俚語、雙關、文化典故、語域差異、細膩的語氣轉折":
        "slang, wordplay, cultural references, register, and subtle shifts in tone",
      "罕用語、修辭、幽默的建構方式、地區性與世代性用法":
        "rare words, rhetoric, how humour is built, and regional or generational usage",
      "分": " points",
      "完全沒有基礎": "no foundation at all",

      // ── study ─────────────────────────────────────────────
      "讀取字幕中…": "Loading subtitles…",
      "你的程度": "Your level",
      "分數只用來換算 CEFR 與教材難度。": "Scores are only used to map to CEFR and pick the material's difficulty.",
      "純新手": "Complete beginner",
      "沒有基礎，從最高頻的字開始": "No foundation, start from the most frequent words",
      "多益": "TOEIC",
      "TOEIC 聽讀總分": "TOEIC Listening & Reading total",
      "雅思": "IELTS",
      "全民英檢": "GEPT",
      "已通過的級數": "Level passed",
      "多益分數": "TOEIC score",
      "雅思分數": "IELTS band",
      "級數": "Level",
      "初級": "Elementary",
      "中級": "Intermediate",
      "中高級": "High-Intermediate",
      "高級": "Advanced",
      "生成教材": "Generate material",
      "單字": "Vocabulary",
      "實用句型": "Useful sentence patterns",
      "複製成文字": "Copy as text",
      "換個程度重做": "Redo at a different level",
      "程度依據": "Level basis",
      "沒有可用的字幕資料": "No subtitle data available",
      "請回到 Disney+ 或 Netflix 的播放頁面，按擴充功能裡的「影集學習」重新抓一次。":
        "Go back to the Disney+ or Netflix player and press “Episode study” in the extension to collect again.",
      "這一集": "This episode",
      "請填入有效的分數或級數。": "Enter a valid score or level.",
      "正在送出第一批…": "Sending the first batch…",
      "生成失敗": "Generation failed",
      "已複製到剪貼簿。": "Copied to clipboard.",
      "影集學習目前只支援 Disney+ 和 Netflix。": "Episode study currently supports Disney+ and Netflix only.",

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
      "已停止，完成內容已保留": "Stopped. Finished pages are kept.",
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

      // ── EPUB 閱讀器（W3-4，新字串集中在這一塊）──────────────
      "ImmerseFree：EPUB 雙語": "ImmerseFree: bilingual EPUB",
      "EPUB 雙語": "Bilingual EPUB",
      "EPUB 電子書": "EPUB e-book",
      "選擇 EPUB": "Choose EPUB",
      "翻譯整本": "Translate the book",
      "匯出雙語 EPUB": "Export bilingual EPUB",
      "開啟 EPUB 電子書": "Open an EPUB",
      "拖入本機 EPUB，逐章翻譯後匯出雙語版本。":
        "Drop a local EPUB here, translate it chapter by chapter, then export a bilingual copy.",
      "章節清單": "Chapters",
      "選擇章節": "Pick a chapter",
      "尚未翻譯": "Not translated yet",
      "未翻譯": "Not translated",
      "已翻譯": "Translated",
      "部分翻譯": "Partially translated",
      "翻譯中": "Translating",
      "失敗": "Failed",
      "翻譯本章": "Translate this chapter",
      "從左側選擇章節以預覽內容": "Pick a chapter on the left to preview it",
      "這一章沒有可翻譯的文字段落。": "This chapter has no translatable text.",
      "這一章的 XHTML 無法解析，將原樣保留": "This chapter's XHTML could not be parsed; it is kept as-is",
      "zip 裡找不到這一章的檔案": "The chapter file is missing from the zip",
      "已停止，完成章節已保留": "Stopped. Finished chapters are kept.",
      "無法開啟 EPUB": "Could not open the EPUB",
      "無法開啟 EPUB。": "Could not open the EPUB.",
      "這個檔案不是 EPUB。請選擇副檔名為 .epub 的檔案。":
        "This file is not an EPUB. Choose a file whose name ends in .epub.",
      "這個檔案不是 EPUB（不是 zip 容器）。": "This file is not an EPUB (not a zip container).",
      "EPUB 缺少 META-INF/container.xml，無法解析。": "The EPUB is missing META-INF/container.xml, so it cannot be parsed.",
      "EPUB 找不到 OPF（書的目錄檔），無法解析。": "The EPUB's OPF (its table of contents file) is missing, so it cannot be parsed.",
      "這本 EPUB 的 spine 沒有任何章節。": "This EPUB's spine lists no chapters.",

      // ── 各引擎共用的錯誤訊息 ───────────────────────────────
      "模型回傳格式異常：無法解析翻譯結果": "The model returned a malformed response: the translation could not be parsed",
      "所有 Gemini API key 目前都無法使用": "None of the Gemini API keys can be used right now",
      "所有 Gemini API key 目前都在冷卻或無法使用": "Every Gemini API key is cooling down or unusable right now",
      "尚未填寫自訂 API 的 base URL": "The custom API base URL has not been set",
      "尚未選擇自訂 API 的模型": "No model has been chosen for the custom API",
      "自訂 API 沒有回傳文字內容": "The custom API returned no text",
      "OpenCode API key 無效或已過期，請到選項頁清空金鑰改用免費額度，或換一把新的金鑰":
        "The OpenCode API key is invalid or expired. Clear it on the options page to use the free tier, or enter a new one.",

      // ── 診斷分頁（W1-4）──────────────────────────────────
      // 錯誤碼本身的訊息不在這裡：它們由 core/diagnostics-core.js 在載入時
      // 透過 registerMessages 併進來，來源只有註冊表那一份。
      "設定": "Settings",
      "診斷": "Diagnostics",
      "最近 50 筆翻譯事件，瀏覽器關掉就清空。": "The last 50 translation events. Cleared when the browser closes.",
      "這份紀錄只有時間、錯誤碼、引擎、批次大小與耗時，不會記錄網頁或字幕的任何一個字。":
        "This log holds only timestamps, error codes, engines, batch sizes and durations — not a single word of any page or subtitle.",
      "重新整理": "Refresh",
      "複製診斷報告": "Copy report",
      "清除紀錄": "Clear log",
      "各引擎成功率": "Success rate by engine",
      "事件": "Events",
      "引擎": "Engine",
      "成功率": "Success rate",
      "成功": "Succeeded",
      "失敗": "Failed",
      "最後一次": "Last code",
      "時間": "Time",
      "嚴重度": "Severity",
      "錯誤碼": "Code",
      "批次": "Batch",
      "耗時": "Duration",
      "說明與下一步": "What happened and what to do",
      "尚無紀錄": "No records yet",
      "已複製診斷報告": "Diagnostics report copied",
      "已清除診斷紀錄": "Diagnostics log cleared",
      "無法自動複製，報告已顯示在下方，請手動選取": "Copying failed. The report is shown below, select and copy it manually.",
      "拿不到診斷資料": "The diagnostics data could not be read",
      "清除失敗": "Clearing failed",

      // ── 匯出矩陣與統計（W4）──────────────────────────────
      // 匯出鍵在 popup、PDF 閱讀器與 EPUB 閱讀器三處，字串共用同一份，
      // 三個地方講同一句話。
      "匯出雙語 Word": "Export Word",
      "匯出雙語 PDF": "Export bilingual PDF",
      "正在收集這一頁的譯文…": "Collecting this page's translations…",
      "這一頁還沒有譯文可以匯出。請先按「翻譯這個網頁」。":
        "There is nothing to export yet. Press \u201cTranslate this page\u201d first.",
      "匯出模組沒有載入，請重新載入擴充功能後再試":
        "The export module did not load. Reload the extension and try again.",
      "收集譯文失敗": "Collecting the translations failed",
      "這個分頁還在跑舊版內容腳本，請按 F5 重新整理後再試。":
        "This tab is still running an older content script. Press F5 to reload it, then try again.",
      "版面已備妥，請在列印對話框選擇「另存為 PDF」":
        "Layout ready \u2014 choose \u201cSave as PDF\u201d in the print dialog",

      // 診斷分頁的統計區塊（W4-2）。指標名稱要看得懂「這個數字是什麼的比例」，
      // 所以「組成」那一欄的分子分母也一起翻（見下面的 PATTERNS）。
      "統計": "Metrics",
      "匯出統計 JSON": "Export metrics JSON",
      "累計數字，跨瀏覽階段保留（按「清除紀錄」會一起歸零）。分母還是 0 的指標顯示為「尚無資料」。":
        "Running totals that survive browser restarts (\u201cClear log\u201d resets them too). Metrics whose denominator is still 0 show as \u201cNo data yet\u201d.",
      "指標": "Metric",
      "數值": "Value",
      "組成": "Breakdown",
      "快取命中率": "Cache hit rate",
      "引擎轉移次數": "Engine handoffs",
      "拆批率": "Batch split rate",
      "富文本降級次數": "Rich-text fallbacks",
      "詞典降級次數": "Dictionary fallbacks",
      "字幕語意合併率": "Subtitle merge ratio",
      "尚無資料": "No data yet",

      // ── 術語表分頁（W2-4）────────────────────────────────
      // 「術語表」「新增術語」「儲存術語表」「原文詞」「固定譯法」在上面的
      // popup 區已經有了，這裡不重複——同一句中文只能有一個英文譯法，
      // 重複條目會讓「改了一處、另一處還是舊的」變成看不見的 bug。
      "固定專有名詞的譯法，讓同一個詞從頭到尾翻成同一個說法。網頁、PDF、劃詞翻譯都會套用。":
        "Lock in how technical terms are translated so the same word reads the same way throughout. Applies to pages, PDFs and selected text.",
      "只有這段文字真的出現過的術語才會送進模型，沒講到的詞一個字都不會多送，所以術語表再長也不會讓翻譯變慢或變貴。":
        "Only terms that actually appear in the text are sent to the model, so a long glossary costs nothing extra.",
      "在網頁、PDF、劃詞也套用術語表": "Apply the glossary to pages, PDFs and selected text",
      "影片自己分析出來的術語、以及你在影片裡改過的譯法，一直都在，不受這個開關影響；預設術語庫要這個開關開著才會套到字幕。":
        "Terms a video's own analysis found, and any wording you edited there, always apply and are not affected by this switch. The built-in glossary reaches subtitles only while this switch is on.",
      "預設術語庫": "Built-in glossary",
      "ImmerseFree 自行編寫的英中對照，用台灣通行的說法。優先序最低：你自己加的術語一律蓋得過它。目標語言不是繁體中文時整份不套用。":
        "English-to-Chinese pairs written by ImmerseFree, using the wording common in Taiwan. Lowest priority: your own terms always win. Skipped entirely when the target language is not Traditional Chinese.",
      "啟用預設術語庫": "Use the built-in glossary",
      "領域": "Field",
      "科技與軟體": "Technology and software",
      "財經與投資": "Finance and investing",
      "醫療與生技": "Medicine and life sciences",
      "我的術語": "My terms",
      "釘選的會排在最前面，一次帶進模型的術語有上限時優先保留。停用的完全不會被送出，但留在清單裡隨時可以打開。":
        "Pinned terms come first and survive the per-request limit. Disabled terms are never sent but stay in the list so you can switch them back on.",
      "釘選": "Pin",
      "停用": "Off",
      "刪除": "Delete",
      "匯出術語表": "Export glossary",
      "匯入術語表": "Import glossary",
      "清空我的術語": "Clear my terms",
      "原文詞，例如 cache": "Source term, e.g. cache",
      "固定譯法，例如 快取": "Fixed translation, e.g. 快取",
      "原文詞和固定譯法都要填": "Both the source term and its translation are required",
      "已從清單移除，記得按「儲存術語表」": "Removed from the list. Remember to press Save glossary.",
      "已清空自訂術語（預設術語庫不受影響）": "Your terms were cleared (the built-in glossary is untouched)",
      "這不是 ImmerseFree 的術語表檔": "This is not an ImmerseFree glossary file"
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
      [/^已更新，共 (\d+) 筆事件$/, "Updated — $1 events"],
      [/^共 (\d+) 筆事件$/, "$1 events"],

      // 匯出與統計（W4）。統計那幾條都帶分子分母，只翻單位不動數字。
      [/^已匯出 (\d+) 段雙語 Word$/, "Exported $1 bilingual paragraphs to Word"],
      [/^已匯出「(.+)」（只有統計數字，沒有任何頁面內容）$/,
        "Exported “$1” (numbers only — no page content)"],
      [/^正在準備列印版面 (\d+) \/ (\d+) 頁$/, "Preparing print layout — page $1 of $2"],
      [/^第 (.+) 頁沒有可翻譯的文字層，仍會印出原始頁面$/,
        "Page $1 has no text layer; the original page is still printed"],
      [/^(\d+) \/ (\d+) 段$/, "$1 / $2 paragraphs"],
      [/^(\d+) \/ (\d+) 批$/, "$1 / $2 batches"],
      [/^(\d+) 組 \/ (\d+) 句$/, "$1 groups / $2 lines"],
      [/^最近 50 筆事件中 (\d+) 次$/, "$1 in the last 50 events"],
      [/^(\d+) 次$/, "$1 times"],

      // 術語表分頁（W2-4）。領域那條刻意把三個標籤寫死在樣式裡而不是用 (.+)：
      // 寬鬆的樣式會把使用者自己打的術語也當成介面文字換掉。
      [/^(科技與軟體|財經與投資|醫療與生技)（(\d+) 條）$/, "$1 ($2 terms)"],
      [/^目前有 (\d+) 條自訂術語$/, "$1 terms of your own"],
      [/^已啟用 (\d+) 條預設術語（全庫 (\d+) 條）$/, "$1 built-in terms active (of $2 in total)"],
      [/^預設術語庫已關閉，一條都不會套用（全庫 (\d+) 條）$/,
        "The built-in glossary is off — none of its $1 terms are applied"],
      [/^已儲存 (\d+) 條術語$/, "Saved $1 terms"],
      [/^已匯入 (\d+) 條術語$/, "Imported $1 terms"],
      [/^已匯出「(.+)」，共 (\d+) 條$/, "Exported “$1” — $2 terms"],
      [/^已更新「(.+)」的譯法$/, "Updated the translation of “$1”"],
      [/^已加入「(.+)」，記得按「儲存術語表」$/, "Added “$1” — remember to press Save glossary"],
      [/^「(.+)」已經下架，改用「(.+)」$/, "“$1” was retired; using “$2” instead"],
      [/^這把金鑰可用 (\d+) 個模型，直接在上面的欄位選或輸入$/, "This key can use $1 models — pick or type one above"],
      [/^抓到 (\d+) 句，開啟學習頁$/, "Collected $1 lines — opening the study page"],
      [/^已翻譯 (\d+) 句$/, "$1 lines translated"],
      [/^已匯出 (\d+) 句字幕$/, "Exported $1 subtitle lines"],
      [/^已收錄 (\d+) 個術語$/, "$1 terms collected"],
      [/^已儲存 (\d+) 個影片術語、(\d+) 個全域術語$/, "Saved $1 video terms and $2 global terms"],
      [/^領域：(.+)$/, "Domain: $1"],
      [/^無法掃描：(.+)$/, "Cannot scan: $1"],
      [/^正在整理第 (\d+) \/ (\d+) 批…$/, "Processing batch $1 of $2…"],
      [/^完成：(\d+) 個單字、(\d+) 個句型$/, "Done: $1 words, $2 sentence patterns"],
      [/^（(\d+) 批失敗）$/, " ($1 batches failed)"],
      [/^(\d+) 個$/, "$1"],
      [/^(.+) · 尚未設定模型$/, "$1 · no model set"],
      [/^其中 (\d+) 行不是 ImmerseFree 畫的。我們的字幕列共 (\d+) 條（正常是 0 或 1）。$/,
        "$1 of those lines were not drawn by ImmerseFree. Our subtitle lines: $2 (0 or 1 is normal)."],
      [/^全部都是 ImmerseFree 畫的。字幕列共 (\d+) 條。$/,
        "All of them were drawn by ImmerseFree. Subtitle lines: $1."],
      [/^（已存 (\d+) 把 Gemini 金鑰）$/, " ($1 Gemini keys saved)"],
      [/ · 登入額度$/, " · signed-in quota"],
      [/ · 免費$/, " · free"],
      [/ · 自訂$/, " · custom"],
      [/ · API$/, " · API"],
      [/^依$/, "Based on"],
      [/^換算為$/, "→"],
      [/^。$/, "."],
      [/^假設你的單字量 (.+)，教材會著重：(.+)。$/, "Assuming a vocabulary of $1, the material focuses on $2."],
      [/^(\d+) 句　(.+) → (.+)$/, "$1 lines　$2 → $3"],

      // 網頁翻譯的進度與結果
      [/^已翻譯 (\d+) 段$/, "Translated $1 paragraphs"],
      [/^已還原快取翻譯，共 (\d+) 段，沒有新增內容$/, "Restored $1 cached paragraphs — nothing new to translate"],
      [/^頁面上這 (\d+) 段本來就是目標語言，沒有重複翻譯$/,
        "$1 paragraphs were already in the target language and were left as they are"],
      [/^模型回傳 (\d+) 段翻譯，應為 (\d+) 段$/, "The model returned $1 translations but $2 were expected"],
      [/^翻譯完成，共 (\d+) 段$/, "Done — $1 paragraphs"],
      [/^正在翻譯 (\d+) \/ (\d+) 段$/, "Translating $1 / $2 paragraphs"],
      [/^正在準備 0 \/ (\d+) 段$/, "Preparing 0 / $1 paragraphs"],
      // 長頁走「視窗內優先」時的分母是已進入視野的段數，不是全頁段數。
      [/^已翻 (\d+) \/ 可見 (\d+) 段$/, "$1 / $2 visible paragraphs done"],
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

  // 樣式替換時，捕捉到的片段本身也可能是需要翻譯的中文（例如程度描述），
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

  // 讓別的模組把自己那一份對照表併進來（W1-4：錯誤碼註冊表）。
  //
  // 為什麼不直接把錯誤字串抄進上面的 MESSAGES：那樣同一句話會有兩份——
  // 註冊表一份、字典一份——改了一邊忘了另一邊，畫面就會半中半英，而且
  // 沒有任何測試會紅。改成註冊表在載入時把 pairs 推進來，來源只有一個。
  //
  // 只補沒有的鍵：這裡的字典是既有介面文字的正本，後來者不該覆蓋它。
  // 撞名時回報數量，呼叫端要處理就處理，至少不會靜默消失。
  function registerMessages(language, pairs) {
    const table = MESSAGES[language];
    if (!table || !pairs || typeof pairs !== "object") return { added: 0, skipped: 0 };
    let added = 0;
    let skipped = 0;
    for (const [source, translated] of Object.entries(pairs)) {
      if (typeof source !== "string" || typeof translated !== "string" || !source.trim()) continue;
      if (Object.prototype.hasOwnProperty.call(table, source)) { skipped += 1; continue; }
      table[source] = translated;
      added += 1;
    }
    return { added, skipped };
  }

  const i18nCore = Object.freeze({ MESSAGES, PATTERNS, resolveLanguage, translate, registerMessages });
  global.ImmerseFreeI18nCore = i18nCore;
  if (typeof module !== "undefined" && module.exports) module.exports = i18nCore;
})(globalThis);
