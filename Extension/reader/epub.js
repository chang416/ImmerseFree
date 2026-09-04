// EPUB 雙語閱讀器（W3-4）。結構模仿 reader/pdf.js：
//   選檔 → 解包 → 章節清單 → 逐章翻譯（IMMERSEFREE_TRANSLATE，
//   自動吃批次/池/快取/術語紅利）→ 匯出 <原名>.bilingual.epub。
//
// zip 用 vendor 的 fflate（MIT，classic script 掛在 globalThis.fflate）；
// 「哪個條目換什麼、順序怎麼排」的決策全在 core/epub-core.js 純函式，
// 這裡只做 UI 與訊息往返。
import "../core/i18n-core.js";
import "../core/batch-core.js";
import "../core/rich-text-core.js";
import "../core/segmentation-core.js";
import "../core/epub-core.js";
// 雙語 Word（W4-1）。docx-core 要 srt-core 的檔名清洗（只能有一份規則），
// 所以 srt-core 排在它前面。
import "../core/srt-core.js";
import "../core/docx-core.js";
import { getSettings, saveSettings } from "../core/settings.js";

const api = globalThis.browser ?? globalThis.chrome;
const fflate = globalThis.fflate;
const epubCore = globalThis.ImmerseFreeEpubCore;
const docxCore = globalThis.ImmerseFreeDocxCore;
const segmentationCore = globalThis.ImmerseFreeSegmentationCore;
const richTextCore = globalThis.ImmerseFreeRichTextCore;
// EPUB 段落長度與網頁同量級，批量沿用網頁那組（16 項 / 6000 字）。
const EPUB_BATCH = globalThis.ImmerseFreeBatchCore.batchProfile("epub");

const emptyState = document.querySelector("#empty-state");
const bookRoot = document.querySelector("#book");
const chaptersRoot = document.querySelector("#chapters");
const chapterTitle = document.querySelector("#chapter-title");
const chapterBadge = document.querySelector("#chapter-badge");
const chapterContent = document.querySelector("#chapter-content");
const translateChapterButton = document.querySelector("#translate-chapter");
const translateAllButton = document.querySelector("#translate-all");
const exportButton = document.querySelector("#export-epub");
const exportDocxButton = document.querySelector("#export-docx");
const provider = document.querySelector("#provider");
const fileInput = document.querySelector("#file-input");
const progress = document.querySelector("#progress");
const progressText = document.querySelector("#progress-text");
const bookProgress = document.querySelector("#book-progress");

let settings = await getSettings();
let book = null;
let activeChapter = -1;
let cancelled = false;
let translating = false;
const history = [];

provider.value = settings.provider;
provider.addEventListener("change", async () => {
  settings = await saveSettings({ ...settings, provider: provider.value });
});
document.querySelector("#choose-file").addEventListener("click", () => fileInput.click());
document.querySelector("#empty-choose").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => fileInput.files[0] && loadFile(fileInput.files[0]));
translateChapterButton.addEventListener("click", () => {
  if (activeChapter < 0) return;
  cancelled = false; // 上一輪的「停止」不影響新按下的單章翻譯。
  translateChapter(activeChapter).catch(() => {});
});
translateAllButton.addEventListener("click", translateAll);
exportButton.addEventListener("click", exportBook);
exportDocxButton.addEventListener("click", exportBookAsDocx);
document.querySelector("#cancel").addEventListener("click", () => { cancelled = true; });
document.addEventListener("dragover", (event) => { event.preventDefault(); });
document.addEventListener("drop", (event) => {
  event.preventDefault();
  const file = [...event.dataTransfer.files].find((item) => item.name.toLowerCase().endsWith(".epub"));
  if (file) loadFile(file);
  else showEmptyError("這個檔案不是 EPUB。請選擇副檔名為 .epub 的檔案。");
});

