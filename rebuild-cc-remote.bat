@echo off
setlocal enabledelayedexpansion
title CC Remote - Rebuild

echo ==============================
echo   CC Remote - Rebuild
echo ==============================
echo.
set "PD=%~dp0"
cd /d "%PD%"

echo [INFO] Pulling latest...
git pull --rebase 2>nul
if errorlevel 1 echo [WARN] Not a git repo or offline, skipping pull

echo [INFO] Installing deps...
call pnpm install
if errorlevel 1 (echo [FAIL] Install failed & pause & exit /b 1)

echo [INFO] Building...
call pnpm build
if errorlevel 1 (echo [FAIL] Build failed & pause & exit /b 1)

echo ==============================
echo   Rebuild Complete!
echo ==============================
echo.
echo   Run start-cc-remote.bat to start.
echo.
pause
