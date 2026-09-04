import * as pdfjs from "../vendor/pdfjs/pdf.mjs";
import "../core/i18n-core.js";
import "../core/bridge-core.js";
// 批量常數（W2-3）。PDF 這條原本自己寫死 8——本波的靜態掃描就是為了抓出
// 這種「文件說有三處、其實有四處」的漏網點。它跟其他三處一樣走 batch-core，
// 只保留自己的字元預算（PDF 的一個 unit 最長 1800 字，比網頁段落長）。
import "../core/batch-core.js";
import { getSettings, saveSettings } from "../core/settings.js";
import { extractPdfFileId, pdfFetchCandidates } from "../core/pdf-source.js";
import { hasUsablePdfText } from "../core/pdf-layout.js";
import { buildPdfMaskGeometry, buildPdfReplicaLayers, extractNativePdfFragments, pdfLuminance, shouldTranslatePdfLayer } from "../core/pdf-replica.js";
import { createPdfPageRenderCoordinator, hasRenderedPdfCanvas } from "../core/pdf-render-core.js";
import { protectPdfNumbers, restorePdfNumbers } from "../core/pdf-token-core.js";
import {
  buildPdfTranslationUnits,
  mergePdfTranslationUnits,
  runPdfPageSequence,
  selectPdfTextSource
} from "../core/pdf-translation-core.js";
import { pdfOpenErrorMessage, pdfTranslationErrorMessage, scannedPdfMessage } from "../core/pdf-support.js";

const api = globalThis.browser ?? globalThis.chrome;
// PDF 走網頁那組批量（16 項），字元預算沿用它原本的 8000——PDF 的一個
// 翻譯單位最長 1800 字，用網頁的 6000 會讓一批只放得下三段。
const PDF_BATCH = globalThis.ImmerseFreeBatchCore.batchProfile("pdf", { maxChars: 8000 });
pdfjs.GlobalWorkerOptions.workerSrc = api.runtime.getURL("vendor/pdfjs/pdf.worker.mjs");

const pagesRoot = document.querySelector("#pages");
const emptyState = document.querySelector("#empty-state");
const fileInput = document.querySelector("#file-input");
const provider = document.querySelector("#provider");
const translateAllButton = document.querySelector("#translate-all");
const exportPdfButton = document.querySelector("#export-pdf");
const progress = document.querySelector("#progress");
const progressText = document.querySelector("#progress-text");
const documentProgress = document.querySelector("#document-progress");
let settings = await getSettings();
let pdfDocument;
let cancelled = false;
const pageLayouts = new Map();
const layoutPromises = new Map();
const history = [];
const sourcePageRenders = createPdfPageRenderCoordinator(renderSourcePage);

provider.value = settings.provider;
provider.addEventListener("change", async () => {
  settings = await saveSettings({ ...settings, provider:provider.value });
});
document.querySelector("#choose-file").addEventListener("click", () => fileInput.click());
document.querySelector("#empty-choose").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => fileInput.files[0] && loadFile(fileInput.files[0]));
translateAllButton.addEventListener("click", translateAll);
exportPdfButton.addEventListener("click", exportBilingualPdf);
document.querySelector("#cancel").addEventListener("click", () => { cancelled = true; });
document.querySelector("#view-mode").addEventListener("click", toggleTranslationOnly);
document.addEventListener("dragover", (event) => { event.preventDefault(); });
document.addEventListener("drop", (event) => {
  event.preventDefault();
  const file = [...event.dataTransfer.files].find((item) => item.type === "application/pdf" || item.name.toLowerCase().endsWith(".pdf"));
  if (file) loadFile(file);
  else showEmptyError("這個檔案不是 PDF，目前無法翻譯。請選擇副檔名為 .pdf 的檔案。");
});

const sourceUrl = new URL(location.href).searchParams.get("src");
if (sourceUrl) loadUrl(sourceUrl);

