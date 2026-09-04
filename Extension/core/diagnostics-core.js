(function initializeDiagnosticsCore(global) {
  // ================================================================ 錯誤碼註冊表（W1-4）
  //
  // 這個專案原本有三組互不認識的錯誤描述：
  //   1. Bridge（opencode-cli-core.mjs）自己分好的 9 個 code；
  //   2. provider-core 的 PROVIDER_* 家族（W1-2 為了「該不該換引擎」而分的）；
  //   3. 散落在 background／content／popup 裡的中文字串。
  // 同一件事在三個地方有三種說法，使用者看到的訊息取決於它從哪一層冒出來。
  //
  // 這份註冊表是**唯一**的「code → 嚴重度 ＋ 兩種語言的訊息」對照。規則：
  //   - 每一個 code 都必須有 `zh-Hant` 與 `en` 兩份訊息，缺一測試就紅。
  //   - zh-Hant 訊息裡一定要講「下一步做什麼」。只說「連線失敗」等於沒說。
  //   - en 訊息會在載入時註冊進 i18n-core 的字典，介面切英文時整句換掉；
  //     所以 UI 一律寫 zh-Hant 的那一句，不要自己判斷語言（除了本檔自己的
  //     `messageFor`，它是給沒有 DOM 掃描器的場合用的）。
  //
  // 嚴重度只有四級，判準寫死在這裡免得每個人各自解讀：
  //   info     ——不是故障，只是「這次沒東西可做」（頁面沒有可翻段落）。
  //   warning  ——暫時性，等一下或自動轉移就會好（額度、逾時、格式錯）。
  //   error    ——這一次請求失敗了，使用者要做點什麼才會好。
  //   critical ——不處理就一直壞（服務沒開、金鑰沒填、整條引擎鏈都用完）。
  const SEVERITY = Object.freeze({
    INFO: "info",
    WARNING: "warning",
    ERROR: "error",
    CRITICAL: "critical"
  });

  const SEVERITY_ORDER = Object.freeze(["info", "warning", "error", "critical"]);

  const SEVERITY_LABELS = Object.freeze({
    info: { "zh-Hant": "提示", en: "Info" },
    warning: { "zh-Hant": "注意", en: "Warning" },
    error: { "zh-Hant": "錯誤", en: "Error" },
    critical: { "zh-Hant": "嚴重", en: "Critical" }
  });

  // ---------------------------------------------------------------- 註冊表本體
  //
  // 分組只是給人讀的，程式一律用扁平的 code 查。
  const DIAGNOSTIC_CODES = Object.freeze({
    // ── 成功事件 ────────────────────────────────────────────
    // 成功也要進事件表，否則「各 provider 最近成功率」的分母是假的。
    TRANSLATION_OK: {
      severity: SEVERITY.INFO,
      "zh-Hant": "這一批翻譯完成，沒有發生任何錯誤。",
      en: "This batch was translated with no errors."
    },

    // ── Bridge 側的 9 個 code（opencode-cli-core.mjs:10）────
    // 這些會原樣出現在 Bridge 的回應裡。provider-core 另外把它們對映成
    // PROVIDER_* 家族來決定「要不要換引擎」，但診斷面板要看得到原始那一個，
    // 不然「CLI 沒裝」跟「模型回 500」在畫面上會長得一模一樣。
    CLI_NOT_FOUND: {
      severity: SEVERITY.CRITICAL,
      "zh-Hant": "找不到 opencode 指令。請先安裝 opencode，或在選項頁改用其他翻譯引擎。",
      en: "The opencode command was not found. Install opencode, or switch to another engine in the options page."
    },
    CLI_TIMEOUT: {
      severity: SEVERITY.WARNING,
      "zh-Hant": "opencode 太久沒有回應，這一批已中止。請重試，或改用其他翻譯引擎。",
      en: "opencode stopped responding and this batch was aborted. Try again, or switch to another engine."
    },
    CLI_CRASHED: {
      severity: SEVERITY.ERROR,
      "zh-Hant": "opencode 執行中途結束。請重試一次；一直發生就到選項頁改用其他翻譯引擎。",
      en: "opencode exited unexpectedly. Try again; if it keeps happening, switch engines in the options page."
    },
    BAD_OUTPUT: {
      severity: SEVERITY.WARNING,
      "zh-Hant": "opencode 沒有輸出任何內容。通常是免費模型當下不穩，重試一次即可。",
      en: "opencode produced no output. The free model is usually just unstable right now — try again."
    },
    MODEL_HTTP_ERROR: {
      severity: SEVERITY.ERROR,
      "zh-Hant": "免費模型回報錯誤。請稍後重試，或到選項頁換一個免費模型。",
      en: "The free model returned an error. Try again later, or pick a different free model in the options page."
    },
    CATALOG_UNAVAILABLE: {
      severity: SEVERITY.WARNING,
      "zh-Hant": "拿不到免費模型清單，先沿用你原本選的模型。網路恢復後會自己更新。",
      en: "The free model catalog is unavailable, so your current model is kept. It refreshes itself once the network is back."
    },
    CIRCUIT_OPEN: {
      severity: SEVERITY.WARNING,
      "zh-Hant": "opencode 連續失敗太多次，已暫停使用一段時間。稍後會自動恢復，或現在改用其他翻譯引擎。",
      en: "opencode failed too many times in a row and is paused for a while. It recovers on its own, or switch engines now."
    },
    BAD_REQUEST: {
      severity: SEVERITY.ERROR,
      "zh-Hant": "送出的請求本身不合法（模型或參數不對）。請到選項頁重新整理模型清單再試。",
      en: "The request itself was invalid (wrong model or parameters). Refresh the model list in the options page and try again."
    },
    UNKNOWN: {
      severity: SEVERITY.ERROR,
      "zh-Hant": "翻譯引擎回報了一個沒見過的錯誤。請重試；一直發生就把診斷報告複製下來回報。",
      en: "The engine reported an unrecognised error. Try again; if it persists, copy the diagnostics report and file it."
    },

    // ── provider 家族（provider-core.js PROVIDER_ERROR_CODES）─
    PROVIDER_RATE_LIMIT: {
      severity: SEVERITY.WARNING,
      "zh-Hant": "這個引擎的額度暫時用完或太忙。等一下就會恢復；已開啟自動轉移的話會先改用下一個引擎。",
      en: "This engine is rate limited or out of quota for now. It recovers shortly; with automatic fallback on, the next engine takes over."
    },
    PROVIDER_UNREACHABLE: {
      severity: SEVERITY.ERROR,
      "zh-Hant": "連不上這個翻譯引擎。請檢查網路，或到選項頁確認 API 位址填對了。",
      en: "This engine could not be reached. Check your network, or confirm the API address in the options page."
    },
    PROVIDER_TIMEOUT: {
      severity: SEVERITY.WARNING,
      "zh-Hant": "翻譯引擎超過時限沒有回應，這一批已放棄。請重試，或改用其他引擎。",
      en: "The engine did not answer within the time limit, so this batch was dropped. Try again, or switch engines."
    },
    PROVIDER_NOT_CONFIGURED: {
      severity: SEVERITY.CRITICAL,
      "zh-Hant": "這個翻譯引擎還沒設定完成。請到選項頁補上金鑰、模型或 API 位址。",
      en: "This engine is not fully configured. Add the API key, model, or API address in the options page."
    },
    PROVIDER_BAD_REQUEST: {
      severity: SEVERITY.ERROR,
      "zh-Hant": "翻譯引擎不接受這次的請求。換一個引擎也會一樣，請到選項頁檢查模型設定。",
      en: "The engine rejected this request. Another engine would fail the same way — check the model settings in the options page."
    },
    PROVIDER_SERVER_ERROR: {
      severity: SEVERITY.ERROR,
      "zh-Hant": "翻譯引擎那一端出錯了。請稍後重試，或改用其他引擎。",
      en: "The engine returned a server-side error. Try again later, or switch engines."
    },
    PROVIDER_EMPTY_RESPONSE: {
      severity: SEVERITY.ERROR,
      "zh-Hant": "翻譯引擎回了一個空的結果。請重試一次；一直空白就換一個模型。",
      en: "The engine returned an empty result. Try again; if it stays empty, pick another model."
    },
    PROVIDER_UNSUPPORTED: {
      severity: SEVERITY.CRITICAL,
      "zh-Hant": "設定裡的翻譯引擎不存在。請到選項頁重新選一個引擎並儲存。",
      en: "The engine named in your settings does not exist. Pick an engine again in the options page and save."
    },
    PROVIDER_UNKNOWN: {
      severity: SEVERITY.ERROR,
      "zh-Hant": "翻譯失敗，但分類不出原因。請重試；一直發生就把診斷報告複製下來回報。",
      en: "Translation failed for an unclassified reason. Try again; if it persists, copy the diagnostics report and file it."
    },
    PROVIDER_POOL_EXHAUSTED: {
      severity: SEVERITY.CRITICAL,
      "zh-Hant": "所有可用的翻譯引擎都失敗了，已用完這次的轉移預算。請到選項頁確認至少有一個引擎能用。",
      en: "Every available engine failed and the fallback budget for this run is used up. Make sure at least one engine works in the options page."
    },
    GEMINI_KEYS_EXHAUSTED: {
      severity: SEVERITY.WARNING,
      "zh-Hant": "所有 Gemini 金鑰都在冷卻中。等冷卻結束、多貼幾把金鑰，或先改用其他引擎。",
      en: "Every Gemini key is cooling down. Wait it out, add more keys, or switch engines for now."
    },
    OPENCODE_KEY_INVALID: {
      severity: SEVERITY.CRITICAL,
      "zh-Hant": "OpenCode 金鑰無效或已過期。請到選項頁清空金鑰改用免費額度，或換一把新的。",
      en: "The OpenCode key is invalid or expired. Clear it in the options page to use the free tier, or paste a new one."
    },

    // ── 本機 Bridge 連線 ────────────────────────────────────
    // 跟 PROVIDER_UNREACHABLE 分開的理由：下一步完全不同。這一個要去「啟動
    // 那個服務」，而 PROVIDER_UNREACHABLE 是網路或網址寫錯。混成一句會把人
    // 指向錯的地方。
    BRIDGE_OFFLINE: {
      severity: SEVERITY.CRITICAL,
      "zh-Hant": "本機 Bridge 服務沒有啟動。請先執行 ImmerseFree 的 Start／安裝腳本，再重試一次。",
      en: "The local ImmerseFree Bridge service is not running. Run the Start / install script, then try again."
    },
    BRIDGE_TIMEOUT: {
      severity: SEVERITY.WARNING,
      "zh-Hant": "本機 Bridge 服務太久沒有回應，這次請求已中止。請重跑 Start 腳本，或改用其他翻譯引擎。",
      en: "The local Bridge did not answer in time and the request was aborted. Restart it with the Start script, or switch engines."
    },

    // ── 協定與格式（batch-core 的地盤）─────────────────────
    FORMAT_MISMATCH: {
      severity: SEVERITY.WARNING,
      "zh-Hant": "模型回傳的格式或段數不對，正在自動拆批重試。多半會自己好。",
      en: "The model returned the wrong shape or number of segments; the batch is being split and retried automatically."
    },
    EMPTY_TRANSLATION: {
      severity: SEVERITY.WARNING,
      "zh-Hant": "模型對某一段回了空白譯文。請重試這一頁；一直空白就換一個模型。",
      en: "The model returned a blank translation for one paragraph. Retry the page; if it stays blank, pick another model."
    },

    // ── 請求驗證（背景頁在打引擎之前就擋下來的）────────────
    REQUEST_SEGMENT_COUNT: {
      severity: SEVERITY.ERROR,
      "zh-Hant": "一次翻譯的段落數必須是 1 到 40 段。這通常是內容腳本的問題，請重新整理網頁再試。",
      en: "A translation request must contain 1 to 40 segments. Reload the page and try again."
    },
    REQUEST_SEGMENT_LENGTH: {
      severity: SEVERITY.ERROR,
      "zh-Hant": "有段落是空的或超過 2000 字。請重新整理網頁再試一次。",
      en: "A segment was empty or longer than 2000 characters. Reload the page and try again."
    },
    REQUEST_TOO_LARGE: {
      severity: SEVERITY.ERROR,
      "zh-Hant": "這一批的總字數太多。請重新整理網頁再試一次。",
      en: "This batch contains too much text in total. Reload the page and try again."
    },

    // ── 網頁層 ─────────────────────────────────────────────
    NO_CANDIDATES: {
      severity: SEVERITY.INFO,
      "zh-Hant": "這個頁面找不到可翻譯的文字段落。可能內容還沒載入完，或整頁都是圖片。",
      en: "No translatable paragraphs were found on this page. The content may still be loading, or the page may be all images."
    },
    // 富文本硬校驗沒過（W2-2）。這是**設計中的降級，不是故障**：模型把
    // ⟦1⟧…⟦/1⟧ 這種行內標記弄丟或弄亂時，整段改用純文字譯文，畫面永遠不會
    // 出現破碎的標記。所以嚴重度是 info——使用者不必做任何事，只是那一段的
    // 連結與粗體沒有保留下來。診斷頁看得到它出現的頻率，換模型時有依據。
    RICHTEXT_FALLBACK: {
      severity: SEVERITY.INFO,
      "zh-Hant": "有段落的連結或粗體標記沒有被模型完整帶回來，已自動改用純文字譯文。翻譯內容本身是正確的。",
      en: "The model did not return the inline link or bold markers intact for some paragraphs, so plain-text translations were used instead. The translation itself is correct."
    },
    // ── 批次編號協議（W2-3）────────────────────────────────
    //
    // 兩個都是 info：請求本身**成功了**，譯文也是對的。它們記的是
    // 「模型有多聽話」，給的是換模型時的依據，不是要使用者去做什麼。
    // 也因此記錄時刻意不帶 provider——帶了會被成功率統計算進分母，
    // 把「成功但協議有偏差」講成「多打了一次引擎」。
    BATCH_ID_REORDER: {
      severity: SEVERITY.INFO,
      "zh-Hant": "模型回傳的段落順序與送出的順序不同，已依編號自動排回正確位置。譯文沒有接錯段落。",
      en: "The model returned the items in a different order; they were put back in place using the id markers. No translation was attached to the wrong item."
    },
    BATCH_ID_FALLBACK: {
      severity: SEVERITY.INFO,
      "zh-Hant": "模型沒有依編號協議回覆，這一批改用陣列順序對位（舊模型相容模式）。翻譯可用，但這一批偵測不到順序錯位。",
      en: "The model did not follow the id protocol, so this batch was matched by array order instead (legacy compatibility mode). The translation works, but misalignment cannot be detected for this batch."
    },

    // 劃詞詞典模式的降級（W3-3）。與 RICHTEXT_FALLBACK 同一種性質：
    // **設計中的降級，不是故障**。模型沒有照詞典 schema 回話（解析不出來，
    // 或回了沒有任何釋義的空殼）時，那個字改用一般翻譯顯示——使用者看得懂
    // 那個字，只是少了音標與義項。所以嚴重度是 info，使用者不必做任何事；
    // 診斷頁看得到它出現的頻率，換模型時才有依據。
    DICT_FALLBACK: {
      severity: SEVERITY.INFO,
      "zh-Hant": "模型沒有回出可用的詞典資料，這個字已改用一般翻譯顯示。翻譯內容本身是正確的。",
      en: "The model did not return usable dictionary data, so this word is shown with a plain translation instead. The translation itself is correct."
    },

    PAGE_SCRIPT_NOT_READY: {
      severity: SEVERITY.ERROR,
      "zh-Hant": "這個分頁還沒載入翻譯功能。請重新整理網頁後再試一次。",
      en: "This tab has not loaded the translation script yet. Reload the page and try again."
    },
    TAB_NOT_FOUND: {
      severity: SEVERITY.ERROR,
      "zh-Hant": "找不到目前的分頁。請切回要翻譯的網頁再按一次。",
      en: "The current tab could not be found. Switch back to the page you want translated and try again."
    },

    // ── 快取與儲存 ─────────────────────────────────────────
    CACHE_QUOTA_EXCEEDED: {
      severity: SEVERITY.WARNING,
      "zh-Hant": "瀏覽器的儲存空間滿了，這次的譯文沒有存進快取。翻譯本身不受影響，下次會重翻。",
      en: "Browser storage is full, so this translation was not cached. Translation still works; it will be redone next time."
    },
    CACHE_WRITE_FAILED: {
      severity: SEVERITY.WARNING,
      "zh-Hant": "寫入快取失敗，這次的譯文沒有存下來。翻譯本身不受影響。",
      en: "Writing to the cache failed, so this translation was not saved. Translation itself is unaffected."
    },
    CACHE_READ_FAILED: {
      severity: SEVERITY.WARNING,
      "zh-Hant": "讀取快取失敗，這一頁會重新翻譯一次。",
      en: "Reading the cache failed, so this page is translated again from scratch."
    },

    // ── 附屬功能 ───────────────────────────────────────────
    CATALOG_FETCH_FAILED: {
      severity: SEVERITY.WARNING,
      "zh-Hant": "拿不到本機模型清單。請確認 Bridge 服務已啟動，再按一次「更新免費模型清單」。",
      en: "The local model catalog could not be fetched. Make sure the Bridge service is running, then refresh the free model list."
    },
    GLOSSARY_CORE_MISSING: {
      severity: SEVERITY.ERROR,
      "zh-Hant": "術語分析模組沒有載入。請重新載入擴充功能後再試。",
      en: "The glossary module did not load. Reload the extension and try again."
    },
    GLOSSARY_SAMPLE_TOO_FEW: {
      severity: SEVERITY.INFO,
      "zh-Hant": "字幕樣本太少，這次略過術語分析。等字幕多一點再試。",
      en: "Too few subtitle samples, so glossary analysis was skipped. Try again once more subtitles have loaded."
    },
    STUDY_PROFILE_INCOMPLETE: {
      severity: SEVERITY.ERROR,
      "zh-Hant": "程度資料不完整。請回到工具列重新選一次程度。",
      en: "The level profile is incomplete. Pick your level again from the toolbar."
    },
    STUDY_NO_EPISODE: {
      severity: SEVERITY.ERROR,
      "zh-Hant": "沒有字幕資料。請回播放頁重新抓一次字幕。",
      en: "There is no subtitle data. Go back to the player page and capture the subtitles again."
    },
    STUDY_ALL_BATCHES_FAILED: {
      severity: SEVERITY.ERROR,
      "zh-Hant": "每一批教材都失敗了。請確認翻譯引擎可用，或改用 Gemini API。",
      en: "Every study batch failed. Make sure an engine is working, or switch to the Gemini API."
    },
    SUBTITLE_EXPORT_EMPTY: {
      severity: SEVERITY.INFO,
      "zh-Hant": "這個格式沒有可匯出的字幕。請先讓字幕翻譯跑一段時間再匯出。",
      en: "There are no subtitles to export in this format. Let the subtitle translation run for a while first."
    }
  });

  const CODE_LIST = Object.freeze(Object.keys(DIAGNOSTIC_CODES));
  const LANGUAGES = Object.freeze(["zh-Hant", "en"]);

  function isKnownCode(code) {
    return typeof code === "string" && Object.prototype.hasOwnProperty.call(DIAGNOSTIC_CODES, code);
  }

  function severityOf(code) {
    return DIAGNOSTIC_CODES[code]?.severity ?? SEVERITY.ERROR;
  }

  function severityLabel(severity, language = "zh-Hant") {
    return SEVERITY_LABELS[severity]?.[language] ?? SEVERITY_LABELS[severity]?.["zh-Hant"] ?? severity;
  }

  // 沒登記的 code 不編故事：原樣回傳那個 code，畫面上看得出「這裡有東西沒登記」，
  // 而不是被一句通用訊息蓋掉（見 token-saving §3：省略要留痕）。
  function messageFor(code, language = "zh-Hant") {
    const entry = DIAGNOSTIC_CODES[code];
    if (!entry) return String(code ?? "");
    return entry[language] ?? entry["zh-Hant"];
  }

  // 錯誤物件 → 給使用者看的那一句。原始訊息只在「這個 code 沒登記」時才用，
  // 因為登記過的訊息一定比引擎的原話更清楚該做什麼。
  function describeError(error, language = "zh-Hant") {
    const code = String(error?.code ?? "");
    if (isKnownCode(code)) return messageFor(code, language);
    return String(error?.message ?? error ?? "");
  }

  function diagnosticError(message, code, extra = {}) {
    const error = new Error(message);
    if (code) error.code = code;
    Object.assign(error, extra);
    return error;
  }

  // ================================================================ 事件環形緩衝
  //
  // 隱私紅線：**頁面內容一個字都不能進來**。
  // 所以這裡不是「把傳進來的物件存起來、順便刪掉幾個欄位」，而是反過來——
  // 只從輸入抄出下面這張白名單的欄位，其餘一律不看。黑名單遲早會漏（多一個
  // 欄位就多一個洞），白名單不會。錯誤訊息本身也不存：訊息可能夾帶模型回話
  // 或伺服器回應，而畫面上要顯示的那一句本來就查得到（messageFor）。
  const EVENT_LIMIT = 50;

  function toPositiveInt(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    return Math.round(number);
  }

  function toShortId(value) {
    // provider id 是四個固定字串之一；截斷只是防呆，避免有人把整包東西塞進來。
    return String(value ?? "").replace(/[^\w.-]/g, "").slice(0, 32);
  }

  function sanitizeEvent(input, now) {
    const code = String(input?.code ?? "");
    return {
      at: toPositiveInt(input?.at) || now,
      code: isKnownCode(code) ? code : (code ? `UNREGISTERED:${toShortId(code)}` : "UNKNOWN"),
      severity: isKnownCode(code) ? severityOf(code) : SEVERITY.ERROR,
      provider: toShortId(input?.provider),
      batchSize: toPositiveInt(input?.batchSize),
      durationMs: toPositiveInt(input?.durationMs),
      ok: input?.ok === true,
      // 「這次是不是轉移過去的」——只有引擎 id，沒有任何訊息。
      fallbackFrom: toShortId(input?.fallbackFrom),
      fallbackTo: toShortId(input?.fallbackTo)
    };
  }

  function createEventBuffer(options = {}) {
    const limit = toPositiveInt(options.limit) || EVENT_LIMIT;
    const clock = typeof options.now === "function" ? options.now : () => Date.now();
    let events = [];

    return {
      get limit() { return limit; },
      record(input) {
        const event = sanitizeEvent(input, clock());
        events.push(event);
        // 只留最近 limit 筆。用陣列而不是真的環形索引：50 筆的 shift 成本
        // 可以忽略，而「events 就是時間順序」讓每一個讀取端都不必再排序。
        if (events.length > limit) events = events.slice(events.length - limit);
        return event;
      },
      // 餵一整批（從 storage 還原用）。同樣走 sanitizeEvent，還原進來的舊資料
      // 也不會夾帶新欄位。
      restore(list) {
        if (!Array.isArray(list)) return;
        for (const item of list) this.record(item);
      },
      list() { return events.slice(); },
      // 最近的排前面，畫面上第一列就是剛剛發生的事。
      recent(count = limit) {
        const n = toPositiveInt(count) || limit;
        return events.slice(Math.max(0, events.length - n)).reverse();
      },
      size() { return events.length; },
      clear() { events = []; }
    };
  }

  // ================================================================ 統計計數器（W4-2）
  //
  // 為什麼不直接從事件緩衝算：緩衝只留最近 50 筆（EVENT_LIMIT），拿它算
  // 「快取命中率」會得到一個隨著使用時間漂移的假數字——翻一頁就把前面
  // 全部沖掉。所以比率類指標一律走**單調累加的計數器**，事件緩衝只負責
  // 「最近發生什麼」。
  //
  // 隱私紅線與事件緩衝同一條，而且更嚴：值只能是非負整數，鍵只能是
  // 下面這張白名單。任何字串（頁面內容、模型回話、URL）在型別上就進不來。
  const METRIC_KEYS = Object.freeze([
    // 快取
    "cacheHits",
    "cacheMisses",
    // provider 轉移（換引擎）次數
    "providerHandoffs",
    // 批次：batches 是送出的批數，batchSplits 是其中被拆開重送的次數
    "batches",
    "batchSplits",
    // 降級
    "richTextFallbacks",
    "dictFallbacks",
    // 字幕語意合併：cues 是原始 cue 數，groups 是合併後的組數
    "subtitleCues",
    "subtitleGroups"
  ]);

  // 有些指標本來就已經有事件了，不必在模組裡另開一個回報點——
  // 記錄事件的同一個入口順手把計數器加上去（唯一的計數點，不會漏也不會重複）。
  const CODE_METRIC_KEYS = Object.freeze({
    RICHTEXT_FALLBACK: "richTextFallbacks",
    DICT_FALLBACK: "dictFallbacks"
  });

  function emptyMetrics() {
    const zeroes = {};
    for (const key of METRIC_KEYS) zeroes[key] = 0;
    return zeroes;
  }

  // 白名單制（跟 sanitizeEvent 同一個理由）：只抄得出白名單裡的鍵，
  // 而且一律轉成非負整數。
  function sanitizeMetrics(input) {
    const output = emptyMetrics();
    for (const key of METRIC_KEYS) output[key] = toPositiveInt(input?.[key]);
    return output;
  }

  function createMetricsCounters(initial) {
    let totals = sanitizeMetrics(initial);
    return {
      get keys() { return METRIC_KEYS; },
      bump(key, amount = 1) {
        if (!METRIC_KEYS.includes(key)) return 0;
        const step = toPositiveInt(amount);
        if (!step) return totals[key];
        totals[key] += step;
        return totals[key];
      },
      // 一次加一組（內容腳本把一頁的命中／未命中數一起送過來，省訊息數）。
      add(delta) {
        const clean = sanitizeMetrics(delta);
        for (const key of METRIC_KEYS) totals[key] += clean[key];
        return this.snapshot();
      },
      // 從 storage 還原：整組取代，同樣走白名單。
      restore(stored) {
        totals = sanitizeMetrics(stored);
        return this.snapshot();
      },
      snapshot() { return { ...totals }; },
      clear() { totals = emptyMetrics(); }
    };
  }

  function ratio(numerator, denominator) {
    const bottom = Number(denominator) || 0;
    if (bottom <= 0) return null;
    return (Number(numerator) || 0) / bottom;
  }

  // 事件緩衝裡看得到的「轉移」次數。計數器是主資料（不會被 50 筆上限沖掉），
  // 這一份只當交叉檢查用：兩邊差很多通常代表計數器是這個版本才開始記的。
  function countEventHandoffs(events) {
    let count = 0;
    for (const event of Array.isArray(events) ? events : []) {
      if (event?.fallbackFrom && event?.fallbackTo) count += 1;
    }
    return count;
  }

  // 六個指標。全部是純數字，rate 在分母為 0 時是 null（不是 0）——
  // 「還沒有資料」和「命中率 0%」是兩件事，畫面上要分得出來。
  function computeMetrics(snapshot, events) {
    const totals = sanitizeMetrics(snapshot);
    const cacheTotal = totals.cacheHits + totals.cacheMisses;
    return {
      cacheHitRate: {
        hits: totals.cacheHits,
        misses: totals.cacheMisses,
        total: cacheTotal,
        rate: ratio(totals.cacheHits, cacheTotal)
      },
      providerHandoffs: {
        count: totals.providerHandoffs,
        recentFromEvents: countEventHandoffs(events)
      },
      batchSplitRate: {
        batches: totals.batches,
        splits: totals.batchSplits,
        rate: ratio(totals.batchSplits, totals.batches)
      },
      richTextFallbacks: { count: totals.richTextFallbacks },
      dictFallbacks: { count: totals.dictFallbacks },
      subtitleMergeRate: {
        cues: totals.subtitleCues,
        groups: totals.subtitleGroups,
        // 合併後組數 / 原 cue 數。越小代表併得越多（0.6 ＝ 10 句併成 6 組）。
        rate: ratio(totals.subtitleGroups, totals.subtitleCues)
      }
    };
  }

  // 一鍵匯出的 JSON。刻意**只**放統計值與環境欄位：
  // 沒有事件清單（事件本身雖然也過濾過，但這個按鈕的承諾是「只有數字」）、
  // 沒有任何頁面內容、沒有 URL、沒有標題。
  function buildMetricsJson(snapshot, events, meta = {}) {
    return {
      kind: "immersefree-metrics",
      version: String(meta.version ?? ""),
      generatedAt: new Date(toPositiveInt(meta.at) || Date.now()).toISOString(),
      eventCount: Array.isArray(events) ? events.length : 0,
      counters: sanitizeMetrics(snapshot),
      metrics: computeMetrics(snapshot, events)
    };
  }

  // 各 provider 的最近成功率。分母是「這個引擎被叫到幾次」，
  // 分子是成功幾次；沒有被叫到的引擎不列出來（列一個 0/0 只會誤導）。
  function summarizeProviders(events) {
    const rows = new Map();
    for (const event of Array.isArray(events) ? events : []) {
      const id = event?.provider;
      if (!id) continue;
      const row = rows.get(id) ?? { provider: id, attempts: 0, ok: 0, failed: 0, lastCode: "", lastAt: 0 };
      row.attempts += 1;
      if (event.ok) row.ok += 1; else row.failed += 1;
      if ((event.at ?? 0) >= row.lastAt) {
        row.lastAt = event.at ?? 0;
        row.lastCode = event.code ?? "";
      }
      rows.set(id, row);
    }
    return [...rows.values()]
      .map((row) => ({ ...row, successRate: row.attempts ? row.ok / row.attempts : 0 }))
      .sort((a, b) => b.attempts - a.attempts);
  }

  function formatTime(at) {
    const date = new Date(toPositiveInt(at));
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function formatPercent(value) {
    return `${Math.round((Number(value) || 0) * 100)}%`;
  }

  // 一鍵複製用的純文字報告。刻意不是 JSON：使用者要把它貼進 issue 或訊息裡，
  // 而不是餵給程式。同樣只吐事件表裡有的欄位，所以不可能夾帶頁面內容。
  function buildDiagnosticsReport(events, meta = {}) {
    const language = meta.language === "en" ? "en" : "zh-Hant";
    const list = Array.isArray(events) ? events : [];
    const zh = language === "zh-Hant";
    const lines = [];
    lines.push(zh ? "ImmerseFree 診斷報告" : "ImmerseFree diagnostics report");
    lines.push(`${zh ? "產生時間" : "Generated"}: ${new Date(toPositiveInt(meta.at) || Date.now()).toISOString()}`);
    if (meta.version) lines.push(`${zh ? "版本" : "Version"}: ${meta.version}`);
    if (meta.provider) lines.push(`${zh ? "目前引擎" : "Current engine"}: ${meta.provider}`);
    if (meta.chain) lines.push(`${zh ? "轉移鏈" : "Fallback chain"}: ${meta.chain}`);
    lines.push("");
    lines.push(zh ? `各引擎成功率（最近 ${list.length} 筆事件）` : `Success rate by engine (last ${list.length} events)`);
    const summary = summarizeProviders(list);
    if (!summary.length) {
      lines.push(zh ? "（尚無紀錄）" : "(no records)");
    } else {
      for (const row of summary) {
        lines.push(`- ${row.provider}: ${formatPercent(row.successRate)} (${row.ok}/${row.attempts}) ${zh ? "最後" : "last"}=${row.lastCode}`);
      }
    }
    lines.push("");
    lines.push(zh ? "事件（新到舊）" : "Events (newest first)");
    if (!list.length) {
      lines.push(zh ? "（尚無紀錄）" : "(no records)");
    } else {
      for (const event of list.slice().reverse()) {
        const parts = [
          formatTime(event.at),
          severityLabel(event.severity ?? severityOf(event.code), language),
          event.code,
          event.provider || "-",
          `${zh ? "批" : "batch"}=${event.batchSize || 0}`,
          `${event.durationMs || 0}ms`
        ];
        if (event.fallbackFrom && event.fallbackTo) {
          parts.push(`${event.fallbackFrom}->${event.fallbackTo}`);
        }
        lines.push(`- ${parts.join(" | ")}`);
      }
    }
    return lines.join("\n");
  }

  // ---------------------------------------------------------------- i18n 註冊
  //
  // 註冊表是唯一的來源，i18n-core 只是拿到「zh-Hant 原句 → en 譯句」這張表。
  // 兩邊各維護一份中英對照的話，改了一句忘了另一句就會出現半中半英的畫面。
  function i18nPairs() {
    const pairs = {};
    for (const code of CODE_LIST) {
      const entry = DIAGNOSTIC_CODES[code];
      pairs[entry["zh-Hant"]] = entry.en;
    }
    for (const severity of SEVERITY_ORDER) {
      pairs[SEVERITY_LABELS[severity]["zh-Hant"]] = SEVERITY_LABELS[severity].en;
    }
    return pairs;
  }

  function registerIntoI18n(core = global.ImmerseFreeI18nCore) {
    if (typeof core?.registerMessages !== "function") return false;
    core.registerMessages("en", i18nPairs());
    return true;
  }

  registerIntoI18n();

  const diagnosticsCore = Object.freeze({
    SEVERITY,
    SEVERITY_ORDER,
    SEVERITY_LABELS,
    DIAGNOSTIC_CODES,
    CODE_LIST,
    LANGUAGES,
    EVENT_LIMIT,
    isKnownCode,
    severityOf,
    severityLabel,
    messageFor,
    describeError,
    diagnosticError,
    sanitizeEvent,
    createEventBuffer,
    METRIC_KEYS,
    CODE_METRIC_KEYS,
    emptyMetrics,
    sanitizeMetrics,
    createMetricsCounters,
    computeMetrics,
    buildMetricsJson,
    countEventHandoffs,
    summarizeProviders,
    buildDiagnosticsReport,
    formatTime,
    formatPercent,
    i18nPairs,
    registerIntoI18n
  });

  global.ImmerseFreeDiagnosticsCore = diagnosticsCore;
  if (typeof module !== "undefined" && module.exports) module.exports = diagnosticsCore;
})(globalThis);
