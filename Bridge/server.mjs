// ImmerseFree 本機橋接服務。macOS 與 Windows 共用同一組 HTTP 介面，
// 平台差異只存在於 CLI 搜尋路徑、快取位置與 OCR 執行方式。
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { parseAgyModels, parseOpenCodeVerbose, selectFreeOpenCodeModels } from "./model-catalog.mjs";
import {
  buildOpenCodeCliArgs,
  parseOpenCodeRunText,
  readOpenCodeRunError
} from "./opencode-cli-core.mjs";
import { selectLocalCliProvider } from "./request-core.mjs";
import { buildVisionOcrPrompt, parseVisionOcrCliOutput } from "./vision-ocr-core.mjs";
import {
  getCacheFile,
  getExecutableCandidates,
  getOcrInvocation,
  getPathLookup,
  getPlatformName
} from "./platform-core.mjs";

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.IMMERSEFREE_PORT) || 27843;
const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 512 * 1024;
const MAX_OCR_BYTES = 12 * 1024 * 1024;
const CACHE_MS = 24 * 60 * 60 * 1000;
// Chrome／Edge 的擴充功能 ID 由 Extension/manifest.json 裡的 key 決定，安裝在哪台
// 機器都一樣，所以可以在這裡釘死。換掉那把 key 就必須同步改這個常數。
const CHROME_EXTENSION_ORIGIN = "chrome-extension://dfhcccjgooiemdenlphffkkjlnhfjamc";
const PLATFORM = getPlatformName();
const CACHE_FILE = getCacheFile();

let catalogCache = null;

const paths = {
  agy: await findExecutable("agy", getExecutableCandidates("agy", { bridgeDir: import.meta.dirname })),
  opencode: await findExecutable("opencode", getExecutableCandidates("opencode", { bridgeDir: import.meta.dirname })),
  ocr: await findExecutable("ocr", getExecutableCandidates("ocr", { bridgeDir: import.meta.dirname }), { pathLookup: false })
};

const server = http.createServer(async (request, response) => {
  try {
    const origin = request.headers.origin;
    const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);
    // 安裝腳本與登入啟動器用 curl／Invoke-RestMethod 探活，那些請求沒有 Origin，
    // 所以 /health 保留「無 Origin 也能打」，但只回最小的存活訊號——不洩漏平台、
    // 版本或已安裝的引擎清單，避免變成本機指紋來源。其餘端點一律要求合法 origin。
    if (!origin) {
      if (request.method === "GET" && url.pathname === "/health") {
        return sendJson(response, 200, { ok: true });
      }
      return sendJson(response, 403, { error: "Origin not allowed" });
    }
    if (!isAllowedOrigin(origin)) return sendJson(response, 403, { error: "Origin not allowed" });
    applyCors(request, response);
    if (request.method === "OPTIONS") return response.writeHead(204).end();
    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, {
        ok: true,
        platform: PLATFORM,
        antigravity: Boolean(paths.agy),
        opencode: Boolean(paths.opencode),
        ocr: Boolean(paths.ocr),
        visionOcr: Boolean(paths.agy),
        paths: {
          antigravity: paths.agy ?? null,
          opencode: paths.opencode ?? null,
          ocr: paths.ocr ?? null
        }
      });
    }
    if (request.method === "GET" && url.pathname === "/models") {
      const refresh = url.searchParams.get("refresh") === "1";
      return sendJson(response, 200, await getCatalog(refresh));
    }
    if (request.method === "POST" && url.pathname === "/translate") {
      if (request.headers["x-immersefree"] !== "translation-extension-v1") {
        return sendJson(response, 403, { error: "Bridge header missing" });
      }
      return sendJson(response, 200, await translateWithSelectedCli(await readJsonBody(request)));
    }

    if (request.method === "POST" && url.pathname === "/ocr") {
      if (request.headers["x-immersefree"] !== "translation-extension-v1") {
        return sendJson(response, 403, { error: "OCR header missing" });
      }
      const mimeType = String(request.headers["content-type"] || "").split(";")[0].toLowerCase();
      if (!new Set(["image/png", "image/jpeg"]).has(mimeType)) {
        return sendJson(response, 415, { error: "OCR 只接受 PNG 或 JPEG 圖片" });
      }
      return sendJson(response, 200, await recognizeImage(await readBinaryBody(request, MAX_OCR_BYTES), mimeType));
    }
    if (request.method === "POST" && url.pathname === "/vision-ocr") {
      if (request.headers["x-immersefree"] !== "translation-extension-v1") {
        return sendJson(response, 403, { error: "Vision OCR header missing" });
      }
      const mimeType = String(request.headers["content-type"] || "").split(";")[0].toLowerCase();
      if (!new Set(["image/png", "image/jpeg"]).has(mimeType)) {
        return sendJson(response, 415, { error: "視覺辨識只接受 PNG 或 JPEG 圖片" });
      }
      return sendJson(response, 200, await recognizeImageWithAgy(await readBinaryBody(request, MAX_OCR_BYTES), mimeType));
    }
    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 500, { error: cleanError(error) });
  }
});

