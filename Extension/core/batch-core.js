(function initializeBatchCore(global) {
  // ============================================================ 批量常數（W2-3）
  //
  // **這是全專案唯一寫著批量數字的地方。** 0.7.0 把 8 寫死在三處
  // （content/page-translator.js 的 chunk、content/subtitle-translator.js 的兩個
  // 預取迴圈、background.js 的 dispatchProvider），改一處忘兩處的結果是
  // 「網頁變快了、字幕沒有」——而且完全不會報錯。所以本波把它們收斂到這裡，
  // 並由 _work/w2-3-hygiene.cjs 做靜態掃描：batch-core 以外不得出現裸的
  // 8／12／16 當批量用。
  //
  // 數字的來源（對手 aiBatch，[T§2]）：
  //   itemsPerRequest: 16        → 網頁
  //   itemsPerRequestForSubtitle: 12 → 字幕（一批要更快回來，畫面在等）
  //   itemsPerRequestLimit: 32   → 任何覆寫的硬上限
  //   textLengthPerItem: 200     → **每項的字元預算**，不是「單段門檻」
  //
  // 最後那一條很容易誤讀，這裡寫清楚：對手 content_main.js 的
  // getTextLengthLimits() 裡是 `t = r * s`（r=itemsPerRequest、s=textLengthPerItem），
  // 也就是 200 是拿來乘出**整個請求的字元上限**的，不是「單段超過 200 就拆」。
  // 照字面理解會出事：一般網頁段落隨便就 250 字，每段都獨立成批的話請求數
  // 會暴增（實測長頁 fixture：4 次 → 25 次），與「請求數減半」完全相反。
  //
  // 所以這裡的語意是：
  //   maxItems      一批最多幾項
  //   maxChars      一批的總字元上限（沿用 0.7.0 的 6000，未動）
  //   soloItemChars 單項字數超過它就**獨立成批**——門檻取 maxItems × 200，
  //                 也就是「這一項已經吃掉整個請求的字元預算」，同批再放
  //                 別的東西只會逼模型截斷輸出。
  const ITEMS_PER_REQUEST = 16;
  const ITEMS_PER_REQUEST_FOR_SUBTITLE = 12;
  const ITEMS_PER_REQUEST_LIMIT = 32;
  const CHARS_PER_ITEM = 200;
  const MAX_CHARS_PER_REQUEST = 6000;

  function makeProfile(mode, maxItems) {
    return Object.freeze({
      mode,
      maxItems,
      maxChars: MAX_CHARS_PER_REQUEST,
      soloItemChars: maxItems * CHARS_PER_ITEM
    });
  }

  const BATCH_PROFILES = Object.freeze({
    page: makeProfile("page", ITEMS_PER_REQUEST),
    subtitle: makeProfile("subtitle", ITEMS_PER_REQUEST_FOR_SUBTITLE)
  });

  const BATCH_LIMITS = Object.freeze({
    ITEMS_PER_REQUEST,
    ITEMS_PER_REQUEST_FOR_SUBTITLE,
    ITEMS_PER_REQUEST_LIMIT,
    CHARS_PER_ITEM,
    MAX_CHARS_PER_REQUEST
  });

  // 字幕是唯一走另一組數字的模式；網頁／PDF／劃詞／懸停共用 page。
  // 認不得的 mode 一律回 page，不丟例外：批量選錯只是慢一點，
  // 丟例外會讓整頁翻不出來。
  function batchProfile(mode, overrides) {
    const base = mode === "subtitle" ? BATCH_PROFILES.subtitle : BATCH_PROFILES.page;
    if (!overrides || typeof overrides !== "object") return base;
    const maxItems = clampItems(overrides.maxItems, base.maxItems);
    return Object.freeze({
      mode: base.mode,
      maxItems,
      maxChars: clampPositive(overrides.maxChars, base.maxChars),
      // 覆寫了 maxItems 卻沒覆寫 soloItemChars 時，門檻要跟著走，
      // 否則「一批 32 項」配「單項 3200 字就獨立」會前後矛盾。
      soloItemChars: clampPositive(overrides.soloItemChars, maxItems * CHARS_PER_ITEM)
    });
  }

  function clampItems(value, fallback) {
    const number = Math.floor(Number(value));
    if (!Number.isFinite(number) || number < 1) return fallback;
    return Math.min(number, ITEMS_PER_REQUEST_LIMIT);
  }

  function clampPositive(value, fallback) {
    const number = Math.floor(Number(value));
    if (!Number.isFinite(number) || number < 1) return fallback;
    return number;
  }

  // ============================================================ 切批
  //
  // 網頁層（挑候選）與背景層（送 provider）共用同一支，切法才不會分岔：
  // 內容腳本以為送 16 項是一次請求，背景卻按 8 再切一次的話，
  // 請求數會是預期的兩倍，而兩邊各自看都「沒有錯」。
  //
  // sizeOf 讓呼叫端決定「一項有多長」：網頁層拿的是候選物件（要看 item.text，
  // 而且那是**含 W2-2 佔位符**的那一份，因為送出去的就是它），背景層拿的是字串。
  function planBatches(items, profile = BATCH_PROFILES.page, sizeOf = defaultSize) {
    const list = Array.isArray(items) ? items : [];
    const limits = profile ?? BATCH_PROFILES.page;
    const batches = [];
    let current = [];
    let characters = 0;
    const flush = () => {
      if (current.length) batches.push(current);
      current = [];
      characters = 0;
    };
    for (const item of list) {
      const length = Math.max(0, Number(sizeOf(item)) || 0);
      // 超長段落自己一批。放進混合批只會把整批推過模型的輸出上限，
      // 結果是這一批全部要重來（拆批救得回來，但等於白花一次請求）。
      if (length > limits.soloItemChars) {
        flush();
        batches.push([item]);
        continue;
      }
      if (current.length && (current.length >= limits.maxItems || characters + length > limits.maxChars)) {
        flush();
      }
      current.push(item);
      characters += length;
    }
    flush();
    return batches;
  }

  function defaultSize(item) {
    if (typeof item === "string") return item.length;
    return String(item?.text ?? "").length;
  }

  // ============================================================ 可靠批次
  //
  // 第 4 個參數同時吃兩種東西：數字（0.7.0 的舊呼叫法）與 profile 物件（W2-3）。
  // 兩種都留是為了讓 batch-core 可以單獨被測試與被舊呼叫點呼叫，不必一次改完。
  // 拆批率的計數點（W4-2）。batch-core 自己不記統計（它在背景頁與內容腳本
  // 都會載入，兩邊各記一次就會重複計數），只把「送出一批」與「拆了一批」
  // 兩件事交給註冊進來的人——沒有人註冊就完全不做事。
  // 做法與 provider-core.setProtocolListener 同一個模式。
  let batchListener = null;
  function setBatchListener(listener) {
    batchListener = typeof listener === "function" ? listener : null;
  }
  function notifyBatch(event) {
    if (!batchListener) return;
    try {
      batchListener(event);
    } catch {
      // 統計壞掉不該讓翻譯失敗。
    }
  }

  async function translateInReliableBatches(segments, context, translateBatch, batching = BATCH_PROFILES.page) {
    const profile = typeof batching === "number"
      ? batchProfile("page", { maxItems: batching, soloItemChars: Number.MAX_SAFE_INTEGER })
      : (batching ?? BATCH_PROFILES.page);
    const results = [];
    let rollingContext = context;
    for (const source of planBatches(segments, profile)) {
      // 分母：真的送出去的批數（拆批產生的子批不算，否則拆得越兇分母越大、
      // 拆批率反而越好看）。
      notifyBatch({ kind: "dispatch", size: source.length });
      const translated = await recoverCountMismatch(source, rollingContext, translateBatch);
      results.push(...translated);
      rollingContext = withPrevious(rollingContext, source, translated);
    }
    return results;
  }

  async function recoverCountMismatch(segments, context, translateBatch, formatRetries = 1) {
    try {
      return await translateBatch(segments, context);
    } catch (error) {
      const message = String(error?.message);
      const formatError = /模型回傳格式異常|JSON Parse error|Unexpected (?:identifier|token)/i.test(message);
      if (formatError && formatRetries > 0) {
        return recoverCountMismatch(segments, context, translateBatch, formatRetries - 1);
      }
      // 格式異常也要拆批，不能只重試後放棄。它最常見的成因是「這一批太長、
      // 輸出被截斷」——溫度是 0，原樣重打必然在同一個地方再斷一次；
      // 拆一半各自變短，輸出就完整了。這正是拆批最能救的情境。
      //
      // W2-3 之後這條路多了一個入口：id 協議偵測到漏號／重號／不認得的號碼時
      // 也丟 FORMAT_MISMATCH（訊息含「模型回傳格式異常」），所以「錯位」
      // 從「偵測不到」變成「走既有的拆批復原」，不必另寫一套救援。
      const recoverable = formatError || /Expected \d+ translations, received/.test(message);
      if (!recoverable) throw error;
      if (segments.length === 1) return translateBatch(segments, context);
      // 分子：真的拆了一次（上面兩個 return 都不是拆批）。
      notifyBatch({ kind: "split", size: segments.length });
      const midpoint = Math.ceil(segments.length / 2);
      const leftSource = segments.slice(0, midpoint);
      const rightSource = segments.slice(midpoint);
      const left = await recoverCountMismatch(leftSource, context, translateBatch, formatRetries);
      const right = await recoverCountMismatch(rightSource, withPrevious(context, leftSource, left), translateBatch, formatRetries);
      return [...left, ...right];
    }
  }

  function withPrevious(context, source, translated) {
    return {
      ...context,
      previous: [
        ...(context?.previous || []),
        ...source.map((text, index) => ({ source: text, translation: translated[index] }))
      ].slice(-8)
    };
  }

  const batchCore = Object.freeze({
    translateInReliableBatches,
    setBatchListener,
    planBatches,
    batchProfile,
    BATCH_PROFILES,
    BATCH_LIMITS
  });
  global.ImmerseFreeBatchCore = batchCore;
  // 讓 tests/*.test.cjs 直接 require（與 provider-core 同一個做法）。
  if (typeof module !== "undefined" && module.exports) module.exports = batchCore;
})(globalThis);
