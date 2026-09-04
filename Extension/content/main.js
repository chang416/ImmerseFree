(async function initializeContent(global) {
  const bridge = global.ImmerseFree;
  const t = (text) => bridge.t?.(text) ?? text;
  const videoSubtitles = global.ImmerseFreeVideoSubtitleCore;
  if (bridge.contentInitialized) return;
  bridge.contentInitialized = true;
  let settings = {};

  // Substack 這類站台把正文放在同源 iframe 裡，滑鼠事件不會冒泡到上層——
  // 只跑最上層框架的話，反白與懸停在閱讀窗裡完全聽不到。所以內容腳本
  // 現在每個框架都跑（manifest 的 all_frames），但子框架只開互動翻譯：
  // 訊息處理只留在最上層，否則「翻譯這個網頁」會在每個框架各跑一次。
  const isTopFrame = (() => {
    try {
      return global === global.top;
    } catch {
      // 跨來源時讀 top 會丟例外，那就當子框架處理。
      return false;
    }
  })();

  if (!isTopFrame) {
    try {
      settings = (await bridge.sendMessage({ type: "IMMERSEFREE_GET_SETTINGS" })).settings;
      bridge.setUiLanguage?.(settings.uiLanguage);
      bridge.interactionTranslator.start(settings);
    } catch {
      // 背景頁醒不來就算了，最上層那份還在。
    }
    bridge.api.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.type === "IMMERSEFREE_SETTINGS_CHANGED") {
        settings = { ...settings, ...message.settings };
        bridge.interactionTranslator.updateSettings(settings);
        sendResponse({ ok: true });
      }
      // 其他訊息一律不回應，留給最上層。
      return false;
    });
    return;
  }

  // 設定按需取得。閉包裡那份在頁面剛載入時是空的，取設定又是非同步，
  // 任何處理器直接讀它都有競態——0.5.5 就因此讓「開啟 AI 字幕」在所有網站
  // 被「請先在設定中允許」擋掉。要用設定的處理器一律走這裡。
  async function currentSettings() {
    if (settings && Object.keys(settings).length) return settings;
    settings = (await bridge.sendMessage({ type: "IMMERSEFREE_GET_SETTINGS" })).settings;
    bridge.setUiLanguage?.(settings.uiLanguage);
    return settings;
  }

  // 監聽器一定要在任何 await 之前註冊。
  //
  // 底下取設定會等待背景頁回應，那段期間 popup 送過來的訊息沒有人接，
  // 它就會以為這個分頁沒有內容腳本，於是把字幕狀態顯示成「未開啟」——
  // 明明功能正在跑。狀態顯示錯比慢一點嚴重得多。
  bridge.api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "IMMERSEFREE_PING") {
      // 版本一起回報，popup 才分得出這個分頁跑的是不是最新的內容腳本。
      sendResponse({ ok: true, version: bridge.api.runtime.getManifest?.().version ?? "" });
      return false;
    }
    if (message?.type === "IMMERSEFREE_GET_PAGE_PROGRESS") {
      sendResponse({ ok: true, progress: bridge.pageTranslator.getProgress() });
      return false;
    }
    if (message?.type === "IMMERSEFREE_TRANSLATE_PAGE") {
      currentSettings()
        .then((current) => {
          if (!current.pageTranslationEnabled) throw new Error(t("請先在設定中允許網頁雙語翻譯"));
          return bridge.pageTranslator.toggle(current);
        })
        .then((result) => sendResponse({
          ok: true,
          message: result.message ?? t(result.active ? `已翻譯 ${result.count} 段` : "已移除網頁翻譯"),
          result
        }))
        .catch((error) => sendResponse({ ok: false, error: error.message, code: error.code ?? "" }));
      return true;
    }
    // 匯出雙語 docx（W4-1）。只回「原文／譯文」配對加上標題，
    // 檔案本身在 popup 那邊組（zip 庫在那裡，內容腳本不需要多背一個 vendor）。
    if (message?.type === "IMMERSEFREE_COLLECT_PAGE_PAIRS") {
      if (!bridge.pageTranslator?.collectPairs) {
        sendResponse({ ok: false, error: t("這個分頁還在跑舊版內容腳本，請按 F5 重新整理後再試。") });
        return false;
      }
      sendResponse({
        ok: true,
        pairs: bridge.pageTranslator.collectPairs(),
        title: document.title
      });
      return false;
    }
    if (message?.type === "IMMERSEFREE_TOGGLE_AI_SUBTITLES" || message?.type === "IMMERSEFREE_TOGGLE_VIDEO_SUBTITLES") {
      currentSettings()
        .then((current) => videoSubtitles.toggleAiSubtitles({
          settings: current,
          subtitleTranslator: bridge.subtitleTranslator,
          dualSubtitle: bridge.dualSubtitle
        }))
        .then((result) => sendResponse({
          ok: true,
          active: result.active,
          mode: result.mode,
          message: result.message,
          result
        }))
        .catch((error) => sendResponse({ ok: false, error: error.message, code: error.code ?? "" }));
      return true;
    }
    if (message?.type === "IMMERSEFREE_TOGGLE_DUAL_SUBTITLES") {
      currentSettings()
        .then((current) => videoSubtitles.toggleDualSubtitles({
          isStreamingSite: /(^|\.)(disneyplus\.com|netflix\.com)$/.test(location.hostname),
          settings: current,
          subtitleTranslator: bridge.subtitleTranslator,
          dualSubtitle: bridge.dualSubtitle
        }))
        .then((result) => sendResponse({ ok: true, ...result, result }))
        .catch((error) => sendResponse({ ok: false, error: error.message, code: error.code ?? "" }));
      return true;
    }
    if (message?.type === "IMMERSEFREE_COLLECT_STUDY") {
      if (!bridge.dualSubtitle) {
        sendResponse({ ok: false, error: "這個分頁還在跑舊版內容腳本，請按 F5 重新整理後再試。" });
        return false;
      }
      currentSettings()
        .then((current) => bridge.dualSubtitle.collectStudyPairs(current))
        .then((result) => sendResponse({ ok: true, ...result, title: document.title, url: location.href }))
        .catch((error) => sendResponse({ ok: false, error: error.message, code: error.code ?? "" }));
      return true;
    }
    if (message?.type === "IMMERSEFREE_GET_SUBTITLE_STATES") {
      sendResponse({
        ok: true,
        ai: Boolean(bridge.subtitleTranslator?.enabled),
        dual: Boolean(bridge.dualSubtitle?.getState().active)
      });
      return false;
    }
    if (message?.type === "IMMERSEFREE_GET_DUAL_SUBTITLE_STATE") {
      sendResponse({ ok: true, state: bridge.dualSubtitle?.getState() ?? { active: false } });
      return false;
    }
    if (message?.type === "IMMERSEFREE_TRANSLATE_SELECTION") {
      const text = message.text || global.getSelection()?.toString();
      bridge.interactionTranslator.translateText(text, { x: innerWidth / 2, y: innerHeight / 3 })
        .then(() => sendResponse({ ok: true, message: t("已翻譯選取文字") }))
        .catch((error) => sendResponse({ ok: false, error: error.message, code: error.code ?? "" }));
      return true;
    }
    if (message?.type === "IMMERSEFREE_SETTINGS_CHANGED") {
      settings = { ...settings, ...message.settings };
      bridge.interactionTranslator.updateSettings(settings);
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  try {
    settings = (await bridge.sendMessage({ type: "IMMERSEFREE_GET_SETTINGS" })).settings;
    bridge.setUiLanguage?.(settings.uiLanguage);
    bridge.interactionTranslator.start(settings);
  } catch {
    // The popup and options page surface actionable provider errors.
  }

  // 影片字幕刻意「不」自動啟動。
  //
  // 以前只要開啟影片頁就會自動跑 AI 翻譯，等於每支影片都在背景默默消耗額度，
  // 而使用者根本沒按過任何東西——畫面上突然多一行中文，看起來還很像
  // 播放器本來就有雙語字幕。要用就按雙軌字幕（免費）或 AI 影片字幕（花額度），
  // 兩者都有按鍵和快速鍵。
})(globalThis);
