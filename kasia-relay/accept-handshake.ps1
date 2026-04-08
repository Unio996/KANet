$env:KASPA_MNEMONIC_A = "REDACTED_MNEMONIC_B"
$env:PEER = "kaspa:qrtr00qnq7zaydyf2tpv8s8uz3xdjtrzjnwn4qnee862dk42fnevs3rakdsv0"

Write-Host "=== Relay (Account C) accepting handshake from qrtr00 ===" -ForegroundColor Cyan
node D:\Anthropic\kasia-suite\kasia-relay\chat_a.mjs handshake
