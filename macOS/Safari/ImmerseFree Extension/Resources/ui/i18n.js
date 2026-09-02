import "../core/i18n-core.js";
import { getSettings } from "../core/settings.js";

const api = globalThis.browser ?? globalThis.chrome;
const { resolveLanguage, translate } = globalThis.ImmerseFreeI18nCore;

// 記住每個節點的原文，重新套用（例如切換語言）時才有東西可以翻回去。
const originalText = new WeakMap();
const originalAttribute = new WeakMap();
const ATTRIBUTES = ["placeholder", "title", "aria-label", "label"];
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "CODE", "TEXTAREA"]);
// 標了這個屬性的子樹不掃。PDF 閱讀器會把「翻譯出來的文件內容」畫進 DOM，
// 那些是使用者的文件，不是介面文字，絕不能拿介面字典去比對替換。
const SKIP_ATTRIBUTE = "data-immersefree-no-i18n";

function isSkipped(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return Boolean(element?.closest?.(`[${SKIP_ATTRIBUTE}]`));
}

let language = "zh-Hant";
let applying = false;

function translateTextNode(node) {
  const parent = node.parentElement;
  if (!parent || SKIP_TAGS.has(parent.tagName) || isSkipped(parent)) return;
  let source = originalText.get(node);
  if (source === undefined) {
    source = node.nodeValue;
    originalText.set(node, source);
  }
  const translated = translate(source, language);
  const next = translated === null
    ? source
    // 前後空白照原樣留著，不然行內文字會黏在一起。
    : source.replace(source.trim(), translated);
  if (node.nodeValue !== next) node.nodeValue = next;
}

function translateAttributes(element) {
  if (isSkipped(element)) return;
  for (const name of ATTRIBUTES) {
    if (!element.hasAttribute(name)) continue;
    const key = `${name}`;
    let store = originalAttribute.get(element);
    if (!store) { store = {}; originalAttribute.set(element, store); }
    if (store[key] === undefined) store[key] = element.getAttribute(name);
    const translated = translate(store[key], language);
    const next = translated === null ? store[key] : translated;
    if (element.getAttribute(name) !== next) element.setAttribute(name, next);
  }
}

function applyTo(root) {
  if (isSkipped(root)) return;
  applying = true;
  try {
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) translateTextNode(node);
    if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root);
    for (const element of root.querySelectorAll?.("*") ?? []) translateAttributes(element);
  } finally {
    applying = false;
  }
}

let originalTitle = "";

function applyDocumentTitle() {
  if (!originalTitle) originalTitle = document.title;
  const translated = translate(originalTitle, language);
  document.title = translated === null ? originalTitle : translated;
}

export async function setupI18n() {
  const settings = await getSettings().catch(() => ({}));
  language = resolveLanguage(settings.uiLanguage ?? "auto", navigator.language);
  document.documentElement.lang = language === "en" ? "en" : "zh-Hant";
  // <title> 不在 body 裡，掃描掃不到；分頁標題也要跟著語言換。
  applyDocumentTitle();
  applyTo(document.body);

  // 大部分狀態訊息是 JS 後來寫進 DOM 的，靠觀察者跟著翻，
  // 這樣就不必把每一處字串都改成 t("key")。
  new MutationObserver((records) => {
    if (applying) return;
    for (const record of records) {
      if (record.type === "characterData") applyTo(record.target);
      for (const node of record.addedNodes) applyTo(node);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  // 在別的分頁換語言時，這一頁也要跟著換。
  api.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local" || !changes.uiLanguage) return;
    language = resolveLanguage(changes.uiLanguage.newValue ?? "auto", navigator.language);
    document.documentElement.lang = language === "en" ? "en" : "zh-Hant";
    applyDocumentTitle();
    applyTo(document.body);
  });
}

await setupI18n();
