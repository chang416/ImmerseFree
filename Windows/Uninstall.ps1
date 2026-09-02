#Requires -Version 5.1
<#
    ImmerseFree Windows 解除安裝

    預設停止本機 Bridge、移除登入啟動與程式檔，但保留使用者資料及翻譯快取。
    加上 -PurgeData（別名 -ClearCache）才會刪除 Data、Cache、TranslationCache
    與 UserData。
    -WhatIf 或 -ValidateOnly 不會修改檔案。
#>

[CmdletBinding()]
param(
    [Alias('ClearCache')]
    [switch]$PurgeData,
    [switch]$WhatIf,
    [switch]$ValidateOnly,
    # 安裝時若用過 -InstallRoot，移除時要指定同一個路徑。
    [string]$InstallRoot
)

$ErrorActionPreference = 'Continue'

# 這支腳本的訊息是中文，但 Windows PowerShell 5.1 會把輸出轉成主控台目前的字碼頁。
# 從 .cmd 進來時已經 chcp 65001；但 README 也教使用者直接在 PowerShell 視窗執行
# （-InstallRoot 那段），那時英文版 Windows 10 的主控台是 cp437，中文會全部變成
# 問號。設定 Console::OutputEncoding 會連帶呼叫 SetConsoleOutputCP，兩種進入方式
# 都能正常顯示。輸出被重導向時設定可能失敗，失敗不影響安裝，所以吞掉。
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }

$ProductName = 'ImmerseFree'
$LocalAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else {
    [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
}
if ([string]::IsNullOrWhiteSpace($LocalAppData)) {
    throw '找不到使用者的 LocalApplicationData 路徑。請在 Windows 使用者工作階段中重試。'
}
if ([string]::IsNullOrWhiteSpace($InstallRoot)) {
    $InstallRoot = Join-Path $LocalAppData $ProductName
} else {
    $InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
}
$PreservedDirectories = @('Data', 'Cache', 'TranslationCache', 'UserData')
$StartupShortcutName = 'ImmerseFree Bridge.lnk'

function Get-FullPath([string]$Path) {
    try { return [System.IO.Path]::GetFullPath($Path) } catch { return $Path }
}

function Stop-BridgeProcesses([string]$Root) {
    $normalizedRoot = (Get-FullPath $Root).TrimEnd('\')
    $processes = @()
    try {
        $processes = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue)
    } catch { }
    foreach ($process in $processes) {
        $commandLine = [string]$process.CommandLine
        # 只比對 server.mjs 不夠：任何從安裝目錄跑起來的 node.exe 都會鎖住
        # 安裝目錄裡的 Runtime 執行檔，接下來的覆蓋就會失敗。
        # 凡是可執行檔位在安裝目錄底下的 node 程序都要先停掉。
        $runsFromInstallRoot = $commandLine -like "*$normalizedRoot*"
        if ($runsFromInstallRoot -and ($commandLine -like '*server.mjs*' -or $commandLine -like "*$normalizedRoot\Runtime\node.exe*")) {
            Write-Host "停止 Bridge（PID $($process.ProcessId)）" -ForegroundColor DarkGray
            Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
}

function Remove-StartupShortcut {
    $startupFolder = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
    if ([string]::IsNullOrWhiteSpace($startupFolder)) { return }
    $shortcutPath = Join-Path $startupFolder $StartupShortcutName
    if (Test-Path -LiteralPath $shortcutPath) {
        Remove-Item -LiteralPath $shortcutPath -Force
        Write-Host '已移除登入啟動。' -ForegroundColor Green
    }
}

function Remove-InstalledFiles {
    if (-not (Test-Path -LiteralPath $InstallRoot)) {
        Write-Host '找不到安裝目錄，沒有程式檔需要移除。' -ForegroundColor DarkGray
        return
    }
    foreach ($entry in @(Get-ChildItem -LiteralPath $InstallRoot -Force)) {
        if ($PreservedDirectories -contains $entry.Name -and -not $PurgeData) {
            Write-Host "保留使用者資料：$($entry.Name)" -ForegroundColor DarkGray
            continue
        }
        Remove-Item -LiteralPath $entry.FullName -Recurse -Force
    }
    if (-not $PurgeData -and (Test-Path -LiteralPath $InstallRoot)) {
        Write-Host '程式檔已移除；使用者資料與翻譯快取仍保留。' -ForegroundColor Green
    } elseif ($PurgeData) {
        Remove-Item -LiteralPath $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host '程式檔、使用者資料與翻譯快取已移除。' -ForegroundColor Green
    }
}

if ($ValidateOnly) {
    Write-Host "$ProductName：解除安裝腳本驗證完成（未修改系統）。"
    exit 0
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    if ($WhatIf) {
        Write-Host "$ProductName：在非 Windows 系統略過解除安裝（WhatIf）。"
        exit 0
    }
    throw '此腳本只能在 Windows 執行；在其他系統請使用 -ValidateOnly。'
}

Write-Host "$ProductName 解除安裝" -ForegroundColor White
if ($WhatIf) {
    Write-Host "[WhatIf] 會停止 $InstallRoot 內的 Bridge、移除登入啟動與程式檔。"
    if ($PurgeData) { Write-Host '[WhatIf] 會一併清除 Data、Cache、TranslationCache、UserData。' }
    else { Write-Host '[WhatIf] 會保留 Data、Cache、TranslationCache、UserData。' }
    exit 0
}

Stop-BridgeProcesses $InstallRoot
Remove-StartupShortcut
Remove-InstalledFiles
