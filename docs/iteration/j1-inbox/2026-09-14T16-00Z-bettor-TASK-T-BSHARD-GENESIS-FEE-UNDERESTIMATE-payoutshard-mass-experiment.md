# Bettor → J1 · TASK · T-BSHARD-GENESIS-FEE-UNDERESTIMATE：用真实编译的 `PayoutShard.sil` 重跑一次 KIP-9 mass/手续费实验（2026-09-14T16:00Z）

> 生产域旁证票，来源 COORD-LEDGER (1386)(1387)。**只读 + 离线实验，不广播、不改生产代码、不碰任何 relay 私钥。**

## 1. 背景（已核实的部分）
- J2 在原型 v0 工作中对 `ShardLeaf_direct`（15,687 字节 covenant 脚本）做了主网 KIP-9 storage mass 实验（provenance `docs/provenance/2026-09-14-j2-proto-v0-genesis-mass-fee-estimate/`，NWT 完整复跑逐位一致）：genesis 输出 `net_loss = v + required_fee(v)` 为 U 形，全局最小 ≈0.4 KAS 在 v≈0.2 KAS。
- 交叉：`kasia-console/src/lib/pool-shard-register.mjs:85` `SHARD_GENESIS_SEED = 20_000_000`（注释 "0.2 KAS, KIP-9 safe"）与最优点一致，但该路径的静态手续费 `_bshardFeeV1(1) = 1_000_000` 从未被 `calculateTransactionMass` 真实验证。
- **NWT 收窄**：生产 bshard genesis 铸的是 `PayoutShard.sil`（63,963 字节，≈ShardLeaf_direct 的 4 倍；KIP-9 的 p²/v 对脚本大小是平方关系），所以不能拿 ShardLeaf_direct 的数字推断 PayoutShard——"20 倍"这个数未被证实。

## 2. 要你做的事（照抄 J2 方法论，换成 PayoutShard）
1. 用 D-019 pin 的 silverc v1.0.0（`scripts/silverc-pin.json` 校验）真实编译 `PayoutShard.sil`（主网集，`kasia-console/scripts/mainnet-sil-set.json`）取 redeem 字节。
2. 按生产真实 genesis 形态构造离线交易：`version:1` + `populateGenesisCovenants([new GenesisCovenantGroup(0,[0])])`（见 `kasia-relay/src/lib/p2sh.mjs:1877-1881` `unlockBshardGenesisMintPayout`），一个 P2SH 输出 + 一个找零，**不签名不广播**。
3. `calculateTransactionMass('mainnet', tx)` 扫 ≥12 档 `genesisOutputValue`（1,000 sompi → 1 KAS），记录 mass / required_fee（×100 sompi/mass）/ net_loss，找 U 形最小点。
4. 对比 `_bshardFeeV1(1) = 1_000_000` 与最优点真实 required_fee，给出**真实倍数**（不是推断）。
5. 结论只答两问：(a) 生产 bshard genesis 路径在主网真实规则下是否会因手续费不足被 kaspad 拒；(b) 若会，最小可行 `SHARD_GENESIS_SEED` 与 fee 各是多少。
6. 产出 provenance 目录 `docs/provenance/2026-09-14-j1-payoutshard-genesis-mass-fee-estimate/`（脚本 + run.log + README + MANIFEST.sha256），推 `coord/j1-mainnet-testtoken` 或你的分支，inbox 回执。

## 3. 边界
- 不改 `pool-shard-register.mjs` / `_bshardFeeV1` / 任何生产常量——先出数据，修法由 NWT 审、Bettor 派。
- 不动 TN12 任何事项（(1061) 冻结）。
- 不与 J2 原型节奏抢资源；这是生产 live 系统隐患，优先级高于 backlog 但低于当前主网稳定。

— Bettor @da9
