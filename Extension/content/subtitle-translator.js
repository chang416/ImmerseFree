(function initializeSubtitleTranslator(global) {
  const bridge = global.ImmerseFree;
  const youtube = global.ImmerseFreeYouTubeSubtitles;
  const retry = global.ImmerseFreeSubtitleRetryCore;
  const streaming = global.ImmerseFreeStreamingSubtitles;
  const language = global.ImmerseFreeLanguage;
  const format = global.ImmerseFreeSubtitleFormat;
  const subtitleStoreCore = global.ImmerseFreeSubtitleStore;
  // 翻譯的單位是「語意句」不是「原始 cue」。播放器把一句話切成兩三段是為了
  // 排版，模型看到半句就翻不好；先合併再送翻，譯文寫回組內每個成員 cue。
  const mergeCore = global.ImmerseFreeSubtitleMerge;
  // 三層上下文（影片 / 術語 / 對話）與影片級術語表。兩個都是純函式模組，
  // 沒載到就退回舊的 {mode,title,previous}，字幕照翻。
  const contextCore = global.ImmerseFreeSubtitleContext;
  const glossaryCore = global.ImmerseFreeSubtitleGlossary;
  const DIALOGUE_LIMIT = contextCore?.DIALOGUE_LIMIT ?? 8;
  // 字幕批量（W2-3）：唯一來源在 core/batch-core.js。字幕的批比網頁小
  // （12 vs 16）——畫面正在等這一批回來，批越大第一句出現得越晚。
  // 0.7.0 這個數字在本檔寫死兩次（串流預取與 YouTube 預取），加上網頁層與
  // 背景頁共四處，改一處忘三處不會有任何錯誤訊息。
  const SUBTITLE_BATCH = global.ImmerseFreeBatchCore.batchProfile("subtitle");
  // 翻譯紀錄的權威來源。background 那份以字幕文字為 key 的記憶體快取留著
  // 當行程內去重，但「這句翻過沒有」一律問這裡——它認的是 cueId，
  // 不會讓兩支影片的同一句台詞互相覆蓋，SW 睡醒也還在。
  const subtitleStore = subtitleStoreCore?.createStore({ storage: bridge.api?.storage?.local });
  const SITE_SELECTORS = {
    "netflix.com": [
      "[data-uia='player-subtitle-text']",
      ".player-timedtext-text-container",
      ".player-timedtext"
    ],
    "disneyplus.com": [
      "[class*='subtitle-renderer']",
      "[class*='SubtitleRenderer']",
      "[class*='subtitle']"
    ],
    "youtube.com": [".ytp-caption-segment:not(.immersefree-youtube-translation)"]
  };

  let enabled = false;
  let timer;
  let lastCue = "";
  let requestNumber = 0;
  let settings = {};
  let overlay;
  const history = [];
  let emptyTicks = 0;
  let youtubeVideoKey = "";
  let youtubeCues = [];
  let youtubeCueIds = [];
  let youtubeTranslations = [];
  // 語意句。youtubeGroups[i] 是一整句，youtubeGroupIndexByCue[cueIndex] 指回它，
  // youtubeGroupMembers[i] 是這一句涵蓋哪些 cue（譯文要寫回每一個成員）。
  let youtubeGroups = [];
  let youtubeGroupIndexByCue = [];
  let youtubeGroupMembers = [];
  let youtubePrefetchState = "idle";
  let youtubePrefetchRetryAt = 0;
  let youtubeProviderCooldown;
  let youtubeResumeAfterBuffer = false;
  let youtubeSession = 0;
  let youtubePageBridgeReady;
  const youtubeLiveCache = new Map();
  const streamingCache = new Map();
  // 串流即時路徑手上只有字幕文字（readNativeCaption 沒有時間），
  // 要寫進紀錄就得靠預翻那一輪算好的 cueId 對回去。
  const streamingCueIdByText = new Map();
  let streamingSession = 0;
  let streamingPrefetchState = "idle";
  let streamingPrefetchCooldownUntil = 0;
  // ── 三層上下文的狀態 ──────────────────────────────────────
  // 影片層：DOM 查詢的結果快取起來，每批翻譯都重查一次太浪費。
  let videoInfoCache;
  // 術語層：videoGlossary 是這支影片的（自動分析 + 使用者編輯），
  // globalGlossaryTerms 是跨影片的釘選，effectiveTerms 是兩者按優先序合併後的結果。
  let videoGlossary = { domain: "", terms: [] };
  let globalGlossaryTerms = [];
  let effectiveTerms = [];
  // idle → running → done / failed。每支影片只分析一次；紀錄裡已經有就直接 done。
  let glossaryState = "idle";
  // 極短句：字太多、時間太短的語意句。以「原文」記而不是索引——background
  // 會重新分批，索引一定對不上。
  const compactGroupTexts = new Set();

  bridge.subtitleTranslator = {
    async start(nextSettings = {}) {
      settings = nextSettings;
      if (enabled) return;
      enabled = true;
      ensureNativeCaptions();
      if (isYouTube()) {
        youtubeVideoKey = currentYouTubeVideoKey();
        if (youtubeVideoKey) beginYouTubePrefetch();
      } else if (isStreamingSite()) beginStreamingPrefetch();
      else ensureOverlay();
      timer = setInterval(tick, 180);
      await tick();
    },
    stop() {
      enabled = false;
      // 關閉前把還在節流視窗裡的譯文寫出去，否則最後兩秒翻好的會消失。
      void subtitleStore?.flush();
      clearInterval(timer);
      timer = undefined;
      lastCue = "";
      history.length = 0;
      youtubeSession += 1;
      streamingSession += 1;
      resetYouTubeState();
      resetStreamingState();
      youtube?.removeNativeTranslation(document);
      streaming?.removeNativeTranslation(document);
      streaming?.forgetAnchor();
      overlay?.remove();
      overlay = undefined;
    },
    toggle(nextSettings = {}) {
      if (enabled) {
        this.stop();
        return false;
      }
      this.start(nextSettings);
      return true;
    },
    get enabled() { return enabled; }
  };

  async function tick() {
    if (!enabled) return;
    // 雙軌字幕優先。它是官方字幕、時間準、又不花額度，沒有理由讓 AI 翻譯
    // 蓋過去。在繪製層就攔住，切換瞬間殘留的排程也畫不出東西，
    // 所以畫面上永遠只會有一條中文。
    if (bridge.dualSubtitle?.getState().active) {
      bridge.subtitleTranslator.stop();
      return;
    }
    if (isYouTube()) {
      await tickYouTube();
      return;
    }
    if (isStreamingSite()) {
      await tickStreaming();
      return;
    }
    const cue = readCue();
    if (!cue) {
      emptyTicks += 1;
      if (emptyTicks === 12) render("", "尚未偵測到字幕，請先開啟影片字幕", "error");
      return;
    }
    emptyTicks = 0;
    if (cue === lastCue) return;
    lastCue = cue;
    const currentRequest = ++requestNumber;
    render(cue, "翻譯中…", "pending");
    try {
      const [translated] = await bridge.translate([cue], subtitleContext([cue]));
      if (currentRequest !== requestNumber || !enabled) return;
      history.push({ source: cue, translation: translated });
      if (history.length > 12) history.shift();
      render(cue, translated, "ready");
    } catch (error) {
      if (currentRequest !== requestNumber || !enabled) return;
      render(cue, error.message, "error");
    }
  }

  // 進影片、或 SW 睡醒重新注入時，先把整軌 cue 登記進紀錄並讀回已有的譯文。
  // 回傳的 cueId 陣列與傳入的 cue 一一對應，之後寫譯文都用它。
  // 失敗（storage 滿了、擴充功能剛更新）只會退回「全部重翻」，不擋播放。
  async function primeSubtitleStore(cues, { trackComplete } = {}) {
    const empty = cues.map(() => "");
    if (!subtitleStore || !subtitleStoreCore) return empty;
    const videoId = subtitleStoreCore.resolveVideoId(location.href);
    if (!videoId) return empty;
    try {
      await subtitleStore.open({
        videoId,
        title: document.title,
        sourceLang: settings.sourceLanguage ?? "",
        targetLang: settings.targetLanguage ?? ""
      });
      const ids = subtitleStore.recordCues(cues);
      if (trackComplete !== undefined) subtitleStore.setTrackComplete(Boolean(trackComplete));
      // 紀錄開好之後才讀得到這支影片的術語表；全域釘選也在這裡一起載入。
      await loadGlossary();
      return ids;
    } catch (error) {
      console.warn("ImmerseFree：字幕翻譯紀錄無法讀取，這一輪重新翻譯。", error);
      return empty;
    }
  }

  // 統計增量（W4-2）。送不出去只是少一個數字，不能影響字幕。
  function reportSubtitleMetrics(delta) {
    try {
      void bridge.sendMessage?.({ type: "IMMERSEFREE_RECORD_METRICS", metrics: delta })?.catch?.(() => {});
    } catch {
      // Service worker 正在重啟或擴充功能剛被重新載入。
    }
  }

  // 語意合併。回傳的 group 是「送翻」與「快取命中」的單位；
  // 同時把 sentenceGroupId 寫回紀錄——srt-core.groupCues 會照它併塊，
  // 所以匯出的 SRT 從此是一句一塊，不必再改匯出邏輯。
  function buildSentenceGroups(cues = [], cueIds = []) {
    const identified = cues.map((cue, index) => ({ ...cue, id: cueIds[index] || `cue-${index}` }));
    const groups = mergeCore?.mergeCues(identified)
      ?? identified.map((cue) => ({
        groupId: cue.id,
        startMs: cue.startMs,
        endMs: cue.endMs,
        text: cue.text,
        memberCueIds: [cue.id]
      }));
    // 語意合併率的計數點（W4-2）：合併後組數 / 原 cue 數。
    // 一支影片一則訊息（buildSentenceGroups 一支影片只跑一次）。
    if (identified.length) {
      reportSubtitleMetrics({ subtitleCues: identified.length, subtitleGroups: groups.length });
    }
    const groupIndexByCue = mergeCore?.buildGroupIndex(identified, groups)
      ?? identified.map((_cue, index) => index);
    const groupMembers = groups.map(() => []);
    groupIndexByCue.forEach((groupIndex, cueIndex) => {
      if (groupIndex >= 0) groupMembers[groupIndex].push(cueIndex);
    });
    if (subtitleStore && cueIds.some(Boolean)) {
      const groupIdByCueId = new Map();
      for (const group of groups) {
        for (const id of group.memberCueIds) groupIdByCueId.set(id, group.groupId);
      }
      try {
        subtitleStore.recordCues(identified.map((cue) => ({
          ...cue,
          sentenceGroupId: groupIdByCueId.get(cue.id) || cue.id
        })));
      } catch (error) {
        // 寫不進去只是匯出時少了併句，字幕照常翻。
        console.warn("ImmerseFree：語意句分組寫入紀錄失敗。", error);
      }
    }
    // 語意句是「畫面上會停留多久」的單位，極短句判定要在這裡做。
    registerCompactGroups(groups);
    // 影片術語表：整支影片一次。刻意不 await，翻譯迴圈不等它。
    void maybeAnalyzeGlossary(groups);
    return { groups, groupIndexByCue, groupMembers };
  }

  function videoDurationMs() {
    const duration = Number(document.querySelector("video")?.duration);
    return Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : 0;
  }

  // ── 第一層：影片資訊 ────────────────────────────────────────
  // document.title 在 YouTube 上是「標題 - YouTube」，在 Netflix 上只有
  // 「Netflix」，等於沒有資訊。各平台各自去問畫面拿真的標題／頻道／簡介，
  // 取不到的欄位就不要放進去（context core 會把空字串整個丟掉）。
  function firstText(selectors) {
    for (const selector of selectors) {
      let node;
      try {
        node = document.querySelector(selector);
      } catch {
        continue;
      }
      if (!node) continue;
      const raw = node.getAttribute?.("content") ?? node.textContent ?? "";
      const value = String(raw).replace(/\s+/g, " ").trim();
      if (value) return value;
    }
    return "";
  }

  function videoInfo() {
    if (videoInfoCache) return videoInfoCache;
    const info = {
      title: document.title,
      sourceLang: settings.sourceLanguage ?? "",
      targetLang: settings.targetLanguage ?? ""
    };
    if (isYouTube()) {
      info.title = firstText([
        "#title h1 yt-formatted-string",
        "h1.ytd-watch-metadata",
        "meta[name='title']"
      ]) || document.title;
      info.channel = firstText([
        "#owner #channel-name a",
        "ytd-channel-name#channel-name a",
        "#upload-info #channel-name a",
        "link[itemprop='name']"
      ]);
      // 簡介只有 YouTube 拿得到，而且只取前面一小段（context core 切 200 字）。
      info.description = firstText([
        "#description-inline-expander yt-attributed-string",
        "#description-inline-expander",
        "meta[name='description']"
      ]);
    } else if (isStreamingSite()) {
      // Netflix / Disney+ 沒有公開的頻道與簡介，只求標題。
      info.title = firstText([
        "[data-uia='video-title']",
        "[class*='title-field']",
        "meta[property='og:title']"
      ]) || document.title;
    }
    videoInfoCache = info;
    return info;
  }

  // ── 第二層：術語表 ──────────────────────────────────────────
  function refreshEffectiveTerms() {
    effectiveTerms = glossaryCore?.resolveEffectiveTerms({
      globalTerms: globalGlossaryTerms,
      videoTerms: videoGlossary.terms
    }) ?? [];
  }

  async function loadGlossary() {
    if (!glossaryCore) return;
    try {
      const stored = subtitleStore?.getGlossary();
      videoGlossary = glossaryCore.normalizeGlossary(stored);
      // 紀錄裡已經有術語表，就不要再打一次分析（每支影片只分析一次）。
      if (stored) glossaryState = "done";
      globalGlossaryTerms = await glossaryCore.readGlobalGlossary(bridge.api?.storage?.local);
      refreshEffectiveTerms();
    } catch (error) {
      console.warn("ImmerseFree：術語表讀取失敗，這一輪不套用術語。", error);
    }
  }

  // 整支影片只做一次的低頻分析。刻意不 await：它慢或它失敗都不能拖住字幕。
  async function maybeAnalyzeGlossary(groups = []) {
    if (!glossaryCore || glossaryState !== "idle" || !groups.length) return;
    if (!glossaryCore.shouldAnalyze({ groups })) return;
    glossaryState = "running";
    try {
      const samples = glossaryCore.collectAnalysisSamples(groups);
      if (samples.length < 3) {
        glossaryState = "idle";
        return;
      }
      const info = videoInfo();
      const response = await bridge.sendMessage({
        type: "IMMERSEFREE_ANALYZE_GLOSSARY",
        samples,
        title: info.title,
        channel: info.channel
      });
      const analyzed = glossaryCore.normalizeGlossary(response?.glossary);
      videoGlossary = {
        domain: analyzed.domain || videoGlossary.domain,
        // 使用者釘選／編輯過的項目優先，自動分析只補空位。
        terms: glossaryCore.mergeAnalyzedTerms(videoGlossary.terms, analyzed.terms)
      };
      subtitleStore?.setGlossary(videoGlossary);
      refreshEffectiveTerms();
      glossaryState = "done";
    } catch (error) {
      // 解析壞掉、額度用完、模型胡說——都只是這支影片沒有自動術語，
      // 翻譯照跑。失敗就不再重試，免得每一輪都白燒一次額度。
      glossaryState = "failed";
      console.warn("ImmerseFree：影片術語分析失敗，這一支影片不套用自動術語。", error);
    }
  }

  // ── 第三層 + 極短句 ─────────────────────────────────────────
  function registerCompactGroups(groups = []) {
    if (!contextCore) return;
    for (const text of contextCore.selectCompactTexts(groups)) compactGroupTexts.add(text);
  }

  // 每一次 bridge.translate 的 context 都從這裡出。
  function subtitleContext(texts = []) {
    const list = texts.map((text) => String(text ?? ""));
    if (!contextCore) {
      return { mode: "subtitle", title: document.title, previous: history.slice(-DIALOGUE_LIMIT) };
    }
    return contextCore.buildSubtitleContext({
      video: videoInfo(),
      // 只帶本批原文命中的術語，不是整本字典。
      terms: glossaryCore?.matchTerms(effectiveTerms, list) ?? [],
      dialogue: history.slice(-DIALOGUE_LIMIT),
      dialogueLimit: DIALOGUE_LIMIT,
      compactTexts: list.filter((text) => compactGroupTexts.has(text.trim()))
    });
  }

  function resetGlossaryState() {
    videoInfoCache = undefined;
    videoGlossary = { domain: "", terms: [] };
    effectiveTerms = [];
    glossaryState = "idle";
    compactGroupTexts.clear();
  }

  async function tickStreaming() {
    const caption = streaming?.readNativeCaption(document, location.hostname);
    if (!caption?.text) {
      emptyTicks += 1;
      if (emptyTicks > 12 && emptyTicks < 20) streaming?.removeNativeTranslation(document);
      // 以前偵測不到就默默什麼都不做，使用者只看到「按了沒反應」。
      // 至少要說清楚是缺了什麼、該做什麼。
      if (emptyTicks === 20) {
        streaming?.upsertNativeTranslation(
          document,
          undefined,
          "偵測不到播放器字幕。請先在播放器開啟任一語言的字幕，再開 AI 影片字幕。",
          "ai"
        );
      }
      if (emptyTicks === 60) streaming?.removeNativeTranslation(document);
      return;
    }
    if (emptyTicks >= 20) streaming?.removeNativeTranslation(document);
    emptyTicks = 0;
    beginStreamingPrefetch();
    if (language?.isAlreadyTargetLanguage(caption.text, settings.targetLanguage)) {
      streamingCache.set(caption.text, false);
      streaming?.removeNativeTranslation(document);
      return;
    }
    const cached = streamingCache.get(caption.text);
    if (cached === false) {
      streaming?.removeNativeTranslation(document);
      return;
    }
    if (typeof cached === "string") {
      streaming.upsertNativeTranslation(document, caption, cached, "ai");
      return;
    }
    if (retry?.isCoolingDown(cached)) {
      streaming.upsertNativeTranslation(document, caption, retry.cooldownMessage(cached), "ai");
      return;
    }
    streaming?.removeNativeTranslation(document);
    if (retry?.canRetryCue(cached) ?? !streamingCache.has(caption.text)) translateLiveStreamingCue(caption);
  }

  // 預翻來源（沉浸式翻譯那套）：優先用「播放器自己下載的字幕內容」。
  // 那份保證是現在這一集的完整台詞；textTracks 有東西的話也一併收。
  async function gatherStreamingCues() {
    const collected = streaming?.collectTextTrackCues(document) ?? [];
    try {
      const ask = bridge.pageChannel?.ask;
      if (ask && format) {
        const reply = await ask({ type: "IMMERSEFREE_REQUEST_CAPTURED_SUBS" }, 4000);
        for (const body of reply?.captured ?? []) {
          try {
            for (const cue of format.parseSubtitle(body.text, body.url, { ignoreTimestampMap: true })) {
              collected.push({ startMs: cue.start * 1000, endMs: cue.end * 1000, text: cue.text });
            }
          } catch {
            // 個別分段解析失敗不影響其他分段。
          }
        }
      }
    } catch {
      // 頁面通道還沒好就先用 textTracks 的。
    }
    const seen = new Set();
    return collected
      .filter((cue) => {
        if (!cue.text || seen.has(cue.text)) return false;
        seen.add(cue.text);
        return true;
      })
      .sort((a, b) => a.startMs - b.startMs);
  }

  async function beginStreamingPrefetch() {
    if (!isStreamingSite() || streamingPrefetchState !== "idle") return;
    if (Date.now() < streamingPrefetchCooldownUntil) return;
    streamingPrefetchCooldownUntil = Date.now() + 5000;
    streamingPrefetchState = "loading";
    const cues = await gatherStreamingCues();
    if (cues.length < 2) {
      streamingPrefetchState = "idle";
      return;
    }
    const session = ++streamingSession;
    // 紀錄裡已經有的譯文先回填進逐句快取，命中的句子這一輪不會再送翻譯。
    const cueIds = await primeSubtitleStore(cues, {
      trackComplete: subtitleStoreCore?.evaluateTrackCompleteness({ cues, durationMs: videoDurationMs() })
    });
    cues.forEach((cue, index) => {
      const id = cueIds[index];
      if (!id) return;
      streamingCueIdByText.set(cue.text, id);
      const stored = subtitleStore?.getTranslation(id);
      if (stored && !streamingCache.has(cue.text)) streamingCache.set(cue.text, stored);
    });
    // 先把碎 cue 併回語意句，之後整條路徑都以句子為單位（送翻、快取命中、寫回）。
    const { groups, groupMembers } = buildSentenceGroups(cues, cueIds);
    // 一句的譯文要寫回組內每個成員 cue：播到哪一段都看得到同一句完整中文。
    const setStreamingGroup = (groupIndex, value) => {
      for (const cueIndex of groupMembers[groupIndex]) {
        const cue = cues[cueIndex];
        if (!cue) continue;
        streamingCache.set(cue.text, value);
        if (typeof value === "string" && value) {
          subtitleStore?.recordTranslation(cueIds[cueIndex] || streamingCueIdByText.get(cue.text), value);
        }
      }
    };
    try {
      const currentTimeMs = Math.max(0, Number(document.querySelector("video")?.currentTime) || 0) * 1000;
      const indices = youtube?.prioritizeCueIndices(groups, currentTimeMs) ?? groups.map((_,index) => index);
      for (let offset=0; offset<indices.length; offset+=SUBTITLE_BATCH.maxItems) {
        if (!enabled || session !== streamingSession) return;
        const batch = indices.slice(offset,offset+SUBTITLE_BATCH.maxItems)
          .filter((groupIndex) => {
            if (language?.isAlreadyTargetLanguage(groups[groupIndex].text, settings.targetLanguage)) {
              setStreamingGroup(groupIndex, false);
              return false;
            }
            // 命中判斷以整句為單位：只要有成員還沒譯文，整句就重翻一次。
            return groupMembers[groupIndex].some((cueIndex) => !streamingCache.has(cues[cueIndex].text));
          });
        if (!batch.length) continue;
        batch.forEach((groupIndex) => setStreamingGroup(groupIndex, null));
        const batchTexts = batch.map((groupIndex) => groups[groupIndex].text);
        const translated = await bridge.translate(batchTexts, subtitleContext(batchTexts));
        if (!enabled || session !== streamingSession) return;
        batch.forEach((groupIndex,index) => {
          if (!translated[index]) return;
          setStreamingGroup(groupIndex, translated[index]);
          history.push({ source:groups[groupIndex].text, translation:translated[index] });
        });
        if (history.length > 12) history.splice(0, history.length-12);
      }
      streamingPrefetchState = "ready";
      // 播放器會隨播放進度持續下載新的字幕分段，過一陣子回到 idle 再收一輪。
      // 已翻過的句子都在快取裡，重跑只會處理新出現的，非常便宜。
      setTimeout(() => {
        if (streamingPrefetchState === "ready") streamingPrefetchState = "idle";
      }, 10000);
    } catch (error) {
      if (session !== streamingSession) return;
      const failed = retry?.createRetryEntry(error);
      for (const [cue,value] of streamingCache) {
        if (value === null) {
          if (failed) streamingCache.set(cue, failed);
          else streamingCache.delete(cue);
        }
      }
      streamingPrefetchState = "failed";
      setTimeout(() => {
        if (streamingPrefetchState === "failed") streamingPrefetchState = "idle";
      },5000);
      console.warn("ImmerseFree：無法預先翻譯串流字幕，改用逐句快取。",error);
    }
  }

  async function translateLiveStreamingCue(caption) {
    const session = streamingSession;
    streamingCache.set(caption.text, null);
    try {
      const [translated] = await bridge.translate([caption.text], subtitleContext([caption.text]));
      if (!enabled || session !== streamingSession) return;
      streamingCache.set(caption.text, translated);
      // 即時翻的這句若對得上預翻拿到的時間軸，就一起寫進紀錄；
      // 對不上（純即時字幕、沒有時間）就只留在記憶體，不亂編一個 cueId。
      subtitleStore?.recordTranslation(streamingCueIdByText.get(caption.text), translated);
      history.push({ source:caption.text, translation:translated });
      if (history.length > 12) history.shift();
      const current = streaming?.readNativeCaption(document,location.hostname);
      if (current?.text === caption.text) streaming.upsertNativeTranslation(document,current,translated,"ai");
    } catch (error) {
      if (!enabled || session !== streamingSession) return;
      const failed = retry?.createRetryEntry(error);
      if (failed) streamingCache.set(caption.text, failed);
      else streamingCache.delete(caption.text);
      const current = streaming?.readNativeCaption(document, location.hostname);
      if (current?.text === caption.text && retry?.isCoolingDown(failed)) {
        streaming.upsertNativeTranslation(document, current, retry.cooldownMessage(failed), "ai");
      }
      console.warn("ImmerseFree：串流字幕翻譯等待重試。",error);
    }
  }

  // 抓 YouTube 字幕時間軸，兩條路：
  //
  // 路一：自己打 timedtext。YouTube 現在常回「200 但空內容」——請求缺 pot
  // 權杖就這樣，所以絕不能直接 .json()，要先讀文字驗過再解。
  // 路二（沉浸式那套）：播放器自己打的 timedtext 帶有效權杖、一定有內容，
  // 頁面攔截器把它留下來了，直接拿來用。
  // 照抄沉浸式翻譯的做法：不等使用者開 CC，自己點播放器的字幕按鈕。
  // 點下去播放器就會帶著有效的 pot 權杖去抓 timedtext，攔截器把內容留下，
  // 我們就有整集的官方時間軸。找不到按鈕就用播放器 API。
  let captionsForceAt = 0;

  function ensureYouTubeCaptionsOn() {
    try {
      const button = document.querySelector(".ytp-subtitles-button");
      if (button) {
        const pressed = button.getAttribute("aria-pressed") === "true";
        if (!pressed) {
          button.click();
          return;
        }
        // 沉浸式的 force 手法：顯示已開但字幕視窗一直沒出現，代表播放器
        // 沒真的載入字幕軌——關掉再開一次會逼它重新抓 timedtext。
        const rendered = document.querySelector("#movie_player .ytp-caption-window-container");
        if (!rendered && Date.now() - captionsForceAt > 6000) {
          captionsForceAt = Date.now();
          button.click();
          setTimeout(() => {
            if (button.getAttribute("aria-pressed") !== "true") button.click();
          }, 150);
        }
        return;
      }
      const player = document.querySelector("#movie_player");
      player?.toggleSubtitles?.();
    } catch {
      // 播放器還沒好就算了，下一輪再試。
    }
  }

  function renderYouTubeLine(sourceText, translationText, state = "ready") {
    // YouTube 會回收並改寫 caption-window 內的任何 ytp-caption-segment，不能
    // 把中文插在原生字幕 DOM。字幕層直接附著播放器，由完整時間軸同時繪製
    // 原文與中文；小視窗和全螢幕都跟著 player 尺寸定位。
    youtube?.upsertPlayerSubtitle(document, sourceText, translationText, state);
  }

  async function fetchYouTubeCues(track, videoId, pageSource = "") {
    try {
      const response = await fetch(youtube.buildTimedTextUrl(track.baseUrl), { credentials: "same-origin" });
      if (response.ok) {
        const text = await response.text();
        const cues = youtube.parseJson3TranscriptText(text);
        if (cues.length) return cues;
      }
    } catch {
      // 換路二。
    }
    const ask = bridge.pageChannel?.ask;
    try {
      if (!ask) throw new Error("頁面字幕攔截器尚未就緒");
      const reply = await ask({ type: "IMMERSEFREE_REQUEST_CAPTURED_SUBS" }, 4000);
      // 新的在後面，倒著找，先用最近攔到的。
      for (const body of [...(reply?.captured ?? [])].reverse()) {
        if (!/\/api\/timedtext/.test(body.url)) continue;
        if (videoId) {
          try {
            if (new URL(body.url).searchParams.get("v") !== videoId) continue;
          } catch {
            continue;
          }
        }
        const cues = youtube.parseJson3TranscriptText(body.text);
        if (cues.length) return cues;
      }

    } catch {
      // 攔截得太晚就直接走完整字幕備援。
    }

    // YouTube 目前會讓網頁版 caption URL 帶 exp=xpe，沒有 PO Token 時回傳
    // 200 空內容。官方 Android 播放器回應仍會提供同一條完整字幕軌，而且
    // 不需要自行偽造 pot。這條路等同重新向播放器取得 captionTracks，不是
    // OCR，也不是逐句讀畫面。
    const androidCues = await fetchAndroidYouTubeCues(videoId, pageSource);
    if (androidCues.length) return androidCues;

    try {
      if (!ask) return [];
      // 如果攔截器注入得比較晚，response body hook 可能已經錯過播放器的
      // timedtext 回應，但 Resource Timing 還留著播放器真正使用過的完整網址。
      // 那個網址含 pot 權杖；從頁面情境用原始 fetch 重播它，才能拿到整集
      // JSON3 時間軸。這條路只讀字幕，不會變更影片播放進度。
      const tracks = await ask({ type: "IMMERSEFREE_REQUEST_STREAM_TRACKS" }, 4000);
      for (const url of [...(tracks?.subtitles ?? [])].reverse()) {
        if (!/\/api\/timedtext/.test(url)) continue;
        if (videoId) {
          try {
            if (new URL(url).searchParams.get("v") !== videoId) continue;
          } catch {
            continue;
          }
        }
        try {
          const fetched = await ask({
            type: "IMMERSEFREE_PAGE_FETCH",
            url: youtube.buildTimedTextUrl(url)
          }, 12000);
          if (!fetched?.ok) continue;
          const cues = youtube.parseJson3TranscriptText(fetched.text);
          if (cues.length) return cues;
        } catch {
          // 權杖可能剛好過期，繼續試較舊的候選或交回即時翻譯。
        }
      }
    } catch {
      // 三條路都沒有，回空陣列讓呼叫端改用即時翻譯。
    }
    return [];
  }

  async function fetchAndroidYouTubeCues(videoId, pageSource = "") {
    if (!videoId) return [];
    let source = pageSource || [...document.scripts].map((script) => script.textContent ?? "").join("\n");
    let apiKey = youtube?.extractInnertubeApiKey(source);
    if (!apiKey) {
      const response = await fetch(location.href, { credentials: "same-origin" });
      if (!response.ok) return [];
      source = await response.text();
      apiKey = youtube?.extractInnertubeApiKey(source);
    }
    if (!apiKey) return [];
    const playerResponse = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}&prettyPrint=false`,
      {
        method: "POST",
        credentials: "omit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
          videoId
        })
      }
    );
    if (!playerResponse.ok) return [];
    const track = youtube?.extractCaptionTrack(await playerResponse.json(), settings.sourceLanguage);
    if (!track?.baseUrl) return [];
    const transcriptUrl = new URL(track.baseUrl);
    transcriptUrl.searchParams.delete("fmt");
    const transcriptResponse = await fetch(transcriptUrl.href, { credentials: "omit" });
    if (!transcriptResponse.ok) return [];
    return youtube?.parseTranscriptXml(await transcriptResponse.text()) ?? [];
  }

  async function tickYouTube() {
    ensureNativeCaptions();
    const videoKey = currentYouTubeVideoKey();
    if (!videoKey) {
      if (youtubeVideoKey) resetYouTubeState();
      youtubeVideoKey = "";
      return;
    }
    if (videoKey && videoKey !== youtubeVideoKey) {
      resetYouTubeState();
      youtubeVideoKey = videoKey;
      beginYouTubePrefetch();
    }

    // 播放器插播與五秒倒數的覆蓋式廣告都不屬於主影片時間軸。
    // 預翻可以繼續在背景跑，但廣告存在時不要把主影片字幕蓋在廣告上。
    if (youtube?.isYouTubeAdVisible?.(document)) {
      youtube.removeNativeTranslation(document);
      return;
    }

    const video = document.querySelector("video");
    const currentTimeMs = Math.max(0, Number(video?.currentTime) || 0) * 1000;
    const cueIndex = youtube?.findCueIndex(youtubeCues, currentTimeMs) ?? -1;
    const nativeCue = youtube?.readNativeCue(document) ?? readCue();
    const sourceCue = cueIndex >= 0 ? youtubeCues[cueIndex]?.text ?? nativeCue : nativeCue;
    if (!sourceCue) {
      emptyTicks += 1;
      youtube?.removeNativeTranslation(document);
      if (emptyTicks === 12) ensureYouTubeCaptionsOn();
      // 預翻失敗後的重試不能只綁在「畫面上有字幕」的分支——字幕資料
      // （timedtext）常常比畫面渲染先到，或者根本只有資料沒有畫面。
      if (youtubePrefetchState === "failed" && Date.now() >= youtubePrefetchRetryAt) {
        youtubePrefetchRetryAt = Date.now() + 15000;
        beginYouTubePrefetch();
      }
      return;
    }
    emptyTicks = 0;
    // 預翻先前失敗，多半是當時 CC 還沒開、播放器還沒去抓 timedtext。
    // 現在畫面上有字幕了，代表播放器已經抓過、攔截器手上可能有貨——
    // 重試一次（20 秒內不重複），成功就不用再逐句燒額度。
    if (youtubePrefetchState === "failed" && Date.now() >= youtubePrefetchRetryAt) {
      youtubePrefetchRetryAt = Date.now() + 20000;
      beginYouTubePrefetch();
    }
    if (language?.isAlreadyTargetLanguage(sourceCue, settings.targetLanguage)) {
      youtube?.removeNativeTranslation(document);
      return;
    }
    if (cueIndex >= 0 && youtubeTranslations[cueIndex] === false) {
      renderYouTubeLine(sourceCue, "", "ready");
      return;
    }
    if (cueIndex >= 0 && youtubeTranslations[cueIndex]) {
      renderYouTubeLine(sourceCue, youtubeTranslations[cueIndex], "ready");
      return;
    }
    if (youtubePrefetchState === "failed" && showYouTubeCooldown(youtubeProviderCooldown, sourceCue)) return;
    if (youtubePrefetchState === "buffered" && cueIndex >= 0) {
      youtubePrefetchState = "loading";
      pauseYouTubeForBuffer();
    }
    if (youtubePrefetchState === "idle") beginYouTubePrefetch();
    renderYouTubeLine(
      sourceCue,
      youtubePrefetchState === "failed" ? "正在重新取得完整中文字幕…" : "正在準備前 30 秒中文字幕…",
      youtubePrefetchState === "failed" ? "error" : "pending"
    );
  }

  async function beginYouTubePrefetch() {
    if (!isYouTube() || !currentYouTubeVideoKey() || youtubePrefetchState === "loading") return;
    ensureYouTubeCaptionsOn();
    youtubePrefetchState = "loading";
    pauseYouTubeForBuffer();
    const session = ++youtubeSession;
    let translating = false;
    try {
      if (!youtubeCues.length) {
        let pageSource = [...document.scripts].map((script) => script.textContent ?? "").join("\n");
        let track = youtube?.extractCaptionTrack(pageSource, settings.sourceLanguage);
        if (!track) track = await requestPageWorldCaptionTrack();
        if (!track) {
          const response = await fetch(location.href, { credentials: "same-origin" });
          if (!response.ok) throw new Error(`YouTube 頁面回應 ${response.status}`);
          pageSource = await response.text();
          track = youtube?.extractCaptionTrack(pageSource, settings.sourceLanguage);
        }
        if (!track?.baseUrl) throw new Error("找不到 YouTube 字幕時間軸");
        const cues = await fetchYouTubeCues(track, currentYouTubeVideoKey(), pageSource);
        if (!cues.length) throw new Error("無法取得完整 YouTube 字幕時間軸");
        if (!enabled || session !== youtubeSession) return;
        youtubeCues = cues;
        youtubeTranslations = Array(cues.length);
        // timedtext 給的是整支影片的字幕軌，所以拿到就等於整軌在手，
        // 匯出時可以給完整 SRT。同時把上次翻好的譯文讀回來。
        youtubeCueIds = await primeSubtitleStore(cues, { trackComplete: true });
        if (!enabled || session !== youtubeSession) return;
        youtubeCueIds.forEach((id, index) => {
          const stored = id ? subtitleStore?.getTranslation(id) : "";
          if (stored) youtubeTranslations[index] = stored;
        });
      }

      // 語意句是送翻的單位，沒有它整個預翻迴圈會以為「沒有東西要翻」。
      // 上一輪若在取 cue 與分組之間被中斷（換影片、關閉再開），cue 會留著
      // 而分組是空的，所以這裡不放在上面那個 if 裡面，缺了就補算。
      if (youtubeCues.length && !youtubeGroups.length) {
        const grouped = buildSentenceGroups(youtubeCues, youtubeCueIds);
        youtubeGroups = grouped.groups;
        youtubeGroupIndexByCue = grouped.groupIndexByCue;
        youtubeGroupMembers = grouped.groupMembers;
      }

      while (enabled && session === youtubeSession) {
        const currentTimeMs = Math.max(0, Number(document.querySelector("video")?.currentTime) || 0) * 1000;
        const plan = youtube.buildBufferedCuePlan(youtubeCues, currentTimeMs, 30_000);
        // 緩衝計畫仍以 cue 為單位（顯示要按 cue 查），但送翻以句為單位，
        // 所以先把 cue 索引換成不重複的語意句索引。
        const pendingBuffer = pendingYouTubeGroups(plan.buffer);
        if (!pendingBuffer.length && youtubePrefetchState === "loading") {
          youtubePrefetchState = "buffered";
          youtubeProviderCooldown = undefined;
          resumeYouTubeAfterBuffer();
        }
        const buffered = new Set(pendingBuffer);
        const pending = [
          ...pendingBuffer,
          ...pendingYouTubeGroups(plan.remaining).filter((groupIndex) => !buffered.has(groupIndex))
        ];
        if (!pending.length) {
          youtubePrefetchState = "ready";
          youtubeProviderCooldown = undefined;
          resumeYouTubeAfterBuffer();
          return;
        }
        if (!enabled || session !== youtubeSession) return;
        const batchGroups = pending.slice(0, SUBTITLE_BATCH.maxItems).filter((groupIndex) => {
          if (!language?.isAlreadyTargetLanguage(youtubeGroups[groupIndex].text, settings.targetLanguage)) return true;
          markYouTubeGroup(groupIndex, false);
          return false;
        });
        if (!batchGroups.length) continue;
        translating = true;
        const batchTexts = batchGroups.map((groupIndex) => youtubeGroups[groupIndex].text);
        const translated = await bridge.translate(batchTexts, subtitleContext(batchTexts));
        if (!enabled || session !== youtubeSession) return;
        batchGroups.forEach((groupIndex, translatedIndex) => {
          const value = translated[translatedIndex];
          if (!value) return;
          markYouTubeGroup(groupIndex, value);
          history.push({ source: youtubeGroups[groupIndex].text, translation: value });
        });
        translating = false;
        youtubeProviderCooldown = undefined;
        if (history.length > 12) history.splice(0, history.length - 12);
      }
    } catch (error) {
      if (session !== youtubeSession) return;
      youtubePrefetchState = "failed";
      if (translating) {
        youtubeProviderCooldown = retry?.createRetryEntry(error);
        youtubePrefetchRetryAt = youtubeProviderCooldown?.retryAt ?? Date.now() + 60_000;
      } else {
        // 剛剛才觸發播放器抓 timedtext，內容要幾秒才會被攔到，8 秒後就重試。
        youtubePrefetchRetryAt = Date.now() + 8000;
        resumeYouTubeAfterBuffer();
      }
      console.warn("ImmerseFree：完整 YouTube 字幕預翻譯暫停，會保留進度後重試。", error);
    }
  }

  // cue 索引 → 尚未翻完的語意句索引（保持原順序、不重複）。
  // 一句只要有任何成員缺譯文就算未翻——譯文是整句寫回的，缺一塊代表上次沒寫完。
  function pendingYouTubeGroups(cueIndices = []) {
    const seen = new Set();
    const pending = [];
    for (const cueIndex of cueIndices) {
      const groupIndex = youtubeGroupIndexByCue[cueIndex];
      if (groupIndex === undefined || groupIndex < 0 || seen.has(groupIndex)) continue;
      seen.add(groupIndex);
      const members = youtubeGroupMembers[groupIndex] ?? [cueIndex];
      if (members.some((index) => youtubeTranslations[index] === undefined)) pending.push(groupIndex);
    }
    return pending;
  }

  // 整句的譯文寫回組內每個成員 cue，播到任何一段都顯示同一句完整中文。
  function markYouTubeGroup(groupIndex, value) {
    const members = youtubeGroupMembers[groupIndex] ?? [];
    for (const cueIndex of members) {
      youtubeTranslations[cueIndex] = value;
      if (typeof value === "string" && value) subtitleStore?.recordTranslation(youtubeCueIds[cueIndex], value);
    }
  }

  function pauseYouTubeForBuffer() {
    const video = document.querySelector("video");
    if (!video || video.paused !== false || typeof video.pause !== "function") return;
    youtubeResumeAfterBuffer = true;
    video.pause();
  }

  function resumeYouTubeAfterBuffer() {
    if (!youtubeResumeAfterBuffer) return;
    youtubeResumeAfterBuffer = false;
    const video = document.querySelector("video");
    if (!video || typeof video.play !== "function") return;
    Promise.resolve(video.play()).catch(() => {
      // 瀏覽器若因自動播放政策擋住，維持暫停，使用者按播放即可。
    });
  }

  async function requestPageWorldCaptionTrack() {
    try {
      await ensureYouTubePageBridge();
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const tracks = await new Promise((resolve) => {
        const timeout = setTimeout(() => finish([]), 1400);
        const onMessage = (event) => {
          if (event.source !== global || event.data?.type !== "IMMERSEFREE_YOUTUBE_CAPTION_TRACKS" || event.data.requestId !== requestId) return;
          finish(Array.isArray(event.data.tracks) ? event.data.tracks : []);
        };
        function finish(value) {
          clearTimeout(timeout);
          global.removeEventListener("message", onMessage);
          resolve(value);
        }
        global.addEventListener("message", onMessage);
        global.postMessage({ type: "IMMERSEFREE_REQUEST_YOUTUBE_CAPTION_TRACKS", requestId }, global.location.origin);
      });
      return youtube?.extractCaptionTrack({
        captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } }
      }, settings.sourceLanguage);
    } catch {
      return undefined;
    }
  }

  function ensureYouTubePageBridge() {
    if (youtubePageBridgeReady) return youtubePageBridgeReady;
    youtubePageBridgeReady = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = bridge.api.runtime.getURL("content/youtube-page-bridge.js");
      script.setAttribute("data-immersefree-extension-root", "youtube-page-bridge");
      script.addEventListener("load", () => { script.remove(); resolve(); }, { once: true });
      script.addEventListener("error", () => { script.remove(); reject(new Error("無法連接 YouTube 字幕資料")); }, { once: true });
      (document.head || document.documentElement).append(script);
    });
    return youtubePageBridgeReady;
  }

  function readCue() {
    const trackCue = readActiveTextTrack();
    if (trackCue) return trackCue;
    const selectors = Object.entries(SITE_SELECTORS)
      .find(([host]) => location.hostname === host || location.hostname.endsWith(`.${host}`))?.[1] ?? [];
    for (const selector of selectors) {
      const lines = [...document.querySelectorAll(selector)]
        .filter(isLikelySubtitleElement)
        .map((node) => cleanText(node.textContent))
        .filter(Boolean);
      const unique = [...new Set(lines)];
      if (unique.length) return cleanText(unique.join(" "));
    }
    return "";
  }

  function ensureNativeCaptions() {
    if (!isYouTube() || !currentYouTubeVideoKey()) return;
    const button = document.querySelector(".ytp-subtitles-button");
    if (button && button.getAttribute("aria-pressed") === "false" && !button.disabled) button.click();
  }

  function currentYouTubeVideoKey() {
    try {
      const url = new URL(location.href);
      if (!youtube?.isYouTubeVideoUrl(url.href)) return "";
      return url.searchParams.get("v") ?? url.pathname.match(/^\/(?:shorts|live|embed)\/([^/?]+)/)?.[1] ?? "";
    } catch {
      return "";
    }
  }

  function resetYouTubeState() {
    resumeYouTubeAfterBuffer();
    // 換影片前先把這一支的譯文寫出去，再清狀態。
    void subtitleStore?.flush();
    youtubeCues = [];
    youtubeCueIds = [];
    youtubeTranslations = [];
    youtubeGroups = [];
    youtubeGroupIndexByCue = [];
    youtubeGroupMembers = [];
    youtubePrefetchState = "idle";
    youtubePrefetchRetryAt = 0;
    youtubeProviderCooldown = undefined;
    youtubeLiveCache.clear();
    // 換影片＝換術語表、換影片資訊、換極短句清單。
    resetGlossaryState();
    youtube?.removeNativeTranslation(document);
  }

  function resetStreamingState() {
    void subtitleStore?.flush();
    streamingCache.clear();
    streamingCueIdByText.clear();
    streamingPrefetchState = "idle";
    resetGlossaryState();
    streaming?.removeNativeTranslation(document);
  }

  function showYouTubeCooldown(entry = youtubeProviderCooldown, sourceText = "") {
    if (!retry?.isCoolingDown(entry)) {
      if (entry === youtubeProviderCooldown) youtubeProviderCooldown = undefined;
      return false;
    }
    const message = retry.cooldownMessage(entry);
    if (entry.visibleMessage !== message) {
      entry.visibleMessage = message;
      renderYouTubeLine(sourceText, message, "cooldown");
    }
    return true;
  }

  function isYouTube() {
    return /(^|\.)youtube\.com$/.test(location.hostname);
  }

  function isStreamingSite() {
    return Boolean(streaming?.detectSite(location.hostname));
  }

  function readActiveTextTrack() {
    for (const video of document.querySelectorAll("video")) {
      for (const track of video.textTracks ?? []) {
        if (!track.activeCues?.length) continue;
        const text = [...track.activeCues].map((cue) => cleanText(cue.text)).filter(Boolean).join(" ");
        if (text) return text;
      }
    }
    return "";
  }

  function isLikelySubtitleElement(node) {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const text = cleanText(node.textContent);
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0 &&
      rect.top > innerHeight * 0.45 && text.length > 0 && text.length < 500;
  }

  function ensureOverlay() {
    overlay = document.createElement("div");
    overlay.setAttribute("data-immersefree-extension-root", "subtitle");
    overlay.className = "immersefree-subtitle-overlay";
    overlay.innerHTML = '<div class="immersefree-subtitle-original"></div><div class="immersefree-subtitle-translation"></div>';
    document.documentElement.append(overlay);
  }

  function render(original, translation, state) {
    ensureOverlayIfMissing();
    const originalNode = overlay.querySelector(".immersefree-subtitle-original");
    originalNode.hidden = !settings.showOriginalSubtitle;
    originalNode.textContent = original;
    const translationNode = overlay.querySelector(".immersefree-subtitle-translation");
    translationNode.textContent = translation;
    translationNode.dataset.state = state;
  }

  function ensureOverlayIfMissing() {
    if (!overlay?.isConnected) ensureOverlay();
  }

  function cleanText(value) {
    return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
})(globalThis);
