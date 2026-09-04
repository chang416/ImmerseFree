(function initializeRichTextCore(global) {
  // 行內富文本保留（W2-2）。
  //
  // 0.7.0 之前，網頁翻譯讀 innerText、寫 textContent：一段話裡的連結、粗體、
  // 行內 code 在譯文裡全部被壓成純文字。使用者看到的是「譯文可讀，但點不到
  // 任何連結」——而且沒有任何錯誤訊息，因為翻譯本身是成功的。
  //
  // 做法是「佔位符 ＋ 硬校驗」：
  //   序列化：<a href=…>docs</a>  →  送給模型的是 ⟦1⟧docs⟦/1⟧
  //           **屬性一個字都不送**（href/title/target/class 留在原節點上），
  //           還原時從原節點取回。省 token，也不讓模型有機會改掉網址。
  //   還原：模型回來的字串重新解析成節點樹。集合、配對、開啟順序、父子關係
  //         四項任何一項對不上，就**整段退回純文字譯文**（去掉佔位符），
  //         並記一筆 RICHTEXT_FALLBACK。
  //
  // 對手（沈浸式翻譯）的 AI 路線是在 prompt 裡叫模型「保留 HTML 標籤」，
  // 自承偶爾標籤位置會跑掉、沒有硬保證。我方給得出的保證是：
  // **畫面上要嘛是正確的富文本，要嘛是正確的純文字，不會是破碎的標記。**
  //
  // 這個檔是純函式：serialize 只讀 DOM（不改），restore 完全不碰 DOM，
  // 只有 buildTranslationFragment 會建節點，而它拿 document 當參數。

  // ---------------------------------------------------------------- 佔位符字元
  //
  // U+27E6 / U+27E7（MATHEMATICAL WHITE SQUARE BRACKET）。挑選理由：
  //   1. NFKC 正規化不會改變它們（page-translation-cache 的 key 會做 NFKC，
  //      被正規化掉的話快取鍵會跟送出的內容對不起來）。
  //   2. 一般網頁內文幾乎不會出現，Markdown／JSON／程式碼也不用它們，
  //      所以不會跟原文自己的字元撞在一起。
  //   3. 不是 ASCII，模型不會把它當成需要翻譯或需要補全的括號。
  const OPEN_CHAR = "⟦";
  const CLOSE_CHAR = "⟧";
  // 「合法佔位符」的唯一定義。⟦1⟧ 開、⟦/1⟧ 關。
  const TOKEN_PATTERN = /⟦(\/?)(\d{1,3})⟧/g;
  const ANY_BRACKET_PATTERN = /[⟦⟧]/;

  function openToken(id) {
    return `${OPEN_CHAR}${id}${CLOSE_CHAR}`;
  }

  function closeToken(id) {
    return `${OPEN_CHAR}/${id}${CLOSE_CHAR}`;
  }

  // ---------------------------------------------------------------- 白名單
  //
  // 只有「純行內裝飾」進白名單。每個標籤各自列出可以原樣保留的屬性，
  // 白名單以外的屬性一律丟掉（原節點上有 onclick 之類的東西時，
  // 重建出來的節點不會把它帶過去）。
  //
  // span 只留 class：網站的行內樣式幾乎都掛在 class 上，而 style/id 帶過來
  // 只會讓譯文長出跟原文重複的 id。
  const RICH_INLINE_TAGS = Object.freeze({
    a: Object.freeze(["href", "title", "target", "rel"]),
    b: Object.freeze([]),
    strong: Object.freeze([]),
    i: Object.freeze([]),
    em: Object.freeze([]),
    code: Object.freeze([]),
    u: Object.freeze([]),
    s: Object.freeze([]),
    sup: Object.freeze([]),
    sub: Object.freeze([]),
    span: Object.freeze(["class"])
  });

  const RICH_INLINE_TAG_LIST = Object.freeze(Object.keys(RICH_INLINE_TAGS));

  const DEFAULT_RICH_TEXT_OPTIONS = Object.freeze({
    enableRichText: true,
    // 巢狀允許兩層：<a><b>粗體連結</b></a> 兩層都保留，第三層以下只留文字。
    // 再深的巢狀對譯文外觀幾乎沒有影響，卻會讓模型要顧的佔位符數量爆增。
    maxRichDepth: 2,
    // 一段最多幾個佔位符。這個上限同時是**送出字數的護欄**：
    // 分段門檻是 1800 字，12 組佔位符最多加 90 字（⟦10⟧ 這種兩位數 id
    // 開＋關 9 字），1890 < 背景頁 validateSegments 的 2000 字上限。
    // 超過就整段退回純文字——標記多到這種程度的段落本來也不像一段話。
    maxRichMarks: 12,
    // 與 segmentation-core 同一組公式／程式碼選擇器。這裡要一模一樣，
    // 否則序列化出來的文字會跟 extractSegmentText 不同，整段被判定成漂移。
    stayOriginalSelectors: ""
  });

  function resolveRichTextOptions(overrides) {
    const merged = { ...DEFAULT_RICH_TEXT_OPTIONS };
    for (const [key, value] of Object.entries(overrides ?? {})) {
      if (value === undefined || value === null) continue;
      if (!(key in DEFAULT_RICH_TEXT_OPTIONS)) continue;
      merged[key] = value;
    }
    merged.maxRichDepth = toCount(merged.maxRichDepth, DEFAULT_RICH_TEXT_OPTIONS.maxRichDepth, 1);
    merged.maxRichMarks = toCount(merged.maxRichMarks, DEFAULT_RICH_TEXT_OPTIONS.maxRichMarks, 1);
    merged.enableRichText = merged.enableRichText !== false;
    return merged;
  }

  function toCount(value, fallback, minimum = 0) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number >= minimum ? number : fallback;
  }

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function hasMeaningfulText(value) {
    return /[\p{L}\p{N}]/u.test(String(value ?? ""));
  }

  function hasPlaceholders(value) {
    return ANY_BRACKET_PATTERN.test(String(value ?? ""));
  }

  // 去掉所有佔位符。**退回純文字時走的就是這一支**，所以它必須把
  // 「合法佔位符」與「模型自己亂加的半個括號」一起清掉——留半個在畫面上，
  // 使用者看到的就是破碎標記，那正是這整個機制要避免的事。
  function stripPlaceholders(value) {
    // 刻意用自己的正規式字面量，不共用 TOKEN_PATTERN：那一支帶 /g，
    // restoreRichText 正在用 exec 逐個掃描時如果被這裡動到 lastIndex，
    // 掃描會從半路重新開始——症狀是「偶爾」誤判，最難查的那一種。
    return String(value ?? "")
      .replace(/⟦(?:\/?)\d{1,3}⟧/g, "")
      .replace(/[⟦⟧]/g, "");
  }

  function safeMatches(element, selector) {
    if (!element || typeof element.matches !== "function" || !selector) return false;
    try {
      return element.matches(selector);
    } catch {
      return false;
    }
  }

  function tagNameOf(node) {
    return String(node?.tagName ?? "").toLowerCase();
  }

  function attributesFor(element, tag) {
    const allowed = RICH_INLINE_TAGS[tag] ?? [];
    const attributes = {};
    if (typeof element?.getAttribute !== "function") return attributes;
    for (const name of allowed) {
      const value = element.getAttribute(name);
      if (value === null || value === undefined) continue;
      const text = String(value);
      if (!text) continue;
      attributes[name] = text;
    }
    return attributes;
  }

  // ---------------------------------------------------------------- 中間表示
  //
  // 序列化分兩趟，因為 id 必須照「文件順序」由 1 編到 N，而「這個元素要不要
  // 變成佔位符」要看它的子樹裡有沒有真正的文字。一趟做完的話，父層被淘汰時
  // 已經把 id 發出去了，子層的 id 反而比父層小——開啟順序就不再遞增，
  // 而遞增正是還原時最好驗的一條規則。
  //
  // 第一趟：把 DOM 攤成一棵只有 text / element 的樹，順便標記 keep。
  // 第二趟：照前序走一次，發 id、吐字串、收 marks。
  function buildNodeTree(element, options) {
    const selector = options.stayOriginalSelectors;
    const root = { type: "root", children: [] };
    const visit = (node, target, depth) => {
      const children = node?.childNodes ?? [];
      for (const child of children) {
        if (child.nodeType === 3) {
          target.children.push({ type: "text", value: String(child.nodeValue ?? "") });
          continue;
        }
        if (child.nodeType !== 1) continue;
        // 公式／程式碼整塊跳過。這一條必須與 segmentation-core.extractSegmentText
        // 完全一致，否則兩邊算出來的文字不同，序列化會被判定成漂移而整段退回。
        if (selector && safeMatches(child, selector)) continue;
        const tag = tagNameOf(child);
        if (tag === "br") {
          // innerText 會把 <br> 算成換行，cleanText 之後是一個空白。
          // 這裡補一個空白，才對得上 extractSegmentText 的輸出。
          target.children.push({ type: "text", value: " " });
          continue;
        }
        const node = {
          type: "element",
          tag,
          attributes: {},
          eligible: false,
          children: []
        };
        visit(child, node, depth + 1);
        const inline = Object.prototype.hasOwnProperty.call(RICH_INLINE_TAGS, tag);
        node.eligible = inline
          && depth < options.maxRichDepth
          && hasMeaningfulText(plainOf(node));
        if (node.eligible) node.attributes = attributesFor(child, tag);
        target.children.push(node);
      }
    };
    visit(element, root, 0);
    return root;
  }

  function plainOf(node) {
    let output = "";
    for (const child of node.children ?? []) {
      if (child.type === "text") output += child.value;
      else output += plainOf(child);
    }
    return output;
  }

  function countEligible(node) {
    let total = 0;
    for (const child of node.children ?? []) {
      if (child.type !== "element") continue;
      if (child.eligible) total += 1;
      total += countEligible(child);
    }
    return total;
  }

  // 前序發 id、吐字串。marks 帶 parentId：還原時要用它比對父子關係，
  // 「兩個相鄰的標記被模型改成互相包住」也算對不上。
  function emit(node, marks, parentId) {
    let output = "";
    for (const child of node.children ?? []) {
      if (child.type === "text") {
        output += child.value;
        continue;
      }
      if (!child.eligible) {
        output += emit(child, marks, parentId);
        continue;
      }
      const id = marks.length + 1;
      marks.push({
        id,
        tag: child.tag,
        attributes: child.attributes,
        parentId
      });
      output += openToken(id) + emit(child, marks, id) + closeToken(id);
    }
    return output;
  }

  // 佔位符緊貼著空白時，把空白挪到標記外面。
  // 「⟦1⟧ 連結 ⟦/1⟧」還原之後 <a> 裡面會多出前後空白，底線會比文字長一截；
  // 而且 cleanText 之後的比對也會因為這些空白而對不上原文。
  function tidyWhitespace(value) {
    return String(value ?? "")
      .replace(/(⟦\d{1,3}⟧)(\s+)/g, "$2$1")
      .replace(/(\s+)(⟦\/\d{1,3}⟧)/g, "$2$1");
  }

  // ---------------------------------------------------------------- 序列化
  //
  // 回傳一律含 text（要送給模型的那一串）與 marks。rich=false 時 text 就是
  // 純文字，marks 是空陣列——呼叫端不必分兩條路走。
  //
  // plainText 由呼叫端傳進來（segmentation-core.extractSegmentText 的輸出）。
  // 這是刻意的：那一支是「送出文字」的唯一出口，W2-1 有逐字回歸測試守著，
  // 這裡再自己算一份純文字的話，兩份遲早分岔。
  function serializeRichText(element, overrides = {}) {
    const options = resolveRichTextOptions(overrides);
    const plainText = typeof overrides.plainText === "string"
      ? overrides.plainText
      : cleanText(element?.innerText || element?.textContent);
    const plain = { rich: false, text: plainText, plainText, marks: [], reason: "" };
    if (!options.enableRichText) return { ...plain, reason: "disabled" };
    if (!element || typeof element !== "object") return { ...plain, reason: "no-element" };
    const tree = buildNodeTree(element, options);
    const eligible = countEligible(tree);
    if (!eligible) return { ...plain, reason: "no-inline" };
    // 標記太多：退回純文字。理由見 maxRichMarks 的註解（送出字數護欄）。
    if (eligible > options.maxRichMarks) return { ...plain, reason: "too-many-marks" };
    const marks = [];
    const text = cleanText(tidyWhitespace(emit(tree, marks, 0)));
    if (!marks.length) return { ...plain, reason: "no-inline" };
    // 最後一道自檢：把佔位符拿掉之後，必須跟 extractSegmentText 的輸出**逐字
    // 相同**。對不上就代表這一段的 innerText 與節點走訪結果有落差
    // （隱藏元素、被 CSS 插入的內容、奇怪的空白處理），這種段落一旦走富文本
    // 就會改變送給模型的內容——寧可不做，也不要偷偷換掉送出的原文。
    if (cleanText(stripPlaceholders(text)) !== plainText) {
      return { ...plain, reason: "text-drift" };
    }
    return { rich: true, text, plainText, marks, reason: "" };
  }

  // ---------------------------------------------------------------- 還原
  //
  // 四道硬校驗，任一不過就整段退回純文字：
  //   1. 集合：出現的 id 必須恰好等於 marks 的 id 集合（不能少、不能多）。
  //   2. 配對：每個 id 剛好一開一關，且必須是良好巢狀（不能交叉）。
  //   3. 順序：開啟順序必須是 1,2,3,…,N（marks 就是照文件順序編號的）。
  //   4. 父子：每個標記的父標記必須跟原文一樣（相鄰的兩個標記不能被改成
  //      互相包住——那會讓連結把粗體整段吞進去）。
  //
  // 另外，字串裡不准剩下任何一個 ⟦ 或 ⟧。模型自己造出來的半個括號會直接
  // 顯示在畫面上，那正是這個機制存在的理由。
  function restoreRichText(translatedText, marks, overrides = {}) {
    const options = resolveRichTextOptions(overrides);
    const list = Array.isArray(marks) ? marks : [];
    const raw = String(translatedText ?? "");
    const fallback = (reason) => ({
      ok: false,
      mode: "plain",
      nodes: [],
      text: cleanText(stripPlaceholders(raw)),
      reason
    });
    if (!list.length) {
      // 本來就沒有標記。這不是失敗，是純文字段落的正常路徑。
      if (hasPlaceholders(raw)) return fallback("unexpected-placeholder");
      return { ok: true, mode: "plain", nodes: [], text: cleanText(raw), reason: "" };
    }
    const byId = new Map(list.map((mark) => [mark.id, mark]));
    const root = { type: "root", id: 0, children: [] };
    const stack = [root];
    const opened = [];
    const closed = new Set();
    let cursor = 0;
    let match;
    TOKEN_PATTERN.lastIndex = 0;
    while ((match = TOKEN_PATTERN.exec(raw)) !== null) {
      const [token, slash, digits] = match;
      const id = Number(digits);
      const before = raw.slice(cursor, match.index);
      cursor = match.index + token.length;
      if (before) stack[stack.length - 1].children.push({ type: "text", value: before });
      if (!slash) {
        if (!byId.has(id)) return fallback("unknown-id");
        if (opened.includes(id)) return fallback("duplicate-open");
        if (id !== opened.length + 1) return fallback("out-of-order");
        const parent = stack[stack.length - 1];
        if ((byId.get(id).parentId ?? 0) !== (parent.id ?? 0)) return fallback("nesting-changed");
        const node = { type: "mark", id, children: [] };
        parent.children.push(node);
        stack.push(node);
        opened.push(id);
        continue;
      }
      const top = stack[stack.length - 1];
      if (top.type !== "mark") return fallback("unbalanced");
      if (top.id !== id) return fallback("crossed");
      if (closed.has(id)) return fallback("duplicate-close");
      closed.add(id);
      stack.pop();
    }
    const tail = raw.slice(cursor);
    if (tail) stack[stack.length - 1].children.push({ type: "text", value: tail });
    if (stack.length !== 1) return fallback("unclosed");
    if (opened.length !== list.length) return fallback("missing");
    if (closed.size !== list.length) return fallback("missing-close");
    // 合法佔位符都吃掉了，還剩括號字元就是模型自己造的殘骸。
    if (ANY_BRACKET_PATTERN.test(rebuildPlain(root))) return fallback("stray-bracket");
    const nodes = normalizeWhitespace(root.children);
    if (!hasMeaningfulText(rebuildPlain(root))) return fallback("empty");
    return { ok: true, mode: "rich", nodes, text: cleanText(stripPlaceholders(raw)), reason: "" };
  }

  function rebuildPlain(node) {
    let output = "";
    for (const child of node.children ?? []) {
      if (child.type === "text") output += child.value;
      else output += rebuildPlain(child);
    }
    return output;
  }

  // 模型回來的字串裡連續空白照樣要收斂（純文字路徑走的是 cleanText，
  // 兩條路必須看起來一樣）。整棵樹只在最前面 trimStart、最後面 trimEnd。
  function normalizeWhitespace(children) {
    const mapped = (list) => list.map((node) => (
      node.type === "text"
        ? { type: "text", value: String(node.value).replace(/\s+/g, " ") }
        : { type: "mark", id: node.id, children: mapped(node.children ?? []) }
    ));
    const nodes = mapped(children ?? []);
    const first = firstTextNode(nodes);
    if (first) first.value = first.value.replace(/^\s+/, "");
    const last = lastTextNode(nodes);
    if (last) last.value = last.value.replace(/\s+$/, "");
    return nodes;
  }

  function firstTextNode(nodes) {
    for (const node of nodes) {
      if (node.type === "text") return node;
      const inner = firstTextNode(node.children ?? []);
      if (inner) return inner;
    }
    return null;
  }

  function lastTextNode(nodes) {
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      if (node.type === "text") return node;
      const inner = lastTextNode(node.children ?? []);
      if (inner) return inner;
    }
    return null;
  }

  // ---------------------------------------------------------------- 建節點
  //
  // 這是整個模組唯一會碰 DOM 的地方，而且只用 createElement／createTextNode／
  // setAttribute／append 四支 API——沒有 innerHTML，模型回來的內容一律以
  // **文字節點**的身分進入畫面，不可能被當成標記解析。
  // 屬性一律取自原節點（marks.attributes），模型碰不到。
  function buildTranslationFragment(nodes, marks, doc) {
    const byId = new Map((Array.isArray(marks) ? marks : []).map((mark) => [mark.id, mark]));
    const fragment = doc.createDocumentFragment();
    const append = (list, target) => {
      for (const node of list ?? []) {
        if (node.type === "text") {
          if (!node.value) continue;
          target.append(doc.createTextNode(node.value));
          continue;
        }
        const mark = byId.get(node.id);
        const tag = RICH_INLINE_TAGS[mark?.tag] ? mark.tag : "span";
        const element = doc.createElement(tag);
        const allowed = RICH_INLINE_TAGS[tag] ?? [];
        for (const [name, value] of Object.entries(mark?.attributes ?? {})) {
          if (!allowed.includes(name)) continue;
          element.setAttribute(name, String(value));
        }
        append(node.children, element);
        target.append(element);
      }
    };
    append(nodes, fragment);
    return fragment;
  }

  const richTextCore = Object.freeze({
    OPEN_CHAR,
    CLOSE_CHAR,
    RICH_INLINE_TAGS,
    RICH_INLINE_TAG_LIST,
    DEFAULT_RICH_TEXT_OPTIONS,
    resolveRichTextOptions,
    openToken,
    closeToken,
    hasPlaceholders,
    stripPlaceholders,
    serializeRichText,
    restoreRichText,
    buildTranslationFragment,
    cleanText
  });

  global.ImmerseFreeRichTextCore = richTextCore;
  if (typeof module !== "undefined" && module.exports) module.exports = richTextCore;
})(globalThis);
