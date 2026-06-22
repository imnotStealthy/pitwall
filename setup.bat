@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node 20+ : https://nodejs.org
  pause
  exit /b 1
)

if not exist ".env" if exist ".env.example" copy ".env.example" ".env" >nul

echo Installing dependencies (ws, dotenv, electron)...
call npm install || (echo [ERROR] npm install failed & pause & exit /b 1)

if not exist "electron\assets\tray.png" node electron\assets\make-icon.cjs

echo.
echo Setup complete.
echo  - On-screen overlay (no console) : double-click FH6-Overlay.vbs
echo  - Server only, for OBS           : double-click start.bat
echo.
pause
