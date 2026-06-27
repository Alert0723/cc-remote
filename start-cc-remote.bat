@echo off
setlocal enabledelayedexpansion
title CC Remote

:: Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [FAIL] Node.js not found in PATH
    pause
    exit /b 1
)

:: Check startup.js
set "SDIR=%~dp0packages\server"
if not exist "%SDIR%\dist\startup.js" (
    echo [FAIL] startup.js not found: %SDIR%\dist\startup.js
    pause
    exit /b 1
)

cd /d "%SDIR%"

:: Default to foreground mode (supports hot restart auto-relaunch)
:: Use --new-window to open in a separate window (no auto-restart)
set "FLAGS="

:: If user passed specific flags, use those instead of default
echo %* | findstr /c:"--" >nul
if not errorlevel 1 set "FLAGS=%*"

echo.
echo ==============================
echo   CC Remote
echo ==============================
echo.
echo Starting server...
echo Scan QR code on your phone, then select a session in the UI.
echo Input help to see available commands.
echo.

node dist\startup.js %FLAGS%

set ERR=%errorlevel%

echo.
echo ==============================
echo Exit code: %ERR%
echo ==============================

exit /b %ERR%
