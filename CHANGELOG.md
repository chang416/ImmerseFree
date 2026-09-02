# Changelog｜版本紀錄

## 0.7.3 — 2026-09-02

Fixed a Windows installer version check that could reject releases newer than 0.7.0, and synchronized the Safari app version with the browser manifests. The Windows installer now derives its version from the packaged manifest, safely opens paths containing spaces, and copies the permanent extension path for the browser folder picker. CI validates the real Windows package contract. The README now clearly introduces the complete English interface and worldwide language support.

修正 Windows 安裝程式可能拒絕 0.7.0 之後版本的版本檢查，並同步 Safari App 與瀏覽器 manifest 的版本。Windows 安裝程式現在會直接讀取發行包內的 manifest 版本、正確開啟含空格的路徑，並複製永久擴充功能路徑供瀏覽器選取。CI 也會實際驗證 Windows 安裝包契約。README 另外明確介紹完整英文介面與全球語言支援。

## 0.7.2 — 2026-09-02

Clarified the macOS Chrome／Edge installation flow. The installer now copies the permanent extension path to the clipboard and explains exactly where to paste it with Command + Shift + G. The bilingual guide also explains why the downloaded `Extension` folder and installed `Chrome Extension` folder have different names.

改善 macOS 的 Chrome／Edge 安裝流程。安裝程式現在會自動複製永久擴充功能路徑，並明確說明如何用 Command + Shift + G 貼上。雙語教學也補充說明下載包裡的 `Extension` 與安裝後的 `Chrome Extension` 為何名稱不同。

## 0.7.1 — 2026-09-02

Fixed the Traditional Chinese Markdown labels that GitHub could render as literal `**` characters. The macOS scripts now also complete successfully when a terminal prompt receives end-of-input, while keeping the normal “press Return” prompt for interactive users.

修正 GitHub 可能把繁中 Markdown 標籤顯示成 `**` 文字的問題。macOS 腳本在終端機提示收到輸入結束時也能正常結束；互動使用者仍會看到原本的「按 Return」提示。

## 0.7.0 — 2026-09-02

Initial open-source MVP release. It includes bilingual page, selection, hover, input-field, and PDF translation; local Antigravity and OpenCode CLI support; Gemini and custom OpenAI-compatible APIs; Windows and macOS installers; a Safari Web Extension project; automated integrity tests; and beginner-friendly English／Traditional Chinese installation guides.

首次開源 MVP 發行。內容包含網頁、反白、懸停、輸入欄位與 PDF 雙語翻譯；本機 Antigravity 與 OpenCode CLI 支援；Gemini 與自訂 OpenAI 相容 API；Windows／macOS 安裝程式；Safari Web Extension 專案；自動完整性測試，以及適合初學者的英文／繁體中文安裝教學。

The Antigravity vision OCR fallback now runs without the CLI flag that auto-approves every tool call. The OpenCode default endpoint has also been updated to the current Zen API path. API keys remain stored in browser local storage and exported settings in plaintext; use dedicated low-quota keys and protect exported files.

Antigravity 視覺 OCR 備援已移除會自動核准所有工具呼叫的 CLI 參數；OpenCode 預設端點也已更新為目前的 Zen API 路徑。API key 仍會儲存在瀏覽器本機空間，設定匯出檔也會以明文保存；請使用專用低額度 key，並妥善保護匯出檔。

Chrome and Edge store publishing still requires reconciling each store-assigned extension ID with the Bridge origin allowlist and testing the actual store-installed build. Safari public distribution requires Apple distribution signing and notarization or Mac App Store review.

上架 Chrome 與 Edge 商店前，仍須把商店指派的擴充功能 ID 加入 Bridge origin allowlist，並實際測試商店安裝版本。Safari 公開散布則需要 Apple distribution signing，並完成 notarization 或 Mac App Store 審核。
