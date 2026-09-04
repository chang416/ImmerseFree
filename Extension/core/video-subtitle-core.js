(function initializeVideoSubtitleCore(global) {
  async function toggleAiSubtitles({
    settings = {},
    subtitleTranslator,
    dualSubtitle
  } = {}) {
    const aiActive = Boolean(subtitleTranslator?.enabled);
    if (aiActive) {
      subtitleTranslator?.stop?.();
      return { active: false, mode: "off", message: "AI 字幕已關閉" };
    }

    requireAi(settings, subtitleTranslator);
    dualSubtitle?.stop?.();
    await subtitleTranslator.start(settings);
    return { active: true, mode: "ai", message: "AI 字幕已開啟" };
  }

  async function toggleDualSubtitles({
    isStreamingSite = false,
    settings = {},
    subtitleTranslator,
    dualSubtitle
  } = {}) {
    if (dualSubtitle?.getState?.().active) {
      dualSubtitle.stop?.();
      return { active: false, mode: "off", message: "雙軌字幕已關閉" };
    }
    if (!isStreamingSite) throw new Error("雙軌字幕只支援 Netflix 和 Disney+");
    if (!dualSubtitle?.start) throw new Error("這個分頁尚未載入雙軌字幕功能");
    subtitleTranslator?.stop?.();
    await dualSubtitle.start(settings);
    return { active: true, mode: "dual", message: "雙軌字幕已開啟" };
  }

  function requireAi(settings, subtitleTranslator) {
    if (!settings.subtitleTranslationEnabled) throw new Error("請先在設定中允許 AI 字幕");
    if (!subtitleTranslator?.start) throw new Error("這個分頁尚未載入影片字幕功能");
  }

  const core = Object.freeze({
    toggleAiSubtitles,
    toggleDualSubtitles,
    // 舊訊息與快捷鍵在使用者重新整理分頁前仍可能送到舊入口。
    toggleVideoSubtitles: toggleAiSubtitles
  });
  global.ImmerseFreeVideoSubtitleCore = core;
})(globalThis);
