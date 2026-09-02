#Requires -Version 5.1
<#
    ImmerseFree 本機 Bridge 啟動器

    這個腳本由安裝程式及登入捷徑呼叫。Runtime\node.exe 存在時優先使用，
    否則依序尋找 PATH 與常見的系統 Node.js 位置。Antigravity 與 OpenCode
    的常見位置會加入本次 Bridge 程序的 PATH，不會複製設定或保存金鑰。
#>

[CmdletBinding()]
param([switch]$WhatIf)

$ErrorActionPreference = 'Stop'
$ProductName = 'ImmerseFree'
$InstallRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Join-IfValue([string]$Base, [string]$Child) {
    if ([string]::IsNullOrWhiteSpace($Base)) { return $null }
    return Join-Path $Base $Child
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

$BridgeScript = Join-RelativePath $InstallRoot 'Bridge\server.mjs'

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
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { return (Get-FullPath $candidate) }
    }
    return $null
}

function Resolve-Node {
    $bundled = Join-RelativePath $InstallRoot 'Runtime\node.exe'
    if (Test-Path -LiteralPath $bundled) { return (Get-FullPath $bundled) }
    return Resolve-Executable 'node.exe' @(
        (Join-IfValue $env:ProgramFiles 'nodejs\node.exe'),
        (Join-IfValue ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
        (Join-IfValue $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
    )
}

function Resolve-Antigravity {
    return Resolve-Executable 'agy.exe' @(
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
}

function Resolve-OpenCode {
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

# log 只在啟動時檢查一次。超過上限就把舊的挪成 .1，留一份可查的歷史，
# 同時保證單一檔案不會無限長大（Bridge 若在崩潰迴圈裡會不停寫入）。
function Reset-LogFile([string]$Path) {
    $maxBytes = 5MB
    try {
        $item = Get-Item -LiteralPath $Path -ErrorAction SilentlyContinue
        if ($item -and $item.Length -ge $maxBytes) {
            $previous = "$Path.1"
            if (Test-Path -LiteralPath $previous) { Remove-Item -LiteralPath $previous -Force -ErrorAction SilentlyContinue }
            Move-Item -LiteralPath $Path -Destination $previous -Force -ErrorAction SilentlyContinue
        }
    } catch { }
}

if (-not (Test-Path -LiteralPath $BridgeScript)) {
    throw '找不到 Bridge\server.mjs。請重新安裝完整的 Windows 資料夾。'
}
$node = Resolve-Node
if (-not $node) {
    throw '找不到 Node.js。請將 Runtime\node.exe 放入安裝目錄，或安裝 Node.js LTS 後重試。'
}
$agy = Resolve-Antigravity
$opencode = Resolve-OpenCode

if ($WhatIf) {
    Write-Host "$ProductName：只驗證啟動設定，未啟動服務。"
    Write-Host "  Node：$(if ($node) { $node } else { '未找到' })"
    Write-Host "  Antigravity：$(if ($agy) { $agy } else { '未找到' })"
    Write-Host "  OpenCode：$(if ($opencode) { $opencode } else { '未找到' })"
    exit 0
}

$bridgeDirectory = Join-Path $InstallRoot 'Bridge'
$pathEntries = @()
if ($agy) { $pathEntries += Split-Path -Parent $agy }
if ($opencode) { $pathEntries += Split-Path -Parent $opencode }
if ($pathEntries.Count -gt 0) {
    $env:Path = (($pathEntries | Select-Object -Unique) -join ';') + ';' + $env:Path
}

$env:IMMERSEFREE_PORT = if ($env:IMMERSEFREE_PORT) { $env:IMMERSEFREE_PORT } else { '27843' }
$arguments = "`"$BridgeScript`""

# Bridge 是隱藏視窗啟動的，不導向檔案的話它印的任何東西（含「連接埠被佔用」
# 這種啟動失敗訊息）都會直接消失，使用者永遠看不到失敗原因。
# 檔名與 macOS 版一致：helper.log / helper-error.log。
$stdoutLog = Join-Path $InstallRoot 'helper.log'
$stderrLog = Join-Path $InstallRoot 'helper-error.log'
Reset-LogFile $stdoutLog
Reset-LogFile $stderrLog

# 這裡用 -NoNewWindow 而不是 -WindowStyle Hidden：一旦帶了 Redirect*，Start-Process
# 會走 UseShellExecute=false，而 WindowStyle 在那個模式下不生效，登入時反而會冒出
# 一個黑色主控台視窗。-NoNewWindow 才是真的不建立視窗（本腳本自己是隱藏執行的）。
Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $bridgeDirectory `
    -NoNewWindow -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog | Out-Null
