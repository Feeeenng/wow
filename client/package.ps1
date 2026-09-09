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

$ffmpegRuntime = Join-Path $PSScriptRoot "src-tauri\resources\ffmpeg-runtime\bin"
$ffmpegFiles = @{
    "avcodec-62.dll" = "a44d7291d3197ae43a4cdfaaf40657ef84b52b12af285065cc58fc116b3b8fe0"
    "avdevice-62.dll" = "631cd7c66d3add6e5860bbc44d97b0209bd53b041391afa5325ab0da9b98564b"
    "avfilter-11.dll" = "3ab7bd9e9c10b0b78c5cbe5ec67c028fe3e2c483569a6659980e4e31eea7e97b"
    "avformat-62.dll" = "45f41775de35a5b4b9bf43b24f59f9212d46eeb345cd93e6298c73146050f112"
    "avutil-60.dll" = "dc6506b46593e2e176a7ba4e414bd8458d9c254ca55ebf496b3e9e7057c43a65"
    "ffmpeg.exe" = "0241868dcac3c253e0db98029b484632769772b840f0eb3c921bcdfde5756aaf"
    "swresample-6.dll" = "559b3fd4e1ff54d9b0ed93d4b44a589144143629ebb84d0c22291b53e8d96860"
    "swscale-9.dll" = "668e624456d7e3698edda98760a126c78d78ee148326f31c3198925db8b5a0b0"
}
foreach ($file in $ffmpegFiles.GetEnumerator()) {
    $path = Join-Path $ffmpegRuntime $file.Key
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "缺少内置 FFmpeg 组件：$path"
    }
    $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
    if ($actualHash -ne $file.Value) {
        throw "内置 FFmpeg 组件 SHA-256 校验失败：$($file.Key)"
    }
}

Write-Host "[1/3] Checking bundled live and FFmpeg runtimes"
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
