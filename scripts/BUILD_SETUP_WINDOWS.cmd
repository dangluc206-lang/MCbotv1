@echo off
setlocal
cd /d "%~dp0\.."
echo ==========================================
echo          MCbot Desktop Builder
echo ==========================================
echo.
where node >nul 2>nul || (
  echo [ERROR] Node.js 22+ is required to build MCbot.
  pause
  exit /b 1
)
node scripts\build-windows.js %*
if errorlevel 1 goto :fail
if exist "out\make\squirrel.windows\x64" explorer "out\make\squirrel.windows\x64"
pause
exit /b 0

:fail
echo.
echo [ERROR] Build failed. Read the output above.
echo [TIP] For detailed build/installer logs run:
echo       scripts\BUILD_SETUP_WINDOWS.cmd --verbose
pause
exit /b 1
