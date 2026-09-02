# Windows 10 實機驗證清單

這份清單存在的理由：ImmerseFree 的 Windows 腳本只在 **Windows 11** 上實測過。
下面每一項都是「在 Win11 上必定通過、但在 Win10 上有可能不一樣」的東西——
主要是 **Windows PowerShell 5.1 的預設編碼**、**主控台字碼頁（cp950 / cp437）**、
以及 **WinRT OCR 元件在舊版 Windows 上的可用性**。

靜態檢查（語法、BOM、非 ASCII 字元）已經做過，全部通過。剩下的只能在真機上跑。

## 怎麼用

- 建議兩台（或兩個 VM）：一台**繁體中文版 Windows 10**、一台**英文版 Windows 10**。
  英文版那台是重點：主控台預設 cp437，中文輸出最容易在那裡爛掉。
- 版本至少 **1607**（PowerShell 5.1 從這版才內建）。理想是 22H2。
- 每項都寫了「預期結果」。跟預期不一樣就記下**原文錯誤訊息**再往下走。
- 全部做完大約 30–40 分鐘。

---

## 0. 環境確認（1 分鐘，做完再往下）

在**一般使用者**的 PowerShell 視窗（不要用系統管理員）執行：

```powershell
$PSVersionTable.PSVersion          # 預期：5.1.xxxxx.xxxx
$PSVersionTable.PSEdition          # 預期：Desktop
[Environment]::OSVersion.Version   # 預期：10.0.14393 或更高
chcp                               # 記下這個數字（中文版通常 950、英文版 437）
node --version                     # 預期：v22.x 或更高。沒有就先裝 Node 22 LTS
```

> 如果 `$PSVersionTable.PSVersion` 顯示 5.0，這台是 Windows 10 1507/1511，
> 不在支援範圍。預期行為是安裝程式直接被 `#Requires -Version 5.1` 擋下並印出
> 訊息，而不是跑到一半炸掉——順便驗一下這件事有沒有發生。

---

## 1. 編碼：中文訊息會不會變亂碼（最容易在 Win10 出事的一項）

### 1.1 從 .cmd 進入（一般使用者的路徑）

在檔案總管裡雙擊 `Windows\Install ImmerseFree.cmd`。

- **預期**：視窗裡的中文（「停止舊服務並更新程式檔」「[完成] …」等）**完整顯示**，
  沒有 `?????`、沒有 `��`、沒有方框。
- **預期**：**英文版 Windows 10 上也一樣正常**。`.cmd` 第一件事就是 `chcp 65001`。
- ❌ 如果看到問號或亂碼：把整個視窗截圖，並記下 `chcp` 原始值。

### 1.2 直接從 PowerShell 視窗執行（README 的 -InstallRoot 路徑）

```powershell
cd <解壓目錄>\Windows
.\Install.ps1 -ValidateOnly
```

- **預期**：中文正常顯示，即使這個視窗沒有跑過 `chcp 65001`。
  （腳本開頭會自己設 `[Console]::OutputEncoding`，那會連帶改主控台字碼頁。）
- ❌ 亂碼的話，這代表 `[Console]::OutputEncoding` 那行沒生效，記下來。

### 1.3 .cmd 本身沒有被 cmd.exe 誤讀

- **預期**：視窗**第一行不是**類似 `'∩╗┐@echo off' 不是內部或外部命令` 的錯誤。
  （那會是 UTF-8 BOM 混進 `.cmd` 的症狀；目前檔案是純 ASCII 無 BOM，
  但如果有人用記事本另存新檔就會重新引入。）
- **預期**：不會出現 `此時不應有 ...` / `The syntax of the command is incorrect`。

### 1.4 安裝到含中文的路徑

```powershell
.\Install.ps1 -InstallRoot "D:\測試資料夾\ImmerseFree" -NoLaunch
```

- **預期**：安裝成功，`D:\測試資料夾\ImmerseFree\Bridge\server.mjs` 存在。
- **預期**：印出來的路徑中文正常。
- 驗完記得用 `.\Uninstall.ps1 -InstallRoot "D:\測試資料夾\ImmerseFree" -PurgeData` 清掉。

---

## 2. PowerShell 5.1 語法相容性

四支 `.ps1` 都標了 `#Requires -Version 5.1`，靜態掃描沒有找到任何 PS 6/7 專屬語法。
真機只需要確認「它真的能被 5.1 剖析」：

```powershell
# 只剖析、不執行。四支都要跑，四次都要沒有輸出。
foreach ($f in @('Install.ps1','Uninstall.ps1','Start-Bridge.ps1','..\Bridge\ocr\ocr.ps1')) {
  $errors = $null
  [System.Management.Automation.PSParser]::Tokenize(
    (Get-Content -Raw -Encoding UTF8 $f), [ref]$errors) | Out-Null
  "{0}: {1} parse error(s)" -f $f, $errors.Count
}
```

