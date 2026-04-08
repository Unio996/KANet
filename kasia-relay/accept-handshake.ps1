$env:KASPA_MNEMONIC_A = "shove dust inherit easy leader please express broom much prosper fork provide alter over ostrich budget retire subway flip friend medal busy achieve broken"
$env:PEER = "kaspa:qrtr00qnq7zaydyf2tpv8s8uz3xdjtrzjnwn4qnee862dk42fnevs3rakdsv0"

Write-Host "=== Relay (Account C) accepting handshake from qrtr00 ===" -ForegroundColor Cyan
node D:\Anthropic\kasia-suite\kasia-relay\chat_a.mjs handshake
