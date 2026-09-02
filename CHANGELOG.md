# Changelog｜版本紀錄

## 0.7.0 — 2026-09-02

Initial open-source MVP release. It includes bilingual page, selection, hover, input-field, and PDF translation; local Antigravity and OpenCode CLI support; Gemini and custom OpenAI-compatible APIs; Windows and macOS installers; a Safari Web Extension project; automated integrity tests; and beginner-friendly English／Traditional Chinese installation guides.

首次開源 MVP 發行。內容包含網頁、反白、懸停、輸入欄位與 PDF 雙語翻譯；本機 Antigravity 與 OpenCode CLI 支援；Gemini 與自訂 OpenAI 相容 API；Windows／macOS 安裝程式；Safari Web Extension 專案；自動完整性測試，以及適合初學者的英文／繁體中文安裝教學。

The Antigravity vision OCR fallback now runs without the CLI flag that auto-approves every tool call. The OpenCode default endpoint has also been updated to the current Zen API path. API keys remain stored in browser local storage and exported settings in plaintext; use dedicated low-quota keys and protect exported files.

Antigravity 視覺 OCR 備援已移除會自動核准所有工具呼叫的 CLI 參數；OpenCode 預設端點也已更新為目前的 Zen API 路徑。API key 仍會儲存在瀏覽器本機空間，設定匯出檔也會以明文保存；請使用專用低額度 key，並妥善保護匯出檔。

Chrome and Edge store publishing still requires reconciling each store-assigned extension ID with the Bridge origin allowlist and testing the actual store-installed build. Safari public distribution requires Apple distribution signing and notarization or Mac App Store review.

上架 Chrome 與 Edge 商店前，仍須把商店指派的擴充功能 ID 加入 Bridge origin allowlist，並實際測試商店安裝版本。Safari 公開散布則需要 Apple distribution signing，並完成 notarization 或 Mac App Store 審核。