async function loadFile(file) {
  try {
    document.querySelector("#document-name").textContent = file.name;
    const data = await file.arrayBuffer();
    if (!looksLikePdf(data)) throw Object.assign(new Error("不是 PDF"), { name:"InvalidPDFException" });
    await openDocument({ data });
  } catch (error) {
    showEmptyError(pdfOpenErrorMessage(error));
  }
}

async function loadUrl(url) {
  try {
    document.querySelector("#document-name").textContent = extractPdfFileId(url)
      ? "Google Drive PDF"
      : decodeURIComponent(url.split("/").pop()?.split("?")[0] || "PDF 文件");
    let lastError;
    for (const candidate of pdfFetchCandidates(url)) {
      try {
        const response = await fetch(candidate, { credentials:"include", redirect:"follow" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.arrayBuffer();
        if (!looksLikePdf(data)) throw new Error("伺服器沒有回傳 PDF 檔案");
        await openDocument({ data });
        return;
      } catch (error) {
        lastError = error;
      }
    }
    if (extractPdfFileId(url)) {
      throw new Error(`無法從 Google Drive 讀取 PDF。請確認已登入、檔案允許下載，或先下載後拖入此頁。${lastError ? `（${lastError.message}）` : ""}`);
    }
    throw lastError || new Error("無法讀取 PDF");
  } catch (error) {
    showEmptyError(pdfOpenErrorMessage(error));
  }
}

function looksLikePdf(data) {
  const bytes = new Uint8Array(data, 0, Math.min(5, data.byteLength));
  return String.fromCharCode(...bytes) === "%PDF-";
}

async function openDocument(source) {
  reset();
  emptyState.hidden = true;
  pdfDocument = await pdfjs.getDocument(source).promise;
  translateAllButton.disabled = false;
  exportPdfButton.disabled = false;
  for (let number=1; number<=pdfDocument.numPages; number+=1) pagesRoot.append(createPageShell(number));
  observePages();
}

function createPageShell(number) {
  const article = document.createElement("article");
  article.className = "pdf-page";
  article.dataset.page = String(number);
  article.innerHTML = `
    <section class="original-page">
      <header class="page-label"><span>原始 PDF，第 ${number} 頁</span></header>
      <div class="page-preview"><span>載入第 ${number} 頁</span></div>
    </section>
    <section class="page-translation">
      <header class="page-head">
        <span>譯文，第 ${number} 頁</span>
        <span class="source-badge" data-source="pending">檢查文字層</span>
        <progress max="1" value="0" hidden></progress>
        <button class="expand-translation secondary" type="button">只看譯文</button>
        <button type="button">翻譯本頁</button>
      </header>
      <div class="translation-content" data-state="pending">
        <div class="sheet-placeholder">正在讀取 PDF 文字層</div>
      </div>
    </section>`;
  article.querySelector(".page-head button:last-child").addEventListener("click", () => translatePage(number).catch(() => {}));
  article.querySelector(".expand-translation").addEventListener("click", toggleTranslationOnly);
  return article;
}

function observePages() {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const number = Number(entry.target.dataset.page);
      renderPage(number).catch((error) => showPageError(number, pdfOpenErrorMessage(error)));
    }
  }, { rootMargin:"420px 0px" });
  document.querySelectorAll(".pdf-page").forEach((page) => observer.observe(page));
}

async function renderPage(number) {
  await sourcePageRenders.ensure(number);
  return preparePage(number);
}

