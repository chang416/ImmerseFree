#Requires -Version 5.1
<#
    ImmerseFree Windows 安裝程式

    從壓縮包內的 Windows 資料夾執行。Bridge、Extension、Runtime 與本目錄的
    啟動腳本會複製到 %LOCALAPPDATA%\ImmerseFree；安裝完成後不再依賴原始解壓目錄。

    -WhatIf 只顯示會執行的動作，不建立或刪除任何檔案。
    -ValidateOnly 只檢查壓縮包結構，可在 macOS/Linux 上安全執行。
#>

[CmdletBinding()]
param(
    [switch]$WhatIf,
    [switch]$ValidateOnly,
    [switch]$NoLaunch,
    # 預設裝在 %LOCALAPPDATA%\ImmerseFree。若安裝程式是由某些沙箱化（MSIX／
    # App Container）的宿主程式代跑，對 %LOCALAPPDATA% 的寫入會被悄悄重導向到
    # 該程式的私有副本，瀏覽器就看不到擴充功能資料夾。遇到這種情況用這個參數
    # 指定一個一般資料夾即可。
    [string]$InstallRoot
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8

# 這支腳本的訊息是中文，但 Windows PowerShell 5.1 會把輸出轉成主控台目前的字碼頁。
# 從 .cmd 進來時已經 chcp 65001；但 README 也教使用者直接在 PowerShell 視窗執行
# （-InstallRoot 那段），那時英文版 Windows 10 的主控台是 cp437，中文會全部變成
# 問號。設定 Console::OutputEncoding 會連帶呼叫 SetConsoleOutputCP，兩種進入方式
# 都能正常顯示。輸出被重導向時設定可能失敗，失敗不影響安裝，所以吞掉。
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }

$ProductName = 'ImmerseFree'
$ProductVersion = $null
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
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

function Write-Step([string]$Message) {
    Write-Host "`n$Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
    Write-Host "  [完成] $Message" -ForegroundColor Green
}

function Write-Warn([string]$Message) {
    Write-Host "  [注意] $Message" -ForegroundColor Yellow
}

function Get-FullPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return $null }
    try { return [System.IO.Path]::GetFullPath($Path) } catch { return $null }
}

function Join-RelativePath([string]$Root, [string]$RelativePath) {
    $result = $Root
    foreach ($segment in ($RelativePath -split '[\\/]')) {
        if (-not [string]::IsNullOrWhiteSpace($segment)) { $result = Join-Path $result $segment }
    }
    return $result
}

function Find-PackageRoot {
    $parent = Split-Path -Parent $ScriptRoot
    $grandparent = Split-Path -Parent $parent
    $greatGrandparent = Split-Path -Parent $grandparent
    $candidates = @(
        $ScriptRoot,
        $parent,
        $grandparent,
        $greatGrandparent
    )
    foreach ($candidate in $candidates) {
        $full = Get-FullPath $candidate
        if (-not $full) { continue }
        if ((Test-Path -LiteralPath (Join-RelativePath $full 'Bridge\server.mjs')) -and
            (Test-Path -LiteralPath (Join-RelativePath $full 'Extension\manifest.json'))) {
            return $full
        }
    }
    throw '安裝包不完整：需要 Bridge\server.mjs 與 Extension\manifest.json。'
}

