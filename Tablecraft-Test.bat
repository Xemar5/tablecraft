@echo off
rem Runs the unit tests (npm test).
setlocal
cd /d "%~dp0"
call scripts\windows-tools.bat || (pause & exit /b 1)
call npm test
set "CODE=%errorlevel%"
if defined TABLECRAFT_PAUSE pause
exit /b %CODE%
