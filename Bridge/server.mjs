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
  buildOpenCodeCompletionCliArgs,
  classifyOpenCodeFailure,
  createOpenCodeCircuit,
  describeOpenCodeFailure,
  OpenCodeError,
  OPENCODE_ERROR_CODES,
  parseOpenCodeRunText
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
// 型錄抓不到時的重試間隔。夠短，網路一恢復就自己好；夠長，斷網時不會
// 每個請求都去撞一次網路。
const CATALOG_RETRY_MS = 60 * 1000;
// Chrome／Edge 的擴充功能 ID 由 Extension/manifest.json 裡的 key 決定，安裝在哪台
// 機器都一樣，所以可以在這裡釘死。換掉那把 key 就必須同步改這個常數。
const CHROME_EXTENSION_ORIGIN = "chrome-extension://dfhcccjgooiemdenlphffkkjlnhfjamc";
const PLATFORM = getPlatformName();
const CACHE_FILE = getCacheFile();

// ---------------------------------------------------------------- OpenCode 韌性參數
//
// 這幾個常數是「opencode 很容易斷」的答案。原本一次 CLI 呼叫只有一個總時長
// 計時器、沒有重試、沒有短路，任何一次卡住都會變成使用者眼中的一次斷線。
//
// IDLE：CLI 起來了卻連第一個位元組都不吐（沒登入、卡在互動提示、模型排隊），
//       這是最常見的「連不到」型態。等滿總時長毫無意義，先用閒置時間攔下來。
// TOTAL：整體上限，避免慢慢吐但永遠吐不完。
// KILL_GRACE：SIGTERM 後仍不退場就 SIGKILL；連同整個 process group 一起殺，
//       否則 opencode 起的子行程會變孤兒留在系統裡（實測會留下殘留行程）。
const OPENCODE_IDLE_TIMEOUT_MS = Number(process.env.IMMERSEFREE_OPENCODE_IDLE_MS) || 45_000;
const OPENCODE_TRANSLATE_TIMEOUT_MS = Number(process.env.IMMERSEFREE_OPENCODE_TIMEOUT_MS) || 150_000;
const OPENCODE_COMPLETE_TIMEOUT_MS = Number(process.env.IMMERSEFREE_OPENCODE_COMPLETE_TIMEOUT_MS) || 260_000;
const CLI_KILL_GRACE_MS = 2_000;
// 暫時性失敗才重試，而且只重試一次：免費模型本來就慢，重試三次等於把
// 一次斷線變成三倍的空等。
const OPENCODE_RETRY_ATTEMPTS = 1;
const OPENCODE_CIRCUIT_THRESHOLD = Number(process.env.IMMERSEFREE_OPENCODE_CIRCUIT_FAILURES) || 3;
const OPENCODE_CIRCUIT_COOLDOWN_MS = Number(process.env.IMMERSEFREE_OPENCODE_CIRCUIT_COOLDOWN_MS) || 60_000;
// 執行檔位置在啟動時解析一次就好，但「啟動時還沒裝、後來才裝」必須救得回來，
// 否則使用者裝好 opencode 還是得重啟服務才會被看見。
const EXECUTABLE_RECHECK_MS = 15_000;

const openCodeCircuit = createOpenCodeCircuit({
  threshold: OPENCODE_CIRCUIT_THRESHOLD,
  cooldownMs: OPENCODE_CIRCUIT_COOLDOWN_MS
});

let catalogCache = null;
let catalogInFlight = null;
let catalogDegraded = false;

const paths = {
  agy: await findExecutable("agy", getExecutableCandidates("agy", { bridgeDir: import.meta.dirname })),
  opencode: await findExecutable("opencode", getExecutableCandidates("opencode", { bridgeDir: import.meta.dirname })),
  ocr: await findExecutable("ocr", getExecutableCandidates("ocr", { bridgeDir: import.meta.dirname }), { pathLookup: false })
};

const executableCheckedAt = { agy: Date.now(), opencode: Date.now(), ocr: Date.now() };

