$ErrorActionPreference = "Stop"

$targetPath = Join-Path $PSScriptRoot ".env"
if (Test-Path -LiteralPath $targetPath) {
    throw "本地 .env 已存在，未覆盖既有配置。"
}

function New-LocalSecret {
    # 只生成十六进制随机值，避免数据库连接 URL 中出现未转义分隔符。
    $bytes = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    return -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

$template = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot ".env.example")
$content = $template.Replace("REPLACE_WITH_GENERATED_DATABASE_PASSWORD", (New-LocalSecret))
$content = $content.Replace("REPLACE_WITH_GENERATED_STORAGE_ACCESS_KEY", ("wow-local-" + (New-LocalSecret).Substring(0, 20)))
$content = $content.Replace("REPLACE_WITH_GENERATED_STORAGE_SECRET_KEY", (New-LocalSecret))
$content = $content.Replace("REPLACE_WITH_GENERATED_PLAYBACK_SIGNING_KEY", (New-LocalSecret))
$encoding = New-Object System.Text.UTF8Encoding($false)
$stream = [System.IO.File]::Open($targetPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
try {
    $bytes = $encoding.GetBytes($content)
    $stream.Write($bytes, 0, $bytes.Length)
} finally { $stream.Dispose() }
Write-Host "已生成本机云端配置 .env；凭证未输出，服务尚未启动。"
