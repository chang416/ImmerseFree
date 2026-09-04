(function initializeYouTubeSubtitleCore(global) {
  // 換行由前端自己決定（2B）：譯文是完整句子，一行放不下就照標點與英文詞界切。
  const linebreak = global.ImmerseFreeSubtitleLinebreak;

  // 把文字切行後寫進節點。換行器不在（載入順序意外）就退回單行純文字，
  // 字幕照樣看得到，只是沒有語意換行。
  function writeSubtitleLines(node, text, maxCharsPerLine, maxLines = 2) {
    if (!node) return;
    if (!linebreak?.renderLines || maxLines <= 1) {
      node.textContent = text;
      return;
    }
    linebreak.renderLines(node, text, { maxCharsPerLine, maxLines });
  }

  function extractCaptionTrack(source, sourceLanguage = "auto") {
    const response = typeof source === "string" ? extractPlayerResponse(source) : source;
    const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    if (!tracks.length) return undefined;
    const requested = normalizeLanguage(sourceLanguage);
    if (requested && requested !== "auto") {
      const exact = tracks.find((track) => normalizeLanguage(track.languageCode) === requested);
      if (exact) return exact;
      const family = tracks.find((track) => normalizeLanguage(track.languageCode).split("-")[0] === requested.split("-")[0]);
      if (family) return family;
    }
    // 沒指定原文語言時，不能拿「第一個非 asr 軌」：YouTube 自動配音的影片會把
    // 幾十種語言的字幕軌一起列出來，且按語言代碼排序——阿拉伯文（ar）永遠第一，
    // 結果就是拿阿拉伯文當原文去翻。原始語言的判準依序是：
    //   1. 預設音軌所指的預設字幕軌（YouTube 自己標的「這支影片的原文字幕」）
    //   2. asr（自動產生）軌——語音辨識一定是講者的原始語言
    //   3. 才退回清單第一個
    const renderer = response?.captions?.playerCaptionsTracklistRenderer;
    const audioTracks = renderer?.audioTracks ?? [];
    const defaultAudio = audioTracks[Number(renderer?.defaultAudioTrackIndex) || 0];
    const defaultIndex = Number(defaultAudio?.defaultCaptionTrackIndex);
    if (Number.isInteger(defaultIndex) && tracks[defaultIndex]) return tracks[defaultIndex];
    return tracks.find((track) => track.kind === "asr") ?? tracks[0];
  }

  function extractPlayerResponse(source) {
    const text = String(source ?? "");
    for (const marker of ["ytInitialPlayerResponse =", "ytInitialPlayerResponse="]) {
      let markerIndex = text.indexOf(marker);
      while (markerIndex >= 0) {
        const start = text.indexOf("{", markerIndex + marker.length);
        const value = parseBalancedJson(text, start);
        if (value?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length) return value;
        markerIndex = text.indexOf(marker, markerIndex + marker.length);
      }
    }
    return undefined;
  }

  function parseBalancedJson(text, start) {
    if (start < 0) return undefined;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') {
        quoted = true;
        continue;
      }
      if (character === "{") depth += 1;
      if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          try { return JSON.parse(text.slice(start, index + 1)); }
          catch { return undefined; }
        }
      }
    }
    return undefined;
  }

  function parseJson3Transcript(payload = {}) {
    const raw = (payload.events ?? [])
      .map((event) => ({
        startMs: Math.max(0, Number(event.tStartMs) || 0),
        durationMs: Math.max(0, Number(event.dDurationMs) || 0),
        text: cleanText((event.segs ?? []).map((segment) => segment.utf8 ?? "").join(""))
      }))
      .filter((cue) => cue.text && cue.text !== "\n")
      .filter((cue, index, cues) => index === 0 || cue.text !== cues[index - 1].text || cue.startMs !== cues[index - 1].startMs);

    return raw.map((cue, index) => {
      const nextStart = raw[index + 1]?.startMs;
      const durationEnd = cue.startMs + cue.durationMs;
      const endMs = cue.durationMs > 0
        ? durationEnd
        : (nextStart && nextStart > cue.startMs ? nextStart : cue.startMs + 2500);
      return { startMs: cue.startMs, endMs, text: cue.text };
    });
  }

  function parseJson3TranscriptText(value) {
    const text = String(value ?? "").trim();
    if (!text) return [];
    try {
      return parseJson3Transcript(JSON.parse(text));
    } catch {
      return [];
    }
  }

  function extractInnertubeApiKey(source) {
    const text = String(source ?? "");
    const match = text.match(/["']INNERTUBE_API_KEY["']\s*:\s*["']([^"']+)["']/);
    return match?.[1] ?? "";
  }

  function parseTranscriptXml(value) {
    const text = String(value ?? "");
    const cues = [];
    const pattern = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
    let match;
    while ((match = pattern.exec(text))) {
      const attributes = match[1];
      const start = Number(attributes.match(/\bstart=["']([^"']+)["']/i)?.[1]);
      const duration = Number(attributes.match(/\bdur=["']([^"']+)["']/i)?.[1]);
      const cueText = decodeXmlEntities(match[2].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
      if (!Number.isFinite(start) || !cueText) continue;
      const startMs = Math.max(0, Math.round(start * 1000));
      const durationMs = Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : 2500;
      cues.push({ startMs, endMs: startMs + durationMs, text: cueText });
    }
    return cues;
  }

  function decodeXmlEntities(value) {
    return String(value ?? "")
      .replace(/&amp;/g, "&")
      .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  function isYouTubeVideoUrl(value) {
    try {
      const url = new URL(String(value));
      const host = url.hostname.toLowerCase();
      if (!(host === "youtube.com" || host.endsWith(".youtube.com"))) return false;
      if (url.pathname === "/watch") return Boolean(url.searchParams.get("v"));
      return /^\/(?:shorts|live|embed)\/[^/?]+/.test(url.pathname);
    } catch {
      return false;
    }
  }

  function isYouTubeAdVisible(document) {
    const player = document.querySelector?.("#movie_player") ?? document.querySelector?.(".html5-video-player");
    if (player?.classList?.contains?.("ad-showing") || player?.classList?.contains?.("ad-interrupting")) {
      return true;
    }
    const selectors = [
      ".ytp-ad-player-overlay",
      ".ytp-ad-overlay-container",
      ".ytp-ad-preview-container",
      ".ytp-ad-text-overlay",
      ".ytp-ad-image-overlay"
    ].join(",");
    return [...(document.querySelectorAll?.(selectors) ?? [])].some(isVisible);
  }

  function prioritizeCueIndices(cues = [], currentTimeMs = 0) {
    if (!cues.length) return [];
    let current = cues.findIndex((cue) => currentTimeMs >= cue.startMs && currentTimeMs < cue.endMs);
    if (current < 0) current = cues.findIndex((cue) => cue.startMs >= currentTimeMs);
    if (current < 0) current = cues.length - 1;
    return [
      ...Array.from({ length: cues.length - current }, (_, index) => current + index),
      ...Array.from({ length: current }, (_, index) => index)
    ];
  }

  function buildBufferedCuePlan(cues = [], currentTimeMs = 0, bufferMs = 30_000) {
    const ordered = prioritizeCueIndices(cues, currentTimeMs);
    const limit = currentTimeMs + Math.max(1, Number(bufferMs) || 30_000);
    let buffer = ordered.filter((index) => cues[index].endMs > currentTimeMs && cues[index].startMs < limit);
    if (!buffer.length && ordered.length) buffer = [ordered[0]];
    const buffered = new Set(buffer);
    return { buffer, remaining: ordered.filter((index) => !buffered.has(index)) };
  }

  function findCueIndex(cues = [], currentTimeMs = 0) {
    let active = -1;
    for (let index = 0; index < cues.length; index += 1) {
      if (currentTimeMs >= cues[index].startMs && currentTimeMs < cues[index].endMs) active = index;
      if (cues[index].startMs > currentTimeMs) break;
    }
    if (active >= 0) return active;
    const upcoming = cues.findIndex((cue) => cue.startMs > currentTimeMs);
    return upcoming > 0 ? upcoming - 1 : upcoming;
  }

  function buildTimedTextUrl(baseUrl) {
    const url = new URL(String(baseUrl));
    const host = url.hostname.toLowerCase();
    if (!(host === "youtube.com" || host.endsWith(".youtube.com")) || url.pathname !== "/api/timedtext") {
      throw new Error("不安全的 YouTube 字幕網址");
    }
    url.searchParams.set("fmt", "json3");
    return url.href;
  }

  function readNativeCue(document) {
    const segments = [...document.querySelectorAll(".ytp-caption-segment:not(.immersefree-youtube-translation)")]
      .filter((segment) => isVisible(segment));
    return cleanText(segments.map((segment) => segment.textContent).join(" "));
  }

  function upsertNativeTranslation(document, translation, state = "ready") {
    const segments = [...document.querySelectorAll(".ytp-caption-segment:not(.immersefree-youtube-translation)")];
    const segment = [...segments].reverse().find((candidate) => isVisible(candidate)) ?? segments.at(-1);
    const captionText = segment?.closest?.(".captions-text");
    if (!captionText) return undefined;
    for (const row of document.querySelectorAll(".immersefree-youtube-translation-line")) {
      if (row.closest?.(".captions-text") !== captionText) row.remove();
    }
    const captionWindow = captionText.closest?.(".caption-window");
    captionWindow?.classList?.add("immersefree-youtube-caption-window");
    let line = captionText.querySelector(".immersefree-youtube-translation");
    if (!line) {
      // YouTube's native captions are one block-level .caption-visual-line per
      // visible line. Appending a bare <br>/<span> leaves the caption-window's
      // fixed inline height unchanged, so the translated line is rendered
      // below the player and clipped. Mirror the native row structure and let
      // the marked window grow upward from its existing bottom anchor.
      const visualLine = document.createElement("span");
      visualLine.className = "caption-visual-line immersefree-youtube-translation-line";
      visualLine.setAttribute("data-immersefree-extension-root", "youtube-subtitle");
      visualLine.style?.setProperty?.("display", "block", "important");
      line = document.createElement("span");
      line.className = "ytp-caption-segment immersefree-youtube-translation";
      line.setAttribute("data-immersefree-extension-root", "youtube-subtitle");
      line.setAttribute("lang", "zh-Hant");
      line.setAttribute("aria-live", "polite");
      visualLine.append(line);
      captionText.append(visualLine);
    }
    copyNativeTypography(document, segment, line);
    line.textContent = translation;
    line.dataset.state = state;
    return line;
  }

  function upsertPlayerSubtitle(document, sourceText, translationText, state = "ready") {
    const player = document.querySelector("#movie_player") ?? document.querySelector(".html5-video-player");
    if (!player) return undefined;
    for (const node of document.querySelectorAll?.(".immersefree-youtube-translation-line, .immersefree-youtube-translation, .immersefree-youtube-translation-break") ?? []) node.remove();
    for (const node of document.querySelectorAll?.(".immersefree-youtube-caption-window") ?? []) node.classList?.remove("immersefree-youtube-caption-window");
    let root = player.querySelector(".immersefree-youtube-subtitle-root");
    if (!root) {
      root = document.createElement("div");
      root.className = "immersefree-youtube-subtitle-root";
      root.setAttribute("data-immersefree-extension-root", "youtube-subtitle");
      const box = document.createElement("div");
      box.className = "immersefree-youtube-subtitle-box";
      const source = document.createElement("div");
      source.className = "immersefree-youtube-subtitle-source";
      source.setAttribute("lang", "en");
      const translation = document.createElement("div");
      translation.className = "immersefree-youtube-subtitle-translation";
      translation.setAttribute("lang", "zh-Hant");
      translation.setAttribute("aria-live", "polite");
      box.append(source, translation);
      root.append(box);
      player.append(root);
    }
    player.classList?.add("immersefree-youtube-subtitle-active");
    const source = root.querySelector(".immersefree-youtube-subtitle-source");
    const translation = root.querySelector(".immersefree-youtube-subtitle-translation");
    const rect = player.getBoundingClientRect?.();
    // 行寬照播放器寬度與字級算，夾在中文一行 14–18 字之間。
    let fontSize = 0;
    let charsPerLine = linebreak?.DEFAULTS?.maxCharsPerLine ?? 16;
    if (rect?.width && rect?.height) {
      fontSize = Math.round(Math.max(16, Math.min(36, Math.min(rect.width / 45, rect.height / 24))));
      root.style?.setProperty?.("--immersefree-youtube-font-size", `${fontSize}px`);
      charsPerLine = linebreak?.resolveCharsPerLine(rect.width * .9, fontSize) ?? charsPerLine;
    }
    const nextSource = normalizeCaptionText(sourceText);
    const nextTranslation = normalizeCaptionText(translationText);
    // 語意合併之後，同一句的數個 cue 共用同一份譯文，180ms 的 tick 會一直
    // 送進相同內容。內容沒變就整個跳過：不重建 DOM、不重新量寬度，
    // 否則畫面上會看到同一句字幕不停重繪的閃爍。
    const signature = `${state}|${fontSize}|${charsPerLine}|${nextSource}|${nextTranslation}`;
    if (root.dataset.immerseFreeSignature === signature) return { root, source, translation };
    root.dataset.immerseFreeSignature = signature;
    writeSubtitleLines(source, nextSource, charsPerLine, 2);
    // 中文譯文一行到底（使用者要求，與串流字幕一致）：放不下先縮字級（最低到 65%），
    // 縮到底還塞不進才退回兩行——長句寧可小一點也不要切成兩行擋畫面。
    writeSubtitleLines(translation, nextTranslation, charsPerLine, 1);
    translation.dataset.state = state;
    translation.style?.removeProperty?.("font-size");
    translation.style?.setProperty?.("white-space", "nowrap", "important");
    if (rect?.width && rect?.height) {
      const box = root.querySelector(".immersefree-youtube-subtitle-box");
      const maxWidth = Math.round(rect.width * .9);
      root.style?.removeProperty?.("--immersefree-youtube-cue-width");
      box?.style?.setProperty?.("width", "auto", "important");
      const measure = (node) => {
        node.style?.setProperty?.("width", "max-content", "important");
        node.style?.setProperty?.("max-width", "none", "important");
        const width = node.getBoundingClientRect?.()?.width ?? 0;
        node.style?.removeProperty?.("width");
        node.style?.removeProperty?.("max-width");
        return width;
      };
      const sourceWidth = Math.min(measure(source), maxWidth);
      let translationWidth = measure(translation);
      if (translationWidth > maxWidth && fontSize) {
        const scale = maxWidth / translationWidth;
        if (scale >= .65) {
          translation.style?.setProperty?.("font-size", `${Math.floor(fontSize * scale)}px`, "important");
        } else {
          // 縮到 65% 仍放不下：退回兩行，字級維持原大小。
          translation.style?.removeProperty?.("white-space");
          writeSubtitleLines(translation, nextTranslation, charsPerLine, 2);
        }
        translationWidth = Math.min(measure(translation), maxWidth);
      }
      box?.style?.removeProperty?.("width");
      const cueWidth = Math.round(Math.max(120, Math.min(Math.max(sourceWidth, translationWidth), maxWidth)));
      root.style?.setProperty?.("--immersefree-youtube-cue-width", `${cueWidth}px`);
    }
    return { root, source, translation };
  }

  function copyNativeTypography(document, source, target) {
    const computed = document.defaultView?.getComputedStyle?.(source);
    if (!computed || !target?.style?.setProperty) return;
    for (const property of ["font-family", "font-size", "font-style", "font-weight", "letter-spacing", "line-height", "text-shadow"]) {
      const value = computed.getPropertyValue(property);
      if (value) target.style.setProperty(property, value, "important");
    }
  }

  function removeNativeTranslation(document) {
    for (const node of document.querySelectorAll(".immersefree-youtube-translation-line, .immersefree-youtube-translation, .immersefree-youtube-translation-break")) node.remove();
    for (const node of document.querySelectorAll(".immersefree-youtube-caption-window")) {
      node.classList?.remove("immersefree-youtube-caption-window");
    }
    for (const node of document.querySelectorAll(".immersefree-youtube-subtitle-root")) node.remove();
    for (const node of document.querySelectorAll(".immersefree-youtube-subtitle-active")) {
      node.classList?.remove("immersefree-youtube-subtitle-active");
    }
  }

  function isVisible(node) {
    if (!node?.getBoundingClientRect) return true;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function normalizeLanguage(value) {
    return String(value ?? "").trim().replace("_", "-").toLowerCase();
  }

  function cleanText(value) {
    return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  function normalizeCaptionText(value) {
    return cleanText(String(value ?? "").replace(/(^|\s)>+\s*/g, "$1"));
  }

  const youtubeSubtitles = Object.freeze({
    buildBufferedCuePlan,
    buildTimedTextUrl,
    extractInnertubeApiKey,
    extractCaptionTrack,
    findCueIndex,
    isYouTubeAdVisible,
    isYouTubeVideoUrl,
    normalizeCaptionText,
    parseJson3Transcript,
    parseJson3TranscriptText,
    parseTranscriptXml,
    prioritizeCueIndices,
    readNativeCue,
    removeNativeTranslation,
    upsertNativeTranslation,
    upsertPlayerSubtitle
  });
  global.ImmerseFreeYouTubeSubtitles = youtubeSubtitles;
})(globalThis);