// ------------------------------------------------------------------ 載入
async function loadFile(file) {
  try {
    document.querySelector("#document-name").textContent = file.name;
    const buffer = new Uint8Array(await file.arrayBuffer());
    // zip 的魔術位元組。fflate 對非 zip 的錯誤訊息是英文內部字串，先擋掉。
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      throw new Error("這個檔案不是 EPUB（不是 zip 容器）。");
    }
    const unpacked = fflate.unzipSync(buffer);
    const entries = Object.keys(unpacked).map((name) => ({ name, data: unpacked[name] }));
    const container = entries.find((entry) => entry.name === "META-INF/container.xml");
    if (!container) throw new Error("EPUB 缺少 META-INF/container.xml，無法解析。");
    const opfPath = epubCore.findOpfPath(decodeText(container.data));
    const opfEntry = opfPath && entries.find((entry) => entry.name === opfPath);
    if (!opfEntry) throw new Error("EPUB 找不到 OPF（書的目錄檔），無法解析。");
    const opf = epubCore.parseOpf(decodeText(opfEntry.data), opfPath);
    if (!opf.spine.length) throw new Error("這本 EPUB 的 spine 沒有任何章節。");
    book = {
      name: file.name,
      entries,
      byName: new Map(entries.map((entry) => [entry.name, entry])),
      opfPath,
      title: opf.title || file.name,
      chapters: opf.spine.map((item) => ({
        item,
        status: "idle",           // idle | pending | ready | partial | error
        doc: null,                // DOMParser 出來的 XHTML 文件
        originalText: "",
        segments: null,           // epub-core.collectChapterSegments 的結果
        translations: new Map(),  // segment index → 譯文字串（預覽用）
        outputBytes: null,        // 序列化後要塞回 zip 的位元組
        error: ""
      }))
    };
    activeChapter = -1;
    history.length = 0;
    emptyState.hidden = true;
    bookRoot.hidden = false;
    translateAllButton.disabled = false;
    exportButton.disabled = true;
    exportDocxButton.disabled = true;
    renderChapterList();
    selectChapter(0);
  } catch (error) {
    book = null;
    bookRoot.hidden = true;
    translateAllButton.disabled = true;
    exportButton.disabled = true;
    exportDocxButton.disabled = true;
    showEmptyError(error?.message || "無法開啟 EPUB。");
  }
}

function decodeText(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}

// ------------------------------------------------------------------ 章節清單
function renderChapterList() {
  chaptersRoot.replaceChildren();
  book.chapters.forEach((chapter, index) => {
    const row = document.createElement("li");
    row.className = "chapter-row";
    row.dataset.index = String(index);
    const name = document.createElement("span");
    name.className = "chapter-name";
    // 章節名是檔名（使用者文件內容），不進介面字典。
    name.setAttribute("data-immersefree-no-i18n", "");
    name.textContent = chapter.item.href;
    const state = document.createElement("span");
    state.className = "chapter-state";
    state.dataset.state = chapter.status;
    state.textContent = describeStatus(chapter);
    row.append(name, state);
    row.addEventListener("click", () => selectChapter(index));
    chaptersRoot.append(row);
  });
}

function describeStatus(chapter) {
  if (chapter.status === "ready") return "已翻譯";
  if (chapter.status === "partial") return "部分翻譯";
  if (chapter.status === "pending") return "翻譯中";
  if (chapter.status === "error") return "失敗";
  return "未翻譯";
}

function refreshChapterRow(index) {
  const row = chaptersRoot.querySelector(`[data-index="${index}"] .chapter-state`);
  if (!row) return;
  const chapter = book.chapters[index];
  row.dataset.state = chapter.status;
  row.textContent = describeStatus(chapter);
  if (index === activeChapter) {
    chapterBadge.dataset.source = chapter.status === "ready" ? "ready" : chapter.status === "error" ? "error" : "pending";
    chapterBadge.textContent = chapter.error || describeStatus(chapter);
  }
  exportButton.disabled = !book.chapters.some((item) => item.outputBytes);
  // Word 匯出只需要「有譯文」，不需要序列化過的章節位元組。
  exportDocxButton.disabled = !book.chapters.some((item) => item.translations?.size);
}

// ------------------------------------------------------------------ 解析與預覽
function ensureChapterParsed(index) {
  const chapter = book.chapters[index];
  if (chapter.doc || chapter.status === "error") return chapter;
  const entry = book.byName.get(chapter.item.name);
  if (!entry) {
    chapter.status = "error";
    chapter.error = "zip 裡找不到這一章的檔案";
    return chapter;
  }
  chapter.originalText = decodeText(entry.data);
  const doc = new DOMParser().parseFromString(chapter.originalText, "application/xhtml+xml");
  if (doc.querySelector("parsererror")) {
    // 這一章的 XHTML 壞掉（不少老書有）。整章跳過、原檔位元組保留，
    // 比硬修後輸出一份 epubcheck 拒收的書安全。
    chapter.status = "error";
    chapter.error = "這一章的 XHTML 無法解析，將原樣保留";
    return chapter;
  }
  chapter.doc = doc;
  const body = doc.getElementsByTagName("body")[0] ?? doc.documentElement;
  chapter.segments = epubCore.collectChapterSegments(body, {
    segmentation: segmentationCore,
    view: window
  });
  return chapter;
}

