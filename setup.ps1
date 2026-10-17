# One-command setup for Windows: npm deps + a local Paper build server + mcb.config.json.
#   powershell -ExecutionPolicy Bypass -File setup.ps1
#   powershell -ExecutionPolicy Bypass -File setup.ps1 --accept-eula --op YourMinecraftName --install-java
# Extra arguments are passed to `mcb server setup` (see `node bin/mcb.js --help`).
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error 'Node.js 22+ is required: winget install OpenJS.NodeJS.LTS (or https://nodejs.org)'
}
$major = [int](& node -p "process.versions.node.split('.')[0]")
if ($major -lt 22) { Write-Error "Node.js 22+ is required (found $(& node -v))." }

& npm.cmd install --no-fund --no-audit
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$argsList = @($args)
if ($argsList -notcontains '--accept-eula') {
  Write-Host ''
  Write-Host 'Running a Minecraft server requires accepting the Minecraft EULA: https://aka.ms/MinecraftEULA'
  $yn = Read-Host 'Do you accept it? [y/N]'
  if ($yn -match '^[Yy]') { $argsList += '--accept-eula' }
}

& node bin/mcb.js server setup --dir ..\mc-server @argsList
Write-Host ''
Write-Host 'Start the server:  node bin/mcb.js server start'
Write-Host 'Check everything:  node bin/mcb.js doctor'
