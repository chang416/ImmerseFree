<p align="center">
  <img src="Extension/icons/icon-128.png" width="112" alt="ImmerseFree logo">
</p>

# ImmerseFree

**A bilingual translator for the whole web — pages, video subtitles, EPUB and PDF books, selected text, and input fields — with nothing held back for a paid tier, because there is no paid tier.**

**一套涵蓋整個網路的雙語翻譯工具——網頁、影片字幕、EPUB 與 PDF 電子書、反白文字、輸入欄位——沒有任何功能被留給付費方案，因為它根本沒有付費方案。**

ImmerseFree ships a complete built-in English interface alongside Traditional Chinese, and it is made for users worldwide, not only for people in Taiwan. It follows your browser language on first launch and switches at any time in **Settings → Interface language**. It translates among English, Traditional Chinese, Simplified Chinese, Japanese, Korean, and Thai — in any direction, not just into Chinese. And because the custom-endpoint option accepts **any** OpenAI-compatible API, you are not tied to whichever providers happen to be reachable from Taiwan: point it at OpenAI, Groq, Together, OpenRouter, DeepSeek, or a model running on your own machine through Ollama or LM Studio, whichever is available where you are.

ImmerseFree 是寫給世界各地讀者用的，不限定語言方向。介面完整提供英文與繁體中文，第一次開啟跟隨瀏覽器語言，也可以隨時到 **設定 → 介面語言** 切換。翻譯支援英文、繁體中文、簡體中文、日文、韓文與泰文之間互譯，不是只能翻成中文。而且自訂端點可以接**任何**相容 OpenAI 介面的服務，所以你不會被綁在「剛好從台灣連得到」的那幾家：OpenAI、Groq、Together、OpenRouter、DeepSeek，或用 Ollama、LM Studio 跑在自己電腦上的模型，你所在地能用哪個就接哪個。

It runs on model quota you already have. Nothing is bundled and no key ships with the installer: pick the Antigravity CLI, the free OpenCode models, your own Gemini key, or any OpenAI-compatible endpoint. There is no ImmerseFree account, no ImmerseFree server, and no ImmerseFree meter. Your text goes from your browser to the engine you chose, and that is the entire path.

它跑在你手上已經有的模型額度上。安裝包不內含任何引擎，也不附任何金鑰：你可以選 Antigravity CLI、OpenCode 免費模型、你自己的 Gemini 金鑰，或任何相容 OpenAI 介面的服務。沒有 ImmerseFree 帳號、沒有 ImmerseFree 伺服器、也沒有 ImmerseFree 在旁邊計費。你的文字從你的瀏覽器直接送到你選的引擎，全程就這一段路。

Subtitle downloads, scanned-PDF OCR, glossaries, custom prompts, translation-only mode, twelve display themes — these are the things translation products usually put behind a subscription. Here they are just features, and they cost nothing. There is no bill to send you, because the project never handles your content and runs no service that could meter it.

字幕檔下載、掃描 PDF 的 OCR、術語表、自訂提示詞、僅譯文模式、十二種顯示主題——這些通常是翻譯產品擺在訂閱牆後面的東西。在這裡它們就只是功能，而且不用錢。沒有帳單可以寄給你，因為這個專案不經手你的內容，也沒有跑任何可以拿來計費的服務。

Windows and macOS are supported; Chrome, Microsoft Edge, and Safari installation paths are included. No API key or private login credential is included in this repository.

支援 Windows 與 macOS，並提供 Chrome、Microsoft Edge 與 Safari 的安裝方式。本 repository 不包含任何 API key 或私人登入憑證。

> [!IMPORTANT]
> ImmerseFree is not yet in any browser store. Chrome and Edge therefore require one manual **Load unpacked** step per browser profile, and Safari requires Xcode and your own Apple signing team. These are browser security restrictions and no installer can bypass them — an installer is not allowed to add an extension to your browser on your behalf, so the last step has to be yours.

> [!IMPORTANT]
> ImmerseFree 還沒有上架任何瀏覽器商店。因此 Chrome 與 Edge 每個瀏覽器設定檔都需要手動執行一次「載入未封裝項目」，Safari 則需要 Xcode 與你自己的 Apple 簽署 Team。這些是瀏覽器的安全限制，任何安裝程式都繞不過去——瀏覽器不允許安裝程式代替你把擴充功能裝進去，所以最後一步一定得由你自己按。

## Quick install｜快速安裝

### Where to download｜要去哪裡下載

