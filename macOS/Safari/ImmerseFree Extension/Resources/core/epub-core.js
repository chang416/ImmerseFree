(function initializeEpubCore(global) {
  // 雙語 EPUB 核心（W3-4）。
  //
  // 行為移植自 MIT 授權的 yihong0618/bilingual_book_maker
  // （commit d21f0f6a2d8e2f91a536aed14df95abfed6db48b，
  //   book_maker/loader/epub_loader.py:1073-1136），詳見 THIRD_PARTY_NOTICES.md。
  //
  // 插入策略取捨（MIT 版有 plan 與 anchored 兩策略，這裡選 **plan 式整塊
  // sibling**）：我方分段本來就是 block 元素級（segmentation-core 的
  // collectBlockElements），一塊原文對應一個譯文 sibling，數量守恆天然成立；
  // anchored 策略擅長的 run 級插入（<br> 分行詩句、巢狀 block 包裝）在我方
  // 架構裡已由 rich-text-core 的行內佔位符與「祖先讓後代」去重接手。代價是
  // 外層包裝塊不會有自己的譯文——那正是我們要的（不重譯）。
  //
  // 這個檔只放純函式：不碰 chrome API、不碰網路、不碰 zip 庫本身。
  // zip 的解包/重打包由呼叫端用 vendor 的 fflate（MIT）做，這裡只負責
  // 「哪個條目要換成什麼、順序與壓縮等級怎麼排」的決策，讓 Node 測試
  // 不用真的起瀏覽器就能驗到所有分支。

  const XHTML_NS = "http://www.w3.org/1999/xhtml";

  // OPF manifest 的媒體型別。text/html 偶爾出現在老書裡，一樣當章節處理。
  const XHTML_MEDIA_TYPES = new Set(["application/xhtml+xml", "text/html"]);

  // sibling 位置放不下「同 tag 再來一個」的容器：
  //   td/th —— 多一個儲存格會改變整列欄數，表格直接歪掉；
  //   caption —— <table> 只准一個；
  //   dt —— 多一個會被讀成另一個詞條的「詞」。
  // 這些改為**塊內附加**（對應 MIT 版 _append_inline_translation 的理由：
  // 「只准一個的容器，譯文兄弟會做出 epubcheck 拒收的書」）。
  const INLINE_APPEND_TAGS = new Set(["td", "th", "caption", "dt"]);

  // 複製到譯文塊時要剝掉的屬性：
  //   id —— 重複 id 是 epubcheck 抓的錯（對應 MIT 版 strip_duplicate_ids）；
  //   epub:type —— 語意標記（如 pagebreak）重複會誤導閱讀器導航。
  const STRIPPED_ATTRIBUTES = new Set(["id", "epub:type"]);

  const TRANSLATION_CLASS = "immersefree-epub-translation";

  // detached XHTML 文件量不到 display（getComputedStyle 對 DOMParser 產出的
  // 文件拿不到樣式），segmentation-core 的上爬路徑會全部落空。把靜態的
  // 塊級標籤表當 extraBlockSelectors 餵進去（.add 語意，不覆蓋 14 個語意
  // 標籤的快路徑），div 型排版的書照樣可分段。
  const EPUB_EXTRA_BLOCK_SELECTORS =
    "div,section,article,aside,header,footer,main,nav,figure,address,pre";

  // ---------------------------------------------------------------- 打開容器
  //
  // container.xml 與 OPF 都是機器產生的小 XML，這裡用字串掃描而不用
  // DOMParser：同一份實作要在 Node 測試（沒有 DOM）與瀏覽器共用，
  // 兩邊各養一套解析遲早分岔。掃描器只認 <tag attr="…"> 形狀，
  // 對 OPF 這種扁平清單足夠；真正的內容文件（章節 XHTML）仍然交給
  // 呼叫端的 DOMParser 做完整解析。

  function scanTags(xml, tagName) {
    const results = [];
    const pattern = new RegExp(`<(?:[A-Za-z0-9_-]+:)?${tagName}\\b([^>]*)>`, "g");
    let match;
    while ((match = pattern.exec(String(xml ?? ""))) !== null) {
      const attributes = {};
      const attrPattern = /([A-Za-z0-9_:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let attr;
      while ((attr = attrPattern.exec(match[1])) !== null) {
        attributes[attr[1]] = attr[3] ?? attr[4] ?? "";
      }
      results.push(attributes);
    }
    return results;
  }

  function decodeEntities(value) {
    return String(value ?? "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
  }

  // container.xml → OPF 路徑（zip 內名稱）。找不到回 null，呼叫端要報
  // 「不是有效的 EPUB」，不要猜。
  function findOpfPath(containerXml) {
    for (const rootfile of scanTags(containerXml, "rootfile")) {
      const media = rootfile["media-type"] ?? "";
      const path = rootfile["full-path"] ?? "";
      if (path && (!media || media === "application/oebps-package+xml")) {
        return decodeEntities(path);
      }
    }
    return null;
  }

  // href 相對 OPF 所在目錄解析成 zip 內名稱，含 ../ 正規化與 %xx 解碼
  // （zip 條目名是原始位元組，OPF href 是 URL）。
  function resolveHref(opfPath, href) {
    const raw = decodeEntities(String(href ?? "")).split("#")[0].split("?")[0];
    if (!raw) return "";
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      // 保留原字串：有些書的 href 沒有編碼卻含 %，硬解會丟例外。
    }
    const baseParts = String(opfPath ?? "").split("/").slice(0, -1);
    const parts = [...baseParts];
    for (const piece of decoded.split("/")) {
      if (!piece || piece === ".") continue;
      if (piece === "..") parts.pop();
      else parts.push(piece);
    }
    return parts.join("/");
  }

  // OPF → { spine, title }。spine 是有序章節清單：
  //   [{ id, href, name（zip 內名稱）, mediaType, properties, linear }]
  // properties 含 "nav" 的導覽文件**不進 spine 結果**：EPUB3 nav 的內容
  // 模型極嚴（li 底下只准 a/span），插譯文很容易做出 epubcheck 拒收的書，
  // MIT 版也對導覽條目走特殊路徑。這裡直接跳過整份 nav。
  function parseOpf(opfXml, opfPath) {
    const manifest = new Map();
    for (const item of scanTags(opfXml, "item")) {
      if (!item.id || !item.href) continue;
      manifest.set(item.id, {
        id: item.id,
        href: decodeEntities(item.href),
        name: resolveHref(opfPath, item.href),
        mediaType: item["media-type"] ?? "",
        properties: item.properties ?? ""
      });
    }
    const spine = [];
    for (const ref of scanTags(opfXml, "itemref")) {
      const item = manifest.get(ref.idref);
      if (!item) continue;
      if (!XHTML_MEDIA_TYPES.has(item.mediaType)) continue;
      if (/\bnav\b/.test(item.properties)) continue;
      spine.push({ ...item, linear: (ref.linear ?? "yes") !== "no" });
    }
    const titleMatch = /<(?:[A-Za-z0-9_-]+:)?title\b[^>]*>([^<]*)</.exec(String(opfXml ?? ""));
    return {
      manifest,
      spine,
      title: decodeEntities(titleMatch?.[1] ?? "").trim()
    };
  }

  // ---------------------------------------------------------------- 分段
  //
  // 沿用 segmentation-core 的純函式。回傳 [{ element, text, plainText,
  // marks, rich }]，text 是要送給模型的（含富文本佔位符）。
  function collectChapterSegments(body, deps) {
    const seg = deps?.segmentation ?? global.ImmerseFreeSegmentationCore;
    if (!seg || !body) return [];
    const ctx = seg.createSegmentationContext(
      { extraBlockSelectors: EPUB_EXTRA_BLOCK_SELECTORS, ...(deps?.overrides ?? {}) },
      deps?.view
    );
    const segments = [];
    const seenTexts = new Set();
    for (const element of seg.collectBlockElements(body, ctx)) {
      if (seg.isExcludedElement(element, ctx.options)) continue;
      if (seg.isStayOriginal(element, ctx.options)) continue;
      // 自己就是譯文（重跑同一章時）不再當候選。
      if (hasTranslationClass(element)) continue;
      const parts = seg.extractSegmentParts(element, ctx.options);
      if (!seg.meetsTextThreshold(parts.plainText, ctx.options)) continue;
      // 巢狀語意標籤（blockquote > p）兩層同文字：同 0.7.0，同文字只留第一個。
      if (seenTexts.has(parts.plainText)) continue;
      seenTexts.add(parts.plainText);
      segments.push({ element, ...parts });
    }
    return segments;
  }

  function hasTranslationClass(element) {
    const raw = typeof element?.getAttribute === "function"
      ? element.getAttribute("class")
      : element?.className;
    return String(raw ?? "").split(/\s+/).includes(TRANSLATION_CLASS);
  }

  // ---------------------------------------------------------------- 插入
  //
  // plan 式整塊 sibling（取捨見檔頭）。restored 是 rich-text-core
  // restoreRichText 的回傳；rich 模式用 buildTranslationFragment 還原行內
  // 標籤，其餘一律以文字節點進入文件（沒有 innerHTML，模型輸出不可能被
  // 當標記解析——與網頁翻譯同一條安全線）。
  //
  // 回傳插入的元素；插不了（元素已脫離文件）回 null。
  function insertTranslationSibling(segment, restored, options) {
    const element = segment?.element;
    const doc = element?.ownerDocument;
    if (!element || !doc) return null;
    const tag = String(element.tagName ?? "").toLowerCase();
    const richText = options?.richText ?? global.ImmerseFreeRichTextCore;
    const content = buildContent(doc, restored, segment, richText);
    if (INLINE_APPEND_TAGS.has(tag)) {
      // 塊內附加：<span> 掛在儲存格既有內容後面，前面補一個空白分隔
      // （對應 MIT 版 _append_inline_translation 的 " " 前綴）。
      const span = createElementLike(doc, element, "span");
      span.setAttribute("class", TRANSLATION_CLASS);
      applyLanguage(span, options?.targetLanguage);
      span.append(doc.createTextNode(" "));
      span.append(content);
      element.append(span);
      return span;
    }
    const sibling = createElementLike(doc, element, tag);
    copyAttributes(element, sibling);
    const classes = String(sibling.getAttribute?.("class") ?? "")
      .split(/\s+/)
      .filter(Boolean);
    classes.push(TRANSLATION_CLASS);
    sibling.setAttribute("class", classes.join(" "));
    applyLanguage(sibling, options?.targetLanguage);
    sibling.append(content);
    const parent = element.parentNode;
    if (!parent) return null;
    parent.insertBefore(sibling, element.nextSibling);
    return sibling;
  }

  function buildContent(doc, restored, segment, richText) {
    if (restored?.ok && restored.mode === "rich" && richText) {
      return richText.buildTranslationFragment(restored.nodes, segment.marks, doc);
    }
    return doc.createTextNode(String(restored?.text ?? ""));
  }

  // XHTML 文件的元素必須建立在 XHTML 命名空間，否則 XMLSerializer 會補上
  // xmlns=""，那是 epubcheck 直接拒收的錯。假 DOM（Node 測試）沒有
  // createElementNS，退回 createElement。
  function createElementLike(doc, reference, tag) {
    const ns = reference?.namespaceURI ?? XHTML_NS;
    if (typeof doc.createElementNS === "function") return doc.createElementNS(ns, tag);
    return doc.createElement(tag);
  }

  function copyAttributes(source, target) {
    const attributes = source?.attributes ?? [];
    for (const attribute of attributes) {
      const name = attribute?.name ?? attribute?.nodeName;
      if (!name || STRIPPED_ATTRIBUTES.has(name)) continue;
      try {
        target.setAttribute(name, String(attribute.value ?? attribute.nodeValue ?? ""));
      } catch {
        // 個別怪屬性設不上就跳過，不讓一個屬性毀掉整段譯文。
      }
    }
  }

  function applyLanguage(element, targetLanguage) {
    const lang = String(targetLanguage ?? "").trim();
    if (!lang) return;
    try {
      element.setAttribute("lang", lang);
      element.setAttribute("xml:lang", lang);
    } catch {
      // 假 DOM 不吃 xml:lang 就算了，輸出仍是合法 XHTML。
    }
  }

  // ---------------------------------------------------------------- 序列化
  //
  // XMLSerializer 不輸出 <?xml …?> 宣告；原檔有的話要補回去，
  // 不然條目從「有宣告」變「沒宣告」不算原樣。
  function ensureXmlDeclaration(serialized, originalText) {
    const original = String(originalText ?? "");
    const output = String(serialized ?? "");
    const declaration = /^\s*<\?xml[^?]*\?>/.exec(original);
    if (!declaration || /^\s*<\?xml/.test(output)) return output;
    return `${declaration[0]}\n${output}`;
  }

  // ---------------------------------------------------------------- 重打包
  //
  // entries：[{ name, data }]，維持原 zip 順序；replacements：Map(name → data)。
  // 規則：
  //   1. mimetype 必須是第一個條目且不壓縮（STORED），這是 EPUB 規格，
  //      epubcheck 首先驗這個。原檔沒有 mimetype 的話補一個。
  //   2. 其餘條目照原順序；被翻譯的章節換新位元組，其他一律原位元組塞回
  //      （重壓縮不改內容位元組——「byte-for-byte 保留」比對的是解包後內容）。
  // 回傳給 fflate.zipSync 用的物件（鍵序 = 寫入序）。
  function buildEpubZipEntries(entries, replacements) {
    const replaced = replacements instanceof Map ? replacements : new Map();
    const zipObject = {};
    const mimetype = entries.find((entry) => entry.name === "mimetype");
    const mimetypeData = mimetype?.data
      ?? textEncode("application/epub+zip");
    zipObject.mimetype = [mimetypeData, { level: 0 }];
    for (const entry of entries) {
      if (entry.name === "mimetype") continue;
      // zip 目錄條目（名稱以 / 結尾、內容空）原樣保留。
      const data = replaced.has(entry.name) ? replaced.get(entry.name) : entry.data;
      zipObject[entry.name] = [data, { level: entry.name.endsWith("/") ? 0 : 6 }];
    }
    return zipObject;
  }

  function textEncode(value) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value);
    const bytes = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 0xff;
    return bytes;
  }

  // 輸出檔名：<原名>.bilingual.epub。
  function bilingualFileName(name) {
    const base = String(name ?? "book").replace(/\.epub$/i, "");
    return `${base || "book"}.bilingual.epub`;
  }

  // ---------------------------------------------------------------- 估算
  //
  // >500 段要先讓使用者確認。估算故意粗而透明：
  //   token ≈ 字元數 × 2（原文進 + 譯文出，中文一字一 token 上下）；
  //   時間 ≈ 每批（16 段）約 4 秒，加常數緩衝。
  function estimateEpubTranslation(chapterSegmentCounts, totalChars) {
    const segments = chapterSegmentCounts.reduce((sum, count) => sum + count, 0);
    const batches = Math.ceil(segments / 16);
    return {
      segments,
      chars: totalChars,
      approxTokens: Math.ceil(totalChars * 2),
      approxMinutes: Math.max(1, Math.round((batches * 4) / 60)),
      needsConfirmation: segments > 500
    };
  }

  const epubCore = Object.freeze({
    XHTML_NS,
    XHTML_MEDIA_TYPES,
    INLINE_APPEND_TAGS,
    STRIPPED_ATTRIBUTES,
    TRANSLATION_CLASS,
    EPUB_EXTRA_BLOCK_SELECTORS,
    scanTags,
    findOpfPath,
    resolveHref,
    parseOpf,
    collectChapterSegments,
    hasTranslationClass,
    insertTranslationSibling,
    ensureXmlDeclaration,
    buildEpubZipEntries,
    bilingualFileName,
    estimateEpubTranslation
  });

  global.ImmerseFreeEpubCore = epubCore;
  if (typeof module !== "undefined" && module.exports) module.exports = epubCore;
})(globalThis);
