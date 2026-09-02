export function selectLocalCliProvider(body) {
  const provider = String(body?.provider ?? "").trim().toLowerCase();
  if (!provider || provider === "antigravity") return "antigravity";
  if (provider === "opencode") return "opencode";
  throw new Error("不支援的本機翻譯服務");
}
