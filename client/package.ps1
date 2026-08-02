$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if ((Test-Path -LiteralPath $cargoBin) -and ($env:Path -notlike "*$cargoBin*")) {
    $env:Path = "$cargoBin;$env:Path"
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw "Rust is not installed. Install Rustup before packaging."
}

$mediaRuntime = Join-Path $PSScriptRoot "src-tauri\resources\media-runtime\mediamtx.exe"
$expectedMediaRuntimeHash = "d1465085c3c9bd211fd40fb863acfd8eef988ea6ea9e36422472659f82ed4aa9"
if (-not (Test-Path -LiteralPath $mediaRuntime -PathType Leaf)) {
    throw "缺少内置直播组件：$mediaRuntime"
}
$actualMediaRuntimeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $mediaRuntime).Hash.ToLowerInvariant()
if ($actualMediaRuntimeHash -ne $expectedMediaRuntimeHash) {
    throw "内置直播组件 SHA-256 校验失败"
}

Write-Host "[1/3] Checking bundled live runtime"
Write-Host "[2/3] Installing frontend dependencies"
npm ci
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "[3/3] Building Windows client"
npm run tauri build
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$installer = Get-ChildItem "$PSScriptRoot\src-tauri\target\release\bundle\nsis\*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $installer) {
    throw "Windows installer was not generated"
}

Write-Host "Installer: $($installer.FullName)"
