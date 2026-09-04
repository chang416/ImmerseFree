(function installTrackSniffer(global) {
  // 這支跑在「頁面情境」，不是擴充功能情境。兩件事只有在這裡做得到：
  //
  // 1. 攔得到播放器自己發出的請求，才知道播放清單在哪。清單網址是播放時才
  //    由 API 動態拿到的，從外面猜不出來。
  // 2. 用頁面自己的身分去抓字幕檔。那些網址帶簽章與 cookie 綁定，
  //    從擴充功能情境抓會被擋掉或拿到 403。
  if (global.__IMMERSEFREE_TRACK_SNIFFER__) return;
  global.__IMMERSEFREE_TRACK_SNIFFER__ = true;

  const MAX_RECORDS = 400;
  const MAX_BODY_BYTES = 1.5 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
  const MAX_METADATA_BYTES = 3 * 1024 * 1024;
  const MAX_TOTAL_METADATA_BYTES = 8 * 1024 * 1024;
  let manifests = [];
  let subtitles = [];
  // 沉浸式翻譯那套的核心：把播放器「自己下載的字幕檔內容」留下來。
  // 這份資料保證屬於現在這一集、時間軸就是播放器在用的那份——
  // 拿它當基準，就不必再猜哪份播放清單是對的。
  let capturedBodies = [];
  let capturedTotal = 0;
  // Netflix 的多語字幕 URL 位在播放 metadata，不一定會出現在 manifest。
  // 只留下含 timedtexttracks/ttDownloadables 的小型 JSON，避免把一般 API
  // 回應或媒體資料帶進頁面橋接。
  let metadataBodies = [];
  let metadataTotal = 0;

  // 串流平台是單頁應用，換一集不會重新載入頁面，攔到的清單就會一路累積。
  // 拿到上一集的播放清單去抓字幕，時間軸當然對不上——而且看起來就像
  // 「字幕整體平移」。網址一變就把紀錄清空。
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    manifests = [];
    subtitles = [];
    capturedBodies = [];
    capturedTotal = 0;
    metadataBodies = [];
    metadataTotal = 0;
  }, 1000);

  const isManifest = (url) => /\.(m3u8|mpd)(\?|$)/i.test(url);
  const isSubtitle = (url) => /\.(vtt|ttml|dfxp|srt)(\?|$)/i.test(url);
  // YouTube 的字幕走 /api/timedtext，沒有副檔名、內容是 JSON。
  // 播放器自己的請求帶有效的 pot 權杖，回應才有內容——我們自己抓常拿到空的，
  // 所以這份攔到的內容特別珍貴。
  const isTimedText = (url) => /\/api\/timedtext/.test(url);
  const isNetflixPage = /(^|\.)netflix\.com$/i.test(String(global.location?.hostname ?? location.hostname ?? ""));
  const metadataUrlSignal = /(?:manifest|metadata|playapi|cadmium|licensedmanifest|timed[-_]?text|movies)/i;

  function remember(bucket, absolute) {
    if (bucket.includes(absolute)) return;
    bucket.push(absolute);
    if (bucket.length > MAX_RECORDS) bucket.shift();
  }

  function record(url) {
    if (typeof url !== "string" || !url) return;
    let absolute = url;
    try {
      absolute = new URL(url, global.location.href).href;
    } catch {
      return;
    }
    // performance resource timing only keeps the URL, not the body. YouTube's
    // /api/timedtext has no subtitle extension, so it must be kept explicitly;
    // that exact URL carries the player's short-lived pot token and can be
    // replayed from page world when the fetch/XHR body hook was installed late.
    const bucket = isManifest(absolute)
      ? manifests
      : (isSubtitle(absolute) || isTimedText(absolute))
        ? subtitles
        : null;
    if (!bucket) return;
    if (bucket) remember(bucket, absolute);
  }

  // 內容看起來像不像字幕檔。Netflix 的字幕網址沒有副檔名，只能靠內容判斷。
  function looksLikeSubtitleBody(text) {
    const head = String(text ?? "").slice(0, 300).trimStart();
    return /^﻿?WEBVTT/.test(head) || (/^<\?xml|^<tt[\s>:]/i.test(head) && /ttml|<tt/i.test(head));
  }

  function looksLikeNetflixMetadata(text) {
    if (typeof text !== "string" || !text || text.length > MAX_METADATA_BYTES) return false;
    return /["']timedtexttracks["']\s*:/i.test(text)
      && /["'](?:ttDownloadables|downloadables)["']\s*:/i.test(text);
  }

  function isPotentialMetadataResponse(url, contentType = "") {
    // 這個檔案在所有網頁的 document_start 都會載入；不能因為別站回傳
    // application/json 就 clone 全部 response。Netflix 的 metadata API 有
    // 穩定的 URL 訊號，只有在 Netflix 頁面且命中訊號時才複製 response body。
    if (!isNetflixPage) return false;
    // 同一類 URL 也可能回傳 extensionless TTML，content-type 不一定是
    // application/json；URL 訊號已足夠把範圍限制在字幕/metadata 請求。
    return metadataUrlSignal.test(String(url ?? ""));
  }

  function storeMetadata(url, text) {
    try {
      if (!isNetflixPage) return;
      if (!looksLikeNetflixMetadata(text)) return;
      let absolute;
      try {
        absolute = new URL(url, global.location.href).href;
      } catch {
        return;
      }
      if (metadataBodies.some((entry) => entry.url === absolute)) return;
      metadataBodies.push({ url: absolute, text, at: Date.now() });
      metadataTotal += text.length;
      while (metadataTotal > MAX_TOTAL_METADATA_BYTES && metadataBodies.length > 1) {
        metadataTotal -= metadataBodies.shift().text.length;
      }
    } catch {
      // JSON metadata 攔截失敗絕對不能影響播放器。
    }
  }

  function storeBody(url, text) {
    try {
      if (typeof text !== "string" || !text || text.length > MAX_BODY_BYTES) return;
      let absolute;
      try {
        absolute = new URL(url, global.location.href).href;
      } catch {
        return;
      }
      const bodyLooksLikeSubtitle = looksLikeSubtitleBody(text);
      if (!isSubtitle(absolute) && !isTimedText(absolute) && !bodyLooksLikeSubtitle) return;
      // Netflix 字幕 URL 常沒有副檔名；body 通過格式辨識後，把相同網址
      // 加進 subtitles，讓上層至少知道有一條可用的 direct subtitle。
      if (bodyLooksLikeSubtitle && !isSubtitle(absolute) && !isTimedText(absolute)) {
        remember(subtitles, absolute);
      }
      if (capturedBodies.some((entry) => entry.url === absolute)) return;
      capturedBodies.push({ url: absolute, text, at: Date.now() });
      capturedTotal += text.length;
      while (capturedTotal > MAX_TOTAL_BYTES && capturedBodies.length > 1) {
        capturedTotal -= capturedBodies.shift().text.length;
      }
    } catch {
      // 收集失敗絕對不能影響播放器。
    }
  }

  const originalFetch = global.fetch;
  if (typeof originalFetch === "function") {
    global.fetch = function patchedFetch(input, init) {
      let requestUrl = "";
      try {
        requestUrl = typeof input === "string" ? input : input?.url ?? "";
        record(requestUrl);
      } catch {
        // 攔截失敗絕對不能影響播放器本身。
      }
      const promise = originalFetch.apply(this, arguments);
      try {
        promise.then((response) => {
          try {
            const absolute = new URL(requestUrl || response.url, global.location.href).href;
            const contentType = response.headers?.get?.("content-type") ?? "";
            // 只複製可能是字幕的回應。媒體分段动辄幾 MB，全部 clone 會拖垮播放。
            if (isSubtitle(absolute) || isTimedText(absolute)
              || /vtt|ttml|dfxp/i.test(contentType)
              || isPotentialMetadataResponse(absolute, contentType)) {
              response.clone().text().then((text) => {
                storeBody(absolute, text);
                storeMetadata(absolute, text);
              }).catch(() => {});
            }
          } catch {}
        }).catch(() => {});
      } catch {}
      return promise;
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
    try {
      this.__ccfUrl = String(url);
      record(String(url));
    } catch {
      // 同上。
    }
    return originalOpen.apply(this, arguments);
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function patchedSend() {
    try {
      this.addEventListener("load", () => {
        try {
          const url = this.__ccfUrl || this.responseURL || "";
          const type = this.responseType;
          if (type === "" || type === "text") {
            storeBody(url, this.responseText);
            storeMetadata(url, this.responseText);
            return;
          }
          if (type === "json") {
            // responseType=json 沒有 responseText；只在 Netflix 的 metadata
            // URL 上序列化一次，補上播放器以 XHR JSON 取清單的版本。
            if (isNetflixPage && metadataUrlSignal.test(String(url ?? ""))) {
              storeMetadata(url, JSON.stringify(this.response ?? null));
            }
            return;
          }
          // Netflix 的字幕走 arraybuffer 的 XHR。先只解前 64 bytes 看開頭，
          // 是字幕才整包解碼——影片分段是二進位，開頭一驗就被剔除。
          if (type === "arraybuffer" && this.response && this.response.byteLength < MAX_BODY_BYTES) {
            const head = new TextDecoder().decode(
              new Uint8Array(this.response, 0, Math.min(64, this.response.byteLength))
            ).trimStart();
            if (/^﻿?WEBVTT/.test(head) || /^<\?xml|^<tt[\s>:]/i.test(head)) {
              const text = new TextDecoder().decode(this.response);
              storeBody(url, text);
              storeMetadata(url, text);
            }
          }
        } catch {}
      });
    } catch {}
    return originalSend.apply(this, arguments);
  };

  // 腳本注入的時間點可能已經錯過前幾個請求，補撈一次瀏覽器的資源紀錄。
  try {
    for (const entry of performance.getEntriesByType("resource")) record(entry.name);
  } catch {
    // 有些頁面關掉了 performance timeline，沒有就算了。
  }

  global.addEventListener("message", async (event) => {
    if (event.source !== global) return;
    const data = event.data;
    if (data?.type === "IMMERSEFREE_REQUEST_STREAM_TRACKS") {
      global.postMessage({
        type: "IMMERSEFREE_STREAM_TRACKS",
        requestId: data.requestId,
        manifests: manifests.slice(-40),
        subtitles: subtitles.slice(-40),
        metadata: metadataBodies.slice(-40)
      }, global.location.origin);
      return;
    }
    if (data?.type === "IMMERSEFREE_REQUEST_CAPTURED_SUBS") {
      global.postMessage({
        type: "IMMERSEFREE_CAPTURED_SUBS",
        requestId: data.requestId,
        captured: capturedBodies.slice(-160)
      }, global.location.origin);
      return;
    }
    if (data?.type === "IMMERSEFREE_PAGE_FETCH") {
      let payload;
      try {
        const response = await originalFetch.call(global, data.url, { credentials: "include" });
        payload = response.ok
          ? { ok: true, text: await response.text(), url: response.url }
          : { ok: false, error: `HTTP ${response.status}` };
      } catch (error) {
        payload = { ok: false, error: String(error?.message ?? error) };
      }
      global.postMessage({ type: "IMMERSEFREE_PAGE_FETCH_RESULT", requestId: data.requestId, ...payload }, global.location.origin);
    }
  });

  global.postMessage({ type: "IMMERSEFREE_SNIFFER_READY" }, global.location.origin);
})(window);