function Assert-Package([string]$PackageRoot) {
    $required = @(
        @{ Path = (Join-RelativePath $PackageRoot 'Bridge\server.mjs'); Label = 'Bridge（Bridge\server.mjs）' },
        @{ Path = (Join-RelativePath $PackageRoot 'Extension\manifest.json'); Label = 'Extension（Extension\manifest.json）' },
        # 啟動腳本跟這個安裝程式放在一起（Windows\），不在專案根目錄。
        @{ Path = (Join-Path $ScriptRoot 'Start-Bridge.ps1'); Label = 'Bridge 啟動腳本（Windows\Start-Bridge.ps1）' }
    )
    foreach ($item in $required) {
        if (-not (Test-Path -LiteralPath $item.Path)) {
            throw "安裝包不完整：找不到 $($item.Label)。請確認整個專案都已下載。"
        }
    }

    try {
        # Windows PowerShell 5.1 的 Get-Content 預設用系統 ANSI 字碼頁（這裡是 cp950）讀檔，
        # manifest.json 是 UTF-8，description 的中文會變亂碼並吃掉引號，JSON 直接解析失敗。
        $manifest = Get-Content -LiteralPath (Join-RelativePath $PackageRoot 'Extension\manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        throw "無法讀取 Extension\manifest.json：$($_.Exception.Message)"
    }
    if ([string]$manifest.name -ne $ProductName) {
        throw "擴充功能名稱必須是 $ProductName。"
    }
    $manifestVersion = [string]$manifest.version
    if ($manifestVersion -notmatch '^\d+\.\d+\.\d+$') {
        throw "擴充功能版本格式無效：$manifestVersion"
    }
    $packageJsonPath = Join-Path $PackageRoot 'package.json'
    if (Test-Path -LiteralPath $packageJsonPath) {
        try {
            $packageMetadata = Get-Content -LiteralPath $packageJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
        } catch {
            throw "無法讀取 package.json：$($_.Exception.Message)"
        }
        if ([string]$packageMetadata.version -ne $manifestVersion) {
            throw "安裝包版本不一致：manifest.json 是 $manifestVersion，package.json 是 $($packageMetadata.version)。"
        }
    }
    $script:ProductVersion = $manifestVersion

    $ocrScript = Join-RelativePath $PackageRoot 'Bridge\ocr\ocr.ps1'
    if (-not (Test-Path -LiteralPath $ocrScript)) {
        Write-Warn '找不到 Bridge\ocr\ocr.ps1；掃描版 PDF 的 Windows OCR 將無法使用。'
    }
}

function Join-IfValue([string]$Base, [string]$Child) {
    if ([string]::IsNullOrWhiteSpace($Base)) { return $null }
    return Join-Path $Base $Child
}

function Get-CommandPath([string]$Name) {
    try {
        $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command) {
            if ($command.PSObject.Properties['Source'] -and $command.Source) { return $command.Source }
            if ($command.PSObject.Properties['Path'] -and $command.Path) { return $command.Path }
            if ($command.PSObject.Properties['Definition'] -and $command.Definition) { return $command.Definition }
        }
    } catch { }
    return $null
}

function Resolve-Executable([string]$Name, [string[]]$Candidates) {
    $fromPath = Get-CommandPath $Name
    if ($fromPath -and (Test-Path -LiteralPath $fromPath)) { return (Get-FullPath $fromPath) }
    foreach ($candidate in $Candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return (Get-FullPath $candidate)
        }
    }
    return $null
}

function Resolve-Node([string]$PackageRoot) {
    $bundled = Join-RelativePath $PackageRoot 'Runtime\node.exe'
    if (Test-Path -LiteralPath $bundled) { return (Get-FullPath $bundled) }

    $systemCandidates = @(
        (Join-IfValue $env:ProgramFiles 'nodejs\node.exe'),
        (Join-IfValue ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
        (Join-IfValue $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
    )
    $systemNode = Resolve-Executable 'node.exe' $systemCandidates
    if ($systemNode) { return $systemNode }
    return $null
}

function Get-AntigravityPath {
    $candidates = @(
        (Join-IfValue $env:LOCALAPPDATA 'agy\bin\agy.exe'),
        (Join-IfValue $env:USERPROFILE '.local\bin\agy.exe'),
        (Join-IfValue $env:USERPROFILE '.agy\bin\agy.exe'),
        (Join-IfValue $env:USERPROFILE '.antigravity\bin\agy.exe'),
        (Join-IfValue $env:LOCALAPPDATA 'Programs\agy\agy.exe'),
        (Join-IfValue $env:LOCALAPPDATA 'Programs\Antigravity\agy.exe'),
        (Join-IfValue $env:USERPROFILE 'scoop\shims\agy.exe'),
        (Join-IfValue $env:ProgramFiles 'agy\agy.exe'),
        (Join-IfValue $env:ProgramFiles 'Antigravity\agy.exe')
    )
    return Resolve-Executable 'agy.exe' $candidates
}

function Get-OpenCodePath {
    $candidates = @(
        (Join-IfValue $env:APPDATA 'npm\node_modules\opencode-ai\node_modules\opencode-windows-x64\bin\opencode.exe'),
        (Join-IfValue $env:APPDATA 'npm\node_modules\opencode-windows-x64\bin\opencode.exe'),
        (Join-IfValue $env:LOCALAPPDATA 'Programs\opencode\opencode.exe'),
        (Join-IfValue $env:LOCALAPPDATA 'opencode\bin\opencode.exe'),
        (Join-IfValue $env:USERPROFILE '.local\bin\opencode.exe'),
        (Join-IfValue $env:USERPROFILE '.opencode\bin\opencode.exe'),
        (Join-IfValue $env:USERPROFILE 'scoop\shims\opencode.exe'),
        (Join-IfValue $env:ProgramFiles 'opencode\opencode.exe')
    )
    $ordered = @((Get-CommandPath 'opencode.exe')) + $candidates
    foreach ($candidate in $ordered) {
        if (-not $candidate -or -not (Test-Path -LiteralPath $candidate)) { continue }
        $item = Get-Item -LiteralPath $candidate -ErrorAction SilentlyContinue
        if ($item -and $item.Extension -ieq '.exe' -and $item.Length -ge 65536) {
            return (Get-FullPath $candidate)
        }
    }
    return $null
}

function Get-PowerShellPath {
    $windowsPowerShell = Join-IfValue $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if ($windowsPowerShell -and (Test-Path -LiteralPath $windowsPowerShell)) { return $windowsPowerShell }
    $resolved = Get-CommandPath 'powershell.exe'
    if ($resolved) { return $resolved }
    throw '找不到 Windows PowerShell。請確認 Windows 系統元件完整後重試。'
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
            Write-Host "  停止 Bridge（PID $($process.ProcessId)）" -ForegroundColor DarkGray
            Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
            # Stop-Process 回來時檔案控制代碼可能還沒放掉，接著刪 node.exe 會 file-in-use。
            try { Wait-Process -Id $process.ProcessId -Timeout 10 -ErrorAction SilentlyContinue } catch { }
        }
    }
}

