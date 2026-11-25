@echo off
rem Runs the portable npm (%LOCALAPPDATA%\prototyper-tools\package) with the node on PATH (see scripts\windows-tools.bat).
node "%LOCALAPPDATA%\prototyper-tools\package\bin\npm-cli.js" %*
