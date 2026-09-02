import { buildPdfBlocks, isTranslatablePdfBlock } from "./pdf-layout.js";

export function extractNativePdfFragments(items,viewport) {
  return (items || []).map((item) => {
    const height=Math.max(Number(item.height || item.transform?.[3] || 0),1);
    return {
      text:String(item.str || "").trim(),
      left:Number(item.transform?.[4] || 0)/Math.max(Number(viewport?.width || 0),1),
      top:1-(Number(item.transform?.[5] || 0)+height)/Math.max(Number(viewport?.height || 0),1),
      width:Number(item.width || 0)/Math.max(Number(viewport?.width || 0),1),
      height:height/Math.max(Number(viewport?.height || 0),1),
      confidence:1
    };
  }).filter((item) => item.text).sort((a,b) => a.top-b.top || a.left-b.left);
}

export function buildPdfReplicaLayers(inputLines) {
  const lines = (inputLines || []).map(normalizeReplicaLine).filter((line) => line.text)
    .sort((a,b) => a.top-b.top || a.left-b.left);
  const numeric = lines.filter((line) => isPdfNumericCell(line.text));
  const preserved = lines.filter((line) => isPdfNumericCell(line.text) || isPdfInvariantCell(line.text));
  const preservedSet = new Set(preserved);
  const alignedLabels = lines.filter((line) => !isPdfNumericCell(line.text) && isAlignedWithNumericCell(line,numeric));
  const rowLabels=structuredRowLabels(lines,preservedSet);
  const labels = lines.filter((line) => !preservedSet.has(line) && (
    alignedLabels.includes(line) || rowLabels.has(line) || belongsToStructuredLabelColumn(line,alignedLabels)
  ));
  const labelSet = new Set(labels);
  const proseLines = lines.filter((line) => !labelSet.has(line) && !preservedSet.has(line));

  const labelLayers = labels.map((line,index) => ({
    id:`pdf-label-${index+1}`,
    kind:"label",
    sourceText:line.text,
    left:line.left,
    top:line.top,
    width:labelOverlayWidth(line,lines),
    height:line.height,
    lineCount:1
  }));
  const proseLayers = buildPdfBlocks(proseLines)
    .filter(isTranslatablePdfBlock)
    .map((block) => ({
      id:block.id,
      kind:block.kind,
      sourceText:block.text,
      left:block.left,
      top:block.top,
      width:block.width,
      height:block.height,
      lineCount:block.lineCount
    }));

  return {
    layers:[...labelLayers,...proseLayers].sort((a,b) => a.top-b.top || a.left-b.left),
    preserved:preserved.map((line) => ({ ...line }))
  };
}

// 取樣環離框多遠（畫布像素）。太近會取到正要被蓋掉的下伸部，取到墨色就會變成一塊深色。
const MASK_RING_OFFSETS = [3, 7, 12];
const MASK_SAMPLES_PER_EDGE = 16;
// 與底色差多少亮度才算「墨跡」。抗鋸齒的灰邊約差 20–30，這裡取 34 以免把邊緣當內容。
const MASK_INK_LUMINANCE_GAP = 34;

// 遮蓋框的幾何。
// 原本的框是從 PDF text item 的 transform 直接換算出來的：底邊剛好落在**基線**上，
// 所以 g j p q y 的下伸部、以及標題那種大字的抗鋸齒邊緣整段露在框外 —— 那就是使用者
// 看到的「黑黑的影子」。這裡往下量實際墨跡再補足，並在四周留抗鋸齒的餘裕。
export function buildPdfMaskGeometry(layer, pixels) {
  const canvasWidth = Math.max(Math.round(Number(pixels?.width) || 0), 0);
  const canvasHeight = Math.max(Math.round(Number(pixels?.height) || 0), 0);
  const lineCount = Math.max(1, Math.round(Number(layer?.lineCount) || 1));
  const rect = {
    left: clamp(Number(layer?.left) || 0, 0, 1),
    top: clamp(Number(layer?.top) || 0, 0, 1),
    width: Math.max(Number(layer?.width) || 0, .004),
    height: Math.max(Number(layer?.height) || 0, .008)
  };
  const lineHeight = rect.height / lineCount;
  const color = samplePdfMaskColor(pixels, rect);
  const padX = canvasWidth ? Math.max(2 / canvasWidth, lineHeight * .04) : lineHeight * .05;
  const padTop = canvasHeight ? Math.max(1.5 / canvasHeight, lineHeight * .04) : lineHeight * .05;
  const maxPadBottom = lineHeight * .34;
  let padBottom = lineHeight * .26;
  if (canvasHeight) {
    const inkRows = measurePdfInkBelow(pixels, rect, color, Math.ceil(maxPadBottom * canvasHeight));
    padBottom = Math.min(maxPadBottom, Math.max(3 / canvasHeight, (inkRows + 2) / canvasHeight));
  }
  const left = clamp(rect.left - padX, 0, 1);
  const top = clamp(rect.top - padTop, 0, 1);
  return {
    left,
    top,
    width: clamp(rect.left + rect.width + padX, 0, 1) - left,
    height: clamp(rect.top + rect.height + padBottom, 0, 1) - top,
    color
  };
}

