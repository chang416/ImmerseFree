(function initializePlayerContextCore(global) {
  // 「這個元素是不是播放器內部的東西」的唯一判準（W4-1 修 W1/W2 遺留 bug）。
  //
  // 為什麼要獨立成一個檔：原本這段是 content/page-translator.js 裡的
  // 一行 `element.closest(PLAYER_SELECTORS)`，而 PLAYER_SELECTORS 含
  // `[class*='subtitle']` 與 `[class*='caption']`——子字串比對，於是
  //   <h3 class="subtitle">   （新聞／電子報的文章副標）
  //   <figcaption class="caption">（圖說）
  // 全部被當成播放器字幕跳過，**永遠翻不出來又不會有任何錯誤訊息**
  // （w3-2-log.md 第 7 節實測記錄）。獨立成純函式之後，Node 測試可以直接
  // 餵 DOM 進來驗，不必起瀏覽器。
  //
  // 修法：把排除規則分成兩層——
  //   1. STRICT：名字本身就只可能是播放器的東西，任何位置都排除
  //      （維持原行為，這一層一個字都沒放寬）。
  //   2. LOOSE：`subtitle`／`caption` 這種在一般網頁上另有含義的字，
  //      **只有真的位於播放器語境內**才排除。
  //
  // 「播放器語境」的判準刻意要求兩個條件同時成立，避免又矯正過度：
  //   (a) 祖先鏈上（有限層數內）有個容器的名字看起來像播放器，
  //       **而且**那個容器裡真的有 <video>／原生字幕軌節點；或
  //   (b) 祖先鏈上有個容器有 <video> **直接子元素**（沒有 class 名可認的
  //       自製播放器）。要求「直接子元素」是為了不讓「整頁某處有一支影片」
  //       就把全頁的 caption 都當字幕——那等於回到原本的 bug。
  //
  // 字幕的文字每一兩秒換一次，插進去的譯文只會停在按下當下的那一句，
  // 從此黏在原生字幕下面不再更新——畫面上多出一行對不上的中文，
  // 看起來很像字幕功能壞了。所以播放器內部確實要排除，只是不能這樣寬。

  const STRICT_PLAYER_SELECTORS = [
    "video",
    "[class*='timedtext']",
    "[data-uia*='player']",
    "[class*='player-controls']"
  ].join(",");

  // 這兩個字在一般網頁上是「文章副標」與「圖說」。
  const LOOSE_SUBTITLE_SELECTORS = [
    "[class*='subtitle']",
    "[class*='caption']"
  ].join(",");

  // 名字看起來像播放器的容器。單獨命中不算數，還要 containsMedia() 成立。
  const PLAYER_ROOT_SELECTORS = [
    "[class*='player']",
    "[id*='player']",
    "[data-uia*='player']",
    "[class*='videoPlayer']",
    "[class*='video-player']",
    "[class*='jwplayer']",
    "[class*='vjs-']",
    "[class*='plyr']",
    "[class*='shaka']"
  ].join(",");

  // 播放器一定有的東西。<track> 不列入：它是 <video> 的子元素，
  // 命中它等於命中 video，多一條只是多一次比對。
  const PLAYER_MEDIA_SELECTORS = "video,[class*='timedtext']";

  // 往上找幾層。播放器的字幕層離 <video> 很近（YouTube 4 層、Netflix 5 層）；
  // 放到 10 層有餘裕，又不會一路爬到 <body> 把整頁都算成播放器。
  const PLAYER_CONTEXT_MAX_DEPTH = 10;

  function safeMatches(element, selector) {
    if (!element || typeof element.matches !== "function") return false;
    try {
      return element.matches(selector);
    } catch {
      // 選擇器在某些老引擎上不支援時，寧可「不是播放器」——
      // 少排除一塊的代價是多翻一行，反過來是整區永遠不翻。
      return false;
    }
  }

  function safeClosest(element, selector) {
    if (!element || typeof element.closest !== "function") return null;
    try {
      return element.closest(selector);
    } catch {
      return null;
    }
  }

  function containsMedia(element) {
    if (!element || typeof element.querySelector !== "function") return false;
    try {
      return Boolean(element.querySelector(PLAYER_MEDIA_SELECTORS));
    } catch {
      return false;
    }
  }

  function hasDirectMediaChild(element) {
    const children = element?.children ?? [];
    for (const child of children) {
      if (String(child?.tagName ?? "").toLowerCase() === "video") return true;
    }
    return false;
  }

  // node 是否位於播放器語境內（判準見檔頭）。
  function isInsidePlayerContext(node) {
    let current = node;
    for (let depth = 0; current && depth < PLAYER_CONTEXT_MAX_DEPTH; depth += 1) {
      if (safeMatches(current, PLAYER_ROOT_SELECTORS) && containsMedia(current)) return true;
      if (hasDirectMediaChild(current)) return true;
      current = current.parentElement ?? null;
    }
    return false;
  }

  // 對外唯一入口：這個元素該不該被「翻譯這個網頁」跳過。
  function insidePlayer(element) {
    if (!element) return false;
    if (safeClosest(element, STRICT_PLAYER_SELECTORS)) return true;
    const loose = safeClosest(element, LOOSE_SUBTITLE_SELECTORS);
    if (!loose) return false;
    return isInsidePlayerContext(loose);
  }

  const playerContextCore = Object.freeze({
    STRICT_PLAYER_SELECTORS,
    LOOSE_SUBTITLE_SELECTORS,
    PLAYER_ROOT_SELECTORS,
    PLAYER_MEDIA_SELECTORS,
    PLAYER_CONTEXT_MAX_DEPTH,
    containsMedia,
    hasDirectMediaChild,
    isInsidePlayerContext,
    insidePlayer
  });

  global.ImmerseFreePlayerContextCore = playerContextCore;
  if (typeof module !== "undefined" && module.exports) module.exports = playerContextCore;
})(globalThis);
