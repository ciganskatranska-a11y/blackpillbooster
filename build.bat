@echo off
cd /d "%~dp0"
call npm install
call npm run dist
echo.
echo Installer: dist\Blackpill Booster Setup.exe
pause