- **預期**：四行都是 `0 parse error(s)`。
- ❌ 非 0 的話，把 `$errors[0].Message` 與 `$errors[0].Token.StartLine` 記下來。

再各跑一次不改動系統的模式：

```powershell
.\Install.ps1 -ValidateOnly     # 預期 exit 0，印出 Node/Antigravity/OpenCode 的偵測結果
.\Uninstall.ps1 -WhatIf         # 預期 exit 0，只印「會做什麼」
.\Start-Bridge.ps1 -WhatIf      # 預期 exit 0，印出找到的 Node 路徑
```

---

## 3. 一定要是 powershell.exe，不能是 pwsh

三個呼叫點都寫死了 `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`
或 `powershell.exe`（`.cmd`、`.vbs`、`Bridge/platform-core.mjs`）。
如果這台機器有裝 PowerShell 7，要確認它沒有被抓去用——**pwsh 載不了 WinRT，OCR 會死**。

```powershell
# 只在有裝 pwsh 的機器上做這一項
where.exe pwsh                  # 有輸出代表有裝
```

- 裝了 pwsh 之後，重跑 **6. OCR**，**預期結果不變**（仍然成功）。
- 另外手動驗一次防呆訊息（如果有裝 pwsh）：
  ```powershell
  pwsh -File ..\Bridge\ocr\ocr.ps1 test.png
  ```
  **預期**：印出「Windows OCR 需要 Windows PowerShell 5.1（powershell.exe）…」，
  exit code 2。**不應該**是含糊的「元件無法載入」或 .NET 例外堆疊。

---

## 4. 安裝流程本身

雙擊 `Install ImmerseFree.cmd`，逐項對：

| 檢查 | 預期 |
|---|---|
| SmartScreen | 可能跳「Windows 已保護您的電腦」。按「其他資訊 → 仍要執行」後應可繼續。記下有沒有跳。 |
| 安裝目錄 | `%LOCALAPPDATA%\ImmerseFree` 下有 `Bridge\`、`Extension\`、`Start-Bridge.ps1`、`Start-Bridge.vbs`、`version.txt` |
| `version.txt` | 內容為 `ImmerseFree <版本號>`，且版本號與 `Extension\manifest.json` 相同 |
| 登入捷徑 | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ImmerseFree Bridge.lnk` 存在，目標是 `wscript.exe` |
| 服務起來了 | 視窗印出「本機 Bridge 已啟動：http://127.0.0.1:27843」 |
| 手動確認 | `Invoke-RestMethod http://127.0.0.1:27843/health` 回 `ok : True` |
| 瀏覽器 | 自動開啟 `chrome://extensions` / `edge://extensions`，並用檔案總管開出 `Extension` 資料夾 |
| 沒有黑視窗 | 安裝過程與登入時**不應該**閃出黑色主控台視窗（那是 `.vbs` 存在的理由） |

**重開機一次**，然後：

- **預期**：登入後 3–10 秒內 `Invoke-RestMethod http://127.0.0.1:27843/health` 就回得了。
- **預期**：登入時沒有任何視窗一閃而過。
- ❌ 沒起來的話，看 `%LOCALAPPDATA%\ImmerseFree\helper-error.log`，把內容記下來。

### 4.1 重複安裝（覆蓋既有安裝）

不要先解除安裝，直接再跑一次 `Install ImmerseFree.cmd`。

- **預期**：印出「停止 Bridge（PID …）」，然後照常裝完，**不會**出現
  「處理程序無法存取檔案，因為檔案正由另一個處理程序使用」。
  （這一段在 Win11 上驗過，Win10 的檔案控制代碼釋放時機可能不同，所以要重驗。）

---

## 5. 解除安裝

```powershell
# 先建一個假的使用者資料，確認它有被保留
New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\ImmerseFree\TranslationCache" | Out-Null
Set-Content "$env:LOCALAPPDATA\ImmerseFree\TranslationCache\keep.txt" 'keep me'
```

雙擊 `Uninstall ImmerseFree.cmd`。

- **預期**：`TranslationCache\keep.txt` **還在**，`Bridge\` 與 `Extension\` 不見了。
- **預期**：Startup 捷徑不見了；`http://127.0.0.1:27843/health` 連不上。
- 再跑一次 `Uninstall.ps1 -PurgeData`，**預期**：整個 `%LOCALAPPDATA%\ImmerseFree` 消失。

---

## 6. OCR：`Windows.Media.Ocr` 在 Win10 的載入（第二大風險）