async function renderSourcePage(number) {
  const page = await pdfDocument.getPage(number);
  const viewport = page.getViewport({ scale:1.35 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const container = pageRoot(number).querySelector(".page-preview");
  container.replaceChildren(canvas);
  await page.render({ canvasContext:canvas.getContext("2d"), viewport }).promise;
  return canvas;
}

async function preparePage(number) {
  if (pageLayouts.has(number)) return pageLayouts.get(number);
  if (layoutPromises.has(number)) return layoutPromises.get(number);
  const task = createPageLayout(number).finally(() => layoutPromises.delete(number));
  layoutPromises.set(number, task);
  return task;
}

async function createPageLayout(number) {
  setPageStatus(number, "檢查原生文字", "pending");
  const sourceCanvas = await sourcePageRenders.ensure(number);
  const page = await pdfDocument.getPage(number);
  const content = await page.getTextContent();
  const nativeLines = extractNativeLines(page, content.items);
  const selected = await selectPdfTextSource({
    nativeLines,
    isUsable:hasUsablePdfText,
    readOcr:() => recognizePageWithLocalOcr(page),
    readVision:() => recognizePageWithVision(page),
    onStatus:(state) => {
      if (state === "ocr") setPageStatus(number,"本機 OCR 辨識中","ocr");
      if (state === "vision-pending") setPageStatus(number,"視覺模型辨識中（會上傳本頁影像）","vision");
      if (state === "vision") setPageStatus(number,"視覺模型","vision");
    }
  });
  const { lines, source } = selected;
  const replica = buildPdfReplicaLayers(lines);
  if (!replica.layers.length && !replica.preserved.length) throw new Error(scannedPdfMessage());
  const layers = replica.layers.filter((layer) => shouldTranslatePdfLayer(layer,settings.targetLanguage));
  const layout = { source, lines, layers, preserved:replica.preserved };
  pageLayouts.set(number, layout);
  renderReplicaPage(number, layout, sourceCanvas);
  const sourceLabel=source === "vision" ? "視覺模型" : source === "ocr" ? "本機 OCR" : "原生文字";
  setPageStatus(number,layers.length ? sourceLabel : "已是目標語言",layers.length ? source : "native");
  return layout;
}

function extractNativeLines(page, items) {
  const viewport = page.getViewport({ scale:1 });
  return extractNativePdfFragments(items,viewport);
}

async function recognizePageWithLocalOcr(page) {
  return recognizeRenderedPage(page,"ocr");
}

async function recognizePageWithVision(page) {
  return recognizeRenderedPage(page,"vision-ocr");
}

async function recognizeRenderedPage(page, endpoint) {
  const viewport = page.getViewport({ scale:2.5 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext:canvas.getContext("2d", { alpha:false }), viewport }).promise;
  const image = await canvasToBlob(canvas, "image/png");
  // 本機 Bridge 沒開時，這裡本來會丟出「Failed to fetch」，畫面上等於沒有訊息。
  const response = await globalThis.ImmerseFreeBridgeCore.bridgeFetch(
    `${settings.bridgeBaseUrl.replace(/\/$/, "")}/${endpoint}`,
    {
      method:"POST",
      headers:{
        "Content-Type":"image/png",
        "X-ImmerseFree":"translation-extension-v1"
      },
      body:image
    },
    settings
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const label=endpoint === "ocr" ? "本機 OCR" : "Antigravity 視覺辨識";
    throw new Error(payload.error || `${label}無法使用（HTTP ${response.status}）`);
  }
  if (!Array.isArray(payload.lines) || !payload.lines.length) throw new Error(scannedPdfMessage());
  return payload.lines.map((line) => ({
    ...line,
    text:String(line.text ?? "").replace(/\bAl\b/g,"AI")
  }));
}

function canvasToBlob(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("無法建立 OCR 圖片")), type);
  });
}

