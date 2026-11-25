@echo off
rem Type-checks and builds the app into dist\ (npm run build).
setlocal
cd /d "%~dp0"
call scripts\windows-tools.bat || (pause & exit /b 1)
call npm run build
set "CODE=%errorlevel%"
if defined TABLECRAFT_PAUSE pause
exit /b %CODE%
