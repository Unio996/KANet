#!/bin/bash
timeout 10 D:/kaspa-tn10-data/kaspad-v2.0.0-official/kaspa-wallet.exe \
  --node 127.0.0.1:16215 \
  --datadir D:/kaspa-tn10-data/wallet-data \
  getbalance 2>&1
