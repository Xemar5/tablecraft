@echo off
rem Starts the local SpaceTimeDB server for live rooms on 127.0.0.1:3000. Leave it running; Ctrl+C stops it.
setlocal
cd /d "%~dp0"
call scripts\windows-tools.bat || (pause & exit /b 1)
call spacetime start --listen-addr 127.0.0.1:3000 --data-dir "%LOCALAPPDATA%\tablecraft-spacetimedb" --non-interactive
if errorlevel 1 if defined TABLECRAFT_PAUSE pause