// 已經有一個 Bridge 在跑時就安靜地退場，而不是撞上 EADDRINUSE。
// 這是最常見的情況：使用者手動再點一次啟動器，或安裝程式在服務已啟動時重跑。
if (await isBridgeAlreadyRunning()) {
  console.log(`ImmerseFree 本機服務已經在 http://${HOST}:${PORT} 執行中，這次不重複啟動。`);
  console.log(`The ImmerseFree bridge is already running on http://${HOST}:${PORT}; nothing to start.`);
  process.exit(0);
}

// listen 的錯誤是非同步事件，沒有這個處理器就會變成未捕捉例外，
// 使用者只看得到一段 Node 堆疊，完全不知道是連接埠被佔用。
server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`連接埠 ${PORT} 已被佔用，可能已經有一個 ImmerseFree Bridge 在執行。`);
    console.error(`  先檢查是誰佔著：lsof -ti tcp:${PORT}（Windows：netstat -ano | findstr ${PORT}）`);
    console.error(`Port ${PORT} is already in use — another ImmerseFree bridge may already be running.`);
    console.error(`  Check what holds it: lsof -ti tcp:${PORT} (Windows: netstat -ano | findstr ${PORT})`);
    process.exit(1);
  }
  console.error(`ImmerseFree 本機服務啟動失敗：${cleanError(error)}`);
  console.error(`Failed to start the ImmerseFree bridge: ${cleanError(error)}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`ImmerseFree 本機服務已啟動：http://${HOST}:${PORT}`);
  console.log(`  Antigravity CLI：${paths.agy ?? "未找到"}`);
  console.log(`  OpenCode CLI：${paths.opencode ?? "未找到"}`);
  console.log(`  OCR：${paths.ocr ?? "未找到"}`);
});

async function isBridgeAlreadyRunning() {
  try {
    const response = await fetch(`http://${HOST}:${PORT}/health`, { signal: AbortSignal.timeout(1_500) });
    if (!response.ok) return false;
    return (await response.json())?.ok === true;
  } catch {
    // 沒人回應（連不上、逾時、回的不是我們的 JSON）就照常啟動；
    // 若那個連接埠其實被別的程式佔著，下面的 error 處理器會給出友善訊息。
    return false;
  }
}

async function getCatalog(forceRefresh = false) {
  if (!catalogCache) catalogCache = await readPersistentCache();
  if (!forceRefresh && catalogCache && Date.now() - catalogCache.updatedAt < CACHE_MS) return catalogCache.value;
  const [antigravity, opencode] = await Promise.all([
    readAgyModels().catch(() => []),
    readOpenCodeModels(forceRefresh).catch(() => [])
  ]);
  const value = {
    updatedAt: new Date().toISOString(),
    antigravity: antigravity
      .filter((model) => model.id === "gemini-3.6-flash-low")
      .map((model) => ({ ...model, source: "antigravity" })),
    opencode
  };
  // A refresh that came back empty must not overwrite a good cached catalog,
  // otherwise one flaky network call leaves the model picker stuck on the
  // built-in fallback until someone refreshes again by hand.
  if (!value.antigravity.length && !value.opencode.length && catalogCache?.value) return catalogCache.value;
  catalogCache = { updatedAt: Date.now(), value };
  await writePersistentCache(catalogCache).catch(() => {});
  return value;
}

async function readAgyModels() {
  if (!paths.agy) return [];
  const { stdout } = await runCli(paths.agy, ["models"], {
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024
  });
  return parseAgyModels(stdout);
}

