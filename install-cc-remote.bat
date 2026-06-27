@echo off
setlocal enabledelayedexpansion
title CC Remote - Setup

echo ==============================
echo   CC Remote - Environment Setup
echo ==============================
echo.
echo [CHECK] Node.js...
where node >nul 2>&1
if errorlevel 1 (echo [FAIL] Node.js not found & pause & exit /b 1)
echo [CHECK] pnpm...
where pnpm >nul 2>&1
if errorlevel 1 (echo [INFO] Installing pnpm... & npm install -g pnpm)
echo [CHECK] Git...
where git >nul 2>&1
if errorlevel 1 (echo [FAIL] Git not found & pause & exit /b 1)
set TD=%USERPROFILE%\.claude\tools\
set PD=%TD%cc-remote

if exist "%PD%" (
    echo [INFO] Already exists: %PD%
    echo [INFO] Skipping clone, will reinstall...
) else (
    echo [INFO] Cloning from Gitee...
    if not exist "%TD%" mkdir "%TD%"
    git clone https://gitee.com/alert0723/cong.claude.git "%TD%cong.claude" 2>nul
    if errorlevel 1 git clone https://github.com/Alert0723/cong.claude.git "%TD%cong.claude"
    if exist "%TD%cong.claude\tools\cc-remote" (
        xcopy /E /I /Y "%TD%cong.claude\tools\cc-remote" "%PD%" >nul
    ) else if exist "%TD%cong.claude\.claude\tools\cc-remote" (
        xcopy /E /I /Y "%TD%cong.claude\.claude\tools\cc-remote" "%PD%" >nul
    ) else (
        echo [FAIL] cc-remote not found in cloned repo
        rmdir /S /Q "%TD%cong.claude" 2>nul
        pause
        exit /b 1
    )
    rmdir /S /Q "%TD%cong.claude" 2>nul
    echo [OK] Cloned
)

echo.
echo [INFO] Installing dependencies...
cd /d "%PD%"
call pnpm install
if errorlevel 1 (echo [FAIL] Install failed & pause & exit /b 1)
echo [OK] Dependencies installed

echo [INFO] Building...
call pnpm build
if errorlevel 1 (echo [FAIL] Build failed & pause & exit /b 1)
echo [OK] Build successful

echo ==============================
echo   Setup Complete!
echo ==============================
echo.
echo   Run start-cc-remote.bat to start the service:
echo   %PD%\start-cc-remote.bat
echo.
pause
