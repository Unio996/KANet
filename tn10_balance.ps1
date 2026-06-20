$address = "kaspatest:qpa4z45nxuqptg8cvewyyt8t9mvs7tcrh5l2yv69y5sqrh5y8mywc98naqkhk"
$uri = "http://127.0.0.1:16215"

# Use gRPC to check balance via kaspa-wallet
$walletExe = "D:\kaspa-tn10-data\kaspad-v2.0.0-official\kaspa-wallet.exe"
if (Test-Path $walletExe) {
    Write-Host "Wallet exe found: $walletExe"
    # Try to query via wallet CLI
}

Write-Host "Node height: querying..."
Write-Host "Address: $address"
Write-Host "gRPC: $uri"
