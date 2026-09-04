# Features｜功能總覽

A complete list of what ImmerseFree 0.8.0 does. Every number on this page comes
from the shipped source, not from marketing copy; the file that defines each one
is named so you can check it yourself.

ImmerseFree 0.8.0 的完整功能清單。這一頁的每個數字都是從實際出貨的原始碼抄下來的，不是宣傳
文案；每一項都寫明是哪個檔案定義的，你可以自己去對。

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

### The twelve themes｜十二種主題

The theme id is written to `<html data-imf-theme="...">` and every rule lives in
`Extension/content/content.css`. `classic` is the default and is the one theme
with no attribute value of its own — it is what the base rule renders when no
theme override applies, so `content.css` contains eleven `data-imf-theme`
selectors, not twelve.

主題 id 會寫在 `<html data-imf-theme="...">` 上，規則全部住在
`Extension/content/content.css`。`classic` 是預設值，也是唯一沒有自己屬性值的主題：
沒有任何主題覆寫的時候，基底規則畫出來的就是它。所以 `content.css` 裡的
`data-imf-theme` 選擇器有十一個，不是十二個。

| id | Rendering | 名稱 | 畫面上長怎樣 |
|---|---|---|---|
| `classic` | Left border via `border-inline-start`. Default | 經典邊線 | 左側線條 `border-inline-start`，預設值 |
| `underline` | Solid underline, 1px, `currentColor` at 42% | 底線 | 實線底線，1px，`currentColor` 42% |
| `dashed` | Dashed underline, 1px, `currentColor` at 45% | 虛線 | 虛線底線，1px，`currentColor` 45% |
| `wavy` | Wavy underline, `currentColor` at 38% | 波浪線 | 波浪底線，`currentColor` 38% |
| `highlight` | Yellow highlighter, `box-decoration-break: clone` so it wraps cleanly | 高亮 | 黃色螢光，用 `box-decoration-break: clone` 讓跨行斷得乾淨 |
| `quote` | 3px left rule, tinted background, rounded right corners | 引用塊 | 左側 3px 線加淡色底，右側圓角 |
| `faded` | `opacity: .62` | 弱化 | `opacity: .62` |
| `italic` | `font-style: italic` | 斜體 | `font-style: italic` |
| `bold` | `font-weight: 700` | 粗體 | `font-weight: 700` |
| `card` | Rounded card, 1px border, one light shadow | 紙片 | 圓角卡片，1px 邊框，一層淡陰影 |
| `divider` | Hairline `border-block-start` above the translation | 分隔線 | 譯文上方一條 `border-block-start` 細線 |
| `plain` | No decoration; typography layer only | 無裝飾 | 沒有裝飾，只留印刷層 |

**Live preview.** The options page renders all twelve at once, and each preview
container carries a real `data-imf-theme` with a real
`.immersefree-page-translation` inside, styled by the same `content.css` the
content script injects. There is no separate preview stylesheet that could drift
from the real thing (`Extension/ui/options.js`, `renderThemeGrid()`).

**即時預覽。** 選項頁會一次畫出十二種，每一格預覽容器都掛著真的 `data-imf-theme`，
裡面放著真的 `.immersefree-page-translation`，吃的就是內容腳本注入的同一份
`content.css`。沒有另外一份預覽專用的樣式表，也就不會有預覽跟實際兩邊愈走愈遠的問題
（`Extension/ui/options.js` 的 `renderThemeGrid()`）。

**Dark mode.** Only the three themes that carry their own colour — `highlight`,
`quote`, `card` — are repainted under `@media (prefers-color-scheme: dark)`. The
other nine derive their decoration from `currentColor` and therefore follow the
page's own text colour with no special case (`content.css`).

**深色模式。** 只有三種自帶顏色的主題——`highlight`、`quote`、`card`——會在
`@media (prefers-color-scheme: dark)` 底下重新配色。另外九種的裝飾色是從
`currentColor` 混出來的，會自動跟著頁面自己的文字色走，不需要特例（`content.css`）。

