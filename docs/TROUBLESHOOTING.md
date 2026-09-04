# Troubleshooting｜疑難排解

This page collects the problems that are reported most often, together with the
check that tells you which one you actually have. Every fix here is something you
can do yourself; none of them requires rebuilding the project.

這一頁收集最常被回報的問題，以及「怎麼判斷你遇到的是哪一個」的檢查方式。這裡的每一個
處理方式你都可以自己做，都不需要重新建置專案。

---

## Safari: subtitles stay on “Preparing”｜Safari：字幕一直停在「準備中」

**Symptom.** The extension is enabled in Safari, the page translates normally,
but AI subtitles never leave the “Preparing” state. Chrome on the same Mac works.

**症狀。** Safari 裡的擴充功能已啟用，網頁翻譯也正常，但 AI 字幕永遠停在「準備中」。
同一台 Mac 上的 Chrome 卻正常。

**Cause.** A Safari Web Extension runs inside a sandboxed app extension — a
walled-off process that only gets the abilities its build explicitly asks for. In
releases before 0.8.0 the `ImmerseFree Extension` target did not request outgoing
network access, so every request the extension made to the local Bridge or to a
translation API was dropped by the sandbox with no visible error. Subtitles were
the most obvious victim because they fetch continuously.

**原因。** Safari 的擴充功能跑在一個沙盒化的 app extension 裡——也就是一個被牆圍起來的
獨立程序，只拿得到它在建置設定裡明確申請過的能力。0.8.0 之前，`ImmerseFree Extension`
這個 target 沒有申請「對外連線」的權限，所以擴充功能發往本機 Bridge 或翻譯 API 的每一個
請求都被沙盒直接丟掉，而且不會顯示任何錯誤。字幕會一直抓資料，所以症狀最明顯。

**Fix.** Update to 0.8.0 and rebuild Safari by running
`macOS/Install or update Safari.command` again. The Xcode project now sets
`ENABLE_OUTGOING_NETWORK_CONNECTIONS = YES` on the extension target as well as on
the container app. After the rebuild, quit Safari completely and reopen it.

**處理方式。** 升級到 0.8.0，然後重新執行 `macOS/Install or update Safari.command`
重新建置 Safari 版本。Xcode 專案現在會在擴充功能 target 上（不只是外層 App）設定
`ENABLE_OUTGOING_NETWORK_CONNECTIONS = YES`。重新建置後，請完全結束 Safari 再重新開啟。

**How to confirm it is fixed.** Open `macOS/Safari/ImmerseFree.xcodeproj/project.pbxproj`
and search for `ENABLE_OUTGOING_NETWORK_CONNECTIONS`. It must appear four times —
Debug and Release for the app, Debug and Release for the extension.

**怎麼確認修好了。** 打開 `macOS/Safari/ImmerseFree.xcodeproj/project.pbxproj` 搜尋
`ENABLE_OUTGOING_NETWORK_CONNECTIONS`，應該要出現四次——App 的 Debug 與 Release，
擴充功能的 Debug 與 Release。

---

## Chrome: the video will not play at all｜Chrome：影片根本播不動

**Symptom.** Netflix, Disney+, or YouTube shows a black player, an error code, or
refuses to start. Subtitles obviously cannot be translated when nothing plays.

**症狀。** Netflix、Disney+ 或 YouTube 顯示黑畫面、錯誤代碼，或根本不開始播放。
影片不動的時候，字幕當然也翻不了。

**Check this first: is it an automation-launched Chrome?** If the browser window
was started by a testing or automation tool — Playwright, Puppeteer, Selenium, a
`--remote-debugging-port` launch, or a “Chrome for Testing” build — it is not the
same browser as your everyday Chrome. Automation builds ship without Widevine
(the DRM component streaming services require, essentially the copy-protection
decoder) and often without the proprietary media codecs. Netflix and Disney+ will
never play there, and some YouTube formats fail too. This is not an ImmerseFree
problem and no setting fixes it.

**先確認一件事：這個 Chrome 是不是自動化工具開起來的？** 如果這個瀏覽器視窗是被測試或
自動化工具開起來的——Playwright、Puppeteer、Selenium、用 `--remote-debugging-port`
啟動，或是「Chrome for Testing」版本——那它跟你日常用的 Chrome 不是同一個東西。自動化版本
不含 Widevine（串流服務要求的 DRM 元件，講白話就是那個負責解開版權保護的解碼器），
也常常不含專有的影音編解碼器。Netflix 與 Disney+ 在那裡永遠不會播，某些 YouTube 格式也會
失敗。這不是 ImmerseFree 的問題，任何設定都改不掉。

**Fix.** Open your normal Chrome from the Dock, Start menu, or Applications
folder, load the extension there, and test again.

**處理方式。** 從 Dock、開始功能表或應用程式資料夾打開你平常用的 Chrome，在那裡載入
擴充功能，再測一次。

**If it is your normal Chrome.** Check that the site plays with ImmerseFree
disabled. If it does not, the problem is the site or the browser, not the
extension. If it plays only when ImmerseFree is disabled, report it as a bug and
include the site and the engine you selected.

**如果它確實是你平常的 Chrome。** 先停用 ImmerseFree，看影片能不能播。如果還是不能播，
問題出在網站或瀏覽器，不是擴充功能。如果停用後就能播，請回報 bug，並附上網站名稱與你
選用的翻譯引擎。

---

## The Bridge is not running｜Bridge 沒有啟動