Open the [latest release](https://github.com/chang416/ImmerseFree/releases/latest). On the release page, scroll to **Assets**. If the file list is hidden, click the small triangle next to **Assets** to expand it.

打開 [最新版本下載頁](https://github.com/chang416/ImmerseFree/releases/latest)，往下找到 **Assets**。如果沒有看到檔案清單，請按 **Assets** 左邊的小三角形把清單展開。

- **Windows:** download [`ImmerseFree-Windows.zip`](https://github.com/chang416/ImmerseFree/releases/latest/download/ImmerseFree-Windows.zip).
- **Windows**：下載 [`ImmerseFree-Windows.zip`](https://github.com/chang416/ImmerseFree/releases/latest/download/ImmerseFree-Windows.zip)。
- **macOS:** download [`ImmerseFree-macOS.zip`](https://github.com/chang416/ImmerseFree/releases/latest/download/ImmerseFree-macOS.zip).
- **macOS**：下載 [`ImmerseFree-macOS.zip`](https://github.com/chang416/ImmerseFree/releases/latest/download/ImmerseFree-macOS.zip)。

If a release asset is temporarily unavailable, click the green **Code** button on the repository page, choose **Download ZIP**, unzip it, and follow the same platform instructions below.

如果版本附件暫時無法下載，請在 repository 首頁按綠色的 **Code** 按鈕，再按 **Download ZIP**，解壓縮後依照下方相同的平台教學操作。

### Windows — Chrome or Edge｜Windows — Chrome 或 Edge

1. Right-click the downloaded ZIP and choose **Extract All**. Open the extracted folder, open `Windows`, then double-click **`Install ImmerseFree.cmd`**.
2. The installer copies the required files to a permanent folder, starts the local Bridge, configures it to start when you sign in, opens the browser extension page, and copies the installed extension path to the clipboard.
3. In Chrome, turn on **Developer mode** at the top right and click **Load unpacked**. In the folder picker, press **Ctrl + L**, press **Ctrl + V** to paste the copied path, press Enter, then click **Select Folder**.
4. In Edge, turn on **Developer mode** in the left sidebar, click **Load unpacked**, and use the same **Ctrl + L** steps.

The permanent Windows folder is `%LOCALAPPDATA%\ImmerseFree\Extension`. You do not need to search inside the extracted download after the installer finishes. If the path was not copied, paste `%LOCALAPPDATA%\ImmerseFree\Extension` into File Explorer's address bar and press Enter.

1. 在下載的 ZIP 上按右鍵，選擇 **全部解壓縮**。打開解壓後的資料夾，再打開 `Windows`，接著雙擊 **`Install ImmerseFree.cmd`**。
2. 安裝程式會把需要的檔案複製到永久資料夾、啟動本機 Bridge、設定登入 Windows 時自動啟動、開啟瀏覽器擴充功能頁面，並把安裝後的擴充功能路徑複製到剪貼簿。
3. 在 Chrome 右上角打開 **開發人員模式**，按 **載入未封裝項目**。在選擇資料夾的視窗按 **Ctrl + L**，再按 **Ctrl + V** 貼上路徑，按 Enter，最後按 **選取資料夾**。
4. 在 Edge 左側打開 **開發人員模式**，按 **載入解壓縮的擴充功能**，再用相同的 **Ctrl + L** 步驟。

Windows 的永久安裝位置是 `%LOCALAPPDATA%\ImmerseFree\Extension`。安裝完成後不需要回到解壓縮的下載資料夾裡尋找。如果路徑沒有成功複製，請把 `%LOCALAPPDATA%\ImmerseFree\Extension` 貼到檔案總管的網址列，再按 Enter。

If Windows shows **Windows protected your PC**, click **More info → Run anyway**. This warning can appear because the downloaded ZIP is not code-signed. You may instead right-click the ZIP before extracting it, choose **Properties**, select **Unblock**, and apply the change.

如果 Windows 顯示 **Windows 已保護您的電腦**，請按 **其他資訊 → 仍要執行**。這個提示可能是因為下載的 ZIP 沒有程式碼簽章。你也可以在解壓前對 ZIP 按右鍵，選擇 **內容**，勾選 **解除封鎖** 後套用。

### macOS — Chrome or Edge｜macOS — Chrome 或 Edge

1. Double-click the downloaded ZIP to unzip it. Open the extracted folder, then open `macOS`.
2. For the first run, open Terminal, drag **`Install ImmerseFree.command`** into the Terminal window, and press Return. macOS may block a downloaded script if you only double-click it the first time.
3. The installer copies the files to a permanent macOS system folder, starts the local Bridge at login, opens the browser extension page, and copies the extension folder path to the clipboard.
4. In Chrome, open `chrome://extensions`, turn on **Developer mode**, and click **Load unpacked**. In the folder picker, press **Command + Shift + G**, press **Command + V** to paste the copied path, press Return, then click **Open**.
5. In Edge, open `edge://extensions`, turn on **Developer mode**, click **Load unpacked**, and use the same **Command + Shift + G** steps.

The downloaded folder is named `Extension`, but the installer creates a permanent folder named `Chrome Extension` inside `~/Library/Application Support/ImmerseFree`. You do not need to search inside the extracted `macOS` folder. If you lose the copied path, run **`Enable in another Chrome profile.command`**; it reveals the correct folder and copies its path again.

1. 雙擊下載的 ZIP 解壓縮。打開解壓後的資料夾，再打開 `macOS`。
2. 第一次執行時，請先開啟「終端機」，把 **`Install ImmerseFree.command`** 拖進終端機視窗，再按 Return。從網路下載的腳本第一次直接雙擊時，macOS 可能會阻擋它。
3. 安裝程式會把檔案複製到 macOS 的永久系統資料夾、設定登入時啟動本機 Bridge、開啟瀏覽器擴充功能頁面，並自動把擴充功能資料夾路徑複製到剪貼簿。
4. 在 Chrome 開啟 `chrome://extensions`，打開 **開發人員模式**，按 **載入未封裝項目**。在選擇資料夾的視窗按 **Command + Shift + G**，再按 **Command + V** 貼上已複製的路徑，按 Return，最後按 **開啟**。
5. 在 Edge 開啟 `edge://extensions`，打開 **開發人員模式**，按 **載入解壓縮的擴充功能**，再用相同的 **Command + Shift + G** 步驟選取資料夾。

下載包裡的資料夾名稱是 `Extension`，但安裝程式會在 `~/Library/Application Support/ImmerseFree` 內建立永久使用的 `Chrome Extension`。你不需要在解壓後的 `macOS` 資料夾裡尋找它。如果剪貼簿裡的路徑不見了，請執行 **`Enable in another Chrome profile.command`**；它會重新顯示正確資料夾並再次複製路徑。

### macOS — Safari｜macOS — Safari

Install the Chrome/Edge version first so the shared Bridge is available. Then open the `macOS` folder and run **`Install or update Safari.command`**. You need the full Xcode app, not only the Command Line Tools. On the first run, Xcode may open and ask you to sign in with an Apple Account and choose a Development Team for both targets. After the build finishes, open **Safari → Settings → Extensions** and enable ImmerseFree.

請先完成上方 Chrome／Edge 版本安裝，讓共用的 Bridge 可以使用。接著打開 `macOS` 資料夾並執行 **`Install or update Safari.command`**。你需要安裝完整的 Xcode App，只有 Command Line Tools 不夠。第一次執行時，Xcode 可能會打開並要求你登入 Apple 帳號，且替兩個 target 選擇 Development Team。建置完成後，請到 **Safari → 設定 → 延伸功能** 啟用 ImmerseFree。

The local Safari script creates a development-signed app for your own Mac. It is not a notarized public installer and cannot be redistributed as-is.

本機 Safari 腳本會替你自己的 Mac 建立開發簽署版本。它不是已公證的公開安裝程式，不能直接拿去重新散布。

> [!IMPORTANT]
> If you used Safari before 0.8.0 and subtitles never left “Preparing”, rerun `Install or update Safari.command`. Releases before 0.8.0 did not grant the Safari extension outgoing network access, so its requests were silently dropped by the sandbox. See [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

> [!IMPORTANT]
> 如果你在 0.8.0 之前用過 Safari 版，而字幕永遠停在「準備中」，請重新執行 `Install or update Safari.command`。0.8.0 之前的版本沒有給 Safari 擴充功能對外連線的權限，它發出的請求會被沙盒安靜地丟掉。詳見 [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)。

## What a translated website looks like｜翻譯後的網站會長這樣

With page translation enabled, ImmerseFree keeps each original paragraph and places the translated paragraph directly below it with a subtle left border. The result looks like this:

開啟整頁翻譯後，ImmerseFree 會保留每一段原文，並以低調的左側線條把譯文放在原文正下方。使用 ImmerseFree 翻譯網站後，看起來會像這樣：

![A website translated by ImmerseFree, showing the original English paragraphs with Traditional Chinese translations below them](docs/assets/translation-preview.png)

## Features｜功能

| Feature | What happens | 功能 | 實際效果 |
|---|---|---|---|
| Page translation | Translations are inserted below the original paragraphs, in one of 12 bilingual themes. | 整頁翻譯 | 譯文插在原文段落下方，可選 12 種雙語主題。 |
| Translation-only mode | Hide the original and show only the translation; switch back at any time. | 僅譯文模式 | 隱藏原文只看譯文，可隨時切回。 |
| AI video subtitles | On YouTube, ImmerseFree turns captions on by itself and draws its own translated line underneath. | AI 影片字幕 | 在 YouTube 上自動幫你開啟字幕，並在下方畫出自己的譯文行。 |
| Dual subtitles | Netflix and Disney+ already ship several subtitle tracks; ImmerseFree shows a second one alongside the first. No model, no quota, no cost. | 雙軌字幕 | Netflix 與 Disney+ 本來就有多條字幕軌，ImmerseFree 直接把第二條疊上去。不用模型、不吃額度、不花錢。 |
| Episode study | Turns one episode's subtitles into vocabulary and sentence-pattern notes at your level. | 影集學習 | 把一集的字幕整理成符合你程度的單字與句型教材。 |
| SRT export | Export subtitles as an `.srt` file: translation only, original only, or bilingual. | SRT 匯出 | 把字幕輸出成 `.srt`：只要譯文、只要原文，或雙語。 |
| EPUB reading and export | A built-in bilingual reader, plus a `<name>.bilingual.epub` you can open anywhere. | EPUB 閱讀與匯出 | 內建雙語閱讀器，另可輸出 `<原名>.bilingual.epub`。 |
| PDF reading and export | Reads normal PDFs, uses local OCR for scanned pages when available, and exports a bilingual PDF. | PDF 閱讀與匯出 | 翻譯一般 PDF，掃描頁可用本機 OCR，並可輸出雙語 PDF。 |
| Word export | Save the bilingual result as a `.docx`. | Word 匯出 | 把雙語結果輸出成 `.docx`。 |
| Selected text | Select text and release the mouse to open a translation card. | 反白翻譯 | 選取文字並放開滑鼠後顯示翻譯卡片。 |
| Dictionary card | Select a single word and the card becomes a dictionary entry: pronunciation, parts of speech, senses, and a usage note. | 劃詞詞典卡 | 反白單一單字時，卡片會變成詞典條目：音標、詞性、分項釋義與用法說明。 |
| Hover translation | Rest on a paragraph for about 0.7 seconds; cached results appear immediately. | 懸停翻譯 | 在段落上停留約 0.7 秒；有快取時立即顯示。 |
| Input translation | Type in an input field and press Space three times to replace it with the translation. | 輸入框翻譯 | 在輸入欄位打字後連按三次空白鍵，以譯文取代原文。 |
| Glossary | 536 built-in preset terms across three domains, plus your own terms and terms pinned to one video. | 術語表 | 內建 536 條預設術語，分三類；另可自訂，也可只釘給某一支影片。 |
| Site rule library | 25 built-in rules tune what gets translated on common sites; your own rules can add, remove, or replace them. | 網站規則庫 | 內建 25 條規則調整常見網站的翻譯範圍；你的規則可以疊加、移除或整組取代。 |
| Floating ball | A draggable, edge-snapping ball for translate, restore, translation-only, and hide. | 側邊懸浮球 | 可拖曳、自動貼邊的小球，提供翻譯、還原、僅譯文、收起。 |
| Automatic failover | When one engine fails, the next in your order takes over — between batches only, and never silently. | 失敗自動轉移 | 引擎掛掉時換下一個——只在批與批之間換，而且不會偷偷換。 |
| Diagnostics | Per-engine success rate, an error-code event log, and nine counters. | 診斷 | 每個引擎的成功率、帶錯誤碼的事件紀錄，以及九個計數器。 |
| Shortcuts | Four: translate page, translate selection, toggle AI subtitles, toggle dual subtitles. | 快捷鍵 | 四個：翻譯網頁、翻譯選取、開關 AI 字幕、開關雙軌字幕。 |
| Settings transfer | Export and import settings between computers. | 設定搬家 | 在不同電腦間匯出與匯入設定。 |

Full details, including which file defines each number above, are in [`docs/FEATURES.md`](docs/FEATURES.md).

完整說明（包含上面每個數字是由哪個檔案定義的）在 [`docs/FEATURES.md`](docs/FEATURES.md)。

If something does not work, start with [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

如果有東西不能用，先看 [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)。

## How it compares｜和沈浸式翻譯比一比

The obvious comparison is [Immersive Translate](https://immersivetranslate.com/), the product most people in this space already use. It is a good product with twenty million users, and it does several things ImmerseFree cannot do at all. So here is the comparison with both columns filled in honestly — the parts where a subscription is the difference, and the parts where they are simply ahead.

這個領域最常被拿來比的是[沈浸式翻譯](https://immersivetranslate.com/)，多數人本來就在用它。它是個好產品，有兩千萬使用者，而且有好幾件事是 ImmerseFree 根本做不到的。所以下面這張表兩邊都照實填：哪些地方差在一張訂閱單，哪些地方是人家就是比較強。

**Where the difference is a subscription｜差在一張訂閱單的地方**

| | ImmerseFree | Immersive Translate |
|---|---|---|
| Download the subtitles as a file | Free. `.srt`, three modes: translation only, original only, or bilingual | Watching bilingual subtitles is free and unlimited; **downloading** the subtitle file is Pro/Max only |
| Scanned-PDF OCR | Free. Runs on your own machine via Windows OCR or macOS Vision. No page cap | "PDF Pro" is Pro/Max only, 1,000 pages per month. The free tier handles standard, non-scanned PDFs only |
| Glossary applied to AI translation | Free. 536 preset terms in three domains, plus your own | The AI glossary does not apply in the free built-in AI translation mode |
| Custom translation prompt | Free | Not available in the free built-in AI translation mode |
| Frontier models (Claude, GPT, Gemini Pro) | Whatever your own account or API key allows | Max plan — NT$599/month, or NT$7,188/year |
| Daily request limit | None from ImmerseFree; only your engine's own quota applies | The free tier has a daily cap on translation requests |
| Moving settings between computers | Free, by settings file export and import | Cross-device settings sync is a Pro/Max feature |

| | ImmerseFree | 沈浸式翻譯 |
|---|---|---|
| 把字幕存成檔案 | 免費。`.srt` 三種模式：只要譯文、只要原文、雙語 | 「看」雙語字幕免費且不限次數；**下載**字幕檔是 Pro／Max 專屬 |
| 掃描 PDF 的 OCR | 免費。用你電腦上的 Windows OCR 或 macOS Vision 跑，沒有頁數上限 | 「PDF Pro」是 Pro／Max 專屬，每月 1,000 頁；免費版只支援非掃描的一般 PDF |
| 術語表套用到 AI 翻譯 | 免費。內建 536 條三領域術語，另可自訂 | 免費版內建的「免費 AI 翻譯模式」不支援 AI 術語庫 |
| 自訂翻譯提示詞 | 免費 | 免費版內建的「免費 AI 翻譯模式」不支援 |
| 頂級模型（Claude、GPT、Gemini Pro） | 你自己的帳號或金鑰能用到哪就用到哪 | Max 方案——每月 NT$599，年繳 NT$7,188 |
| 每日請求上限 | ImmerseFree 不設限，只受你自己引擎的額度限制 | 免費版單日翻譯請求設有上限 |
| 把設定搬到另一台電腦 | 免費，用設定檔匯出匯入 | 跨裝置同步設定是 Pro／Max 功能 |

**Where Immersive Translate is ahead｜沈浸式翻譯比較強的地方**

| | ImmerseFree | Immersive Translate |
|---|---|---|
| Video platforms | Three: YouTube (AI subtitles), Netflix and Disney+ (dual official tracks) | Their docs say 50+, their home page says over 100 |
| Installing it | Manual **Load unpacked** in every browser profile; Safari needs Xcode and your own signing team | One click from the Chrome, Edge, Firefox, and Safari stores |
| Phones and tablets | None. Desktop only | iOS and Android apps |
| Firefox | Not supported | Supported |
| Document formats it reads | EPUB and PDF | PDF, ePub, HTML, JSON, TXT, DOCX, Markdown, and subtitle files |
| Layout-preserving PDF translation | No. The bilingual PDF is a rebuilt document, not the original layout | BabelDOC layout-preserving translation, on every plan including free |
| Manga, images, live streams, meetings | None of them | All of them |
| Compliance certifications | None. It is one student's open-source project | ISO 27001 and ISO 27701 |

| | ImmerseFree | 沈浸式翻譯 |
|---|---|---|
| 影音平台 | 三個：YouTube（AI 字幕）、Netflix 與 Disney+（官方雙軌） | 官方文件寫 50+，首頁寫超過 100 個 |
| 怎麼安裝 | 每個瀏覽器設定檔都要手動「載入未封裝項目」；Safari 還需要 Xcode 與你自己的簽署 Team | Chrome、Edge、Firefox、Safari 商店一鍵安裝 |
| 手機平板 | 沒有，只有桌機 | 有 iOS 與 Android App |
| Firefox | 不支援 | 支援 |
| 讀得進去的文件格式 | EPUB 與 PDF | PDF、ePub、HTML、JSON、TXT、DOCX、Markdown 與字幕檔 |
| 保留排版的 PDF 翻譯 | 沒有。雙語 PDF 是重新排出來的文件，不是原版面 | BabelDOC 保留排版翻譯，含免費版在內所有方案都有 |
| 漫畫、圖片、直播、會議翻譯 | 都沒有 | 都有 |
| 合規認證 | 沒有。這是一個學生的開源專案 | ISO 27001 與 ISO 27701 |

Pricing and feature rows for Immersive Translate were read from [their pricing page](https://immersivetranslate.com/zh-TW/pricing/), [their documentation](https://immersivetranslate.com/docs/), and their home page on **2026-09-04**. Their Pro plan was NT$229/month or NT$2,748/year and Max was NT$599/month or NT$7,188/year at that time; regional pricing may differ. Both products change, so treat the published pages as the current source of truth rather than this table.

沈浸式翻譯的價格與功能欄位，是 **2026-09-04** 從[他們的定價頁](https://immersivetranslate.com/zh-TW/pricing/)、[官方文件](https://immersivetranslate.com/docs/)與首頁讀到的。當時 Pro 是每月 NT$229 或年繳 NT$2,748，Max 是每月 NT$599 或年繳 NT$7,188；不同地區的定價可能不同。兩邊的產品都會改版，請以雙方官網公開資訊為準，不要以這張表為準。

## Netflix and Disney+: subtitles that cost nothing to translate｜Netflix 與 Disney+：翻譯成本為零的字幕

Most translators treat a Netflix episode the same way they treat a blog post: read the text, send it to a model, wait, paint the result. That is a strange thing to do, because the episode already ships with the answer.

多數翻譯工具處理一集 Netflix 的方式，跟處理一篇部落格文章一樣：讀出文字、送給模型、等、把結果畫上去。這其實很奇怪，因為那一集本來就已經附了答案。

A streaming manifest lists **every** subtitle language at once. The player just mounts one of them at a time. ImmerseFree goes and fetches the one you did not pick, and draws it under the one you did. That means: no model call, no API key needed, no quota consumed, nothing to wait for — and the second line is the distributor's own professional translation, not a machine's guess at it. The timecodes come from the same official file, so the two lines are locked together frame for frame; there is no drift to correct.

串流平台的播放清單裡本來就同時列著**所有**語言的字幕，播放器只是一次掛一條。ImmerseFree 把你沒選到的那一條抓下來，疊在你選的那條底下。所以：不呼叫模型、不需要 API key、不吃額度、不用等——而且第二行是片商自己的專業翻譯，不是機器猜出來的。時間碼出自同一份官方檔案，兩行是鎖在一起的，不會有需要校正的漂移。

It tries three routes in order and uses whichever works: the subtitle tracks the player already mounted on the `<video>` element, then the HLS or DASH playlist it intercepted (parsed, then the full track fetched), then the subtitle file URL the player itself already requested. Disney+ draws its subtitles inside shadow DOM, where an ordinary `querySelectorAll` cannot reach, so ImmerseFree walks the shadow trees too — without that, its player looks like it has no subtitles at all.

它會依序試三條路，哪條通就用哪條：播放器已經掛在 `<video>` 上的字幕軌、攔截到的 HLS 或 DASH 播放清單（解析後抓完整份），以及播放器自己已經抓過的字幕檔網址。Disney+ 把字幕畫在 shadow DOM 裡，一般的 `querySelectorAll` 穿不進去，所以 ImmerseFree 連 shadow 樹一起走——沒有這層，它的播放器從外面看就像完全沒有字幕。

One nice detail: if the subtitle you selected in the player is already in your target language, a second Chinese line would be pointless, so ImmerseFree switches the second line to your fallback language instead. It decides this from the text actually on screen, not from the player's settings, which are often stale.

一個小地方：如果你在播放器裡選的字幕本來就是你的目標語言，再疊一行同語言沒有意義，這時 ImmerseFree 會改配你設定的備援語言。判斷依據是畫面上實際顯示的那行字，不是播放器的設定值——設定值常常是舊的。

**The limit, plainly stated.** This only works when that title actually carries a second subtitle track in the language you want. Licensing varies by region and by title, so some things will not have it. When there is no official track, that is what the AI subtitle path below is for. Dual subtitles cover Netflix and Disney+ only; the two modes are mutually exclusive and switching one on stops the other.

**限制，直說。** 這只有在那部片真的附了你要的語言那條字幕軌時才成立。授權因地區與片單而異，有些片就是沒有。沒有官方軌的時候，就是下面那條 AI 字幕路線要處理的事。雙軌字幕只支援 Netflix 與 Disney+；兩種模式互斥，開一個就會關掉另一個。

Defined in `Extension/content/dual-subtitle.js` and `Extension/core/streaming-subtitle-core.js`.

實作在 `Extension/content/dual-subtitle.js` 與 `Extension/core/streaming-subtitle-core.js`。

## AI subtitles: three steps before the model ever sees a word｜AI 字幕：模型看到字之前的三道工

On YouTube there is usually no second official track, so the translation has to be generated. How good it turns out depends mostly on what happens *before* the model is called. ImmerseFree does three things first, each aimed at a specific way that sending raw captions straight to a model goes wrong.

在 YouTube 上通常沒有第二條官方軌，譯文得自己生。而譯得好不好，多半取決於呼叫模型**之前**做了什麼。ImmerseFree 在那之前做三件事，各自對應「照原樣送翻」會壞掉的一種情況。

### Step 1 — Put the sentence back together｜第一步：先把句子接回來

A player cuts captions to a reading rhythm, not to meaning. `"I think"` appears, then `"we should leave now."` Send those to a model one at a time and you have handed it two fragments and asked for a translation of each. Other tools do exactly that. ImmerseFree merges the fragments back into whole sentences first, and translates a sentence at a time; every fragment in the group then displays the same complete translation, so you see the whole sentence no matter which piece is on screen.

播放器切字幕是照閱讀節奏切的，不是照語意切。畫面先出現 `"I think"`，再出現 `"we should leave now."`。把這兩片分別送給模型，等於丟給它兩個半句叫它各翻一次。別的工具就是這樣做的。ImmerseFree 會先把碎片接回完整句子，以「一句」為單位送翻；組內每一片字幕接著都顯示同一句完整譯文，所以不管播到哪一片，你看到的都是整句。

The merge rules are all real constants you can go read: a gap of more than **400 ms** between cues means someone else started talking or the scene changed, so it becomes a new sentence; a merged group is capped at **7 seconds** and **160 characters** so a subtitle never freezes on screen or arrives at the model as a wall of text. Sentence ends are detected from punctuation, with closing quotes and brackets stripped first — `He left."` ends on the period, not the quote mark — and with an abbreviation list so `Mr.`, `e.g.`, `a.m.` and `Ph.D` do not chop a sentence in half. Words that are commonly both an abbreviation and an ordinary word, like `no.` and `co.`, are deliberately left out of that list, because including them would cause the opposite error.

合併的判準全是你可以自己去讀的實際常數：前後字幕間隔超過 **400 毫秒**，代表換人講或換場景，就算兩句；一組合併後上限是 **7 秒**與 **160 個字元**，字幕才不會卡在畫面上不動，也不會變成一大塊文字丟給模型。句尾靠標點判斷，而且會先把結尾的引號、括號剝掉——`He left."` 的句尾是句點不是引號——另外配一張縮寫表，讓 `Mr.`、`e.g.`、`a.m.`、`Ph.D` 不會把一句話硬切成兩句。像 `no.`、`co.` 這種同時也是常用單字的，刻意不收進表裡，收了會反過來製造相反的錯誤。

Rules and constants: `Extension/core/subtitle-merge-core.js`.

規則與常數：`Extension/core/subtitle-merge-core.js`。

### Step 2 — Tell the model what it is watching｜第二步：告訴模型它在看什麼

A sentence with no context is a guessing game. `"He's clean."` means one thing in a crime drama and another in a documentary about water. So each batch of **12 subtitle sentences** goes out with three layers of context attached:

沒有上下文的句子只能用猜的。`"He's clean."` 在犯罪影集裡跟在一部講水質的紀錄片裡，是兩個意思。所以每一批 **12 句字幕**送出去時，都帶著三層上下文：

- **The video layer** — title, channel, description, source and target language. Fields that cannot be read are left out entirely rather than sent as empty strings, because an empty string tells the model "this video has no channel", which is worse than saying nothing.
- **The glossary layer** — only the terms that actually appear in this batch, not the whole glossary.
- **The dialogue layer** — the last 8 completed sentences as bilingual pairs, roughly 30 to 60 seconds of conversation, so pronouns and callbacks still resolve.

- **影片層**——標題、頻道、描述、原文與目標語言。讀不到的欄位整個省略，不會塞空字串進去，因為空字串等於告訴模型「這支影片沒有頻道」，那比不寫更糟。
- **術語層**——只帶這一批裡真的出現的術語，不是整本術語表。
- **對話層**——最近 8 句已完成的句子，以雙語對的形式帶上，大約是 30 到 60 秒的對話，代名詞和前面提過的東西才接得起來。

There is a fourth thing riding along in the same prompt: a short-sentence flag. If a line is on screen for under **1.2 seconds**, or would need to be read at more than **20 characters per second**, the model is asked to keep that particular translation short. This costs no extra API call — it travels with the batch that was going out anyway.

同一個 prompt 裡還搭了第四樣東西：極短句標記。如果某一行在畫面上停留不到 **1.2 秒**，或算下來要用每秒超過 **20 個字元**的速度才讀得完，就會請模型把那一句的譯文壓短。這不會多花一次 API 呼叫——它跟著本來就要送出去的那一批一起走。

Layers: `Extension/core/subtitle-context-core.js`. Batch size: `Extension/core/batch-core.js`.

三層在 `Extension/core/subtitle-context-core.js`，批次大小在 `Extension/core/batch-core.js`。

### Step 3 — Make it fit without covering the picture｜第三步：讓它放得下，又不擋畫面

A translated line is usually longer than the original, and a subtitle that grows into a three-line block is a subtitle that is now the movie. ImmerseFree measures the rendered width in the browser and handles it in that order: keep it on one line; if it overflows, shrink the font, down to **65%** of its size on YouTube (**72%** on Netflix and Disney+, where the player's own type is smaller to begin with); and only if it still does not fit, fall back to two lines at the original size. Line breaks are placed at punctuation and at English word boundaries, roughly 14 to 18 full-width characters a line, never more than two lines.

譯文通常比原文長，而一條字幕如果脹成三行，它就從字幕變成主角了。ImmerseFree 會在瀏覽器裡實測算出來的寬度，然後照這個順序處理：先維持一行；放不下就縮字級，YouTube 最低縮到原本的 **65%**（Netflix 與 Disney+ 是 **72%**，因為播放器本身的字就比較小）；縮到底還是放不下，才退回兩行，而且字級維持原大小。斷行點挑在標點與英文詞界，一行大約 14 到 18 個全形字，最多兩行。

**Why not just let the model break the lines?** Because it is asked to return structured JSON containing a batch of translations. A newline the model inserts on its own is both unreliable — it does not know how wide your player is, or what font size you are running — and actively dangerous, since a stray line break inside a JSON string is how a whole batch comes back unparseable and the entire block of subtitles disappears. Where to break a line depends on how wide things actually are on screen, and only the browser knows that, so the browser is where it gets decided.

**為什麼不乾脆讓模型自己斷行？** 因為模型被要求回傳的是一批譯文組成的結構化 JSON。模型自己插的換行，一來不可靠——它不知道你的播放器多寬、你的字級開多大；二來實際上很危險，因為 JSON 字串裡跑出一個換行，整批就會解不出來，那一段字幕會整塊消失。要斷在哪裡得先知道實際有多寬，而只有瀏覽器知道真正的像素寬度，所以這件事在瀏覽器裡算。

Sizing and fallback: `Extension/core/youtube-subtitle-core.js` and `Extension/core/streaming-subtitle-core.js`. Line breaking: `Extension/core/subtitle-linebreak-core.js`.

字級與退回邏輯在 `Extension/core/youtube-subtitle-core.js` 與 `Extension/core/streaming-subtitle-core.js`，斷行器在 `Extension/core/subtitle-linebreak-core.js`。

## Twelve bilingual themes｜十二種雙語主題

How the translation looks is personal, and one default cannot suit everyone. Pick one in **Options → Bilingual display**:

譯文長什麼樣是各人喜好，一個預設值滿足不了所有人。到 **選項 → 雙語顯示** 挑一個：

| Theme | How the translation is marked | 主題 | 譯文怎麼標示 |
|---|---|---|---|
| `classic` | A subtle left border. The default | 經典邊線 | 低調的左側線條，預設值 |
| `underline` | A thin solid underline | 底線 | 細的實線底線 |
| `dashed` | A dashed underline | 虛線 | 虛線底線 |
| `wavy` | A wavy underline | 波浪線 | 波浪底線 |
| `highlight` | Highlighter pen, wrapping cleanly across line ends | 高亮 | 螢光筆，跨行時斷得乾淨 |
| `quote` | A pull-quote block: left rule plus a tinted background | 引用塊 | 引言區塊：左側粗線加淡色底 |
| `faded` | The translation at 62% opacity, so the original leads | 弱化 | 譯文透明度 62%，讓原文當主角 |
| `italic` | Italic | 斜體 | 斜體 |
| `bold` | Bold | 粗體 | 粗體 |
| `card` | A rounded card with one light shadow | 紙片 | 圓角小卡，配一層淡陰影 |
| `divider` | A hairline rule above the translation | 分隔線 | 譯文上方一條細分隔線 |
| `plain` | No decoration at all, just the text | 無裝飾 | 一點裝飾都沒有，只有文字 |

The options page previews all twelve at once, and each preview is rendered by the same `content.css` that styles real pages — there is no "looks different once you actually use it" gap. Switching a theme restyles pages you have already translated, immediately; you do not retranslate anything to change how it looks.

選項頁會一次預覽十二種，而且每一格預覽吃的就是實際套在網頁上的那份 `content.css`——不存在「預覽好看、實際不一樣」的落差。換主題會立刻替已經翻好的頁面換裝，不需要為了改外觀重翻任何東西。

Dark mode is handled where it matters rather than everywhere. Only the three themes that carry a colour of their own — `highlight`, `quote`, and `card` — get repainted for dark backgrounds. The other nine derive their decoration from `currentColor`, so they follow whatever the page's own text colour is and are correct on a dark site without any special case. Translated text also carries CJK typography that Latin-only styling misses: 1.7 line height, punctuation trimming at line starts, and automatic spacing between CJK and Latin runs.

深色模式只在真正需要的地方處理，不是全部一起改。只有三種自帶顏色的主題——`highlight`、`quote`、`card`——會為深色背景重新配色。另外九種的裝飾色都是從 `currentColor` 混出來的，會自動跟著頁面自己的文字顏色走，在深色網站上不需要特例就是對的。譯文另外套了純拉丁字排版會忽略的中日韓細節：行高 1.7、行首標點擠壓，以及中西文之間自動留白。

Theme ids live in `Extension/core/settings-core.js` (`THEME_IDS`); the styles are in `Extension/content/content.css`.

主題 id 定義在 `Extension/core/settings-core.js` 的 `THEME_IDS`，樣式在 `Extension/content/content.css`。

## Why your text stays yours｜為什麼你的內容還是你的

There is no ImmerseFree account, no ImmerseFree server, and no telemetry endpoint. The extension talks to exactly two kinds of destination: the translation engine you picked, and a helper service running on your own machine. Everything below follows from that.

沒有 ImmerseFree 帳號、沒有 ImmerseFree 伺服器、也沒有回傳統計的端點。擴充功能只跟兩種對象講話：你選的翻譯引擎，以及跑在你自己電腦上的協助服務。下面每一條都是從這件事來的。

- **Nothing routes through the author.** Gemini and custom endpoints are called by your browser directly. The manifest's `host_permissions` lists only `generativelanguage.googleapis.com`, `opencode.ai`, and localhost — there is no author-owned domain in it for traffic to pass through, and you can verify that in one look at `Extension/manifest.json`.
- **The local Bridge is bound to `127.0.0.1`**, not `0.0.0.0`, so nothing on your network can reach it. The host is hardcoded and cannot be changed by configuration.
- **The Bridge only answers the extension.** Every endpoint beyond a minimal health check requires an allowed origin and returns `403` otherwise, and the Chrome origin is an exact-match check against one pinned extension ID. Translation and OCR POSTs additionally require an ImmerseFree request header.
- **Keys stay in your browser profile.** They are written to `chrome.storage.local` and never synced to any cloud account.
- **No key ships with anything.** There is no bundled, trial, or fallback credential anywhere in the repository or the installer, and `npm run verify` scans for committed-secret patterns on every run.

- **不會繞經作者。** Gemini 與自訂端點是由你的瀏覽器直接呼叫。manifest 的 `host_permissions` 只列了 `generativelanguage.googleapis.com`、`opencode.ai` 與 localhost——裡面沒有任何作者擁有的網域可以讓流量經過，你打開 `Extension/manifest.json` 看一眼就能確認。
- **本機 Bridge 綁在 `127.0.0.1`**，不是 `0.0.0.0`，所以同網路上的其他機器碰不到它。這個位址寫死在程式碼裡，不能用設定改掉。
- **Bridge 只回應擴充功能。** 除了最小的健康檢查之外，每個端點都要求通過允許的 origin，否則回 `403`；Chrome 那一側是拿一個釘死的擴充功能 ID 做全等比對。翻譯與 OCR 的 POST 請求還另外要求 ImmerseFree 的 request header。
- **金鑰留在你的瀏覽器設定檔裡。** 它們寫進 `chrome.storage.local`，不會同步到任何雲端帳號。
- **任何東西都不附金鑰。** repository 與安裝包裡沒有預埋、試用或備援憑證，而且 `npm run verify` 每次執行都會掃描誤提交的 secret 樣式。

Two things this does **not** claim. Local storage is not encrypted, so anyone who can read your browser profile can read the keys — use a dedicated, restricted, low-quota key. And the Safari origin check can only validate the scheme, because Safari assigns a different extension UUID on every machine; that residual gap is written down in the source rather than glossed over. Both of those are things you can go and check in the code, which is the practical benefit of it being open.

有兩件事這裡**沒有**宣稱。本機儲存空間沒有加密，能讀你瀏覽器設定檔的人就讀得到金鑰——請用專用、受限制、低額度的 key。另外 Safari 那一側的 origin 檢查只能驗到 scheme，因為 Safari 在每一台機器上指派的擴充功能 UUID 都不同；這個殘餘缺口是寫在原始碼裡的，沒有被含糊帶過。這兩件事你都可以自己進程式碼裡查，這是開源實際上的好處。

## Support the developer｜支持開發者

I am a university student. The biggest burden of maintaining open-source projects like ImmerseFree is the cost of software and AI subscriptions. If you would like to support the project, you can make a small contribution through [Buy Me a Coffee](https://buymeacoffee.com/chang416). Contributions are optional and do not unlock extra features.

我是一名大學生。對我來說，維護 ImmerseFree 這類開源專案最大的負擔，是軟體與 AI 服務昂貴的訂閱費。如果你願意支持這個專案，可以透過 [Buy Me a Coffee](https://buymeacoffee.com/chang416) 小額贊助。贊助完全自願，也不會解鎖額外功能。

## Choose a translation engine｜選擇翻譯引擎

Open the browser's Extensions menu, pin ImmerseFree, click its icon, and choose an engine and model. Open **Options** when you need to add an API key or change advanced settings.

打開瀏覽器的「擴充功能」選單，把 ImmerseFree 釘選到工具列，按下它的圖示後選擇翻譯引擎與模型。需要加入 API key 或調整進階設定時，請打開 **選項**。

### Option A — Google Antigravity CLI (`agy`)｜選項 A — Google Antigravity CLI (`agy`)

This is the default local CLI engine. ImmerseFree calls the CLI through a Bridge bound to `127.0.0.1`; the browser extension never receives your Google login token. Usage counts against the quota of the Google account or Gemini API key configured in Antigravity.

這是預設的本機 CLI 引擎。ImmerseFree 會透過只綁定 `127.0.0.1` 的 Bridge 呼叫 CLI；瀏覽器擴充功能不會取得你的 Google 登入 token。用量會計入你在 Antigravity 中設定的 Google 帳號或 Gemini API key 額度。

On macOS, open Terminal and run the official installer:

在 macOS 開啟終端機，執行官方安裝指令：

```sh
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

On Windows, open Windows PowerShell and run the official installer:

在 Windows 開啟 Windows PowerShell，執行官方安裝指令：

```powershell
irm https://antigravity.google/cli/install.ps1 | iex
```

After installation, run `agy`. If no session is saved in the operating system keyring, the CLI opens the browser for Google sign-in. Finish the sign-in, return to the terminal, then run `agy models` to confirm that models are available. Finally, rerun the ImmerseFree installer so its login service can find the new CLI path.

安裝後執行 `agy`。如果作業系統鑰匙圈裡沒有既有 session，CLI 會開啟瀏覽器要求你登入 Google。完成登入並回到終端機後，執行 `agy models`，確認看得到可用模型。最後重新執行 ImmerseFree 安裝程式，讓登入啟動的服務能找到新的 CLI 路徑。

Official references: [Antigravity CLI installation and authentication](https://antigravity.google/docs/cli/install/) and [headless mode](https://antigravity.google/docs/cli/headless/).

官方參考資料：[Antigravity CLI 安裝與驗證](https://antigravity.google/docs/cli/install/)與[無介面模式](https://antigravity.google/docs/cli/headless/)。

### Option B — OpenCode CLI｜選項 B — OpenCode CLI

The local OpenCode route requires the `opencode` executable even when the API-key field in ImmerseFree is empty. OpenCode's free-model roster can change and some free models are explicitly time-limited, so do not rely on one permanent model ID.

本機 OpenCode 路線即使在 ImmerseFree 裡沒有填 API key，也仍然需要安裝 `opencode` 執行檔。OpenCode 的免費模型清單可能改變，而且部分免費模型明確標示為限時提供，因此不要依賴某個永久固定的模型 ID。

On macOS, use the official quick installer or Homebrew:

在 macOS 可使用官方快速安裝程式或 Homebrew：

```sh
curl -fsSL https://opencode.ai/install | bash
# or
brew install anomalyco/tap/opencode
```

On Windows, the native npm or Scoop installation works with ImmerseFree's Bridge:

在 Windows，原生 npm 或 Scoop 安裝方式可搭配 ImmerseFree Bridge：

```powershell
npm install -g opencode-ai
# or
scoop install opencode
```

Run `opencode`, enter `/connect`, select **OpenCode Zen**, complete the sign-in at `opencode.ai/auth`, and paste the API key when requested. Then rerun the ImmerseFree installer and choose **OpenCode** in the extension popup.

執行 `opencode`，輸入 `/connect`，選擇 **OpenCode Zen**，到 `opencode.ai/auth` 完成登入，並在提示時貼上 API key。接著重新執行 ImmerseFree 安裝程式，最後在擴充功能彈出視窗選擇 **OpenCode**。

Official references: [OpenCode installation](https://opencode.ai/docs/#install), [provider authentication](https://opencode.ai/docs/providers/#opencode-zen), and [Zen models and pricing](https://opencode.ai/docs/zen/).

官方參考資料：[OpenCode 安裝](https://opencode.ai/docs/#install)、[服務驗證](https://opencode.ai/docs/providers/#opencode-zen)，以及 [Zen 模型與價格](https://opencode.ai/docs/zen/)。

### Option C — Gemini API key｜選項 C — Gemini API key

1. Open [Google AI Studio](https://aistudio.google.com/apikey) and create a dedicated Gemini API key.
2. Open ImmerseFree **Options**, select **Gemini API**, paste one or more keys, choose a model, and click **Save settings**.
3. If you enter several keys separated by new lines, commas, spaces, or semicolons, ImmerseFree de-duplicates and rotates them automatically when a key is rate-limited.

1. 打開 [Google AI Studio](https://aistudio.google.com/apikey)，建立一把專門給 Gemini 使用的 API key。
2. 打開 ImmerseFree **選項**，選擇 **Gemini API**，貼上一把或多把 key，選擇模型後按 **儲存設定**。
3. 多把 key 可用換行、逗號、空格或分號分隔；ImmerseFree 會自動去除重複項目，並在某把 key 遇到速率限制時輪替。

Use a dedicated, restricted, low-quota key. The key is stored in browser local storage, which is not encrypted, and a settings export contains the key in plaintext. Anyone who can inspect your browser profile or read the export file may obtain it. Never commit a key or exported settings file to GitHub. Revoke and rotate an exposed key immediately.

請使用專用、受限制、低額度的 key。key 會儲存在瀏覽器的本機儲存空間中，而該空間沒有加密；匯出的設定檔也會以明文包含 key。能查看你的瀏覽器設定檔或讀取匯出檔的人，就可能取得它。絕對不要把 key 或設定匯出檔提交到 GitHub。若 key 外洩，請立即撤銷並輪替。

See Google's [Gemini API key security guidance](https://ai.google.dev/gemini-api/docs/api-key#security) and [API key restrictions](https://docs.cloud.google.com/docs/authentication/api-keys#api_key_restrictions).

請參考 Google 的 [Gemini API key 安全指引](https://ai.google.dev/gemini-api/docs/api-key#security)與 [API key 限制設定](https://docs.cloud.google.com/docs/authentication/api-keys#api_key_restrictions)。

### Option D — Custom OpenAI-compatible API｜選項 D — 自訂 OpenAI 相容 API

Open ImmerseFree **Options**, choose **Custom API**, enter a base URL such as `https://api.openai.com/v1`, enter the API key if the endpoint requires one, and click **Fetch models**. Select a returned model and save. The endpoint must implement `GET /models` and `POST /chat/completions`. OpenAI, Groq, Together, OpenRouter, DeepSeek, Ollama, and LM Studio can work when configured with a compatible endpoint.

打開 ImmerseFree **選項**，選擇 **自訂 API**，輸入例如 `https://api.openai.com/v1` 的 base URL；如果端點需要驗證，再輸入 API key，接著按 **取得模型**。從回傳清單選擇模型並儲存。端點必須提供 `GET /models` 與 `POST /chat/completions`。只要端點相容，OpenAI、Groq、Together、OpenRouter、DeepSeek、Ollama 與 LM Studio 都可使用。

Use HTTPS for remote endpoints. Reserve `http://` for a local service you explicitly trust, such as Ollama or LM Studio on your own computer. The browser may ask you to approve access to the custom host; approve only the exact host you entered.

遠端端點請使用 HTTPS。`http://` 只應用在你明確信任的本機服務，例如自己電腦上的 Ollama 或 LM Studio。瀏覽器可能會要求允許存取自訂主機；請只核准你親自輸入的那個主機。

## How to use it｜如何使用

### Translate a whole page｜翻譯整個網頁

Open a normal `http://` or `https://` page, click the ImmerseFree toolbar icon, choose the engine/model, and click **Translate page**. Click the same action again to remove the inserted translations. `Alt + Shift + B` (`Control + Shift + B` on macOS) does the same thing without opening the popup.

打開一般的 `http://` 或 `https://` 網頁，按工具列上的 ImmerseFree 圖示，選擇引擎／模型，再按 **翻譯網頁**。再次執行相同動作即可移除插入的譯文。按 `Alt + Shift + B`（macOS 是 `Control + Shift + B`）可以不開彈出視窗直接做同一件事。

Choose how the translation looks in **Options → Bilingual display**: 12 themes, from a classic left border to underline, highlight, card, or plain — all twelve are listed and described in the **Twelve bilingual themes** section above. Switching a theme restyles pages you have already translated, immediately. **Translation-only** mode hides the original and shows only the translation, and you can switch back at any time; the original paragraphs are only hidden, never removed from the page, so nothing a site's own scripts depend on gets broken.

在 **選項 → 雙語顯示** 選擇譯文的長相：12 種主題，從經典左側邊線到底線、螢光、卡片、無樣式都有——十二種在上面的**十二種雙語主題**那一節有逐一列名與說明。換主題會立刻替已經翻好的頁面換裝。**僅譯文** 模式會隱藏原文只顯示譯文，隨時可以切回來；原文段落只是被隱藏，節點不會從頁面上拆掉，所以網站自己的腳本依賴的東西不會被弄壞。

If you would rather not open the popup every time, turn on the floating ball. It sits at the edge of the page, snaps back when you drag it, translates the page when clicked, and its menu offers translate, restore, translation-only／bilingual, and hide.

如果不想每次都開彈出視窗，可以打開懸浮球。它會停在頁面邊緣，拖曳後會自動貼回邊上，點一下就翻譯整頁，選單則有翻譯、還原、僅譯文／雙語切換、收起。

### Translate selected text or a paragraph｜翻譯反白文字或段落

Select text and release the mouse to show a translation card. `Alt + Shift + T` translates the current selection without the mouse. To use hover translation, enable it in Options and rest the pointer on a paragraph for about 0.7 seconds.

反白選取文字並放開滑鼠後會顯示翻譯卡片。按 `Alt + Shift + T` 可以不用滑鼠直接翻譯目前選取的文字。若要使用懸停翻譯，請先在「選項」中啟用，接著把游標停在段落上約 0.7 秒。

Select a **single word** and the card becomes a dictionary entry instead of a bare translation: pronunciation, parts of speech, each sense listed separately, and a usage note. Copying the card copies the whole entry, not only the translated word.

反白**單一單字**時，卡片會變成詞典條目，而不只是一句翻譯：音標、詞性、分項列出的釋義，以及用法說明。複製時會複製整張卡，不是只有那個譯詞。

### Translate an input field｜翻譯輸入欄位

Type in a supported text field and press Space three times. ImmerseFree replaces the current text with its translation. Password, email, number, URL, and telephone fields are excluded.

在支援的文字欄位輸入內容後，連按三次空白鍵。ImmerseFree 會用譯文取代目前文字。密碼、Email、數字、網址與電話欄位不會套用。

### Translate video subtitles｜翻譯影片字幕

On YouTube, open the ImmerseFree popup and turn on **AI subtitles**, or press `Alt + Shift + A`. ImmerseFree enables the video's captions by itself and draws its own translated line under the original. What happens between those two steps is the interesting part — see the **AI subtitles** section above.

在 YouTube 上打開 ImmerseFree 彈出視窗，開啟 **AI 字幕**，或按 `Alt + Shift + A`。ImmerseFree 會自動把影片字幕打開，並在原文下方畫出自己的譯文行。這兩步之間發生的事才是重點——見上面的 **AI 字幕** 那一節。

On Netflix and Disney+, turn on **Dual subtitles**, or press `Alt + Shift + D`. These services already carry several subtitle tracks, so ImmerseFree fetches the one you did not pick and shows it under the one you did — no model, no quota, no waiting, and the second line is the distributor's own translation. The **Netflix and Disney+** section above explains how it finds that track.

在 Netflix 與 Disney+ 上，開啟 **雙軌字幕**，或按 `Alt + Shift + D`。這兩個平台本來就附了多條字幕軌，ImmerseFree 會把你沒選到的那條抓下來，疊在你選的那條底下——不用模型、不吃額度、不用等，而且第二行是片商自己的翻譯。上面的 **Netflix 與 Disney+** 那一節有說明它是怎麼找到那條軌的。

To keep a proper noun consistent for a whole season, open the popup's glossary and pin its translation. To take the subtitles with you, use **Export SRT** and choose translation only, original only, or bilingual — a file on your disk, at no charge, which is the one subtitle feature Immersive Translate reserves for its paid tiers.

想讓某個專有名詞在整季裡譯法一致，就到彈出視窗的術語表把它的譯法釘起來。想把字幕帶走，用 **匯出 SRT**，可選只要譯文、只要原文，或雙語——存成檔案放進你自己的硬碟，不用錢；而字幕檔下載正是沈浸式翻譯留給付費方案的那一項。

**Episode study** turns the current episode's subtitles into vocabulary and sentence-pattern notes. Enter a TOEIC, IELTS, or GEPT score — or say you are a complete beginner — and ImmerseFree maps it onto the six CEFR levels (A1 to C2, the standard European language-ability scale, where A1 is beginner and C2 is near-native) and writes the notes at that level.

**影集學習** 會把目前這一集的字幕整理成單字與句型教材。輸入多益、雅思或全民英檢分數，或直接說你是純新手，ImmerseFree 會換算成 CEFR 六個等級（A1 到 C2，歐洲通用的語言能力量表，A1 是入門、C2 接近母語者），再照那個程度出教材。

### Translate an EPUB or export to Word｜翻譯 EPUB 或匯出 Word

Open the popup and choose **EPUB**, then pick the file. ImmerseFree opens it in a built-in bilingual reader and inserts the translation after each original block. From there you can save a `<name>.bilingual.epub` that opens in any e-reader, or export the same result as a Word `.docx`.

打開彈出視窗選 **EPUB**，再選檔案。ImmerseFree 會用內建的雙語閱讀器打開它，在每個原文區塊後插入譯文。接著可以輸出 `<原名>.bilingual.epub`（任何電子書閱讀器都打得開），或把同一份結果輸出成 Word 的 `.docx`。

Books longer than 500 blocks ask for confirmation first, because that means a lot of model calls. Word export writes plain-text paragraphs with four named styles; bold, links, and the original heading hierarchy are not carried across, so use EPUB or PDF export when formatting matters.

超過 500 個區塊的書會先跳出確認，因為那代表很多次模型呼叫。Word 匯出寫出來的是純文字段落配四個自訂樣式，不會保留粗體、連結與原本的標題層級；在意排版就改用 EPUB 或 PDF 匯出。

### Translate a PDF｜翻譯 PDF

Open a PDF in the browser, open the ImmerseFree popup, and start PDF translation. Normal PDFs use their text layer. Scanned pages use the local Windows OCR or macOS Vision helper when available. Password-protected, damaged, or non-PDF responses cannot be read.

在瀏覽器中開啟 PDF，打開 ImmerseFree 彈出視窗並開始 PDF 翻譯。一般 PDF 會使用內建文字層；掃描頁面則在可用時使用本機 Windows OCR 或 macOS Vision 元件。受密碼保護、已損壞，或連結實際沒有回傳 PDF 的檔案無法讀取。

The reader has a translation-only toggle, and you can save the result as a bilingual PDF or as a Word `.docx`.

閱讀器有「只看譯文」的切換，結果也可以輸出成雙語 PDF 或 Word 的 `.docx`。

Scanned pages are worth calling out. Reading a scanned PDF means OCR, and OCR is where translation products usually start charging: Immersive Translate puts scanned documents in "PDF Pro", available on Pro and Max at 1,000 pages a month, with the free tier limited to standard non-scanned files. ImmerseFree runs OCR through the recognition engine already built into your operating system — `Windows.Media.Ocr` or Apple's Vision framework — so it is free, it has no page cap, and the pages never leave your computer to be recognised. What ImmerseFree does not do is preserve the original layout the way their BabelDOC route does; the bilingual PDF it writes is a rebuilt document.

掃描頁這件事值得單獨講。要讀掃描 PDF 就得做 OCR，而 OCR 通常正是翻譯產品開始收費的地方：沈浸式翻譯把掃描文件放在「PDF Pro」，Pro 與 Max 每月 1,000 頁，免費版只能處理非掃描的一般檔案。ImmerseFree 直接用你作業系統本來就內建的辨識引擎——`Windows.Media.Ocr` 或 Apple 的 Vision framework——所以不用錢、沒有頁數上限，而且那些頁面不會離開你的電腦去給別人辨識。ImmerseFree 做不到的是像他們的 BabelDOC 那樣保留原始排版；這裡輸出的雙語 PDF 是重新排出來的文件。

For local `file://` PDFs in Chrome or Edge, open the extension details page and enable **Allow access to file URLs** if the browser asks for it.

若要在 Chrome 或 Edge 翻譯本機 `file://` PDF，請打開擴充功能詳細資料頁；如果瀏覽器要求，請啟用 **允許存取檔案網址**。

### Keep terminology consistent｜讓術語譯法一致

A glossary pins how a term must be translated, so the same word does not come back three different ways across a long article or a whole season. ImmerseFree ships 536 preset terms in three domains — technology and software, finance and investing, medicine and biotech — which you turn on per domain in Options. You can add your own terms, and pin terms to just the video you are watching.

術語表用來釘住某個詞一定要怎麼翻，這樣同一個字在一篇長文或一整季影集裡不會出現三種譯法。ImmerseFree 內建 536 條預設術語，分成科技與軟體、財經與投資、醫療與生技三類，可在選項中分類開啟。你也可以自己加，或只釘給正在看的那支影片。

Only the terms that actually occur in a sentence are sent to the model, and the translation cache is keyed on exactly those terms. So changing one term's translation retranslates the sentences it affects and leaves everything else on its cached result.

只有真的出現在句子裡的術語才會送給模型，翻譯快取也剛好以那些術語為鍵。所以改掉一個術語的譯法，只會讓受影響的句子重翻，其他句子照樣沿用快取。

The glossary works on every engine ImmerseFree supports, including the free ones. Immersive Translate's AI glossary does not apply in its own free built-in AI translation mode, which also does not take a custom prompt — so the two settings that most change how a translation reads are the two you cannot use there without paying. Here they are both in Options, on by default, at no cost.

術語表在 ImmerseFree 支援的每一種引擎上都有效，包括免費的那些。沈浸式翻譯的 AI 術語庫在它自己免費版內建的「免費 AI 翻譯模式」下不適用，那個模式同時也不吃自訂提示詞——換句話說，最能左右譯文讀起來如何的兩個設定，在那邊不付錢就碰不到。在這裡它們都在選項頁裡，預設就開著，不用錢。

### Tune a specific website｜針對特定網站調整

Some sites wrap their text in markup that a generic translator handles badly — a comment counter treated as a paragraph, a code block translated as prose. ImmerseFree ships 25 built-in site rules for common sites. In **Options → My rules** you can write your own as JSON: append `.add` to a field name to layer your entry on top of the built-in rule, `.remove` to drop specific built-in entries, or use the bare field name to replace the whole set.

有些網站的文字被包在對通用翻譯器不友善的標記裡——留言計數被當成段落、程式碼區塊被當成散文翻掉。ImmerseFree 為常見網站內建了 25 條規則。在 **選項 → 我的規則** 可以用 JSON 自己寫：欄位名後面加 `.add` 是疊加在內建規則之上，加 `.remove` 是把內建的某幾項拿掉，不加後綴就是整組換掉。

### When an engine runs out｜引擎額度用完時

Automatic failover is on by default. When an engine fails — quota exhausted, local service down, timeout, CLI unreachable — the next engine in your order takes over. Switching happens only between batches, so a single sentence is never half-translated by two engines, and one translation tries at most two extra engines before stopping. The toolbar names the engine that took over; ImmerseFree never changes engine silently.

失敗自動轉移預設是開啟的。引擎掛掉時——額度用完、本機服務沒開、逾時、CLI 連不上——就換成你排定的下一個。轉移只發生在批與批之間，同一句話不會被兩個引擎各翻一半，一次翻譯最多額外嘗試兩個引擎就停。工具列會顯示是誰接手；ImmerseFree 不會偷偷換引擎。

**Options → Diagnostics** shows the success rate per engine, a recent event log with error codes, and nine counters, which is the fastest way to tell a quota problem from a network one. Two of those counters are worth watching on video: `subtitleCues` counts the raw fragments the player produced, and `subtitleGroups` counts the whole sentences actually sent for translation. The gap between them is the merging from step 1 doing its job.

**選項 → 診斷** 會顯示每個引擎的成功率、帶錯誤碼的近期事件紀錄，以及九個計數器；要分辨這是額度問題還是網路問題，看這裡最快。看影片時有兩個計數器特別值得注意：`subtitleCues` 是播放器產出的原始碎片數，`subtitleGroups` 是真正送去翻譯的完整句數。兩者的差距，就是第一步的合併在做事的證據。

### Keyboard shortcuts｜快捷鍵

Four commands, all remappable at `chrome://extensions/shortcuts` or `edge://extensions/shortcuts` if they collide with something you already use.

四個指令，如果跟你已經在用的鍵衝突，都可以在 `chrome://extensions/shortcuts` 或 `edge://extensions/shortcuts` 改掉。

| Action | Windows | macOS | 動作 |
|---|---|---|---|
| Translate the current page | `Alt + Shift + B` | `Control + Shift + B` | 翻譯目前網頁 |
| Translate the selection | `Alt + Shift + T` | `Control + Shift + T` | 翻譯選取文字 |
| Toggle AI subtitles | `Alt + Shift + A` | `Option + Shift + A` | 開關 AI 字幕 |
| Toggle dual subtitles | `Alt + Shift + D` | `Option + Shift + D` | 開關雙軌字幕 |

The first two declare an explicit macOS binding in the manifest; the two subtitle shortcuts declare only a default, which the browser maps to Option on macOS.

前兩個在 manifest 裡有明確指定 macOS 的按鍵；兩個字幕快捷鍵只宣告了預設值，瀏覽器在 macOS 上會把它對應到 Option 鍵。

## Manual browser installation｜手動安裝瀏覽器擴充功能

### Chrome unpacked installation｜Chrome 未封裝安裝

1. Download and unzip the repository.
2. Enter `chrome://extensions` in the address bar.
3. Turn on **Developer mode** at the top right.
4. Click **Load unpacked**.
5. Select the repository's `Extension` folder—the folder that directly contains `manifest.json`.
6. After updating the source, return to this page and click the extension's **Reload** button, then refresh the website being tested.

1. 下載並解壓縮 repository。
2. 在網址列輸入 `chrome://extensions`。
3. 打開右上角的 **開發人員模式**。
4. 按 **載入未封裝項目**。
5. 選擇 repository 裡的 `Extension` 資料夾，也就是打開後會直接看到 `manifest.json` 的那一層。
6. 更新原始碼後，回到這個頁面按擴充功能卡片上的 **重新載入**，再重新整理正在測試的網站。

Official Chrome instructions: [Load an unpacked extension](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

Chrome 官方教學：[載入未封裝擴充功能](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)。

### Edge unpacked installation｜Edge 未封裝安裝

1. Download and unzip the repository.
2. Enter `edge://extensions` in the address bar, or open **Extensions → Manage extensions**.
3. Turn on **Developer mode** in the left sidebar.
4. Click **Load unpacked**.
5. Select the repository's `Extension` folder.
6. After updating the source, click **Reload** on the extension card and refresh the tested website.

1. 下載並解壓縮 repository。
2. 在網址列輸入 `edge://extensions`，或打開 **擴充功能 → 管理擴充功能**。
3. 打開左側的 **開發人員模式**。
4. 按 **載入解壓縮的擴充功能**。
5. 選擇 repository 裡的 `Extension` 資料夾。
6. 更新原始碼後，按擴充功能卡片上的 **重新載入**，再重新整理正在測試的網站。

Official Edge instructions: [Sideload an extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading).

Edge 官方教學：[側載擴充功能](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading)。

## Package and publish the extension｜封裝與上架擴充功能

### Chrome CRX for development｜Chrome 開發用 CRX

Open `chrome://extensions`, turn on **Developer mode**, and click **Pack extension**. Set **Extension root directory** to `Extension`. On the first pack, leave the private-key field empty. Chrome creates a `.crx` package and a `.pem` private key. Keep the `.pem` secret and backed up; updates to the same packed extension require the same key. Never commit it to GitHub.

打開 `chrome://extensions`，啟用 **開發人員模式**，再按 **封裝擴充功能**。把 **擴充功能根目錄** 指向 `Extension`。第一次封裝時，私密金鑰欄位留空。Chrome 會建立 `.crx` 封裝與 `.pem` 私密金鑰。請把 `.pem` 保密並妥善備份；更新同一個封裝擴充功能時需要使用同一把 key。絕對不要把它提交到 GitHub。

A locally packed CRX is for development or managed enterprise deployment. Ordinary Windows and macOS Chrome users cannot one-click install an arbitrary self-hosted CRX; public installation normally requires the Chrome Web Store.

本機封裝的 CRX 適合開發或受管理的企業部署。一般 Windows 與 macOS Chrome 使用者不能用單擊方式安裝任意自行託管的 CRX；公開安裝通常必須透過 Chrome Web Store。

### Publish to Chrome Web Store｜上架 Chrome Web Store

Each GitHub release includes a ready-to-upload [`ImmerseFree-Chromium-Web-Store.zip`](https://github.com/chang416/ImmerseFree/releases/latest/download/ImmerseFree-Chromium-Web-Store.zip). Verify its manifest key and extension ID against your Web Store item before publishing.

每個 GitHub release 都會附上可直接上傳的 [`ImmerseFree-Chromium-Web-Store.zip`](https://github.com/chang416/ImmerseFree/releases/latest/download/ImmerseFree-Chromium-Web-Store.zip)。發布前仍須把其中的 manifest key 與擴充功能 ID 對照你的 Web Store item。

1. Make a ZIP containing the **contents** of `Extension`, with `manifest.json` at the ZIP root.
2. Register a [Chrome Web Store developer account](https://chrome.google.com/webstore/devconsole/).
3. Click **New item**, upload the ZIP, and complete **Store listing**, **Privacy**, and **Distribution**.
4. Before publishing, open the item's **Package → View public key**, put that public key in the manifest `key`, reload the unpacked extension, and confirm its ID matches the Web Store Item ID.
5. If the key changes, update the allowed Chromium origin in `Bridge/server.mjs` at the same time and retest the Bridge.
6. Submit the item for review.

1. 把 `Extension` 裡面的**內容**壓成 ZIP，並確保 `manifest.json` 位於 ZIP 根目錄。
2. 註冊 [Chrome Web Store 開發者帳號](https://chrome.google.com/webstore/devconsole/)。
3. 按 **New item**，上傳 ZIP，並完成 **Store listing**、**Privacy** 與 **Distribution**。
4. 發布前，打開項目的 **Package → View public key**，把該 public key 放進 manifest 的 `key`，重新載入未封裝擴充功能，並確認它的 ID 與 Web Store Item ID 完全相同。
5. 如果 key 改變，必須同時更新 `Bridge/server.mjs` 允許的 Chromium origin，並重新測試 Bridge。
6. 送交審核。

Official references: [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish), [distribution rules](https://developer.chrome.com/docs/extensions/how-to/distribute), and [keeping a consistent extension ID](https://developer.chrome.com/docs/extensions/reference/manifest/key#keep-a-consistent-extension-id).

官方參考資料：[上架 Chrome Web Store](https://developer.chrome.com/docs/webstore/publish)、[散布規則](https://developer.chrome.com/docs/extensions/how-to/distribute)，以及[維持固定擴充功能 ID](https://developer.chrome.com/docs/extensions/reference/manifest/key#keep-a-consistent-extension-id)。

### Publish to Microsoft Edge Add-ons｜上架 Microsoft Edge Add-ons

You may upload the same release asset, [`ImmerseFree-Chromium-Web-Store.zip`](https://github.com/chang416/ImmerseFree/releases/latest/download/ImmerseFree-Chromium-Web-Store.zip), to Partner Center. Complete the Edge-ID allowlist step below before announcing the store build.

你可以把同一份 release 附件 [`ImmerseFree-Chromium-Web-Store.zip`](https://github.com/chang416/ImmerseFree/releases/latest/download/ImmerseFree-Chromium-Web-Store.zip) 上傳到 Partner Center。對外發布商店版本前，必須完成下方的 Edge ID allowlist 步驟。

1. Use the same ZIP whose root contains the Chromium `manifest.json` and extension files.
2. Register a [Microsoft Edge extension developer account](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account).
3. In Partner Center, create a new extension, upload the ZIP, and complete availability, properties, privacy, store listing, and certification notes.
4. Submit it for certification.
5. After Microsoft assigns the final Edge Add-ons extension ID, add `chrome-extension://<EDGE_ID>` to the Bridge allowlist while retaining the Chrome origin, then test the actual store-installed build. The store ID may differ from the sideloaded ID.

1. 使用同一份 ZIP，並確保 Chromium `manifest.json` 與所有擴充功能檔案都位於 ZIP 根目錄。
2. 註冊 [Microsoft Edge 擴充功能開發者帳號](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account)。
3. 在 Partner Center 建立新擴充功能、上傳 ZIP，並完成可用性、屬性、隱私、商店介紹與驗證備註。
4. 送交 certification。
5. Microsoft 指派正式 Edge Add-ons 擴充功能 ID 後，請在保留 Chrome origin 的同時，把 `chrome-extension://<EDGE_ID>` 加入 Bridge allowlist，接著實際測試從商店安裝的版本。商店 ID 可能與側載版本 ID 不同。

Official reference: [Publish a Microsoft Edge extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).

官方參考資料：[發布 Microsoft Edge 擴充功能](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)。

### Package and distribute Safari｜封裝與散布 Safari 版本

This repository already contains a converted Safari Web Extension Xcode project. For local use, run `macOS/Install or update Safari.command`; do not reconvert it every time. The script synchronizes the shared `Extension` files, builds the containing app and extension, signs with your selected Apple Development Team, installs the app, and registers the extension.

這個 repository 已經包含轉換完成的 Safari Web Extension Xcode 專案。本機使用時請執行 `macOS/Install or update Safari.command`，不需要每次重新轉換。腳本會同步共用的 `Extension` 檔案、建置 containing app 與 extension、用你選擇的 Apple Development Team 簽署、安裝 App，並註冊延伸功能。

If you intentionally recreate the Safari project from the Chromium source, use Apple's current packager on a Mac with Xcode:

只有在你刻意要從 Chromium 原始碼重新建立 Safari 專案時，才在裝有 Xcode 的 Mac 執行 Apple 目前的 packager：

```sh
xcrun safari-web-extension-packager /path/to/Extension
```

For public distribution, join the Apple Developer Program, select the correct distribution signing identities for both the containing app and extension, create an Xcode archive, and choose one route: upload through App Store Connect for Mac App Store review, or sign with Developer ID and notarize for distribution outside the Mac App Store. An Apple Development signature from the local installer is not a public distribution signature.

若要公開散布，請加入 Apple Developer Program，替 containing app 與 extension 選擇正確的 distribution signing identity，建立 Xcode archive，並選擇其中一條路線：透過 App Store Connect 上傳並接受 Mac App Store 審核，或使用 Developer ID 簽署並完成 notarization 後在 Mac App Store 以外散布。本機安裝器使用的 Apple Development 簽署並不是公開散布簽署。

Official references: [package a Safari Web Extension](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari), [run it](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension), and [distribute it](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension).

官方參考資料：[封裝 Safari Web Extension](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)、[執行](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension)，以及[散布](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension)。

## Requirements｜系統需求

| Component | Minimum | 元件 | 最低需求 |
|---|---|---|---|
| Windows | Windows 10 version 1607, 64-bit | Windows | Windows 10 1607，64 位元 |
| macOS for Chrome/Edge | macOS 11 Big Sur | Chrome／Edge 的 macOS | macOS 11 Big Sur |
| macOS for Safari runtime | macOS 13 Ventura | Safari 執行環境 | macOS 13 Ventura |
| Safari build machine | macOS 14.5+ with Xcode 16+ | Safari 建置電腦 | macOS 14.5 以上與 Xcode 16 以上 |
| Node.js | Node.js 22 LTS or newer | Node.js | Node.js 22 LTS 以上 |
| Chrome / Edge | Version 99 or newer | Chrome／Edge | 99 版以上 |

On macOS 11 or 12, install Node.js 22 LTS rather than Node.js 24, because Node.js 24 requires macOS 13.5 or newer. Homebrew automatically selects the correct Intel or Apple Silicon build.

若使用 macOS 11 或 12，請安裝 Node.js 22 LTS，不要安裝 Node.js 24，因為 Node.js 24 需要 macOS 13.5 以上。Homebrew 會自動選擇正確的 Intel 或 Apple Silicon 版本。

Windows scanned-PDF OCR uses the built-in `Windows.Media.Ocr` through Windows PowerShell 5.1. Install the needed Windows language pack under **Settings → Time & Language → Language → Language options → Basic typing**. PowerShell 7 is not used for the OCR helper.

Windows 掃描 PDF OCR 會透過 Windows PowerShell 5.1 使用內建的 `Windows.Media.Ocr`。請到 **設定 → 時間與語言 → 語言 → 語言選項 → 基本輸入** 安裝需要的 Windows 語言套件。OCR helper 不使用 PowerShell 7。

macOS scanned-PDF OCR uses Apple's Vision framework. The installer compiles a small Swift helper on your Mac. If `swiftc` is unavailable, install Xcode Command Line Tools with `xcode-select --install` and rerun the installer.

macOS 掃描 PDF OCR 使用 Apple Vision framework。安裝程式會在你的 Mac 上編譯一個小型 Swift helper。如果找不到 `swiftc`，請執行 `xcode-select --install` 安裝 Xcode Command Line Tools，再重新執行安裝程式。

## Privacy and security｜隱私與安全

The Bridge listens only on `127.0.0.1`. All non-minimal endpoints require an allowed extension origin, and translation/OCR POST requests additionally require the ImmerseFree request header. `GET /health` without an origin returns only `{"ok":true}` so installers can check whether the service started.

Bridge 只監聽 `127.0.0.1`。除了最小健康檢查之外，所有端點都要求通過允許的擴充功能 origin；翻譯／OCR POST 請求還另外要求 ImmerseFree request header。沒有 origin 的 `GET /health` 只會回傳 `{"ok":true}`，供安裝程式確認服務是否啟動。

Translation content is sent to the engine you select. Gemini and remote custom APIs receive requests directly from the extension. Antigravity and OpenCode CLI requests pass through the local Bridge to the installed CLI. Scanned PDF OCR normally runs locally; the Antigravity vision fallback, when used, sends the rendered page image to the selected Antigravity model.

翻譯內容會送到你選擇的引擎。Gemini 與遠端自訂 API 由擴充功能直接發出請求；Antigravity 與 OpenCode CLI 請求則經過本機 Bridge 送到已安裝的 CLI。掃描 PDF OCR 通常在本機執行；如果使用 Antigravity 視覺備援，轉成圖片的 PDF 頁面會傳送給選定的 Antigravity 模型。

The Bridge runs Antigravity vision OCR in a sandboxed temporary working directory and does not auto-approve all CLI tool calls. Temporary images are deleted after each request.

Bridge 會在受沙盒限制的暫存工作目錄執行 Antigravity 視覺 OCR，而且不會自動核准全部 CLI 工具呼叫。每次請求完成後會刪除暫存圖片。

API keys entered in the extension are stored locally but are not encrypted. Settings exports contain the keys in plaintext. Protect and delete exports after transfer. If you need stronger secret isolation for a production deployment, use a backend proxy and keep provider credentials on the server.

輸入擴充功能的 API key 會儲存在本機，但沒有加密。設定匯出檔會以明文包含 key。搬移設定後請妥善保護並刪除匯出檔。正式部署若需要更強的秘密隔離，請使用後端 proxy，把 provider 憑證留在伺服器端。

## Move settings to another computer｜把設定搬到另一台電腦

On the old computer, open ImmerseFree **Options** and click **Export settings**. Move the JSON file securely. On the new computer, install ImmerseFree, open **Options**, and click **Import settings**. Verify the engine, model, and permissions, then delete the JSON file because it contains API keys in plaintext.

在舊電腦打開 ImmerseFree **選項**，按 **匯出設定**，再用安全方式移動 JSON 檔。在新電腦安裝 ImmerseFree，打開 **選項**並按 **匯入設定**。確認引擎、模型與權限後，請刪除 JSON 檔，因為檔案會以明文包含 API key。

This is a file you carry, not a cloud sync — moving settings is a deliberate act, and there is no copy of your configuration sitting on anyone's server. Immersive Translate does offer real cross-device sync, which is genuinely more convenient, and reserves it for Pro and Max.

這是你自己搬的一個檔案，不是雲端同步——搬設定是一個你主動做的動作，也不會有一份你的設定放在誰的伺服器上。沈浸式翻譯確實有真正的跨裝置同步，那確實比較方便，而它是 Pro 與 Max 才有的功能。

## Uninstall｜解除安裝

On Windows, open the installed or downloaded `Windows` folder and double-click **`Uninstall ImmerseFree.cmd`**. Then remove the extension from each Chrome/Edge profile through the browser's extension page.

在 Windows 打開已安裝或下載的 `Windows` 資料夾，雙擊 **`Uninstall ImmerseFree.cmd`**。接著到瀏覽器擴充功能頁面，從每個 Chrome／Edge 設定檔移除擴充功能。

On macOS, run **`macOS/Uninstall ImmerseFree.command`**. Then remove the extension from Chrome/Edge. For Safari, disable the extension in Safari Settings and remove `ImmerseFree.app` from `/Applications` or `~/Applications` if it remains.

在 macOS 執行 **`macOS/Uninstall ImmerseFree.command`**，再從 Chrome／Edge 移除擴充功能。Safari 請先到 Safari 設定停用延伸功能；如果 `/Applications` 或 `~/Applications` 仍有 `ImmerseFree.app`，再把它移除。

## For developers｜開發者資訊

The repository layout is:

Repository 結構如下：

```text
Extension/     shared Manifest V3 extension for Chrome and Edge
Bridge/        local service on 127.0.0.1:27843, CLI engines, and OCR
Windows/       Windows installer, launcher, uninstaller, and OCR helper
macOS/         macOS installer, OCR source, and Safari Xcode project
test/          Node.js regression tests
scripts/       project integrity checks
docs/          feature overview, troubleshooting, screenshots, and research notes
```

- [`docs/FEATURES.md`](docs/FEATURES.md) — bilingual feature overview; every number cites the file that defines it.
- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) — the problems reported most often and how to tell them apart.
- [`docs/OFFICIAL-SOURCES.md`](docs/OFFICIAL-SOURCES.md) — evidence notes behind the installation and publishing instructions.

- [`docs/FEATURES.md`](docs/FEATURES.md)——中英雙語功能總覽，每個數字都註明是哪個檔案定義的。
- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)——最常被回報的問題，以及怎麼分辨你遇到的是哪一個。
- [`docs/OFFICIAL-SOURCES.md`](docs/OFFICIAL-SOURCES.md)——安裝與上架說明背後的查證紀錄。

Run the complete cross-platform-independent verification suite with Node.js 22 or newer:

使用 Node.js 22 以上執行不依賴特定平台的完整驗證：

```sh
npm run verify
```

This validates manifests and referenced files, checks that Chromium and Safari shared resources match, derives the Chromium extension ID from the manifest key and compares it with the Bridge allowlist, scans for common committed-secret patterns, and runs regression tests for provider parsing, settings, batching, PDF handling, and platform helpers.

這會驗證 manifests 與所有引用檔案、確認 Chromium 與 Safari 的共用資源一致、從 manifest key 推導 Chromium 擴充功能 ID 並與 Bridge allowlist 比對、掃描常見誤提交 secret 模式，並執行 provider 解析、設定、批次、PDF 處理與平台 helper 的回歸測試。

To verify the Safari app without signing:

若要在不簽署的情況下驗證 Safari App：

```sh
xcodebuild \
  -project "macOS/Safari/ImmerseFree.xcodeproj" \
  -scheme ImmerseFree \
  -configuration Release \
  -destination "platform=macOS" \
  -derivedDataPath /tmp/immersefree-xcode-check \
  CODE_SIGNING_ALLOWED=NO \
  clean build
```

GitHub Actions repeats Node verification on Windows and macOS, parses every Windows PowerShell script, and builds the unsigned Safari app.

GitHub Actions 會在 Windows 與 macOS 重跑 Node 驗證、解析每一支 Windows PowerShell 腳本，並建置未簽署的 Safari App。

Before publishing Chrome or Edge store builds, reconcile each store's final extension ID with the Bridge origin allowlist and test the actual store-installed package. Sideloaded-ID testing alone is insufficient.

發布 Chrome 或 Edge 商店版本前，必須把每個商店最後指派的擴充功能 ID 與 Bridge origin allowlist 對齊，並實際測試從商店安裝的封裝。只測側載版本 ID 並不足夠。

## License｜授權

MIT License. See [`LICENSE`](LICENSE). Bundled third-party components and their licenses are listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

採用 MIT License，詳見 [`LICENSE`](LICENSE)。內含第三方元件與授權資訊列於 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
