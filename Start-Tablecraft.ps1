param(
    [switch]$Database,
    [switch]$Publish
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if ($Database -and $Publish) { throw 'Choose either -Database or -Publish, not both.' }

$portableTools = Join-Path $env:LOCALAPPDATA 'prototyper-tools'
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    $nodePath = $node.Source
} elseif (Test-Path "$portableTools\node.exe") {
    $nodePath = "$portableTools\node.exe"
} else {
    throw 'Install a supported Node.js version, then run npm ci.'
}
$env:PATH = "$(Split-Path $nodePath);$env:PATH"

if ($Database -or $Publish) {
    $cli = Get-Command spacetime -ErrorAction SilentlyContinue
    if ($cli) {
        $cliPath = $cli.Source
    } elseif (Test-Path "$portableTools\spacetime\spacetimedb-cli.exe") {
        $cliPath = "$portableTools\spacetime\spacetimedb-cli.exe"
    } else {
        throw 'Install the SpaceTimeDB CLI to run multiplayer services.'
    }
    if ($Database) {
        & $cliPath start --listen-addr 127.0.0.1:3000 --data-dir "$env:LOCALAPPDATA\tablecraft-spacetimedb" --non-interactive
    } else {
        & $cliPath publish tablecraft-studio --module-path server --server http://127.0.0.1:3000 --delete-data=never -y
    }
} else {
    if (!(Test-Path 'node_modules\vite\bin\vite.js')) { throw 'Dependencies are missing. Run npm ci first.' }
    & $nodePath 'node_modules\vite\bin\vite.js' --host 127.0.0.1 --port 5173 --strictPort
}
exit $LASTEXITCODE