**What the Bridge is.** ImmerseFree cannot call a command-line program from
inside the browser — browsers forbid that. So the installer sets up a small local
service, the Bridge, listening on `http://127.0.0.1:27843`. Think of it as a
receptionist that only answers the phone from inside your own machine: the
extension asks it to run the CLI, and it passes the answer back. Only the CLI
engines (Antigravity and OpenCode without a key) need it. Gemini and custom APIs
do not.

**Bridge 是什麼。** 瀏覽器不允許擴充功能直接執行電腦上的命令列程式，所以安裝程式會另外
架一個小型的本機服務，也就是 Bridge，監聽 `http://127.0.0.1:27843`。你可以把它想成一個
只接內線電話的櫃檯：擴充功能請它去呼叫 CLI，它再把結果轉回來。只有 CLI 類的引擎
（Antigravity，以及沒填金鑰的 OpenCode）需要它；Gemini 與自訂 API 不需要。

**Symptom.** The popup shows that the local service is unavailable, or CLI
translations fail immediately while a Gemini key works fine.

**症狀。** 彈出視窗顯示本機服務無法使用，或是 CLI 翻譯立刻失敗，但改用 Gemini 金鑰就正常。

**Check whether it is alive.**

**確認它還活著沒：**

```sh
# macOS / Linux
curl -s http://127.0.0.1:27843/health
```

```powershell
# Windows PowerShell
Invoke-RestMethod http://127.0.0.1:27843/health
```

A healthy Bridge answers `{"ok":true}`. No answer at all means it is not running.

Bridge 正常時會回 `{"ok":true}`。完全沒有回應就代表它沒有在跑。

**Fix.**

1. Run the installer again — `Windows\Install ImmerseFree.cmd` or
   `macOS/Install ImmerseFree.command`. It reinstalls the login-time startup entry
   and starts the service immediately.
2. On Windows you can also start it by hand with `Windows\Start-Bridge.vbs`.
3. If the health check answers but translation still fails, check that a real CLI
   is installed: the same `/health` response lists whether `agy` and `opencode`
   were found and where.

**處理方式：**

1. 重新執行安裝程式——`Windows\Install ImmerseFree.cmd` 或
   `macOS/Install ImmerseFree.command`。它會重新設定登入時自動啟動，並立刻把服務叫起來。
2. Windows 也可以直接執行 `Windows\Start-Bridge.vbs` 手動啟動。
3. 如果健康檢查有回應但翻譯還是失敗，請確認 CLI 真的裝好了：同一個 `/health` 回應會列出
   有沒有找到 `agy` 與 `opencode`，以及它們在哪個路徑。

**Port already in use.** If another program already holds port 27843, the Bridge
refuses to start and says so instead of quietly stealing the port. Find the
occupant with `lsof -ti tcp:27843` on macOS or
`netstat -ano | findstr 27843` on Windows.

**連接埠被占用。** 如果有別的程式已經占著 27843（port，也就是這台電腦上的一個門牌號碼），
Bridge 會直接拒絕啟動並說明原因，而不是安靜地把流量搶走。用 macOS 的
`lsof -ti tcp:27843` 或 Windows 的 `netstat -ano | findstr 27843` 找出占用者。

---

## The engine ran out of quota｜引擎額度用完了

**Symptom.** Translation worked earlier today and now stops partway, or the
toolbar reports repeated failures from one engine.

**症狀。** 今天稍早還能翻，現在翻到一半就停；或工具列一直回報同一個引擎失敗。

**What ImmerseFree does by itself.** Automatic failover is on by default. When an
engine fails — quota exhausted, local service down, timeout, CLI unreachable —
the next engine in your fallback order takes over. Switching happens only between
batches, so a single sentence is never half-translated by two different engines,
and a single translation tries at most two extra engines before it stops. When a
switch happens, the toolbar says which engine took over; it never changes engines
silently.

**ImmerseFree 自己會做的事。** 失敗自動轉移預設是開啟的。某個引擎掛掉時——額度用完、
本機服務沒開、逾時、CLI 連不上——就換成你排定的下一個備援引擎。轉移只發生在「批」與
「批」之間，所以同一句話不會被兩個引擎各翻一半；一次翻譯最多額外嘗試兩個引擎就停。
換過引擎時，工具列會顯示是誰接手，不會偷偷換掉。

**What you can do.**

1. Open **Options → Automatic failover** and make sure more than one engine has a
   key or a URL filled in. Engines with neither are skipped.
2. Add **OpenCode Free** to the order. It needs no sign-in and no key, so it is a
   useful last resort.
3. For Gemini, paste several API keys — one per line. ImmerseFree rotates through
   them, so one exhausted key does not stop the batch.
4. Check **Options → Diagnostics**. It shows the success rate per engine and the
   recent error codes, which tells you whether this really is a quota problem or a
   network one.

**你可以做的事：**

1. 打開 **選項 → 失敗自動轉移**，確認不只一個引擎填了金鑰或網址。兩者都沒填的引擎會被跳過。
2. 把 **OpenCode 免費模型** 加進備援順序。它不用登入、不用金鑰，很適合當最後一道防線。
3. Gemini 可以一行一把貼上多組 API key，ImmerseFree 會輪流使用，單一把金鑰用完不會讓整批停下來。
4. 看 **選項 → 診斷**。那裡有每個引擎的成功率與最近的錯誤碼，可以判斷這到底是額度問題還是網路問題。

---

## Still stuck?｜還是卡住？

Open an issue with: your operating system and browser, the ImmerseFree version
from the extension page, which engine you selected, and the contents of
**Options → Diagnostics**. Remove your API keys before pasting anything.

回報 issue 時請附上：作業系統與瀏覽器、擴充功能頁面上的 ImmerseFree 版本、你選用的引擎，
以及 **選項 → 診斷** 的內容。貼出來之前請先把 API key 拿掉。