function renderReplicaPage(number, layout, sourceCanvas) {
  const root = pageRoot(number).querySelector(".translation-content");
  root.dataset.state = "ready";
  root.replaceChildren();
  if (!hasRenderedPdfCanvas(sourceCanvas)) throw new Error("PDF 第 " + number + " 頁尚未完成繪製，請重新翻譯本頁。");
  const page=document.createElement("div");
  page.className="replica-page";
  // 這裡面畫的是使用者文件的譯文，不是介面文字。標記起來，
  // 介面語言的字典掃描才不會去比對、替換文件內容。
  page.setAttribute("data-immersefree-no-i18n","");
  page.style.aspectRatio=`${sourceCanvas.width} / ${sourceCanvas.height}`;
  const canvas=document.createElement("canvas");
  canvas.className="replica-background";
  canvas.width=sourceCanvas.width;
  canvas.height=sourceCanvas.height;
  // willReadFrequently 只在「第一次」取得 context 時有效；下面會把整張點陣讀出來給
  // 遮蓋層量測用，旗標要在這裡就給，晚了會被忽略。
  const context=canvas.getContext("2d",{ alpha:false, willReadFrequently:true });
  context.drawImage(sourceCanvas,0,0);
  page.append(canvas);
  // 整頁只讀一次 ImageData：每個遮蓋層都要量底色與下伸部墨跡，逐點 getImageData 會慢到有感。
  const pixels=readReplicaPixels(context,canvas);
  for (const layer of layout.layers) page.append(createReplicaLayer(layer,pixels));
  page.addEventListener("click",(event) => {
    if (event.target.closest(".translated-box")) return;
    toggleTranslationOnly();
  });
  root.append(page);
}

function readReplicaPixels(context,canvas) {
  try {
    const image=context.getImageData(0,0,canvas.width,canvas.height);
    return { data:image.data,width:image.width,height:image.height };
  } catch {
    // 取不到點陣（例如被跨來源汙染）時就退回純比例的遮蓋，畫面仍可用。
    return null;
  }
}

function createReplicaLayer(layer,pixels) {
  const element=document.createElement("div");
  element.className=`translated-box kind-${layer.kind}`;
  element.dataset.layerId=layer.id;
  element.dataset.state="empty";
  element.dataset.lines=String(Math.max(1,layer.lineCount || 1));
  const mask=buildPdfMaskGeometry(layer,pixels);
  element.style.left=`${mask.left*100}%`;
  element.style.top=`${mask.top*100}%`;
  element.style.width=`${mask.width*100}%`;
  element.style.height=`${mask.height*100}%`;
  element.style.backgroundColor=`rgb(${mask.color.join(" ")})`;
  element.style.color=pdfLuminance(mask.color)<112 ? "#f6f7f9" : "#0f1013";
  const span=document.createElement("span");
  element.append(span);
  return element;
}

async function translatePage(number) {
  const meter = pageRoot(number).querySelector(".page-head progress");
  const button = pageRoot(number).querySelector(".page-head button:last-child");
  button.disabled = true;
  try {
    const layout = await preparePage(number);
    const pending = layout.layers.filter((layer) => {
      return pageRoot(number).querySelector(`[data-layer-id="${layer.id}"]`)?.dataset.state !== "ready";
    });
    if (!pending.length) return;
    meter.hidden=false;meter.max=pending.length;meter.value=0;
    let completed=0;
    const units=buildPdfTranslationUnits(pending,1800);
    const translatedUnits=new Map();
    for (const batch of makeBatches(units,PDF_BATCH.maxItems,PDF_BATCH.maxChars)) {
      if (cancelled) break;
      for (const unit of batch) setLayerState(number,unit.layerId,"pending");
      const prepared=batch.map((unit) => protectPdfNumbers(unit.sourceText));
      const response = await api.runtime.sendMessage({
        type:"IMMERSEFREE_TRANSLATE",
        segments:prepared.map((item) => item.maskedText),
        context:{ mode:"pdf", title:document.querySelector("#document-name").textContent, previous:history.slice(-6) }
      });
      if (!response?.ok) throw new Error(response?.error || "翻譯失敗");
      response.translations.forEach((value,index) => {
        const restored=restorePdfNumbers(value,prepared[index].tokens).text;
        translatedUnits.set(batch[index],restored);
        history.push({ source:batch[index].sourceText, translation:restored });
      });
      for (const layerId of new Set(batch.map((unit) => unit.layerId))) {
        const layerUnits=units.filter((unit) => unit.layerId === layerId);
        if (!layerUnits.every((unit) => translatedUnits.has(unit))) continue;
        const merged=mergePdfTranslationUnits(layerUnits,layerUnits.map((unit) => translatedUnits.get(unit)));
        setLayerTranslation(number,layerId,merged.get(layerId));
      }
      completed=pending.filter((layer) => {
        return pageRoot(number).querySelector(`[data-layer-id="${layer.id}"]`)?.dataset.state === "ready";
      }).length;
      meter.value=completed;
      while(history.length>10) history.shift();
    }
  } catch(error) {
    const message=pdfTranslationErrorMessage(error);
    pageRoot(number).querySelectorAll('.translated-box[data-state="pending"]').forEach((element) => {
      element.dataset.state="error";
    });
    setPageStatus(number,message,"error");
    throw new Error(message);
  } finally {
    button.disabled=false;
  }
}