function selectChapter(index) {
  activeChapter = index;
  chaptersRoot.querySelectorAll(".chapter-row").forEach((row) => {
    row.dataset.active = String(Number(row.dataset.index) === index);
  });
  const chapter = ensureChapterParsed(index);
  chapterTitle.textContent = chapter.item.href;
  translateChapterButton.disabled = chapter.status === "error" || translating;
  renderChapterPreview(index);
  refreshChapterRow(index);
}

// 預覽是我方自己的渲染：一律 textContent，原文與譯文都以純文字顯示，
// 章節裡的標記不會被當 HTML 解析（跟輸出檔無關，輸出走 epub-core 的
// sibling 插入 ＋ XMLSerializer）。
function renderChapterPreview(index) {
  const chapter = book.chapters[index];
  chapterContent.dataset.state = "";
  chapterContent.replaceChildren();
  if (chapter.status === "error" && !chapter.segments) {
    chapterContent.dataset.state = "error";
    const box = document.createElement("div");
    box.className = "sheet-error";
    box.textContent = chapter.error;
    chapterContent.append(box);
    return;
  }
  if (!chapter.segments?.length) {
    const box = document.createElement("div");
    box.className = "sheet-placeholder";
    box.textContent = "這一章沒有可翻譯的文字段落。";
    chapterContent.append(box);
    return;
  }
  chapter.segments.forEach((segment, segmentIndex) => {
    const wrap = document.createElement("div");
    wrap.className = "epub-segment";
    wrap.dataset.segment = String(segmentIndex);
    if (/^h[1-6]$/i.test(String(segment.element.tagName ?? ""))) wrap.dataset.kind = "heading";
    const original = document.createElement("p");
    original.className = "segment-original";
    original.textContent = segment.plainText;
    const translation = document.createElement("p");
    translation.className = "segment-translation";
    const translated = chapter.translations.get(segmentIndex);
    if (translated !== undefined) {
      translation.dataset.state = "ready";
      translation.textContent = translated;
    } else {
      translation.dataset.state = "idle";
      translation.textContent = "";
      translation.hidden = true;
    }
    wrap.append(original, translation);
    chapterContent.append(wrap);
  });
}

function setPreviewTranslation(chapterIndex, segmentIndex, text, state) {
  if (chapterIndex !== activeChapter) return;
  const node = chapterContent.querySelector(`[data-segment="${segmentIndex}"] .segment-translation`);
  if (!node) return;
  node.hidden = false;
  node.dataset.state = state;
  node.textContent = text;
}

// ------------------------------------------------------------------ 翻譯
async function translateChapter(index) {
  const chapter = ensureChapterParsed(index);
  if (chapter.status === "error" || chapter.status === "ready") return;
  if (!chapter.segments?.length) {
    chapter.status = "ready";
    refreshChapterRow(index);
    return;
  }
  chapter.status = "pending";
  refreshChapterRow(index);
  translateChapterButton.disabled = true;
  try {
    const pending = chapter.segments
      .map((segment, segmentIndex) => ({ segment, segmentIndex }))
      .filter(({ segmentIndex }) => !chapter.translations.has(segmentIndex));
    const batches = globalThis.ImmerseFreeBatchCore.planBatches(
      pending,
      EPUB_BATCH,
      (item) => item.segment.text.length
    );
    let interrupted = false;
    for (const batch of batches) {
      if (cancelled) { interrupted = true; break; }
      for (const { segmentIndex } of batch) setPreviewTranslation(index, segmentIndex, "翻譯中", "pending");
      const response = await api.runtime.sendMessage({
        type: "IMMERSEFREE_TRANSLATE",
        segments: batch.map(({ segment }) => segment.text),
        context: {
          mode: "epub",
          title: `${book.title}｜${chapter.item.href}`,
          previous: history.slice(-6)
        }
      });
      if (!response?.ok) throw new Error(response?.error || "翻譯失敗");
      response.translations.forEach((value, position) => {
        const { segment, segmentIndex } = batch[position];
        // 富文本硬校驗（四道）不過會整段退純文字，破碎標記進不了書。
        const restored = richTextCore.restoreRichText(value, segment.marks);
        epubCore.insertTranslationSibling(segment, restored, {
          richText: richTextCore,
          targetLanguage: settings.targetLanguage
        });
        chapter.translations.set(segmentIndex, restored.text);
        setPreviewTranslation(index, segmentIndex, restored.text, "ready");
        history.push({ source: segment.plainText, translation: restored.text });
      });
      while (history.length > 10) history.shift();
    }
    // 已插入的譯文一律序列化保留：取消時保住已完成的部分，這是驗收要求。
    if (chapter.translations.size) serializeChapter(chapter);
    chapter.status = interrupted && chapter.translations.size < chapter.segments.length
      ? (chapter.translations.size ? "partial" : "idle")
      : "ready";
  } catch (error) {
    if (chapter.translations.size) serializeChapter(chapter);
    chapter.status = "error";
    chapter.error = error?.message || "翻譯失敗";
    refreshChapterRow(index);
    throw error;
  } finally {
    translateChapterButton.disabled = false;
    refreshChapterRow(index);
  }
}