**CJK typography.** Translated blocks set `line-height: 1.7`,
`text-spacing-trim: trim-start`, and `text-autospace: normal`, which trims
punctuation at line starts and spaces CJK against Latin runs.

**中日韓排版。** 譯文區塊會設 `line-height: 1.7`、`text-spacing-trim: trim-start`
與 `text-autospace: normal`，處理行首標點擠壓，以及中西文之間的自動留白。

**Scope.** The theme is a global setting. Site rules
(`Extension/core/site-rules.json`) control *what* gets translated on a given
site, not how the translation is styled — there is no per-site theme field.

**適用範圍。** 主題是全域設定。網站規則（`Extension/core/site-rules.json`）管的是
某個網站上「哪些東西要翻」，不管譯文長什麼樣；沒有「這個網站用這個主題」這種欄位。

---

## Video subtitles｜影片字幕

| Feature | What happens | 功能 | 實際效果 |
|---|---|---|---|
| AI subtitles (YouTube) | Turns captions on by itself, then draws its own translated line under them using the model you selected. | AI 字幕（YouTube） | 自動幫你把字幕打開，再用你選的模型在原字幕下方畫出自己的譯文行。 |
| Semantic merging | Player cues are cut for display timing, not for meaning. ImmerseFree merges them back into whole sentences before translating, so the model sees a real sentence. | 語意合併 | 播放器的字幕片段是為了顯示節奏切開的，不是照語意切。ImmerseFree 會先合併回完整句子再送翻，模型才看得到一句完整的話。 |
| Single-line display | The translation stays on one line where it can. If it overflows, the font shrinks first — to 65% on YouTube, 72% on Netflix and Disney+ — and only then does it wrap to a second line. | 單行顯示 | 譯文盡量維持一行。放不下時先縮字級——YouTube 到 65%，Netflix 與 Disney+ 到 72%——縮到底才折第二行。 |
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

### How dual subtitles get the second track｜雙軌字幕怎麼拿到第二條軌

A streaming manifest lists every subtitle language at once; the player mounts one
at a time. Dual subtitles fetch the track you did not select and render it under
the one you did. No model is called on this path at all, so it consumes no quota
and needs no API key, and the second line is the distributor's own professional
translation rather than a generated one. Timecodes come from the same official
file, so the two lines stay aligned without correction.

串流平台的播放清單裡本來就同時列著所有語言的字幕，播放器只是一次掛一條。雙軌字幕把你
沒選到的那條抓下來，畫在你選的那條底下。這條路徑完全不呼叫模型，所以不吃額度也不需要
API key，而第二行是片商自己的專業翻譯，不是生成出來的。時間碼出自同一份官方檔案，兩行
不需要校正就是對齊的。

Three acquisition routes are tried in order, and whichever succeeds is used
(`Extension/content/dual-subtitle.js`):

依序試三條取得路徑，哪條成功就用哪條（`Extension/content/dual-subtitle.js`）：

1. The subtitle tracks the player already mounted on the `<video>` element. A
   `disabled` track is flipped to `hidden`, which keeps the browser parsing its
   cues without drawing them — the player's own line stays on screen and
   ImmerseFree only reads the data.
2. The HLS or DASH playlist intercepted from the player, parsed, with the full
   track then fetched.
3. The subtitle file URL the player itself already requested.

1. 播放器已經掛在 `<video>` 元素上的字幕軌。`disabled` 的軌會被改成 `hidden`，
   瀏覽器會繼續解析它的 cue 但不畫出來——畫面上維持播放器自己那條，ImmerseFree
   只是把資料讀走。
2. 從播放器攔截到的 HLS 或 DASH 播放清單，解析後再抓完整份字幕。
3. 播放器自己已經請求過的字幕檔網址。

**Language choice.** If the subtitle currently displayed is already in your
target language, a second line in the same language would be pointless, so
`decideSecondLanguage()` falls back to `dualSubtitleFallbackLanguage`
(default `en`). The decision reads the text actually on screen, not the player's
settings, which are frequently stale.