這是整份清單裡最需要真機的一項。腳本用的 WinRT 型別載入寫法在 Win11 有效，
Win10 的 WinRT metadata 解析路徑不完全相同。

先準備一張含中文與英文的截圖，存成 `C:\temp\ocr-test.png`。

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File "$env:LOCALAPPDATA\ImmerseFree\Bridge\ocr\ocr.ps1" "C:\temp\ocr-test.png"
```

| 情況 | 預期 |
|---|---|
| 正常 | stdout 是一段 JSON 陣列，`[{"text":"...","confidence":1.0,"left":...}]`，exit code 0 |
| JSON 內容 | 中文以 `\uXXXX` 逃逸（PS 5.1 的 `ConvertTo-Json` 就是這樣），Node 那端解得開 |
| 沒有語言包 | stderr 印「尚未安裝 Windows OCR 語言包。」，exit code 2 |
| 型別載不到 | stderr 印「Windows OCR 語言元件無法載入。」，exit code 2 — **這一項出現就要回報** |

分別逐行確認這四行在 Win10 上不會丟例外（一行一行貼進 PowerShell 5.1 視窗）：

```powershell
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
[Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime]
```

- **預期**：每一行都印出型別名稱（`IsPublic IsSerial Name …`），沒有
  `無法找到類型 […]` / `Unable to find type`。
- ❌ 若第 2 行（`Windows.Graphics`）失敗而其他成功，把 assembly 欄位改成
  `Windows.Foundation` 再試一次，並回報哪一種寫法有效。

再確認語言引擎：

```powershell
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | Select-Object LanguageTag
```

- **預期**：至少列出一種語言。看不到 `zh-Hant-TW` 也沒關係（腳本會退回
  `zh-Hant` → `en-US` → 使用者設定），但要記下實際列出哪些。

最後從擴充功能實際跑一次掃描版 PDF，確認端到端通得了。

---

## 7. 端到端（擴充功能 ↔ Bridge）

1. Chrome / Edge → `chrome://extensions` → 開發人員模式 → 載入未封裝項目 →
   選 `%LOCALAPPDATA%\ImmerseFree\Extension`。
2. 確認擴充功能沒有紅色錯誤（manifest 解析、service worker 註冊）。
   - **預期**：Chrome/Edge **99 以上**才會接受 `match_origin_as_fallback`。
     如果這台機器的瀏覽器比 99 舊，這裡會有警告——那是預期的，記下瀏覽器版本。
3. 隨便開一個英文網頁，按 `Alt+Shift+B`。
   - **預期**：每段底下出現中文翻譯。
4. 開一個**掃描版** PDF。
   - **預期**：走 OCR，出得來雙語結果（這一步同時驗了第 6 節的端到端）。

---

## 8. 邊緣情況（有時間再做）

| 情境 | 做法 | 預期 |
|---|---|---|
| 完全沒裝 Node | 在乾淨 VM 上跑安裝 | 停在「找不到 Node.js」並給出 nodejs.org 與 `winget` 指令，**不是**堆疊追蹤 |
| 只裝了 32 位元 Node | `%ProgramFiles(x86)%\nodejs\node.exe` | 安裝程式找得到（候選路徑有列） |
| 使用者名稱含中文 | 用中文帳號登入後安裝 | `%LOCALAPPDATA%` 路徑正常，服務起得來 |
| 安裝路徑含 `[` `]` | `.\Install.ps1 -InstallRoot "D:\a[1]\IF"` | **已知弱點**：`Stop-BridgeProcesses` 用 `-like` 比對路徑，`[` `]` 會被當萬用字元。實際影響只有「重複安裝時舊服務可能沒被停掉」。若重現得了，回報一下 |
| 27843 被別的程式佔用 | 先 `node -e "require('http').createServer().listen(27843)"` 再安裝 | 安裝程式印出「本機 Bridge 尚未回應」並指向 `helper-error.log`，log 裡有 `EADDRINUSE` |
| 用記事本編輯過 .cmd | 另存新檔（記事本預設會加 BOM） | 這會**弄壞**檔案。只是提醒：改 `.cmd` 請用不加 BOM 的編輯器 |

---

## 回報格式

每一項寫一行就好：

```
1.1 從 .cmd 進入          ✅
1.2 從 PowerShell 視窗     ❌  中文顯示成 ?????，chcp 原值 437
6   WinRT 型別載入         ❌  第 2 行失敗：無法找到類型 [Windows.Graphics.Imaging.BitmapDecoder]
```

❌ 的項目請附上：**錯誤訊息原文**、`$PSVersionTable.PSVersion`、`chcp` 的值、
Windows 版本（`winver`）。
