// 在 document_start 就把攔截器塞進頁面情境。
// 播放清單常常在頁面剛載入時就被抓走了，等到 document_idle 才注入會錯過，
// 只能靠 performance timeline 補撈——那份不是每個站台都留著。
(function loadSnifferEarly(global) {
  if (global.__IMMERSEFREE_SNIFFER_LOADER__) return;
  global.__IMMERSEFREE_SNIFFER_LOADER__ = true;
  const api = global.browser ?? global.chrome;
  const script = document.createElement("script");
  script.src = api.runtime.getURL("content/track-sniffer.js");
  script.setAttribute("data-immersefree-extension-root", "track-sniffer");
  script.addEventListener("load", () => script.remove());
  (document.head ?? document.documentElement).append(script);
})(globalThis);
