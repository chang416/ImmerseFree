(function initializeFloatingBall(global) {
  // 側邊懸浮球（W3-1）。對手的側邊懸浮圖示是他們最常被點的翻譯入口；
  // 我方版本補上兩件他們沒做穩的事：位置持久化（貼邊＋視窗高度百分比，
  // 換視窗大小也不會跑出畫面）與「僅譯文／雙語」一鍵切換。
  //
  // z-index 與 pointer-events 策略（與 content.css 的註解對齊）：
  //   - z-index 2147483646，比字幕 overlay／進度卡／劃詞卡（2147483647）低一層：
  //     球是常駐入口，那些是使用者動作的當下產物，產物該蓋住入口。
  //   - 球就是那顆 38px 的小容器，沒有任何全螢幕 wrapper，頁面其餘面積的
  //     滑鼠事件完全不經過我們，不存在「透明大層吃掉整頁點擊」的風險。
  const bridge = global.ImmerseFree;
  if (!bridge) return;
  const t = (text) => bridge.t?.(text) ?? text;
  const ROOT_CLASS = "immersefree-fab";
  const BALL_SIZE = 38;
  const EDGE_GAP = 12;

  // 只在最上層框架掛球。iframe 也掛的話，一頁會冒出好幾顆。
  const isTopFrame = (() => {
    try { return global === global.top; } catch { return false; }
  })();
  if (!isTopFrame) return;

  let settings = { floatingBallEnabled: true, floatingBallPos: { side: "right", y: 50 }, displayMode: "bilingual" };
  let root = null;
  let ball = null;
  let modeButton = null;
  let dismissed = false;   // 球上的「關閉」只藏到下次載入頁面，不動全域設定。
  let observer = null;

  void init();

  async function init() {
    try {
      const response = await bridge.sendMessage({ type: "IMMERSEFREE_GET_SETTINGS" });
      if (response?.settings) settings = { ...settings, ...response.settings };
    } catch {
      // 背景頁還在睡就用預設值；等 storage.onChanged 把真值帶回來。
    }
    sync();
    // 設定在任何一邊被改（選項頁開關、popup 快切、另一顆球拖曳）都走 storage，
    // 這裡聽一次就好，不用零散的訊息廣播。
    try {
      bridge.api?.storage?.onChanged?.addListener?.((changes, area) => {
        if (area !== "local") return;
        let touched = false;
        for (const key of ["floatingBallEnabled", "floatingBallPos", "displayMode"]) {
          if (changes[key] && "newValue" in changes[key]) {
            settings[key] = changes[key].newValue;
            touched = true;
          }
        }
        if (touched) sync();
      });
    } catch {
      // 測試替身沒有 storage.onChanged，球照常運作，只是不會跨頁面即時同步。
    }
    // SPA 或激進的頁面腳本可能整棵重建 DOM 把球掃掉。掛在 documentElement 上
    // 已經比掛 body 難死（React 之類只重建 body 下的樹），再用 MutationObserver
    // 補一層：球被拔就重新掛回去。路由變更不會重跑內容腳本，這一層就是
    // 「SPA 換頁後球還在」的保證。
    if (typeof global.MutationObserver === "function" && document.documentElement) {
      observer = new global.MutationObserver(() => {
        if (!dismissed && settings.floatingBallEnabled && root && !root.isConnected) {
          document.documentElement.append(root);
        }
      });
      observer.observe(document.documentElement, { childList: true });
    }
  }

  // 依目前設定決定球該不該在畫面上，並套位置與按鈕狀態。
  function sync() {
    if (dismissed || !settings.floatingBallEnabled) {
      root?.remove();
      return;
    }
    if (!root) build();
    if (!root.isConnected) document.documentElement.append(root);
    applyPosition(settings.floatingBallPos);
    renderModeButton();
  }

  function build() {
    root = document.createElement("div");
    root.className = ROOT_CLASS;
    // 讓 page-translator 的候選收集跳過整棵子樹（它排除所有掛這個標記的節點），
    // 球上的中文永遠不會被自己翻譯。
    root.setAttribute("data-immersefree-extension-root", "");
    ball = document.createElement("button");
    ball.type = "button";
    ball.className = "immersefree-fab-ball";
    ball.setAttribute("aria-label", t("ImmerseFree 翻譯選單"));
    // 球面用產品自己的 logo（不自畫符號）。圖檔在 manifest 的
    // web_accessible_resources 裡，內容腳本才能用 runtime.getURL 讓頁面載入；
    // 沒列進去的話 img 會 404，而且只在真網頁上壞（擴充頁面看不出來）。
    const logo = document.createElement("img");
    logo.src = bridge.api.runtime.getURL("icons/icon-32.png");
    logo.alt = "";
    // 尺寸屬性跟球一樣大（38px）：CSS 會用 100% 覆蓋，但樣式表還沒套上的那
    // 一瞬間（或被站台的 CSP 擋掉時）圖也該是滿版，不是中間一小塊。
    logo.width = 38;
    logo.height = 38;
    logo.draggable = false;
    ball.append(logo);
    root.append(ball);

    const menu = document.createElement("div");
    menu.className = "immersefree-fab-menu";
    menu.append(
      action(t("翻譯"), onTranslate),
      action(t("還原"), onRestore),
      (modeButton = action(t("僅譯文"), onToggleMode)),
      action(t("收起"), onDismiss)
    );
    root.append(menu);
    installDrag();
  }

  function action(label, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "immersefree-fab-action";
    button.textContent = label;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void handler();
    });
    return button;
  }

  // 「僅譯文」按鈕同時是狀態燈：模式開著時反白，一眼看得出現在是哪個模式。
  function renderModeButton() {
    if (!modeButton) return;
    modeButton.setAttribute("aria-pressed", String(settings.displayMode === "translationOnly"));
  }

  function applyPosition(pos) {
    const side = pos?.side === "left" ? "left" : "right";
    const y = Number.isFinite(Number(pos?.y)) ? Number(pos.y) : 50;
    // 位置一律從「已正規化的存檔值」算 style，拖曳結束當下與重新整理後
    // 走的是同一條公式、同一個輸入，座標才會分毫不差。
    root.style.left = side === "left" ? `${EDGE_GAP}px` : "auto";
    root.style.right = side === "right" ? `${EDGE_GAP}px` : "auto";
    root.style.top = `${y}%`;
  }

  // ── 拖曳 ─────────────────────────────────────────────
  // pointer capture 讓快速拖出球外也不掉；移動超過 4px 才算拖曳，
  // 沒超過就是點擊（開關選單交給 hover/focus，點球本身翻譯整頁）。
  function installDrag() {
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;
    let dragging = false;

    ball.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const rect = root.getBoundingClientRect();
      startX = event.clientX;
      startY = event.clientY;
      originLeft = rect.left;
      originTop = rect.top;
      dragging = false;
      ball.setPointerCapture(event.pointerId);
    });

    ball.addEventListener("pointermove", (event) => {
      if (!ball.hasPointerCapture?.(event.pointerId)) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) < 4) return;
      dragging = true;
      root.dataset.dragging = "1";
      // 拖曳中用 px 自由移動；放開才貼邊換回百分比。
      root.style.left = `${originLeft + dx}px`;
      root.style.right = "auto";
      root.style.top = `${clampTop(originTop + dy)}px`;
    });

    ball.addEventListener("pointerup", (event) => {
      if (!ball.hasPointerCapture?.(event.pointerId)) return;
      ball.releasePointerCapture(event.pointerId);
      const wasDragging = dragging;
      dragging = false;
      delete root.dataset.dragging;
      if (!wasDragging) {
        // 一般點擊＝翻譯／還原切換，跟 popup 的主按鈕同一件事。
        void onTranslateToggle();
        return;
      }
      void persistPosition();
    });

    ball.addEventListener("pointercancel", () => {
      dragging = false;
      delete root.dataset.dragging;
      applyPosition(settings.floatingBallPos);
    });
  }

  function clampTop(top) {
    const max = (global.innerHeight || 800) - BALL_SIZE;
    return Math.min(Math.max(0, top), Math.max(0, max));
  }

  async function persistPosition() {
    const rect = root.getBoundingClientRect();
    const height = global.innerHeight || 1;
    const raw = {
      side: rect.left + rect.width / 2 < (global.innerWidth || 0) / 2 ? "left" : "right",
      y: (rect.top / height) * 100
    };
    try {
      // 正規化（夾 2–98、四捨五入到小數 2 位）只住在 settings-core 一份，
      // 這裡拿背景頁回傳的「存進去的那個值」來套畫面——套的與存的是同一個值，
      // 重新整理後座標誤差才會是 0。
      const response = await bridge.sendMessage({
        type: "IMMERSEFREE_UPDATE_SETTINGS",
        settings: { floatingBallPos: raw }
      });
      if (response?.ok && response.settings?.floatingBallPos) {
        settings.floatingBallPos = response.settings.floatingBallPos;
      } else {
        settings.floatingBallPos = raw;
      }
    } catch {
      settings.floatingBallPos = raw;
    }
    applyPosition(settings.floatingBallPos);
  }

  // ── 選單動作 ──────────────────────────────────────────
  function pageTranslated() {
    return Boolean(document.querySelector(".immersefree-page-translation"));
  }

  async function currentSettings() {
    try {
      const response = await bridge.sendMessage({ type: "IMMERSEFREE_GET_SETTINGS" });
      if (response?.settings) settings = { ...settings, ...response.settings };
    } catch {}
    return settings;
  }

  async function onTranslateToggle() {
    const current = await currentSettings();
    try {
      await bridge.pageTranslator.toggle(current);
    } catch {
      // 失敗訊息由 page-translator 的進度卡呈現，這裡不再疊一份。
    }
  }

  async function onTranslate() {
    if (pageTranslated()) return;   // 已翻譯就不做事，避免把 toggle 當成還原。
    await onTranslateToggle();
  }

  async function onRestore() {
    if (!pageTranslated()) return;
    await onTranslateToggle();
  }

  async function onToggleMode() {
    const next = settings.displayMode === "translationOnly" ? "bilingual" : "translationOnly";
    try {
      const response = await bridge.sendMessage({
        type: "IMMERSEFREE_UPDATE_SETTINGS",
        settings: { displayMode: next }
      });
      if (response?.ok && response.settings) settings.displayMode = response.settings.displayMode;
      else settings.displayMode = next;
    } catch {
      settings.displayMode = next;
    }
    renderModeButton();
    // storage.onChanged 會叫 page-translator 掛屬性；訊息失敗（背景頁睡死）
    // 時至少把本文件的屬性直接掛上，畫面不等下一次同步。
    document.documentElement.dataset.imfMode = settings.displayMode === "translationOnly" ? "translationOnly" : "bilingual";
  }

  function onDismiss() {
    dismissed = true;
    root?.remove();
  }
})(globalThis);
