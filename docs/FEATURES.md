# Features｜功能總覽

A complete list of what ImmerseFree 0.8.0 does. Every number on this page comes
from the shipped source, not from marketing copy; the file that defines each one
is named so you can check it yourself.

ImmerseFree 0.8.0 的完整功能清單。這一頁的每一個數字都來自實際出貨的原始碼，不是宣傳文案；
每一項都註明了定義它的檔案，你可以自己去對。

---

## Web pages｜網頁

| Feature | What happens | 功能 | 實際效果 |
|---|---|---|---|
| Page translation | The translation is inserted below each original paragraph; the original stays. | 整頁翻譯 | 譯文插在每段原文下方，原文保留。 |
| Translation-only mode | The original is hidden and only the translation is shown. You can switch back at any time. | 僅譯文模式 | 暫時隱藏原文、只顯示譯文，可隨時切回。 |
| 12 bilingual themes | Choose how the translation looks: classic border, underline, dashed, wavy, highlight, quote, faded, italic, bold, card, divider, or plain. | 12 種雙語主題 | 選擇譯文的長相：經典邊線、底線、虛線、波浪、螢光、引言、淡化、斜體、粗體、卡片、分隔線、無樣式。 |
| Rich text preserved | Links, bold, and inline code inside a paragraph survive translation instead of being flattened to plain text. | 保留行內格式 | 段落裡的連結、粗體與行內程式碼會被保留，不會被壓成純文字。 |
| Smarter segmentation | Candidates are no longer limited to 14 semantic tags, so text-heavy layouts are picked up properly. | 更聰明的分段 | 翻譯候選不再只來自 14 個語意標籤，排版複雜的頁面也抓得到。 |
| Site rule library | 25 built-in rules tune what gets translated on common sites, plus your own rules on top. | 網站規則庫 | 內建 25 條規則，針對常見網站調整翻譯範圍，你也可以再加自己的規則。 |
| Floating ball | A draggable ball that snaps to the screen edge. Click it to translate the page; its menu offers translate, restore, translation-only／bilingual, and hide. | 側邊懸浮球 | 可拖曳、會自動貼邊的小球。點一下翻譯整頁；選單有翻譯、還原、僅譯文／雙語切換、收起四個動作。 |

Themes are defined in `Extension/core/settings-core.js` (`THEME_IDS`, 12 entries).
Site rules are in `Extension/core/site-rules.json` (`rules`, 25 entries).
The floating ball is `Extension/content/floating-ball.js`.

主題定義在 `Extension/core/settings-core.js` 的 `THEME_IDS`，共 12 個。網站規則在
`Extension/core/site-rules.json` 的 `rules`，共 25 條。懸浮球是
`Extension/content/floating-ball.js`。

---

## Video subtitles｜影片字幕

| Feature | What happens | 功能 | 實際效果 |
|---|---|---|---|
| AI subtitles (YouTube) | Turns captions on by itself, then draws its own translated line under them using the model you selected. | AI 字幕（YouTube） | 自動幫你把字幕打開，再用你選的模型在原字幕下方畫出自己的譯文行。 |
| Semantic merging | Player cues are cut for display timing, not for meaning. ImmerseFree merges them back into whole sentences before translating, so the model sees a real sentence. | 語意合併 | 播放器的字幕片段是為了顯示節奏切開的，不是照語意切。ImmerseFree 會先合併回完整句子再送翻，模型才看得到一句完整的話。 |
| Single-line display | The translated line is wrapped so it never grows into a block that covers the picture. | 單行顯示 | 譯文行會控制斷行，不會膨脹成一大塊蓋住畫面。 |
| Dual subtitles (Netflix, Disney+) | These services already ship several subtitle tracks. ImmerseFree shows a second one alongside the first — **no model, no quota, no cost**. | 雙軌字幕（Netflix、Disney+） | 這兩個平台本來就附了好幾條字幕軌，ImmerseFree 直接把第二條疊上去顯示——**不用模型、不吃額度、不花錢**。 |
| SRT export, 3 modes | Export the subtitles as an `.srt` file: translation only, original only, or both. | SRT 匯出，三種模式 | 把字幕輸出成 `.srt` 檔：只要中文、只要原文，或雙語。 |
| Episode study | Turns one episode's subtitles into vocabulary and sentence-pattern notes at your level. | 影集學習 | 把一集的字幕整理成符合你程度的單字與句型教材。 |
| Subtitle glossary | Pin how a proper noun should be translated so it stays consistent across the whole episode. | 字幕術語表 | 釘住專有名詞的譯法，讓它在整集裡保持一致。 |

