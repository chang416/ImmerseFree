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
- Netflix / Disney+ live playback: unverified because the available test sessions had no playable access. Windows UI and Safari live playback remain unverified.
- Netflix、Disney+ 真實播放：測試環境無可播放內容，未驗證。Windows 介面與 Safari 真實播放亦未驗證。

Updated 2026-09-08. CI build results are tracked on the repository's Actions page.

The [GitHub Actions run for 5bc2367](https://github.com/chang416/ImmerseFree/actions/runs/34177287510) passed all four jobs: macOS tests, Windows tests, unsigned Safari build, and PowerShell/Windows installer validation.
該次 GitHub 自動檢查四項全數通過，涵蓋 macOS 與 Windows 測試、Safari 建置及 Windows 安裝程式檢查。

A recording rehearsal exposed a built-in glossary error: “language acquisition” was forced into a financial translation. The fix preserves preset origin through prompts and keeps custom terms fixed. The updated local suite passes 36 tests. Live Chrome verification of this follow-up fix is pending extension reload; earlier CI and playback evidence above applies to the earlier code revision.
錄影彩排發現預設詞庫把「language acquisition」強制套為金融用語。修正後保留預設詞來源並改為語境建議，自訂詞仍固定。更新後本機 36 項測試通過。此次追加修正尚待擴充功能重載後實測；上方網站與自動建置證據對應較早版本。

Follow-up verification: after manual extension reload, Luna used the real Chrome popup and observed the first paragraph translated as「語言習得」rather than「語言併購」. The page counter reached 59 / 59. This verifies that visible wording only; it is not a complete translation-accuracy audit. [CI for c8334f6](https://github.com/chang416/ImmerseFree/actions/runs/34179609199) also passed.
追加驗證：使用者重載後，Luna 透過真實 Chrome 面板翻譯，第一段顯示「語言習得」，不再是「語言併購」；完成計數達 59 / 59。此證據只涵蓋可見詞義，不代表全文翻譯品質已全面驗證。上述追加修正的雲端檢查亦通過。
