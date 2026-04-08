$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$src = "D:\Anthropic\agent-adapter"
$dst = "D:\Anthropic\backups\agent-adapter-$timestamp"

$exclude = @("node_modules", ".git")

Write-Host "备份 agent-adapter → $dst"
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

Write-Host "完成: $dst"
