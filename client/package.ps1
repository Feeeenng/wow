$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if ((Test-Path -LiteralPath $cargoBin) -and ($env:Path -notlike "*$cargoBin*")) {
    $env:Path = "$cargoBin;$env:Path"
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw "Rust is not installed. Install Rustup before packaging."
}

$ffmpeg = Join-Path $PSScriptRoot "src-tauri\resources\ffmpeg\bin\ffmpeg.exe"
if (-not (Test-Path -LiteralPath $ffmpeg -PathType Leaf)) {
    throw "缺少内置 FFmpeg：$ffmpeg"
}

Write-Host "[1/3] 检查内置 FFmpeg"
Write-Host "FFmpeg: $ffmpeg"
& $ffmpeg -version | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "内置 FFmpeg 无法运行，请检查共享库是否完整"
}

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
