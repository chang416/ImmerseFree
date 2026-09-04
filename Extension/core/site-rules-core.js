(function initializeSiteRulesCore(global) {
  // ══════════════════════════════════════════════════════════════════════
  // 網站規則庫（W3-2）：per-site 的「翻哪裡、不翻哪裡、門檻多少」。
  //
  // 這一支是純函式層：驗證、比對、疊加。規則**內容**在 core/site-rules.json
  // （內建 25 條）與使用者設定 `userSiteRules`（一段 JSON 文字）。
  //
  // 三件事刻意分開，因為它們的失敗症狀完全不同：
  //   1. 驗證（validateRule）——欄位打錯字時要**當場講出來**。白名單制：
  //      不認得的欄位一律拒收，不是靜默忽略。靜默忽略的後果是使用者以為
  //      自己寫了規則、實際上一條都沒生效，而畫面上完全看不出來。
  //   2. 比對（matchRule）——網址對不對得上。三種形態（裸網域／完整 URL／
  //      萬用字元）語意不同，混在一起寫必定出現「以為會命中卻沒命中」。
  //   3. 疊加（resolveSiteRules）——同一個站可能被多條規則命中（內建一條、
  //      使用者一條）。使用者的**疊加**在內建之上，不是整組換掉；
  //      要換掉就寫沒有後綴的欄位，要加減就寫 `.add` / `.remove`。
  //
  // 授權紅線：schema 的欄位設計思路參考了對手擴充的 rule 格式（那是機制，
  // 不是內容），但 site-rules.json 裡每一條 selector 都是自寫，與
  // scratchpad/immersefree-v2/extracted/rules.json 的 selector 字串
  // 重疊率必須為 0（tests/site-rules-w3-2.test.cjs 腳本化把關）。
  // ══════════════════════════════════════════════════════════════════════

  // 選擇器類欄位：值是「選擇器字串」或「選擇器字串陣列」，並且支援
  // `.add` / `.remove` 後綴做疊加。
  const LIST_FIELDS = Object.freeze([
    // 白名單：只翻這些容器裡面的東西。空＝沿用預設的「找文字最多的
    // article/main/[role=main]，最後退回 body」。
    "selectors",
    // 黑名單：這些子樹整塊不翻（導覽列、投票鈕、版權宣告…）。
    "excludeSelectors",
    // 預設演算法之外**額外**納入的區塊（div/span 承載段落但 display 判定
    // 抓不到的少數情況）。
    "extraBlockSelectors",
    // 保留原文但允許與譯文並存（公式、化學式、貨幣代碼、程式碼片段）。
    "stayOriginalSelectors"
  ]);

  // 數值類欄位：直接覆寫，後面的規則蓋前面的。
  const NUMBER_FIELDS = Object.freeze(["minChars", "minWords", "urlChangeDelay"]);

  // 說明類欄位：不影響行為，但每條規則都該講得出「為什麼要有這條」。
  const TEXT_FIELDS = Object.freeze(["id", "note"]);

  // 疊加後綴。`.add` 追加、`.remove` 刪除。**沒有後綴＝整組覆寫**，
  // 那是明示的意圖；`.add`/`.remove` 才是疊加。
  const PATCH_SUFFIXES = Object.freeze([".add", ".remove"]);

  // 欄位白名單。這張表是唯一的真相：多一個欄位要同時想清楚
  // 「它怎麼疊加」與「page-translator 哪裡會讀它」，不能只是加進來。
  const ALLOWED_FIELDS = Object.freeze([
    ...TEXT_FIELDS,
    "matches",
    ...LIST_FIELDS,
    ...NUMBER_FIELDS,
    ...LIST_FIELDS.flatMap((field) => PATCH_SUFFIXES.map((suffix) => field + suffix))
  ]);

  const ALLOWED_FIELD_SET = new Set(ALLOWED_FIELDS);
  const LIST_FIELD_SET = new Set(LIST_FIELDS);
  const NUMBER_FIELD_SET = new Set(NUMBER_FIELDS);

  // 數值欄位的合理範圍。超出範圍是**拒收**不是夾住：`minChars: 100000`
  // 幾乎一定是打錯（多打了一個 0），夾成 5000 只會讓整站翻不出東西
  // 而使用者以為自己設的值生效了。
  const NUMBER_LIMITS = Object.freeze({
    minChars: { min: 0, max: 5000 },
    minWords: { min: 0, max: 500 },
    urlChangeDelay: { min: 0, max: 10000 }
  });

  const MAX_RULES = 500;
  const MAX_SELECTORS_PER_FIELD = 60;
  const MAX_SELECTOR_LENGTH = 200;
  const MAX_MATCHES_PER_RULE = 30;

  // ────────────────────────────────────────────────────────────── 工具

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  // 選擇器欄位一律正規化成「去重後的字串陣列」。逗號分隔的寫法也收，
  // 因為 CSS 本來就這樣寫，逼使用者拆成陣列只是多一個會犯的錯。
  function toSelectorList(value) {
    const raw = Array.isArray(value) ? value : [value];
    const out = [];
    for (const item of raw) {
      for (const part of String(item ?? "").split(",")) {
        const selector = part.trim();
        if (selector && !out.includes(selector)) out.push(selector);
      }
    }
    return out;
  }

  // 選擇器合法性只做「語法」檢查，不查它在某個網站上存不存在——後者無法
  // 離線判定。語法錯的選擇器丟給 querySelectorAll 會拋例外，而收集候選
  // 是在 try 之外，一條壞選擇器可以讓整頁翻不了，所以一定要擋在存檔前。
  function isValidSelectorSyntax(selector) {
    if (typeof selector !== "string") return false;
    const text = selector.trim();
    if (!text || text.length > MAX_SELECTOR_LENGTH) return false;
    // 有 DOM 就用 DOM 判（最準）；Node 環境退回保守的字元白名單。
    const doc = global.document;
    if (doc && typeof doc.createDocumentFragment === "function") {
      try {
        doc.createDocumentFragment().querySelector(text);
        return true;
      } catch {
        return false;
      }
    }
    // 沒有 DOM 時的保守判準：字元集白名單 ＋ 括號引號必須成對。
    // 只看字元集不夠——`div[unclosed` 的每個字元都合法，但它會讓
    // querySelectorAll 拋例外，而收集候選是在 try 之外，一條壞選擇器
    // 可以讓整頁翻不了。這裡寧可誤殺也不要誤放。
    if (!/^[\w\s.#>+~*\-[\]='":(),^$|/@]+$/.test(text)) return false;
    if (/[{};<>]{2,}/.test(text)) return false;
    const count = (char) => text.split(char).length - 1;
    if (count("[") !== count("]")) return false;
    if (count("(") !== count(")")) return false;
    if (count("'") % 2 !== 0 || count('"') % 2 !== 0) return false;
    return true;
  }

  function pushError(errors, path, message) {
    errors.push(`${path}：${message}`);
  }

  // ─────────────────────────────────────────────────── matches 三形態

  const MATCH_KIND = Object.freeze({
    DOMAIN: "domain",     // github.com          → 比 hostname（完全相等）
    URL: "url",           // https://a.com/b     → 比 protocol + host + path
    WILDCARD: "wildcard"  // *.wikipedia.org     → 萬用字元
  });

  function classifyMatch(pattern) {
    const text = String(pattern ?? "").trim();
    if (!text) return null;
    if (text.includes("*")) return MATCH_KIND.WILDCARD;
    if (text.includes("://")) return MATCH_KIND.URL;
    // 裸網域不含斜線：`github.com/x` 這種半套寫法一律當非法，因為它到底是
    // 「網域」還是「URL」沒有唯一答案，猜錯就是整條規則不命中。
    if (text.includes("/")) return null;
    return MATCH_KIND.DOMAIN;
  }

  const DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

  function validateMatchPattern(pattern) {
    const text = String(pattern ?? "").trim();
    const kind = classifyMatch(text);
    if (!kind) return "只接受三種形態：裸網域（example.com）、完整網址（https://example.com/path）、含 * 的萬用字元";
    if (kind === MATCH_KIND.DOMAIN) {
      return DOMAIN_PATTERN.test(text) ? null : "不是合法網域";
    }
    if (kind === MATCH_KIND.URL) {
      try {
        const url = new URL(text);
        if (!/^https?:$/.test(url.protocol)) return "完整網址只支援 http 與 https";
        return null;
      } catch {
        return "不是合法網址";
      }
    }
    // 萬用字元：至少要有一個固定字元，`*` 或 `*.*` 這種等於全站通吃，
    // 那不是 per-site 規則，是把預設值改掉，應該去改設定不是寫規則。
    if (!/[a-z0-9]/i.test(text.replace(/\*/g, ""))) return "萬用字元至少要有一段固定文字";
    return null;
  }

  // 把網址拆成比對用的三個面。拆不開（about:blank、非 http）就回 null，
  // 呼叫端一律當「沒有規則命中」。
  function parseTargetUrl(url) {
    try {
      const parsed = new URL(String(url ?? ""));
      if (!/^https?:$/.test(parsed.protocol)) return null;
      return {
        protocol: parsed.protocol.replace(":", "").toLowerCase(),
        // host 含 port（`example.com:8443`）；hostname 不含。兩個都留著：
        // 裸網域比 hostname（沒人會寫 port），完整網址比 host（會寫 port）。
        host: parsed.host.toLowerCase(),
        hostname: parsed.hostname.toLowerCase(),
        // 結尾斜線一律補上：`/about` 與 `/about/` 對使用者是同一頁，
        // 差一個斜線讓規則不命中是最難查的那種「規則寫了沒用」。
        path: normalizePath(parsed.pathname),
        href: `${parsed.protocol.replace(":", "").toLowerCase()}://${parsed.host.toLowerCase()}${normalizePath(parsed.pathname)}`
      };
    } catch {
      return null;
    }
  }

  function normalizePath(pathname) {
    const path = String(pathname ?? "/");
    if (!path.startsWith("/")) return `/${path}`;
    return path;
  }

  function samePath(a, b) {
    const trim = (value) => (value.length > 1 ? value.replace(/\/+$/, "") : value);
    return trim(a) === trim(b);
  }

  // 萬用字元轉正則。`*` 的意思隨比對面不同：
  //   * 只比 hostname 時 → `[^.\/]*`？不，會讓 `*.example.com` 不能命中
  //     `a.b.example.com`。用 `[^/]*`：不跨路徑，但可以跨子網域層級。
  //   * 比到路徑時 → `.*`（路徑裡的斜線本來就該被跨過）。
  //
  // `*.example.com` **不得命中裸網域** `example.com`：靠的是模式裡那個
  // 字面的點——`[^/]*\.example\.com` 要求 example 前面一定有一個點，
  // 而 hostname「example.com」沒有。這不是特例處理，是轉譯規則的自然結果，
  // 所以不會因為以後改別的地方而失效（測試仍然逐條把關）。
  function wildcardToRegExp(pattern, { crossSlash }) {
    const star = crossSlash ? ".*" : "[^/]*";
    const source = String(pattern)
      .split("*")
      .map((chunk) => chunk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(star);
    return new RegExp(`^${source}$`, "i");
  }

  // 單一 pattern 對單一網址。回傳 true/false，永不拋例外——一條寫壞的
  // 規則不該讓整頁翻不了。
  function matchPattern(pattern, target) {
    if (!target) return false;
    const text = String(pattern ?? "").trim();
    const kind = classifyMatch(text);
    if (!kind) return false;
    if (kind === MATCH_KIND.DOMAIN) {
      // 裸網域＝hostname 完全相等。**不含子網域**：要涵蓋子網域就寫
      // `*.example.com`，兩條都要就兩條都寫。這是刻意的——「裸網域要不要
      // 順便命中子網域」沒有直覺上的唯一答案，選一邊並寫清楚比猜使用者
      // 的意圖安全。
      return target.hostname === text.toLowerCase();
    }
    if (kind === MATCH_KIND.URL) {
      let parsed;
      try {
        parsed = new URL(text);
      } catch {
        return false;
      }
      if (parsed.protocol.replace(":", "").toLowerCase() !== target.protocol) return false;
      if (parsed.host.toLowerCase() !== target.host) return false;
      return samePath(normalizePath(parsed.pathname), target.path);
    }
    // 萬用字元。模式含 `://` 或 `/` → 比到路徑；否則只比 hostname。
    try {
      if (text.includes("://")) {
        return wildcardToRegExp(text, { crossSlash: true }).test(target.href);
      }
      if (text.includes("/")) {
        return wildcardToRegExp(text, { crossSlash: true }).test(`${target.host}${target.path}`);
      }
      return wildcardToRegExp(text, { crossSlash: false }).test(target.hostname);
    } catch {
      return false;
    }
  }

  function matchRule(rule, url) {
    const target = typeof url === "string" ? parseTargetUrl(url) : url;
    if (!target || !rule) return false;
    const patterns = Array.isArray(rule.matches) ? rule.matches : [rule.matches];
    return patterns.some((pattern) => matchPattern(pattern, target));
  }

  // ────────────────────────────────────────────────────────── 驗證

  // 一條規則的驗證。回傳 { valid, errors, rule }；rule 是正規化後的副本
  // （選擇器欄位都變成陣列、數值都變成整數），呼叫端只認這一份。
  function validateRule(input, { path = "rule" } = {}) {
    const errors = [];
    if (!isPlainObject(input)) {
      pushError(errors, path, "規則必須是物件");
      return { valid: false, errors, rule: null };
    }
    const rule = {};
    for (const [key, value] of Object.entries(input)) {
      if (!ALLOWED_FIELD_SET.has(key)) {
        // 白名單制。訊息要指名那個欄位，因為使用者最常犯的錯是欄位打錯字
        // （`excludeSelector` 少一個 s），而那種錯若被靜默忽略，
        // 症狀是「規則明明存了卻完全沒作用」。
        // 不在這裡整串列出可用欄位：選項頁的說明就在文字框正上方，
        // 訊息裡再抄一份會變成一行三百字，把真正的重點（哪個欄位錯）推出畫面。
        pushError(errors, `${path}.${key}`, "不是可用欄位（可用欄位見文字框上方說明）");
        continue;
      }
      if (value === undefined || value === null) continue;
      rule[key] = value;
    }

    // id：必填，是「這條規則叫什麼」，錯誤訊息與疊加去重都靠它。
    const id = String(rule.id ?? "").trim();
    if (!id) pushError(errors, `${path}.id`, "必填");
    else if (!/^[\w.:-]{1,60}$/.test(id)) pushError(errors, `${path}.id`, "只接受英數字、底線、點、冒號、減號，最長 60 字");

    if (rule.note !== undefined && typeof rule.note !== "string") {
      pushError(errors, `${path}.note`, "必須是字串");
    }

    // matches：必填。空陣列等於「永遠不命中」，那條規則存在只會誤導人。
    const rawMatches = rule.matches === undefined
      ? []
      : (Array.isArray(rule.matches) ? rule.matches : [rule.matches]);
    if (!rawMatches.length) pushError(errors, `${path}.matches`, "必填，至少一個網域或網址");
    if (rawMatches.length > MAX_MATCHES_PER_RULE) {
      pushError(errors, `${path}.matches`, `最多 ${MAX_MATCHES_PER_RULE} 個`);
    }
    const matches = [];
    rawMatches.forEach((pattern, index) => {
      if (typeof pattern !== "string") {
        pushError(errors, `${path}.matches[${index}]`, "必須是字串");
        return;
      }
      const problem = validateMatchPattern(pattern);
      if (problem) pushError(errors, `${path}.matches[${index}]`, problem);
      else {
        const text = pattern.trim();
        if (!matches.includes(text)) matches.push(text);
      }
    });

    const normalized = { id, matches };
    if (typeof rule.note === "string") normalized.note = rule.note.trim().slice(0, 200);

    for (const field of ALLOWED_FIELDS) {
      if (!(field in rule)) continue;
      const base = field.replace(/\.(add|remove)$/, "");
      if (!LIST_FIELD_SET.has(base)) continue;
      const list = toSelectorList(rule[field]);
      if (!list.length) {
        pushError(errors, `${path}.${field}`, "選擇器清單不可為空");
        continue;
      }
      if (list.length > MAX_SELECTORS_PER_FIELD) {
        pushError(errors, `${path}.${field}`, `最多 ${MAX_SELECTORS_PER_FIELD} 個選擇器`);
        continue;
      }
      const bad = list.filter((selector) => !isValidSelectorSyntax(selector));
      if (bad.length) {
        pushError(errors, `${path}.${field}`, `選擇器語法錯誤：${bad.join(" / ")}`);
        continue;
      }
      normalized[field] = list;
    }

    for (const field of NUMBER_FIELDS) {
      if (!(field in rule)) continue;
      const value = rule[field];
      const limit = NUMBER_LIMITS[field];
      // 字串不做隱式轉換。JSON 有真正的數字型別，寫成 "3" 幾乎一定是
      // 誤會（或是從別的格式手抄過來），默默收下只會讓下一個看規則的人
      // 以為字串也可以，然後某天寫成 "3 words" 就靜默變成預設值。
      if (typeof value !== "number" || !Number.isInteger(value)) {
        pushError(errors, `${path}.${field}`, "必須是整數（JSON 的數字型別，不要加引號）");
        continue;
      }
      if (value < limit.min || value > limit.max) {
        pushError(errors, `${path}.${field}`, `必須在 ${limit.min}–${limit.max} 之間`);
        continue;
      }
      normalized[field] = value;
    }

    // 同一條規則同時寫 `selectors` 與 `selectors.add` 沒有意義（前者整組
    // 覆寫、後者疊加），八成是使用者不確定哪個才對而兩個都寫了。
    for (const base of LIST_FIELDS) {
      const hasBase = base in normalized;
      const patched = PATCH_SUFFIXES.map((suffix) => base + suffix).filter((key) => key in normalized);
      if (hasBase && patched.length) {
        pushError(errors, `${path}.${base}`, `不要同時寫 ${base} 與 ${patched.join(" / ")}：前者整組覆寫、後者疊加，選一個`);
      }
    }

    return { valid: errors.length === 0, errors, rule: errors.length === 0 ? normalized : null };
  }

  // 一整組規則。id 重複要擋：兩條同 id 的規則在錯誤訊息裡分不出是哪一條。
  function validateRuleSet(input, { path = "rules", label = "規則" } = {}) {
    const errors = [];
    if (!Array.isArray(input)) {
      pushError(errors, path, `${label}必須是陣列`);
      return { valid: false, errors, rules: [] };
    }
    if (input.length > MAX_RULES) {
      pushError(errors, path, `最多 ${MAX_RULES} 條`);
      return { valid: false, errors, rules: [] };
    }
    const rules = [];
    const seenIds = new Set();
    input.forEach((item, index) => {
      const result = validateRule(item, { path: `${path}[${index}]` });
      errors.push(...result.errors);
      if (!result.rule) return;
      if (seenIds.has(result.rule.id)) {
        pushError(errors, `${path}[${index}].id`, `與前面的規則重複：${result.rule.id}`);
        return;
      }
      seenIds.add(result.rule.id);
      rules.push(result.rule);
    });
    return { valid: errors.length === 0, errors, rules };
  }

  // 使用者在選項頁貼的那一段文字。空字串＝沒有自訂規則（合法，不是錯誤）。
  // JSON 壞掉與規則欄位錯要分開講：前者是「這不是 JSON」，後者是
  // 「JSON 沒問題但第 2 條的 minChars 寫錯」——講錯了使用者會改錯地方。
  function parseUserRules(text) {
    const raw = String(text ?? "").trim();
    if (!raw) return { valid: true, errors: [], rules: [] };
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      return { valid: false, errors: [`這不是有效的 JSON：${error.message}`], rules: [] };
    }
    // 單一條規則直接貼進來也收：使用者只想改一個站的時候，逼他包一層
    // 陣列括號只是多一個會漏掉的步驟。
    const list = Array.isArray(payload) ? payload : [payload];
    return validateRuleSet(list, { path: "自訂規則", label: "自訂規則" });
  }

  // ────────────────────────────────────────────────────────── 疊加

  // 把一條（已驗證的）規則疊到累積結果上。
  //
  // 疊加語意（這是整個模組最容易被誤解的地方，所以寫清楚）：
  //   selectors: [...]         → 整組覆寫（明示意圖）
  //   selectors.add: [...]     → 在現有清單後面追加（不重複）
  //   selectors.remove: [...]  → 從現有清單刪掉指定項
  //   minChars / minWords / urlChangeDelay → 直接覆寫，後面的蓋前面的
  //
  // 順序：內建規則先、使用者規則後。所以使用者永遠贏，但**贏的方式**由
  // 他自己選：要疊就用 `.add`，要換整組才寫沒後綴的欄位。
  function applyRule(accumulated, rule) {
    const next = { ...accumulated };
    next.appliedIds = [...(accumulated.appliedIds ?? []), rule.id];
    for (const field of LIST_FIELDS) {
      let list = Array.isArray(next[field]) ? [...next[field]] : [];
      if (Array.isArray(rule[field])) list = [...rule[field]];
      const added = rule[`${field}.add`];
      if (Array.isArray(added)) {
        for (const selector of added) if (!list.includes(selector)) list.push(selector);
      }
      const removed = rule[`${field}.remove`];
      if (Array.isArray(removed)) {
        const drop = new Set(removed);
        list = list.filter((selector) => !drop.has(selector));
      }
      if (list.length) next[field] = list;
      else delete next[field];
    }
    for (const field of NUMBER_FIELDS) {
      if (typeof rule[field] === "number") next[field] = rule[field];
    }
    return next;
  }

  // 對某個網址算出「有效規則」。
  //
  // builtin 與 user 都接受「已驗證的規則陣列」或「原始資料」——原始資料
  // 會在這裡跑一次驗證並丟掉不合法的那幾條（執行期寧可少一條規則，
  // 也不要因為一條壞規則整站翻不了；驗證失敗的完整訊息在選項頁講）。
  function resolveSiteRules({ url, builtin = [], user = [], enabled = true } = {}) {
    const empty = { matched: false, appliedIds: [], rules: [] };
    if (!enabled) return empty;
    const target = parseTargetUrl(url);
    if (!target) return empty;
    const builtinRules = normalizeRuleInput(builtin);
    const userRules = normalizeRuleInput(user);
    const matched = [
      ...builtinRules.filter((rule) => matchRule(rule, target)),
      ...userRules.filter((rule) => matchRule(rule, target))
    ];
    if (!matched.length) return empty;
    let effective = { appliedIds: [] };
    for (const rule of matched) effective = applyRule(effective, rule);
    effective.matched = true;
    effective.rules = matched;
    return effective;
  }

  function normalizeRuleInput(value) {
    if (!Array.isArray(value)) return [];
    // 已經是正規化過的（selectors 是陣列且有 id/matches）就不必再跑一次；
    // 但判斷成本比重跑驗證低得多，而且重跑會把 `.add` 後綴欄位再驗一次，
    // 沒有壞處。這裡一律重跑，換取「進得去的一定是合法的」這個保證。
    return validateRuleSet(value, { path: "rules" }).rules;
  }

  // 把有效規則翻成 segmentation-core 認得的覆寫物件。
  //
  // 欄位名刻意不同：規則用 minChars / minWords（使用者看得懂「至少幾個字」），
  // segmentation-core 用 minTextCount / minWordCount（沿用它自己的命名）。
  // 中間這一層轉換就住在這裡，兩邊都不必知道對方的命名習慣。
  //
  // 三個選擇器欄位一律走 `extra*`（疊加），**不是** blockSelectors／
  // excludeSelectors（整組覆寫）——網站規則不該把「script/style 不翻」
  // 這種全站通用的排除清單弄掉。
  function toSegmentationOverrides(effective, base = {}) {
    const overrides = { ...base };
    if (!effective?.matched) return overrides;
    if (typeof effective.minChars === "number") overrides.minTextCount = effective.minChars;
    if (typeof effective.minWords === "number") overrides.minWordCount = effective.minWords;
    const join = (list) => list.join(",");
    if (effective.excludeSelectors?.length) {
      overrides.extraExcludeSelectors = joinExtra(base.extraExcludeSelectors, join(effective.excludeSelectors));
    }
    if (effective.extraBlockSelectors?.length) {
      overrides.extraBlockSelectors = joinExtra(base.extraBlockSelectors, join(effective.extraBlockSelectors));
    }
    if (effective.stayOriginalSelectors?.length) {
      overrides.extraStayOriginalSelectors = joinExtra(base.extraStayOriginalSelectors, join(effective.stayOriginalSelectors));
    }
    return overrides;
  }

  function joinExtra(existing, addition) {
    const left = String(existing ?? "").trim();
    if (!left) return addition;
    return `${left},${addition}`;
  }

  // 內建規則的載入。content script 拿不到 require，也不該把 25 條規則
  // 內聯進 JS（正本是 JSON，選項頁與測試都讀同一份），所以走
  // fetch(runtime.getURL(...))；manifest 的 web_accessible_resources
  // 必須放行 core/site-rules.json，否則 content script 讀不到。
  //
  // 失敗一律當「沒有內建規則」：規則檔讀不到不該讓整個翻譯功能停擺。
  async function loadBuiltinRules({ fetchImpl, url } = {}) {
    try {
      const doFetch = fetchImpl ?? global.fetch;
      if (typeof doFetch !== "function" || !url) return { rules: [], errors: ["沒有可用的載入方式"] };
      const response = await doFetch(url);
      if (!response?.ok) return { rules: [], errors: [`讀不到規則檔（HTTP ${response?.status ?? "?"}）`] };
      const payload = await response.json();
      const list = Array.isArray(payload) ? payload : payload?.rules;
      const result = validateRuleSet(Array.isArray(list) ? list : [], { path: "內建規則" });
      return { rules: result.rules, errors: result.errors };
    } catch (error) {
      return { rules: [], errors: [String(error?.message ?? error)] };
    }
  }

  const siteRulesCore = Object.freeze({
    ALLOWED_FIELDS,
    LIST_FIELDS,
    NUMBER_FIELDS,
    NUMBER_LIMITS,
    PATCH_SUFFIXES,
    MATCH_KIND,
    MAX_RULES,
    classifyMatch,
    validateMatchPattern,
    parseTargetUrl,
    matchPattern,
    matchRule,
    toSelectorList,
    isValidSelectorSyntax,
    validateRule,
    validateRuleSet,
    parseUserRules,
    applyRule,
    resolveSiteRules,
    toSegmentationOverrides,
    loadBuiltinRules
  });
  global.ImmerseFreeSiteRulesCore = siteRulesCore;
  if (typeof module !== "undefined" && module.exports) module.exports = siteRulesCore;
})(globalThis);
