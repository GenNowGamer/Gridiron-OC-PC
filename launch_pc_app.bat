@echo off
setlocal

cd /d "%~dp0"

if not exist "package.json" (
  echo Could not find package.json in %cd%
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found on this PC.
  echo Install Node.js first, then try again.
  pause
  exit /b 1
)

echo Launching Gridiron Play Advisor PC...
call npm start

if errorlevel 1 (
  echo.
  echo The app did not start successfully.
  pause
  exit /b 1
)

endlocal