// 重新找一次執行檔。啟動時沒找到（或找到的那份後來被移走／升級換路徑）時，
// 不該讓使用者永遠卡在「尚未安裝」——但也不能每個請求都去掃磁碟，所以節流。
async function resolveExecutable(name, { force = false } = {}) {
  if (paths[name] && !force) return paths[name];
  if (!force && Date.now() - (executableCheckedAt[name] ?? 0) < EXECUTABLE_RECHECK_MS) return paths[name];
  executableCheckedAt[name] = Date.now();
  paths[name] = await findExecutable(
    name,
    getExecutableCandidates(name, { bridgeDir: import.meta.dirname }),
    { pathLookup: name !== "ocr" }
  );
  return paths[name];
}

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
        },
        // 服務還活著、但 opencode 那條路正在冷卻——這兩件事必須分得出來，
        // 否則使用者（和我們自己）只會看到「有回應但一直失敗」而無從判斷。
        opencodeHealth: {
          catalogDegraded,
          circuit: openCodeCircuit.state()
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
    if (request.method === "POST" && url.pathname === "/complete") {
      if (request.headers["x-immersefree"] !== "translation-extension-v1") {
        return sendJson(response, 403, { error: "Bridge header missing" });
      }
      return sendJson(response, 200, await completeWithSelectedCli(await readJsonBody(request)));
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
    sendJson(response, statusForError(error), errorPayload(error));
  }
});

// 錯誤型別要跟著回應走，前端才分得出「本機環境要修」「等一下再試」
// 「換一個模型」。只回一串字串的話，擴充功能只能把整句貼給使用者。
function errorPayload(error) {
  const payload = { error: cleanError(error) };
  if (error instanceof OpenCodeError) {
    payload.code = error.code;
    payload.provider = "opencode";
    payload.retryable = error.retryable;
    if (error.retryAfterSeconds) payload.retryAfterSeconds = error.retryAfterSeconds;
  }
  return payload;
}

function statusForError(error) {
  if (!(error instanceof OpenCodeError)) return 500;
  if (error.code === OPENCODE_ERROR_CODES.BAD_REQUEST) return 400;
  // 短路中與逾時是「現在不行，等一下再來」，用 503 讓上游的重試邏輯分得出來。
  if (error.code === OPENCODE_ERROR_CODES.CIRCUIT_OPEN) return 503;
  if (error.code === OPENCODE_ERROR_CODES.CLI_TIMEOUT) return 504;
  return 500;
}

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
  // 同時進來的請求共用同一次更新。沒有這道去重，五段字幕同時翻譯就會同時
  // 下載五份 4MB 的 models.dev 型錄、或同時起五個 `opencode models` 行程，
  // 把「翻譯慢一點」放大成「全部一起逾時」。
  // 手動「重新整理」不可以搭別人的順風車，否則使用者按了等於沒按。
  if (catalogInFlight && !forceRefresh) return catalogInFlight;
  const run = refreshCatalog(forceRefresh);
  catalogInFlight = run;
  run.finally(() => { if (catalogInFlight === run) catalogInFlight = null; });
  return run;
}

