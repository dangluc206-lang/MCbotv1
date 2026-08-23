@echo off
setlocal
cd /d "%~dp0\.."
where node >nul 2>nul || (
  echo [ERROR] Node.js 22+ is required for source/development mode.
  pause
  exit /b 1
)
where npm >nul 2>nul || (
  echo [ERROR] npm is required for source/development mode.
  pause
  exit /b 1
)
set NEED_INSTALL=0
if not exist node_modules\electron\dist\electron.exe set NEED_INSTALL=1
node -e "require('extract-zip');require('yauzl')" >nul 2>nul || set NEED_INSTALL=1
if "%NEED_INSTALL%"=="1" (
  echo Installing and synchronizing Desktop dependencies...
  call npm install
  if errorlevel 1 goto :fail
)
call npx --no-install electron .
exit /b %errorlevel%

:fail
echo [ERROR] Desktop startup preparation failed.
pause
exit /b 1
