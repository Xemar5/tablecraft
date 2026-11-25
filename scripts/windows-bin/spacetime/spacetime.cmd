@echo off
rem Runs the portable SpaceTimeDB CLI as "spacetime" (see scripts\windows-tools.bat).
if exist "%LOCALAPPDATA%\prototyper-tools\spacetime\spacetimedb-cli.exe" (
  "%LOCALAPPDATA%\prototyper-tools\spacetime\spacetimedb-cli.exe" %*
) else (
  echo The SpaceTimeDB CLI was not found. Install it from https://spacetimedb.com/install
  exit /b 1
)