function setLayerState(number,layerId,state) {
  const element=pageRoot(number).querySelector(`[data-layer-id="${layerId}"]`);
  if (!element) return;
  element.dataset.state=state;
}

function setLayerTranslation(number,layerId,text) {
  const element=pageRoot(number).querySelector(`[data-layer-id="${layerId}"]`);
  if (!element) return;
  element.firstElementChild.textContent=text;
  element.dataset.state="ready";
  requestAnimationFrame(() => fitReplicaText(element));
}

function fitReplicaText(element) {
  const span=element.firstElementChild;
  if (!span || element.clientWidth<2 || element.clientHeight<2) return;
  const lines=Math.max(1,Number(element.dataset.lines) || 1);
  const single=lines===1;
  // 中文擠在 1.12 行高裡很難讀。單行的行高不影響閱讀、只影響能塞多大，所以放寬得少一點；
  // 多行段落給 1.34，寧可字級小一點也要有行距。
  const lineHeight=single ? 1.16 : 1.34;
  element.style.lineHeight=String(lineHeight);
  element.style.letterSpacing="0";
  // 上限跟著原文行高走，讓譯文不會比原文小。
  const sourceLine=element.clientHeight/lines*.88;
  let low=6.5,high=Math.max(7,Math.min(40,sourceLine)),best=low;
  for(let index=0;index<14;index+=1){
    const size=(low+high)/2;
    element.style.fontSize=`${size}px`;
    if(span.scrollHeight<=element.clientHeight+.5 && span.scrollWidth<=element.clientWidth+.5){best=size;low=size;}else high=size;
  }
  element.style.fontSize=`${best}px`;
  // 真的塞不下才收緊，而且收得比以前輕：-.03em 對中文會黏成一團。
  if(span.scrollHeight>element.clientHeight+1){
    element.style.letterSpacing="-.012em";
    element.style.lineHeight=single ? "1.06" : "1.18";
  }
}

function toggleTranslationOnly() {
  const enabled=document.body.classList.toggle("translation-only");
  const label=enabled ? "返回並排" : "只看譯文";
  document.querySelector("#view-mode").textContent=label;
  document.querySelectorAll(".expand-translation").forEach((button) => { button.textContent=label; });
  requestAnimationFrame(() => document.querySelectorAll('.translated-box[data-state="ready"]').forEach(fitReplicaText));
}

async function translateAll() {
  cancelled=false;
  translateAllButton.disabled=true;
  progress.hidden=false;
  documentProgress.max=pdfDocument.numPages;
  documentProgress.value=0;
  const result=await runPdfPageSequence(pdfDocument.numPages,translatePage,{
    isCancelled:() => cancelled,
    onPageStart:(number,total) => { progressText.textContent=`正在處理 ${number} / ${total} 頁`; },
    onPageComplete:() => { documentProgress.value+=1; },
    onPageFailure:() => { documentProgress.value+=1; }
  });
  if(result.cancelled) progressText.textContent="已停止，完成內容已保留";
  else if(result.failures.length) {
    const pages=result.failures.map((item) => item.pageNumber).join(", ");
    progressText.textContent=`完成 ${result.completed.length} / ${pdfDocument.numPages} 頁；未完成：${pages}（可按「翻譯本頁」重試）`;
  } else progressText.textContent="翻譯完成";
  translateAllButton.disabled=false;
  if(!result.failures.length) setTimeout(() => { progress.hidden=true; },1800);
}

