# Refresh the AI thread registry: scan native harness history, then reconcile.
# Designed to run from a harness Stop hook. Never throws, never blocks a
# session — any failure is swallowed and the script always exits 0.

$ErrorActionPreference = 'SilentlyContinue'

try {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) {
        foreach ($candidate in @(
            "$env:ProgramFiles\nodejs\node.exe",
            "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
        )) {
            if (Test-Path $candidate) { $node = $candidate; break }
        }
    }
    if (-not $node) { exit 0 }

    $scan = Join-Path $scriptDir 'scan-session-history.mjs'
    $reconcile = Join-Path $scriptDir 'reconcile-threads.mjs'
    $applyNames = Join-Path $scriptDir 'apply-thread-names.mjs'

    & $node $scan --days 30 *> $null
    & $node $reconcile *> $null
    # Stamp "[Stage] title" onto Codex session names so the picker shows them.
    & $node $applyNames *> $null
}
catch {
    # Intentionally swallowed — a board refresh must never break a session.
}

exit 0