function Remove-ProgramContents([string]$Root) {
    if (-not (Test-Path -LiteralPath $Root)) { return }
    foreach ($entry in @(Get-ChildItem -LiteralPath $Root -Force)) {
        if ($PreservedDirectories -contains $entry.Name) {
            Write-Host "  保留使用者資料：$($entry.Name)" -ForegroundColor DarkGray
            continue
        }
        Remove-Item -LiteralPath $entry.FullName -Recurse -Force
    }
}

function Copy-Package([string]$PackageRoot, [string]$Destination) {
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    # 專案根目錄同時放著 macOS 資料夾與 Safari 的 Xcode 專案，那些跟 Windows 安裝無關，
    # 只搬共用的 Extension 與 Bridge，加上這個資料夾裡的啟動腳本。
    foreach ($name in @('Extension', 'Bridge')) {
        Copy-Item -LiteralPath (Join-Path $PackageRoot $name) -Destination (Join-Path $Destination $name) -Recurse -Force
    }
    foreach ($entry in @(Get-ChildItem -LiteralPath $ScriptRoot -File)) {
        Copy-Item -LiteralPath $entry.FullName -Destination (Join-Path $Destination $entry.Name) -Force
    }
    Set-Content -LiteralPath (Join-Path $Destination 'version.txt') -Value "$ProductName $ProductVersion" -Encoding UTF8
}

