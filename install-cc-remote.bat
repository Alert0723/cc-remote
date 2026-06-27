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

set "PD=%~dp0"

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
echo   Run start-cc-remote.bat to start the service.
echo.
pause
