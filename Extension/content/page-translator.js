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
    async toggle(nextSettings = {}) {
      await ensureCacheReady();
      settings = { ...settings, ...nextSettings };
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
          throw new Error(t("目前頁面找不到可翻譯的文字段落"));
        }
        const { hits, missing } = await resolveCachedCandidates(candidates);
        progressTracker = createTranslationProgress(existing.length + candidates.length);
        if (existing.length + hits.length) progressTracker.complete(existing.length + hits.length);
        updateProgress(progressTracker.snapshot());
        let translatedCount = existing.length + hits.length;
        const history = hits.map(({ item, entry }) => ({ source: item.text, translation: entry.translatedText }));
        translatedCount += await translatePending(missing, translatedCount, history);
        scheduleProgressDismiss();
        return { active: true, count: translatedCount };
      } catch (error) {
        if (!progressTracker) progressTracker = createTranslationProgress(1);
        updateProgress(progressTracker.fail(error.message));
        throw error;
      } finally {
        running = false;
        flushRequestedRestore();
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
        installObserver();
        if (settings.pageTranslationEnabled !== false) await restoreCachedPage();
      })();
    }
    return cacheReadyPromise;
  }

  function installObserver() {
    if (observer || typeof global.MutationObserver !== "function" || !document.documentElement) return;
    observer = new global.MutationObserver(() => {
      if (restoreSuppressed) return;
      if (running || restoreRunning) {
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

  function flushRequestedRestore() {
    if (!restoreRequested || restoreSuppressed || running || restoreRunning) return;
    restoreRequested = false;
    scheduleRestore(0);
  }

  async function restoreCachedPage() {
    if (restoreSuppressed) return;
    if (restoreRunning || running) {
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
      progressTracker = createTranslationProgress(existingCount + hits.length + missing.length);
      if (existingCount + hits.length) progressTracker.complete(existingCount + hits.length);
      updateProgress(progressTracker.snapshot());
      const history = hits.map(({ item, entry }) => ({ source: item.text, translation: entry.translatedText }));
      await translatePending(missing, existingCount + hits.length, history);
      scheduleProgressDismiss();
    } catch (error) {
      if (!progressTracker) progressTracker = createTranslationProgress(1);
      updateProgress(progressTracker.fail(error.message));
    } finally {
      restoreRunning = false;
      flushRequestedRestore();
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
      injectTranslation(item.element, entry.translatedText);
      hits.push({ item, entry });
    });
    return { hits, missing };
  }

  async function translatePending(candidates, translatedCount, history) {
    let completed = 0;
    for (const queuedBatch of chunk(candidates, 8, 6000)) {
      const batch = queuedBatch.filter(candidateStillCurrent);
      if (batch.length !== queuedBatch.length) restoreRequested = true;
      // The old section has been unmounted. Stop spending provider calls on
      // its stale DOM references; the queued restore will continue from the
      // section that is actually visible now.
      if (!batch.length) break;
      const translations = await bridge.translate(
        batch.map((item) => item.text),
        {
          mode: "page",
          title: document.title,
          previous: history.slice(-4)
        }
      );
      if (!Array.isArray(translations) || translations.length !== batch.length) {
        throw new Error(t(`模型回傳 ${translations?.length ?? 0} 段翻譯，應為 ${batch.length} 段`));
      }
      const cacheEntries = [];
      batch.forEach((item, index) => {
        const translation = cleanText(translations[index]);
        if (!translation) throw new Error(t("模型回傳空白翻譯"));
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
      batch.forEach((item, index) => {
        if (candidateStillCurrent(item)) injectTranslation(item.element, cleanText(translations[index]));
        else restoreRequested = true;
      });
      completed += batch.length;
      if (progressTracker) updateProgress(progressTracker.complete(batch.length));
    }
    return completed;
  }

  function candidateStillCurrent(item) {
    const element = item?.element;
    if (!element || element.isConnected === false) return false;
    return cleanText(element.innerText || element.textContent) === item.text;
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
    let root = document.querySelector(`.${PROGRESS_CLASS}`);
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
    meter.max = Math.max(1, snapshot.total);
    meter.value = snapshot.total ? snapshot.completed : 0;
  }

  function scheduleProgressDismiss() {
    clearTimeout(dismissTimer);
    dismissTimer = setTimeout(removeProgress, 3000);
  }

  function removeProgress() {
    clearTimeout(dismissTimer);
    document.querySelector(`.${PROGRESS_CLASS}`)?.remove();
  }

  const BLOCK_SELECTORS = "h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,dt,dd,td,th";

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

  // 播放器內部的即時字幕與控制項不該被「翻譯這個網頁」動到。
  //
  // 那些文字每一兩秒就換一次，插進去的譯文只會停在按下當下的那一句，
  // 從此黏在原生字幕下面不再更新——畫面上就多出一行對不上的中文。
  //
  // 這裡刻意不比對 class 裡的 "subtitle"：一般網站用它當文章副標題，
  // 比對下去會讓整段副標題永遠翻不到。真正的播放器字幕走 caption／timedtext。
  const PLAYER_SELECTORS = [
    "video",
    "[class*='caption']",
    "[class*='timedtext']",
    "[data-uia*='player']",
    "[class*='player-controls']"
  ].join(",");

  function insidePlayer(element) {
    return Boolean(element.closest(PLAYER_SELECTORS));
  }

  function collectFrom(root, seen, counters) {
    return [...root.querySelectorAll(BLOCK_SELECTORS)]
      .filter((element) => {
        if (element.hasAttribute(MARKER) || element.closest("[data-immersefree-extension-root]")) return false;
        if (insidePlayer(element)) return false;
        if (String(element.className ?? "").split(/\s+/).includes(TRANSLATION_CLASS)) return false;
        if (!isVisible(element)) return false;
        const text = cleanText(element.innerText || element.textContent);
        if (text.length < 2 || text.length > 1800 || seen.has(text)) return false;
        if (!/[\p{L}\p{N}]/u.test(text)) return false;
        if (language?.isAlreadyTargetLanguage(text, settings.targetLanguage)) {
          counters.skipped += 1;
          return false;
        }
        seen.add(text);
        return true;
      })
      .map((element) => ({ element, text: cleanText(element.innerText || element.textContent) }));
  }

  function collectCandidates() {
    // 全部落空時要回報「看過但跳過幾段」，所以跨嘗試保留看過最多的那次，
    // 不能讓每輪歸零把它洗掉——否則永遠回報 0，訊息就變得沒有意義。
    let mostSkipped = 0;
    for (const root of rankedRoots()) {
      // 文字量最多的根節點先試；搜得到就用它，搜不到再換下一個，
      // 全都落空才會用到 body。
      const seen = new Set();
      const counters = { skipped: 0 };
      const candidates = collectFrom(root, seen, counters);
      if (candidates.length) return { candidates, skipped: counters.skipped };
      mostSkipped = Math.max(mostSkipped, counters.skipped);
    }
    return { candidates: [], skipped: mostSkipped };
  }

  function injectTranslation(source, text) {
    source.setAttribute(MARKER, "");
    source.dataset.immerseFreeSourceText = cleanText(source.innerText || source.textContent);
    // 段落可能來自同源 iframe，節點要用它自己的 document 建，不能用最上層的。
    const doc = source.ownerDocument ?? document;
    const translation = doc.createElement(source.matches("li,td,th") ? "div" : "p");
    translation.className = TRANSLATION_CLASS;
    translation.lang = settings.targetLanguage || "zh-Hant";
    translation.dir = "auto";
    translation.textContent = text;
    source.insertAdjacentElement("afterend", translation);
  }

  function chunk(items, maxItems, maxChars) {
    const batches = [];
    let current = [];
    let characters = 0;
    for (const item of items) {
      if (current.length && (current.length >= maxItems || characters + item.text.length > maxChars)) {
        batches.push(current);
        current = [];
        characters = 0;
      }
      current.push(item);
      characters += item.text.length;
    }
    if (current.length) batches.push(current);
    return batches;
  }

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function isVisible(element) {
    const view = element.ownerDocument?.defaultView ?? window;
    const style = view.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }
})(globalThis);
