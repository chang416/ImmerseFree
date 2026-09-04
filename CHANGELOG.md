# Changelog｜版本紀錄

## 0.8.0 — 2026-09-04

The complete edition. Everything the 0.7.x releases listed as **Coming soon** now
ships, together with document translation, a glossary, a site-rule library, and
automatic engine failover.

完整版。0.7.x 標示為 **Coming soon** 的功能全部到齊，另外還加上文件翻譯、術語表、
網站規則庫與失敗自動轉移。

### Added｜新增

- **AI video subtitles on YouTube.** ImmerseFree turns captions on by itself and draws its own translated line underneath. Player cues are merged back into whole sentences before translation, so the model sees real sentences instead of display-timed fragments, and the translated line is wrapped to stay on one line instead of growing into a block over the picture.
- **YouTube AI 字幕。** ImmerseFree 會自己把字幕打開，再在下方畫出自己的譯文行。播放器的字幕片段會先合併回完整句子再送翻，模型看到的是真正的句子而不是為了顯示節奏切開的碎片；譯文行也會控制斷行，維持單行，不會脹成一塊蓋住畫面。
- **Dual subtitles on Netflix and Disney+.** Those services already ship several subtitle tracks; ImmerseFree shows a second one alongside the first. No model, no quota, no cost.
- **Netflix 與 Disney+ 雙軌字幕。** 這兩個平台本來就附了多條字幕軌，ImmerseFree 直接把第二條疊上去顯示。不用模型、不吃額度、不花錢。
- **Episode study.** Turns one episode's subtitles into vocabulary and sentence-pattern notes. Enter a TOEIC, IELTS, or GEPT score — or say you are a complete beginner — and it maps you onto the six CEFR levels and writes at that level.
- **影集學習。** 把一集的字幕整理成單字與句型教材。輸入多益、雅思或全民英檢分數，或直接說你是純新手，它會換算成 CEFR 六個等級並照那個程度出教材。
- **SRT export in three modes:** translation only, original only, or bilingual.
- **SRT 匯出三種模式：** 只要譯文、只要原文，或雙語。
- **EPUB bilingual reading and export.** A built-in reader inserts the translation after each original block and can save a `<name>.bilingual.epub`.
- **EPUB 雙語閱讀與匯出。** 內建閱讀器會在每個原文區塊後插入譯文，並可輸出 `<原名>.bilingual.epub`。
- **PDF bilingual export and a translation-only view**, on top of the existing PDF reader.
- **PDF 雙語匯出與「只看譯文」檢視**，加在原有的 PDF 閱讀器上。
- **Word (`.docx`) export.** Plain-text paragraphs with four named styles; bold, links, and heading hierarchy are not carried across.
- **Word（`.docx`）匯出。** 輸出的是純文字段落配四個自訂樣式；粗體、連結與標題層級不會保留。
- **12 bilingual display themes:** classic, underline, dashed, wavy, highlight, quote, faded, italic, bold, card, divider, and plain.
- **12 種雙語顯示主題：** 經典邊線、底線、虛線、波浪、螢光、引言、淡化、斜體、粗體、卡片、分隔線、無樣式。
- **Translation-only mode.** Hide the original and show only the translation; switch back at any time.
- **僅譯文模式。** 隱藏原文只看譯文，可隨時切回。
- **Floating ball.** A draggable, edge-snapping ball. Click it to translate the page; its menu offers translate, restore, translation-only／bilingual, and hide.
- **側邊懸浮球。** 可拖曳、自動貼邊。點一下翻譯整頁；選單有翻譯、還原、僅譯文／雙語切換、收起。
- **Glossary.** 536 built-in preset terms across three domains — technology and software (198), finance and investing (167), medicine and biotech (171) — plus your own terms and terms pinned to the video you are watching. Only terms that actually occur in a sentence are sent to the model, and the cache is keyed on exactly those, so changing one term retranslates only the sentences it affects.
- **術語表。** 內建 536 條預設術語，分三類：科技與軟體 198 條、財經與投資 167 條、醫療與生技 171 條；另可自訂，也可只釘給正在看的那支影片。只有真的出現在句子裡的術語會送給模型，快取也剛好以那些術語為鍵，所以改一個術語只會讓受影響的句子重翻。
- **Site rule library.** 25 built-in rules tune what gets translated on common sites, and your own JSON rules can add to, remove from, or replace the built-in set.
- **網站規則庫。** 內建 25 條規則，針對常見網站調整翻譯範圍；你自己的 JSON 規則可以疊加、移除或整組取代內建規則。
- **Automatic engine failover.** When an engine fails, the next one in your order takes over. Switching happens only between batches, so a sentence is never half-translated by two engines; a single translation tries at most two extra engines; and the toolbar always names the engine that took over.
- **失敗自動轉移。** 引擎掛掉時換成下一個。轉移只發生在批與批之間，同一句話不會被兩個引擎各翻一半；一次翻譯最多額外嘗試兩個引擎；換過引擎時工具列一定會說是誰接手。
- **Diagnostics panel.** Per-engine success rate, a recent event log with error codes, and nine counters (cache hits and misses, engine handoffs, batches and batch splits, rich-text and dictionary fallbacks, subtitle cues and merged groups).
- **診斷面板。** 每個引擎的成功率、帶錯誤碼的近期事件紀錄，以及九個計數器（快取命中與未命中、引擎轉移次數、批次數與拆批數、富文本與詞典退回次數、字幕片段數與合併後句數）。
- **Dictionary cards.** Selecting a single word now returns a dictionary entry — pronunciation, parts of speech, separate senses, and a usage note — rather than a bare translation.
- **劃詞詞典卡。** 反白單一單字時會回傳詞典條目：音標、詞性、分項釋義與用法說明，不再只給一句翻譯。
- **Two new shortcuts:** `Alt + Shift + A` toggles AI subtitles and `Alt + Shift + D` toggles dual subtitles.
- **兩個新快捷鍵：** `Alt + Shift + A` 開關 AI 字幕、`Alt + Shift + D` 開關雙軌字幕。
- **Inline formatting is preserved.** Links, bold, and inline code inside a paragraph survive translation instead of being flattened.
- **保留行內格式。** 段落裡的連結、粗體與行內程式碼不再被壓成純文字。
- **Wider segmentation.** Translation candidates are no longer limited to 14 semantic tags, so text-heavy layouts are picked up properly.
- **更廣的分段。** 翻譯候選不再只限於 14 個語意標籤，排版複雜的頁面也抓得到。
- **Redesigned popup and options pages.** One 4px spacing grid, three type sizes in the popup and four in options, three corner radii, and 1px separators with no box shadows. The video section no longer overflows the popup's height limit, and rows keep the same height in English and Traditional Chinese.
- **彈出視窗與選項頁視覺重做。** 統一 4px 間距網格，彈出視窗三級字級、選項頁四級，三種圓角，只用 1px 細邊不用陰影。影片區不再撐破彈出視窗的高度上限，中英文的列高也一致。

