(function initializeInteractionTranslator(global) {
  const bridge = global.ImmerseFree;
  const language = global.ImmerseFreeLanguage;
  // 快取鍵公式與術語表都用共用那一份（W1-3 的 buildTranslationRequestKey ＋
  // W2-4 的術語指紋）。兩支都在 manifest 的內容腳本清單裡排在本檔之前。
  const pageCache = global.ImmerseFreePageTranslationCache;
  const glossaryCore = global.ImmerseFreeGlossaryCore;
  // 翻譯卡的字串在寫進畫面前查表，介面語言設成英文時這裡也要是英文。
  const t = (text) => bridge.t?.(text) ?? text;
  let settings = {};
  let selectionButton;
  let card;
  let hoverTimer;
  let hoverTarget;
  let hoverText = "";
  // 已經翻過的段落記下來。滑鼠移回去時直接顯示，不再重打一次 API，
  // 也不會像以前那樣被去重擋掉而變成「既不翻譯也不顯示」。
  const translationCache = new Map();
  const TRANSLATION_CACHE_LIMIT = 80;
  // 詞典結果另存一份（key 也是另一個維度，見 dictionaryCacheKey）。存的是
  // `{ entry }`（查到了）或 `{ text }`（降級成純翻譯）——降級的結果也要存，
  // 否則同一個查不到的字每劃一次就多打一次模型。
  const dictionaryCache = new Map();
  const DICTIONARY_CACHE_LIMIT = 60;
  // 「複製譯文」要複製的那一份純文字。翻譯路徑就是譯文本身（與改動前逐字相同），
  // 詞典路徑則是整張卡片攤成幾行——不留這一份的話，複製出來的是所有欄位
  // 黏成一長串沒有斷行的字。
  let copyText = "";
  // 目前卡片上顯示的是哪一段原文，用來判斷「滑回同一段」要不要重畫。
  let shownText = "";
  const HOVER_CONTAINER_SELECTOR = "article,[role='article'],[role='listitem'],[data-testid='tweet'],[data-testid='tweetDetail'],[class~='card']";
  const HOVER_LEAF_SELECTOR = "p,li,blockquote,figcaption,td,th,h1,h2,h3,h4,h5,h6";
  const HOVER_SPECIFIC_CONTENT_SELECTOR = "[data-testid='tweetText'],[data-testid='postText'],[itemprop='articleBody']";
  const MAX_HOVER_TEXT_LENGTH = 12000;
  const MAX_TRANSLATION_SEGMENT_LENGTH = 1800;

  // ============================================================ 詞典模式（W3-3）
  //
  // 劃到一個詞跟劃到一句話，使用者要的東西不一樣：一句話要譯文，一個詞要
  // 音標、詞性、幾個義項與例句。所以這裡先分流，兩條路各自有 prompt、
  // 各自有卡片、各自有快取維度。**片語與句子那條逐字沒動**（有對照測試守著
  // prompt 的每一個字元），因為那是使用者天天在用的路徑。
  //
  // 分流判準寫在這裡而不是背景頁：只有這一側知道「使用者到底選了什麼」。
  // 判準刻意保守——認不出來就當句子，走既有那條。誤判成詞典的代價是
  // 「本來要譯文卻拿到一張詞典卡」，比反過來明顯得多。
  //
  //   1. 有任何空白 → 句子／片語。`cleanText` 已經把首尾空白與連續空白處理過，
  //      所以走到這裡還有空白，就是真的有兩個以上的詞。
  //   2. 超過 24 字元 → 句子。世上有更長的單字，但那些不是使用者查得到的東西，
  //      而放寬上限會讓「沒有空白的長字串」（網址、hash、程式碼）掉進詞典。
  //   3. 拉丁字：只允許字母，以及字中間的連字號與撇號（well-known、don't）。
  //      句點、斜線、底線一律不算——那些是網址、路徑與程式碼識別字。
  //   4. 單一 CJK 詞：連續漢字最多 4 個（超過幾乎都是短句），日文假名放寬到 6
  //      （長音符與假名混寫的詞比較長）。
  //   5. 不含任何字母（純數字、純標點、表情符號）→ 不查詞典。
  const DICTIONARY_MAX_LENGTH = 24;
  const LATIN_WORD = /^\p{Script=Latin}(?:[\p{Script=Latin}'’-]*\p{Script=Latin})?$/u;
  const HAN_WORD = /^\p{Script=Han}{1,4}$/u;
  const KANA_WORD = /^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー]{1,6}$/u;

  function isSingleWordSelection(value) {
    // 非字串一律不查。少了這一行，`String(NaN)` 會變成 "NaN"、`String(0)` 變成
    // "0"，而 "NaN" 完全符合「沒有空白的短拉丁字」——判準會對一個根本不是
    // 文字的東西回 true，然後拿它去打模型。
    if (typeof value !== "string") return false;
    const text = cleanText(value);
    if (!text || text.length > DICTIONARY_MAX_LENGTH) return false;
    if (/\s/u.test(text)) return false;
    if (!/\p{L}/u.test(text)) return false;
    if (LATIN_WORD.test(text)) return true;
    if (HAN_WORD.test(text)) return true;
    return KANA_WORD.test(text);
  }

  bridge.interactionTranslator = {
    start(nextSettings = {}) {
      settings = nextSettings;
      bridge.setUiLanguage?.(settings.uiLanguage);
      watchStoredSettings();
      void refreshGlossaryTerms();
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
    },
    // 分流判準對外公開一份。判準本身住在這裡（只有這一側知道使用者選了什麼），
    // 但「哪些字串算單字」是可以逐例驗證的純函式，藏在閉包裡就沒辦法逐例驗。
    isSingleWordSelection
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
        // 全域術語表跟設定不是同一個鍵，不會被上面那一圈合併進 settings。
        // 少了這一行，改完術語之後這一頁的快取鍵不會變，已經劃過的詞照樣
        // 沿用舊譯文——正是這次要修的那個 bug。
        if (changes[glossaryCore.GLOBAL_STORAGE_KEY]) void refreshGlossaryTerms();
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
      if (!text || text.length > 4000 || selection.rangeCount < 1) {
        removeSelectionButton();
        return;
      }
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

  // 劃詞／懸停自己的記憶體快取鍵。
  //
  // 以前只有「目標語言＋風格＋原文」三個維度，於是改了術語表之後，同一次瀏覽
  // 階段裡已經劃過的那個詞會一直沿用舊譯文——沒有錯誤、沒有畫面提示，只是
  // 使用者改的東西不生效，重新整理才會好。網頁與 PDF 走背景頁快取，那一層
  // W2-4 已經有術語維度，缺的一直只有這一層。
  //
  // 修法是**接上同一套公式**：key 由 W1-3 的 buildTranslationRequestKey 算，
  // 術語維度由 glossaryCacheScope 給（本句命中的自訂術語 ＋ 預設庫的領域勾選）。
  // 這裡不自己拼字串，就不會有「背景頁改了維度、劃詞這層沒跟上」的分岔。
  //
  // mode 固定 "page"：背景頁的 cacheScope 也把 selection／hover 都算成 page，
  // 而且劃詞與懸停同一段文字本來就該共用同一份譯文。
  function cacheKey(text) {
    return pageCache.buildTranslationRequestKey(text, settings, {
      mode: "page",
      ...glossaryCore.glossaryCacheScope({ settings, terms: glossaryTerms, texts: [text] })
    });
  }

  // 詞典結果的快取鍵（W3-3）。**同一個字的詞典卡與譯文是兩件事**：prompt 不同、
  // 回來的形狀不同（物件 vs 字串），共用一格的話，先劃過再懸停同一個字就會
  // 把詞典物件當譯文字串寫進畫面（畫面上是 `[object Object]`，而且不報錯）。
  //
  // 維度靠 requestScope 現成的 mode 欄位加一個值就夠，不必新增欄位——
  // 那一層本來就是「同一句話在不同用途下是不同的東西」在管的地方。
  function dictionaryCacheKey(text) {
    return pageCache.buildTranslationRequestKey(text, settings, {
      mode: "dictionary",
      ...glossaryCore.glossaryCacheScope({ settings, terms: glossaryTerms, texts: [text] })
    });
  }

  // 使用者的全域術語表。快取鍵要算它的指紋，所以本地留一份；storage 一變就
  // 當場換掉（不是等下一次翻譯才去讀），否則「改完術語、馬上劃同一個詞」
  // 還是會撿到舊譯文。
  let glossaryTerms = [];
  async function refreshGlossaryTerms() {
    try {
      glossaryTerms = (await glossaryCore.readGlobalGlossary(bridge.api?.storage?.local)) ?? [];
    } catch {
      glossaryTerms = [];
    }
  }

  function rememberTranslation(text, translation) {
    if (!text || !translation) return;
    remember(translationCache, cacheKey(text), translation, TRANSLATION_CACHE_LIMIT);
  }

  function isShowingText(text) {
    return Boolean(card?.isConnected && card.hidden === false && shownText === text);
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      card?.remove();
      card = undefined;
      shownText = "";
      removeSelectionButton();
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
    hoverText = "";
  }

  async function translateAndShow(text, anchor = {}, mode = "selection", sourceNode) {
    if (!text) return;
    // 詞典分支只給「反白／拖曳選取」。懸停的目標是整個段落（findHoverTarget 找的
    // 是 p/li/article 這類節點），不可能是一個詞；把懸停也放進來只會多一條
    // 永遠不會走到的路，而懸停那條的行為必須逐字不變。
    const dictionary = mode === "selection" && isSingleWordSelection(text);
    // 先看快取再決定要不要跟背景頁要設定。service worker 休眠時那趟往返要好幾秒，
    // 放在前面會讓「滑回已經翻過的段落」照樣等上十幾秒，失去快取的意義。
    // 本地這份設定由 storage.onChanged 保持同步，拿來查快取是準的。
    const cachedTranslation = dictionary
      ? dictionaryCache.get(dictionaryCacheKey(text))
      : translationCache.get(cacheKey(text));
    if (!cachedTranslation) await refreshSettings();
    if (language?.isAlreadyTargetLanguage(text, settings.targetLanguage)) return;
    removeSelectionButton();
    ensureCard();
    applyCardTypography(sourceNode);
    const point = anchor instanceof DOMRect
      ? { x: anchor.right, y: anchor.bottom + 8 }
      : { x: anchor.x ?? innerWidth / 2, y: anchor.y ?? innerHeight / 2 };
    card.querySelector(".immersefree-quick-source").textContent = text;
    const translation = card.querySelector(".immersefree-quick-translation");
    shownText = text;
    hoverText = text;
    card.hidden = false;

    // 卡片本體、定位、自我排除標記、Esc 關閉全部共用；分歧只在標題與內容區。
    if (dictionary) return lookUpAndShow(text, point, mode, cachedTranslation);
    setCardKind("translation");

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

  // 卡片是同一張，只換標題與 `data-imf-card`（樣式靠這個屬性分家，class 不變，
  // 所以自我排除標記與定位邏輯完全共用）。順手把 copyText 歸零：翻譯路徑不設它，
  // 於是「複製譯文」會退回讀 textContent——與改動前逐字相同的行為。
  function setCardKind(kind) {
    copyText = "";
    card.dataset.imfCard = kind;
    const title = card.querySelector(".immersefree-quick-title");
    if (title) title.textContent = kind === "dictionary" ? t("單字查詢") : t("快速翻譯");
    // 詞典卡按下去複製的是整張卡（字、音標、詞性、義項、例句），不只譯文，
    // 所以按鈕就叫「複製整筆」。翻譯卡的字樣一個字都沒動。
    const copy = card.querySelector(".immersefree-quick-copy");
    if (copy) copy.textContent = copyLabel();
  }

  function copyLabel() {
    return card?.dataset.imfCard === "dictionary" ? t("複製整筆") : t("複製譯文");
  }

  // 詞典分支。查得到就畫詞典卡，查不到（背景頁已經降級）就畫一張普通翻譯卡——
  // **兩種都不是錯誤畫面**，使用者要嘛拿到義項，要嘛至少拿到譯文。
  async function lookUpAndShow(word, point, mode, cachedEntry) {
    const key = dictionaryCacheKey(word);
    const holder = card.querySelector(".immersefree-quick-translation");
    const hit = cachedEntry ?? dictionaryCache.get(key);
    if (hit?.entry) {
      renderDictionaryEntry(holder, hit.entry);
      placeCard(point, mode);
      return;
    }
    if (hit?.text) {
      renderFallbackTranslation(holder, hit.text);
      placeCard(point, mode);
      return;
    }
    setCardKind("dictionary");
    holder.textContent = t("查詢中");
    holder.dataset.state = "pending";
    placeCard(point, mode);
    try {
      const response = await bridge.lookupWord(word, {
        mode: "selection",
        title: document.title,
        targetLanguage: settings.targetLanguage,
        previous: nearbyContext(word)
      });
      const plain = Array.isArray(response?.translations)
        ? response.translations.filter(Boolean).join(" ")
        : "";
      // **先存快取，再決定要不要畫。** 查詢期間使用者很可能已經選了別的東西——
      // 三擊選整段就會經過「選到一個詞」這個中間狀態，於是那個詞的查詢會在
      // 整段的譯文之後才回來。少了下面那道 shownText 比對，晚回來的詞典卡會
      // 蓋掉使用者現在真正在看的譯文（畫面上是一張對不上選取內容的卡片，
      // 而且不會有任何錯誤）。快取照存：那一次請求的錢已經花了。
      if (response?.mode === "dictionary" && response.entry) {
        remember(dictionaryCache, key, { entry: response.entry }, DICTIONARY_CACHE_LIMIT);
      } else if (plain) {
        // 只有真的拿到譯文才存。存一句「查不到」進快取，那個字就再也不會重試。
        remember(dictionaryCache, key, { text: plain }, DICTIONARY_CACHE_LIMIT);
        rememberTranslation(word, plain);
      }
      if (shownText !== word) return;
      if (response?.mode === "dictionary" && response.entry) {
        renderDictionaryEntry(holder, response.entry);
      } else {
        renderFallbackTranslation(holder, plain || t("查不到這個字的詞典資料"));
      }
    } catch (error) {
      if (shownText !== word) return;
      setCardKind("translation");
      holder.textContent = error.message;
      holder.dataset.state = "error";
    }
    // 內容長度變了，卡片高度也變了，重新定位一次才不會超出畫面。
    placeCard(point, mode);
  }

  // 降級後的畫面就是一張普通翻譯卡：標題換回「快速翻譯」，內容是純文字。
  // 刻意**不**在畫面上寫「詞典查詢失敗」——使用者要的是那個字的意思，
  // 而它就在眼前；那句話只會讓人以為有東西壞了。頻率記在診斷頁（DICT_FALLBACK）。
  function renderFallbackTranslation(holder, text) {
    setCardKind("translation");
    holder.textContent = text;
    holder.dataset.state = "ready";
  }

  // 詞典卡的 DOM。**每一個欄位都走 textContent**，一個 innerHTML 都沒有：
  // 這些字串全部來自模型，而模型的輸出等同外部輸入。
  function renderDictionaryEntry(holder, entry) {
    setCardKind("dictionary");
    holder.dataset.state = "ready";
    holder.textContent = "";
    const doc = holder.ownerDocument ?? document;
    const make = (tag, className, text) => {
      const node = doc.createElement(tag);
      node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };

    const root = make("div", "immersefree-dict");
    const head = make("div", "immersefree-dict-head");
    head.append(make("span", "immersefree-dict-word", entry.word));
    if (entry.phonetic) head.append(make("span", "immersefree-dict-phonetic", entry.phonetic));
    root.append(head);

    const parts = [entry.word];
    if (entry.phonetic) parts.push(entry.phonetic);

    const posList = Array.isArray(entry.pos) ? entry.pos.filter(Boolean) : [];
    if (posList.length) {
      const row = make("div", "immersefree-dict-pos");
      for (const pos of posList) row.append(make("span", "immersefree-dict-tag", pos));
      root.append(row);
      parts.push(posList.join(" / "));
    }

    const senses = Array.isArray(entry.senses) ? entry.senses.filter((sense) => sense?.def) : [];
    const list = make("ol", "immersefree-dict-senses");
    senses.forEach((sense, index) => {
      const item = make("li", "immersefree-dict-sense");
      item.append(make("div", "immersefree-dict-def", sense.def));
      parts.push(`${index + 1}. ${sense.def}`);
      if (sense.example) {
        item.append(make("div", "immersefree-dict-example", sense.example));
        parts.push(`   ${sense.example}`);
      }
      if (sense.exampleTranslation) {
        item.append(make("div", "immersefree-dict-example-translation", sense.exampleTranslation));
        parts.push(`   ${sense.exampleTranslation}`);
      }
      list.append(item);
    });
    root.append(list);

    if (entry.note) {
      root.append(make("div", "immersefree-dict-note", entry.note));
      parts.push(entry.note);
    }
    holder.append(root);
    copyText = parts.join("\n");
  }

  // 兩份快取共用同一套 LRU：先刪再寫（讓命中的那筆回到隊尾），
  // 滿了就從最舊的開始丟。
  function remember(store, key, value, limit) {
    store.delete(key);
    store.set(key, value);
    while (store.size > limit) store.delete(store.keys().next().value);
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
    card.setAttribute("data-immersefree-extension-root", "quick-translation");
    card.innerHTML = `
      <header><span class="immersefree-quick-title">${t("快速翻譯")}</span><button type="button" class="immersefree-quick-close" aria-label="${t("關閉翻譯卡")}">×</button></header>
      <div class="immersefree-quick-source"></div>
      <div class="immersefree-quick-translation" role="status"></div>
      <footer><button type="button" class="immersefree-quick-copy">${t("複製譯文")}</button></footer>`;
    card.querySelector(".immersefree-quick-close").addEventListener("click", () => {
      card.remove();
      shownText = "";
    });
    card.querySelector(".immersefree-quick-copy").addEventListener("click", async (event) => {
      // 詞典卡有多個欄位，攤成幾行的那一份存在 copyText；翻譯卡不設它，
      // 於是這裡與改動前一樣是讀 textContent。
      const value = copyText || card.querySelector(".immersefree-quick-translation").textContent;
      await navigator.clipboard.writeText(value);
      event.currentTarget.textContent = t("已複製");
      setTimeout(() => { event.currentTarget.textContent = copyLabel(); }, 1200);
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

  function removeSelectionButton() {
    selectionButton?.remove();
    selectionButton = undefined;
  }

  function isExtensionUi(node) {
    return Boolean(node?.closest?.("[data-immersefree-extension-root]"));
  }

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }
})(globalThis);
