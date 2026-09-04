const MODEL_ID = /^[a-z0-9][a-z0-9._-]*$/i;

// OpenCode 的失敗要分得夠細，訊息才說得出下一步。以前全部混成一句
// 「OpenCode 沒有回傳文字」或直接把半截 JSON 丟給使用者，等於沒有診斷。
//
// 最重要的區分是「它沒回東西」（CLI_NOT_FOUND / CLI_TIMEOUT / CLI_CRASHED）
// 與「它回了但我看不懂」（BAD_OUTPUT）與「它回了，是模型自己拒絕」
// （MODEL_HTTP_ERROR）。三者的下一步完全不同：前者要修環境或重試，
// 中間要重試或換模型，後者重試只會再撞一次同一道牆。
export const OPENCODE_ERROR_CODES = Object.freeze({
  CLI_NOT_FOUND: "CLI_NOT_FOUND",
  CLI_TIMEOUT: "CLI_TIMEOUT",
  CLI_CRASHED: "CLI_CRASHED",
  BAD_OUTPUT: "BAD_OUTPUT",
  MODEL_HTTP_ERROR: "MODEL_HTTP_ERROR",
  CATALOG_UNAVAILABLE: "CATALOG_UNAVAILABLE",
  CIRCUIT_OPEN: "CIRCUIT_OPEN",
  BAD_REQUEST: "BAD_REQUEST",
  UNKNOWN: "UNKNOWN"
});

// 只有這幾類值得再試一次：它們代表「這一次沒接上」，不是「這個要求本身錯」。
// 模型自己回的 4xx 不在裡面——同樣的請求再送一次還是同一個 4xx。
// UNKNOWN 刻意列入：分類器漏接的未知錯誤多半是傳輸層抖動，
// 把 catch-all 排除在重試之外，會讓最需要自動恢復的情況反而沒有自動恢復。
const RETRYABLE = new Set([
  OPENCODE_ERROR_CODES.CLI_TIMEOUT,
  OPENCODE_ERROR_CODES.CLI_CRASHED,
  OPENCODE_ERROR_CODES.BAD_OUTPUT,
  OPENCODE_ERROR_CODES.UNKNOWN
]);

const SPAWN_MISSING = new Set(["ENOENT", "EACCES", "EPERM", "ENOTDIR", "ELOOP"]);

export class OpenCodeError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "OpenCodeError";
    this.code = code;
    this.detail = String(options.detail ?? "");
    this.retryable = options.retryable ?? RETRYABLE.has(code);
    this.httpStatus = Number(options.httpStatus) || 0;
    this.retryAfterSeconds = Number(options.retryAfterSeconds) || 0;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export function isRetryableOpenCodeCode(code) {
  return RETRYABLE.has(code);
}

export function buildOpenCodeCliArgs(model, prompt) {
  const id = String(model ?? "").trim();
  const text = String(prompt ?? "");
  if (!MODEL_ID.test(id)) throw badRequest("不支援的 OpenCode 模型");
  if (!text.startsWith("Translate every item") || text.length > 50_000) {
    throw badRequest("翻譯內容格式不正確");
  }
  return buildRunArgs(id, text);
}

export function buildOpenCodeCompletionCliArgs(model, prompt) {
  const id = String(model ?? "").trim();
  const text = String(prompt ?? "");
  if (!MODEL_ID.test(id)) throw badRequest("不支援的 OpenCode 模型");
  if (!text.startsWith("You are building English study notes") || text.length > 120_000) {
    throw badRequest("這個端點只接受影集學習的請求");
  }
  return buildRunArgs(id, text);
}

