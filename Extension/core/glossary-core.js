(function initializeGlossaryCore(global) {
  // 術語表通用層（W2-4）。
  //
  // 這個檔原本整份住在 core/subtitle-glossary-core.js 裡，只有字幕管線用得到。
  // 但「同一個詞在這份文件裡一律翻成同一個譯法」跟影片一點關係都沒有：
  // 網頁、PDF、劃詞、輸入框全部都需要。所以把與字幕無關的部分抽到這裡，
  // 字幕檔留一層薄轉接（對外 API 一個名字都沒變，呼叫端不必改）。
  //
  // 這一層負責的四件事：
  //   1. 術語物件的正規化（來源可能是模型、使用者手打、匯入的 JSON、預設庫）
  //   2. 髒 JSON 的無條件正規化解析（剝 code fence、修尾逗號）
  //   3. 命中判斷：只挑「這批原文真的出現過」的術語，不是整本字典
  //   4. 四個來源的優先序合併：全域釘選 > 使用者編輯 > 自動分析 > 預設庫
  //
  // 解析失敗一律丟例外由呼叫端靜默吞掉——術語表是加分項，不能讓翻譯掛掉。

  const GLOBAL_STORAGE_KEY = "immersefreeGlossaryGlobal";
  const MAX_VIDEO_TERMS = 40;
  // 升為全域服務之後這張表不再只是「幾個影片專有名詞」，而是使用者整份自訂
  // 術語庫（會匯入、會累積）。原本的 60 條上限會讓匯入 100 條的人靜默掉 40 條，
  // 匯出再匯入還對不起來，所以放寬到 300。命中制注入，條數多不等於 prompt 變長。
  const MAX_GLOBAL_TERMS = 300;
  // 一次翻譯最多帶這麼多命中術語進 prompt。命中一百個詞代表這段文字本來就
  // 是術語表，全塞進去只會把真正的原文擠掉。
  const MAX_PROMPT_TERMS = 40;
  const MAX_TERM_CHARS = 80;
  const MAX_DOMAIN_CHARS = 60;
  // 優先序：全域釘選 > 影片內使用者編輯 > 自動分析 > 預設庫。
  // 預設庫排最後——它是我們猜的，使用者說的一定贏。
  const ORIGIN_PRIORITY = { preset: 0, auto: 1, user: 2, global: 3 };

  function cleanValue(value, max) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  }

  // 回傳形狀刻意維持 {source, target, pinned, userEdited} 四個欄位，
  // disabled 與 domain **只有真的有值時才加**。既有測試對這個形狀做過
  // deepStrictEqual，無條件多塞欄位會讓字幕路徑的回歸測試整排紅，
  // 而那些紅燈跟這次的行為改變一點關係都沒有。
  function normalizeTerm(term, defaults = {}) {
    if (!term || typeof term !== "object") return undefined;
    const source = cleanValue(term.source ?? term.term ?? term.original, MAX_TERM_CHARS);
    const target = cleanValue(term.target ?? term.translation ?? term.zh, MAX_TERM_CHARS);
    if (!source || !target) return undefined;
    const normalized = {
      source,
      target,
      pinned: Boolean(term.pinned ?? defaults.pinned),
      userEdited: Boolean(term.userEdited ?? defaults.userEdited)
    };
    if (term.disabled ?? defaults.disabled) normalized.disabled = true;
    const domain = cleanValue(term.domain ?? defaults.domain, MAX_DOMAIN_CHARS);
    if (domain) normalized.domain = domain;
    return normalized;
  }

  function normalizeTerms(list, options = {}) {
    const max = Number.isFinite(options.max) ? options.max : MAX_VIDEO_TERMS;
    const seen = new Set();
    const terms = [];
    for (const item of Array.isArray(list) ? list : []) {
      const term = normalizeTerm(item, options);
      if (!term) continue;
      const key = term.source.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      terms.push(term);
      if (terms.length >= max) break;
    }
    return terms;
  }

  function normalizeGlossary(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      domain: cleanValue(source.domain, MAX_DOMAIN_CHARS),
      terms: normalizeTerms(source.terms, { max: MAX_VIDEO_TERMS })
    };
  }

  function stripCodeFence(text) {
    let value = String(text ?? "").trim();
    if (!value.startsWith("```")) return value;
    value = value.replace(/^```[A-Za-z]*[ \t]*\r?\n?/, "");
    const fence = value.lastIndexOf("```");
    if (fence >= 0) value = value.slice(0, fence);
    return value.trim();
  }

  // 無條件正規化再解析。只在 JSON.parse throw 之後才修，就永遠看不到「合法但
  // 結構不對」那一類（2026-07-17 教訓），所以這一步不看解析結果，一律先跑。
  function normalizeJsonText(text) {
    let value = stripCodeFence(text);
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start >= 0 && end > start) value = value.slice(start, end + 1);
    // 尾逗號是模型最常見的壞法：{"a":1,} / [1,2,]。
    value = value.replace(/,(\s*[}\]])/g, "$1");
    return value.trim();
  }

  // 回傳 {domain, terms}。terms 是空陣列也算成功——這份內容就是沒有專有名詞，
  // 存起來才不會每次進來都重打一次分析。
  function parseGlossaryJson(text) {
    const normalized = normalizeJsonText(text);
    if (!normalized) throw new Error("術語分析沒有回傳內容");
    let parsed;
    try {
      parsed = JSON.parse(normalized);
    } catch {
      throw new Error("術語分析回傳格式異常：無法解析 JSON");
    }
    if (!parsed || typeof parsed !== "object") throw new Error("術語分析回傳格式異常：不是物件");
    return normalizeGlossary(parsed);
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // 只有「看起來像英文詞」的術語才需要詞邊界。中日韓沒有空白分詞，
  // 硬套詞邊界會一個都對不上。
  function isWordish(value) {
    return /^[A-Za-z0-9][A-Za-z0-9 '&.+-]*$/.test(String(value ?? ""));
  }

  // 刻意不用 lookbehind：Safari 舊版不支援，整條路徑會靜默失效。
  // 改成把前後那個非字母數字字元一起吃進來，只判斷有沒有命中。
  function buildTermMatcher(source) {
    const escaped = escapeRegExp(source);
    if (!isWordish(source)) return new RegExp(escaped, "i");
    return new RegExp(`(^|[^A-Za-z0-9])${escaped}($|[^A-Za-z0-9])`, "i");
  }

  function termAppearsIn(source, haystack) {
    const text = String(haystack ?? "");
    if (!source || !text) return false;
    try {
      return buildTermMatcher(source).test(text);
    } catch {
      return text.toLowerCase().includes(String(source).toLowerCase());
    }
  }

  // 每批翻譯只帶「本批原文真的有出現」的術語。整本字典塞進去等於每一批
  // 都多付幾百個 token，而且無關術語會干擾模型。停用的一律不算命中——
  // 使用者按下「停用」的意思就是「不要再套這條」，不是「先留著等下再說」。
  function matchTerms(terms, texts) {
    const list = Array.isArray(texts) ? texts : [texts];
    const haystack = list.map((item) => String(item ?? "")).join("\n");
    if (!haystack.trim()) return [];
    return (Array.isArray(terms) ? terms : [])
      .filter((term) => term && term.source && term.target && !term.disabled
        && termAppearsIn(term.source, haystack));
  }

  // 優先序：全域釘選 > 影片／文件內使用者編輯 > 自動分析 > 預設庫。
  // 同一個 source 只留最高的那個。
  function resolveEffectiveTerms(input = {}) {
    const byKey = new Map();
    const add = (term, origin) => {
      const normalized = normalizeTerm(term, {});
      if (!normalized) return;
      const key = normalized.source.toLowerCase();
      const previous = byKey.get(key);
      if (previous && ORIGIN_PRIORITY[previous.origin] >= ORIGIN_PRIORITY[origin]) return;
      const resolved = {
        source: normalized.source,
        target: normalized.target,
        pinned: origin === "global" ? true : normalized.pinned,
        origin
      };
      if (normalized.disabled) resolved.disabled = true;
      if (normalized.domain) resolved.domain = normalized.domain;
      byKey.set(key, resolved);
    };
    // 由低到高疊：後面的 origin 優先序較高才蓋得掉前面的。
    for (const term of Array.isArray(input.presetTerms) ? input.presetTerms : []) {
      add(term, "preset");
    }
    for (const term of Array.isArray(input.videoTerms) ? input.videoTerms : []) {
      add(term, term?.userEdited ? "user" : "auto");
    }
    for (const term of Array.isArray(input.globalTerms) ? input.globalTerms : []) {
      add(term, "global");
    }
    return [...byKey.values()].sort((a, b) => ORIGIN_PRIORITY[b.origin] - ORIGIN_PRIORITY[a.origin]);
  }

  // 自動分析的結果不得蓋掉使用者釘選或編輯過的項目。
  function mergeAnalyzedTerms(existingTerms, analyzedTerms) {
    const kept = normalizeTerms(existingTerms).filter((term) => term.pinned || term.userEdited);
    const seen = new Set(kept.map((term) => term.source.toLowerCase()));
    const merged = [...kept];
    for (const term of normalizeTerms(analyzedTerms)) {
      const key = term.source.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(term);
    }
    return merged.slice(0, MAX_VIDEO_TERMS);
  }

  // 存檔時用：改過譯法或新加的列標成 userEdited，之後自動分析就動不了它。
  function markUserEdits(originalTerms, nextTerms) {
    const before = new Map(normalizeTerms(originalTerms).map((term) => [term.source.toLowerCase(), term]));
    return normalizeTerms(nextTerms).map((term) => {
      const previous = before.get(term.source.toLowerCase());
      const changed = !previous || previous.target !== term.target;
      return { ...term, userEdited: Boolean(term.userEdited) || changed };
    });
  }

  async function readGlobalGlossary(storage) {
    if (!storage) return [];
    try {
      const stored = await storage.get(GLOBAL_STORAGE_KEY);
      const value = stored?.[GLOBAL_STORAGE_KEY];
      const list = Array.isArray(value) ? value : value?.terms;
      return normalizeTerms(list, { max: MAX_GLOBAL_TERMS, pinned: true, userEdited: true });
    } catch {
      return [];
    }
  }

  async function writeGlobalGlossary(storage, terms, now = Date.now()) {
    const normalized = normalizeTerms(terms, { max: MAX_GLOBAL_TERMS, pinned: true, userEdited: true });
    if (!storage) return normalized;
    await storage.set({ [GLOBAL_STORAGE_KEY]: { terms: normalized, updatedAt: now } });
    return normalized;
  }

  // ─────────────────────────────── 全域服務（W2-4 新增）

  // 網頁／PDF／劃詞共用的一支：把「使用者的全域術語」與「預設庫」按優先序
  // 疊起來，再挑本批命中的。回傳的是可以直接丟進 prompt 的最小集合。
  //
  // 為什麼在這裡做而不是在內容腳本做：內容腳本有好幾個（page/pdf/selection），
  // 每個都自己撈一次 storage、自己挑一次術語的話，三份邏輯遲早分岔，
  // 而且分岔的症狀是「網頁有套術語、劃詞沒有」這種很難察覺的不一致。
  function selectTermsForTexts(input = {}) {
    const effective = resolveEffectiveTerms({
      presetTerms: input.presetTerms,
      globalTerms: input.globalTerms,
      videoTerms: input.videoTerms
    });
    const limit = Number.isFinite(input.max) ? input.max : MAX_PROMPT_TERMS;
    return matchTerms(effective, input.texts ?? []).slice(0, limit);
  }

  // 內容腳本自己的記憶體快取要的「術語維度」。回傳的兩個欄位就是
  // page-translation-cache 的 requestScope 直接吃得下的形狀，所以劃詞的快取鍵
  // 與背景頁走的是同一套公式，不是另外發明一份。
  //
  // 為什麼不像背景頁那樣直接算命中的預設庫條目：預設庫 536 條放在
  // core/glossary-presets.js，那支檔**不在**內容腳本清單裡（每個網頁多載
  // 16KB 只為了算快取鍵不划算）。內容腳本手上只有「開了哪幾個領域」，
  // 就用它當那一份的指紋——粗，但方向對：改了勾選一律重翻。
  //
  // 總開關關掉時兩個欄位都是空的，key 於是回到「沒有術語表」那一版，
  // 與 W2-4 之前逐字相同。
  function glossaryCacheScope(input = {}) {
    const settings = input.settings ?? {};
    if (!settings.glossaryEnabled) return { glossary: [], presetDomains: [] };
    return {
      glossary: matchTerms(input.terms, input.texts ?? []),
      presetDomains: settings.glossaryPresetsEnabled
        ? (Array.isArray(settings.glossaryPresetDomains) ? settings.glossaryPresetDomains : [])
          .map((id) => String(id ?? "").trim())
          .filter(Boolean)
        : []
    };
  }

  // ─────────────────────────────── 匯入匯出

  const EXPORT_FORMAT = "immersefree-glossary";

  // 匯出的是「使用者自己建立的那一份」，不含預設庫——預設庫在程式碼裡，
  // 每個人裝上就有，寫進檔案只會讓檔案變大又造成「我的術語表怎麼多出 536 條」。
  function buildGlossaryExport(terms, meta = {}) {
    return JSON.stringify({
      format: EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date(Number.isFinite(meta.at) ? meta.at : Date.now()).toISOString(),
      appVersion: String(meta.appVersion ?? ""),
      terms: normalizeTerms(terms, { max: MAX_GLOBAL_TERMS })
    }, null, 2);
  }

  function parseGlossaryImport(text) {
    let payload;
    try {
      payload = JSON.parse(String(text ?? ""));
    } catch {
      throw new Error("這不是有效的 JSON 檔");
    }
    // 也收「就是一個陣列」的檔案：使用者自己用試算表整理出來的術語表通常
    // 長這樣，硬要求包一層 format 只會讓人卡在第一步。
    const list = Array.isArray(payload) ? payload : payload?.terms;
    if (!Array.isArray(list)) throw new Error("這不是 ImmerseFree 的術語表檔");
    if (!Array.isArray(payload) && payload?.format && payload.format !== EXPORT_FORMAT) {
      throw new Error("這不是 ImmerseFree 的術語表檔");
    }
    return normalizeTerms(list, { max: MAX_GLOBAL_TERMS });
  }

  // ─────────────────────────────── prompt 片段

  // 字幕與網頁共用同一個組裝函式，只有抬頭那句不同。兩邊各寫一份的話，
  // 改了一邊忘了另一邊，症狀是「網頁的術語表模型看不懂」——很難查。
  function glossaryPromptLines(terms, heading) {
    const list = (Array.isArray(terms) ? terms : [])
      .filter((term) => term && term.source && term.target && !term.disabled);
    if (!list.length) return [];
    const lines = [heading];
    for (const term of list) lines.push(`  ${term.source} -> ${term.target}`);
    return lines;
  }

  const glossaryCore = Object.freeze({
    GLOBAL_STORAGE_KEY,
    MAX_VIDEO_TERMS,
    MAX_GLOBAL_TERMS,
    MAX_PROMPT_TERMS,
    MAX_TERM_CHARS,
    ORIGIN_PRIORITY,
    EXPORT_FORMAT,
    cleanValue,
    normalizeTerm,
    normalizeTerms,
    normalizeGlossary,
    stripCodeFence,
    normalizeJsonText,
    parseGlossaryJson,
    isWordish,
    termAppearsIn,
    matchTerms,
    resolveEffectiveTerms,
    mergeAnalyzedTerms,
    markUserEdits,
    readGlobalGlossary,
    writeGlobalGlossary,
    selectTermsForTexts,
    glossaryCacheScope,
    buildGlossaryExport,
    parseGlossaryImport,
    glossaryPromptLines
  });
  global.ImmerseFreeGlossaryCore = glossaryCore;
  if (typeof module !== "undefined" && module.exports) module.exports = glossaryCore;
})(globalThis);
