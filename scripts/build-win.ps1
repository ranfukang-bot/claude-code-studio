$ErrorActionPreference = "Stop"
Write-Host "Installing dependencies..."
npm install
Write-Host "Running typecheck..."
npm run typecheck
Write-Host "Building Windows installer and portable exe..."
npm run pack:win
Write-Host "Done. Check the release/ folder."
