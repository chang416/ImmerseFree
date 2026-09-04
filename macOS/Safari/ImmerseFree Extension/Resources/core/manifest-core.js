(function initializeManifestCore(global) {
  // 從串流的播放清單裡找出所有字幕軌。
  //
  // 播放器一次只掛一條字幕，但清單裡本來就同時列著所有語言。只要解得開清單，
  // 就能自己把另一條整份抓下來，不必翻譯也不花任何 token。
  //
  // 支援 HLS（.m3u8）和 DASH（.mpd）。兩者的字幕都是純文字，沒有被 DRM 蓋住。

  const CHINESE = /^(zh|cmn|yue|chi|zho)([-_]|$)/i;
  const TRADITIONAL = /(hant|tw|hk|mo)/i;

  function resolveUrl(relative, base) {
    try {
      return new URL(relative, base).href;
    } catch {
      return relative;
    }
  }

  // ------------------------------------------------------------------ HLS
  function parseHlsMaster(text, baseUrl) {
    const tracks = [];
    for (const line of String(text ?? "").split(/\r?\n/)) {
      if (!line.startsWith("#EXT-X-MEDIA:")) continue;
      const attributes = parseAttributeList(line.slice("#EXT-X-MEDIA:".length));
      if (String(attributes.TYPE ?? "").toUpperCase() !== "SUBTITLES") continue;
      if (!attributes.URI) continue;
      tracks.push({
        kind: "hls",
        language: attributes.LANGUAGE ?? "",
        label: attributes.NAME ?? attributes.LANGUAGE ?? "",
        // 強制字幕只有外語對白的部分，拿來當雙軌字幕會缺一大半。
        forced: String(attributes.FORCED ?? "").toUpperCase() === "YES",
        playlistUrl: resolveUrl(attributes.URI, baseUrl)
      });
    }
    return tracks;
  }

  // HLS 的屬性清單會有帶引號、帶逗號的值，不能直接用 split(",")。
  function parseAttributeList(input) {
    const attributes = {};
    let key = "";
    let value = "";
    let inKey = true;
    let quoted = false;
    for (let i = 0; i < input.length; i += 1) {
      const character = input[i];
      if (inKey) {
        if (character === "=") { inKey = false; continue; }
        key += character;
        continue;
      }
      if (character === '"') { quoted = !quoted; continue; }
      if (character === "," && !quoted) {
        attributes[key.trim()] = value;
        key = "";
        value = "";
        inKey = true;
        continue;
      }
      value += character;
    }
    if (key.trim()) attributes[key.trim()] = value;
    return attributes;
  }

  // 字幕的媒體播放清單：一連串分段，每段的長度寫在 EXTINF。
  // 累加長度就得到每段的起始時間，分段 VTT 少了這個會全部疊在開頭。
  function parseHlsMediaPlaylist(text, baseUrl) {
    const segments = [];
    let duration = 0;
    let elapsed = 0;
    for (const rawLine of String(text ?? "").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith("#EXTINF:")) {
        duration = Number.parseFloat(line.slice("#EXTINF:".length)) || 0;
        continue;
      }
      if (line.startsWith("#")) continue;
      segments.push({ url: resolveUrl(line, baseUrl), startSeconds: elapsed, duration });
      elapsed += duration;
      duration = 0;
    }
    return segments;
  }

  // ------------------------------------------------------------------ DASH
  function parseDashManifest(text, baseUrl) {
    let document;
    try {
      document = new DOMParser().parseFromString(String(text ?? ""), "application/xml");
    } catch {
      return [];
    }
    if (!document || document.querySelector("parsererror")) return [];

    const manifestBase = firstChildText(document.documentElement, "BaseURL");
    const rootBase = manifestBase ? resolveUrl(manifestBase, baseUrl) : baseUrl;

    const tracks = [];
    for (const node of document.getElementsByTagName("*")) {
      if (node.localName !== "AdaptationSet") continue;
      const contentType = node.getAttribute("contentType") ?? "";
      const mimeType = node.getAttribute("mimeType") ?? "";
      if (contentType !== "text" && !/(text|ttml|vtt)/i.test(mimeType)) continue;

      const language = node.getAttribute("lang") ?? "";
      const setBase = firstChildText(node, "BaseURL");
      const base = setBase ? resolveUrl(setBase, rootBase) : rootBase;

      for (const representation of [...node.getElementsByTagName("*")].filter((n) => n.localName === "Representation")) {
        const repBase = firstChildText(representation, "BaseURL");
        const repMime = representation.getAttribute("mimeType") ?? mimeType;
        // 單一檔案的字幕：BaseURL 直接指到 .vtt 或 .ttml，最好處理。
        if (repBase) {
          tracks.push({
            kind: "dash-single",
            language,
            label: representation.getAttribute("id") ?? language,
            forced: false,
            mimeType: repMime,
            fileUrl: resolveUrl(repBase, base)
          });
          continue;
        }
        const template = [...representation.getElementsByTagName("*")].find((n) => n.localName === "SegmentTemplate")
          ?? [...node.getElementsByTagName("*")].find((n) => n.localName === "SegmentTemplate");
        if (template) {
          tracks.push({
            kind: "dash-template",
            language,
            label: representation.getAttribute("id") ?? language,
            forced: false,
            mimeType: repMime,
            base,
            representationId: representation.getAttribute("id") ?? "",
            media: template.getAttribute("media") ?? "",
            startNumber: Number(template.getAttribute("startNumber")) || 1,
            duration: Number(template.getAttribute("duration")) || 0,
            timescale: Number(template.getAttribute("timescale")) || 1
          });
        }
      }
    }
    return tracks;
  }

  // Netflix 的 timed-text 軌通常不放在 HLS/DASH manifest，而是跟著
  // `timedtexttracks` 一起回傳。每條軌的實際字幕網址藏在
  // `ttDownloadables.<profile>.urls[]`（有些版本是單一 `url`）。
  // 這裡只讀 metadata，不碰播放器私有 API；回傳的 track 會跟 HLS/DASH
  // track 使用同一個 pickTrack/downloadTrack 介面。
  function parseNetflixTimedTextMetadata(input, baseUrl = "") {
    let value = input;
    if (typeof input === "string") {
      try {
        value = JSON.parse(input);
      } catch {
        return [];
      }
    }
    if (!value || typeof value !== "object") return [];

    const tracks = [];
    const seenUrls = new Set();
    const readLanguage = (track) => track?.bcp47 ?? track?.language ?? track?.locale ?? track?.languageTag ?? "";
    const readLabel = (track, language) =>
      track?.displayName ?? track?.languageDescription ?? track?.label ?? language ?? "";
    const readDownloadableId = (track) =>
      track?.downloadableId ?? track?.dlid ?? track?.ttDownloadableId ?? "";
    const readUrl = (entry) => {
      if (typeof entry === "string") return entry;
      if (!entry || typeof entry !== "object") return "";
      return entry.url ?? entry.href ?? "";
    };
    const push = (track, profile, entry) => {
      const rawUrl = String(readUrl(entry) ?? "").trim();
      if (!rawUrl) return;
      const fileUrl = resolveUrl(rawUrl, baseUrl);
      if (!fileUrl || seenUrls.has(fileUrl)) return;
      seenUrls.add(fileUrl);
      const trackLanguage = String(readLanguage(track)).trim();
      const profileName = String(profile ?? "");
      const profileKind = /(?:ttml|dfxp|imsc|vtt|webvtt|text|xml)/i.test(profileName)
        ? "text"
        : /(?:image|png|jpe?g|webp|bitmap|sprite)/i.test(profileName)
          ? "image"
          : "unknown";
      tracks.push({
        kind: "netflix-direct",
        language: trackLanguage,
        label: readLabel(track, trackLanguage),
        forced: Boolean(track?.isForcedNarrative ?? track?.isForced ?? false),
        mimeType: profileKind === "text" ? "application/ttml+xml" : "",
        profile: profileName,
        profileKind,
        trackId: track?.trackId ?? "",
        downloadableId: readDownloadableId(track),
        fileUrl
      });
    };
    const collectTrack = (track) => {
      if (!track || typeof track !== "object" || Array.isArray(track)) return;
      const downloadables = track.ttDownloadables ?? track.downloadables;
      if (!downloadables || typeof downloadables !== "object") return;
      for (const [profile, valueForProfile] of Object.entries(downloadables)) {
        if (Array.isArray(valueForProfile)) {
          for (const entry of valueForProfile) push(track, profile, entry);
          continue;
        }
        if (valueForProfile && typeof valueForProfile === "object") {
          if (Array.isArray(valueForProfile.urls)) {
            for (const entry of valueForProfile.urls) push(track, profile, entry);
          }
          if (valueForProfile.url || valueForProfile.href) push(track, profile, valueForProfile);
          continue;
        }
        push(track, profile, valueForProfile);
      }
    };
    const visited = new WeakSet();
    const walk = (node, depth = 0) => {
      if (!node || typeof node !== "object" || depth > 12 || visited.has(node)) return;
      visited.add(node);
      if (Array.isArray(node)) {
        for (const item of node.slice(0, 200)) walk(item, depth + 1);
        return;
      }
      for (const [key, child] of Object.entries(node)) {
        if (Array.isArray(child) && /^(?:timedtexttracks|timedTextTracks)$/i.test(key)) {
          for (const track of child) collectTrack(track);
        }
        walk(child, depth + 1);
      }
    };
    walk(value);
    return tracks;
  }

  function firstChildText(node, localName) {
    for (const child of node?.children ?? []) {
      if (child.localName === localName) return child.textContent.trim();
    }
    return "";
  }

  function dashSegmentUrls(track, totalSeconds) {
    if (track.kind !== "dash-template" || !track.media || !track.duration) return [];
    const segmentSeconds = track.duration / track.timescale;
    if (segmentSeconds <= 0) return [];
    const count = Math.ceil((Number(totalSeconds) || 0) / segmentSeconds);
    const urls = [];
    for (let i = 0; i < count; i += 1) {
      const number = track.startNumber + i;
      const path = track.media
        .replace(/\$RepresentationID\$/g, track.representationId)
        .replace(/\$Number%0(\d+)d\$/g, (all, width) => String(number).padStart(Number(width), "0"))
        .replace(/\$Number\$/g, String(number))
        .replace(/\$Time\$/g, String(Math.round(i * track.duration)));
      urls.push({ url: resolveUrl(path, track.base), startSeconds: i * segmentSeconds, duration: segmentSeconds });
    }
    return urls;
  }

  // ---------------------------------------------------------------- 清單排序
  //
  // 攔到的播放清單常常不只一份：上一集殘留的、預載下一集的、預告片的。
  // 光看「最新的」會抓錯——預載下一集的清單就比正在播的新。
  // 可靠的訊號是「播放器實際抓過的字幕分段網址」：那些一定屬於現在這一集，
  // 而同一集的資產會共用網址路徑。依路徑相似度排序，抓錯集的問題就沒了。
  function urlPathOf(url) {
    try {
      const parsed = new URL(url);
      return parsed.origin + parsed.pathname;
    } catch {
      return String(url ?? "");
    }
  }

  function commonPrefixLength(a, b) {
    const limit = Math.min(a.length, b.length);
    let i = 0;
    while (i < limit && a[i] === b[i]) i += 1;
    return i;
  }

  function rankManifests(manifests, subtitleUrls) {
    const subs = (subtitleUrls ?? []).slice(-8).map(urlPathOf);
    return (manifests ?? [])
      .map((url, index) => {
        const path = urlPathOf(url);
        const affinity = subs.length ? Math.max(...subs.map((sub) => commonPrefixLength(path, sub))) : 0;
        return { url, index, affinity };
      })
      // 相似度優先；同分時新的優先（index 大 = 攔到的時間晚）。
      .sort((a, b) => b.affinity - a.affinity || b.index - a.index)
      .map((item) => item.url);
  }

  // 找出「網址路徑跟這批網址最像」的字幕軌——用來從播放清單裡認出
  // 播放器正在用的那條軌（語言不拘），好跟攔到的分段做確定性比對。
  function pickTrackByUrlAffinity(tracks, urls) {
    const paths = (urls ?? []).map(urlPathOf).filter(Boolean);
    if (!paths.length) return null;
    let best = null;
    let bestScore = -1;
    for (const track of tracks ?? []) {
      const trackUrl = urlPathOf(track.playlistUrl ?? track.fileUrl ?? "");
      if (!trackUrl) continue;
      const score = Math.max(...paths.map((path) => commonPrefixLength(trackUrl, path)));
      if (score > bestScore) {
        bestScore = score;
        best = track;
      }
    }
    return best;
  }

  // Disney 會把同一個字幕分段換到另一個 CDN，甚至把路徑重新簽名；網址不相等
  // 不代表是別集。真正可靠的第二層驗證是字幕內容本身：播放器已下載的原生字幕
  // 與候選清單的原生字幕若有多句相同，就能確定是同一集。極短口頭禪太常重複，
  // 不列入證據，避免只因一個「Okay」誤收預載的下一集。
  function countSubtitleTextOverlap(leftCues, rightCues) {
    const normalize = (value) => String(value ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&(?:nbsp|amp|lt|gt);/gi, " ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase();
    const meaningful = (text) => {
      const compact = text.replace(/\s+/g, "");
      return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)
        ? compact.length >= 4
        : compact.length >= 8;
    };
    const left = new Set((leftCues ?? [])
      .map((cue) => normalize(typeof cue === "string" ? cue : cue?.text))
      .filter(meaningful));
    const matched = new Set();
    for (const cue of rightCues ?? []) {
      const text = normalize(typeof cue === "string" ? cue : cue?.text);
      if (meaningful(text) && left.has(text)) matched.add(text);
    }
    return matched.size;
  }

  // ------------------------------------------------------------------ 選軌
  function scoreLanguage(track, wanted) {
    const language = String(track.language ?? "").trim();
    if (!language) return 0;
    if (wanted === "zh-Hant" || wanted === "zh-Hans") {
      if (!CHINESE.test(language)) return 0;
      const isTraditional = TRADITIONAL.test(language);
      const wantTraditional = wanted === "zh-Hant";
      // 繁體找不到時退簡體總比完全沒有好，但分數要低一截。
      if (isTraditional === wantTraditional) return 100;
      return 55;
    }
    const wantedBase = wanted.split("-")[0].toLowerCase();
    const base = language.split(/[-_]/)[0].toLowerCase();
    if (language.toLowerCase() === wanted.toLowerCase()) return 100;
    if (base === wantedBase) return 80;
    return 0;
  }

  function pickTrack(tracks, wanted) {
    let best = null;
    let bestScore = 0;
    for (const track of tracks ?? []) {
      let score = scoreLanguage(track, wanted);
      if (!score) continue;
      // Netflix metadata can include an image-based profile beside the text
      // profile for the same language. Prefer parseable text without changing
      // how HLS/DASH tracks are ranked; direct image-only tracks remain as a
      // last-resort candidate so the caller can report a useful empty result.
      if (track.kind === "netflix-direct") {
        if (track.profileKind === "text") score += 5;
        if (track.profileKind === "image") score -= 40;
      }
      // 強制字幕只翻外語對白，拿來配雙軌會缺一大半，除非沒別的可選。
      if (track.forced) score -= 40;
      if (score > bestScore) {
        bestScore = score;
        best = track;
      }
    }
    return best;
  }

  function listLanguages(tracks) {
    return (tracks ?? []).map((track) => ({
      language: track.language,
      label: track.label,
      forced: Boolean(track.forced),
      kind: track.kind
    }));
  }

  function isChinese(language) {
    return CHINESE.test(String(language ?? ""));
  }

  global.ImmerseFreeManifestCore = Object.freeze({
    parseHlsMaster,
    parseHlsMediaPlaylist,
    parseDashManifest,
    parseNetflixTimedTextMetadata,
    parseAttributeList,
    rankManifests,
    urlPathOf,
    pickTrackByUrlAffinity,
    countSubtitleTextOverlap,
    dashSegmentUrls,
    pickTrack,
    scoreLanguage,
    listLanguages,
    resolveUrl,
    isChinese
  });
})(globalThis);
