$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if ((Test-Path -LiteralPath $cargoBin) -and ($env:Path -notlike "*$cargoBin*")) {
    $env:Path = "$cargoBin;$env:Path"
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw "Rust is not installed. Install Rustup before packaging."
}

Write-Host "[1/2] Installing frontend dependencies"
npm ci
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "[2/2] Building Windows client"
npm run tauri build
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$installer = Get-ChildItem "$PSScriptRoot\src-tauri\target\release\bundle\nsis\*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $installer) {
    throw "Windows installer was not generated"
}

Write-Host "Installer: $($installer.FullName)"
