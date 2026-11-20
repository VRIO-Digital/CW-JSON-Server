# Triggers a frontend deploy on cw.vriodigital.com from your local Windows machine.
#
# Run this one — ./deploy-frontend.sh is NOT meant to run here. That script uses sudo,
# systemctl and /home/ubuntu paths that only exist on the EC2 box itself; running it in
# PowerShell does nothing because none of that exists on Windows. This one just opens an
# SSH connection and runs the real script over there.
#
#   .\trigger-deploy.ps1
#
# One-time setup if ssh refuses the key ("UNPROTECTED PRIVATE KEY FILE" or similar): Windows'
# OpenSSH client checks that the .pem is readable only by you, the same way Linux's chmod 600
# does. Fix it once with:
#   icacls ContextWeave-application.pem /inheritance:r
#   icacls ContextWeave-application.pem /grant:r "$($env:USERNAME):(R)"

$ErrorActionPreference = "Stop"

$pemPath = Join-Path $PSScriptRoot "ContextWeave-application.pem"
$sshTarget = "ubuntu@cw.vriodigital.com"
# Runs the real script in its own directory on the server — see deploy-frontend.sh for what
# it actually does and why (it is the one with the real comments).
$remoteCommand = "cd /home/ubuntu/CW-JSON-Server && ./deploy-frontend.sh"

if (-not (Test-Path $pemPath)) {
    Write-Error "Can't find the key at $pemPath"
    exit 1
}

ssh -i $pemPath -o ConnectTimeout=10 $sshTarget $remoteCommand
exit $LASTEXITCODE