async function refreshCatalog(forceRefresh) {
  const previous = catalogCache?.value ?? null;
  const [antigravity, opencode] = await Promise.all([
    readAgyModels().catch((error) => { console.error(`Antigravity 型錄更新失敗：${cleanError(error)}`); return []; }),
    readOpenCodeModels(forceRefresh).catch((error) => { console.error(`OpenCode 型錄更新失敗：${cleanError(error)}`); return []; })
  ]);
  const fresh = {
    antigravity: antigravity
      .filter((model) => model.id === "gemini-3.6-flash-low")
      .map((model) => ({ ...model, source: "antigravity" })),
    opencode
  };
  // 逐來源保留舊資料，而不是整份一起判斷。舊版只在「兩邊都空」時才保留快取，
  // 所以 agy 成功、opencode 失敗的那一次會把好好的 opencode 清單覆蓋成空陣列，
  // 使用者接著看到的是「這個 OpenCode 免費模型目前不可用」——一句與真因
  // （型錄抓不到）毫無關係的錯誤。
  const value = {
    updatedAt: new Date().toISOString(),
    antigravity: fresh.antigravity.length ? fresh.antigravity : (previous?.antigravity ?? []),
    opencode: fresh.opencode.length ? fresh.opencode : (previous?.opencode ?? [])
  };
  catalogDegraded = !value.opencode.length;
  // 手上沒有任何可用清單時，這份「結果」只能算暫時的：把時間戳往回撥，
  // 讓它在 CATALOG_RETRY_MS 之後就過期重試，而不是霸佔 24 小時的快取期。
  catalogCache = {
    updatedAt: catalogDegraded ? Date.now() - CACHE_MS + CATALOG_RETRY_MS : Date.now(),
    value
  };
  // 空的型錄絕對不能寫進快取檔。舊版會把 `opencode: []` 連同「剛更新」的
  // 時間戳一起落檔，於是網路恢復之後的整整 24 小時，每一次翻譯都被擋在
  // 「模型目前不可用」——這正是使用者說的「連不到 opencode」。
  if (value.opencode.length || value.antigravity.length) {
    await writePersistentCache(catalogCache).catch(() => {});
  }
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
    const executable = await resolveExecutable("opencode");
    if (!executable) throw networkError;
    const args = ["models", "opencode", "--verbose", "--pure"];
    if (forceRefresh) args.push("--refresh");
    const { stdout } = await runCli(executable, args, {
      timeout: 90_000,
      idleTimeout: OPENCODE_IDLE_TIMEOUT_MS,
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
    ? runOpenCodeCli(body, buildOpenCodeCliArgs, OPENCODE_TRANSLATE_TIMEOUT_MS)
    : translateWithAgy(body);
}

// 影集教材用的自由格式輸出。跟 /translate 一樣只放行擴充功能自己會送的開頭，
// 避免這個本機端點變成任何人都能用的免費模型代理。
const ALLOWED_COMPLETION_PREFIXES = [
  "You are building English study notes"
];

async function completeWithAgy(body) {
  if (!paths.agy) throw new Error("尚未安裝 Antigravity CLI（agy）");
  const model = String(body?.model ?? "");
  const prompt = String(body?.prompt ?? "");
  if (!/^gemini-[a-z0-9._-]+$/i.test(model)) throw new Error("不支援的 Antigravity 模型");
  if (!ALLOWED_COMPLETION_PREFIXES.some((prefix) => prompt.startsWith(prefix))) {
    throw new Error("這個端點只接受影集學習的請求");
  }
  if (prompt.length > 120_000) throw new Error("內容過長");
  const allowed = await readAgyModels();
  if (!allowed.some((item) => item.id === model)) throw new Error("這個 Antigravity 模型目前不可用");
  const payload = await runAgy(model, prompt, {
    printTimeout: "4m",
    cwd: os.tmpdir(),
    timeout: 260_000,
    maxBuffer: 8 * 1024 * 1024
  });
  if (payload.status !== "SUCCESS") throw new Error(payload.error || payload.response || "Antigravity 生成失敗");
  return { text: String(payload.response ?? ""), model, usage: payload.usage ?? null };
}

async function completeWithSelectedCli(body) {
  return selectLocalCliProvider(body) === "opencode"
    ? runOpenCodeCli(body, buildOpenCodeCompletionCliArgs, OPENCODE_COMPLETE_TIMEOUT_MS)
    : completeWithAgy(body);
}

async function runOpenCodeCli(body, buildArgs, timeout) {
  const model = String(body?.model ?? "");
  const prompt = String(body?.prompt ?? "");
  // 參數檢查先做：使用者送錯東西不該推動短路器，也不該被當成 opencode 壞掉。
  const args = buildArgs(model, prompt);

  // 短路：連續失敗到門檻後，冷卻期間直接回一句說得出下一步的訊息，
  // 不再讓每一批字幕各自空等一次逾時。
  const open = openCodeCircuit.check();
  if (open) throw open;

  let executable = await resolveExecutable("opencode");
  if (!executable) {
    const missing = new OpenCodeError(
      OPENCODE_ERROR_CODES.CLI_NOT_FOUND,
      describeOpenCodeFailure(OPENCODE_ERROR_CODES.CLI_NOT_FOUND),
      { retryable: false }
    );
    openCodeCircuit.recordFailure(missing);
    throw missing;
  }

  await assertOpenCodeModelAllowed(model);

  let lastError = null;
  for (let attempt = 0; attempt <= OPENCODE_RETRY_ATTEMPTS; attempt += 1) {
    const outcome = await runCliRaw(executable, args, {
      cwd: os.tmpdir(),
      timeout,
      idleTimeout: OPENCODE_IDLE_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024
    });
    const text = outcome.spawnError || outcome.timedOut ? "" : parseOpenCodeRunText(outcome.stdout);
    // 成功的判準是「拿到文字」，不是「結束碼 0」——CLI 有時吐完內容才在
    // 收尾階段非零退出，那筆內容是好的，不該丟掉。
    if (text) {
      openCodeCircuit.recordSuccess();
      return { text, model, usage: null };
    }
    // 每一種失敗都走同一個分類器，包含分類器自己的 catch-all（UNKNOWN），
    // 否則「沒有數字可抓的未知錯誤」會整條繞過重試與短路。
    lastError = classifyOpenCodeFailure(outcome);
    // 執行檔在兩次呼叫之間被移走／升級：強制重找一次再試，不要直接放棄。
    if (lastError.code === OPENCODE_ERROR_CODES.CLI_NOT_FOUND) {
      const again = await resolveExecutable("opencode", { force: true });
      if (!again) break;
      // 找到了新的位置就換過去再試一次（升級／搬移會換路徑）；
      // 沒換位置就沒有再試一次的理由。
      if (again !== executable && attempt < OPENCODE_RETRY_ATTEMPTS) {
        executable = again;
        continue;
      }
      break;
    }
    if (!lastError.retryable || attempt >= OPENCODE_RETRY_ATTEMPTS) break;
    console.error(`OpenCode ${lastError.code}，重試第 ${attempt + 1} 次：${lastError.detail || lastError.message}`);
  }

  openCodeCircuit.recordFailure(lastError);
  throw lastError ?? new OpenCodeError(OPENCODE_ERROR_CODES.UNKNOWN, describeOpenCodeFailure(OPENCODE_ERROR_CODES.UNKNOWN));
}

// 型錄只有在「確定拿得到一份真的清單」時才可以拿來否決一個模型。
// 清單抓不到時仍然照送——因為模型 id 是使用者自己在選項頁選的，
// 拿一份空清單去否決它，等於把「型錄壞了」報成「模型不存在」，
// 使用者會照著錯誤訊息去換模型，然後換幾個都一樣壞。
async function assertOpenCodeModelAllowed(model) {
  let catalog = null;
  try {
    catalog = await getCatalog(false);
  } catch (error) {
    console.error(`OpenCode 型錄查詢失敗，改為放行使用者選定的模型：${cleanError(error)}`);
    return;
  }
  const list = catalog?.opencode ?? [];
  if (!list.length) {
    console.error("OpenCode 型錄目前是空的（降級模式），放行使用者選定的模型。");
    return;
  }
  if (list.some((item) => item.id === model)) return;
  throw new OpenCodeError(
    OPENCODE_ERROR_CODES.BAD_REQUEST,
    `「${model}」不在目前的 OpenCode 免費模型清單裡，請到選項頁重新整理模型清單並改選一個。`,
    { retryable: false }
  );
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

// 殺掉整個 process group，不是只殺直接子行程。
// 實測：opencode／agy 起的子行程（helper、sleep、node server）在只對直接子
// 行程送 SIGTERM 時會活下來變孤兒；逾時一次就留一批殘留行程在系統裡。
// 先 SIGTERM 給它收尾的機會，寬限期過了還在就 SIGKILL。
function killTree(child, { detached }) {
  const target = detached && child.pid ? -child.pid : child.pid;
  const send = (signal) => {
    if (!child.pid) return;
    try {
      process.kill(target, signal);
    } catch {
      // 行程已經不在（或 group 已消失）不算錯誤。
      try { child.kill(signal); } catch {}
    }
  };
  if (process.platform === "win32") {
    // Windows 沒有 process group 訊號，改用 taskkill 連同子孫一起結束。
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
        .on("error", () => { try { child.kill(); } catch {} });
    } catch {
      try { child.kill(); } catch {}
    }
    return;
  }
  send("SIGTERM");
  const grace = setTimeout(() => send("SIGKILL"), CLI_KILL_GRACE_MS);
  if (typeof grace.unref === "function") grace.unref();
  child.once("exit", () => clearTimeout(grace));
}

// 低階版本：永遠 resolve，把「發生了什麼」原封不動交給分類器。
// 舊版把 stdout 塞進 Error.message 當錯誤字串，於是 CLI 被砍掉時
// 使用者看到的是半截 JSON 事件行——既看不懂，又會被誤讀成模型的回答。
function runCliRaw(executable, args, options = {}) {
  return new Promise((resolve) => {
    const detached = process.platform !== "win32";
    const stdout = [];
    const stderr = [];
    let size = 0;
    let settled = false;
    let timedOut = false;
    let timeoutKind = "total";
    let timeoutMs = 0;
    const maxBuffer = options.maxBuffer || 4 * 1024 * 1024;
    const totalMs = options.timeout || 60_000;
    // 閒置逾時預設關閉（傳 0／不傳就只有總時長），有傳才啟用。
    const idleMs = Number(options.idleTimeout) || 0;

    let child;
    try {
      child = spawn(executable, args, {
        cwd: options.cwd,
        env: process.env,
        // 自成一個 process group，killTree 才殺得到子孫行程。
        detached,
        // 少了這個，Windows 每次呼叫 CLI 都會閃一個黑色主控台視窗。
        windowsHide: true,
        stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"]
      });
    } catch (spawnError) {
      return resolve({ stdout: "", stderr: "", exitCode: null, signal: null, timedOut: false, spawnError });
    }

    const finish = (patch) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      clearTimeout(idleTimer);
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode: null,
        signal: null,
        timedOut: false,
        timeoutKind,
        timeoutMs,
        spawnError: null,
        ...patch
      });
    };

    // 總時長：慢慢吐但永遠吐不完的情況。
    const totalTimer = setTimeout(() => {
      timedOut = true;
      timeoutKind = "total";
      timeoutMs = totalMs;
      killTree(child, { detached });
      finish({ timedOut: true, timeoutKind: "total", timeoutMs: totalMs });
    }, totalMs);

    // 閒置逾時：起來了卻一個位元組都不吐。這是「連不到 opencode」最典型的
    // 樣子（沒登入、卡在互動提示、模型排隊），等滿總時長毫無意義。
    let idleTimer = null;
    const bumpIdle = () => {
      if (!idleMs || settled) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        timedOut = true;
        timeoutKind = "idle";
        timeoutMs = idleMs;
        killTree(child, { detached });
        finish({ timedOut: true, timeoutKind: "idle", timeoutMs: idleMs });
      }, idleMs);
    };
    bumpIdle();

    if (options.input !== undefined) {
      // CLI 提早結束時寫入會噴 EPIPE，那不是我們要回報的錯誤。
      child.stdin.on("error", () => {});
      child.stdin.end(options.input);
    }

    const collect = (target) => (chunk) => {
      bumpIdle();
      size += chunk.length;
      if (size > maxBuffer) {
        killTree(child, { detached });
        finish({ exitCode: null, signal: "SIGTERM", stderrOverflow: true });
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", (spawnError) => finish({ spawnError }));
    // agy can leave a background helper holding the pipe open. Settle on the
    // main process exit, then explicitly release its streams.
    child.once("exit", (code, signal) => {
      child.stdout.destroy();
      child.stderr.destroy();
      if (timedOut) return;
      finish({ exitCode: code, signal });
    });
  });
}

