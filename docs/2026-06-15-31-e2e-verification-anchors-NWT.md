# #31 找零核弹 e2e 验证锚点规格 (NWT, gate B Phase C/D)

> NWT-tn 2026-06-15。配 J1 fixture-generator（100-winner 确定性数据 + 预期 payoutRoot/payouts）+ J1 harness test_31_chunk_settle_e2e.mjs。
> 用途：J1 落 harness Phase A-cross/C/D 时的验证锚点（验什么、怎么验、断言）。跑 gated ④ relay wire + 双节点部署。
> 守红线：机制验证非经济闭环（G5，testnet 零价值）。

## 数据基准（J1 fixture）
- 100 bettor 密钥对 + stake（1KAS 均匀，全 winning side → 100 winner）。
- fixture **预期值**（off-chain 算，作链上实际值的比对基准）：预期 payoutRoot、预期 per-winner payout[]（computePoolPayouts，含 dust→winners[0]）、预期 broker fee、预期 committee bond。
- 100 winner > MAX_K=47 → 触发 chunk-chain：预期 partition [40,47,13]（chunk_0=40 storage-bound, chunk_i=47, last=13）。

## Phase A-cross (§8.1 实跨节点 2-assert) — gated 双节点
e2e 跑前的**前置门**（mid-flight fork 比 pre-fail 贵）：
- **① payoutRoot byte-equal**：:3300 与 :3200 各对 fixture 100 winner 算 computePoolPayouts→payoutRoot → emit hex → byte-equal。不等=禁跑（committee 签的 root 与某节点算的不符=fork）。
- **② spine-P2SH byte-equal**：:3300 与 :3200 各 computeSpineP2SH_v08(ctor16) → p2shHash → byte-equal。不等=资金锁址命门（两节点不同址→花不了）。
- 任一不等 → HALT，禁进 Phase C。

## Phase C (on-chain settle) — gated ④ relay wire
逐 chunk 链上结算 + 双节点独立落链验：
- **每 chunk**：build settle_chunk/aggregate TX → broadcast → **check_utxo_landed 双节点独立验**（:3200 + :3300 各 `POST /api/relay/:id/send-command {type:check_utxo_landed,address,txid}` 查 confirmed）→ landed 才续下 chunk（NO-TX-NO-STATE，不信 local 信链）。
- **最终断言**（全 chunk 落链后）：
  1. 每 winner output：value == fixture 预期 payout[i] **且** scriptPubKey == P2PK(winnerPk[i])（recipient+amount 双绑）。
  2. broker output[0]：value == 预期 broker fee 且 scriptPubKey == P2PK(brokerPk)，value>=1000。
  3. 5 committee output[1-5]：value >= oracleBondAmount 且 scriptPubKey == P2PK(c0-c4Pk)。
  4. 末 chunk change == 0（hwm 链终，全付完）。
  5. 守恒：Σ(所有 chunk 所有 output) + Σ minerFee == pool-lock input（逐 sompi）。
  6. 每 chunk minerFee <= maxChunkFee(1e8)。

## Phase D (§8.3b cross-node resume) — gated ④ + 双节点
crash-recovery 跨节点续付：
- :3300 settle chunk_0,1（落链）→ **杀 :3300** → :3200 scan market-shard v08 P2SH unspent → **assert count==1**（链尾，0=已完成/>1=ANOMALY HALT）→ read state.hwm → 续 chunk_2.. → 末 change==0。
- **断言**：① 无双付（winner [0,hwm) 不被 :3200 重付）② 无漏付（winner [hwm,end) 续付）③ 末 change==0 ④ 所有 winner 最终收到 == fixture 预期 payout ⑤ resume 读的是**链上 confirmed** unspent-tip（非 :3300 local cache，防 crashed-after-build-before-land 的 local 超前）。

## 验证工具
- check_utxo_landed：relay send-command（:3200 + :3300 各跑，走各自 kaspad 看整链）。详见 reference-chain-verify-via-relay-check-utxo-landed。
- byte-equal：两节点各 emit hex → 字符串比对。
- 守恒/金额：链上 UTXO value（introspection）vs fixture 预期值（BigInt 逐 sompi）。

## 边界
- Phase A-cross 必先过再进 Phase C（前置门）。
- Phase C 每 chunk check_utxo_landed 才续（不并行，chunk_i+1 花 chunk_i change）。
- Phase D 必双节点真杀（非同进程模拟）才坐实 cross-node resume。
