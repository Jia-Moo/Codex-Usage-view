@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [Codex Usage View] Node.js 22+ is required.
  pause
  exit /b 1
)
node src\server.mjs --hide-titles
if errorlevel 1 pause
