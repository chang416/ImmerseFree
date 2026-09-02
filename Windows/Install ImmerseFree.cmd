@echo off
rem ImmerseFree Windows launcher.
rem
rem Keep this file pure ASCII, CRLF, and WITHOUT a BOM.
rem  * cmd.exe decodes a batch file with the current console code page, so
rem    non-ASCII bytes here are mis-parsed on a cp437 (English) or cp950
rem    (Traditional Chinese) console, which is what Windows 10 gives you.
rem  * A UTF-8 BOM makes cmd.exe try to run "<BOM>@echo off" and fail.
rem All Chinese text lives in the .ps1 files instead. Those are UTF-8 *with*
rem BOM, which is exactly what Windows PowerShell 5.1 needs in order not to
rem read them as ANSI.
setlocal

rem Switch the console to UTF-8 so the Chinese output of the PowerShell script
rem below is not turned into question marks on an English or Japanese Windows.
rem Not restored on purpose: reading the current code page back means parsing
rem localised `chcp` output, and this window closes when the script ends.
chcp 65001 >nul

set "SCRIPT_DIR=%~dp0"
rem Always Windows PowerShell 5.1 (System32), never pwsh 7: the OCR helper
rem needs WinRT types, which only load on the .NET Framework build.
set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS_EXE%" set "PS_EXE=powershell.exe"

"%PS_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Install.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
    echo.
    echo ImmerseFree install failed. Exit code: %EXIT_CODE%
    echo The reason is printed above by the PowerShell script.
    pause
)
endlocal & exit /b %EXIT_CODE%
