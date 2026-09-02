const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

export function parseAgyModels(output) {
  return String(output ?? "")
    .replace(ANSI_PATTERN, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("Fetching "))
    .map((line) => {
      const [id, ...labelParts] = line.split("\t");
      return { id: id.trim(), name: (labelParts.join(" ").trim() || id.trim()) };
    })
    .filter((model) => /^[a-z0-9][a-z0-9._-]*$/i.test(model.id));
}

export function parseOpenCodeVerbose(output) {
  const clean = String(output ?? "").replace(ANSI_PATTERN, "");
  const markers = [...clean.matchAll(/^opencode\/([^\s]+)\s*$/gm)];
  const models = [];
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const start = marker.index + marker[0].length;
    const end = markers[index + 1]?.index ?? clean.length;
    const jsonText = clean.slice(start, end).trim();
    if (!jsonText.startsWith("{")) continue;
    try {
      const metadata = JSON.parse(jsonText);
      models.push({ ...metadata, id: metadata.id || marker[1] });
    } catch {
      // A single malformed catalog entry must not hide the remaining models.
    }
  }
  return models;
}

// 免費模型完全靠 catalog 的資料判斷，不看模型名字，也不寫死任何 id。
// 三個條件缺一不可：沒有被標成 deprecated、吃得下文字、輸入與輸出都不要錢。
export function selectFreeOpenCodeModels(models) {
  return models
    .filter((model) => !model?.status || model.status === "active")
    .filter((model) => model?.capabilities?.input?.text !== false)
    .filter((model) => Number(model?.cost?.input) === 0 && Number(model?.cost?.output) === 0)
    .map((model) => ({
      id: String(model.id),
      name: String(model.name || model.id),
      context: Number(model?.limit?.context) || 0,
      // OpenCode 把 OpenAI 家族的模型接到 Responses API，其餘走 chat/completions。
      // catalog 用 provider.npm 標了是哪一家，所以協定跟著資料走。
      protocol: model?.provider?.npm === "@ai-sdk/openai" ? "responses" : "chat",
      // 只有宣告支援的模型才送 response_format，硬送給不支援的會被打回來。
      structuredOutput: Boolean(model?.structured_output),
      source: "opencode"
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
