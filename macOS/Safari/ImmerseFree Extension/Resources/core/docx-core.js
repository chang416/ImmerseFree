(function initializeDocxCore(global) {
  // 雙語 .docx 匯出核心（W4-1）。
  //
  // 為什麼是手寫 OOXML 而不是拉一個 docx 產生庫：
  //   1. 這裡要的東西極少——「一段原文、一段譯文」的純文字段落加兩個樣式，
  //      沒有表格、圖片、頁碼、目錄。docx 庫最小的也是幾百 KB，塞進擴充功能
  //      要背它的授權、它的相依、以及它未來的破壞性改版。
  //   2. zip 這一段本來就已經有 vendor 的 fflate（MIT，EPUB 匯出在用）。
  // 代價寫在這裡免得以後有人以為漏了功能：**輸出是純文字段落**，
  // 原文的粗體、連結、標題層級不會帶進 docx（EPUB 匯出才保留行內標籤）。
  // 要帶格式就得換一條路（HTML→docx 或真的引入產生庫），那是另一個決定。
  //
  // 這個檔跟 epub-core 同一個分工：只放純函式，不碰 chrome API、不碰
  // 網路、不碰 zip 庫本身。呼叫端拿 buildDocxZipEntries() 的回傳餵給
  // fflate.zipSync，於是 Node 測試不用起瀏覽器就驗得到全部分支。

  const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

  // 自訂段落樣式 id。Word 與 LibreOffice 都用 styles.xml 裡的 w:styleId 對應。
  const SOURCE_STYLE = "ImmerseFreeSource";
  const TRANSLATION_STYLE = "ImmerseFreeTranslation";
  const HEADING_STYLE = "ImmerseFreeHeading";
  const TITLE_STYLE = "ImmerseFreeTitle";

  // XML 1.0 不接受大部分 C0 控制字元（\t \n \r 以外）。模型回話理論上不會
  // 夾帶，但 PDF／EPUB 抽出來的原文會——留一個進去，整份 docx 打不開。
  const INVALID_XML_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

  function escapeXml(value) {
    return String(value ?? "")
      .replace(INVALID_XML_CHARS, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function collapse(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  // 一個段落。xml:space="preserve" 是必要的：Word 會把 run 前後的空白吃掉，
  // 英文原文的行尾空格消失後兩個字會黏在一起。
  function paragraph(styleId, text) {
    return `<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>`
      + `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
  }

  // 空段落（章節之間的間隔）。不帶 run，Word 顯示為一個空行。
  function spacer() {
    return '<w:p/>';
  }

  // 配對正規化。規則刻意跟 srt-core 的 blockText 一致：
  // **沒翻到的段落整段不匯出**。輸出一個空的譯文段落只會在 Word 裡留下
  // 一堆看不出原因的空行，而少一段比多一段假的好。
  function normalizePairs(pairs = []) {
    const output = [];
    for (const pair of Array.isArray(pairs) ? pairs : []) {
      const source = collapse(pair?.source ?? pair?.plainText ?? pair?.text);
      const translation = collapse(pair?.translation ?? pair?.translatedText);
      if (!source || !translation) continue;
      output.push({ source, translation });
    }
    return output;
  }

  // sections：[{ heading?, pairs: [{ source, translation }] }]。
  // 回傳的 body 一定滿足「每個原文段後恰有一個譯文段」——
  // 這是驗收條件，所以配對是唯一的產生路徑（不存在只加一段的分支）。
  function buildDocumentXml(input = {}) {
    const title = collapse(input.title);
    const sections = Array.isArray(input.sections) ? input.sections : [];
    const parts = [];
    if (title) parts.push(paragraph(TITLE_STYLE, title));
    let pairCount = 0;
    sections.forEach((section, index) => {
      const pairs = normalizePairs(section?.pairs);
      if (!pairs.length) return;
      if (index > 0 || title) parts.push(spacer());
      const heading = collapse(section?.heading);
      if (heading) parts.push(paragraph(HEADING_STYLE, heading));
      for (const pair of pairs) {
        parts.push(paragraph(SOURCE_STYLE, pair.source));
        parts.push(paragraph(TRANSLATION_STYLE, pair.translation));
        pairCount += 1;
      }
    });
    // A4 直式。sectPr 少了的話 Word 會用預設 Letter，中文排版會被截邊。
    const sectPr = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
      + '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"'
      + ' w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
    const xml = `${XML_DECLARATION}\n`
      + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + `<w:body>${parts.join("")}${sectPr}</w:body></w:document>`;
    return { xml, pairCount };
  }

  // 樣式表。譯文用不同顏色與縮排，印出來一眼看得出哪一段是譯文；
  // 兩個樣式都基於 Normal，使用者要改字體只要改 docDefaults。
  function buildStylesXml() {
    const docDefaults = '<w:docDefaults><w:rPrDefault><w:rPr>'
      + '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="PMingLiU"/>'
      + '<w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>';
    const style = (id, name, rPr, pPr = "") =>
      `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${id}">`
      + `<w:name w:val="${name}"/><w:qFormat/>`
      + `<w:pPr>${pPr}<w:spacing w:before="0" w:after="80"/></w:pPr>`
      + `<w:rPr>${rPr}</w:rPr></w:style>`;
    return `${XML_DECLARATION}\n`
      + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + docDefaults
      + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
      + style(TITLE_STYLE, "ImmerseFree Title", '<w:b/><w:sz w:val="36"/>')
      + style(HEADING_STYLE, "ImmerseFree Heading", '<w:b/><w:sz w:val="28"/>')
      + style(SOURCE_STYLE, "ImmerseFree Source", '<w:color w:val="1F2328"/>')
      + style(TRANSLATION_STYLE, "ImmerseFree Translation",
        '<w:color w:val="0B5FA5"/>', '<w:ind w:left="120"/>')
      + '</w:styles>';
  }

  function buildContentTypesXml() {
    return `${XML_DECLARATION}\n`
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml"'
      + ' ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml"'
      + ' ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      + '<Override PartName="/docProps/core.xml"'
      + ' ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + '</Types>';
  }

  function buildRootRelsXml() {
    return `${XML_DECLARATION}\n`
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1"'
      + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"'
      + ' Target="word/document.xml"/>'
      + '<Relationship Id="rId2"'
      + ' Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties"'
      + ' Target="docProps/core.xml"/>'
      + '</Relationships>';
  }

  function buildDocumentRelsXml() {
    return `${XML_DECLARATION}\n`
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1"'
      + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"'
      + ' Target="styles.xml"/>'
      + '</Relationships>';
  }

  // 文件屬性。只有標題、產生者與時間——**沒有網址、沒有內容**。
  function buildCorePropsXml(title, at) {
    const stamp = new Date(Number(at) || Date.now()).toISOString().replace(/\.\d{3}Z$/, "Z");
    return `${XML_DECLARATION}\n`
      + '<cp:coreProperties'
      + ' xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
      + ' xmlns:dc="http://purl.org/dc/elements/1.1/"'
      + ' xmlns:dcterms="http://purl.org/dc/terms/"'
      + ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
      + `<dc:title>${escapeXml(collapse(title))}</dc:title>`
      + '<dc:creator>ImmerseFree</dc:creator>'
      + '<cp:lastModifiedBy>ImmerseFree</cp:lastModifiedBy>'
      + `<dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>`
      + `<dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>`
      + '</cp:coreProperties>';
  }

  function textEncode(value) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value);
    const bytes = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 0xff;
    return bytes;
  }

  // 回傳給 fflate.zipSync 用的物件（鍵序 = 寫入序）。
  // [Content_Types].xml 放第一個：規格沒強制，但 Word 對「先看到內容型別表」
  // 的容錯最好，而 EPUB 那邊也是同一個習慣（mimetype 第一）。
  function buildDocxZipEntries(input = {}) {
    const { xml: documentXml, pairCount } = buildDocumentXml(input);
    const files = {
      "[Content_Types].xml": buildContentTypesXml(),
      "_rels/.rels": buildRootRelsXml(),
      "docProps/core.xml": buildCorePropsXml(input.title, input.at),
      "word/document.xml": documentXml,
      "word/_rels/document.xml.rels": buildDocumentRelsXml(),
      "word/styles.xml": buildStylesXml()
    };
    const zipObject = {};
    for (const [name, text] of Object.entries(files)) {
      zipObject[name] = [textEncode(text), { level: 6 }];
    }
    return { zipObject, pairCount };
  }

  // 檔名：<標題>.bilingual.docx。清洗規則**共用** srt-core 的 sanitizeFileBase，
  // 三種匯出對同一個標題必須產出同一個主幹（W4-1 驗收條件）。
  function buildDocxFileName(title, fallback = "translation", deps) {
    // `deps` 給了 srtCore 這個鍵就照它用（包含刻意給 null，讓「沒載到」
    // 這條路可以被測到）；沒給才去看 global。
    const srt = deps && "srtCore" in deps ? deps.srtCore : global.ImmerseFreeSrtCore;
    const base = typeof srt?.sanitizeFileBase === "function"
      ? srt.sanitizeFileBase(title, fallback)
      // srt-core 沒載到的話寧可用一個固定名字，也不要自己另寫一套清洗——
      // 「兩套規則」正是這個驗收條件要防的事。
      : "translation";
    return `${base}.bilingual.docx`;
  }

  const docxCore = Object.freeze({
    SOURCE_STYLE,
    TRANSLATION_STYLE,
    HEADING_STYLE,
    TITLE_STYLE,
    escapeXml,
    normalizePairs,
    buildDocumentXml,
    buildStylesXml,
    buildContentTypesXml,
    buildRootRelsXml,
    buildDocumentRelsXml,
    buildCorePropsXml,
    buildDocxZipEntries,
    buildDocxFileName
  });

  global.ImmerseFreeDocxCore = docxCore;
  if (typeof module !== "undefined" && module.exports) module.exports = docxCore;
})(globalThis);