function New-StartupShortcut([string]$Root) {
    $startupFolder = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
    if ([string]::IsNullOrWhiteSpace($startupFolder)) {
        throw '找不到使用者的啟動資料夾。請確認 Windows 使用者設定後重試。'
    }
    New-Item -ItemType Directory -Path $startupFolder -Force | Out-Null
    $shortcutPath = Join-Path $startupFolder $StartupShortcutName
    $launcher = Join-Path $Root 'Start-Bridge.ps1'
    $silentLauncher = Join-Path $Root 'Start-Bridge.vbs'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    # powershell.exe -WindowStyle Hidden 仍會在登入時閃一下主控台視窗，因為視窗是
    # 先建立再隱藏。改用 wscript 執行 VBS，從頭到尾不會建立可見視窗。
    $wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
    if ((Test-Path -LiteralPath $silentLauncher) -and (Test-Path -LiteralPath $wscript)) {
        $shortcut.TargetPath = $wscript
        $shortcut.Arguments = "//nologo `"$silentLauncher`""
    } else {
        $powerShell = Get-PowerShellPath
        $shortcut.TargetPath = $powerShell
        $shortcut.Arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
    }
    $shortcut.WorkingDirectory = $Root
    $shortcut.Description = "$ProductName 本機 Bridge"
    $shortcut.Save()
    Write-Ok "已建立登入啟動：$shortcutPath"
}

function Start-Bridge([string]$Root) {
    $launcher = Join-Path $Root 'Start-Bridge.ps1'
    if (-not (Test-Path -LiteralPath $launcher)) {
        throw '找不到 Bridge 啟動腳本。請重新安裝完整的 Windows 資料夾。'
    }
    $silentLauncher = Join-Path $Root 'Start-Bridge.vbs'
    $wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
    if ((Test-Path -LiteralPath $silentLauncher) -and (Test-Path -LiteralPath $wscript)) {
        Start-Process -FilePath $wscript -ArgumentList @('//nologo', $silentLauncher) -WorkingDirectory $Root -WindowStyle Hidden | Out-Null
        return
    }
    $powerShell = Get-PowerShellPath
    $arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
    Start-Process -FilePath $powerShell -ArgumentList $arguments -WorkingDirectory $Root -WindowStyle Hidden | Out-Null
}

function Wait-Bridge([int]$Port) {
    $healthUrl = "http://127.0.0.1:$Port/health"
    foreach ($attempt in 1..15) {
        Start-Sleep -Milliseconds 400
        try {
            $response = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 2
            if ($response.ok) { return $true }
        } catch { }
    }
    return $false
}

function Find-Browser([string]$CommandName, [string[]]$Candidates) {
    return Resolve-Executable $CommandName $Candidates
}

function Open-BrowserSetup {
    $extension = Join-Path $InstallRoot 'Extension'
    Start-Process -FilePath 'explorer.exe' -ArgumentList @("`"$extension`"") | Out-Null
    try {
        Set-Clipboard -Value $extension -ErrorAction Stop
        Write-Ok '已把擴充功能資料夾路徑複製到剪貼簿。'
    } catch {
        Write-Warn '無法自動複製路徑；請使用下方顯示的完整路徑。'
    }

    $chrome = Find-Browser 'chrome.exe' @(
        (Join-IfValue $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
        (Join-IfValue $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-IfValue ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')
    )
    if ($chrome) {
        Start-Process -FilePath $chrome -ArgumentList @('chrome://extensions') | Out-Null
        Write-Ok '已開啟 Chrome 擴充功能頁。'
    } else {
        Write-Warn '找不到 Chrome；請手動開啟 chrome://extensions。'
    }

    $edge = Find-Browser 'msedge.exe' @(
        (Join-IfValue $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe'),
        (Join-IfValue $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
        (Join-IfValue ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
    )
    if ($edge) {
        Start-Process -FilePath $edge -ArgumentList @('edge://extensions') | Out-Null
        Write-Ok '已開啟 Edge 擴充功能頁。'
    } else {
        Write-Warn '找不到 Edge；請手動開啟 edge://extensions。'
    }

    Write-Host "`n請在每個瀏覽器設定檔開啟開發人員模式，再按「載入未封裝項目」。" -ForegroundColor White
    Write-Host '在選擇資料夾的視窗按 Ctrl + L、Ctrl + V、Enter，再按「選取資料夾」。' -ForegroundColor White
    Write-Host 'In the folder picker, press Ctrl + L, Ctrl + V, Enter, then Select Folder.' -ForegroundColor White
    Write-Host "  $extension" -ForegroundColor White
}

$packageRoot = Find-PackageRoot
if ($WhatIf -or $ValidateOnly) {
    Assert-Package $packageRoot
    $node = Resolve-Node $packageRoot
    $agy = Get-AntigravityPath
    $opencode = Get-OpenCodePath
    Write-Host "$ProductName $ProductVersion：驗證完成（未修改系統）。" -ForegroundColor Green
    Write-Host "  Node.js：$(if ($node) { $node } else { '未找到；請先安裝 https://nodejs.org 的 LTS 版。' })"
    Write-Host "  Antigravity：$(if ($agy) { $agy } else { '未找到；可稍後安裝，Bridge 仍可啟動。' })"
    Write-Host "  OpenCode：$(if ($opencode) { $opencode } else { '未找到；可稍後安裝。' })"
    exit 0
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw '此腳本只能在 Windows 執行；在其他系統請使用 -ValidateOnly。'
}

Assert-Package $packageRoot
$nodePath = Resolve-Node $packageRoot
if (-not $nodePath) {
    throw @'
找不到 Node.js。

ImmerseFree 的本機服務需要 Node.js 才能執行。請先安裝 LTS 版：
  https://nodejs.org/  （或用 winget install OpenJS.NodeJS.LTS）
安裝完成後重新開啟這個安裝程式即可。
'@
}

$agyPath = Get-AntigravityPath
$opencodePath = Get-OpenCodePath

Write-Host "$ProductName $ProductVersion 安裝程式" -ForegroundColor White
Write-Host "安裝位置：$InstallRoot" -ForegroundColor DarkGray
Write-Step '停止舊服務並更新程式檔'
Stop-BridgeProcesses $InstallRoot
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
Remove-ProgramContents $InstallRoot
Copy-Package $packageRoot $InstallRoot
Write-Ok '程式檔已複製；使用者資料與翻譯快取已保留。'

Write-Step '設定登入啟動'
New-StartupShortcut $InstallRoot

if (-not $NoLaunch) {
    Write-Step '啟動本機 Bridge'
    Start-Bridge $InstallRoot
    if (Wait-Bridge 27843) {
        Write-Ok '本機 Bridge 已啟動：http://127.0.0.1:27843'
    } else {
        Write-Warn "本機 Bridge 尚未回應；錯誤訊息在 $(Join-Path $InstallRoot 'helper-error.log')。"
    }
}

Write-Step '開啟瀏覽器擴充功能頁'
Open-BrowserSetup
Write-Host "`n安裝完成。Antigravity：$(if ($agyPath) { '已找到' } else { '未找到' })；OpenCode：$(if ($opencodePath) { '已找到' } else { '未找到' })。" -ForegroundColor Green
