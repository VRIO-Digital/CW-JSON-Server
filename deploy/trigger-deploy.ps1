# Triggers a deploy on cw.vriodigital.com from your local Windows machine.
#
# Run this one — the ./deploy-*.sh scripts are NOT meant to run here. They use sudo, systemctl
# and /home/ubuntu paths that only exist on the EC2 box itself; running them in PowerShell does
# nothing because none of that exists on Windows. This one just opens an SSH connection and runs
# the real script over there.
#
#   .\trigger-deploy.ps1             # frontend only (default — same as always)
#   .\trigger-deploy.ps1 backend     # pull + restart the mock server, only if backend/*.js changed
#   .\trigger-deploy.ps1 all         # both, frontend first
#   .\trigger-deploy.ps1 all -Force  # both, forcing the backend restart even with no code change
#
# One-time setup if ssh refuses the key ("UNPROTECTED PRIVATE KEY FILE" or similar): Windows'
# OpenSSH client checks that the .pem is readable only by you, the same way Linux's chmod 600
# does. Fix it once with:
#   icacls ContextWeave-application.pem /inheritance:r
#   icacls ContextWeave-application.pem /grant:r "$($env:USERNAME):(R)"

param(
    [ValidateSet("frontend", "backend", "all")]
    [string]$Target = "frontend",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$pemPath = Join-Path $PSScriptRoot "ContextWeave-application.pem"
$sshTarget = "ubuntu@cw.vriodigital.com"
$script = switch ($Target) {
    "frontend" { "deploy-frontend.sh" }
    "backend"  { "deploy-backend.sh" }
    "all"      { "deploy-all.sh" }
}
$scriptArgs = if ($Force -and $Target -ne "frontend") { " --force" } else { "" }
# Runs the real script from its own directory on the server, git-tracked under deploy/ — see
# that script for what it actually does and why (it is the one with the real comments). Nothing
# is scp'd here any more: once this file itself is pulled on the server, every later edit to a
# deploy script reaches it the same way, through its own safe_pull.
#
# **`bash $script`, never `./$script`.** Git committed from this Windows checkout never carries
# the executable bit — Windows has no such permission to record, so every commit from here
# writes these scripts back as mode 100644 — and `./script.sh` on the 100644 file that lands from
# a pull is a flat "Permission denied". Invoking through `bash` reads the file rather than
# executing it as a binary, so the bit never matters.
$remoteCommand = "cd /home/ubuntu/CW-JSON-Server/deploy && bash $script$scriptArgs"

if (-not (Test-Path $pemPath)) {
    Write-Error "Can't find the key at $pemPath"
    exit 1
}

ssh -i $pemPath -o ConnectTimeout=10 $sshTarget $remoteCommand
exit $LASTEXITCODE
