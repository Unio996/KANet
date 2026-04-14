# Set $env:KASPA_MNEMONIC_A and $env:PEER in your shell before running.
if (-not $env:KASPA_MNEMONIC_A) { Write-Error "KASPA_MNEMONIC_A env var not set"; exit 1 }
if (-not $env:PEER) { Write-Error "PEER env var not set"; exit 1 }

Write-Host "=== Step 1: Handshake ===" -ForegroundColor Cyan
node D:\Anthropic\kasia-suite\kasia-relay\chat_a.mjs handshake

Write-Host "`n=== Step 2: Send message ===" -ForegroundColor Cyan
node D:\Anthropic\kasia-suite\kasia-relay\chat_a.mjs send "你好，relay测试！来自qrtr00"

Write-Host "`n=== Step 3: Poll for reply (等5秒) ===" -ForegroundColor Cyan
Start-Sleep -Seconds 5
node D:\Anthropic\kasia-suite\kasia-relay\chat_a.mjs poll
