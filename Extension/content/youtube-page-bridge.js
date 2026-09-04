(function installYouTubeCaptionBridge(global) {
  if (global.__IMMERSEFREE_YOUTUBE_CAPTION_BRIDGE__) return;
  global.__IMMERSEFREE_YOUTUBE_CAPTION_BRIDGE__ = true;

  global.addEventListener("message", (event) => {
    if (event.source !== global || event.data?.type !== "IMMERSEFREE_REQUEST_YOUTUBE_CAPTION_TRACKS") return;
    const response = currentPlayerResponse();
    const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    global.postMessage({
      type: "IMMERSEFREE_YOUTUBE_CAPTION_TRACKS",
      requestId: event.data.requestId,
      tracks: tracks.map((track) => ({
        baseUrl: track.baseUrl,
        languageCode: track.languageCode,
        kind: track.kind,
        name: track.name
      }))
    }, global.location.origin);
  });

  function currentPlayerResponse() {
    if (global.ytInitialPlayerResponse?.captions) return global.ytInitialPlayerResponse;
    const serialized = global.ytplayer?.config?.args?.player_response;
    if (typeof serialized === "string") {
      try { return JSON.parse(serialized); }
      catch { return undefined; }
    }
    return undefined;
  }
})(window);