AI subtitles are YouTube-only (`Extension/core/youtube-subtitle-core.js`). Dual
subtitles cover `netflix.com` and `disneyplus.com`
(`Extension/core/streaming-subtitle-core.js`). SRT modes are `zh`, `source`, and
`bilingual` (`Extension/core/srt-core.js`).

AI 字幕只支援 YouTube（`Extension/core/youtube-subtitle-core.js`）。雙軌字幕支援
`netflix.com` 與 `disneyplus.com`（`Extension/core/streaming-subtitle-core.js`）。
SRT 的三種模式是 `zh`、`source`、`bilingual`（`Extension/core/srt-core.js`）。

**Episode study levels.** Enter a TOEIC, IELTS, or GEPT score — or say you are a
complete beginner — and ImmerseFree maps it onto the six CEFR levels (A1 to C2),
then writes the notes at that level. CEFR is the standard European scale for
language ability; A1 is beginner and C2 is near-native.

**影集學習的程度換算。** 輸入多益、雅思或全民英檢分數，或直接說你是純新手，ImmerseFree
會換算成 CEFR 六個等級（A1 到 C2），再照那個程度出教材。CEFR 是歐洲通用的語言能力量表，
A1 是入門、C2 接近母語者。

---

## Documents｜文件

| Feature | What happens | 功能 | 實際效果 |
|---|---|---|---|
| EPUB bilingual reading | Opens an EPUB in a built-in reader and inserts the translation as a sibling paragraph after each original block. | EPUB 雙語閱讀 | 用內建閱讀器打開 EPUB，在每個原文區塊後面插入一段譯文。 |
| EPUB export | Saves a `<name>.bilingual.epub` you can open in any e-reader. | EPUB 匯出 | 輸出 `<原名>.bilingual.epub`，任何電子書閱讀器都打得開。 |
| PDF bilingual reading | Reads the text layer of normal PDFs; scanned pages fall back to local OCR, then to vision OCR. Includes a translation-only toggle. | PDF 雙語閱讀 | 一般 PDF 讀文字層；掃描頁改用本機 OCR，再不行才用視覺 OCR。也有「只看譯文」切換。 |
| PDF export | Saves a bilingual PDF. | PDF 匯出 | 輸出雙語 PDF。 |
| Word export | Exports the bilingual result as a `.docx`. | Word 匯出 | 把雙語結果輸出成 `.docx`。 |

**A limit worth knowing.** Word export writes plain text paragraphs with four
named styles (source, translation, heading, title). It does **not** carry bold,
links, or the original heading hierarchy across. Use EPUB or PDF export when
formatting matters. Source: `Extension/core/docx-core.js`.

**一個要先知道的限制。** Word 匯出寫出來的是純文字段落，配四個自訂樣式（原文、譯文、
標題、書名）。它**不會**保留粗體、連結或原本的標題層級。在意排版的話請改用 EPUB 或
PDF 匯出。依據：`Extension/core/docx-core.js`。

EPUB files over 500 blocks ask for confirmation before translating, because that
is a lot of model calls (`Extension/core/epub-core.js`).

超過 500 個區塊的 EPUB 會先跳出確認，因為那代表很多次模型呼叫
（`Extension/core/epub-core.js`）。

---

## Selection, hover, and input｜反白、懸停與輸入

