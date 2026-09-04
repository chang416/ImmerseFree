(function initializeDualSubtitle(global) {
  // 雙軌字幕：不翻譯、不花 token。
  //
  // 串流平台的播放清單裡本來就同時列著所有語言的字幕，播放器只是一次掛一條。
  // 這支把「你沒選到的那條」自己抓下來，疊在原生字幕底下。時間碼是官方給的，
  // 所以兩行一定對得齊。字幕是純文字，沒有被 DRM 蓋住，抓得到。
  //
  // 依序試三條路，哪條通用哪條：
  //   1. 原生 textTracks（最省事，播放器有掛就直接讀）
  //   2. 攔到的播放清單（HLS 或 DASH）→ 解析 → 抓完整份
  //   3. 攔到的字幕檔網址（播放器已經抓過的，通常只有目前這條語言）
  const bridge = global.ImmerseFree;
  const format = global.ImmerseFreeSubtitleFormat;
  const manifestCore = global.ImmerseFreeManifestCore;
  const streaming = global.ImmerseFreeStreamingSubtitles;
  const language = global.ImmerseFreeLanguage;

  const PENDING = new Map();
  let requestCounter = 0;
  let snifferInjected = false;
  let cues = [];
  // 播放器自己下載的原生字幕，拼回時間軸後拿來對時。
  let nativeCues = [];
  // 「字幕檔時間軸」與 video.currentTime 的差。0 代表未校準或不需校準。
  let timeOffset = 0;
  let displayTimer = null;
  let session = 0;
  let restoreTextTrack;
  let state = { active: false, count: 0, source: "", language: "", detail: "" };

  // ---------------------------------------------------------------- 頁面橋接
  function injectSniffer() {
    if (snifferInjected) return;
    snifferInjected = true;
    const script = document.createElement("script");
    script.src = bridge.api.runtime.getURL("content/track-sniffer.js");
    script.setAttribute("data-immersefree-extension-root", "track-sniffer");
    script.addEventListener("load", () => script.remove());
    (document.head ?? document.documentElement).append(script);
  }

  global.addEventListener("message", (event) => {
    if (event.source !== global) return;
    const data = event.data;
    if (data?.type !== "IMMERSEFREE_STREAM_TRACKS" && data?.type !== "IMMERSEFREE_PAGE_FETCH_RESULT" && data?.type !== "IMMERSEFREE_CAPTURED_SUBS") return;
    const resolve = PENDING.get(data.requestId);
    if (!resolve) return;
    PENDING.delete(data.requestId);
    resolve(data);
  });

  function askPage(message, timeoutMs = 15000) {
    injectSniffer();
    const requestId = `immersefree-${++requestCounter}`;
    return new Promise((resolve) => {
      PENDING.set(requestId, resolve);
      setTimeout(() => {
        if (!PENDING.has(requestId)) return;
        PENDING.delete(requestId);
        resolve(null);
      }, timeoutMs);
      global.postMessage({ ...message, requestId }, global.location.origin);
    });
  }

  // 頁面通道開放給其他模組用（AI 影片字幕的預翻也要拿攔到的字幕內容）。
  bridge.pageChannel = { ask: askPage };

  async function fetchCapturedSubs() {
    const reply = await askPage({ type: "IMMERSEFREE_REQUEST_CAPTURED_SUBS" }, 4000);
    return Array.isArray(reply?.captured) ? reply.captured : [];
  }

  function languageFromSubtitleUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      for (const key of ["bcp47", "language", "lang", "locale"]) {
        const value = parsed.searchParams.get(key);
        if (value) return value;
      }
      const match = `${parsed.pathname}${parsed.hash}`.match(
        /(?:^|[\/_\-.])((?:zh|en|ja|ko|th|fr|de|es|it|pt|vi)(?:[-_][a-z]{2,4})?)(?:[\/_\-.]|$)/i
      );
      return match?.[1] ?? "";
    } catch {
      return "";
    }
  }

  function isNetflixSite() {
    return /(^|\.)netflix\.com$/i.test(String(location.hostname ?? ""));
  }

  // 一律透過頁面情境去抓。字幕網址帶簽章、綁 cookie，從擴充功能情境抓會拿到 403。
  async function pageFetch(url) {
    const reply = await askPage({ type: "IMMERSEFREE_PAGE_FETCH", url }, 20000);
    if (!reply?.ok) throw new Error(reply?.error ?? "抓取逾時");
    return reply.text;
  }

  // ---------------------------------------------------------------- 語言決定
  function currentNativeText() {
    return streaming?.readNativeCaption(document, location.hostname)?.text ?? "";
  }

  // 使用者在播放器裡選的字幕如果本來就是中文，再疊一行中文沒有意義，
  // 這時改配英文。判斷依據是實際顯示的那行字，不是播放器的設定。
  function decideSecondLanguage(settings) {
    const wanted = settings.dualSubtitleLanguage || "zh-Hant";
    const native = currentNativeText();
    if (native && language?.isAlreadyTargetLanguage(native, wanted)) {
      return settings.dualSubtitleFallbackLanguage || "en";
    }
    return wanted;
  }

  // ---------------------------------------------------------------- 取字幕
  // 路一：播放器自己掛在 <video> 上的字幕軌。有的話最省事，連網路都不用碰。
  function fromNativeTextTracks(video, wanted) {
    const tracks = [...(video?.textTracks ?? [])];
    if (!tracks.length) return null;
    const candidates = tracks.map((track) => ({
      track,
      language: track.language || "",
      label: track.label || "",
      forced: /forced/i.test(track.label || "")
    }));
    const picked = manifestCore.pickTrack(candidates, wanted);
    if (!picked) return null;
    // hidden 會讓瀏覽器繼續解析 cue 但不畫出來，正是我們要的：
    // 畫面上維持播放器自己那條，我們只是把資料讀走。
    const previousMode = picked.track.mode;
    if (previousMode === "disabled") picked.track.mode = "hidden";
    const list = [...(picked.track.cues ?? [])].map((cue) => ({
      start: cue.startTime,
      end: cue.endTime,
      text: String(cue.text ?? "").replace(/<[^>]*>/g, "").trim()
    })).filter((cue) => cue.text);
    if (!list.length) {
      picked.track.mode = previousMode;
      return null;
    }
    return {
      cues: format.normalizeCues(list),
      source: "原生字幕軌",
      language: picked.language,
      restore: previousMode === picked.track.mode
        ? undefined
        : () => { try { picked.track.mode = previousMode; } catch {} }
    };
  }

  // 路二：攔到的播放清單。抓得到 master 就等於拿到所有語言。
  //
  // 這裡採用沉浸式翻譯的思路：以「播放器自己下載過的字幕分段」為基準。
  // 那些分段保證屬於現在這一集，所以——
  //   1. 分段確實列在某份清單的字幕播放清單裡 → 那份清單就是這一集，確定性
  //      比對，不是猜的。預載下一集、殘留上一集的清單全都會被這關擋掉。
  //   2. 分段內容本身拼回時間軸 → 之後拿畫面上顯示的原生字幕來校準時間差。
  async function verifyManifestTracks(tracks, captured, video) {
    const capturedPaths = new Set(captured.map((entry) => manifestCore.urlPathOf(entry.url)).filter(Boolean));
    if (!capturedPaths.size) return { verdict: "unknown" };

    // 先試畫面文字可判斷出的語言，再試網址最接近的軌；最後才掃其餘軌。
    // 舊版只檢查一條「網址最像」的軌，Disney 各語言播放清單常共用同一段前綴，
    // 一旦平手就會挑到繁中而不是播放器正在用的英文，正確的同一集也被判成別集。
    const ordered = [];
    const add = (track) => { if (track && !ordered.includes(track)) ordered.push(track); };
    const nativeText = currentNativeText();
    for (const code of ["zh-Hant", "zh-Hans", "ja", "ko", "th", "en"]) {
      if (nativeText && language?.isAlreadyTargetLanguage(nativeText, code)) add(manifestCore.pickTrack(tracks, code));
    }
    add(manifestCore.pickTrackByUrlAffinity(tracks, captured.map((entry) => entry.url)));
    for (const track of tracks) add(track);

    const checked = [];
    for (const track of ordered) {
      try {
        if (track.kind === "hls") {
          const playlist = await pageFetch(track.playlistUrl);
          const segments = manifestCore.parseHlsMediaPlaylist(playlist, track.playlistUrl);
          checked.push({ track, segments });
          if (segments.some((segment) => capturedPaths.has(manifestCore.urlPathOf(segment.url)))) {
            return { verdict: "match", nativeSegments: segments };
          }
          continue;
        }
        if (track.kind === "dash-single" && capturedPaths.has(manifestCore.urlPathOf(track.fileUrl))) {
          return { verdict: "match" };
        }
      } catch {
        // 單一語言軌失效不代表整份 master 錯，繼續試別軌。
      }
    }

    // Disney 會把同一字幕切到另一個 CDN。若網址比不到，用攔到的原生字幕內容
    // 與候選原生軌交叉驗證；至少兩個有意義的句子一致（資料只有一句時則一個）
    // 才承認，短口頭禪不算，仍能擋掉播放器預載的下一集。
    const capturedCues = captured.flatMap((entry) => format.parseSubtitle(entry.text, entry.url));
    const evidenceCount = manifestCore.countSubtitleTextOverlap(capturedCues, capturedCues);
    if (evidenceCount) {
      const required = Math.min(2, evidenceCount);
      for (const item of checked.slice(0, 3)) {
        try {
          const savedFailures = lastFetchFailures;
          const list = await collectSegments(item.segments);
          lastFetchFailures = savedFailures;
          const overlap = manifestCore.countSubtitleTextOverlap(capturedCues, list);
          if (overlap >= required && matchesVideo(list, video).ok) {
            return { verdict: "content-match", nativeCues: list };
          }
        } catch {
          // 內容驗證失敗就維持 mismatch，不降低成猜測。
        }
      }
    }
    return { verdict: "mismatch" };
  }

  async function fromManifests(sniffed, wanted, video) {
    const errors = [];
    const captured = await fetchCapturedSubs();

    // Netflix 常把完整語言清單放在 JSON metadata，而不是 HLS/DASH manifest。
    // 先走這條 direct timed-text 路徑；拿到的 TTML 使用同一份格式解析器，
    // 不翻譯、不花模型額度，時間碼直接沿用 Netflix 的 media timeline。
    if (isNetflixSite()) {
      const metadataResolved = await fromNetflixMetadata(sniffed.metadata ?? [], wanted, video);
      if (metadataResolved?.cues?.length) return metadataResolved;
      if (metadataResolved?.errors?.length) errors.push(...metadataResolved.errors);
    }

    const hintUrls = [...(sniffed.subtitles ?? []), ...captured.map((entry) => entry.url)];
    const ranked = manifestCore.rankManifests(sniffed.manifests ?? [], hintUrls);

    const candidates = [];
    for (const url of ranked) {
      try {
        const text = await pageFetch(url);
        const isDash = /\.mpd(\?|$)/i.test(url) || /<MPD[\s>]/i.test(text.slice(0, 400));
        const tracks = isDash
          ? manifestCore.parseDashManifest(text, url)
          : manifestCore.parseHlsMaster(text, url);
        if (!tracks.length) continue;
        const picked = manifestCore.pickTrack(tracks, wanted);
        if (!picked) {
          errors.push(`${shortUrl(url)} 有 ${tracks.length} 條字幕軌但沒有 ${wanted}`);
          continue;
        }
        // 確定性驗證：這份清單「播放器正在用的那條軌」的分段清單裡，
        // 有沒有列出我們實際攔到的分段？有 → 就是這一集，不用再看別份。
        const verification = await verifyManifestTracks(tracks, captured, video);
        candidates.push({ url, isDash, picked, ...verification });
        if (verification.verdict === "match" || verification.verdict === "content-match") break;
      } catch (error) {
        errors.push(`${shortUrl(url)}：${error.message}`);
      }
    }

    for (const candidate of candidates) {
      if (candidate.verdict === "mismatch") {
        errors.push(`${shortUrl(candidate.url)} 不含播放器正在用的分段，判定不是這一集`);
      }
    }
    const chosen = candidates.find((candidate) => candidate.verdict === "match")
      ?? candidates.find((candidate) => candidate.verdict === "content-match")
      ?? candidates.find((candidate) => candidate.verdict === "unknown");
    if (!chosen) {
      if (isNetflixSite()) {
        const direct = fromCapturedDirect(captured, wanted, video);
        if (direct?.cues?.length) return direct;
        return errors.length ? { cues: [], errors } : (direct ?? null);
      }
      return errors.length ? { cues: [], errors } : null;
    }

    try {
      const preserveTimestampMap = !chosen.isDash
        && captured.some((entry) => Boolean(format.readTimestampMap(entry.text)));
      const list = await downloadTrack(chosen.picked, video, { preserveTimestampMap });
      if (!list.length) {
        errors.push(`${shortUrl(chosen.url)} 的 ${chosen.picked.language} 軌抓下來是空的`);
        return { cues: [], errors };
      }
      const fit = matchesVideo(list, video, { absoluteTimeline: preserveTimestampMap });
      if (!fit.ok) {
        errors.push(`${shortUrl(chosen.url)} 的字幕${fit.reason}，不是這一集的`);
        return { cues: [], errors };
      }
      return {
        cues: list,
        source: (chosen.isDash ? "DASH 播放清單" : "HLS 播放清單")
          + (chosen.verdict === "match" ? "，已比對播放器分段" : "")
          + (chosen.verdict === "content-match" ? "，已比對原生字幕內容" : "")
          + (preserveTimestampMap ? "，共用播放器時間軸" : ""),
        language: chosen.picked.language,
        nativeCues: buildNativeCues(chosen.nativeSegments, captured, { preserveTimestampMap })
      };
    } catch (error) {
      errors.push(`${shortUrl(chosen.url)}：${error.message}`);
      return { cues: [], errors };
    }
  }

  async function fromNetflixMetadata(metadata, wanted, video) {
    const errors = [];
    const tracks = (metadata ?? []).flatMap((entry) =>
      manifestCore.parseNetflixTimedTextMetadata(entry?.text ?? entry, entry?.url ?? "")
    );
    const candidates = tracks
      .filter((track) => manifestCore.scoreLanguage(track, wanted) > 0)
      .sort((left, right) => {
        const profileRank = (track) => track.profileKind === "text" ? 2 : track.profileKind === "unknown" ? 1 : 0;
        const byProfile = profileRank(right) - profileRank(left);
        if (byProfile) return byProfile;
        return manifestCore.scoreLanguage(right, wanted) - manifestCore.scoreLanguage(left, wanted);
      });
    if (!candidates.length) {
      return tracks.length ? { cues: [], errors: [`Netflix metadata 有 ${tracks.length} 條字幕軌但沒有 ${wanted}`] } : null;
    }
    for (const picked of candidates) {
      try {
        const list = await downloadTrack(picked, video);
        if (!list.length) {
          errors.push(`Netflix ${picked.language || wanted} ${picked.profile || "direct"} 字幕檔是空的`);
          continue;
        }
        const fit = matchesVideo(list, video);
        if (!fit.ok) {
          errors.push(`Netflix 字幕${fit.reason}，不是目前這一集的`);
          continue;
        }
        return {
          cues: list,
          source: "Netflix timed-text metadata",
          language: picked.language || wanted
        };
      } catch (error) {
        errors.push(`Netflix ${picked.language || wanted} 字幕：${error.message}`);
      }
    }
    return { cues: [], errors };
  }

  function fromCapturedDirect(captured, wanted, video) {
    const candidates = (captured ?? [])
      .map((entry) => {
        const text = String(entry?.text ?? "");
        return {
          kind: "netflix-direct",
          language: languageFromSubtitleUrl(entry?.url ?? ""),
          label: languageFromSubtitleUrl(entry?.url ?? ""),
          fileUrl: entry?.url ?? "",
          text,
          cues: format.parseSubtitle(text, entry?.url ?? "")
        };
      })
      .filter((entry) => entry.cues.length);
    if (!candidates.length) return null;
    const picked = manifestCore.pickTrack(candidates, wanted)
      ?? (candidates.length === 1 && !candidates[0].language ? candidates[0] : null);
    if (!picked?.cues?.length) return null;
    const fit = matchesVideo(picked.cues, video);
    if (!fit.ok) return { cues: [], errors: [`已攔到的 Netflix 字幕${fit.reason}`] };
    return {
      cues: picked.cues,
      source: "Netflix direct subtitle response",
      language: picked.language || wanted
    };
  }

  // 把「攔到的分段內容」放回「播放清單裡的位置」，拼出原生字幕的時間軸。
  // 之後每一輪繪製都拿畫面上實際顯示的原生字幕來校準時間差。
  function buildNativeCues(segments, captured, options = {}) {
    if (options.preserveTimestampMap) {
      return format.normalizeCues(captured
        .filter((entry) => Boolean(format.readTimestampMap(entry.text)))
        .flatMap((entry) => format.parseSubtitle(entry.text, entry.url)));
    }
    if (!segments?.length || !captured?.length) return [];
    const byPath = new Map(captured.map((entry) => [manifestCore.urlPathOf(entry.url), entry.text]));
    const subset = [];
    for (const segment of segments) {
      const text = byPath.get(manifestCore.urlPathOf(segment.url));
      if (!text) continue;
      subset.push({ startSeconds: segment.startSeconds, duration: segment.duration, url: segment.url, text });
    }
    return format.alignSegmentedCues(subset);
  }

  // 抓到的字幕是不是「這一集」的。
  //
  // 換集時舊的播放清單還留在攔截紀錄裡，拿它去抓就會得到別集的字幕——
  // 內容看起來像中文、位置也對，就是跟劇情完全接不上。用影片長度當量尺：
  // 字幕的時間範圍該落在影片長度內，也該蓋到影片的大部分。
  function matchesVideo(cues, video, options = {}) {
    const duration = Number(video?.duration);
    // 讀不到長度就沒得比，放行，不要因為量不到就整個不能用。
    if (!Number.isFinite(duration) || duration <= 0) return { ok: true };
    const firstStart = options.absoluteTimeline ? (cues[0]?.start ?? 0) : 0;
    const lastEnd = (cues[cues.length - 1]?.end ?? 0) - firstStart;
    if (lastEnd > duration + 90) {
      return { ok: false, reason: `比影片長 ${Math.round(lastEnd - duration)} 秒` };
    }
    if (lastEnd < duration * 0.25) {
      return { ok: false, reason: `只蓋到影片的 ${Math.round((lastEnd / duration) * 100)}%` };
    }
    return { ok: true };
  }

  async function downloadTrack(track, video, options = {}) {
    if (track.kind === "netflix-direct") {
      // fromCapturedDirect 已有 body 時不必再次網路請求；metadata 路徑則由
      // pageFetch 帶著播放器頁面的 cookie/簽章取回完整 TTML。
      if (track.text) return format.parseSubtitle(track.text, track.fileUrl);
      return format.parseSubtitle(await pageFetch(track.fileUrl), track.fileUrl);
    }
    if (track.kind === "dash-single") {
      return format.parseSubtitle(await pageFetch(track.fileUrl), track.fileUrl);
    }
    if (track.kind === "dash-template") {
      const segments = manifestCore.dashSegmentUrls(track, video?.duration || 0);
      return collectSegments(segments);
    }
    if (track.kind === "hls") {
      const playlist = await pageFetch(track.playlistUrl);
      const segments = manifestCore.parseHlsMediaPlaylist(playlist, track.playlistUrl);
      return collectSegments(segments, options);
    }
    return [];
  }

  // 分段字幕一部片可能有一兩百個小檔。限制併發，免得一口氣打爆 CDN 被限流。
  const SEGMENT_CONCURRENCY = 6;

  // 漏掉的分段 = 那一整段時間沒有字幕，畫面上就是「這裡有那裡沒有」。
  // 所以失敗要重試，而且最後要如實回報漏了幾段，不能靜靜吞掉。
  let lastFetchFailures = 0;

  async function fetchSegment(segment) {
    try {
      return { segment, text: await pageFetch(segment.url) };
    } catch {
      // CDN 被打太快會擋，隔一下再試一次通常就過了。
      await new Promise((resolve) => setTimeout(resolve, 400));
      try {
        return { segment, text: await pageFetch(segment.url) };
      } catch {
        return null;
      }
    }
  }

  async function collectSegments(segments, options = {}) {
    // 先全部抓回來，因為時間軸的基準要等看過第一段才算得出來。
    const fetched = [];
    let failures = 0;
    for (let i = 0; i < segments.length; i += SEGMENT_CONCURRENCY) {
      const batch = segments.slice(i, i + SEGMENT_CONCURRENCY);
      const texts = await Promise.all(batch.map(fetchSegment));
      for (const item of texts) {
        if (item) fetched.push(item);
        else failures += 1;
      }
    }
    lastFetchFailures = failures;
    return format.alignSegmentedCues(fetched.map(({ segment, text }) => ({
      startSeconds: segment.startSeconds,
      duration: segment.duration,
      url: segment.url,
      text
    })), options);
  }

  function shortUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname + parsed.pathname.slice(-40);
    } catch {
      return String(url).slice(-50);
    }
  }

  // ---------------------------------------------------------------- 顯示
  //
  // 直接用 AI 影片字幕那條的渲染槽。兩個功能互斥，不會同時出現，共用之後
  // 位置、貼合原生字幕的方式、字體複製、全螢幕處理全部一致，也少一份
  // 會走鐘的定位程式碼。
  // 兩條軌的斷句差個零點幾秒是常態，所以查詢時給一點容差；真的落在空隙時，
  // 只要原生字幕還停在同一句，就繼續顯示上一句——這比讓它閃掉合理，
  // 因為那句話明明還在畫面上被講著。
  const CUE_TOLERANCE_SECONDS = 0.35;
  // 原生字幕還停在同一句、而中文那條剛好落在兩句之間時，沿用上一句最多這麼久。
  // 沒有上限的話，中文會在原生字幕不動的整段時間裡一直掛著上一句不放。
  const CARRY_OVER_SECONDS = 2;
  let lastShown = { text: "", nativeText: "", at: -Infinity };
  // 畫面上這句原生字幕「第一次出現」的播放時間。對時要用它，不能用「現在」。
  let nativeShown = { text: "", at: 0 };

  function normalizeForMatch(value) {
    return String(value ?? "")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function matchesCueText(left, right) {
    if (!left || !right) return false;
    if (left === right) return true;
    const shorter = left.length <= right.length ? left : right;
    const longer = left.length <= right.length ? right : left;
    // 「Yeah」「one of」這種短片語一集裡會出現很多次，不能拿來校準。
    if (shorter.replace(/\s+/g, "").length < 10) return false;
    return longer.includes(shorter);
  }

  // 對時：畫面上顯示的原生字幕一定對應到官方字幕檔裡的某一句。找到它，
  // 就知道字幕檔時間軸和 currentTime 差多少，之後查中文那條都套這個差。
  //
  // 基準一定要用「這句話出現的那一刻」。用「現在」的話，偏移量會被這句話
  // 已經演過的秒數污染（最多差一整句的長度），而且算完之後推定位置正好落在
  // 那句的區間內，calibrateOffset 會判定「已經對準了」而永遠不再修正——
  // 症狀就是中文整條固定偏掉幾秒，怎麼放都追不回來。
  function offsetForCaption(list, displayedText, appearedSeconds, currentOffset) {
    const wanted = normalizeForMatch(displayedText);
    if (!wanted || !list?.length || !Number.isFinite(appearedSeconds)) return currentOffset;
    const target = appearedSeconds + currentOffset;
    let best = null;
    let bestDistance = Infinity;
    for (const cue of list) {
      if (!matchesCueText(normalizeForMatch(cue.text), wanted)) continue;
      const distance = Math.abs(cue.start - target);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = cue;
      }
    }
    return best ? best.start - appearedSeconds : currentOffset;
  }

  function render() {
    const video = findVideo();
    if (!video) return;
    const caption = streaming?.readNativeCaption(document, location.hostname);
    const nativeText = caption?.text ?? "";

    // 換句的那一刻才重新對時，而且是每次換句都重算，這樣起步時對得不準
    // 也會在下一句自動修正。
    if (nativeText !== nativeShown.text) {
      nativeShown = { text: nativeText, at: video.currentTime };
      if (nativeText && nativeCues.length) {
        timeOffset = offsetForCaption(nativeCues, nativeText, nativeShown.at, timeOffset);
      }
    }

    let text = format.findCueAt(cues, video.currentTime + timeOffset, CUE_TOLERANCE_SECONDS);
    // 這一輪是不是真的在某句的區間裡（而不是靠沿用撐著）。沿用的時間要從
    // 「最後一次真的命中」起算，不然沿用會一直把自己的期限往後延。
    const fresh = Boolean(text);

    if (!text && nativeText && nativeText === lastShown.nativeText && lastShown.text
      && video.currentTime - lastShown.at <= CARRY_OVER_SECONDS) {
      text = lastShown.text;
    }
    if (!text) {
      lastShown = { text: "", nativeText: "", at: -Infinity };
      streaming?.removeNativeTranslation(document);
      return;
    }
    lastShown = { text, nativeText, at: fresh ? video.currentTime : lastShown.at };
    streaming?.upsertNativeTranslation(document, caption, text, "dual");
  }

  function findVideo() {
    // Disney+ 的 video 元素可能在 shadow DOM 裡，一般查詢看不到。
    const all = streaming?.deepQueryAll?.(document, "video") ?? [...document.querySelectorAll("video")];
    const list = all.filter((item) => {
      const rect = item.getBoundingClientRect();
      return rect.width > 120 && rect.height > 80;
    });
    return list.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    })[0] ?? document.querySelector("video");
  }

  // ---------------------------------------------------------------- 影集學習
  //
  // 教材需要「原文 + 中文」成對，而看影片時只需要中文那條，所以這裡要多抓一條。
  // 兩條都來自同一份播放清單，時間碼同源，用時間重疊度配對就會準。
  async function collectStudyPairs(settings) {
    const video = findVideo();
    if (!video) throw new Error("這個頁面上找不到影片");
    const learnLanguage = settings.studySourceLanguage || "en";
    const helpLanguage = settings.dualSubtitleLanguage || "zh-Hant";

    const sniffed = await askPage({ type: "IMMERSEFREE_REQUEST_STREAM_TRACKS" }, 8000);
    if (!sniffed) throw new Error("頁面橋接沒有回應，請重新整理頁面再試一次");
    if (!sniffed.manifests?.length) {
      throw new Error("還沒攔到播放清單。請先讓影片播一下，再按一次影集學習。");
    }

    const notes = [];
    for (const url of [...sniffed.manifests].reverse()) {
      try {
        const text = await pageFetch(url);
        const isDash = /\.mpd(\?|$)/i.test(url) || /<MPD[\s>]/i.test(text.slice(0, 400));
        const tracks = isDash
          ? manifestCore.parseDashManifest(text, url)
          : manifestCore.parseHlsMaster(text, url);
        if (!tracks.length) continue;
        const learnTrack = manifestCore.pickTrack(tracks, learnLanguage);
        const helpTrack = manifestCore.pickTrack(tracks, helpLanguage);
        if (!learnTrack || !helpTrack) {
          notes.push(`${shortUrl(url)} 缺少 ${learnTrack ? helpLanguage : learnLanguage} 字幕軌`);
          continue;
        }
        const preserveTimestampMap = learnTrack.kind === "hls" && helpTrack.kind === "hls";
        const [learn, help] = await Promise.all([
          downloadTrack(learnTrack, video, { preserveTimestampMap }),
          downloadTrack(helpTrack, video, { preserveTimestampMap })
        ]);
        if (!learn.length || !help.length) {
          notes.push(`${shortUrl(url)} 有兩條軌但其中一條抓下來是空的`);
          continue;
        }
        return {
          pairs: pairByOverlap(learn, help),
          learnLanguage: learnTrack.language || learnLanguage,
          helpLanguage: helpTrack.language || helpLanguage,
          duration: video.duration || 0
        };
      } catch (error) {
        notes.push(`${shortUrl(url)}：${error.message}`);
      }
    }
    const detail = notes.length ? `　（${notes.slice(0, 2).join("；")}）` : "";
    throw new Error(`找不到同時有 ${learnLanguage} 和 ${helpLanguage} 的字幕軌${detail}`);
  }

  // 兩條軌的斷句不會完全一致，所以不是逐句對號，而是找時間重疊最多的那句。
  function pairByOverlap(source, translation) {
    const pairs = [];
    let cursor = 0;
    for (const line of source) {
      // 兩條軌都已排序，游標只需前進，不必每次從頭找。
      while (cursor > 0 && translation[cursor - 1]?.end > line.start) cursor -= 1;
      while (cursor < translation.length && translation[cursor].end < line.start) cursor += 1;
      let best = "";
      let bestOverlap = 0;
      for (let i = cursor; i < translation.length; i += 1) {
        const other = translation[i];
        if (other.start > line.end) break;
        const overlap = Math.min(line.end, other.end) - Math.max(line.start, other.start);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          best = other.text;
        }
      }
      pairs.push({
        start: line.start,
        end: line.end,
        source: line.text,
        translation: best
      });
    }
    return pairs;
  }

  // ---------------------------------------------------------------- 對外
  async function start(settings) {
    injectSniffer();
    const run = ++session;
    restoreTextTrack?.();
    restoreTextTrack = undefined;
    // 上一輪的統計不能沿用，否則走原生字幕軌那條路時會報出別人的數字。
    lastFetchFailures = 0;
    const video = findVideo();
    if (!video) throw new Error("這個頁面上找不到影片");

    const wanted = decideSecondLanguage(settings);
    const native = fromNativeTextTracks(video, wanted);
    let resolved = native;
    let diagnostics = [];

    if (!resolved?.cues?.length) {
      const sniffed = await askPage({ type: "IMMERSEFREE_REQUEST_STREAM_TRACKS" }, 8000);
      if (run !== session) throw new Error("雙軌字幕啟動已取消");
      if (!sniffed) throw new Error("頁面橋接沒有回應，請重新整理頁面再試一次");
      if (!sniffed.manifests?.length && !sniffed.subtitles?.length && !sniffed.metadata?.length) {
        throw new Error("還沒攔到播放清單。請先讓影片開始播放，再按一次雙軌字幕。");
      }
      const viaManifest = await fromManifests(sniffed, wanted, video);
      if (run !== session) throw new Error("雙軌字幕啟動已取消");
      if (viaManifest?.cues?.length) resolved = viaManifest;
      else diagnostics = viaManifest?.errors ?? [];
    }

    if (!resolved?.cues?.length) {
      const detail = diagnostics.length ? `　（${diagnostics.slice(0, 2).join("；")}）` : "";
      throw new Error(`找不到可用的 ${wanted} 字幕軌${detail}`);
    }

    if (run !== session) throw new Error("雙軌字幕啟動已取消");

    cues = resolved.cues;
    nativeCues = resolved.nativeCues ?? [];
    timeOffset = 0;
    lastShown = { text: "", nativeText: "", at: -Infinity };
    nativeShown = { text: "", at: 0 };
    restoreTextTrack = resolved.restore;
    state = {
      active: true,
      count: cues.length,
      source: resolved.source,
      language: resolved.language || wanted,
      failures: lastFetchFailures,
      detail: ""
    };
    if (displayTimer) clearInterval(displayTimer);
    displayTimer = setInterval(render, 120);
    render();
    return { ...state };
  }

  function stop() {
    session += 1;
    if (displayTimer) clearInterval(displayTimer);
    displayTimer = null;
    cues = [];
    nativeCues = [];
    timeOffset = 0;
    lastShown = { text: "", nativeText: "", at: -Infinity };
    nativeShown = { text: "", at: 0 };
    restoreTextTrack?.();
    restoreTextTrack = undefined;
    streaming?.removeNativeTranslation(document);
    // 換集或關掉時要忘掉記住的位置，否則下一次會沿用上一個版面的座標。
    streaming?.forgetAnchor();
    state = { active: false, count: 0, source: "", language: "", detail: "" };
  }

  async function toggle(settings) {
    if (state.active) {
      stop();
      return { active: false, message: "雙軌字幕已關閉" };
    }
    const result = await start(settings);
    // 漏掉的分段會變成「那一段時間沒字幕」，一定要講出來，
    // 不然使用者只會覺得功能時好時壞。
    const missing = result.failures ? `　有 ${result.failures} 段沒抓到，那些時間會缺字幕` : "";
    const sync = nativeCues.length ? "　已啟用即時對時" : "";
    return {
      active: true,
      message: `雙軌字幕已開啟：${result.language} ${result.count} 句（來源：${result.source}）${sync}${missing}`
    };
  }

  // offsetForCaption 是純函式，外露只為了讓對時邏輯可以單獨被測（tests/
  // dual-subtitle-timing.test.cjs）。其餘欄位維持原本的對外介面不變。
  bridge.dualSubtitle = { start, stop, toggle, collectStudyPairs, offsetForCaption, getState: () => ({ ...state }) };

  document.addEventListener("fullscreenchange", () => { if (state.active) render(); });
  global.addEventListener("resize", () => { if (state.active) render(); });
})(globalThis);
