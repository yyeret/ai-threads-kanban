# Install the AI Thread Board on Windows.
#
#   1. Resolve a registry root and persist it to %USERPROFILE%\.config\ai-threads-kanban\registry-root.
#   2. Render slash-command templates with this repo's path and copy them
#      into each detected harness (Claude / Codex / Gemini).
#   3. Wire scripts\refresh-thread-board.ps1 into each harness's Stop hook
#      (Codex auto-wired; Claude/Gemini get a TODO if their settings file
#      already exists — they need a hand-merge).
#   4. Seed the registry with a first scan.
#   5. Optionally install the board server as a Scheduled Task at logon
#      (skipped with -NoServer).
#
# Idempotent — re-running updates the slash commands to the current repo path.
#
# Usage:
#   pwsh scripts\install.ps1
#   pwsh scripts\install.ps1 -RegistryRoot 'D:\thread-board-data'
#   pwsh scripts\install.ps1 -NoServer
#   pwsh scripts\install.ps1 -Port 9000

[CmdletBinding()]
param(
  [string]$RegistryRoot = "",
  [int]$Port = 7878,
  [switch]$NoServer
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path
# $Home is a built-in read-only variable in PowerShell, no need to assign it.


function Resolve-Node {
  $candidates = @(
    (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source,
    "$env:ProgramFiles\nodejs\node.exe",
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
  )
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
  throw "node.exe not found. Install Node.js and re-run."
}

# 1. Registry root.
if (-not $RegistryRoot) {
  $ExistingConfig = Join-Path $Home ".config\ai-threads-kanban\registry-root"
  if (Test-Path $ExistingConfig) {
    $RegistryRoot = (Get-Content -Raw $ExistingConfig).Trim()
  } elseif ($env:AI_AGENT_MEMORY_ROOT) {
    $RegistryRoot = Join-Path $env:AI_AGENT_MEMORY_ROOT "projects\agent-threads"
  } else {
    $RegistryRoot = Join-Path $env:LOCALAPPDATA "ai-threads-kanban"
  }
}
$null = New-Item -ItemType Directory -Force -Path $RegistryRoot
$ConfigDir = Join-Path $Home ".config\ai-threads-kanban"
$null = New-Item -ItemType Directory -Force -Path $ConfigDir
Set-Content -Path (Join-Path $ConfigDir "registry-root") -Value $RegistryRoot -Encoding utf8
Write-Host "Registry root: $RegistryRoot"

# 1b. OS Versioning and Deployment Tracking
$PkgJson = Get-Content -Raw (Join-Path $RepoRoot "package.json") | ConvertFrom-Json
$Version = $PkgJson.version
Write-Host "Yuval-OS Version: $Version"

$VersionObj = @{
  version = $Version
  installed_at = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
  repo_path = $RepoRoot
}
$VersionJson = $VersionObj | ConvertTo-Json
Set-Content -Path (Join-Path $ConfigDir "version.json") -Value $VersionJson -Encoding utf8

$ActiveHarnesses = @()
$HarnessStatus = @{}
$HarnessesToCheck = @(
  @{ Key = "Claude"; Dir = Join-Path $Home ".claude"; Name = "Claude Code" },
  @{ Key = "Codex";  Dir = Join-Path $Home ".codex";  Name = "Codex" },
  @{ Key = "Gemini"; Dir = Join-Path $Home ".gemini"; Name = "Gemini" }
)
foreach ($h in $HarnessesToCheck) {
  $Installed = Test-Path $h.Dir
  $HarnessStatus[$h.Key] = @{ installed = $Installed; version = $Version }
  if ($Installed) {
    $ActiveHarnesses += $h.Key
    Set-Content -Path (Join-Path $h.Dir "ai-threads-version.json") -Value $VersionJson -Encoding utf8
    Write-Host "  $($h.Name) detected, writing version config."
  }
}
$AntigravityDir = Join-Path $Home ".gemini\antigravity"
$AntiInstalled = Test-Path $AntigravityDir
$HarnessStatus["Antigravity"] = @{ installed = $AntiInstalled; version = $Version }
if ($AntiInstalled) {
  $ActiveHarnesses += "Antigravity"
  Write-Host "  Antigravity detected."
}

$MachineName = (hostname).Trim()

$DeployEvent = @{
  machine = $MachineName
  version = $Version
  timestamp = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
  harnesses = $ActiveHarnesses
  status = "installed"
}
$DeployEventJson = $DeployEvent | ConvertTo-Json -Compress
Add-Content -Path (Join-Path $RegistryRoot "deployments.jsonl") -Value $DeployEventJson -Encoding utf8

$MachinesPath = Join-Path $RegistryRoot "machines.json"
$MachinesMap = @{}
if (Test-Path $MachinesPath) {
  try {
    $MachinesMap = Get-Content -Raw $MachinesPath | ConvertFrom-Json -AsHashtable
  } catch {}
}
$MachinesMap[$MachineName] = @{
  version = $Version
  last_deployed = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
  harnesses = $HarnessStatus
}
ConvertTo-Json -InputObject $MachinesMap -Depth 5 | Set-Content -Path $MachinesPath -Encoding utf8
Write-Host "Logged installation to deployments.jsonl and machines.json"

# 2. Slash commands.
function Install-Skill {
  param([string]$Skill)
  $srcDir = Join-Path $RepoRoot "skills\$Skill\commands"
  $targets = @(
    @{ Dir = Join-Path $Home ".claude\commands"; File = "claude.md";  Out = "$Skill.md" },
    @{ Dir = Join-Path $Home ".codex\prompts";   File = "codex.md";   Out = "$Skill.md" },
    @{ Dir = Join-Path $Home ".gemini\commands"; File = "gemini.toml";Out = "$Skill.toml" }
  )
  foreach ($t in $targets) {
    if ((Test-Path $t.Dir) -and (Test-Path (Join-Path $srcDir $t.File))) {
      $content = (Get-Content -Raw (Join-Path $srcDir $t.File)).Replace("{{REPO_ROOT}}", $RepoRoot.Replace("\","\\"))
      Set-Content -Path (Join-Path $t.Dir $t.Out) -Value $content -Encoding utf8
      Write-Host "  $($t.Dir | Split-Path -Leaf): $Skill"
    }
  }
}
Write-Host "Installing slash commands:"
foreach ($s in @("thread-state","finish-thread","track-thread")) { Install-Skill $s }

# 3. Stop-hook wiring.
$Refresh = Join-Path $RepoRoot "scripts\refresh-thread-board.ps1"
$CodexHooks = Join-Path $Home ".codex\hooks.json"
if (Test-Path (Join-Path $Home ".codex")) {
  if (-not (Test-Path $CodexHooks)) {
    @{ Stop = @(@{ command = $Refresh }) } | ConvertTo-Json -Depth 4 | Set-Content -Path $CodexHooks -Encoding utf8
    Write-Host "Wrote $CodexHooks"
  } elseif (-not (Select-String -Path $CodexHooks -Pattern "refresh-thread-board" -Quiet)) {
    Write-Host "TODO: add a Stop hook in $CodexHooks that runs: $Refresh"
  }
}
foreach ($f in @("$Home\.claude\settings.json", "$Home\.gemini\settings.json")) {
  if ((Test-Path $f) -and -not (Select-String -Path $f -Pattern "refresh-thread-board" -Quiet)) {
    Write-Host "TODO: add a Stop hook in $f that runs: $Refresh"
  }
}

# 4. Seed registry.
$Node = Resolve-Node
Write-Host "Seeding registry…"
& $Node (Join-Path $RepoRoot "scripts\scan-session-history.mjs") --days 30 | Out-Null
& $Node (Join-Path $RepoRoot "scripts\reconcile-threads.mjs") | Out-Null

# 5. Scheduled Task for the board server.
if (-not $NoServer) {
  $TaskName = "AI Thread Board"
  $VbsTemplate = Get-Content -Raw (Join-Path $RepoRoot "scripts\start-thread-board.vbs.template")
  $VbsRendered = $VbsTemplate.Replace("{{NODE_EXE}}", $Node).Replace("{{REPO_ROOT}}", $RepoRoot)
  $VbsPath = Join-Path $ConfigDir "start-thread-board.vbs"
  Set-Content -Path $VbsPath -Value $VbsRendered -Encoding ascii
  $Action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$VbsPath`""
  $Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "Scheduled Task '$TaskName' registered and started."
}

Write-Host ""
Write-Host "Done. Board: http://127.0.0.1:$Port"
