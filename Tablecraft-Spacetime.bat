@echo off
rem Runs any SpaceTimeDB CLI command with the Tablecraft tools on PATH, for example:
rem   Tablecraft-Spacetime.bat login show
rem   Tablecraft-Spacetime.bat list --server http://127.0.0.1:3000
setlocal
cd /d "%~dp0"
call scripts\windows-tools.bat || (pause & exit /b 1)
call spacetime %*
set "CODE=%errorlevel%"
if defined TABLECRAFT_PAUSE pause
exit /b %CODE%