async function readOpenCodeModels(forceRefresh) {
  try {
    const [servedResponse, catalogResponse] = await Promise.all([
      fetch("https://opencode.ai/zen/v1/models", { signal: AbortSignal.timeout(20_000) }),
      fetch("https://models.dev/api.json", { signal: AbortSignal.timeout(20_000) })
    ]);
    if (!servedResponse.ok || !catalogResponse.ok) throw new Error("OpenCode model catalog request failed");
    const served = await servedResponse.json();
    const catalog = await catalogResponse.json();
    const servedIds = new Set((served?.data || []).map((model) => model.id));
    const metadata = Object.values(catalog?.opencode?.models || {});
    // 兩份資料都要點頭：models.dev 說它免費且沒被淘汰，Zen 說它現在真的有在供應。
    // 不用模型名字猜——Zen 的清單裡還留著 -free 結尾但早已 deprecated 的舊模型。
    return selectFreeOpenCodeModels(metadata).filter((model) => servedIds.has(model.id));
  } catch (networkError) {
    if (!paths.opencode) throw networkError;
    const args = ["models", "opencode", "--verbose", "--pure"];
    if (forceRefresh) args.push("--refresh");
    const { stdout } = await runCli(paths.opencode, args, {
      timeout: 90_000,
      maxBuffer: 16 * 1024 * 1024
    });
    return selectFreeOpenCodeModels(parseOpenCodeVerbose(stdout));
  }
}

async function readPersistentCache() {
  try {
    const value = JSON.parse(await readFile(CACHE_FILE, "utf8"));
    if (!value?.updatedAt || !value?.value) return null;
    return value;
  } catch {
    return null;
  }
}

async function writePersistentCache(value) {
  await mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(value), { mode: 0o600 });
}

// Windows 的 CreateProcess 命令列上限是 32767 字元，macOS 與 Linux 是 ~1MB。
// 長批次的 prompt 直接塞進 --print= 會讓 spawn 丟 ENAMETOOLONG——這是
// Windows 專屬的失敗，在 Mac 上永遠不會出現。太長時改走 agy 的 stream-json
// 模式從 stdin 餵，那條路沒有長度限制。
const PRINT_ARG_SAFE_LENGTH = 20_000;

function agyPrintArgs(model, prompt, printTimeout, extra) {
  return [
    "--model", model,
    "--effort", "low",
    ...extra,
    "--output-format", "json",
    "--disable-slash-commands",
    "--print-timeout", printTimeout,
    `--print=${prompt}`
  ];
}

function agyStreamArgs(model, printTimeout, extra) {
  return [
    "--model", model,
    "--effort", "low",
    ...extra,
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--disable-slash-commands",
    "--print-timeout", printTimeout
  ];
}

function agyStreamInput(prompt) {
  return JSON.stringify({
    event: "user",
    message: { role: "user", content: [{ type: "text", text: prompt }] }
  }) + "\n";
}

function parseAgyStreamResult(stdout) {
  let payload = null;
  for (const line of String(stdout).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const message = JSON.parse(trimmed);
      if (message?.event === "result" && message.result) payload = message.result;
    } catch {
      // 串流中的其他事件行不影響最後那筆 result。
    }
  }
  if (!payload) throw new Error("Antigravity 沒有回傳結果");
  return payload;
}

async function runAgy(model, prompt, { printTimeout, timeout, maxBuffer, cwd, extra = [] }) {
  if (prompt.length <= PRINT_ARG_SAFE_LENGTH) {
    try {
      const { stdout } = await runCli(paths.agy, agyPrintArgs(model, prompt, printTimeout, extra), { cwd, timeout, maxBuffer });
      return JSON.parse(stdout);
    } catch (error) {
      // escape 之後才超長的情況照樣退回 stdin，不必猜精確的門檻。
      if (error?.code !== "ENAMETOOLONG") throw error;
    }
  }
  const { stdout } = await runCli(paths.agy, agyStreamArgs(model, printTimeout, extra), {
    cwd, timeout, maxBuffer, input: agyStreamInput(prompt)
  });
  return parseAgyStreamResult(stdout);
}