**語言決定。** 如果目前顯示的字幕本來就是你的目標語言，再疊一行同語言沒有意義，
所以 `decideSecondLanguage()` 會改用 `dualSubtitleFallbackLanguage`（預設 `en`）。
判斷依據是畫面上實際顯示的那行字，不是播放器的設定值——設定值常常是舊的。

**Disney+ shadow DOM.** Disney+ renders subtitles inside shadow roots, which an
ordinary `querySelectorAll` cannot reach; from outside, its player looks like it
has no subtitles at all. `streaming-subtitle-core.js` walks the shadow trees as
well, caching the scan for 1.5 seconds.

**Disney+ 的 shadow DOM。** Disney+ 把字幕畫在 shadow root 裡，一般的
`querySelectorAll` 穿不進去，從外面看整個播放器就像沒有字幕。
`streaming-subtitle-core.js` 會連 shadow 樹一起走，掃描結果快取 1.5 秒。

**Limits.** This only works when the title actually carries a second subtitle
track in the requested language; licensing varies by region and by title. Dual
subtitles cover `netflix.com` and `disneyplus.com` only, and the dual and AI
subtitle modes are mutually exclusive.

**限制。** 這只有在該片真的附了你要的語言那條字幕軌時才成立；授權因地區與片單而異。
雙軌字幕只支援 `netflix.com` 與 `disneyplus.com`，而且雙軌與 AI 字幕兩種模式互斥。

### Semantic merging, context, and line breaking｜語意合併、上下文與斷行

**Merging** (`Extension/core/subtitle-merge-core.js`). Player cues are cut for
display timing, so one sentence often arrives in two or three pieces. Cues are
merged back into sentences before translation, and every member cue of a group
then displays the same complete translation. The constants:

**合併**（`Extension/core/subtitle-merge-core.js`）。播放器的 cue 是照顯示節奏切的，
一句話常被切成兩三段。送翻之前先合併回句子，組內每個成員 cue 接著都顯示同一句完整譯文。
常數如下：

| Constant | Value | Why | 常數 | 值 | 為什麼 |
|---|---|---|---|---|---|
| `maxGapMs` | 400 ms | A longer gap means a new speaker or a scene change | `maxGapMs` | 400 毫秒 | 間隔更長就代表換人講或換場景 |
| `maxDurationMs` | 7000 ms | Caps how long one subtitle can sit on screen | `maxDurationMs` | 7000 毫秒 | 限制一條字幕停在畫面上的時間 |
| `maxChars` | 160 | Keeps a single request from becoming a wall of text | `maxChars` | 160 | 避免一次送給模型一大塊文字 |

Sentence ends are detected from punctuation with closing quotes and brackets
stripped first, so `He left."` ends on the period. An abbreviation list prevents
`Mr.`, `e.g.`, `a.m.` and `Ph.D` from splitting a sentence; words that are also
ordinary words, such as `no.` and `co.`, are deliberately excluded because
including them would cause the opposite error.

句尾靠標點判斷，而且會先剝掉結尾的引號與括號，所以 `He left."` 的句尾是句點。另有一張
縮寫表，避免 `Mr.`、`e.g.`、`a.m.`、`Ph.D` 把句子切成兩半；像 `no.`、`co.` 這種同時也是
常用單字的刻意不收，收了會製造相反的錯誤。

**Context** (`Extension/core/subtitle-context-core.js`). Each batch of 12
subtitle sentences (`Extension/core/batch-core.js`) carries three layers:

**上下文**（`Extension/core/subtitle-context-core.js`）。每批 12 句字幕
（`Extension/core/batch-core.js`）帶三層：

- **Video** — title, channel, description, source and target language. Fields
  that cannot be read are omitted entirely rather than sent as empty strings; an
  empty string tells the model "this video has no channel", which is worse than
  saying nothing. Caps: title 240 chars, channel 120, description 200.
