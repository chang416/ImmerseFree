(function initializePageTranslator(global) {
  const bridge = global.ImmerseFree;
  const language = global.ImmerseFreeLanguage;
  const MARKER = "data-immersefree-page-source";
  const TRANSLATION_CLASS = "immersefree-page-translation";
  const PROGRESS_CLASS = "immersefree-page-progress";
  const { createTranslationProgress } = global.ImmerseFreePageTranslationUI;
  // 浮動 UI 的字串在寫進畫面前查表，介面語言設成英文時這裡也要是英文。
  const t = (text) => bridge.t?.(text) ?? text;
  const pageCacheCore = global.ImmerseFreePageTranslationCache;
  const segmentation = global.ImmerseFreeSegmentationCore;
  // 網站規則庫（W3-2）。沒載到就整份退回「沒有站台規則」——規則是加分項，
  // 少一個模組不該讓整頁翻不了（跟 rich-text 同一個處理原則）。
  const siteRules = global.ImmerseFreeSiteRulesCore;
  // 行內富文本（W2-2）。沒載到就整份退回純文字路徑——舊分頁、或只載了部分
  // 腳本的情況下，寧可翻不出連結，也不要因為少一個模組就整頁翻不了。
  const richText = global.ImmerseFreeRichTextCore;
  // 批量常數的唯一來源（W2-3）。0.7.0 把 8 寫死在這裡、字幕層兩處與背景頁，
  // 改一處忘三處的結果是「網頁變快了、字幕沒有」，而且不會報錯。
  const batchCore = global.ImmerseFreeBatchCore;
  let running = false;
  let active = false;
  let restoreSuppressed = false;
  let restoreRunning = false;
  let restoreRequested = false;
  let restoreTimer;
  let observer;
  let cacheReadyPromise;
  let progressTracker = null;
  let lastProgress = idleProgress();
  let dismissTimer;
  // 淡出那 320ms 的計時器。跟 dismissTimer 分開記：一個管「完成後停留多久」，
  // 一個管「淡出跑完沒」，中途有新工作進來時兩個都要能各自取消。
  let fadeTimer;
  let scheduler = null;
  let settings = { targetLanguage: "zh-Hant" };
  const cacheStore = pageCacheCore?.createPageTranslationCacheStore
    ? pageCacheCore.createPageTranslationCacheStore(bridge.api, {
      maxEntries: 6000,
      maxBytes: 8 * 1024 * 1024
    })
    : createMemoryCacheStore();

  bridge.pageTranslator = {
    getProgress() {
      return progressTracker?.snapshot() ?? lastProgress;
    },
    // 匯出雙語 docx 用（W4-1）。以**畫面上真的插進去的譯文節點**為準，
    // 不是某個中間變數——使用者要帶走的就是他看到的那一份，而且重跑、
    // SPA 換頁、部分失敗之後也只有 DOM 是對的。
    collectPairs() {
      const pairs = [];
      for (const doc of reachableDocuments()) {
        for (const source of doc.querySelectorAll(`[${MARKER}]`)) {
          const next = source.nextElementSibling;
          if (!next || !String(next.className ?? "").split(/\s+/).includes(TRANSLATION_CLASS)) continue;
          const original = String(source.dataset?.immerseFreeSourceText ?? segmentText(source));
          const translation = String(next.textContent ?? "");
          if (!original.trim() || !translation.trim()) continue;
          pairs.push({ source: original, translation });
        }
      }
      return pairs;
    },
    async toggle(nextSettings = {}) {
      await ensureCacheReady();
      settings = { ...settings, ...nextSettings };
      applyDisplayState();
      const existing = document.querySelectorAll(`.${TRANSLATION_CLASS}`);
      const resuming = existing.length > 0 && lastProgress.state === "error";
      // Restored cache entries are visible before the user presses the button.
      // They should not be removed just because the user now wants to process
      // newly arrived SPA content; only a previously activated workspace is a
      // true toggle-off request.
      if (active && existing.length && !resuming) {
        active = false;
        restoreSuppressed = true;
        restoreRequested = false;
        // 長頁翻到一半按「還原」：已經排隊但還沒送出的段落必須整批丟掉，
        // 否則使用者看著譯文消失，幾秒後它們又一段一段長回來。
        cancelScheduler();
        clearTimeout(restoreTimer);
        existing.forEach((node) => node.remove());
        document.querySelectorAll(`[${MARKER}]`).forEach((node) => node.removeAttribute(MARKER));
        removeProgress();
        progressTracker = null;
        lastProgress = idleProgress();
        return { active: false, count: existing.length };
      }
      if (running) return { active: true, count: lastProgress.completed, message: lastProgress.message };
      active = true;
      restoreSuppressed = false;
      running = true;
      try {
        const { candidates, skipped } = collectCandidates();
        if (!candidates.length) {
          if (existing.length) {
            return {
              active: true,
              count: existing.length,
              message: t(`已還原快取翻譯，共 ${existing.length} 段，沒有新增內容`)
            };
          }
          if (skipped) {
            return {
              active: existing.length > 0,
              count: existing.length,
              message: t(`頁面上這 ${skipped} 段本來就是目標語言，沒有重複翻譯`)
            };
          }
          // 訊息改由錯誤碼註冊表提供：popup、診斷頁與這裡講的是同一句。
          throw Object.assign(new Error(t(globalThis.ImmerseFreeDiagnosticsCore?.messageFor("NO_CANDIDATES") ?? "目前頁面找不到可翻譯的文字段落")), { code: "NO_CANDIDATES" });
        }
        const { hits, missing } = await resolveCachedCandidates(candidates);
        progressTracker = createTranslationProgress(
          existing.length + candidates.length,
          { progressive: shouldDefer(missing) }
        );
        if (existing.length + hits.length) progressTracker.complete(existing.length + hits.length);
        updateProgress(progressTracker.snapshot());
        let translatedCount = existing.length + hits.length;
        const history = hits.map(({ item, entry }) => ({ source: item.text, translation: entry.translatedText }));
        translatedCount += await translatePending(missing, translatedCount, history);
        return { active: true, count: translatedCount };
      } catch (error) {
        // 失敗就把排程停掉。留著 observer 的話，使用者接下來每捲一次都會
        // 再撞一次同樣的錯，錯誤訊息一直重跳卻沒人知道為什麼。
        cancelScheduler();
        if (!progressTracker) progressTracker = createTranslationProgress(1);
        updateProgress(progressTracker.fail(t(globalThis.ImmerseFreeDiagnosticsCore?.describeError(error) ?? error.message)));
        throw error;
      } finally {
        running = false;
        flushRequestedRestore();
        // 收尾判斷要在 running 歸零之後才做，否則 pageTranslationSettled()
        // 永遠看到「還在跑」，膠囊就一輩子留在畫面上——這正是使用者回報的症狀。
        scheduleProgressDismiss();
      }
    }
  };

  // A page translator is initialized independently in every frame. The
  // observer belongs to the frame that owns the text, so SPA route changes and
  // same-origin reader iframes can both restore their own cached paragraphs.
  void ensureCacheReady().catch(() => {});

  async function ensureCacheReady() {
    if (!cacheReadyPromise) {
      cacheReadyPromise = (async () => {
        await cacheStore.ready();
        try {
          if (typeof bridge.sendMessage === "function") {
            const response = await bridge.sendMessage({ type: "IMMERSEFREE_GET_SETTINGS" });
            if (response?.settings) {
              settings = { ...settings, ...response.settings };
              bridge.setUiLanguage?.(settings.uiLanguage);
            }
          }
        } catch {
          // A content action can still use the local defaults if the service
          // worker is asleep or the extension context is being reloaded.
        }
        applyDisplayState();
        // 網站規則要在第一次收集候選之前就位（restoreCachedPage 立刻會收集）。
        // 排在 installObserver 前面，這樣 observer 第一次觸發時門檻已經是
        // 站台規則算出來的那一組，不會先用預設門檻收一輪再改。
        await loadSiteRules();
        installObserver();
        if (settings.pageTranslationEnabled !== false) await restoreCachedPage();
      })();
    }
    return cacheReadyPromise;
  }

  // ── 雙語顯示主題與顯示模式（W3-1）────────────────────────────
  //
  // 主題與模式都掛在 <html> 的 data 屬性上（data-imf-theme／data-imf-mode），
  // 樣式全部住在 content.css 的「根屬性 + 後代選擇器」規則裡。這樣換主題
  // 只寫一個屬性，已插入的幾百段譯文即時全部換裝，不必逐段補 class；
  // 「僅譯文」也一樣——原文節點是被 CSS display:none 藏起來，不是被移除，
  // 所以 DOM 節點數在切換前後完全不變，切回雙語就原樣回來。
  //
  // 每個框架的 page-translator 都對自己的文件掛屬性（內容腳本 all_frames），
  // 最上層再多掃一次 reachableDocuments：同源 iframe 的內容可能是最上層
  // 這份實例插的譯文，屬性得跟著到場，不能賭 iframe 自己那份腳本活著。
  function applyDisplayState() {
    for (const doc of reachableDocuments()) {
      const root = doc.documentElement;
      if (!root) continue;
      root.dataset.imfTheme = settings.translationTheme || "classic";
      root.dataset.imfMode = settings.displayMode === "translationOnly" ? "translationOnly" : "bilingual";
    }
  }

  // 設定被任何一邊改掉（popup 快切、選項頁、懸浮球送 UPDATE_SETTINGS）都會
  // 落到 chrome.storage.local，這裡聽 onChanged 統一反應——不用再在 popup、
  // 選項頁、懸浮球三處各送一次「設定變了」的訊息給每個分頁的每個框架。
  try {
    bridge.api?.storage?.onChanged?.addListener?.((changes, area) => {
      if (area !== "local") return;
      let touched = false;
      for (const key of ["translationTheme", "displayMode"]) {
        if (changes[key] && "newValue" in changes[key]) {
          settings[key] = changes[key].newValue;
          touched = true;
        }
      }
      if (touched) applyDisplayState();
      // 網站規則（W3-2）。選項頁存檔後不重新整理也要生效，否則使用者會以為
      // 規則沒存進去。只清快取不重掃：下一次收集候選自然會用新的門檻。
      let ruleTouched = false;
      for (const key of ["userSiteRules", "siteRulesEnabled"]) {
        if (changes[key] && "newValue" in changes[key]) {
          settings[key] = changes[key].newValue;
          ruleTouched = true;
        }
      }
      if (ruleTouched) {
        siteRuleCache = null;
        siteRuleCacheKey = undefined;
        segmentationOverridesCache = null;
      }
    });
  } catch {
    // 測試替身沒有 storage.onChanged 也不該讓整個翻譯器掛掉。
  }

  // 上一次看到的網址。SPA 換路由不會重載腳本，所以「網址變了」只能自己比。
  let lastSeenHref = global.location?.href ?? "";

  function installObserver() {
    if (observer || typeof global.MutationObserver !== "function" || !document.documentElement) return;
    observer = new global.MutationObserver(() => {
      // SPA 換路由（history.pushState）不會觸發任何載入事件，但一定會改 DOM，
      // 所以在這裡比網址。變了就把站台規則快取丟掉——完整網址形態的規則
      // （例如只針對 YouTube 首頁那條）依賴 path，不丟掉會把首頁的門檻
      // 帶進播放頁，而且完全不會報錯。
      const href = global.location?.href ?? "";
      const urlChanged = href !== lastSeenHref;
      if (urlChanged) {
        lastSeenHref = href;
        siteRuleCache = null;
        siteRuleCacheKey = undefined;
        segmentationOverridesCache = null;
      }
      if (restoreSuppressed) return;
      if (urlChanged && !translationBusy()) {
        // 站台規則的 urlChangeDelay：新頁面的 DOM 常常還在填，太早掃只會
        // 收到骨架屏。沒設規則就照原本的 180ms。
        scheduleRestore(urlChangeDelay(180));
        return;
      }
      if (translationBusy()) {
        // SPA 切頁可能發生在一個模型批次尚未回來時。不能把這次變動畫面
        // 當作「忙碌所以略過」，否則回到舊分頁時已完成的快取永遠不會套回。
        restoreRequested = true;
        return;
      }
      scheduleRestore();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function scheduleRestore(delay = 180) {
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
      restoreTimer = undefined;
      void restoreCachedPage().catch(() => {});
    }, delay);
  }

  // 排程器還在推批時也算「忙」。長頁的背景補翻期間 running 是 false，
  // 少了這個判斷，重掃會跟排程搶同一批節點：同一段被送兩次、譯文插兩份。
  function translationBusy() {
    return running || restoreRunning || Boolean(scheduler?.busy());
  }

  function flushRequestedRestore() {
    if (!restoreRequested || restoreSuppressed || translationBusy()) return;
    restoreRequested = false;
    scheduleRestore(0);
  }

  async function restoreCachedPage() {
    if (restoreSuppressed) return;
    if (translationBusy()) {
      restoreRequested = true;
      return;
    }
    restoreRunning = true;
    try {
      const { candidates } = collectCandidates();
      if (!candidates.length) return;
      const existingCount = document.querySelectorAll(`.${TRANSLATION_CLASS}`).length;
      const { hits, missing } = await resolveCachedCandidates(candidates);
      if (!missing.length || !active || lastProgress.state === "error") return;
      progressTracker = createTranslationProgress(
        existingCount + hits.length + missing.length,
        { progressive: shouldDefer(missing) }
      );
      if (existingCount + hits.length) progressTracker.complete(existingCount + hits.length);
      updateProgress(progressTracker.snapshot());
      const history = hits.map(({ item, entry }) => ({ source: item.text, translation: entry.translatedText }));
      await translatePending(missing, existingCount + hits.length, history);
    } catch (error) {
      cancelScheduler();
      if (!progressTracker) progressTracker = createTranslationProgress(1);
      updateProgress(progressTracker.fail(t(globalThis.ImmerseFreeDiagnosticsCore?.describeError(error) ?? error.message)));
    } finally {
      restoreRunning = false;
      flushRequestedRestore();
      // 同 toggle()：旗標歸零後才判斷收不收膠囊。
      scheduleProgressDismiss();
    }
  }

  async function resolveCachedCandidates(candidates) {
    const keys = candidates.map((item) => pageCacheCore?.buildPageTranslationKey
      ? pageCacheCore.buildPageTranslationKey(item.text, settings)
      : item.text);
    const entries = await cacheStore.getMany(keys);
    const hits = [];
    const missing = [];
    candidates.forEach((item, index) => {
      const key = keys[index];
      const entry = entries.get(key);
      if (!entry?.translatedText) {
        missing.push({ ...item, cacheKey: key });
        return;
      }
      injectTranslation(item, entry.translatedText);
      hits.push({ item, entry });
    });
    // 快取命中率的計數點（W4-2）。一頁一則訊息，不是一段一則——
    // 一頁上千段的話，逐段回報會讓 service worker 收到上千個訊息。
    if (hits.length || missing.length) {
      reportMetrics({ cacheHits: hits.length, cacheMisses: missing.length });
    }
    return { hits, missing };
  }

  // 切批規則（W2-3 起由 core/batch-core.js 提供，這裡不再有任何裸數字）。
  // 「一次全翻」與「視窗內優先」兩條路共用同一組規則，背景頁也用同一支
  // planBatches——三邊各切一次卻切法不同的話，請求數會是預期的兩倍，
  // 而每一邊單獨看都「沒有錯」。
  const BATCH = batchCore.batchProfile("page");

  // 短頁一次全部翻完，體感上跟排程沒差，還少一層可能出錯的東西；
  // 長頁才值得為了「先看到第一屏」多繞這一圈。門檻取整頁候選字元數。
  const IMMEDIATE_TEXT_LIMIT = 5000;
  // 視窗下緣再往下兩屏先翻好，使用者捲下去時該屏已經是譯文。
  const PREFETCH_SCREENS = 2;
  // 上緣也留半屏：錨點跳轉、瀏覽器還原捲動位置、或使用者往回捲，
  // 都會讓上方段落重新進入視野，那時候要能補翻而不是永遠空著。
  const LOOKBACK_SCREENS = 0.5;

  async function translatePending(candidates, translatedCount, history) {
    if (!shouldDefer(candidates)) return translateAll(candidates, history);
    return startScheduledTranslation(candidates, translatedCount, history);
  }

  function shouldDefer(candidates) {
    let characters = 0;
    for (const item of candidates ?? []) characters += item.text.length;
    return characters >= IMMEDIATE_TEXT_LIMIT;
  }

  // 原本的路徑：照收集順序切批、一批接一批跑完。短頁走這條，行為逐字不變。
  async function translateAll(candidates, history) {
    let completed = 0;
    for (const queuedBatch of batchCore.planBatches(candidates, BATCH)) {
      const { completed: done, stop } = await translateBatch(queuedBatch, history);
      completed += done;
      if (stop) break;
    }
    return completed;
  }

  async function translateBatch(queuedBatch, history) {
    // 使用者中途按「還原」時 active 會被關掉。已經在路上的回應擋不下來，
    // 但不能再寫回畫面，否則譯文會在還原後又自己冒出來。
    if (!active) return { completed: 0, stop: true };
    // 逐段分三類，不能只用一個 filter：
    //   stale ── 節點已經不在文件裡，或文字被 SPA 換掉了。丟掉並要求重掃。
    //   done  ── 另一條翻譯路徑已經把譯文插好了。不重送也不重插，但要算進
    //            進度，否則分子永遠差這幾段，進度膠囊會賴在畫面上不走。
    //   batch ── 真的要送給模型的那些。
    //
    // 為什麼會有「另一條路徑」（這是重複譯文的真正成因，實測 30 段長頁被插成
    // 49 個節點）：長頁快速捲動時，restoreCachedPage() 會在排程器剛抽乾隊列的
    // 那一瞬間進來（那時 scheduler.busy() 剛好是 false），收到的剩餘候選若總
    // 字數低於 IMMEDIATE_TEXT_LIMIT 就走 translateAll——而 translateAll **不會**
    // cancelScheduler()。於是舊排程器繼續活著，手上握著同一批元素的**另一份**
    // item 物件；排程器的 queued 集合是以 item 物件為鍵去重的，兩份物件不同，
    // 完全擋不住。兩條路徑各自插一次，同一段就有兩個譯文節點。
    const batch = [];
    let stale = 0;
    let done = 0;
    for (const item of queuedBatch) {
      if (!candidateStillCurrent(item)) {
        stale += 1;
        continue;
      }
      if (hasTranslationFor(item.element)) {
        done += 1;
        continue;
      }
      batch.push(item);
    }
    // The old section has been unmounted. Stop spending provider calls on
    // its stale DOM references; the queued restore will continue from the
    // section that is actually visible now.
    if (stale) restoreRequested = true;
    if (!batch.length) {
      if (done && progressTracker) updateProgress(progressTracker.complete(done));
      // 整批都只是「別人已經翻好了」的話，沒有任何東西過時，隊列裡剩下的
      // 段落還要繼續推——這時候 stop 要是 false，否則下半頁會停在原文。
      return { completed: done, stop: stale > 0 };
    }
    const translations = await bridge.translate(
      batch.map((item) => item.text),
      {
        mode: "page",
        title: document.title,
        previous: history.slice(-4)
      }
    );
    if (!Array.isArray(translations) || translations.length !== batch.length) {
      // 帶上 code，但訊息保留實際段數（拆批要看的是這兩個數字，註冊表寫不進去）。
      throw Object.assign(new Error(t(`模型回傳 ${translations?.length ?? 0} 段翻譯，應為 ${batch.length} 段`)), { code: "FORMAT_MISMATCH" });
    }
    const cacheEntries = [];
    batch.forEach((item, index) => {
      const translation = cleanText(translations[index]);
      if (!translation) throw Object.assign(new Error(t("模型回傳空白翻譯")), { code: "EMPTY_TRANSLATION" });
      history.push({ source: item.text, translation });
      cacheEntries.push([
        item.cacheKey,
        pageCacheCore?.createPageTranslationEntry
          ? pageCacheCore.createPageTranslationEntry(item.text, translation, settings)
          : { translatedText: translation }
        ]);
    });
    // Persist the provider result before touching the DOM. If the user
    // switches sections in this tiny window, the completed translation is
    // still remembered and can be restored when they return.
    await cacheStore.putMany(cacheEntries);
    if (!active) return { completed: 0, stop: true };
    batch.forEach((item, index) => {
      // 等模型回來的這段時間裡，這一段可能被 SPA 換掉，也可能被另一條翻譯
      // 路徑搶先插好了。兩種情況都不該再插一個節點進去。
      if (!candidateStillCurrent(item)) {
        restoreRequested = true;
        return;
      }
      if (hasTranslationFor(item.element)) return;
      injectTranslation(item, cleanText(translations[index]));
    });
    // done 是送出前就跳過的那些；batch.length 已經涵蓋這一批送出去的全部
    // （含回來時才發現不用插的），兩者不重疊。
    if (progressTracker) updateProgress(progressTracker.complete(batch.length + done));
    return { completed: batch.length + done, stop: false };
  }

  function cancelScheduler() {
    scheduler?.cancel();
    scheduler = null;
  }

  // 長頁路徑：先把視窗內與預取範圍內的段落排進隊列跑掉，其餘交給
  // IntersectionObserver，等它們接近視野再入隊。toggle() 只等第一輪抽乾，
  // 使用者按下按鈕後很快就拿得到回應，剩下的在背景邊捲邊補。
  async function startScheduledTranslation(candidates, translatedCount, history) {
    cancelScheduler();
    const current = createScheduler(candidates, translatedCount, history);
    scheduler = current;
    return current.start();
  }

  function createScheduler(candidates, baseCount, history) {
    const order = new Map();
    candidates.forEach((item, index) => order.set(item.element, { item, index }));
    const queued = new Set();
    const queue = [];
    const observers = [];
    let cancelled = false;
    let completed = 0;
    let pumpPromise = null;

    function cancel() {
      cancelled = true;
      queue.length = 0;
      for (const observer of observers) observer.disconnect();
      observers.length = 0;
    }

    function enqueue(items) {
      if (cancelled) return;
      let added = 0;
      for (const item of items) {
        if (queued.has(item)) continue;
        queued.add(item);
        queue.push(item);
        added += 1;
      }
      if (!added) return;
      if (progressTracker) updateProgress(progressTracker.reveal(baseCount + queued.size));
      void pump();
    }

    function pump() {
      if (!pumpPromise) {
        pumpPromise = drain().finally(() => {
          pumpPromise = null;
          // 推批期間累積的 SPA 變動，等這一輪結束才處理，避免重掃跟排程
          // 同時對同一批節點動手（那會送出重複請求，還會插進兩份譯文）。
          if (!cancelled) flushRequestedRestore();
        });
      }
      return pumpPromise;
    }

    async function drain() {
      while (queue.length && !cancelled) {
        const batch = takeBatch();
        const { completed: done, stop } = await translateBatch(batch, history);
        completed += done;
        // 這批的節點全部過時（SPA 換頁）。停在這裡，讓重掃流程從現在畫面上
        // 真正存在的段落重新開始，隊列裡剩下的等下一次入隊再推。
        if (stop) break;
      }
    }

    // 「還有東西要翻」＝隊列非空或正在等模型回來。重掃流程要看這個旗標，
    // 不能在推批中途另起一套翻譯。
    function busy() {
      return Boolean(queue.length) || pumpPromise !== null;
    }

    // 隊列是邊翻邊長的（捲動會補進新候選），所以不能一次把整個隊列切好，
    // 只能每次取「下一批」。取法必須與 planBatches 一致，否則同一個頁面
    // 走「一次全翻」與走「視窗內優先」會切出不同的批次。
    function takeBatch() {
      // 切批是由左往右的貪婪法，所以第一批只跟前 maxItems 項有關；
      // 拿整條隊列去切等於每取一批就掃一次三千段。
      const head = batchCore.planBatches(queue.slice(0, BATCH.maxItems), BATCH)[0] ?? [];
      return queue.splice(0, head.length);
    }

    function withinPrefetchRange(element) {
      const view = element.ownerDocument?.defaultView ?? global;
      const height = view.innerHeight || 0;
      // 量不到視窗高度（背景分頁、測試替身）就當作看得到，寧可多翻不要漏翻。
      if (!height) return true;
      const rect = element.getBoundingClientRect();
      return rect.bottom > -height * LOOKBACK_SCREENS
        && rect.top < height * (1 + PREFETCH_SCREENS);
    }

    // 首屏這批用 getBoundingClientRect 同步算，不等 IntersectionObserver 的
    // 第一次回呼——那是排進非同步佇列的，白白多一個 frame 才發得出請求。
    function priorityItems() {
      return candidates.filter((item) => withinPrefetchRange(item.element));
    }

    function handleEntries(entries, observer) {
      const arrived = [];
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const record = order.get(entry.target);
        if (record) arrived.push(record);
        // 進過視野就不用再看它了，剩下的捲動不必再回呼一次。
        observer.unobserve(entry.target);
      }
      // 依原本的收集順序入隊，翻譯的前後文才跟閱讀順序一致。
      arrived.sort((a, b) => a.index - b.index);
      enqueue(arrived.map((record) => record.item));
      // 背景補翻也要更新進度條，並在補完後讓它自己消失。
      if (arrived.length) {
        void pump()
          .then(() => {
            if (!cancelled) scheduleProgressDismiss();
          })
          .catch((error) => {
            if (cancelled) return;
            if (!progressTracker) progressTracker = createTranslationProgress(1);
            updateProgress(progressTracker.fail(t(globalThis.ImmerseFreeDiagnosticsCore?.describeError(error) ?? error.message)));
          });
      }
    }

    // 候選可能散在多個同源文件（正文放在 iframe 的站台）。
    // IntersectionObserver 的隱含 root 是建立它的那個文件的視窗，
    // 所以一份文件建一個，不能拿最上層那個去觀察 iframe 裡的節點。
    function observeAll() {
      const groups = new Map();
      for (const item of candidates) {
        if (queued.has(item)) continue;
        const doc = item.element.ownerDocument ?? document;
        if (!groups.has(doc)) groups.set(doc, []);
        groups.get(doc).push(item);
      }
      for (const [doc, items] of groups) {
        const view = doc.defaultView ?? global;
        if (typeof view.IntersectionObserver !== "function") {
          // 這個文件沒有 IntersectionObserver，退回一次全部入隊：
          // 慢一點沒關係，漏翻才是壞掉。
          enqueue(items);
          continue;
        }
        const observer = new view.IntersectionObserver(handleEntries, {
          rootMargin: `${LOOKBACK_SCREENS * 100}% 0px ${PREFETCH_SCREENS * 100}% 0px`
        });
        for (const item of items) observer.observe(item.element);
        observers.push(observer);
      }
    }

    async function start() {
      enqueue(priorityItems());
      observeAll();
      await (pumpPromise ?? Promise.resolve());
      return completed;
    }

    return { start, cancel, busy };
  }

  function candidateStillCurrent(item) {
    const element = item?.element;
    if (!element || element.isConnected === false) return false;
    // 比對的是含佔位符的那一份（item.text 存的就是它）。拿純文字去比的話，
    // 「文字沒變但連結被 SPA 換掉」會被判定成沒變，還原時就會把新連結的
    // 位置套上舊標記——畫面上是對的字、錯的網址。
    return segmentParts(element).text === item.text;
  }

  function createMemoryCacheStore() {
    const values = new Map();
    return {
      async ready() {},
      async getMany(keys) {
        return new Map((keys ?? []).flatMap((key) => values.has(key) ? [[key, values.get(key)]] : []));
      },
      async putMany(entries) {
        for (const [key, value] of entries ?? []) values.set(key, value);
      }
    };
  }

  function idleProgress() {
    return { state: "idle", completed: 0, total: 0, percent: 0, message: t("尚未開始") };
  }

  function updateProgress(snapshot) {
    lastProgress = snapshot;
    clearTimeout(dismissTimer);
    clearTimeout(fadeTimer);
    let root = document.querySelector(`.${PROGRESS_CLASS}`);
    // 淡出到一半又有新工作進來（捲到下一屏、SPA 補內容）：把收尾狀態拆掉，
    // 讓同一個膠囊原地亮回來，不要閃一下再冒出第二個。
    if (root) delete root.dataset.dismissing;
    if (!root) {
      root = document.createElement("section");
      root.className = PROGRESS_CLASS;
      root.setAttribute("data-immersefree-extension-root", "");
      root.setAttribute("role", "status");
      root.setAttribute("aria-live", "polite");
      root.innerHTML = '<div><strong></strong><span></span></div><progress></progress>';
      document.documentElement.append(root);
    }
    root.dataset.state = snapshot.state;
    root.querySelector("strong").textContent = snapshot.state === "error" ? t("翻譯未完成") : t("網頁翻譯");
    root.querySelector("span").textContent = snapshot.message;
    const meter = root.querySelector("progress");
    // 漸進模式的分母是「已進入視野的段數」（snapshot.scope），跟訊息同一套。
    // 拿整頁段數當 max 的話，條子永遠貼在最左邊，看起來像沒在動。
    const scope = snapshot.scope ?? snapshot.total;
    meter.max = Math.max(1, scope);
    meter.value = scope ? snapshot.completed : 0;
  }

  // 完成狀態停留多久才開始淡出，以及淡出本身多久。兩段加起來 1.92 秒：
  // 使用者來得及看見「翻譯完成，共 N 段」，又不會覺得它賴著不走。
  // 淡出時間必須跟 content.css 的 transition 對齊，改一邊要改兩邊。
  const PROGRESS_HOLD_MS = 1600;
  const PROGRESS_FADE_MS = 320;

  // 「翻完了」＝整頁段落都翻完，而且排程器手上沒有還沒推的批次。
  //
  // 漸進渲染（W1-1）下，可見範圍翻完時 completed 只走到那幾段，總數仍是整頁
  // 段數，所以 snapshot.state 還是 running——這正是我們要的判準：使用者還沒
  // 捲下去、下半頁一段都還沒入隊時，進度條**不該**消失，否則他捲下去看到
  // 譯文一段段冒出來卻沒有任何進度指示。
  function pageTranslationSettled() {
    if (lastProgress.state !== "complete") return false;
    // 隊列裡還有東西、或正在等模型回覆，都不算完成。
    if (scheduler?.busy()) return false;
    return !running && !restoreRunning;
  }

  function scheduleProgressDismiss() {
    clearTimeout(dismissTimer);
    clearTimeout(fadeTimer);
    if (!pageTranslationSettled()) return;
    dismissTimer = setTimeout(startProgressFadeOut, PROGRESS_HOLD_MS);
  }

  function startProgressFadeOut() {
    const root = document.querySelector(`.${PROGRESS_CLASS}`);
    if (!root) return;
    root.dataset.dismissing = "1";
    fadeTimer = setTimeout(removeProgress, PROGRESS_FADE_MS);
  }

  // 立刻拔掉，不走淡出。按「還原」時走這一支：使用者要的是「全部收掉」，
  // 這時候還讓膠囊留在畫面上淡 0.3 秒只會像沒反應。
  function removeProgress() {
    clearTimeout(dismissTimer);
    clearTimeout(fadeTimer);
    document.querySelector(`.${PROGRESS_CLASS}`)?.remove();
  }

  // ── 網站規則庫（W3-2）────────────────────────────────────────
  //
  // 內建 25 條規則的正本是 core/site-rules.json。content script 沒有
  // require，也不該把規則內聯進 JS（選項頁與測試都要讀同一份），所以走
  // fetch(runtime.getURL(...))；manifest 的 web_accessible_resources
  // 已放行那個檔。**讀不到就當成沒有內建規則**——規則檔壞掉只該讓
  // 站台微調失效，不該讓整個翻譯功能停擺。
  let builtinSiteRules = [];
  let siteRuleCache = null;
  let siteRuleCacheKey;

  async function loadSiteRules() {
    if (!siteRules) return;
    try {
      const url = bridge.api?.runtime?.getURL?.("core/site-rules.json");
      const result = await siteRules.loadBuiltinRules({ fetchImpl: global.fetch?.bind(global), url });
      builtinSiteRules = result.rules;
    } catch {
      builtinSiteRules = [];
    }
    // 規則換了，之前算出來的有效規則與門檻都得重算。
    siteRuleCache = null;
    siteRuleCacheKey = undefined;
    segmentationOverridesCache = null;
  }

  // 有效規則按「網址 ＋ 開關 ＋ 使用者規則文字」快取。三者任一改變就重算：
  // 完整網址形態的規則（例如只針對 YouTube 首頁那條）依賴 path，SPA 換頁
  // 沒重算的話會把首頁規則帶進播放頁。
  function siteRuleKey() {
    return [
      global.location?.href ?? "",
      settings.siteRulesEnabled === false ? "off" : "on",
      String(settings.userSiteRules ?? "")
    ].join("\n");
  }

  function effectiveSiteRule() {
    if (!siteRules) return { matched: false, appliedIds: [] };
    const key = siteRuleKey();
    if (siteRuleCache && siteRuleCacheKey === key) return siteRuleCache;
    // 使用者規則裡有一條壞的時，parseUserRules 回 valid:false 且 rules 為空
    // ——那是選項頁該擋下來的事，執行期這裡只是不套用，不拋例外。
    const parsed = siteRules.parseUserRules(settings.userSiteRules);
    siteRuleCache = siteRules.resolveSiteRules({
      url: global.location?.href ?? "",
      builtin: builtinSiteRules,
      user: parsed.rules,
      enabled: settings.siteRulesEnabled !== false
    });
    siteRuleCacheKey = key;
    return siteRuleCache;
  }

  // 分段規則全部住在 core/segmentation-core.js（純函式、可單測）。
  // 這裡只保留「哪些門檻要傳進去」的決定權：站台規則的 minChars/minWords
  // 與三組選擇器在這裡被翻成 segmentation-core 認得的覆寫物件，門檻是
  // 參數不是硬編。使用者自己設的 settings.segmentation 當底，站台規則疊上去。
  let segmentationOverridesCache = null;
  let segmentationOverridesSource;
  let segmentationOverridesRule;
  function segmentationOverrides() {
    const rule = effectiveSiteRule();
    const source = settings.segmentation;
    if (!segmentationOverridesCache
      || segmentationOverridesSource !== source
      || segmentationOverridesRule !== rule) {
      segmentationOverridesCache = siteRules
        ? siteRules.toSegmentationOverrides(rule, source ?? {})
        : (source ?? {});
      segmentationOverridesSource = source;
      segmentationOverridesRule = rule;
    }
    return segmentationOverridesCache;
  }

  let segmentationOptionsCache = null;
  let segmentationOptionsSource;
  function segmentationOptions() {
    // 用「合併後的覆寫物件」的參考當快取鍵，而不是 settings.segmentation：
    // 站台規則變了但 settings.segmentation 沒變（SPA 換頁最常見）時，
    // 看後者會拿到過期的門檻，而且完全不會報錯。
    const source = segmentationOverrides();
    if (!segmentationOptionsCache || segmentationOptionsSource !== source) {
      segmentationOptionsCache = segmentation.resolveSegmentationOptions(source);
      segmentationOptionsSource = source;
    }
    return segmentationOptionsCache;
  }

  // 站台規則的 urlChangeDelay：SPA 換路由後等幾毫秒才重掃。沒設就用預設。
  function urlChangeDelay(fallback) {
    const value = effectiveSiteRule().urlChangeDelay;
    return typeof value === "number" ? value : fallback;
  }

  // 每個文件裡可能的內容根節點，由「文字量最多」排到最少，最後才退回 body。
  //
  // 不能只用 document.querySelector("article, main, [role='main']")：那回傳的是
  // 文件順序中第一個符合「任一」選擇器的元素，不是最主要的那個。像 Substack 的
  // 閱讀器外層有個空殼 main，真正的文章在另一棵子樹，只看第一個就會搜出零段。
  function contentRoots(doc) {
    const roots = [...doc.querySelectorAll("article, main, [role='main']")]
      .map((node) => ({ node, weight: (node.innerText ?? "").length }))
      .filter((item) => item.weight > 0);
    // body 當保底，權重刻意壓到最低：它一定包含導覽列和頁尾，
    // 只有在找不到像樣的內容容器時才該用它。
    if (doc.body) roots.push({ node: doc.body, weight: -1 });
    return roots;
  }

  // 把所有可達文件的候選根節點放在一起排序，而不是一份文件一份文件試。
  //
  // 逐份文件試的話最上層永遠先輪到，而真實網站的最上層再怎樣都有導覽列文字，
  // 於是永遠不會走到 iframe——正文在 iframe 裡的站台就只會翻到選單。
  function rankedRoots() {
    return reachableDocuments()
      .flatMap((doc) => contentRoots(doc))
      .sort((a, b) => b.weight - a.weight)
      .map((item) => item.node);
  }

  // 站台規則的 `selectors` 是**白名單**：只翻這些容器裡面的東西。
  //
  // 它跟 rankedRoots 的關係刻意不同——rankedRoots 是「一個一個試，
  // 第一個搜得到就用它」，白名單卻必須是**聯集**：Stack Overflow 一頁有
  // 一個問題加十個回答，全部都是 `div.s-prose`，只取第一個等於只翻問題。
  //
  // 一個選擇器都對不上時回空陣列，呼叫端會退回預設的 rankedRoots——
  // 站台改版把 class 換掉時，最差的結果是「規則失效、照預設翻」，
  // 不是「整站翻不出任何東西」。
  function whitelistRoots() {
    const selectors = effectiveSiteRule().selectors;
    if (!Array.isArray(selectors) || !selectors.length) return [];
    const nodes = [];
    for (const doc of reachableDocuments()) {
      for (const selector of selectors) {
        let found;
        try {
          found = doc.querySelectorAll(selector);
        } catch {
          // 語法壞掉的選擇器（使用者手寫的規則）不該讓整頁翻不了。
          continue;
        }
        for (const node of found) {
          // 巢狀命中只留最外層：`div.s-prose` 裡面又有 `div.s-prose` 時
          // 兩個都收，同一段會被收集兩次（去重靠文字，但 batchGroup 會亂）。
          if (nodes.some((existing) => existing !== node && existing.contains(node))) continue;
          if (!nodes.includes(node)) nodes.push(node);
        }
      }
    }
    return nodes;
  }

  // 內容腳本預設只跑在最上層框架。有些站台把正文放在同源的 iframe 裡，
  // 那種情況從外面看根本沒有文字，所以主動往同源的子框架裡找。
  function reachableDocuments() {
    const documents = [document];
    for (const frame of document.querySelectorAll("iframe")) {
      try {
        const inner = frame.contentDocument;
        // 跨來源的 iframe 讀不到，contentDocument 會是 null 或存取即丟例外。
        if (inner?.body && !documents.includes(inner)) documents.push(inner);
      } catch {
        // 跨來源，跳過。
      }
    }
    return documents;
  }

  // 播放器內部的字幕與控制項不該被「翻譯這個網頁」動到（判準與理由全在
  // core/player-context-core.js 的檔頭）。
  //
  // W4-1 前這裡是一行 `closest("[class*='subtitle'],[class*='caption'],…")`，
  // 於是新聞副標 `<h3 class="subtitle">` 與圖說 `<figcaption class="caption">`
  // 被當成播放器字幕靜默跳過。現在寬鬆的那兩條只在播放器語境內才生效。
  const playerContext = global.ImmerseFreePlayerContextCore;

  // 模組沒載到就退回「只排除嚴格清單」——少排除一塊只是多翻一行，
  // 用寬鬆清單當退路才會把整區文字永遠吃掉（跟 rich-text 同一個降級原則）。
  const FALLBACK_PLAYER_SELECTORS = [
    "video",
    "[class*='timedtext']",
    "[data-uia*='player']",
    "[class*='player-controls']"
  ].join(",");

  function insidePlayer(element) {
    if (playerContext?.insidePlayer) return playerContext.insidePlayer(element);
    return Boolean(element.closest(FALLBACK_PLAYER_SELECTORS));
  }

  function collectFrom(root, seen, counters, ctx) {
    const options = ctx.options;
    const collected = [];
    for (const element of segmentation.collectBlockElements(root, ctx)) {
      if (element.hasAttribute(MARKER) || element.closest("[data-immersefree-extension-root]")) continue;
      if (insidePlayer(element)) continue;
      if (String(element.className ?? "").split(/\s+/).includes(TRANSLATION_CLASS)) continue;
      // 公式與程式碼整塊維持原文：連元素本身都不該成為一段。
      if (segmentation.isStayOriginal(element, options)) continue;
      if (segmentation.isExcludedElement(element, options)) continue;
      if (!segmentation.isVisibleElement(element, ctx.styleCache)) continue;
      const parts = segmentParts(element, options);
      // 所有門檻與語言判斷一律看**純文字**（parts.plainText），不看帶佔位符的
      // 那一份。看帶標記的那份會有兩個看不見的行為改變：
      //   1. 佔位符會把 1790 字的段落推過 1800 的上限，整段被丟掉；
      //   2. ⟦1⟧ 裡有數字，「整段只有符號」的段落會被誤判成有文字。
      // 而且純文字判斷等於維持 W2-1 的既有語意，含連結的段落不會突然改命運。
      if (!segmentation.meetsTextThreshold(parts.plainText, options)) continue;
      if (seen.has(parts.text)) continue;
      if (!/[\p{L}\p{N}]/u.test(parts.plainText)) continue;
      if (language?.isAlreadyTargetLanguage(parts.plainText, settings.targetLanguage)) {
        counters.skipped += 1;
        continue;
      }
      seen.add(parts.text);
      collected.push({
        element,
        // text 是「送出去、也拿去算快取鍵」的那一份，含佔位符。
        // 純文字段落的 text 與 plainText 完全相同，所以那一條路徑零變化。
        text: parts.text,
        plainText: parts.plainText,
        marks: parts.marks,
        rich: parts.rich
      });
    }
    return collected;
  }

  function collectCandidates() {
    // 全部落空時要回報「看過但跳過幾段」，所以跨嘗試保留看過最多的那次，
    // 不能讓每輪歸零把它洗掉——否則永遠回報 0，訊息就變得沒有意義。
    let mostSkipped = 0;
    // 一次收集共用一份 getComputedStyle 快取。同一批祖先會被不同 root、
    // 不同文字節點反覆問到，沒有共用的話呼叫量會跟節點數成正比往上爆。
    const ctx = segmentation.createSegmentationContext(segmentationOverrides(), global);
    // 白名單模式（站台規則的 selectors）：所有命中的容器一起收，共用一份
    // seen 去重，收完才回。不能沿用下面那個「第一個非空就回」的迴圈。
    const whitelist = whitelistRoots();
    if (whitelist.length) {
      const seen = new Set();
      const counters = { skipped: 0 };
      const collected = [];
      for (const root of whitelist) collected.push(...collectFrom(root, seen, counters, ctx));
      if (collected.length) {
        return {
          candidates: segmentation.assignBatchGroups(collected, ctx.options),
          skipped: counters.skipped
        };
      }
      mostSkipped = Math.max(mostSkipped, counters.skipped);
    }
    for (const root of rankedRoots()) {
      // 文字量最多的根節點先試；搜得到就用它，搜不到再換下一個，
      // 全都落空才會用到 body。
      const seen = new Set();
      const counters = { skipped: 0 };
      const candidates = collectFrom(root, seen, counters, ctx);
      if (candidates.length) {
        // 列表模式的候選標上 batchGroup（同卡片位置＝同一組）。
        // 這裡只標記，批次協議與切批規則完全沒動，交給批次層去用。
        return {
          candidates: segmentation.assignBatchGroups(candidates, ctx.options),
          skipped: counters.skipped
        };
      }
      mostSkipped = Math.max(mostSkipped, counters.skipped);
    }
    return { candidates: [], skipped: mostSkipped };
  }

  // 候選的「原文」一律走這一支：公式子樹會被跳過，所以 collectFrom 存下來的
  // 文字、candidateStillCurrent 的比對、injectTranslation 記的原文必須同源，
  // 否則段落一收集完就會被判定成「已經變了」而整批被丟掉。
  function segmentText(element, options) {
    return segmentation.extractSegmentText(element, options ?? segmentationOptions());
  }

  // 候選的中間表示（W2-2）：純文字 ＋ 帶行內佔位符的送出文字 ＋ 標記表。
  // 走 segmentation-core 的同一支出口，所以 collectFrom 存下來的文字、
  // candidateStillCurrent 的比對、injectTranslation 用的標記三者必定同源。
  function segmentParts(element, options) {
    return segmentation.extractSegmentParts(element, options ?? segmentationOptions());
  }

  // 內容腳本這一側唯一的診斷回報入口。事件緩衝住在背景頁，這裡只送 code
  // 與幾個數字；失敗一律吞掉——診斷記不起來不該讓翻譯本身壞掉。
  function reportDiagnostic(fields) {
    try {
      void bridge.sendMessage?.({ type: "IMMERSEFREE_RECORD_DIAGNOSTIC", event: fields })?.catch?.(() => {});
    } catch {
      // Service worker 正在重啟或擴充功能剛被重新載入。
    }
  }

  // 統計增量（W4-2）。跟 reportDiagnostic 同一條路、同一種失敗處理：
  // 統計送不出去只是少一個數字，不能影響翻譯。
  function reportMetrics(delta) {
    try {
      void bridge.sendMessage?.({ type: "IMMERSEFREE_RECORD_METRICS", metrics: delta })?.catch?.(() => {});
    } catch {
      // 同上。
    }
  }

  // 這個節點是不是我們插的譯文。判準跟 collectPairs 用的是同一套（切開
  // className 字串比對），不用 classList：譯文節點雖然一定有 classList，
  // 但相鄰的可能是任何東西，包含沒有 classList 的節點。
  function isTranslationNode(node) {
    return Boolean(node) && String(node.className ?? "").split(/\s+/).includes(TRANSLATION_CLASS);
  }

  // 這個原文節點後面是不是已經有譯文了。
  //
  // 不看 MARKER 屬性：按「還原」時 MARKER 與譯文節點是一起被清掉的，看誰都
  // 一樣；但若站台自己把譯文節點刪掉而 MARKER 還在，看 MARKER 會讓這一段
  // 永遠補不回來。以「畫面上實際有沒有那個節點」為準才補得回去。
  function hasTranslationFor(element) {
    return isTranslationNode(element?.nextElementSibling);
  }

  // 插入譯文的唯一出口，而且是冪等的：同一個原文節點後面永遠只留一個譯文節點。
  //
  // 這是硬防線，不是最佳化。上游已經有兩道逐段檢查（translateBatch 送出前、
  // 回來後各一次），但那兩道都是「檢查完到插入之間沒有 await」才成立的；
  // 只要日後有人在中間插進一個 await，重複節點就會回來。所以最後這一步自己
  // 保證不變式：先看後面有沒有譯文，有就換掉它，沒有才插新的。
  // while 迴圈是為了把歷史上已經插歪的連續譯文（舊版本留下的）收斂回一個。
  function placeTranslation(source, translation) {
    let next = source.nextElementSibling;
    let slot = null;
    while (isTranslationNode(next)) {
      const following = next.nextElementSibling;
      if (slot) next.remove();
      else slot = next;
      next = following;
    }
    if (slot) slot.replaceWith(translation);
    else source.insertAdjacentElement("afterend", translation);
  }

  function injectTranslation(item, text) {
    const source = item?.element ?? item;
    source.setAttribute(MARKER, "");
    source.dataset.immerseFreeSourceText = segmentText(source);
    // 段落可能來自同源 iframe，節點要用它自己的 document 建，不能用最上層的。
    const doc = source.ownerDocument ?? document;
    const translation = doc.createElement(source.matches("li,td,th") ? "div" : "p");
    translation.className = TRANSLATION_CLASS;
    translation.lang = settings.targetLanguage || "zh-Hant";
    translation.dir = "auto";
    matchSourceTypography(source, translation);
    const marks = Array.isArray(item?.marks) ? item.marks : [];
    // 純文字段落（絕大多數）走原路徑，一個多餘的判斷都不做。
    if (!richText || !item?.rich || !marks.length) {
      translation.textContent = text;
      placeTranslation(source, translation);
      return;
    }
    // 硬校驗。集合／配對／順序／巢狀四項任一不過，restored.ok 就是 false，
    // 這時把佔位符整批清掉當純文字用——**畫面上不可能出現破碎的標記**。
    const restored = richText.restoreRichText(text, marks);
    if (!restored.ok) {
      translation.textContent = restored.text;
      translation.dataset.immerseFreeRichtextFallback = restored.reason || "1";
      reportDiagnostic({ code: "RICHTEXT_FALLBACK", ok: false, batchSize: 1 });
      placeTranslation(source, translation);
      return;
    }
    // 通過校驗才建節點。標籤與屬性一律取自原節點（marks），模型只提供文字，
    // 而文字一律以文字節點的身分進畫面（buildTranslationFragment 不碰 innerHTML）。
    translation.append(richText.buildTranslationFragment(restored.nodes, marks, doc));
    translation.dataset.immerseFreeRichtext = String(marks.length);
    placeTranslation(source, translation);
  }

  // 譯文的字級／字重跟「被翻的那一段自己」對齊（使用者回饋 round-1）。
  //
  // content.css 的基底只寫 `font: inherit`，繼承的是**父容器**的脈絡，不是
  // 被翻元素自身的 computed 樣式。Substack 的作者列與日期是靠自己的 class
  // 縮到 11px（父層仍是 16px），所以譯文被放大了半號；大標題反過來是靠 h1
  // 自己的 font-size 撐到 32px，譯文卻掉回父層字級。兩邊都不對。
  //
  // 做法：插入的當下讀一次 getComputedStyle(原節點)，把 font-size（px 實值）
  // 與 font-weight 寫進兩個自訂屬性，交給 CSS 的 var() 去套。
  // - 只在插入時讀一次。換主題、切「僅譯文」都只改根節點的 data 屬性，
  //   不會回頭重讀，所以不會有「幾百段譯文同時觸發重排」的效能問題。
  // - 用自訂屬性而不是直接寫 inline font-weight：inline !important 的優先度
  //   高過任何選擇器，會把 bold 主題那條 font-weight:700 整個廢掉。
  // - line-height 不抄：基底刻意用 1.7 這個相對值（中英混排的行距需求跟原文
  //   不一樣），抄過來反而會讓中文擠在一起。
  // - text-transform 不抄：中文沒有大小寫，uppercase 對譯文沒有意義。
  // PDF 與字幕走各自的渲染路徑，不經過這裡。
  function matchSourceTypography(source, translation) {
    try {
      const view = source.ownerDocument?.defaultView;
      const computed = view?.getComputedStyle?.(source);
      if (!computed) return;
      const size = computed.fontSize;
      // 只接受 px 實值。量不到（display:none、測試替身回空字串）就整個放棄，
      // 讓 CSS 的 var() 退回 inherit——那就是這次改動之前的行為。
      if (/^\d+(\.\d+)?px$/.test(String(size))) {
        translation.style.setProperty("--imf-source-font-size", size);
      }
      const weight = computed.fontWeight;
      if (/^\d{1,4}$/.test(String(weight))) {
        translation.style.setProperty("--imf-source-font-weight", weight);
      }
    } catch {
      // 抄不到字級只是回到舊行為，不能讓整段翻譯插不進去。
    }
  }

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }
})(globalThis);