function serializeChapter(chapter) {
  const serialized = new XMLSerializer().serializeToString(chapter.doc);
  const output = epubCore.ensureXmlDeclaration(serialized, chapter.originalText);
  chapter.outputBytes = new TextEncoder().encode(output);
}

async function translateAll() {
  if (translating) return;
  cancelled = false;
  // 先把全書解析完做估算：>500 段要讓使用者知道要花多少再開工。
  const counts = [];
  let chars = 0;
  book.chapters.forEach((_, index) => {
    const chapter = ensureChapterParsed(index);
    const segments = chapter.segments ?? [];
    counts.push(segments.length);
    for (const segment of segments) chars += segment.plainText.length;
  });
  const estimate = epubCore.estimateEpubTranslation(counts, chars);
  if (estimate.needsConfirmation) {
    const goAhead = window.confirm(
      `這本書共 ${estimate.segments} 段、約 ${estimate.chars} 字，` +
      `預估耗用約 ${estimate.approxTokens} token、約 ${estimate.approxMinutes} 分鐘。` +
      `過程中可隨時按「停止」，已翻完的章節會保留。要開始嗎？`
    );
    if (!goAhead) return;
  }
  translating = true;
  translateAllButton.disabled = true;
  progress.hidden = false;
  bookProgress.max = book.chapters.length;
  bookProgress.value = 0;
  const failures = [];
  for (let index = 0; index < book.chapters.length; index += 1) {
    if (cancelled) break;
    progressText.textContent = `正在翻譯 ${index + 1} / ${book.chapters.length} 章`;
    try {
      await translateChapter(index);
    } catch {
      failures.push(index + 1);
    }
    bookProgress.value = index + 1;
  }
  translating = false;
  translateAllButton.disabled = false;
  if (cancelled) progressText.textContent = "已停止，完成章節已保留";
  else if (failures.length) progressText.textContent = `完成，但第 ${failures.join(", ")} 章失敗（可重按翻譯本章）`;
  else progressText.textContent = "翻譯完成";
  if (!cancelled && !failures.length) setTimeout(() => { progress.hidden = true; }, 1800);
}

// ------------------------------------------------------------------ 匯出
function exportBook() {
  const replacements = new Map();
  for (const chapter of book.chapters) {
    if (chapter.outputBytes) replacements.set(chapter.item.name, chapter.outputBytes);
  }
  if (!replacements.size) return;
  const zipObject = epubCore.buildEpubZipEntries(book.entries, replacements);
  const bytes = fflate.zipSync(zipObject);
  const blob = new Blob([bytes], { type: "application/epub+zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = epubCore.bilingualFileName(book.name);
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// 雙語 Word（W4-1）。一章一節，段落順序照 segments 的原順序——
// chapter.translations 是 Map(segmentIndex → 譯文)，所以配對用索引取，
// 不是靠兩個陣列的長度剛好相等（部分翻譯的章節長度本來就不等）。
function exportBookAsDocx() {
  if (!docxCore || !fflate) return;
  const sections = [];
  book.chapters.forEach((chapter) => {
    const segments = chapter.segments ?? [];
    if (!chapter.translations?.size) return;
    const pairs = [];
    segments.forEach((segment, index) => {
      const translation = chapter.translations.get(index);
      if (!translation) return;
      pairs.push({ source: segment.plainText, translation });
    });
    if (pairs.length) sections.push({ heading: chapter.item.href, pairs });
  });
  if (!sections.length) return;
  const title = book.title || book.name || "book";
  const { zipObject, pairCount } = docxCore.buildDocxZipEntries({ title, sections, at: Date.now() });
  const bytes = fflate.zipSync(zipObject);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = docxCore.buildDocxFileName(title, "book");
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  progress.hidden = false;
  progressText.textContent = `已匯出 ${pairCount} 段雙語 Word`;
}

function showEmptyError(message) {
  emptyState.hidden = false;
  emptyState.querySelector("h1").textContent = "無法開啟 EPUB";
  emptyState.querySelector("p").textContent = message;
}
