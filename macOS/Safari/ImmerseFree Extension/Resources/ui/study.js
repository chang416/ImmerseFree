import "../core/study-core.js";

const api = globalThis.browser ?? globalThis.chrome;
const { resolveLevel } = globalThis.ImmerseFreeStudyCore;

const els = {
  episode: document.querySelector("#episode"),
  retrySource: document.querySelector("#retry-source"),
  lineCount: document.querySelector("#line-count"),
  setup: document.querySelector("#setup"),
  preview: document.querySelector("#level-preview"),
  generate: document.querySelector("#generate"),
  status: document.querySelector("#status"),
  progress: document.querySelector("#progress"),
  progressFill: document.querySelector("#progress-fill"),
  result: document.querySelector("#result"),
  vocabulary: document.querySelector("#vocabulary"),
  patterns: document.querySelector("#patterns"),
  vocabCount: document.querySelector("#vocab-count"),
  patternCount: document.querySelector("#pattern-count"),
  copy: document.querySelector("#copy"),
  regenerate: document.querySelector("#regenerate")
};

const FIELDS = { toeic: "#field-toeic", ielts: "#field-ielts", gept: "#field-gept" };
let episode = null;
let generated = null;
let activeRequestId = "";

for (const input of document.querySelectorAll('input[name="kind"]')) {
  input.addEventListener("change", onKindChange);
}
for (const id of ["#toeic", "#ielts", "#gept"]) {
  document.querySelector(id).addEventListener("input", updatePreview);
  document.querySelector(id).addEventListener("change", updatePreview);
}
els.generate.addEventListener("click", generate);
els.retrySource.addEventListener("click", async () => {
  els.retrySource.disabled = true;
  try { await load(); updatePreview(); } finally { els.retrySource.disabled = false; }
});
els.copy.addEventListener("click", copyAsText);
els.regenerate.addEventListener("click", () => {
  els.result.hidden = true;
  els.setup.scrollIntoView({ behavior: "smooth" });
});

api.runtime.onMessage.addListener((message) => {
  if (message?.type !== "IMMERSEFREE_STUDY_PROGRESS" || message.requestId !== activeRequestId) return false;
  els.progress.hidden = false;
  els.progressFill.style.width = `${Math.round((message.done / Math.max(1, message.total)) * 100)}%`;
  setStatus(`正在整理第 ${message.done} / ${message.total} 批…`, "pending");
  return false;
});

await load();
onKindChange();

async function load() {
  els.retrySource.hidden = true;
  els.generate.disabled = true;
  const sourceTab = Number(new URL(location.href).searchParams.get("sourceTab"));
  try {
    if (Number.isSafeInteger(sourceTab) && sourceTab > 0) {
      setStatus("正在取得影片字幕，請保留原本的影片分頁。", "pending");
      const reply = await api.tabs.sendMessage(sourceTab, { type: "IMMERSEFREE_COLLECT_STUDY" });
      if (!reply?.ok) throw new Error(reply?.error ?? "字幕取得失敗，請重新整理影片後再試");
      episode = {title: reply.title ?? "", url: reply.url ?? "", pairs: reply.pairs ?? [], learnLanguage: reply.learnLanguage ?? "", helpLanguage: reply.helpLanguage ?? "", collectedAt: Date.now()};
      if (!episode.pairs.some((pair) => String(pair.source ?? "").trim())) throw new Error("影片沒有可用的原文字幕，請先開啟播放器字幕再試");
      await api.storage.local.set({studyEpisode: episode});
      setStatus("字幕已就緒，選擇程度後即可生成教材。", "success");
    } else {
      const stored = await api.storage.local.get("studyEpisode");
      episode = stored?.studyEpisode ?? null;
    }
  } catch (error) {
    episode = null;
    els.retrySource.hidden = false;
    els.episode.textContent = "字幕尚未就緒";
    setStatus(error.message, "error");
    return;
  }
  if (!episode?.pairs?.length) {
    els.episode.textContent = "沒有可用的字幕資料";
    setStatus("請回到 YouTube、Disney+ 或 Netflix 的影片頁面，按「影片學習」取得字幕。", "error");
    return;
  }
  els.episode.textContent = episode.title || "這一集";
  const languages = [episode.learnLanguage, episode.helpLanguage].filter(Boolean).join(" / ");
  els.lineCount.textContent = `${episode.pairs.length} 句${languages ? `　${languages}` : ""}`;
  els.generate.disabled = false;
}

function currentKind() {
  return document.querySelector('input[name="kind"]:checked')?.value ?? "beginner";
}

