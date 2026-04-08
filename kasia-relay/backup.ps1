# kasia-relay 备份脚本
# 用法: .\backup.ps1
# 备份到 D:\Anthropic\backups\kasia-relay-<timestamp>\

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$src = "D:\Anthropic\kasia-suite\kasia-relay"
$dst = "D:\Anthropic\backups\kasia-relay-$timestamp"

$exclude = @("node_modules", ".git")

Write-Host "备份 kasia-relay → $dst"

New-Item -ItemType Directory -Path $dst -Force | Out-Null

Get-ChildItem -Path $src -Recurse | Where-Object {
    $rel = $_.FullName.Substring($src.Length + 1)
    $top = $rel.Split([IO.Path]::DirectorySeparatorChar)[0]
    $exclude -notcontains $top
} | ForEach-Object {
    $target = $_.FullName.Replace($src, $dst)
    if ($_.PSIsContainer) {
        New-Item -ItemType Directory -Path $target -Force | Out-Null
    } else {
        Copy-Item -Path $_.FullName -Destination $target -Force
    }
}

Write-Host "完成。备份位置: $dst"
Write-Host "文件列表:"
Get-ChildItem -Path $dst -Recurse -File | Select-Object -ExpandProperty FullName
