$p = Get-Process -Id 38932 -ErrorAction SilentlyContinue
if ($p) {
    $mb = [math]::Round($p.WorkingSet64/1MB, 1)
    Write-Host "PID 38932 alive - WorkingSet: $mb MB, CPU: $($p.CPU)s, Start: $($p.StartTime)"
} else {
    Write-Host "Process 38932 NOT FOUND"
}