// 取框外一圈的主色當遮蓋底色。
// 先用 8 階量化分箱找出「哪一區的顏色最多」（抗雜訊），再回傳那一箱裡出現最多次的
// 原始色值 —— 只回量化值會把 #e7edf3 這種淺藍底抹成灰色，只取原始眾數又擋不住雜訊。
export function samplePdfMaskColor(pixels, rect) {
  const width = Math.round(Number(pixels?.width) || 0);
  const height = Math.round(Number(pixels?.height) || 0);
  const data = pixels?.data;
  if (!data || width <= 0 || height <= 0) return [255, 255, 255];
  const x = (Number(rect?.left) || 0) * width;
  const y = (Number(rect?.top) || 0) * height;
  const w = (Number(rect?.width) || 0) * width;
  const h = (Number(rect?.height) || 0) * height;
  const bins = new Map();
  const push = (px, py) => {
    const sx = Math.max(0, Math.min(width - 1, Math.round(px)));
    const sy = Math.max(0, Math.min(height - 1, Math.round(py)));
    const index = (sy * width + sx) * 4;
    const exact = `${data[index]},${data[index + 1]},${data[index + 2]}`;
    const key = `${data[index] >> 3},${data[index + 1] >> 3},${data[index + 2] >> 3}`;
    const bin = bins.get(key) ?? { count: 0, exact: new Map() };
    bin.count += 1;
    bin.exact.set(exact, (bin.exact.get(exact) || 0) + 1);
    bins.set(key, bin);
  };
  for (const offset of MASK_RING_OFFSETS) {
    for (let index = 0; index < MASK_SAMPLES_PER_EDGE; index += 1) {
      const ratio = index / (MASK_SAMPLES_PER_EDGE - 1);
      push(x + w * ratio, y - offset);
      push(x + w * ratio, y + h + offset);
      push(x - offset, y + h * ratio);
      push(x + w + offset, y + h * ratio);
    }
  }
  const bin = [...bins.values()].sort((a, b) => b.count - a.count)[0];
  if (!bin) return [255, 255, 255];
  const winner = [...bin.exact].sort((a, b) => b[1] - a[1])[0]?.[0] || "255,255,255";
  return winner.split(",").map(Number);
}

// 從框底往下逐列掃描，回傳最後一列還有墨跡的距離（像素）。
// 連續兩列乾淨就停手，這樣既能蓋掉下伸部，也不會一路吃到下一行或表格的框線。
export function measurePdfInkBelow(pixels, rect, background, limit) {
  const width = Math.round(Number(pixels?.width) || 0);
  const height = Math.round(Number(pixels?.height) || 0);
  const data = pixels?.data;
  if (!data || width <= 0 || height <= 0 || !(limit > 0)) return 0;
  const x0 = Math.max(0, Math.round((Number(rect?.left) || 0) * width));
  const x1 = Math.min(width, Math.round(((Number(rect?.left) || 0) + (Number(rect?.width) || 0)) * width));
  const bottom = Math.round(((Number(rect?.top) || 0) + (Number(rect?.height) || 0)) * height);
  const reference = pdfLuminance(background);
  let last = 0;
  let blank = 0;
  for (let step = 1; step <= limit; step += 1) {
    const y = bottom + step - 1;
    if (y >= height || x1 <= x0) break;
    let ink = 0;
    for (let px = x0; px < x1; px += 1) {
      const index = (y * width + px) * 4;
      if (Math.abs(pdfLuminance([data[index], data[index + 1], data[index + 2]]) - reference) > MASK_INK_LUMINANCE_GAP) {
        ink += 1;
        if (ink >= 2) break;
      }
    }
    if (ink >= 2) { last = step; blank = 0; }
    else if ((blank += 1) >= 2) break;
  }
  return last;
}

export function pdfLuminance(color) {
  const [r = 255, g = 255, b = 255] = Array.isArray(color) ? color : [];
  return .2126 * r + .7152 * g + .0722 * b;
}

