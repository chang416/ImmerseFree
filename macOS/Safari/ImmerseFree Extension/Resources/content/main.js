(async function initializeContent(global) {
  const bridge = global.ImmerseFree;
  const t = (text) => bridge.t?.(text) ?? text;
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
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message?.type === "IMMERSEFREE_TRANSLATE_SELECTION") {
      const text = message.text || global.getSelection()?.toString();
      bridge.interactionTranslator.translateText(text, { x: innerWidth / 2, y: innerHeight / 3 })
        .then(() => sendResponse({ ok: true, message: t("已翻譯選取文字") }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
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

})(globalThis);
