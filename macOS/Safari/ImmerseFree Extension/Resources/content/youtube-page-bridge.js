(function installYouTubeCaptionBridge(global) {
  if (global.__IMMERSEFREE_YOUTUBE_CAPTION_BRIDGE__) return;
  global.__IMMERSEFREE_YOUTUBE_CAPTION_BRIDGE__ = true;

  global.addEventListener("message", (event) => {
    if (event.source !== global || event.data?.type !== "IMMERSEFREE_REQUEST_YOUTUBE_CAPTION_TRACKS") return;
    const response = currentPlayerResponse(event.data.videoId);
    const renderer = response?.captions?.playerCaptionsTracklistRenderer;
    const tracks = renderer?.captionTracks ?? [];
    const audio = renderer?.audioTracks?.[Number(renderer.defaultAudioTrackIndex) || 0];
    const defaultIndex = Number(audio?.defaultCaptionTrackIndex);
    global.postMessage({
      type: "IMMERSEFREE_YOUTUBE_CAPTION_TRACKS",
      requestId: event.data.requestId,
      tracks: tracks.map((track, index) => ({
        isDefault: Number.isInteger(defaultIndex) && index === defaultIndex,
        baseUrl: track.baseUrl,
        languageCode: track.languageCode,
        kind: track.kind,
        name: track.name
      }))
    }, global.location.origin);
  });

  function currentPlayerResponse(videoId) {
    const candidates = [];
    try { candidates.push(global.document.querySelector("#movie_player")?.getPlayerResponse?.()); } catch {}
    candidates.push(global.ytInitialPlayerResponse);
    const serialized = global.ytplayer?.config?.args?.player_response;
    try { candidates.push(typeof serialized === "string" ? JSON.parse(serialized) : serialized); } catch {}
    return candidates.find((value) => value?.captions && (!videoId || value.videoDetails?.videoId === videoId));
  }
})(window);