### Fixed｜修正

- **Safari: subtitles stayed on “Preparing” forever.** The `ImmerseFree Extension` target never requested outgoing network access, so the sandbox silently dropped every request the extension made to the Bridge or to a translation API. `ENABLE_OUTGOING_NETWORK_CONNECTIONS` is now set on the extension target as well as the container app — four occurrences in the Xcode project instead of two. Rebuild Safari with `macOS/Install or update Safari.command` to pick this up.
- **Safari：字幕永遠停在「準備中」。** `ImmerseFree Extension` 這個 target 從來沒有申請對外連線權限，沙盒因此把擴充功能發往 Bridge 或翻譯 API 的每個請求都安靜地丟掉。現在擴充功能 target 與外層 App 都設了 `ENABLE_OUTGOING_NETWORK_CONNECTIONS`，Xcode 專案裡從兩處變成四處。請重跑 `macOS/Install or update Safari.command` 重新建置 Safari 版本。
- **YouTube auto-dubbed videos picked the wrong caption track.** With no source language specified, the code took the first non-ASR track — but on an auto-dubbed video YouTube puts a machine-dubbed track first, which is how an English video ended up being translated from Arabic. It now prefers the ASR track, because speech recognition is always run on the speaker's original language.
- **YouTube 自動配音影片選錯字幕軌。** 沒指定原文語言時，程式會拿第一個非 ASR 軌——但自動配音影片會把機器配音軌排在最前面，所以英文影片才會變成從阿拉伯文翻譯。現在改為優先取 ASR 軌，因為語音辨識一定是跑在講者的原始語言上。
- **Scrolling a long page quickly inserted duplicate translations.** Two translation paths could run at once: the cache restorer entered exactly when the scheduler's queue had drained, took the `translateAll` shortcut, and never cancelled the still-live scheduler, which held a second set of item objects for the same elements. A 30-paragraph page came back as 49 nodes. Insertion now goes through a single idempotent function that keeps at most one translation node after each source node — and collapses any duplicates left behind by older versions.
- **長頁快速捲動會重複插入譯文。** 兩條翻譯路徑可能同時跑：快取還原剛好在排程器把隊列抽乾的那一瞬間進來，走了 `translateAll` 捷徑，而那條路徑不會取消仍然活著的排程器，排程器手上握著同一批元素的另一份物件。實測 30 段的長頁被插成 49 個節點。現在插入譯文只有一個冪等的出口，同一個原文節點後面永遠只留一個譯文節點，也會順手把舊版本留下的重複節點收斂掉。
- **The background translation cache almost never hit.** The cache key was derived from the whole request context, including per-request fields such as the preceding lines, so nearly every key was unique. The key now uses only the dimensions that genuinely change the output: mode, strict target language, compaction, matched glossary terms, and whether the segment carries rich-text placeholders.
- **背景層翻譯快取命中率趨近於零。** 快取鍵是從整份請求 context 算出來的，其中包含「前幾句」這種每次都不同的欄位，於是幾乎每一把鍵都是唯一的。現在鍵只取真正會改變輸出的維度：模式、是否強制目標語言、是否壓縮、命中的術語，以及這一段有沒有富文本佔位符。
- **A failed OpenCode catalog was reported as an empty catalog and poisoned the cache for 24 hours.** “The list came back empty” and “the list could not be fetched” are different things and are now told apart. A degraded catalog is retried after 60 seconds instead of being cached for the full 24 hours, and the previous good list is kept in the meantime.
- **OpenCode 型錄抓取失敗會被誤報成「型錄是空的」，還毒害快取 24 小時。** 「清單回來是空的」和「清單抓不到」是兩件事，現在會分開。抓取失敗的型錄改成 60 秒後重試，而不是照 24 小時快取下去；期間仍沿用上一份正常的清單。
- **The OpenCode CLI path is hardened.** Nine distinct error codes replace a single generic failure, only the four that mean “this attempt did not connect” are retried, a short-circuit stops hammering an engine that is clearly down, an idle timeout catches a CLI that starts but never speaks, and terminating a run kills the whole process tree instead of only the direct child.
- **OpenCode CLI 路徑強化。** 以九種錯誤碼取代單一的籠統失敗，只有代表「這次沒接上」的那四種才重試；短路機制會停止一直去敲明顯已經掛掉的引擎；閒置逾時能抓到「啟動了但一直不出聲」的 CLI；中止時會連整棵子行程樹一起殺掉，不再只殺直屬子行程。
- **The OpenCode default endpoint is back on `https://opencode.ai/zen/v1`**, and `npm run verify` now fails if the retired `inference/openai/v1` path reappears in the options UI.
- **OpenCode 預設端點回到 `https://opencode.ai/zen/v1`**，而且 `npm run verify` 會在已淘汰的 `inference/openai/v1` 重新出現在選項頁時直接失敗。
- **Antigravity vision OCR still does not auto-approve every CLI tool call.** The `--dangerously-skip-permissions` flag stays out of the Bridge, and the verifier fails the build if it comes back.
- **Antigravity 視覺 OCR 仍然不會自動核准所有 CLI 工具呼叫。** `--dangerously-skip-permissions` 不在 Bridge 裡，驗證器也會在它回來時讓建置失敗。

### Documentation｜文件

- New [`docs/FEATURES.md`](docs/FEATURES.md) — a bilingual feature overview where every number cites the file that defines it.
- 新增 [`docs/FEATURES.md`](docs/FEATURES.md)——中英雙語功能總覽，每個數字都註明定義它的檔案。
- New [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) — Safari subtitles, videos that will not play in an automation-launched Chrome, a Bridge that is not running, and running out of engine quota.
- 新增 [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)——Safari 字幕沒反應、自動化開啟的 Chrome 播不動影片、Bridge 沒啟動、引擎額度用盡。
- `THIRD_PARTY_NOTICES.md` now lists fflate (MIT) and yihong0618/bilingual_book_maker (MIT, commit `d21f0f6a`), whose bilingual EPUB insertion behavior is ported in `Extension/core/epub-core.js`.
- `THIRD_PARTY_NOTICES.md` 補上 fflate（MIT）與 yihong0618/bilingual_book_maker（MIT，commit `d21f0f6a`）；後者的雙語 EPUB 插入行為被移植進 `Extension/core/epub-core.js`。

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
