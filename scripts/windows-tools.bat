@echo off
rem Shared setup for the Tablecraft-*.bat launchers. Puts Node, npm and the SpaceTimeDB CLI on PATH for the launcher
rem that calls it: installed copies when there are any, otherwise the portable tools in %LOCALAPPDATA%\prototyper-tools.
set "TABLECRAFT_TOOLS=%LOCALAPPDATA%\prototyper-tools"
where node >nul 2>nul || set "PATH=%TABLECRAFT_TOOLS%;%PATH%"
rem The portable npm can't run from its own folder (its npm.cmd expects a Node.js install around it), so the
rem scripts\windows-bin\npm shims run it through node.
where npm >nul 2>nul || set "PATH=%~dp0windows-bin\npm;%PATH%"
rem The portable SpaceTimeDB CLI is spacetimedb-cli.exe; scripts\windows-bin\spacetime\spacetime.cmd lets "spacetime"
rem (and the npm db:* scripts) find it.
where spacetime >nul 2>nul || set "PATH=%~dp0windows-bin\spacetime;%PATH%"
where node >nul 2>nul || (echo Node.js was not found. Install a supported Node.js version, or the portable tools in %TABLECRAFT_TOOLS%. & exit /b 1)
rem A launcher double-clicked in Explorer (cmd /c ""file.bat" ", which ends in a space once the quotes are gone) keeps
rem its window open at the end so its output can be read; from a terminal it doesn't.
set "TABLECRAFT_PAUSE="
set "TABLECRAFT_CMDLINE=%cmdcmdline:"=%"
if "%TABLECRAFT_CMDLINE:~-1%"==" " set "TABLECRAFT_PAUSE=1"
exit /b 0
