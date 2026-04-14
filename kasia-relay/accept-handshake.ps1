# Set $env:KASPA_MNEMONIC_A and $env:PEER in your shell before running.
if (-not $env:KASPA_MNEMONIC_A) { Write-Error "KASPA_MNEMONIC_A env var not set"; exit 1 }
if (-not $env:PEER) { Write-Error "PEER env var not set"; exit 1 }

Write-Host "=== Relay (Account C) accepting handshake from qrtr00 ===" -ForegroundColor Cyan
node D:\Anthropic\kasia-suite\kasia-relay\chat_a.mjs handshake
