@echo off
rem Runs any npm command with the Tablecraft tools on PATH, for example:
rem   Tablecraft-Npm.bat run db:generate
rem   Tablecraft-Npm.bat run cli -- --help
setlocal
cd /d "%~dp0"
call scripts\windows-tools.bat || (pause & exit /b 1)
call npm %*
set "CODE=%errorlevel%"
if defined TABLECRAFT_PAUSE pause
exit /b %CODE%
