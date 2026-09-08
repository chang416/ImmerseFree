# 0.8.1 verification scope｜驗證範圍

This document distinguishes automated checks from observations on real sites. It is not a guarantee for every video, region or model.
此頁區分自動檢查與真實網站觀察，不代表每部影片、地區或模型都已測過。

- Local project verification: 35 tests passed, covering shared resources, packaging references, subtitle parsing, timing overlap, retry isolation, provider deadlines and PDF text preservation.
- 本機專案驗證通過 35 項，包含共用資源、安裝引用、字幕解析、重疊時間、重試隔離、請求逾時與 PDF 文字保留。
- Real Chrome + YouTube + Gemini: a 77-cue video completed translation, displayed bilingual subtitles, and generated study material with 5 vocabulary entries and 4 patterns.
- 真實 Chrome 搭配 YouTube 與 Gemini：一部 77 句影片完成翻譯、顯示雙語字幕，並產生 5 個單字與 4 個句型。
- Popup fixture measurements: 480 px wide; the tested full state was below 600 px high, with no horizontal overflow. These are isolated layout measurements, not measurements of every native popup environment.
- 面板獨立量測寬 480 像素，已測完整狀態低於 600 像素，無水平溢出；不代表所有原生視窗環境都已量測。
- Antigravity: the local bridge translated a sample successfully. The native automation accessibility values disagreed with the visible popup after model selection, so the Chrome Antigravity path is unverified; this does not establish an application provider rollback. A later YouTube run showed a terminal translation failure without an attributable provider error.
- Antigravity：本機橋接服務已成功翻譯樣本。原生測試工具的讀值與可見選單不一致，因此 Chrome 的 Antigravity 路徑未驗證，不能據此判定程式切回引擎。後續一輪 YouTube 顯示翻譯失敗，但未取得可歸因引擎的錯誤。
- Unsigned Safari Release build: succeeded locally. This verifies compilation, not Safari playback.
- Safari 未簽署正式建置：本機成功。這證明可編譯，不代表已驗證 Safari 播放。
- Netflix / Disney+ live playback, Windows UI and Safari live playback: pending validation.
- Netflix、Disney+ 真實播放、Windows 介面與 Safari 真實播放：尚待驗證。

Updated 2026-09-08. CI build results are tracked on the repository's Actions page.