function setPageStatus(number, text, state) {
  const badge=pageRoot(number).querySelector(".source-badge");
  badge.textContent=text;
  badge.dataset.source=state;
}

function showPageError(number, message) {
  const root=pageRoot(number).querySelector(".translation-content");
  root.dataset.state="error";
  root.innerHTML="";
  const box=document.createElement("div");
  box.className="sheet-error";
  box.textContent=message;
  root.append(box);
  setPageStatus(number,"無法擷取","error");
}

function pageRoot(number) {
  return pagesRoot.querySelector(`[data-page="${number}"]`);
}

function reset() {
  pdfDocument?.destroy?.();
  pagesRoot.replaceChildren();
  sourcePageRenders.clear();
  pageLayouts.clear();
  layoutPromises.clear();
  history.length=0;
  pdfDocument=undefined;
  translateAllButton.disabled=true;
  exportPdfButton.disabled=true;
  document.body.classList.remove("translation-only");
  document.querySelector("#view-mode").textContent="只看譯文";
}

// ------------------------------------------------------------------ 匯出雙語 PDF（W4-1）
//
// 走瀏覽器自己的列印管線（版面規則與取捨全在 reader/pdf.css 的 @media print
// 註解裡）。這裡只負責一件在 CSS 做不到的事：**先把每一頁都算出來**。
//
// 頁面是懶載入的（observePages 的 IntersectionObserver，只算捲到眼前的頁），
// 直接按列印會印出一疊「正在讀取 PDF 文字層」的佔位文字——而且使用者要到
// 看到輸出才會發現。所以先逐頁 renderPage()，再開列印對話框。
async function exportBilingualPdf() {
  if (!pdfDocument) return;
  exportPdfButton.disabled=true;
  progress.hidden=false;
  documentProgress.max=pdfDocument.numPages;
  documentProgress.value=0;
  const failures=[];
  try {
    for (let number=1; number<=pdfDocument.numPages; number+=1) {
      progressText.textContent=`正在準備列印版面 ${number} / ${pdfDocument.numPages} 頁`;
      try {
        await renderPage(number);
      } catch {
        // 掃描檔或抽不到文字層的頁：那一頁只印得到原始頁面影像，
        // 不該讓整份匯出停下來。
        failures.push(number);
      }
      documentProgress.value=number;
    }
    // 列印版面是單欄整頁寬，遮蓋層的寬度變了，字級要重算一次——
    // 少了這一步，印出來的譯文會沿用並排模式的字級（偏小、留一大片空白）。
    await new Promise((resolve) => requestAnimationFrame(resolve));
    document.querySelectorAll('.translated-box[data-state="ready"]').forEach(fitReplicaText);
    progressText.textContent=failures.length
      ? `第 ${failures.join(", ")} 頁沒有可翻譯的文字層，仍會印出原始頁面`
      : "版面已備妥，請在列印對話框選擇「另存為 PDF」";
    window.print();
  } finally {
    exportPdfButton.disabled=false;
    // 列印對話框關掉後畫面回到並排模式，字級要再算回來。
    requestAnimationFrame(() => document.querySelectorAll('.translated-box[data-state="ready"]').forEach(fitReplicaText));
  }
}

function showEmptyError(message) {
  translateAllButton.disabled=true;
  exportPdfButton.disabled=true;
  emptyState.hidden=false;
  emptyState.querySelector("h1").textContent="無法開啟 PDF";
  emptyState.querySelector("p").textContent=message;
}

function makeBatches(items,maxItems,maxChars){const batches=[];let batch=[];let chars=0;for(const item of items){const text=String(item.sourceText ?? item.text ?? "");if(batch.length&&(batch.length>=maxItems||chars+text.length>maxChars)){batches.push(batch);batch=[];chars=0;}batch.push(item);chars+=text.length;}if(batch.length)batches.push(batch);return batches;}
