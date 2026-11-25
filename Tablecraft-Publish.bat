@echo off
rem Publishes the server module to the local SpaceTimeDB server, keeping the data already there.
rem Usage: Tablecraft-Publish.bat [database name]   (tablecraft-studio when left out)
setlocal
cd /d "%~dp0"
call scripts\windows-tools.bat || (pause & exit /b 1)
set "DATABASE=%~1"
if not defined DATABASE set "DATABASE=tablecraft-studio"
call spacetime publish %DATABASE% --module-path server --server http://127.0.0.1:3000 --delete-data=never -y
set "CODE=%errorlevel%"
if defined TABLECRAFT_PAUSE pause
exit /b %CODE%
