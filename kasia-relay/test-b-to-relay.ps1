$env:KASPA_MNEMONIC_A = "reject bulk rapid citizen myself health rally expand solution tide person cargo"
$env:PEER = "kaspa:qptg465n4jedfujewj3hfgkxtysq40v2jakxp2w6uuvrhf6sajf0kzewvmcmv"

Write-Host "=== Step 1: Handshake ===" -ForegroundColor Cyan
node D:\Anthropic\kasia-suite\kasia-relay\chat_a.mjs handshake

Write-Host "`n=== Step 2: Send message ===" -ForegroundColor Cyan
node D:\Anthropic\kasia-suite\kasia-relay\chat_a.mjs send "你好，relay测试！来自qrtr00"

Write-Host "`n=== Step 3: Poll for reply (等5秒) ===" -ForegroundColor Cyan
Start-Sleep -Seconds 5
node D:\Anthropic\kasia-suite\kasia-relay\chat_a.mjs poll