| Feature | What happens | 功能 | 實際效果 |
|---|---|---|---|
| Selection translation | Select text, release the mouse, and a translation card appears. | 反白翻譯 | 反白文字放開滑鼠，出現翻譯卡片。 |
| Dictionary card | Select a **single word** and the card becomes a dictionary entry: pronunciation, parts of speech, separate senses, and a usage note. Copying copies the whole card. | 劃詞詞典卡 | 反白**單一單字**時，卡片會變成詞典條目：音標、詞性、分項釋義與用法說明。複製時會複製整張卡。 |
| Hover translation | Rest on a paragraph for about 0.7 seconds. Paragraphs already translated come back instantly from cache. | 懸停翻譯 | 在段落上停約 0.7 秒。翻過的段落直接從快取立刻出現。 |
| Input field translation | Type in a text field and press Space three times to replace the text with its translation. Password, email, number, URL, and telephone fields are excluded. | 輸入框翻譯 | 在文字欄位打字後連按三次空白鍵，用譯文取代原文。密碼、Email、數字、網址與電話欄位不套用。 |

The dictionary card is built in `Extension/content/interaction-translator.js`.

詞典卡實作在 `Extension/content/interaction-translator.js`。

---

## Glossary｜術語表

A glossary pins how a term must be translated, so the same word does not come
back three different ways across a long document or a whole season.

術語表用來釘住某個詞一定要怎麼翻，這樣同一個字在一份長文件或一整季影集裡不會出現三種譯法。

- **536 built-in preset terms**, in three domains: technology and software (198),
  finance and investing (167), and medicine and biotech (171). Turn on the
  domains you need.
- **Your own terms**, added by hand.
- **Pinned terms** for the video you are watching right now, kept separate from
  the ones that apply everywhere.

- **內建 536 條預設術語**，分三類：科技與軟體 198 條、財經與投資 167 條、醫療與生技
  171 條。要哪一類就開哪一類。
- **自訂術語**，你自己手動加。
- **釘選術語**，只套用在你正在看的這支影片上，跟「所有影片一律套用」的那組分開。

Counts come from `Extension/core/glossary-presets.js` (`PRESET_TERMS.length` is
536; `countByDomain()` gives the per-domain split).

數字來自 `Extension/core/glossary-presets.js`（`PRESET_TERMS.length` 是 536，
`countByDomain()` 給出各分類的數量）。

Only terms that actually appear in the sentence being translated are sent to the
model, and the translation cache is keyed on exactly those terms. Change a term's
translation and the affected sentences are retranslated; everything else keeps
its cached result.

只有真的出現在該句裡的術語才會送給模型，翻譯快取也剛好以那些術語為鍵。改掉某個術語的
譯法時，受影響的句子會重翻，其他句子照樣沿用快取。

---

## Translation engines｜翻譯引擎

Four engines. Nothing is bundled and no key ships with the installer.

四種引擎。安裝包不內含任何引擎，也不附任何金鑰。

| Engine | Needs | Cost | 引擎 | 需要什麼 | 費用 |
|---|---|---|---|---|---|
| Antigravity CLI (default) | `agy` installed and signed in with your Google account | your account's quota | Antigravity CLI（預設） | 裝好 `agy` 並用 Google 帳號登入 | 你帳號的額度 |
| OpenCode Free | nothing — no sign-in, no key | free | OpenCode 免費模型 | 什麼都不用——不登入、不用金鑰 | 免費 |
| Gemini API | your own key or keys, one per line | your quota | Gemini API | 你自己的金鑰，可一行一把貼多組 | 你的額度 |
| Custom API | an OpenAI-compatible base URL and model; key optional | yours | 自訂 API | OpenAI 相容的 base URL 與模型；金鑰可留空 | 你的 |

Engine ids are `antigravity`, `opencode`, `gemini`, and `custom`
(`Extension/core/settings-core.js`, `PROVIDER_IDS`).

引擎 id 是 `antigravity`、`opencode`、`gemini`、`custom`
（`Extension/core/settings-core.js` 的 `PROVIDER_IDS`）。

**Automatic failover.** When one engine fails — quota exhausted, local service
down, timeout, CLI unreachable — the next engine in your order takes over.
Switching happens only between batches, so one sentence is never half-translated
by two engines. A single translation tries at most two extra engines and then
stops. The toolbar always says which engine took over; it never switches
silently.