function badRequest(message) {
  return new OpenCodeError(OPENCODE_ERROR_CODES.BAD_REQUEST, message, { detail: message, retryable: false });
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

// 模型端的錯誤訊息裡通常夾著 HTTP 狀態碼（"AI_APICallError: 429 ..."）。
// 抓得到就用它決定「這是不是值得再試」；抓不到只代表不知道狀態，不代表沒事。
export function readOpenCodeHttpStatus(message) {
  const text = String(message ?? "");
  const explicit = text.match(/(?:status(?: code)?|http)[^0-9]{0,3}([0-9]{3})/i);
  if (explicit) return Number(explicit[1]);
  const bare = text.match(/(?:^|[^0-9])([45][0-9]{2})(?:[^0-9]|$)/);
  return bare ? Number(bare[1]) : 0;
}

export function readOpenCodeRetryAfter(message) {
  const text = String(message ?? "");
  const direct = text.match(/retry[- ]?after[^0-9]{0,4}([0-9]+)/i);
  if (direct) return Number(direct[1]);
  const phrase = text.match(/(?:try again|retry) in ([0-9]+) ?(second|minute|hour)/i);
  if (!phrase) return 0;
  const unit = phrase[2].toLowerCase();
  return Number(phrase[1]) * (unit === "hour" ? 3600 : unit === "minute" ? 60 : 1);
}

// 唯一的分類入口。所有失敗都要經過這裡，否則 catch-all 會把未知錯誤
// 變成沒有型別的字串，下游的重試與短路就整條失效。
export function classifyOpenCodeFailure(outcome = {}) {
  const {
    spawnError = null,
    timedOut = false,
    timeoutKind = "total",
    timeoutMs = 0,
    exitCode = null,
    signal = null,
    stdout = "",
    stderr = ""
  } = outcome;

  // Windows 的 CreateProcess 命令列上限是 32767 字元，而 prompt 是當作
  // argv 傳的。長批次在 Windows 會 spawn 失敗，在 Mac 上（~1MB）永遠測不到。
  // 這不是「連不到 opencode」，重試也沒有意義，訊息必須說對。
  if (spawnError && (String(spawnError.code || "") === "ENAMETOOLONG" || String(spawnError.code || "") === "E2BIG")) {
    return new OpenCodeError(
      OPENCODE_ERROR_CODES.BAD_REQUEST,
      "這批要翻譯的內容太長，超過作業系統對指令長度的上限（Windows 是 32767 字元）。"
        + "請到選項頁把每批字幕的數量調小，或改用其他翻譯引擎。",
      { detail: String(spawnError.message ?? ""), retryable: false, cause: spawnError }
    );
  }

  if (spawnError && SPAWN_MISSING.has(String(spawnError.code || ""))) {
    return new OpenCodeError(
      OPENCODE_ERROR_CODES.CLI_NOT_FOUND,
      describeOpenCodeFailure(OPENCODE_ERROR_CODES.CLI_NOT_FOUND, { detail: spawnError.message }),
      { detail: String(spawnError.message ?? ""), retryable: false, cause: spawnError }
    );
  }

  if (timedOut) {
    return new OpenCodeError(
      OPENCODE_ERROR_CODES.CLI_TIMEOUT,
      describeOpenCodeFailure(OPENCODE_ERROR_CODES.CLI_TIMEOUT, { timeoutMs, timeoutKind }),
      { detail: `${timeoutKind} timeout after ${timeoutMs} ms` }
    );
  }

  // 模型自己回報的錯誤優先於行程層的判斷：CLI 因為模型 429 而 exit 1 時，
  // 使用者該看到的是「額度／忙碌」，不是「CLI 掛了」。
  const modelMessage = readOpenCodeRunError(stdout) || readOpenCodeRunError(stderr);
  if (modelMessage) {
    const httpStatus = readOpenCodeHttpStatus(modelMessage);
    const retryAfterSeconds = readOpenCodeRetryAfter(modelMessage);
    return new OpenCodeError(
      OPENCODE_ERROR_CODES.MODEL_HTTP_ERROR,
      describeOpenCodeFailure(OPENCODE_ERROR_CODES.MODEL_HTTP_ERROR, { detail: modelMessage, httpStatus, retryAfterSeconds }),
      // 5xx 是對方暫時壞掉，值得再試；4xx（含 429）再送一次只會撞同一道牆。
      { detail: modelMessage, httpStatus, retryAfterSeconds, retryable: httpStatus >= 500 }
    );
  }

  if (spawnError) {
    return new OpenCodeError(
      OPENCODE_ERROR_CODES.UNKNOWN,
      describeOpenCodeFailure(OPENCODE_ERROR_CODES.UNKNOWN, { detail: spawnError.message }),
      { detail: String(spawnError.message ?? ""), cause: spawnError }
    );
  }

  if (signal || (exitCode !== null && exitCode !== 0)) {
    const detail = firstUsefulLine(stderr) || firstUsefulLine(stdout);
    return new OpenCodeError(
      OPENCODE_ERROR_CODES.CLI_CRASHED,
      describeOpenCodeFailure(OPENCODE_ERROR_CODES.CLI_CRASHED, { exitCode, signal, detail }),
      { detail }
    );
  }

  const bytes = String(stdout ?? "").length;
  const detail = firstUsefulLine(stdout) || firstUsefulLine(stderr);
  return new OpenCodeError(
    OPENCODE_ERROR_CODES.BAD_OUTPUT,
    describeOpenCodeFailure(OPENCODE_ERROR_CODES.BAD_OUTPUT, { bytes, detail }),
    { detail }
  );
}

// 半截 JSON 事件行對使用者毫無意義，而且會被誤讀成「模型的回答」。
// 只取第一行看得懂的訊息、跳過 JSON 事件、限制長度。
function firstUsefulLine(output) {
  for (const line of String(output ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) continue;
    return trimmed.slice(0, 200);
  }
  return "";
}

function seconds(ms) {
  return Math.max(1, Math.round(Number(ms || 0) / 1000));
}

// 每一句都要說得出「下一步做什麼」。只講發生什麼事等於沒講。
export function describeOpenCodeFailure(code, context = {}) {
  const detail = String(context.detail ?? "").slice(0, 200);
  switch (code) {
    case OPENCODE_ERROR_CODES.CLI_NOT_FOUND:
      return "找不到 opencode 指令。macOS 執行「brew install opencode」，Windows 執行「npm install -g opencode-ai」；"
        + "若已裝在其他位置，設定環境變數 IMMERSEFREE_OPENCODE_PATH 指到執行檔，或到選項頁改用別的翻譯引擎。";
    case OPENCODE_ERROR_CODES.CLI_TIMEOUT:
      return `opencode ${context.timeoutKind === "idle" ? "啟動後一直沒有輸出，" : ""}${seconds(context.timeoutMs)} 秒內沒有回應，已強制結束。`
        + "免費模型忙線時會這樣：稍後再試一次，或到選項頁換一個免費模型／改用其他引擎。";
    case OPENCODE_ERROR_CODES.CLI_CRASHED:
      return `opencode 執行到一半就結束了（${context.signal ? `被 ${context.signal} 中止` : `結束碼 ${context.exitCode}`}）。`
        + (detail ? `原始訊息：${detail}。` : "")
        + "先在終端機執行「opencode auth login」確認登入狀態；仍然失敗就到選項頁換一個引擎。";
    case OPENCODE_ERROR_CODES.BAD_OUTPUT:
      return `opencode 跑完了，但沒有吐出可用的翻譯內容（輸出 ${Number(context.bytes || 0)} 位元組）。`
        + (detail ? `原始訊息：${detail}。` : "")
        + "這通常是模型當下回了空白：直接重試一次，或到選項頁換一個免費模型。";
    case OPENCODE_ERROR_CODES.MODEL_HTTP_ERROR: {
      const status = Number(context.httpStatus) || 0;
      const wait = Number(context.retryAfterSeconds) || 0;
      return `免費模型回報錯誤${status ? `（HTTP ${status}）` : ""}：${detail || "沒有更多說明"}。`
        + "這是模型那一端的問題，不是本機連線問題："
        + (wait ? `約 ${wait} 秒後再試，` : "稍後再試，")
        + "或到選項頁換一個免費模型。";
    }
    case OPENCODE_ERROR_CODES.CATALOG_UNAVAILABLE:
      return "抓不到 OpenCode 免費模型清單，本機也沒有可用的快取。"
        + "請確認這台機器連得上 opencode.ai，或先到選項頁改用其他翻譯引擎；"
        + "清單恢復後模型選單會自動回填。";
    case OPENCODE_ERROR_CODES.CIRCUIT_OPEN:
      return `opencode 連續失敗 ${Number(context.failures || 0)} 次，已暫停 ${seconds(context.cooldownMs)} 秒不再空等。`
        + (detail ? `最後一次的原因：${detail}` : "")
        + `（約 ${seconds(context.remainingMs)} 秒後自動恢復；不想等就到選項頁換一個引擎。）`;
    case OPENCODE_ERROR_CODES.BAD_REQUEST:
      return detail || "OpenCode 請求格式不正確";
    default:
      return `opencode 呼叫失敗：${detail || "未知錯誤"}。已自動重試過一次仍不成功，請稍後再試或到選項頁換一個引擎。`;
  }
}

// 短路器：連續失敗到達門檻就停止繼續空等，冷卻期間直接回一句說得出下一步的訊息。
// 沒有這個的話，opencode 一旦壞掉（沒登入、被牆、CLI 版本不對），
// 每一批字幕都會各自空等一次逾時，使用者只感覺到「一直轉圈然後斷掉」。
export function createOpenCodeCircuit({ threshold = 3, cooldownMs = 60_000, now = () => Date.now() } = {}) {
  let failures = 0;
  // 用獨立的旗標而不是「openedAt 是不是 0」來判斷開合：時間戳 0 是合法時間，
  // 拿它當真假值會讓短路器在該開的時候看起來是關的（注入時鐘的測試抓到的）。
  let isOpen = false;
  let openedAt = 0;
  let lastError = null;

  return {
    check() {
      if (!isOpen) return null;
      const remainingMs = openedAt + cooldownMs - now();
      if (remainingMs <= 0) {
        isOpen = false;
        openedAt = 0;
        failures = 0;
        return null;
      }
      return new OpenCodeError(
        OPENCODE_ERROR_CODES.CIRCUIT_OPEN,
        describeOpenCodeFailure(OPENCODE_ERROR_CODES.CIRCUIT_OPEN, {
          failures,
          cooldownMs,
          remainingMs,
          detail: lastError?.message ?? ""
        }),
        { detail: lastError?.code ?? "", retryable: false, retryAfterSeconds: Math.ceil(remainingMs / 1000) }
      );
    },
    recordSuccess() {
      failures = 0;
      isOpen = false;
      openedAt = 0;
      lastError = null;
    },
    recordFailure(error) {
      // 使用者送錯東西不算 opencode 壞掉，不可以把短路器推開。
      if (error?.code === OPENCODE_ERROR_CODES.BAD_REQUEST) return;
      lastError = error ?? null;
      failures += 1;
      if (failures >= threshold) {
        isOpen = true;
        openedAt = now();
      }
    },
    state() {
      return { failures, open: isOpen, openedAt, cooldownMs, threshold, lastCode: lastError?.code ?? null };
    }
  };
}
