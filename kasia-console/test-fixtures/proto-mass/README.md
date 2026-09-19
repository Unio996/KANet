# proto-mass 测试夹具（来源：NWT，只读复制，未改一个字节）

- `onchain_txs_with_parents.simnet.json` — NWT 从 simnet 节点（kaspad 2.0.1，sha256 前 8 位 `8afe6a68`）取回的批3
  四笔真实上链交易及其父交易（含节点算出的 `storageMass` / `mass` / `verboseData.computeMass`）。
- `nwt-port_mass.mjs` — NWT 按 rusty-kaspa v2.0.1（`cfafeb4c`）`consensus/core/src/mass/mod.rs` 逐行独立移植的
  storage/compute mass，刻意不参照本仓 `proto-mass-ceiling.mjs`；本仓测试用它做随机形状对拍。

出处：origin 分支 `nwt/batch3-independent-verify` @ `21e3d5c8`，`docs/provenance/2026-09-19-nwt-batch3-independent-verify/`
（`onchain_txs_with_parents.simnet.json`、`scripts/port_mass.mjs`）。simnet 数据，无真实地址、无密钥。
