@echo off
rem Starts Tablecraft in development mode (npm run dev) and opens it in the browser. Ctrl+C stops it.
setlocal
cd /d "%~dp0"
call scripts\windows-tools.bat || (pause & exit /b 1)
call npm run dev
if errorlevel 1 if defined TABLECRAFT_PAUSE pause
