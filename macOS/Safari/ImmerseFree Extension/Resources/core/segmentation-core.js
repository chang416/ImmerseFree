(function initializeSegmentationCore(global) {
  // 分段核心。
  //
  // 0.7.0 之前，網頁翻譯的候選只來自 14 個語意標籤
  // （h1..h6,p,li,blockquote,figcaption,dt,dd,td,th）。現代 SPA 幾乎不用它們：
  // 整篇文章可能全部塞在 div 與 span 裡，於是候選數是 0，使用者按下翻譯只會
  // 看到「找不到可翻譯的文字段落」。
  //
  // 這個檔把「哪些元素算一段」抽成純函式，做三件事：
  //   1. 語意標籤保留為快路徑（既有頁面行為逐字不變），TreeWalker 走文字節點
  //      沿 parent 上爬找最近的 block 類祖先來補漏。
  //   2. 字數門檻常數化並可覆寫（W3-2 的網站規則要靠參數傳入，不是硬編）。
  //   3. 重複結構偵測：同 parent 下 ≥N 個同指紋兄弟＝列表模式，替候選標上
  //      batchGroup 供批次層合併。**這裡只標記，不改批次協議本身。**
  //
  // 熱路徑成本：getComputedStyle 是這裡唯一昂貴的呼叫，所以每個元素只算一次
  // （createStyleCache），而且被語意快路徑蓋到的文字節點根本不進上爬流程。

  // 既有的 14 個語意標籤。順序與字串刻意與 0.7.0 一致：這條路徑收出來的
  // 元素、順序、文字都必須跟改動前逐字相同。
  const SEMANTIC_BLOCK_SELECTORS = "h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,dt,dd,td,th";

  // display 屬「自成一行」的值。inline-block / inline-flex / inline-grid 刻意
  // 不算：它們雖然是獨立的盒子，但在文字流裡是行內的，把它們當一段會把
  // 「粗體、連結、標籤」這種行內裝飾各自切成獨立段落送翻。
  const BLOCK_DISPLAY_VALUES = Object.freeze([
    "block",
    "flow-root",
    "list-item",
    "flex",
    "grid",
    "table",
    "table-row",
    "table-cell",
    "table-caption",
    "table-header-group",
    "table-footer-group",
    "table-row-group",
    "-webkit-box",
    "-webkit-flex"
  ]);
  const BLOCK_DISPLAY_SET = new Set(BLOCK_DISPLAY_VALUES);

  // 這些子樹整塊維持原文，連文字都不送進翻譯管線。
  // 公式被翻譯的結果通常是把 LaTeX 指令當英文單字亂譯，畫面直接壞掉；
  // pre 整塊（含 pre > code）同理，程式碼被翻成中文就不能執行了。
  // 行內的 <code> 不列入：那是 W2-2 富文本佔位符要處理的東西，這裡若一併
  // 剝掉，既有含行內 code 的段落送出的文字就會跟改動前不一樣。
  const STAY_ORIGINAL_SELECTORS = [
    "mjx-container",
    "mjx-math",
    "math",
    "annotation",
    "semantics",
    ".katex",
    ".katex-display",
    ".katex-mathml",
    ".MathJax",
    ".MathJax_Preview",
    ".mwe-math-element",
    ".mwe-math-fallback-image-inline",
    "[role='math']",
    "pre",
    "svg"
  ].join(",");

  // 這些節點不是內容：它們的文字不該進候選，TreeWalker 也不必往裡面走。
  // contenteditable 是新加的——使用者正在打字的欄位被插進譯文，游標會亂跳。
  const EXCLUDED_SELECTORS = [
    "script",
    "style",
    "noscript",
    "template",
    "title",
    "svg",
    "canvas",
    "input",
    "textarea",
    "select",
    "option",
    "optgroup",
    "button",
    "[contenteditable]:not([contenteditable='false'])",
    "[aria-hidden='true']",
    "[translate='no']",
    ".notranslate"
  ].join(",");

  const DEFAULT_SEGMENTATION_OPTIONS = Object.freeze({
    // 對方的 paragraphMinTextCount / paragraphMinWordCount 同一組門檻。
    // 預設值刻意等於 0.7.0 寫死的那兩個數字，換掉實作不換掉行為。
    minTextCount: 2,
    maxTextCount: 1800,
    minWordCount: 0,
    // 同 parent 下同指紋兄弟達到這個數量才算「列表模式」。
    batchPatternMinCount: 3,
    enableBatchPatternDetection: true,
    // 從候選往上找列表單位時最多爬幾層。爬太深會把整個頁面框架當成列表。
    batchPatternMaxDepth: 8,
    blockSelectors: SEMANTIC_BLOCK_SELECTORS,
    stayOriginalSelectors: STAY_ORIGINAL_SELECTORS,
    excludeSelectors: EXCLUDED_SELECTORS,
    // 行內富文本（W2-2）。放在這裡而不是另開一組設定：per-site 覆寫的入口
    // 已經是 settings.segmentation，富文本的門檻跟分段門檻是同一類東西
    // （「這一段要怎麼送出去」），拆兩處只會讓 W3-2 要記兩個地方。
    enableRichText: true,
    maxRichDepth: 2,
    maxRichMarks: 12,
    // W3-2 的網站規則用這三個欄位做疊加（.add 語意），不是整組覆蓋。
    extraBlockSelectors: "",
    extraInlineSelectors: "",
    extraStayOriginalSelectors: "",
    extraExcludeSelectors: ""
  });

  // 兄弟指紋要忽略的狀態 class：同一批卡片裡只有被選中的那張多一個
  // `active`，不濾掉的話 100 張卡片會被拆成 99 + 1 兩組。
  const VOLATILE_CLASS_NAMES = new Set([
    "active", "selected", "current", "open", "opened", "expanded", "collapsed",
    "checked", "disabled", "highlighted", "highlight", "first", "last",
    "odd", "even", "hover", "focus", "focused", "visited", "loading", "hidden"
  ]);

  function joinSelectors(...parts) {
    return parts
      .map((part) => String(part ?? "").trim())
      .filter(Boolean)
      .join(",");
  }

  function resolveSegmentationOptions(overrides) {
    const merged = { ...DEFAULT_SEGMENTATION_OPTIONS };
    for (const [key, value] of Object.entries(overrides ?? {})) {
      if (value === undefined || value === null) continue;
      if (!(key in DEFAULT_SEGMENTATION_OPTIONS)) continue;
      merged[key] = value;
    }
    merged.minTextCount = toCount(merged.minTextCount, DEFAULT_SEGMENTATION_OPTIONS.minTextCount);
    merged.maxTextCount = toCount(merged.maxTextCount, DEFAULT_SEGMENTATION_OPTIONS.maxTextCount);
    merged.minWordCount = toCount(merged.minWordCount, DEFAULT_SEGMENTATION_OPTIONS.minWordCount);
    merged.batchPatternMinCount = Math.max(2, toCount(merged.batchPatternMinCount, DEFAULT_SEGMENTATION_OPTIONS.batchPatternMinCount));
    merged.batchPatternMaxDepth = Math.max(1, toCount(merged.batchPatternMaxDepth, DEFAULT_SEGMENTATION_OPTIONS.batchPatternMaxDepth));
    merged.enableBatchPatternDetection = merged.enableBatchPatternDetection !== false;
    merged.enableRichText = merged.enableRichText !== false;
    merged.maxRichDepth = Math.max(1, toCount(merged.maxRichDepth, DEFAULT_SEGMENTATION_OPTIONS.maxRichDepth));
    merged.maxRichMarks = Math.max(1, toCount(merged.maxRichMarks, DEFAULT_SEGMENTATION_OPTIONS.maxRichMarks));
    // 疊加後的實際選擇器另存三個欄位，呼叫端只看這三個，不必自己再拼一次。
    merged.resolvedBlockSelectors = joinSelectors(merged.blockSelectors, merged.extraBlockSelectors);
    merged.resolvedStayOriginalSelectors = joinSelectors(merged.stayOriginalSelectors, merged.extraStayOriginalSelectors);
    merged.resolvedExcludeSelectors = joinSelectors(merged.excludeSelectors, merged.extraExcludeSelectors);
    return Object.freeze(merged);
  }

  function toCount(value, fallback) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  // 詞數。拉丁語系用空白切；中日韓沒有空白，一個字就算一個詞，
  // 否則整段中文永遠只算 1 詞，minWordCount 一開就把整頁擋光。
  const CJK_PATTERN = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/gu;
  function countWords(value) {
    const text = cleanText(value);
    if (!text) return 0;
    const cjk = text.match(CJK_PATTERN)?.length ?? 0;
    const rest = text.replace(CJK_PATTERN, " ");
    const latin = rest.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
    return cjk + latin;
  }

  function meetsTextThreshold(text, options) {
    const resolved = options ?? DEFAULT_SEGMENTATION_OPTIONS;
    const value = String(text ?? "");
    if (value.length < resolved.minTextCount) return false;
    if (value.length > resolved.maxTextCount) return false;
    if (resolved.minWordCount > 0 && countWords(value) < resolved.minWordCount) return false;
    return true;
  }

  // getComputedStyle 一個元素只算一次。上爬會反覆碰到同一批祖先，
  // 沒有這層快取的話 5000 節點的頁面很容易呼叫上萬次，捲一次就卡一次。
  function createStyleCache(defaultView) {
    const cache = new Map();
    let calls = 0;
    function styleOf(element) {
      const cached = cache.get(element);
      if (cached) return cached;
      let record = { display: "", visibility: "" };
      calls += 1;
      try {
        const view = element?.ownerDocument?.defaultView ?? defaultView ?? global;
        const style = view.getComputedStyle(element);
        record = {
          display: String(style?.display ?? ""),
          visibility: String(style?.visibility ?? "")
        };
      } catch {
        // 元素已經從文件移除時 getComputedStyle 會丟例外或回空值。
        // 當作「量不到」處理，讓呼叫端往上再找一層。
      }
      cache.set(element, record);
      return record;
    }
    return {
      styleOf,
      displayOf: (element) => styleOf(element).display,
      get calls() { return calls; },
      get size() { return cache.size; },
      clear() { cache.clear(); }
    };
  }

  // display 可能是新的雙值語法（"block flow"）。取第一個 token 判斷就好。
  function isBlockDisplayValue(value) {
    const first = String(value ?? "").trim().split(/\s+/)[0];
    return BLOCK_DISPLAY_SET.has(first);
  }

  function safeMatches(element, selector) {
    if (!element || typeof element.matches !== "function" || !selector) return false;
    try {
      return element.matches(selector);
    } catch {
      return false;
    }
  }

  function safeClosest(element, selector) {
    if (!element || typeof element.closest !== "function" || !selector) return null;
    try {
      return element.closest(selector);
    } catch {
      return null;
    }
  }

  function isStayOriginal(element, options) {
    const resolved = options ?? DEFAULT_SEGMENTATION_OPTIONS;
    const selector = resolved.resolvedStayOriginalSelectors ?? resolved.stayOriginalSelectors;
    return Boolean(safeClosest(element, selector));
  }

  function isExcludedElement(element, options) {
    const resolved = options ?? DEFAULT_SEGMENTATION_OPTIONS;
    const selector = resolved.resolvedExcludeSelectors ?? resolved.excludeSelectors;
    return Boolean(safeClosest(element, selector));
  }

  function isVisibleElement(element, styleCache) {
    const style = styleCache
      ? styleCache.styleOf(element)
      : { display: "", visibility: "" };
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect) return true;
    return rect.width > 0 && rect.height > 0;
  }

  // 送出去的文字。
  //
  // 沒有公式/程式碼子樹時原樣走 innerText || textContent——這是 0.7.0 的行為，
  // 一個字都不能變（既有頁面的候選內容要逐字相同）。有的話才逐節點走一次，
  // 把 stay-original 的子樹整塊跳過，模型就看不到那些內容。
  function extractSegmentText(element, options) {
    if (!element) return "";
    const resolved = options ?? DEFAULT_SEGMENTATION_OPTIONS;
    const selector = resolved.resolvedStayOriginalSelectors ?? resolved.stayOriginalSelectors;
    let contained = null;
    try {
      contained = element.querySelector?.(selector) ?? null;
    } catch {
      contained = null;
    }
    if (!contained) return cleanText(element.innerText || element.textContent);
    let output = "";
    const visit = (node) => {
      const children = node.childNodes ?? [];
      for (const child of children) {
        if (child.nodeType === 1) {
          if (safeMatches(child, selector)) continue;
          visit(child);
        } else if (child.nodeType === 3) {
          output += child.nodeValue ?? "";
        }
      }
    };
    visit(element);
    return cleanText(output);
  }

  // 送出去的「中間表示」（W2-2）。
  //
  // extractSegmentText 回傳的是純文字，它的輸出**一個字都不能變**（W2-1 有
  // 逐字回歸測試，改了會讓既有頁面的候選內容漂移）。所以富文本不是改它，
  // 而是在它外面包一層：純文字仍然由它算，行內標記由 rich-text-core 序列化。
  //
  // 回傳形狀對純文字段落與富文本段落是同一個：
  //   { text, plainText, marks, rich }
  // 純文字段落的 text === plainText、marks === []、rich === false，所以呼叫端
  // 不必分兩條路走，也不會為了沒有標記的段落付出任何額外成本
  //   （沒有行內標籤時 rich-text-core 直接回傳傳進去的 plainText）。
  //
  // 依賴方向刻意是 segmentation → rich-text（不是反過來）：rich-text-core 需要
  // 純文字基準線，由這裡當參數餵給它，兩邊就不會各自算出一份純文字。
  // 沒載到 rich-text-core（舊分頁、只載部分腳本）時原樣退回純文字。
  function extractSegmentParts(element, options) {
    const resolved = options ?? DEFAULT_SEGMENTATION_OPTIONS;
    const plainText = extractSegmentText(element, resolved);
    const richCore = global.ImmerseFreeRichTextCore;
    if (!richCore || resolved.enableRichText === false) {
      return { text: plainText, plainText, marks: [], rich: false };
    }
    const result = richCore.serializeRichText(element, {
      plainText,
      enableRichText: resolved.enableRichText,
      maxRichDepth: resolved.maxRichDepth,
      maxRichMarks: resolved.maxRichMarks,
      stayOriginalSelectors: resolved.resolvedStayOriginalSelectors ?? resolved.stayOriginalSelectors
    });
    return {
      text: result.text,
      plainText,
      marks: result.marks,
      rich: result.rich
    };
  }

  function hasMeaningfulText(value) {
    return /[\p{L}\p{N}]/u.test(String(value ?? ""));
  }

  // 從文字節點的父元素往上找最近的 block 類祖先。
  //
  // 沿路每個元素都記進 blockCache（路徑壓縮）：同一個 div 底下有 20 個 span，
  // 第一個 span 爬完之後，其餘 19 個只需要算它們自己那一次。
  function nearestBlockAncestor(start, root, ctx) {
    const { styleCache, options, blockCache } = ctx;
    const extraBlock = options.extraBlockSelectors;
    const extraInline = options.extraInlineSelectors;
    const path = [];
    let element = start;
    let found = null;
    while (element) {
      const cached = blockCache.get(element);
      if (cached !== undefined) {
        found = cached;
        break;
      }
      if (extraInline && safeMatches(element, extraInline)) {
        path.push(element);
      } else if ((extraBlock && safeMatches(element, extraBlock))
        || isBlockDisplayValue(styleCache.displayOf(element))) {
        found = element;
        break;
      } else {
        path.push(element);
      }
      if (element === root) break;
      element = element.parentElement;
    }
    // 一路爬到 root 都沒有 block（整棵子樹都被設成 inline）就用 root 本身，
    // 寧可把整塊當一段，也不要因為量不到而整段漏掉。
    if (!found) found = root;
    for (const node of path) blockCache.set(node, found);
    blockCache.set(found, found);
    return found;
  }

  function createSegmentationContext(overrides, view) {
    const options = resolveSegmentationOptions(overrides);
    return {
      options,
      styleCache: createStyleCache(view ?? global),
      blockCache: new Map()
    };
  }

  // 收集這個 root 底下所有「翻譯單位」元素，文件順序。
  //
  // 兩條路線合併：
  //   fast  = 既有 14 個語意標籤（querySelectorAll，順序與 0.7.0 相同）
  //   extra = TreeWalker 走文字節點 → 最近 block 祖先，且該文字沒有被
  //           任何語意標籤蓋到（closest 判斷，這一步不花 getComputedStyle）
  // 合併後把「祖先」讓給「後代」：extra 若包住任何已收集的元素就丟掉它，
  // 否則同一段文字會被父容器與子段落各送一次。
  function collectBlockElements(root, ctx) {
    if (!root || typeof root.querySelectorAll !== "function") return [];
    const { options } = ctx;
    const fast = [...root.querySelectorAll(options.blockSelectors)];
    const extras = walkExtraBlocks(root, ctx, new Set(fast));
    if (!extras.length) return fast;

    const extraSet = new Set(extras);
    const union = new Set([...fast, ...extras]);
    // 祖先讓後代。只淘汰 extra：語意標籤之間的巢狀（blockquote > p）維持
    // 0.7.0 的處理方式，交給呼叫端的「同文字只留第一個」去重。
    for (const element of union) {
      let parent = element.parentElement;
      while (parent && parent !== root.parentElement) {
        if (extraSet.has(parent)) union.delete(parent);
        if (parent === root) break;
        parent = parent.parentElement;
      }
    }
    return [...union].sort(compareDocumentOrder);
  }

  function compareDocumentOrder(a, b) {
    if (a === b) return 0;
    const position = a.compareDocumentPosition?.(b) ?? 0;
    // 4 = DOCUMENT_POSITION_FOLLOWING、2 = PRECEDING。
    if (position & 4) return -1;
    if (position & 2) return 1;
    return 0;
  }

  function walkExtraBlocks(root, ctx, fastSet) {
    const doc = root.ownerDocument ?? root;
    if (typeof doc.createTreeWalker !== "function") return [];
    const view = doc.defaultView ?? global;
    const filter = view.NodeFilter ?? global.NodeFilter;
    if (!filter) return [];
    const { options } = ctx;
    const excludeSelector = options.resolvedExcludeSelectors;
    const stayOriginalSelector = options.resolvedStayOriginalSelectors;
    const semanticSelector = options.blockSelectors;
    const extras = [];
    const seenBlocks = new Set();
    let walker;
    try {
      walker = doc.createTreeWalker(root, filter.SHOW_TEXT, {
        acceptNode(node) {
          return hasMeaningfulText(node.nodeValue) ? filter.FILTER_ACCEPT : filter.FILTER_REJECT;
        }
      });
    } catch {
      return [];
    }
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent) continue;
      // 語意快路徑已經收過這塊文字，連上爬都不必——這一步是把
      // getComputedStyle 的呼叫量壓下來的關鍵，它只用 closest，不碰樣式。
      const semantic = safeClosest(parent, semanticSelector);
      if (semantic && fastSet.has(semantic)) continue;
      if (safeClosest(parent, stayOriginalSelector)) continue;
      if (safeClosest(parent, excludeSelector)) continue;
      const block = nearestBlockAncestor(parent, root, ctx);
      if (!block || fastSet.has(block) || seenBlocks.has(block)) continue;
      seenBlocks.add(block);
      extras.push(block);
    }
    return extras;
  }

  // ---------------------------------------------------------------- 重複結構

  function normalizeClassNames(element) {
    const raw = typeof element?.getAttribute === "function"
      ? element.getAttribute("class")
      : element?.className;
    return String(raw ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .filter((name) => !VOLATILE_CLASS_NAMES.has(name.toLowerCase()))
      .sort();
  }

  function structureFingerprint(element) {
    if (!element?.tagName) return "";
    const tag = String(element.tagName).toLowerCase();
    const classes = normalizeClassNames(element);
    return classes.length ? `${tag}.${classes.join(".")}` : tag;
  }

  function fingerprintOf(element, cache) {
    let value = cache.get(element);
    if (value === undefined) {
      value = structureFingerprint(element);
      cache.set(element, value);
    }
    return value;
  }

  function siblingRepeatCount(element, caches) {
    const parent = element?.parentElement;
    if (!parent) return 0;
    let counts = caches.siblings.get(parent);
    if (!counts) {
      counts = new Map();
      for (const child of parent.children ?? []) {
        const print = fingerprintOf(child, caches.fingerprints);
        counts.set(print, (counts.get(print) ?? 0) + 1);
      }
      caches.siblings.set(parent, counts);
    }
    return counts.get(fingerprintOf(element, caches.fingerprints)) ?? 0;
  }

  // 從候選往上找「重複單位」：第一個在自己這一層有 ≥N 個同指紋兄弟的祖先。
  // 商品列表就是那張卡片、留言串就是那則留言。
  function repeatUnitFor(element, caches, options) {
    let node = element;
    for (let depth = 0; node && depth < options.batchPatternMaxDepth; depth += 1) {
      if (siblingRepeatCount(node, caches) >= options.batchPatternMinCount) return node;
      node = node.parentElement;
    }
    return null;
  }

  function relativePathFingerprint(element, unit, caches) {
    const parts = [];
    let node = element;
    while (node && node !== unit) {
      parts.push(fingerprintOf(node, caches.fingerprints));
      node = node.parentElement;
    }
    return parts.reverse().join(">");
  }

  // 替候選標上 batchGroup。同一個 batchGroup 代表「列表裡角色相同的那一格」
  // ——100 張卡片的標題是一組、內文是另一組。批次層之後可以拿它把同質段落
  // 併成一次請求；這裡只標記，批次協議本身完全沒有動。
  function assignBatchGroups(items, options) {
    const resolved = options ?? DEFAULT_SEGMENTATION_OPTIONS;
    const list = [...(items ?? [])];
    if (!resolved.enableBatchPatternDetection) {
      return list.map((item) => ({ ...item, batchGroup: null }));
    }
    const caches = { fingerprints: new Map(), siblings: new Map() };
    const containerIds = new Map();
    return list.map((item) => {
      const element = item?.element;
      if (!element) return { ...item, batchGroup: null };
      const unit = repeatUnitFor(element, caches, resolved);
      if (!unit) return { ...item, batchGroup: null };
      const container = unit.parentElement;
      if (!container) return { ...item, batchGroup: null };
      let containerId = containerIds.get(container);
      if (!containerId) {
        containerId = `L${containerIds.size + 1}`;
        containerIds.set(container, containerId);
      }
      const unitPrint = fingerprintOf(unit, caches.fingerprints);
      const path = relativePathFingerprint(element, unit, caches);
      return { ...item, batchGroup: `${containerId}:${unitPrint}${path ? `>${path}` : ""}` };
    });
  }

  const segmentationCore = Object.freeze({
    SEMANTIC_BLOCK_SELECTORS,
    STAY_ORIGINAL_SELECTORS,
    EXCLUDED_SELECTORS,
    BLOCK_DISPLAY_VALUES,
    DEFAULT_SEGMENTATION_OPTIONS,
    resolveSegmentationOptions,
    createSegmentationContext,
    createStyleCache,
    isBlockDisplayValue,
    isStayOriginal,
    isExcludedElement,
    isVisibleElement,
    extractSegmentText,
    extractSegmentParts,
    collectBlockElements,
    nearestBlockAncestor,
    countWords,
    meetsTextThreshold,
    structureFingerprint,
    assignBatchGroups,
    cleanText
  });
  global.ImmerseFreeSegmentationCore = segmentationCore;
  if (typeof module !== "undefined" && module.exports) module.exports = segmentationCore;
})(globalThis);
