const MODEL_ID = /^[a-z0-9][a-z0-9._-]*$/i;

export function buildOpenCodeCliArgs(model, prompt) {
  const id = String(model ?? "").trim();
  const text = String(prompt ?? "");
  if (!MODEL_ID.test(id)) throw new Error("不支援的 OpenCode 模型");
  if (!text.startsWith("Translate every item") || text.length > 50_000) {
    throw new Error("翻譯內容格式不正確");
  }
  return buildRunArgs(id, text);
}

function buildRunArgs(model, prompt) {
  return ["run", "--pure", "--model", `opencode/${model}`, "--format", "json", prompt];
}

export function parseOpenCodeRunText(output) {
  const texts = [];
  for (const line of String(output ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event?.type === "text" && event?.part?.type === "text" && typeof event.part.text === "string") {
        texts.push(event.part.text);
      }
    } catch {
      // OpenCode --format json emits one object per line. Ignore non-event noise.
    }
  }
  return texts.join("").trim();
}

export function readOpenCodeRunError(output) {
  for (const line of String(output ?? "").split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      if (event?.type === "error" && event?.error?.message) return String(event.error.message);
    } catch {}
  }
  return "";
}
