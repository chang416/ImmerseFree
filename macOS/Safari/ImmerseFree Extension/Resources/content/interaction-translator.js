(function initializeInteractionTranslator(global) {
  const bridge = global.ImmerseFree;
  const language = global.ImmerseFreeLanguage;
  // 翻譯卡的字串在寫進畫面前查表，介面語言設成英文時這裡也要是英文。
  const t = (text) => bridge.t?.(text) ?? text;
  let settings = {};
  let card;
  let hoverTimer;
  let hoverTarget;
  // 已經翻過的段落記下來。滑鼠移回去時直接顯示，不再重打一次 API，
  // 也不會像以前那樣被去重擋掉而變成「既不翻譯也不顯示」。
  const translationCache = new Map();
  const TRANSLATION_CACHE_LIMIT = 80;
  // 目前卡片上顯示的是哪一段原文，用來判斷「滑回同一段」要不要重畫。
  let shownText = "";
  const HOVER_CONTAINER_SELECTOR = "article,[role='article'],[role='listitem'],[data-testid='tweet'],[data-testid='tweetDetail'],[class~='card']";
  const HOVER_LEAF_SELECTOR = "p,li,blockquote,figcaption,td,th,h1,h2,h3,h4,h5,h6";
  const HOVER_SPECIFIC_CONTENT_SELECTOR = "[data-testid='tweetText'],[data-testid='postText'],[itemprop='articleBody']";
  const MAX_HOVER_TEXT_LENGTH = 12000;
  const MAX_TRANSLATION_SEGMENT_LENGTH = 1800;

  bridge.interactionTranslator = {
    start(nextSettings = {}) {
      settings = nextSettings;
      bridge.setUiLanguage?.(settings.uiLanguage);
      watchStoredSettings();
      document.addEventListener("mouseup", onSelectionEnd, true);
      document.addEventListener("dragend", onDragEnd, true);
      document.addEventListener("mousemove", onPointerMove, true);
      document.addEventListener("keydown", onKeyDown, true);
      document.addEventListener("input", onEditableInput, true);
    },
    updateSettings(nextSettings = {}) {
      settings = { ...settings, ...nextSettings };
      bridge.setUiLanguage?.(settings.uiLanguage);
      if (!settings.hoverTranslationEnabled) clearHover();
    },
    translateText(text, anchor, mode = "selection", sourceNode) {
      return translateAndShow(cleanText(text), anchor, mode, sourceNode);
    }
  };

  // 反白與懸停的開關以前只認 start() 當下拿到的那份設定。使用者在 popup 或
  // 選項頁把開關打開時，已經開著的分頁（以及非作用中分頁的每個框架）收不到
  // 通知，開關顯示「開」但事件處理器仍在用舊的 false 直接 return——功能看起來
  // 整個沒反應，也沒有任何錯誤訊息。改成直接聽 storage，設定一變就跟上，
  // 不必依賴任何人記得廣播。
  let watchingStoredSettings = false;
  function watchStoredSettings() {
    if (watchingStoredSettings) return;
    watchingStoredSettings = true;
    try {
      bridge.api.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local") return;
        const next = {};
        for (const [key, change] of Object.entries(changes)) next[key] = change.newValue;
        settings = { ...settings, ...next };
        bridge.setUiLanguage?.(settings.uiLanguage);
        if (!settings.hoverTranslationEnabled) clearHover();
      });
    } catch {
      // 沒有 storage 權限時就退回原本的廣播路徑。
    }
  }

  function onSelectionEnd(event) {
    if (!settings.selectionTranslationEnabled || isExtensionUi(event.target)) return;
    queueMicrotask(() => {
      const selection = global.getSelection();
      const text = cleanText(selection?.toString());
      if (!text || text.length > 4000 || selection.rangeCount < 1) return;
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const sourceNode = container.nodeType === 1 ? container : container.parentElement;
      bridge.interactionTranslator.translateText(text, range.getBoundingClientRect(), "selection", sourceNode);
    });
  }

  function onDragEnd(event) {
    if (!settings.selectionTranslationEnabled || isExtensionUi(event.target)) return;
    const text = cleanText(global.getSelection()?.toString());
    if (text) translateAndShow(text, { x: event.clientX, y: event.clientY });
  }

  function onPointerMove(event) {
    if (!settings.hoverTranslationEnabled || isExtensionUi(event.target)) return;
    const target = findHoverTarget(event.target);
    if (!target) return;
    const text = readableText(target);
    if (!text || text.length < 2 || text.length > MAX_HOVER_TEXT_LENGTH) return;
    // 卡片還開著而且顯示的就是這一段時才什麼都不做。以前是用
    // 「同一個元素」和「同一段文字」去重，於是把卡片關掉後再滑回去，
    // 既不會重新翻譯、也不會把剛剛翻好的結果顯示出來。
    if (target === hoverTarget && isShowingText(text)) return;
    clearTimeout(hoverTimer);
    hoverTarget = target;
    // 翻過的段落不必再等 0.7 秒，直接秀出來。
    const delay = translationCache.has(cacheKey(text)) ? 0 : 700;
    hoverTimer = setTimeout(() => {
      const rect = target.getBoundingClientRect();
      bridge.interactionTranslator.translateText(
        text,
        { x: Math.min(rect.right, innerWidth - 24), y: Math.min(rect.bottom, innerHeight - 24) },
        "hover",
        target
      );
    }, delay);
  }

  function cacheKey(text) {
    return `${settings.targetLanguage ?? ""}\u0000${settings.translationStyle ?? ""}\u0000${text}`;
  }

  function rememberTranslation(text, translation) {
    if (!text || !translation) return;
    const key = cacheKey(text);
    translationCache.delete(key);
    translationCache.set(key, translation);
    while (translationCache.size > TRANSLATION_CACHE_LIMIT) {
      translationCache.delete(translationCache.keys().next().value);
    }
  }

  function isShowingText(text) {
    return Boolean(card?.isConnected && card.hidden === false && shownText === text);
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      card?.remove();
      card = undefined;
      shownText = "";
    }
  }

  async function onEditableInput(event) {
    if (!settings.inputTranslationEnabled || isExtensionUi(event.target)) return;
    const target = event.target;
    if (target instanceof HTMLInputElement && ["password", "email", "number", "url", "tel"].includes(target.type)) return;
    if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement || target.isContentEditable)) return;
    const value = target.isContentEditable ? target.innerText : target.value;
    if (!/ {3}$/.test(value) || value.trim().length < 2) return;
    const source = value.replace(/ {3}$/, "").trim();
    setEditableValue(target, source);
    showInputState(target, t("翻譯中"));
    try {
      const [translated] = await bridge.translate([source], { mode:"text", title:document.title });
      setEditableValue(target, translated);
      showInputState(target, t("已翻譯"));
    } catch (error) {
      setEditableValue(target, source);
      showInputState(target, error.message, true);
    }
  }

  function setEditableValue(target, value) {
    if (target.isContentEditable) {
      target.textContent = value;
      target.dispatchEvent(new InputEvent("input", { bubbles:true, inputType:"insertText", data:value }));
      return;
    }
    const prototype = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(target, value);
    target.dispatchEvent(new Event("input", { bubbles:true }));
  }

  function showInputState(target, message, error = false) {
    const rect = target.getBoundingClientRect();
    let badge = document.querySelector(".immersefree-input-status");
    if (!badge) {
      badge = document.createElement("div");
      badge.className = "immersefree-input-status";
      badge.setAttribute("data-immersefree-extension-root", "input-status");
      document.documentElement.append(badge);
    }
    badge.textContent = message;
    badge.dataset.state = error ? "error" : "ready";
    positionFloating(badge, rect.right - 100, rect.bottom + 7, 112, 36);
    clearTimeout(badge._removeTimer);
    badge._removeTimer = setTimeout(() => badge.remove(), 1800);
  }

  function clearHover() {
    clearTimeout(hoverTimer);
    hoverTarget = undefined;
  }

  async function translateAndShow(text, anchor = {}, mode = "selection", sourceNode) {
    if (!text) return;
    // 先看快取再決定要不要跟背景頁要設定。service worker 休眠時那趟往返要好幾秒，
    // 放在前面會讓「滑回已經翻過的段落」照樣等上十幾秒，失去快取的意義。
    // 本地這份設定由 storage.onChanged 保持同步，拿來查快取是準的。
    const cachedTranslation = translationCache.get(cacheKey(text));
    if (!cachedTranslation) await refreshSettings();
    if (language?.isAlreadyTargetLanguage(text, settings.targetLanguage)) return;
    ensureCard();
    applyCardTypography(sourceNode);
    const point = anchor instanceof DOMRect
      ? { x: anchor.right, y: anchor.bottom + 8 }
      : { x: anchor.x ?? innerWidth / 2, y: anchor.y ?? innerHeight / 2 };
    card.querySelector(".immersefree-quick-source").textContent = text;
    const translation = card.querySelector(".immersefree-quick-translation");
    shownText = text;
    card.hidden = false;

    const cached = cachedTranslation ?? translationCache.get(cacheKey(text));
    if (cached) {
      translation.textContent = cached;
      translation.dataset.state = "ready";
      placeCard(point, mode);
      return;
    }

    translation.textContent = t("翻譯中");
    translation.dataset.state = "pending";
    placeCard(point, mode);
    try {
      const segments = splitTextForTranslation(text);
      const baseContext = {
        mode,
        title: document.title,
        targetLanguage: settings.targetLanguage,
        previous: nearbyContext(text)
      };
      let results = await bridge.translate(segments, baseContext);
      if (!validTranslationBatch(segments, results)) {
        results = await bridge.translate(segments, { ...baseContext, strictTargetLanguage: true });
      }
      if (!validTranslationBatch(segments, results)) {
        throw new Error(t("翻譯結果不是設定的目標語言，請稍後再試"));
      }
      const finalText = results.join(" ");
      translation.textContent = finalText;
      translation.dataset.state = "ready";
      rememberTranslation(text, finalText);
    } catch (error) {
      translation.textContent = error.message;
      translation.dataset.state = "error";
    }
    // 內容長度變了，卡片高度也變了，重新定位一次才不會超出畫面。
    placeCard(point, mode);
  }

  function applyCardTypography(sourceNode) {
    // 翻譯框的字級跟著它翻的那段內文走。使用者把網頁放大或站台本身字就大時，
    // 固定 15px 會顯得特別小；跟著內文走就永遠讀得順。
    let size = 15;
    try {
      const node = sourceNode instanceof Element ? sourceNode : document.body;
      const measured = Number.parseFloat(getComputedStyle(node).fontSize);
      if (Number.isFinite(measured) && measured > 0) size = measured;
    } catch {
      // 取不到就用預設值。
    }
    card.style.setProperty("--immersefree-quick-font-size", `${Math.max(13, Math.min(30, size))}px`);
  }

  function placeCard(point, mode) {
    // 量實際高度再定位。以前用固定的 220 估算，內容一長就算錯，
    // 卡片會跑到畫面底部被切掉。
    const rect = card.getBoundingClientRect();
    const width = rect.width || 360;
    const height = rect.height || 200;
    const left = Math.max(12, Math.min(point.x, innerWidth - width - 12));
    // 懸停時盡量停在畫面中上段：正在讀的那一段通常在中間，卡片壓在下面
    // 很容易被視窗邊緣切掉，也容易蓋住下一段。
    const preferred = mode === "hover"
      ? Math.min(point.y, Math.max(12, innerHeight * 0.3))
      : point.y;
    const top = Math.max(12, Math.min(preferred, Math.max(12, innerHeight - height - 12)));
    Object.assign(card.style, { left: `${left}px`, top: `${top}px` });
  }

  function needsTargetLanguageRetry(source, result) {
    const target = String(settings.targetLanguage ?? "");
    if (!["zh-Hant", "zh-Hans", "en", "ja", "ko", "th"].includes(target)) return false;
    if (language?.isAlreadyTargetLanguage(source, target)) return false;
    if (cleanText(source) === cleanText(result)) return true;
    if (language?.hasTargetLanguageSignal) return !language.hasTargetLanguageSignal(result, target);
    return !hasLocalTargetLanguageSignal(result, target);
  }

  function validTranslationBatch(sources, results) {
    if (!Array.isArray(results) || results.length !== sources.length) return false;
    return results.every((result, index) => !needsTargetLanguageRetry(sources[index], result));
  }

  function hasLocalTargetLanguageSignal(value, target) {
    const text = cleanText(value);
    if (target === "zh-Hant" || target === "zh-Hans") {
      const letters = text.match(/\p{L}/gu) ?? [];
      const han = text.match(/\p{Script=Han}/gu) ?? [];
      return han.length >= 2 && han.length / Math.max(1, letters.length) >= 0.2;
    }
    if (target === "ja") return /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
    if (target === "ko") return /\p{Script=Hangul}/u.test(text);
    if (target === "th") return /\p{Script=Thai}/u.test(text);
    if (target === "en") {
      const letters = text.match(/\p{L}/gu) ?? [];
      const latin = text.match(/\p{Script=Latin}/gu) ?? [];
      return latin.length >= 2 && latin.length / Math.max(1, letters.length) >= 0.5;
    }
    return false;
  }

  async function refreshSettings() {
    if (typeof bridge.sendMessage !== "function") return;
    try {
      const response = await bridge.sendMessage({ type: "IMMERSEFREE_GET_SETTINGS" });
      if (response?.settings && typeof response.settings === "object") {
        settings = { ...settings, ...response.settings };
      }
    } catch {
      // The content script already has a usable snapshot. A transient
      // background-page failure must not prevent a manual translation.
    }
  }

  function findHoverTarget(node) {
    const container = node?.closest?.(HOVER_CONTAINER_SELECTOR);
    if (container && readableText(container)) return container;
    return node?.closest?.(HOVER_LEAF_SELECTOR);
  }

  function readableText(target) {
    const specific = readableDescendants(target, HOVER_SPECIFIC_CONTENT_SELECTOR);
    if (specific.length) return specific.join(" ");
    const blocks = readableDescendants(target, HOVER_LEAF_SELECTOR);
    if (blocks.length) return blocks.join(" ");
    const inner = typeof target?.innerText === "string" ? target.innerText : "";
    return cleanText(inner || target?.textContent);
  }

  function readableDescendants(target, selector) {
    const nodes = Array.from(target?.querySelectorAll?.(selector) ?? []);
    const candidates = nodes.filter((node) => !isHoverUiNode(node, target));
    return candidates
      .filter((node) => !candidates.some((other) => other !== node && other.contains?.(node)))
      .map((node) => readableTextLeaf(node))
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index);
  }

  function readableTextLeaf(node) {
    const inner = typeof node?.innerText === "string" ? node.innerText : "";
    return cleanText(inner || node?.textContent);
  }

  function isHoverUiNode(node, root) {
    let current = node;
    while (current && current !== root) {
      const tag = String(current.tagName ?? "").toLowerCase();
      const role = String(current.getAttribute?.("role") ?? "").toLowerCase();
      if (["header", "footer", "nav", "button", "time"].includes(tag)) return true;
      if (["button", "group"].includes(role) || current.getAttribute?.("aria-hidden") === "true") return true;
      current = current.parentElement;
    }
    return false;
  }

  function splitTextForTranslation(text, maxLength = MAX_TRANSLATION_SEGMENT_LENGTH) {
    const value = cleanText(text);
    if (!value) return [];
    const chunks = [];
    let remaining = value;
    while (remaining.length > maxLength) {
      const limit = remaining.slice(0, maxLength);
      const boundary = findTextBoundary(limit);
      const splitAt = boundary >= Math.floor(maxLength * 0.55) ? boundary : maxLength;
      chunks.push(remaining.slice(0, splitAt).trim());
      remaining = remaining.slice(splitAt).trim();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
  }

  function findTextBoundary(value) {
    const matches = [...value.matchAll(/[.!?。！？；;，,](?:\s+|$)|\s+/gu)];
    const boundary = matches.at(-1);
    return boundary ? boundary.index + boundary[0].length : 0;
  }

  function ensureCard() {
    if (card?.isConnected) return;
    card = document.createElement("aside");
    card.className = "immersefree-quick-card";
    // 屬性名要跟 isExtensionUi() 的選擇器一致。用 dataset 指派會產生
    // data-immerse-free-extension-root（駝峰被拆開），跟選擇器對不上，
    // 於是滑過自己的翻譯卡照樣觸發翻譯。
    card.setAttribute("data-immersefree-extension-root", "quick-translation");
    card.innerHTML = `
      <header><span>${t("快速翻譯")}</span><button type="button" class="immersefree-quick-close" aria-label="${t("關閉")}">×</button></header>
      <div class="immersefree-quick-source"></div>
      <div class="immersefree-quick-translation" role="status"></div>
      <footer><button type="button" class="immersefree-quick-copy">${t("複製譯文")}</button></footer>`;
    card.querySelector(".immersefree-quick-close").addEventListener("click", () => {
      card.remove();
      shownText = "";
    });
    card.querySelector(".immersefree-quick-copy").addEventListener("click", async (event) => {
      const value = card.querySelector(".immersefree-quick-translation").textContent;
      await navigator.clipboard.writeText(value);
      const button = event.currentTarget;
      button.textContent = t("已複製");
      setTimeout(() => { button.textContent = t("複製譯文"); }, 1200);
    });
    document.documentElement.append(card);
  }

  function nearbyContext(text) {
    const bodyText = cleanText(document.querySelector("article,main")?.innerText || "");
    if (!bodyText) return [];
    const index = bodyText.indexOf(text);
    if (index < 0) return [];
    return [{ source: bodyText.slice(Math.max(0, index - 420), index), translation: "" }];
  }

  function positionFloating(node, x, y, width, height) {
    const left = Math.max(12, Math.min(x, innerWidth - width - 12));
    const top = Math.max(12, Math.min(y, innerHeight - height - 12));
    Object.assign(node.style, { left: `${left}px`, top: `${top}px` });
  }

  function isExtensionUi(node) {
    return Boolean(node?.closest?.("[data-immersefree-extension-root]"));
  }

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }
})(globalThis);