async function translateWithAgy(body) {
  if (!paths.agy) throw new Error("尚未安裝 Antigravity CLI（agy）");
  const model = String(body?.model ?? "");
  const prompt = String(body?.prompt ?? "");
  if (!/^gemini-[a-z0-9._-]+$/i.test(model)) throw new Error("不支援的 Antigravity 模型");
  if (!prompt.startsWith("Translate every item") || prompt.length > 50_000) throw new Error("翻譯內容格式不正確");
  const allowed = await readAgyModels();
  if (!allowed.some((item) => item.id === model)) throw new Error("這個 Antigravity 模型目前不可用");
  const payload = await runAgy(model, prompt, {
    printTimeout: "2m",
    cwd: os.tmpdir(),
    timeout: 150_000,
    maxBuffer: 4 * 1024 * 1024
  });
  if (payload.status !== "SUCCESS") throw new Error(payload.error || payload.response || "Antigravity 翻譯失敗");
  return { text: String(payload.response ?? ""), model, usage: payload.usage ?? null };
}

async function translateWithSelectedCli(body) {
  return selectLocalCliProvider(body) === "opencode"
    ? runOpenCodeCli(body, buildOpenCodeCliArgs, 150_000)
    : translateWithAgy(body);
}


async function runOpenCodeCli(body, buildArgs, timeout) {
  if (!paths.opencode) throw new Error("尚未安裝 OpenCode CLI");
  const model = String(body?.model ?? "");
  const prompt = String(body?.prompt ?? "");
  const catalog = await getCatalog(false);
  if (!catalog.opencode.some((item) => item.id === model)) {
    throw new Error("這個 OpenCode 免費模型目前不可用");
  }
  const { stdout, stderr } = await runCli(paths.opencode, buildArgs(model, prompt), {
    cwd: os.tmpdir(),
    timeout,
    maxBuffer: 16 * 1024 * 1024
  });
  const text = parseOpenCodeRunText(stdout);
  if (!text) {
    throw new Error(readOpenCodeRunError(stdout) || stderr || "OpenCode 沒有回傳文字");
  }
  return { text, model, usage: null };
}

async function recognizeImage(data, mimeType) {
  if (!paths.ocr) throw new Error("找不到 ImmerseFree OCR 元件");
  if (!data.length) throw new Error("OCR 圖片是空的");
  const directory = await mkdtemp(path.join(os.tmpdir(), "immersefree-ocr-"));
  const imagePath = path.join(directory, mimeType === "image/png" ? "page.png" : "page.jpg");
  try {
    await writeFile(imagePath, data, { mode: 0o600 });
    const invocation = getOcrInvocation(paths.ocr, imagePath);
    const { stdout } = await runCli(invocation.executable, invocation.args, {
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024
    });
    const lines = JSON.parse(stdout.trim() || "[]");
    if (!Array.isArray(lines)) throw new Error("OCR 沒有回傳文字列表");
    return {
      engine: invocation.engine,
      lines: lines.slice(0, 2000).map((line) => ({
        text: String(line?.text ?? "").slice(0, 2000),
        confidence: Number(line?.confidence ?? 0),
        left: Number(line?.left ?? 0),
        top: Number(line?.top ?? 0),
        width: Number(line?.width ?? 0),
        height: Number(line?.height ?? 0)
      }))
    };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

async function recognizeImageWithAgy(data, mimeType) {
  if (!paths.agy) throw new Error("尚未安裝 Antigravity CLI（agy）");
  if (!data.length) throw new Error("視覺辨識圖片是空的");
  const directory = await mkdtemp(path.join(os.tmpdir(), "immersefree-vision-"));
  const imagePath = path.join(directory, mimeType === "image/png" ? "page.png" : "page.jpg");
  try {
    await writeFile(imagePath, data, { mode: 0o600 });
    const model = "gemini-3.6-flash-low";
    const { stdout } = await runCli(paths.agy, [
      "--model", model,
      "--effort", "low",
      "--sandbox",
      "--add-dir", directory,
      "--output-format", "json",
      "--disable-slash-commands",
      "--print-timeout", "3m",
      `--print=${buildVisionOcrPrompt(imagePath)}`
    ], {
      cwd: directory,
      timeout: 200_000,
      maxBuffer: 16 * 1024 * 1024
    });
    return { engine: "Antigravity vision", model, lines: parseVisionOcrCliOutput(stdout) };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

function runCli(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: process.env,
      // 少了這個，Windows 每次呼叫 CLI 都會閃一個黑色主控台視窗。
      windowsHide: true,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"]
    });
    if (options.input !== undefined) {
      // CLI 提早結束時寫入會噴 EPIPE，那不是我們要回報的錯誤。
      child.stdin.on("error", () => {});
      child.stdin.end(options.input);
    }
    const stdout = [];
    const stderr = [];
    let size = 0;
    let settled = false;
    const maxBuffer = options.maxBuffer || 4 * 1024 * 1024;
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      settle(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(reject, new Error(`CLI timed out after ${options.timeout} ms`));
    }, options.timeout || 60_000);
    const collect = (target) => (chunk) => {
      size += chunk.length;
      if (size > maxBuffer) {
        child.kill("SIGTERM");
        finish(reject, new Error("CLI output exceeded the safe buffer limit"));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", (error) => {
      clearTimeout(timer);
      finish(reject, error);
    });
    // agy can leave a background helper holding the pipe open. Resolve on the
    // main process exit, then explicitly release its streams.
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      child.stdout.destroy();
      child.stderr.destroy();
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      };
      // agy 失敗時常常把原因印在 stdout 而不是 stderr。只看 stderr 的話
      // 使用者只會看到「CLI exited with 1」，完全無從查起。
      if (code === 0) finish(resolve, result);
      else finish(reject, new Error(result.stderr || result.stdout || `CLI exited with ${code ?? signal}`));
    });
  });
}

