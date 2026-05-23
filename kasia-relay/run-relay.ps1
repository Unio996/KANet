# Set $env:KASPA_MNEMONIC in your shell before running this script.
if (-not $env:KASPA_MNEMONIC) { Write-Error "KASPA_MNEMONIC env var not set"; exit 1 }
node D:\Anthropic\kasia-suite\kasia-relay\src\relay.mjs