export function isPdfNumericCell(value) {
  const text=String(value ?? "").trim();
  if (!/\d/.test(text)) return false;
  const compact=text.replace(/\s+/g,"");
  if (/^(?:[A-Z]{0,4}\$)?[()+\-]?\d[\d,.:'’/\-]*(?:%|[xX]|[kKmMbBtT]|[eEaAfF])?\)?$/u.test(compact)) return true;
  if (/^\d{1,6}(?:\.[A-Z]{1,5})$/u.test(compact)) return true;
  const letters=compact.match(/\p{L}/gu)?.length ?? 0;
  const digits=compact.match(/\d/g)?.length ?? 0;
  return letters <= 3 && digits >= 2 && digits >= letters*2;
}

export function isPdfInvariantCell(value) {
  const text=String(value ?? "").trim();
  if (!text || /\s/.test(text)) return false;
  return /^\(?[A-Z]{1,5}(?:\$[A-Z]{0,3})?(?:\/[A-Z]{1,5})?\)?(?:\*{1,3})?$/u.test(text);
}

export function shouldTranslatePdfLayer(layer,targetLanguage="zh-Hant") {
  const text=String(layer?.sourceText ?? "").trim();
  if (!text) return false;
  const letters=text.match(/\p{L}/gu)?.length ?? 0;
  if (!letters) return false;
  const han=text.match(/\p{Script=Han}/gu)?.length ?? 0;
  const latin=text.match(/[A-Za-z]/g)?.length ?? 0;
  const target=String(targetLanguage).toLowerCase();
  if (target.startsWith("zh")) return han / letters < .55;
  if (target.startsWith("en")) return latin / letters < .7;
  return true;
}

function isAlignedWithNumericCell(line,numericLines) {
  return numericLines.some((cell) => {
    if (cell.left <= line.left + Math.min(line.width,.03)) return false;
    if ((line.left >= .62) !== (cell.left >= .62)) return false;
    if (cell.left-(line.left+line.width) > .25) return false;
    const lineCenter=line.top+line.height/2;
    const cellCenter=cell.top+cell.height/2;
    return Math.abs(lineCenter-cellCenter) <= Math.max(.012,line.height*.9,cell.height*.9);
  });
}

function labelOverlayWidth(line,numericLines) {
  const nearby=numericLines
    .filter((cell) => cell !== line && cell.left > line.left && (cell.left >= .62) === (line.left >= .62) && Math.abs((line.top+line.height/2)-(cell.top+cell.height/2)) <= .018)
    .sort((a,b) => a.left-b.left)[0];
  const natural=Math.min(.17,Math.max(line.width+.012,.075));
  if (!nearby) return natural;
  return Math.max(line.width,Math.min(natural,nearby.left-line.left-.008));
}

function structuredRowLabels(lines,preservedSet) {
  const groups=[];
  for(const line of lines){
    const region=line.left>=.62 ? "sidebar" : "main";
    let group=groups.findLast((item) => item.region===region && Math.abs(item.top-line.top)<=Math.max(.004,line.height*.45));
    if(!group){group={ region,top:line.top,items:[] };groups.push(group);}
    group.items.push(line);
  }
  const labels=new Set();
  for(const group of groups){
    const items=[...group.items].sort((a,b) => a.left-b.left);
    if(items.length<2) continue;
    const hasCellGap=items.some((item,index) => index>0 && item.left-(items[index-1].left+items[index-1].width)>=.018);
    if(!hasCellGap) continue;
    for(const item of items) if(!preservedSet.has(item)) labels.add(item);
  }
  return labels;
}

function belongsToStructuredLabelColumn(line,anchors) {
  if (!anchors.length || line.text.length > 80) return false;
  return anchors.some((item) => {
    const verticalGap=Math.max(0,line.top-(item.top+item.height),item.top-(line.top+line.height));
    return Math.abs(item.left-line.left) <= .025 && verticalGap <= .025;
  });
}

function normalizeReplicaLine(line) {
  return {
    text:String(line?.text ?? "").replace(/\s+/g," ").trim(),
    left:clamp(Number(line?.left ?? line?.x ?? 0),0,1),
    top:clamp(Number(line?.top ?? 0),0,1),
    width:clamp(Number(line?.width ?? 0),0,1),
    height:clamp(Number(line?.height ?? .014),.002,.2),
    confidence:Number(line?.confidence ?? 1)
  };
}

function clamp(value,min,max){return Math.min(max,Math.max(min,Number.isFinite(value)?value:min));}