**失敗自動轉移。** 某個引擎掛掉時——額度用完、本機服務沒開、逾時、CLI 連不上——就換成
你排定的下一個。轉移只發生在「批」與「批」之間，同一句話不會被兩個引擎各翻一半。一次
翻譯最多額外嘗試兩個引擎就停。工具列一定會顯示是誰接手，不會偷偷換掉。

---

## Diagnostics｜診斷

The options page has a diagnostics panel with a per-engine success rate, a recent
event log with error codes, and nine counters:

選項頁有一個診斷面板，包含每個引擎的成功率、帶錯誤碼的近期事件紀錄，以及九個計數器：

| Counter | Meaning | 計數器 | 意義 |
|---|---|---|---|
| `cacheHits` / `cacheMisses` | how often a translation was reused instead of re-requested | `cacheHits`／`cacheMisses` | 有多少次直接沿用舊譯文，而不是重送一次請求 |
| `providerHandoffs` | how many times failover changed engine | `providerHandoffs` | 自動轉移換了幾次引擎 |
| `batches` / `batchSplits` | batches sent, and batches that had to be split and retried | `batches`／`batchSplits` | 送出的批次數，以及被迫拆開重試的批次數 |
| `richTextFallbacks` | paragraphs where inline formatting could not be restored | `richTextFallbacks` | 有幾段的行內格式沒能還原 |
| `dictFallbacks` | dictionary cards that fell back to a plain translation | `dictFallbacks` | 有幾張詞典卡退回成一般翻譯 |
| `subtitleCues` / `subtitleGroups` | raw player cues seen, and the merged sentences actually sent | `subtitleCues`／`subtitleGroups` | 看到的原始字幕片段數，以及合併後真正送出的句子數 |

Defined in `Extension/core/diagnostics-core.js` (`METRIC_KEYS`).

定義在 `Extension/core/diagnostics-core.js` 的 `METRIC_KEYS`。

---

## Keyboard shortcuts｜快捷鍵

| Action | Windows / Linux | macOS | 動作 |
|---|---|---|---|
| Translate the current page | `Alt + Shift + B` | `Control + Shift + B` | 翻譯目前網頁 |
| Translate the selection | `Alt + Shift + T` | `Control + Shift + T` | 翻譯選取文字 |
| Toggle AI subtitles | `Alt + Shift + A` | `Option + Shift + A` | 開關 AI 字幕 |
| Toggle dual subtitles | `Alt + Shift + D` | `Option + Shift + D` | 開關雙軌字幕 |

The first two declare an explicit macOS binding in the manifest; the two subtitle
shortcuts declare only a default, which the browser maps to Option on macOS.

前兩個在 manifest 裡有明確指定 macOS 的按鍵；兩個字幕快捷鍵只宣告了預設值，瀏覽器在
macOS 上會把它對應到 Option 鍵。

Four commands, declared in `Extension/manifest.json`. Chrome and Edge let you
change them at `chrome://extensions/shortcuts` and
`edge://extensions/shortcuts`.

共四個，宣告在 `Extension/manifest.json`。Chrome 與 Edge 可以在
`chrome://extensions/shortcuts` 與 `edge://extensions/shortcuts` 改鍵。

---

## Interface｜介面

The interface ships complete in English and Traditional Chinese. It follows your
browser language on first launch, and you can change it at any time in
**Options → Languages → Interface language**. Translation runs between English,
Traditional Chinese, Simplified Chinese, Japanese, Korean, and Thai.

介面完整提供英文與繁體中文。第一次啟動時跟隨瀏覽器語言，也可以隨時到
**選項 → 語言 → 介面語言** 更改。翻譯支援英文、繁體中文、簡體中文、日文、韓文與泰文之間互譯。

Settings can be exported and imported to move to another computer. The export
file contains your API keys in plaintext, so protect it and delete it after the
transfer.

設定可以匯出、匯入，用來搬到另一台電腦。匯出檔會以明文包含 API key，請妥善保護，搬完就刪掉。
