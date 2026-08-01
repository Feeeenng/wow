$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if ((Test-Path -LiteralPath $cargoBin) -and ($env:Path -notlike "*$cargoBin*")) {
    $env:Path = "$cargoBin;$env:Path"
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw "Rust is not installed. Install Rustup before starting Tauri."
}

& "$PSScriptRoot\node_modules\.bin\tauri.cmd" @args
exit $LASTEXITCODE
