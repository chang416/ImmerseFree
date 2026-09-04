(function initializeStreamingSubtitleCore(global) {
  // 2B 起譯文是完整句子，換行由前端自己算（照標點與英文詞界切，最多兩行），
  // 不再靠 white-space: nowrap 硬撐一行再讓播放器決定要不要折。
  const linebreak = global.ImmerseFreeSubtitleLinebreak;
  const SITE_SELECTORS = {
    netflix: [
      "[data-uia='player-subtitle-text']",
      ".player-timedtext-text-container",
      ".player-timedtext"
    ],
    disney: [
      "[data-testid*='subtitle']",
      "[class*='subtitle-renderer']",
      "[class*='SubtitleRenderer']",
      "[class*='subtitle']"
    ]
  };

  function detectSite(hostname = "") {
    const host = String(hostname).toLowerCase();
    if (host === "netflix.com" || host.endsWith(".netflix.com")) return "netflix";
    if (host === "disneyplus.com" || host.endsWith(".disneyplus.com")) return "disney";
    return "";
  }

  // Disney+ 的播放器把字幕畫在 shadow DOM 裡，一般的 querySelectorAll 穿不進去，
  // 從外面看整個播放器就像沒有字幕——AI 影片字幕因此在 Disney+ 完全偵測不到。
  // 這裡把整棵 shadow 樹也納入搜尋。全頁掃描約一毫秒，快取 1.5 秒足夠——
  // 快取太久的話，播放器動態建立的字幕容器要等很久才被看見。
  let shadowCache = { roots: [], at: 0, doc: null };

  function shadowRootsOf(document) {
    const now = Date.now();
    if (shadowCache.doc === document && now - shadowCache.at < 1500) return shadowCache.roots;
    const roots = [];
    const scan = (root) => {
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot) {
          roots.push(element.shadowRoot);
          scan(element.shadowRoot);
        }
      }
    };
    try {
      scan(document);
    } catch {
      // 掃不動就用舊的，下一輪再試。
    }
    shadowCache = { roots, at: now, doc: document };
    return roots;
  }

  function deepQueryAll(document, selector) {
    const out = [...document.querySelectorAll(selector)];
    for (const root of shadowRootsOf(document)) {
      try {
        out.push(...root.querySelectorAll(selector));
      } catch {
        // 個別 shadow root 拒絕查詢就跳過。
      }
    }
    return out;
  }

  // mode 是 disabled 的字幕軌，瀏覽器根本不會載入 cue。切成 hidden 之後
  // cue 會開始載入但不會畫出來——資料拿得到，畫面不受影響。
  function ensureTracksLoaded(document) {
    for (const video of deepQueryAll(document, "video")) {
      for (const track of video.textTracks ?? []) {
        if ((track.kind === "subtitles" || track.kind === "captions") && track.mode === "disabled") {
          try {
            track.mode = "hidden";
          } catch {
            // 有些播放器鎖住 mode，改不動就算了。
          }
        }
      }
    }
  }

  // 我們自己插進去的字幕列，class 裡也有 subtitle 這個字，會被
  // [class*='subtitle'] 抓中。不排除的話它會拿自己當定位錨點，
  // 每個 tick 往下挪一次，最後黏死在畫面最底端。
  //
  // 注意兩種屬性拼法都要列：dataset.immerseFreeExtensionRoot 寫出來的屬性是
  // data-immerse-free-extension-root（駝峰每個大寫字母前都插一個連字號），
  // 和專案其他地方查的 [data-immersefree-extension-root] 並不相等——只查後者
  // 等於這道防護從來沒生效過。class 也一起列，多一層保險。
  const OWN_NODE_SELECTOR = [
    "[data-immersefree-extension-root]",
    "[data-immerse-free-extension-root]",
    ".immersefree-streaming-translation",
    ".immersefree-subtitle-line"
  ].join(",");

  function isOwnNode(node) {
    try {
      return Boolean(node?.closest?.(OWN_NODE_SELECTOR));
    } catch {
      return false;
    }
  }

  // 播放器把一句字幕拆成多個節點（Netflix 用 <br>、Disney 一行一個 div）。
  // textContent 會把 <br> 兩邊的字直接黏成一個單字（HelloWorld），對時比對
  // 就再也對不上；所以換行處要自己補回分隔。
  const BLOCK_TAGS = new Set(["div", "p", "li", "section", "article", "tr", "td", "th"]);

  function captionTextOf(node) {
    if (!node) return "";
    if (!node.childNodes) return cleanText(node.textContent);
    let out = "";
    const walk = (parent) => {
      for (const child of parent.childNodes) {
        if (child.nodeType === 3) { out += child.nodeValue; continue; }
        if (child.nodeType !== 1) continue;
        const tag = String(child.localName ?? "").toLowerCase();
        if (tag === "br") { out += " "; continue; }
        if (BLOCK_TAGS.has(tag)) { out += " "; walk(child); out += " "; continue; }
        walk(child);
      }
    };
    walk(node);
    return cleanText(out);
  }

  // 同一個 selector 會同時命中外層容器與內層每一行。外層是內層的祖先，
  // 文字會重複好幾份，所以只留「不包含其他候選」的最內層節點。
  function innermostOnly(items) {
    return items.filter((item) => !items.some((other) =>
      other !== item && item.node.contains?.(other.node)));
  }

  // 一句字幕本來就可能有兩三行。配對與定位都要以「整句」為單位，
  // 只取最後一行的話，多行字幕永遠只比對得到一半。
  function sameCueGroup(items) {
    const anchor = items[items.length - 1];
    const span = Math.max(48, (anchor.rect?.height ?? 0) * 4);
    return items.filter((item) => item === anchor || (
      Math.abs((item.rect?.bottom ?? 0) - (anchor.rect?.bottom ?? 0)) <= span
      && (item.rect?.right ?? 0) > (anchor.rect?.left ?? 0) - 240
      && (item.rect?.left ?? 0) < (anchor.rect?.right ?? 0) + 240
    ));
  }

  function readNativeCaption(document, hostname) {
    const site = detectSite(hostname);
    const selectors = SITE_SELECTORS[site] ?? [];
    ensureTracksLoaded(document);
    for (const selector of selectors) {
      const candidates = innermostOnly(deepQueryAll(document, selector)
        .filter((node) => !isOwnNode(node))
        .filter((node) => isVisibleCaption(node, document.defaultView))
        .map((node) => ({ node, rect: node.getBoundingClientRect?.() ?? null, text: captionTextOf(node) }))
        .filter((item) => item.text));
      if (!candidates.length) continue;
      const group = sameCueGroup(candidates);
      return {
        node: group[group.length - 1].node,
        nodes: group.map((item) => item.node),
        text: cleanText(group.map((item) => item.text).join(" "))
      };
    }
    const trackCue = readActiveTextTrack(document);
    return trackCue ? { node:undefined, nodes:[], text:trackCue } : undefined;
  }

  function collectTextTrackCues(document) {
    ensureTracksLoaded(document);
    const cues = [];
    for (const video of deepQueryAll(document, "video")) {
      for (const track of video.textTracks ?? []) {
        for (const cue of track.cues ?? []) {
          const text = cleanText(cue.text);
          if (!text) continue;
          cues.push({
            startMs:Math.max(0, Number(cue.startTime) || 0) * 1000,
            endMs:Math.max(0, Number(cue.endTime) || 0) * 1000,
            text
          });
        }
      }
    }
    return cues
      .sort((a,b) => a.startMs-b.startMs)
      .filter((cue,index,all) => index === 0 || cue.text !== all[index-1].text || cue.startMs !== all[index-1].startMs);
  }

  // source 是 "dual"（平台自己的字幕軌，不花額度）或 "ai"（模型翻譯，會消耗額度）。
  // 兩者共用同一條字幕列，所以在列上留一條細色帶，看片時不用開 popup
  // 也分得出來現在跑的是哪一種。
  function upsertNativeTranslation(document, caption, translation, source = "ai") {
    // 同時只留一條。兩個功能共用這個 class，任何時候多出來的都是殘留，
    // 留著就會變成畫面上兩三行中文。
    const existing = deepQueryAll(document, ".immersefree-streaming-translation");
    for (let i = 1; i < existing.length; i += 1) existing[i].remove();
    let line = existing[0];
    if (!line) {
      line = document.createElement("div");
      line.className = "immersefree-streaming-translation";
      line.dataset.immerseFreeExtensionRoot = "streaming-subtitle";
      // 專案各處查的是這個拼法，dataset 那個寫出來會多兩個連字號，
      // 只設 dataset 的話所有 [data-immersefree-extension-root] 判斷全部落空。
      line.setAttribute("data-immersefree-extension-root", "streaming-subtitle");
      line.setAttribute("lang", "zh-Hant");
      line.setAttribute("aria-live", "polite");
    }
    if (line.dataset.immerseFreeSource !== source) line.dataset.immerseFreeSource = source;
    // Fullscreen renders only the fullscreen element's subtree, so a line left
    // on <html> silently disappears the moment the player goes fullscreen —
    // which is how people actually watch Netflix and Disney+. Follow the host.
    const host = document.fullscreenElement ?? document.documentElement;
    if (line.parentElement !== host) host.append(line);
    // 先套字型（行寬要照實際字級算），再切行，最後才定位。
    copyTypography(document, caption?.node, line);
    const lineCount = writeStreamingLines(document, line, translation);
    positionLine(document, line, caption, lineCount);
    line.dataset.state = "ready";
    return line;
  }

  // Netflix／Disney+ 疊在播放器上的中文行「一行到底、不換行」（使用者明確要求：
  // 這種貼片式字幕切成兩行會擋畫面也不像正規串流字幕）。放不下時交給
  // positionLine 既有的縮字級機制，內容不截斷。YouTube 的 AI 字幕換行
  // 在 youtube-subtitle-core，另一套規則，不受此處影響。
  function writeStreamingLines(document, line, translation) {
    line.textContent = cleanText(translation);
    return 1;
  }

  function measureMaxLineWidth(document) {
    const viewportWidth = document.defaultView?.innerWidth ?? 1280;
    const video = deepQueryAll(document, "video").find(isVisibleVideo);
    const videoWidth = video?.getBoundingClientRect?.().width ?? viewportWidth;
    return Math.round(Math.min(viewportWidth * .9, videoWidth * .9));
  }

  function removeNativeTranslation(document) {
    deepQueryAll(document, ".immersefree-streaming-translation").forEach((node) => node.remove());
    restoreNativeCaptionLayout();
    releaseCaptionLift();
  }

  // 播放器的字幕容器在兩句之間會空掉或整個消失，那一瞬間找不到錨點。
  // 若每次都退回「影片底部」，我們這行就會在原生字幕旁跟畫面底端之間跳來跳去，
  // 看起來就像跑到別的地方去了。記住最後一次有效的位置，缺錨點時沿用。
  let lastAnchor = null;

  // Disney 會把一句字幕切成數個 inline span，再用 pre-line 保留 span 之間的
  // 原始換行。只要整句放得進影片安全寬度，就把這些人工換行折成一行；若句子
  // 太長則立即還原平台樣式，避免把文字推出畫面。
  let activeCaptionCompaction = [];

  function restoreNativeCaptionLayout() {
    for (const item of activeCaptionCompaction) {
      try {
        if (item.value) item.node.style.setProperty("white-space", item.value, item.priority);
        else item.node.style.removeProperty("white-space");
      } catch {
        // 播放器換句時可能已把舊節點移除，略過即可。
      }
    }
    activeCaptionCompaction = [];
  }

  function preferSingleLineCaption(anchor, maxWidth) {
    restoreNativeCaptionLayout();
    const windowNode = anchor?.closest?.(".hive-subtitle-renderer-cue-window");
    if (!windowNode) return false;
    const nodes = [
      windowNode,
      ...(windowNode.querySelectorAll?.(".hive-subtitle-renderer-cue,.hive-subtitle-renderer-line") ?? [])
    ];
    activeCaptionCompaction = nodes.map((node) => ({
      node,
      value: node.style.getPropertyValue("white-space"),
      priority: node.style.getPropertyPriority("white-space")
    }));
    for (const node of nodes) node.style.setProperty("white-space", "nowrap", "important");
    const rect = windowNode.getBoundingClientRect?.();
    const naturalWidth = Math.max(Number(windowNode.scrollWidth) || 0, Number(rect?.width) || 0);
    if (naturalWidth <= Math.max(1, Number(maxWidth) || 0) + 1) return true;
    restoreNativeCaptionLayout();
    return false;
  }

  // 讓位機制。
  //
  // 原生字幕本來就貼在影片底部，我們這行擺到它下面時常常已經沒有空間；
  // 舊版的做法是把自己往上夾（Math.min(desiredTop, safeBottom - height)），
  // 結果就是「一行外文一行中文」變成兩行疊在同一個位置——使用者看到的
  // 「中文黏在英文那一行」就是這樣來的。正確做法是把原生字幕整句往上推，
  // 空出下面那一行，兩行才真的分得開。
  let activeCaptionLift = [];

  function releaseCaptionLift() {
    for (const item of activeCaptionLift) {
      try {
        if (item.value) item.node.style.setProperty("transform", item.value, item.priority);
        else item.node.style.removeProperty("transform");
      } catch {
        // 播放器換句時舊節點可能已被移除，略過即可。
      }
    }
    activeCaptionLift = [];
  }

  function applyCaptionLift(document, nodes, pixels) {
    if (!(pixels > 0.5) || !nodes?.length) return 0;
    const view = document.defaultView;
    for (const node of nodes) {
      try {
        // 站方常用 transform 做水平置中（translateX(-50%)）。直接覆寫會把字幕
        // 水平位置一起弄歪，所以要接在既有的變換後面，不是取代它。
        const base = view?.getComputedStyle?.(node)?.transform;
        const prefix = base && base !== "none" ? `${base} ` : "";
        activeCaptionLift.push({
          node,
          value: node.style.getPropertyValue("transform"),
          priority: node.style.getPropertyPriority("transform")
        });
        node.style.setProperty("transform", `${prefix}translateY(${-pixels}px)`, "important");
      } catch {
        // 個別節點被鎖住就跳過，其餘照推。
      }
    }
    return pixels;
  }

  // 一句字幕的定位節點。Disney 的一句包在 cue-window 裡（推它就整句一起動），
  // Netflix 則是一行一個容器，要逐行推。
  function captionAnchorNodes(caption) {
    const raw = Array.isArray(caption?.nodes) && caption.nodes.length
      ? caption.nodes
      : (caption?.node ? [caption.node] : (caption?.getBoundingClientRect ? [caption] : []));
    const out = [];
    for (const node of raw) {
      const target = node?.closest?.(".hive-subtitle-renderer-cue-window") ?? node;
      if (target && !out.includes(target)) out.push(target);
    }
    return out;
  }

  function unionRectOf(nodes) {
    let box = null;
    for (const node of nodes ?? []) {
      const rect = node?.getBoundingClientRect?.();
      if (!rect || !(rect.width > 0) || !(rect.height > 0)) continue;
      box = box
        ? {
          top: Math.min(box.top, rect.top),
          left: Math.min(box.left, rect.left),
          bottom: Math.max(box.bottom, rect.bottom),
          right: Math.max(box.right, rect.right)
        }
        : { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right };
    }
    if (!box) return null;
    return { ...box, width: box.right - box.left, height: box.bottom - box.top };
  }

  // 譯文行與原生字幕之間固定留這麼多間距，看起來才像兩行字幕而不是一團。
  const LINE_GAP = 6;

  function planSubtitleLine(options = {}) {
    const viewportWidth = Math.max(1, Number(options.viewportWidth) || 1280);
    const viewportHeight = Math.max(1, Number(options.viewportHeight) || 720);
    const videoRect = options.videoRect ?? {};
    const videoWidth = Math.max(1, Number(videoRect.width) || viewportWidth);
    const videoHeight = Math.max(1, Number(videoRect.height) || viewportHeight);
    const videoTop = Math.max(0, Number(videoRect.top) || 0);
    const videoBottom = Math.min(viewportHeight, Number(videoRect.bottom) || viewportHeight);
    const maxWidth = Math.round(Math.min(viewportWidth * .9, videoWidth * .9));
    const fontSize = Math.max(1, Number(options.fontSize) || 24);
    const naturalWidth = Math.max(1, Number(options.naturalWidth) || maxWidth);
    // 換行器已經把譯文切成 lineCount 行，估高度要照真正的行數算，
    // 否則兩行字幕會被當成一行擺放，底邊掉出影片安全區。
    const lineCount = Math.max(1, Math.round(Number(options.lineCount) || 1));
    const minimumFontSize = Math.max(14, fontSize * .72);
    const fittedFontSize = Math.max(minimumFontSize, fontSize * Math.min(1, maxWidth / naturalWidth));
    const fittedWidth = naturalWidth * (fittedFontSize / fontSize);
    const singleLine = fittedWidth <= maxWidth + 1 && lineCount <= 1;
    const lineHeight = Math.max(fontSize, Number(options.lineHeight) || fontSize * 1.35);
    const fittedLineHeight = lineHeight * (fittedFontSize / fontSize);
    const estimatedHeight = fittedLineHeight * (singleLine ? 1 : Math.max(2, lineCount)) + 6;
    const safeInset = Math.max(14, Math.min(28, videoHeight * .018));
    const safeBottom = videoBottom - safeInset;
    const safeTop = videoTop + safeInset;
    const desiredTop = Number(options.anchorRect?.bottom) + LINE_GAP;
    const fallbackTop = videoBottom - Math.min(90, videoHeight * .12);
    const top = Math.max(
      safeTop,
      Math.min(Number.isFinite(desiredTop) ? desiredTop : fallbackTop, safeBottom - estimatedHeight)
    );
    return { fittedFontSize, estimatedHeight, maxWidth, safeBottom, safeTop, singleLine, top };
  }

  function positionLine(document, line, caption, lineCount = 1) {
    const viewportWidth = document.defaultView?.innerWidth ?? 1280;
    const viewportHeight = document.defaultView?.innerHeight ?? 720;
    const video = deepQueryAll(document, "video").find(isVisibleVideo);
    const videoRect = video?.getBoundingClientRect?.();
    const maxWidth = Math.round(Math.min(viewportWidth * .9, (videoRect?.width ?? viewportWidth) * .9));
    // 量之前先把上一輪推上去的位移還原，否則量到的是被自己推過的位置，
    // 每一輪就會再往上推一次，原生字幕會一路飄到畫面上緣。
    releaseCaptionLift();
    const anchorNodes = captionAnchorNodes(caption);
    preferSingleLineCaption(anchorNodes[0] ?? caption?.node, maxWidth);
    const rect = unionRectOf(anchorNodes);

    if (rect && rect.width > 0 && rect.height > 0) {
      lastAnchor = {
        centerX: rect.left + rect.width / 2,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        // 記下當時的視窗尺寸，切換全螢幕後舊座標就作廢。
        viewportWidth,
        viewportHeight
      };
    }

    const reusable = lastAnchor
      && lastAnchor.viewportWidth === viewportWidth
      && lastAnchor.viewportHeight === viewportHeight
      ? lastAnchor
      : null;

    const left = reusable
      ? reusable.centerX
      : (videoRect?.left ?? 0) + (videoRect?.width ?? viewportWidth) / 2;
    line.style.setProperty("left", `${left}px`, "important");
    line.style.setProperty("max-width", `${maxWidth}px`, "important");
    line.style.setProperty("white-space", "nowrap", "important");
    line.style.setProperty("overflow-wrap", "normal", "important");

    const computed = document.defaultView?.getComputedStyle?.(line);
    const fontSize = Number.parseFloat(computed?.fontSize) || 24;
    const lineHeight = Number.parseFloat(computed?.lineHeight) || fontSize * 1.35;
    const naturalWidth = Math.max(Number(line.scrollWidth) || 0, Number(line.getBoundingClientRect?.().width) || 0);
    const plan = planSubtitleLine({
      viewportWidth,
      viewportHeight,
      videoRect,
      anchorRect: reusable,
      naturalWidth,
      fontSize,
      lineHeight,
      lineCount
    });
    line.style.setProperty("font-size", `${plan.fittedFontSize}px`, "important");
    if (!plan.singleLine) {
      line.style.setProperty("white-space", "normal", "important");
      line.style.setProperty("overflow-wrap", "anywhere", "important");
    }
    line.style.setProperty("top", `${plan.top}px`, "important");

    // 字型渲染的實際高度可能和 line-height 的估算差好幾個像素，所以最終位置
    // 一律用真實方框重算一次。
    const height = Number(line.getBoundingClientRect?.().height) || plan.estimatedHeight;
    let top = plan.top;

    if (reusable && Number.isFinite(reusable.bottom)) {
      // 想擺的位置：原生字幕正下方。擺不下就把原生字幕整句往上推，
      // 而不是把自己往上夾到它身上——後者正是「中文黏在英文那一行」。
      let applied;
      if (anchorNodes.length) {
        const room = plan.safeBottom - height;
        const headroom = Math.max(0, reusable.top - plan.safeTop);
        const lift = Math.min(Math.max(0, reusable.bottom + LINE_GAP - room), headroom);
        applied = applyCaptionLift(document, anchorNodes, lift);
        reusable.lift = applied;
      } else {
        // 原生字幕在兩句之間會整個消失。這時沒有東西要讓位，但位置也不能重算，
        // 否則字幕列會在每個空隙跳一次，看起來就是「中文自己亂跑」。
        applied = Number(reusable.lift) || 0;
      }
      // 垂直分離是硬條件：任何情況下都不能壓在原生字幕上。
      top = reusable.bottom - applied + LINE_GAP;
    } else if (top + height > plan.safeBottom) {
      top = Math.max(0, plan.safeBottom - height);
    }

    // 最後保險：整行不能掉出畫面外。
    top = Math.max(0, Math.min(top, viewportHeight - height - 1));
    line.style.setProperty("top", `${top}px`, "important");
  }

  function forgetAnchor() {
    lastAnchor = null;
    restoreNativeCaptionLayout();
    releaseCaptionLift();
  }

  // 命中 selector 的往往是外層容器，字級卻設在裡面那層（Netflix 的字設在
  // .player-timedtext-text 上，容器本身是預設 16px）。照容器抄字型，譯文就會
  // 比原文小一大截，看起來不像同一組字幕。往下找到真正帶著整句文字的那層再抄。
  function typographyNodeOf(node) {
    let current = node;
    for (let depth = 0; depth < 4 && current; depth += 1) {
      const children = [...(current.children ?? [])];
      if (children.length !== 1) break;
      const child = children[0];
      if (cleanText(child.textContent) !== cleanText(current.textContent)) break;
      current = child;
    }
    return current;
  }

  function copyTypography(document, source, target) {
    const node = source ? typographyNodeOf(source) : undefined;
    const computed = node ? document.defaultView?.getComputedStyle?.(node) : undefined;
    for (const property of ["font-family", "font-size", "font-style", "font-weight", "letter-spacing", "line-height", "text-shadow"]) {
      const value = computed?.getPropertyValue?.(property);
      if (value) target.style.setProperty(property, value, "important");
    }
  }

  function readActiveTextTrack(document) {
    for (const video of deepQueryAll(document, "video")) {
      for (const track of video.textTracks ?? []) {
        // 只有 showing 的軌才是「使用者真的看得到的那一行」。
        // hidden 是我們自己為了讀 cue 才打開的（ensureTracksLoaded），
        // 把它當成畫面上的原生字幕，等於拿自己要顯示的那條去跟自己對時。
        if (track.mode !== "showing") continue;
        const text = [...(track.activeCues ?? [])].map((cue) => cleanText(cue.text)).filter(Boolean).join(" ");
        if (text) return text;
      }
    }
    return "";
  }

  function isVisibleCaption(node, view) {
    const rect = node.getBoundingClientRect?.();
    const style = view?.getComputedStyle?.(node);
    const text = captionTextOf(node);
    return text.length > 0 && text.length < 500 && rect?.width > 0 && rect?.height > 0
      && rect.top > (view?.innerHeight ?? 720) * .4
      && style?.visibility !== "hidden" && style?.display !== "none";
  }

  function isVisibleVideo(video) {
    const rect = video.getBoundingClientRect?.();
    return rect?.width > 0 && rect?.height > 0;
  }

  function cleanText(value) {
    return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  const streamingSubtitles = Object.freeze({
    collectTextTrackCues,
    deepQueryAll,
    detectSite,
    ensureTracksLoaded,
    planSubtitleLine,
    preferSingleLineCaption,
    readNativeCaption,
    forgetAnchor,
    removeNativeTranslation,
    upsertNativeTranslation
  });
  global.ImmerseFreeStreamingSubtitles = streamingSubtitles;
})(globalThis);
