#Requires -Version 5.1
# ImmerseFree Windows OCR helper.
# Input: one image path. Output: a JSON array of objects with text,
# confidence, left, top, width and height. Coordinates are normalised 0..1.

param([Parameter(Mandatory = $true)][string]$ImagePath)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Fail([string]$Message, [int]$Code) {
    [Console]::Error.WriteLine($Message)
    exit $Code
}

# 這支腳本只能跟 Windows PowerShell 5.1（powershell.exe）跑。
# WinRT 型別與 System.Runtime.WindowsRuntime 只存在於 .NET Framework；
# PowerShell 7（pwsh.exe，.NET Core）載不進來，而 #Requires -Version 5.1
# 擋不住它（7 比 5.1 大）。不先擋的話錯誤會變成
# 「元件無法載入」這種看不出真因的訊息。
if ($PSVersionTable.PSEdition -and $PSVersionTable.PSEdition -ne 'Desktop') {
    Fail 'Windows OCR 需要 Windows PowerShell 5.1（powershell.exe）；PowerShell 7（pwsh）載不入 WinRT 元件。' 2
}

if (-not (Test-Path -LiteralPath $ImagePath)) { Fail '找不到 OCR 圖片。' 1 }
$ImagePath = (Resolve-Path -LiteralPath $ImagePath).ProviderPath

$asTaskGeneric = $null
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
    $asTaskGeneric = @([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    }) | Select-Object -First 1
} catch {
    Fail 'Windows OCR 元件無法載入。' 2
}
# 沒有 StrictMode 時，$null[0] 不會丟例外，而是安靜地回 $null，
# 錯誤會拖到後面的 MakeGenericMethod 才爆，訊息完全指錯方向。
if ($null -eq $asTaskGeneric) {
    Fail 'Windows OCR 元件無法載入（找不到 WindowsRuntimeSystemExtensions.AsTask）。' 2
}

function Await($Operation, $ResultType) {
    $task = $asTaskGeneric.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    $task.Wait(-1) | Out-Null
    return $task.Result
}

try {
    $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime]
} catch {
    Fail 'Windows OCR 語言元件無法載入。' 2
}

# 優先使用繁體中文，混合中英文時仍可辨識；沒有語言包則使用使用者設定。
$engine = $null
foreach ($tag in @('zh-Hant-TW', 'zh-Hant', 'en-US')) {
    try {
        $language = New-Object Windows.Globalization.Language $tag
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
    } catch { $engine = $null }
    if ($null -ne $engine) { break }
}
if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if ($null -eq $engine) { Fail '尚未安裝 Windows OCR 語言包。' 2 }

try {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
} catch {
    Fail ("OCR 失敗：" + $_.Exception.Message) 2
}

$imageWidth = [double]$decoder.PixelWidth
$imageHeight = [double]$decoder.PixelHeight
if ($imageWidth -le 0 -or $imageHeight -le 0) { Fail 'OCR 圖片沒有有效尺寸。' 2 }

# Windows OCR 有時會在 CJK 字元間插入空白。以 code point 組合類別，避免
# 這支檔案依賴非 ASCII 正規表示式範圍。
$cjkBounds = @(0x3000, 0x303F, 0x3400, 0x4DBF, 0x4E00, 0x9FFF, 0xF900, 0xFAFF, 0xFF01, 0xFF60)
$cjkClass = '['
for ($i = 0; $i -lt $cjkBounds.Count; $i += 2) {
    $cjkClass += [char]$cjkBounds[$i] + '-' + [char]$cjkBounds[$i + 1]
}
$cjkClass += ']'
$spacePattern = '(?<=' + $cjkClass + ')[ ' + [char]0x00A0 + ']+(?=' + $cjkClass + ')'

function Normalize-Cjk([string]$Value) {
    $text = $Value
    for ($pass = 0; $pass -lt 2; $pass++) {
        $text = [regex]::Replace($text, $spacePattern, '')
    }
    return $text.Trim()
}

$lines = New-Object System.Collections.ArrayList
foreach ($line in $result.Lines) {
    $text = Normalize-Cjk $line.Text
    if ([string]::IsNullOrWhiteSpace($text)) { continue }
    $left = [double]::MaxValue
    $top = [double]::MaxValue
    $right = [double]::MinValue
    $bottom = [double]::MinValue
    foreach ($word in $line.Words) {
        $rect = $word.BoundingRect
        if ($rect.X -lt $left) { $left = $rect.X }
        if ($rect.Y -lt $top) { $top = $rect.Y }
        if (($rect.X + $rect.Width) -gt $right) { $right = $rect.X + $rect.Width }
        if (($rect.Y + $rect.Height) -gt $bottom) { $bottom = $rect.Y + $rect.Height }
    }
    if ($left -gt $right -or $top -gt $bottom) { continue }
    [void]$lines.Add([pscustomobject]@{
        text       = $text
        confidence = 1.0
        left       = [math]::Round($left / $imageWidth, 6)
        top        = [math]::Round($top / $imageHeight, 6)
        width      = [math]::Round(($right - $left) / $imageWidth, 6)
        height     = [math]::Round(($bottom - $top) / $imageHeight, 6)
    })
}

# 先按上到下，再按左到右，保持閱讀順序。
$sorted = @($lines | Sort-Object @{ Expression = { [math]::Round($_.top, 2) } }, @{ Expression = { $_.left } })
if ($sorted.Count -eq 0) {
    [Console]::Out.Write('[]')
} else {
    $json = ConvertTo-Json -InputObject $sorted -Compress -Depth 4
    if (-not $json.StartsWith('[')) { $json = '[' + $json + ']' }
    [Console]::Out.Write($json)
}