async function isUsableExecutable(name, candidate) {
  try {
    await access(candidate);
    // OCR 在 Windows 是一支 .ps1，不是 .exe；.exe 白名單只該套用在真正的 CLI 上，
    // 否則 ocr.ps1 會被自己的守門員擋在門外，掃描版 PDF 永遠無法辨識。
    if (process.platform === "win32" && name !== "ocr") {
      if (!candidate.toLowerCase().endsWith(".exe")) return false;
      // Some npm releases leave a tiny text/placeholder opencode.exe behind.
      // Calling it fails or opens a Windows error dialog, so only accept the
      // actual platform binary. Official native builds are far larger than 64 KiB.
      if (name === "opencode" && (await stat(candidate)).size < 64 * 1024) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function findExecutable(name, candidates, { pathLookup = true } = {}) {
  for (const candidate of candidates) {
    if (await isUsableExecutable(name, candidate)) return candidate;
  }
  if (!pathLookup) return null;
  try {
    const lookup = getPathLookup();
    const { stdout } = await execFileAsync(lookup.executable, [...lookup.args, name], { timeout: 3_000 });
    for (const candidate of stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
      if (await isUsableExecutable(name, candidate)) return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  const value = String(origin).toLowerCase();
  // Chrome／Edge：manifest 裡的 key 把擴充功能 ID 釘死，所以這裡可以全等比對。
  // 只驗 scheme 的話，使用者裝的任何一個擴充功能都能打進本機翻譯與 OCR 端點。
  if (value === CHROME_EXTENSION_ORIGIN) return true;
  // Safari：safari-web-extension://<UUID> 的 UUID 由 Safari 在每台機器、每次安裝
  // 時重新產生，無法像 Chrome 那樣事先釘死，因此只能驗 scheme。
  // 【已知殘餘風險】任何本機安裝的 Safari 擴充功能都能通過這一關。可接受的理由是
  // 服務只綁 127.0.0.1、要通過 Safari 擴充功能的安裝與使用者授權，且 POST 端點
  // 另有 X-ImmerseFree 標頭與輸入格式檢查。Safari 若日後提供穩定 ID，這裡應改成全等比對。
  return /^safari-web-extension:\/\/[0-9a-f-]+$/i.test(value);
}

function applyCors(request, response) {
  const origin = request.headers.origin;
  if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-ImmerseFree");
}

async function readJsonBody(request) {
  return JSON.parse((await readBinaryBody(request, MAX_BODY_BYTES)).toString("utf8"));
}

async function readBinaryBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("請求內容過大");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(response, status, value) {
  if (response.headersSent) return;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

function cleanError(error) {
  const message = String(error?.stderr || error?.message || error || "Unknown error");
  return message.replace(/\u001b\[[0-9;]*m/g, "").slice(0, 800);
}
