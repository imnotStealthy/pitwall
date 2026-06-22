@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node 20+ : https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install || (echo [ERROR] npm install failed & pause & exit /b 1)
)

if not exist ".env" if exist ".env.example" copy ".env.example" ".env" >nul

echo.
echo Starting FH6 telemetry server...
echo OBS Browser Source : http://localhost:9000
echo (Ctrl+C to stop)
echo.
node src\server.js

pause
