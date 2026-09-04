(function initializeSubtitleFormatCore(global) {
  // 字幕檔解析。串流平台的字幕本身沒有被 DRM 保護——Widevine 保護的是影像和
  // 聲音，字幕是純文字，用一般 HTTPS 送。所以只要拿得到網址就解得開，
  // 而且時間碼是官方給的，不會有自己推算時間軸的誤差。
  //
  // 兩種格式都要支援：HLS 走分段 WebVTT，DASH 和 Netflix 走 TTML。

  // ------------------------------------------------------------------ WebVTT
  //
  // HLS 的分段 VTT 有個坑：每個分段的時間碼是「分段內的相對時間」，真正的
  // 播放時間要靠 X-TIMESTAMP-MAP 換算。少了這步，第二段以後的字幕會全部
  // 疊在影片開頭。
  // X-TIMESTAMP-MAP 的 MPEGTS 是串流的絕對 PTS，不保證從 0 起算。直接拿它當
  // 位移，整份字幕就會被推移一個固定的量——畫面上看起來就是「字幕跟劇情對不上，
  // 而且從頭錯到尾」。所以這裡只負責把值讀出來，要減掉哪個基準由呼叫端決定。
  function readTimestampMap(text) {
    const map = String(text ?? "").match(/X-TIMESTAMP-MAP\s*[=:]\s*([^\n\r]+)/i);
    if (!map) return null;
    const local = map[1].match(/LOCAL:\s*(\d{1,3}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})/i);
    const mpegts = map[1].match(/MPEGTS:\s*(\d+)/i);
    if (!local || !mpegts) return null;
    const localSeconds = parseTimestamp(local[1]);
    if (localSeconds === null) return null;
    // MPEG-2 傳輸串流的時鐘固定是 90kHz。
    return { mpegtsSeconds: Number(mpegts[1]) / 90000, localSeconds };
  }

  function parseWebVtt(text, options = {}) {
    const clean = String(text ?? "").replace(/\r\n?/g, "\n").replace(/^﻿/, "");
    if (!clean.trim()) return [];

    let offset = Number(options.offsetSeconds) || 0;
    // 呼叫端自己算好位移時（分段字幕就是這種情況）要能關掉這裡的自動套用，
    // 否則會重複加兩次。
    if (!options.ignoreTimestampMap) {
      const map = readTimestampMap(clean);
      if (map) offset += map.mpegtsSeconds - map.localSeconds;
    }

    const cues = [];
    for (const block of clean.split(/\n{2,}/)) {
      const lines = block.split("\n").filter((line) => line.trim());
      if (!lines.length) continue;
      const arrowIndex = lines.findIndex((line) => line.includes("-->"));
      if (arrowIndex < 0) continue;
      const timing = lines[arrowIndex].split("-->");
      if (timing.length < 2) continue;
      const start = parseTimestamp(timing[0]);
      // 結束時間後面可能跟著 line:90% align:center 之類的排版設定，只取第一段。
      const end = parseTimestamp(timing[1].trim().split(/\s+/)[0]);
      if (start === null || end === null) continue;
      const text = cleanCueText(lines.slice(arrowIndex + 1).join("\n"));
      if (!text) continue;
      cues.push({ start: start + offset, end: end + offset, text });
    }
    return normalizeCues(cues);
  }

  function parseTimestamp(value) {
    const match = String(value ?? "").trim()
      .match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
    if (!match) return null;
    const hours = Number(match[1] ?? 0);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const millis = Number(String(match[4] ?? "0").padEnd(3, "0"));
    return hours * 3600 + minutes * 60 + seconds + millis / 1000;
  }

  // ------------------------------------------------------------------ TTML
  //
  // Netflix 用 tick 當時間單位（tickRate 通常是 10000000），DASH 常見的是
  // clock-time。兩種都要吃，不然會解出一堆 0。
  function parseTtml(text, options = {}) {
    const source = String(text ?? "");
    if (!source.trim()) return [];
    let document;
    try {
      document = new DOMParser().parseFromString(source, "application/xml");
    } catch {
      return [];
    }
    if (document.querySelector("parsererror")) return [];

    const root = document.documentElement;
    const tickRate = Number(attributeOf(root, "tickRate")) || 10000000;
    const frameRate = Number(attributeOf(root, "frameRate")) || 30;
    const offset = Number(options.offsetSeconds) || 0;

    const cues = [];
    for (const node of document.getElementsByTagName("*")) {
      if (node.localName !== "p") continue;
      const begin = parseTtmlTime(attributeOf(node, "begin"), tickRate, frameRate);
      let end = parseTtmlTime(attributeOf(node, "end"), tickRate, frameRate);
      if (begin === null) continue;
      if (end === null) {
        const duration = parseTtmlTime(attributeOf(node, "dur"), tickRate, frameRate);
        end = duration === null ? begin + 3 : begin + duration;
      }
      const text = cleanCueText(ttmlNodeText(node));
      if (!text) continue;
      cues.push({ start: begin + offset, end: end + offset, text });
    }
    return normalizeCues(cues);
  }

  // TTML 的屬性大量使用命名空間前綴（ttp:tickRate、tts:textAlign），
  // 而 getAttribute 不會忽略前綴，所以自己比對 localName。
  function attributeOf(node, name) {
    if (!node?.attributes) return "";
    for (const attribute of node.attributes) {
      if (attribute.localName === name || attribute.name === name) return attribute.value;
    }
    return "";
  }

  function ttmlNodeText(node) {
    let text = "";
    for (const child of node.childNodes) {
      if (child.nodeType === 3) text += child.nodeValue;
      else if (child.localName === "br") text += "\n";
      else if (child.nodeType === 1) text += ttmlNodeText(child);
    }
    return text;
  }

  function parseTtmlTime(value, tickRate, frameRate) {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    const offsetMatch = raw.match(/^(\d+(?:\.\d+)?)(h|m|s|ms|f|t)$/i);
    if (offsetMatch) {
      const amount = Number(offsetMatch[1]);
      switch (offsetMatch[2].toLowerCase()) {
        case "h": return amount * 3600;
        case "m": return amount * 60;
        case "s": return amount;
        case "ms": return amount / 1000;
        case "f": return amount / frameRate;
        case "t": return amount / tickRate;
        default: return null;
      }
    }
    const clock = raw.match(/^(\d{1,3}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?$/);
    if (clock) {
      return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) +
        Number(String(clock[4] ?? "0").padEnd(3, "0")) / 1000;
    }
    // hh:mm:ss:frames，TTML 的影格式時間碼
    const frames = raw.match(/^(\d{1,3}):(\d{2}):(\d{2}):(\d{1,3})$/);
    if (frames) {
      return Number(frames[1]) * 3600 + Number(frames[2]) * 60 + Number(frames[3]) +
        Number(frames[4]) / frameRate;
    }
    return null;
  }

  // ------------------------------------------------------------------ 共用
  function cleanCueText(value) {
    return String(value ?? "")
      // 字幕常帶 <i> <b> <c.classname> 這類標記和 ruby，一律拆掉只留文字。
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#(\d+);/g, (all, code) => String.fromCharCode(Number(code)))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  // 分段字幕在邊界會重複同一句（同一句橫跨兩個分段），去重之後才不會
  // 在切換分段時閃一下。
  function normalizeCues(cues) {
    const sorted = cues
      .filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.text)
      .map((cue) => ({ ...cue, end: cue.end > cue.start ? cue.end : cue.start + 2 }))
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const result = [];
    for (const cue of sorted) {
      const previous = result[result.length - 1];
      if (previous && previous.text === cue.text && Math.abs(previous.start - cue.start) < 0.25) {
        previous.end = Math.max(previous.end, cue.end);
        continue;
      }
      result.push(cue);
    }
    return result;
  }

  // 分段字幕的時間軸對齊。整條路最容易錯的地方，所以獨立成純函式好測。
  //
  // 輸入是 [{ startSeconds, duration, text, url }]，startSeconds 來自播放清單的
  // EXTINF 累加。回傳已經換算成「整部影片時間」的 cue 陣列。
  //
  // 兩個坑：
  //   1. X-TIMESTAMP-MAP 的 MPEGTS 是串流的絕對 PTS，不保證從 0 起算。直接拿來
  //      當位移，整份字幕會被推移一個固定量。要以第一段為基準只取相對差。
  //   2. 有些平台的分段時間碼本來就是整部片的絕對時間，那種再加位移會加兩次。
  //      這個判斷必須整條軌只做一次——逐段各自判斷的話，各段結論可能不同，
  //      同一份字幕就會有的加了有的沒加，變成一段一段錯開。
  function alignSegmentedCues(segments, options = {}) {
    // 雙軌字幕必須讓不同語言共用同一個 MPEGTS 時鐘。不能各自把「第一個有
    // 台詞的分段」歸零：中文第一句若比英文晚 30 秒，歸零後整條中文就會提早
    // 30 秒。保留 X-TIMESTAMP-MAP 的絕對 PTS，之後用播放器正在顯示的原生
    // 字幕把 PTS 校準到 video.currentTime，兩條官方軌才會真正對齊。
    if (options.preserveTimestampMap) {
      const absolute = [];
      for (const segment of segments ?? []) {
        const parsed = parseSubtitle(segment.text, segment.url ?? "", { ignoreTimestampMap: true });
        if (!parsed.length) continue;
        const map = readTimestampMap(segment.text);
        const shift = map
          ? map.mpegtsSeconds - map.localSeconds
          : Number(segment.startSeconds) || 0;
        for (const cue of parsed) {
          absolute.push({ ...cue, start: cue.start + shift, end: cue.end + shift });
        }
      }
      return normalizeCues(absolute);
    }

    let base = null;
    const parts = [];
    for (const segment of segments ?? []) {
      const parsed = parseSubtitle(segment.text, segment.url ?? "", { ignoreTimestampMap: true });
      if (!parsed.length) continue;
      const map = readTimestampMap(segment.text);
      let offset = Number(segment.startSeconds) || 0;
      if (map) {
        const raw = map.mpegtsSeconds - map.localSeconds;
        if (base === null) base = raw - offset;
        const derived = raw - base;
        // 兩個來源差太多代表這份 MPEGTS 不可信，退回播放清單的時間。
        if (Math.abs(derived - offset) <= 30) offset = derived;
      }
      parts.push({ segment, parsed, offset });
    }
    if (!parts.length) return [];

    let absoluteVotes = 0;
    let relativeVotes = 0;
    for (const { segment, parsed } of parts) {
      const start = Number(segment.startSeconds) || 0;
      // 開頭那幾段判斷不出來（位移本來就接近 0），不投票。
      if (start <= 5) continue;
      const first = parsed[0].start;
      const windowEnd = start + (Number(segment.duration) || 0) + 5;
      if (first >= start - 5 && first <= windowEnd) absoluteVotes += 1;
      else relativeVotes += 1;
    }
    const alreadyAbsolute = absoluteVotes > relativeVotes;

    const cues = [];
    for (const { parsed, offset } of parts) {
      const shift = alreadyAbsolute ? 0 : offset;
      for (const cue of parsed) cues.push({ ...cue, start: cue.start + shift, end: cue.end + shift });
    }
    return normalizeCues(cues);
  }

  function detectFormat(text, url = "") {
    const head = String(text ?? "").slice(0, 400);
    if (/^﻿?WEBVTT/.test(head)) return "vtt";
    if (/<tt[\s>]|<tt:tt[\s>]|xmlns[^>]*ttml/i.test(head)) return "ttml";
    if (/\.vtt(\?|$)/i.test(url)) return "vtt";
    if (/\.(ttml|dfxp|xml)(\?|$)/i.test(url)) return "ttml";
    if (/-->/.test(head)) return "vtt";
    return "";
  }

  function parseSubtitle(text, url = "", options = {}) {
    const format = detectFormat(text, url);
    if (format === "vtt") return parseWebVtt(text, options);
    if (format === "ttml") return parseTtml(text, options);
    return [];
  }

  // tolerance 把每句的顯示區間往前後各撐開一點。
  //
  // 兩條字幕軌的斷句不會完全一致，中文軌的句子邊界常和英文軌差個零點幾秒。
  // 沒有容差的話，那些縫隙會讓我們這行在原生字幕還在的時候突然消失又出現，
  // 看起來就是「有時候有有時候沒有」。
  function normalizeCueText(value) {
    return String(value ?? "")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cueTextMatches(left, right) {
    if (!left || !right) return false;
    if (left === right) return true;
    const shorter = left.length <= right.length ? left : right;
    const longer = left.length <= right.length ? right : left;
    // 「Yeah」「one of」這種短片語會在同一集出現很多次，不能拿來校準。
    if (shorter.replace(/\s+/g, "").length < 10) return false;
    return longer.includes(shorter);
  }

  // 對時校準：畫面上正在顯示的原生字幕，一定對應到官方字幕檔裡的某一句。
  // 找到那一句，就知道「字幕檔時間軸」和 video.currentTime 差多少——
  // 這是沉浸式翻譯那套能永遠對得準的原因：基準來自播放器實際在演的東西。
  //
  // 同一句台詞可能出現很多次（Yeah. / Okay.），所以挑「離目前推定位置最近」
  // 的那次：已經在窗內就不動（回傳原 offset），在窗外才把 offset 貼齊到
  // 那句的開頭（代表它剛出現）。
  function calibrateOffset(cues, displayedText, seconds, currentOffset = 0) {
    const wanted = normalizeCueText(displayedText);
    if (!wanted || !cues?.length || !Number.isFinite(seconds)) return currentOffset;
    let best = null;
    let bestDistance = Infinity;
    const target = seconds + currentOffset;
    for (const cue of cues) {
      if (!cueTextMatches(normalizeCueText(cue.text), wanted)) continue;
      const distance = target < cue.start ? cue.start - target : target > cue.end ? target - cue.end : 0;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = cue;
      }
    }
    if (!best) return currentOffset;
    if (bestDistance === 0) return currentOffset;
    return best.start - seconds;
  }

  function findCueAt(cues, seconds, tolerance = 0) {
    if (!cues?.length) return "";
    let low = 0;
    let high = cues.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const cue = cues[mid];
      if (seconds < cue.start - tolerance) high = mid - 1;
      else if (seconds > cue.end + tolerance) low = mid + 1;
      else return cue.text;
    }
    return "";
  }

  global.ImmerseFreeSubtitleFormat = Object.freeze({
    parseSubtitle,
    parseWebVtt,
    parseTtml,
    parseTimestamp,
    readTimestampMap,
    alignSegmentedCues,
    calibrateOffset,
    detectFormat,
    normalizeCues,
    findCueAt
  });
})(globalThis);