- **Glossary** — only the terms that actually occur in this batch.
- **Dialogue** — the last 8 completed semantic sentences as bilingual pairs,
  roughly 30–60 seconds of conversation, capped at 600 characters.

- **影片層**——標題、頻道、描述、原文與目標語言。讀不到的欄位整個省略，不送空字串；
  空字串等於告訴模型「這支影片沒有頻道」，比不寫更糟。上限：標題 240 字元、頻道 120、
  描述 200。
- **術語層**——只帶這一批裡真的出現的術語。
- **對話層**——最近 8 句已完成的語意句，以雙語對形式帶上，大約 30–60 秒的對話，
  上限 600 字元。

A short-sentence flag rides along in the same prompt at no extra API call: a cue
on screen for under `COMPACT_MIN_DURATION_MS` (1200 ms), or one that would need
more than `COMPACT_MAX_CPS` (20) characters per second to read, asks the model to
keep that translation short.

同一個 prompt 裡搭載極短句標記，不多花一次 API 呼叫：停留低於
`COMPACT_MIN_DURATION_MS`（1200 毫秒），或算下來要用超過 `COMPACT_MAX_CPS`（20）
每秒字元數才讀得完的句子，會請模型把那句譯文壓短。

**Line breaking** (`Extension/core/subtitle-linebreak-core.js`, applied in
`youtube-subtitle-core.js` and `streaming-subtitle-core.js`). The translated line
is kept on one line where possible. The rendered width is measured against 90% of
the player width; if it overflows, the font is scaled down, to a floor of **65%**
on YouTube and **72%** on Netflix and Disney+, where the player's own type is
smaller to begin with. Only if it still does not fit does it fall back to two
lines at the original size. Breaks are placed at punctuation and English word
boundaries, roughly 14–18 full-width characters per line, never more than two
lines. YouTube's base font size is derived from the player rectangle and clamped
between 16 px and 36 px.

**斷行**（`Extension/core/subtitle-linebreak-core.js`，套用在
`youtube-subtitle-core.js` 與 `streaming-subtitle-core.js`）。譯文盡量維持一行。
實測寬度會跟播放器寬度的 90% 比對；放不下就縮字級，YouTube 最低到 **65%**，
Netflix 與 Disney+ 是 **72%**（那兩邊播放器本身的字就比較小）。縮到底仍放不下，
才退回兩行，字級維持原大小。斷點挑在標點與英文詞界，一行約 14–18 個全形字，最多兩行。
YouTube 的基準字級由播放器矩形推算，並夾在 16 px 到 36 px 之間。

**Why the model is not asked to break lines.** It returns a batch of
translations as structured JSON. A newline the model inserts is unreliable — it
cannot know the player width or font size in use — and a stray line break inside
a JSON string can make the whole batch unparseable, which loses the entire block
of subtitles. Line breaking is therefore done in the browser, where the real
pixel width is known.

**為什麼不讓模型自己斷行。** 它回傳的是一批譯文組成的結構化 JSON。模型自己插的換行
不可靠——它不可能知道播放器多寬、字級多大——而 JSON 字串裡跑出一個換行，可能讓整批
解析失敗，那一整塊字幕就會消失。所以斷行在瀏覽器裡做，因為只有那裡知道真正的像素寬度。

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
標題、書名），**不會**保留粗體、連結和原本的標題層級。在意排版就改用 EPUB 或
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

四種引擎。安裝包不內含任何引擎，也不附金鑰。

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

介面完整提供英文與繁體中文，第一次啟動時跟著瀏覽器語言走，之後隨時可以到
**選項 → 語言 → 介面語言** 改。翻譯支援英文、繁體中文、簡體中文、日文、韓文與泰文之間互譯。

Settings can be exported and imported to move to another computer. The export
file contains your API keys in plaintext, so protect it and delete it after the
transfer.

設定可以匯出、匯入，用來搬到另一台電腦。匯出檔是明文帶著 API key 的，請保管好，搬完就刪掉。