function currentProfileInput() {
  const kind = currentKind();
  if (kind === "toeic") return { kind, score: Number(document.querySelector("#toeic").value) };
  if (kind === "ielts") return { kind, score: Number(document.querySelector("#ielts").value) };
  if (kind === "gept") return { kind, grade: document.querySelector("#gept").value };
  return { kind: "beginner" };
}

function onKindChange() {
  const kind = currentKind();
  for (const [name, selector] of Object.entries(FIELDS)) {
    document.querySelector(selector).hidden = name !== kind;
  }
  updatePreview();
}

// 先在畫面上把換算結果講清楚，使用者才知道自己填的分數會被當成什麼程度，
// 而不是按下去才發現教材難度不對。
function updatePreview() {
  const profile = resolveLevel(currentProfileInput());
  if (!profile) {
    els.preview.textContent = "請填入有效的分數或級數。";
    els.generate.disabled = true;
    return;
  }
  els.generate.disabled = !episode?.pairs?.length;
  els.preview.innerHTML =
    `依 <strong>${escapeHtml(profile.source)}</strong> 換算為 <strong>${escapeHtml(profile.label)}</strong>。` +
    `<br>假設你的單字量 ${escapeHtml(profile.vocabulary)}，教材會著重：${escapeHtml(profile.target)}。`;
}

async function generate() {
  const profileInput = currentProfileInput();
  if (!resolveLevel(profileInput)) return;
  activeRequestId = crypto.randomUUID();
  els.generate.disabled = true;
  els.progress.hidden = false;
  els.progressFill.style.width = "0%";
  setStatus("正在送出第一批…", "pending");
  try {
    const reply = await api.runtime.sendMessage({ type: "IMMERSEFREE_STUDY_GENERATE", profile: profileInput, episode, requestId: activeRequestId });
    if (!reply?.ok) throw new Error(reply?.error ?? "生成失敗");
    generated = reply;
    render(reply);
    setStatus(
      `完成：${reply.vocabulary.length} 個單字、${reply.patterns.length} 個句型` +
      (reply.failed ? `（${reply.failed} 批失敗）` : ""),
      "success"
    );
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    els.generate.disabled = false;
    els.progress.hidden = true;
  }
}

function render(result) {
  els.result.hidden = false;
  els.vocabCount.textContent = `${result.vocabulary.length} 個`;
  els.patternCount.textContent = `${result.patterns.length} 個`;

  els.vocabulary.replaceChildren(...result.vocabulary.map((item) => card([
    ["item-head", `<span class="item-word">${escapeHtml(item.word)}</span><span class="item-time">${escapeHtml(item.time ?? "")}</span>`],
    item.reading ? ["item-pos", escapeHtml(item.reading)] : null,
    ["item-meaning", escapeHtml(item.meaning ?? "")],
    item.note ? ["item-note", escapeHtml(item.note)] : null,
    item.example ? ["item-example", `${escapeHtml(item.example)}<em>${escapeHtml(item.exampleZh ?? "")}</em>`] : null
  ])));

  els.patterns.replaceChildren(...result.patterns.map((item) => card([
    ["item-head", `<span class="item-word">${escapeHtml(item.pattern)}</span><span class="item-time">${escapeHtml(item.time ?? "")}</span>`],
    ["item-meaning", escapeHtml(item.meaning ?? "")],
    item.example ? ["item-example", `${escapeHtml(item.example)}<em>${escapeHtml(item.exampleZh ?? "")}</em>`] : null
  ])));
}

function card(rows) {
  const node = document.createElement("div");
  node.className = "item";
  node.innerHTML = rows.filter(Boolean)
    .map(([className, html]) => `<div class="${className}">${html}</div>`)
    .join("");
  return node;
}

async function copyAsText() {
  if (!generated) return;
  const lines = [`# ${episode?.title ?? "影集學習"}`, ""];
  lines.push("## 單字", "");
  for (const item of generated.vocabulary) {
    lines.push(`- ${item.word}（${item.reading ?? ""}）${item.time ? ` [${item.time}]` : ""}`);
    lines.push(`  ${item.meaning ?? ""}`);
    if (item.note) lines.push(`  ${item.note}`);
    if (item.example) lines.push(`  例：${item.example}　${item.exampleZh ?? ""}`);
    lines.push("");
  }
  lines.push("## 實用句型", "");
  for (const item of generated.patterns) {
    lines.push(`- ${item.pattern}${item.time ? ` [${item.time}]` : ""}`);
    lines.push(`  ${item.meaning ?? ""}`);
    if (item.example) lines.push(`  例：${item.example}　${item.exampleZh ?? ""}`);
    lines.push("");
  }
  await navigator.clipboard.writeText(lines.join("\n"));
  setStatus("已複製到剪貼簿。", "success");
}

function setStatus(message, state) {
  els.status.textContent = message;
  els.status.dataset.state = state;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