// 相容層：舊呼叫端（agy、OCR、型錄）維持「成功 resolve、失敗 reject」的介面，
// 但底下已經換成有閒置逾時、有 process group 清理的版本。
function runCli(executable, args, options = {}) {
  return runCliRaw(executable, args, options).then((outcome) => {
    if (outcome.spawnError) throw outcome.spawnError;
    if (outcome.timedOut) throw new Error(`CLI timed out after ${outcome.timeoutMs} ms (${outcome.timeoutKind})`);
    const result = { stdout: outcome.stdout, stderr: outcome.stderr };
    if (outcome.exitCode === 0) return result;
    // agy 失敗時常常把原因印在 stdout 而不是 stderr。只看 stderr 的話
    // 使用者只會看到「CLI exited with 1」，完全無從查起。
    throw new Error(result.stderr || result.stdout || `CLI exited with ${outcome.exitCode ?? outcome.signal}`);
  });
}

async function isUsableExecutable(name, candidate) {
  try {
    await access(candidate);
    // 使用者用 IMMERSEFREE_<NAME>_PATH 明確指定的那一份，不再套用猜測用的
    // 白名單——他比我們清楚自己裝的是 .exe、.cmd 還是包裝腳本。
    if (process.env[`IMMERSEFREE_${String(name).toUpperCase()}_PATH`] === candidate) return true;
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
