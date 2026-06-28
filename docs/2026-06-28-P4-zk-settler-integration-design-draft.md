# P4 — ZK-settle settler 集成 设计草稿（待 Bettor/NWT 审·不落码）

**作者**: J2 · **日期**: 2026-06-28 · **状态**: 草稿·Bettor GO 做设计·待 Bettor+NWT 审 → P3 covenant 接口锁定后落码
**配**: 实施方案 `docs/2026-06-28-ZK-settle-implementation-plan.md`（P4=我 owned）· golden-ref `docs/2026-06-28-P2-payout-guest-golden-reference.md`（byte-equal 锚）
**scope**: ZK-settle 只 fit **bshard 路**（ShardLeaf/PayoutShard/PoolRoot continuation 有累积器）·非-bshard PoolSide_v07 路不在本设计（J1 架构 fit·留旧 covenant 或 migrate）。

---

## 1. 现状 close 路（ZK 替换的对象）
当前 bshard 结算 = **close_attest + 5 委员签**（committee-TRUST）:
- settler 算 payoutRoot（off-chain BigInt exact·computePariMutuelPayout+settlePayoutRoot）
- dispatch close_attest → 委员 voter（`enforceCloseAttest`/`enforceCommitteeSign`）re-derive winningSide+payoutRoot → 4-of-5 验过才签
- payoutRoot 烤进 PS continuation output P2SH scriptPubKey（SIGHASH_ALL 覆盖 = 委员签名真绑的值）→ closed 0→1
- **信任假设**: 信 4-of-5 委员诚实 re-derive。脆性: 5 inlined merkle 副本（offsets 1002/1266/.../2058）+ sighash + 槽位（= 今晚一整类脆性）。

## 2. ZK close 路（替换 = 零委员签·一个证明）
```
settler bshard close（ZK）:
 1. gather: 从链上 PayoutShard state 读 bets_root(= inputs_commit·链锚)+ 重建 ordered bets 集(register 顺序)
 2. verdict: 预言机判决(冻结 ESPN 快照·judgeLine·= 现有 enforce 同源·verdict 进 journal)
 3. RISC0 prove(guest): 私有输入=ordered bets; guest 内:
       - 重算 bets_root(hash-chain·== journal.inputs_commit)  ← 防假押注
       - judgeLine(verdict) → winningDirection
       - computePariMutuelPayout + deriveFeeLeaves(= golden-ref byte-equal)→ payoutLeaves
       - settlePayoutRoot → payout_root
       - journal 公开 = { inputs_commit(bets_root), verdict, fee_rules_commit, payout_root }
 4. commit_to_groth16: RISC0 receipt → Groth16 压缩(~1.8KB·P1 实测能上链·140k grams<500k cap)
 5. build close_attest_zk tx:
       - sig_script = Groth16 proof args(keyless·像 P1 spend·无委员签)
       - covenant(ShardLeaf_zk/PayoutShard_zk·P3·J1): OpZkPrecompile 验 seal → 校 journal.image_id==钉死结算程序
         → 校 journal.inputs_commit == 链上 ctor-baked bets_root(非 witness·非-vacuous)→ 校 verdict/fee_rules_commit==链锚
         → 取 journal.payout_root 烤进 PS continuation P2SH(同现有 closed 0→1 + payoutRoot 机制)
 6. submit → TN12 LAND(NO TX NO TRUTH)→ winners claim 不变(payout_root 同结构·merkle claim 复用)
```
**信任假设变(两阶段·口径精确·KANet-UI 锁)**: 实为**两阶段**——① `oracle_attest_verdict`(委员/oracle attest winningSide → state attested_winner·**verdict 层 1 仍委员·非消除**·首 demo single-sig 是非命门简化可 defer)② `zk_close`(ZK 证 payout·**payout 层 2 零委员**·消 dup-address/sighash/NUM2BIN 那类脆性)。**绝不报"全零委员"**——只 payout 侧零委员。命门(非-vacuous attested_winner/bets_root 绑定)**绝不 stub**(Bettor 红线)。
> ⚠ **诚实前置(Bettor 校准·防快-LAND 错觉)**: 设计锁 ≠ e2e LAND。真前置 = P0 zk-sdk WASM port-成-Node-包(settler 调 commit_to_groth16)+ P2 Rust guest(J1 critical-path·未写)+ 本 builder。e2e LAND 是真实现 chunk·非 imminent。

## 3. journal 构造（命门·必绑链上真相·防 vacuous）
| 字段 | 值 | provenance（covenant 怎么验·非信 prover） |
|---|---|---|
| inputs_commit | bets_root（hash-chain·golden-ref §6.5） | covenant 校 == 链上 ctor-baked init_bets_root（P3·J1·非 witness） |
| verdict | 预言机判决 0/1 | covenant 校 == 链锚 verdict commit（同现有 oracle attest 源·NWT 红队） |
| fee_rules_commit | == genesis 烤 feeRules | covenant 校 == create-committed feeRules（命门④·同现有 computeMarketCommit） |
| payout_root | guest 算的根 | covenant 取它烤进 PS P2SH 作分发根（被证明锚死） |
- guest 内部 bets_root/payout_root 必 **== golden-ref byte-equal**（serializeI64 LE/blake2b dkLen32/dust 归位/hash-chain order）。漂一 bit = journal 锚错。

## 4. 集成点（settler 哪改·P3 锁定后落码）
- **替换**: `pool-market-settler.js` 现 dispatch close_attest + 委员 sign 编排（enforceCloseAttest 路）→ ZK-prove + build close_attest_zk tx。
- **复用不改**: computePariMutuelPayout/deriveFeeLeaves/settlePayoutRoot（guest 移植已 P2 byte-equal）· judgeLine（verdict）· claim builder（payout_root 同结构·winners claim 不变）· PS continuation 烤 payoutRoot 机制。
- **新增**: prove 接入模块（RISC0 prove → Groth16 compress·调 P0 port 的 zk-sdk WASM）· close_attest_zk tx builder（proof→sig_script·复用 P1 keyless spend 配方）。

## 5. prove 基础设施（开放·probe-not-model）
- **谁跑 prover**: RISC0 prove 重（分钟级 + CPU/资源）。settler 端跑? 还是独立 prover 服务? → 影响 settle 延迟 UX。
- **latency**: prove + Groth16 compress 耗时进 settle 流水设计（非即时·像现有 committee 收集窗）。
- **Groth16 compress**: zk-sdk commit_to_groth16（P1 路·~1.8KB tx）。
- **image_id 钉死**: 结算 guest 编译产 image_id·烤进 covenant（改 guest = 改 image_id = 新 covenant）。版本治理。

## 6. 依赖 + 开放问题（必 P3 锁定才落码）
1. **P3 covenant 接口**（J1·gating）: close_attest_zk tx 怎么带 proof + journal? covenant 怎么 introspect 读 bets_root（ctor-baked·NWT 红队路径）+ 验 0xa6? → 这定我 tx builder 格式。
2. **SIZE**（J1 probe 中）: ShardLeaf_zk + bets_root 过 9999? close_attest_zk redeem（含 0xa6 验 + journal 校）size? → 影响可行性。
3. **跨层 byte-equal**（命门）: guest（Rust）的 bets_root/payout_root == golden-ref（off-chain）== covenant（.sil）。我 golden-ref 是 off-chain 锚·guest 对死它·P2 闸。
4. **prove 失败处理**: prove 出不来/超时 → fallback 委员路? 还是 retry? NO TX NO STATE。
5. **首 ship 单片**（J1·shard_count=1）: 单 PayoutShard betsRoot 直接=inputs_commit·我 P4 先做单片·多片 fold 后续。

## 7. 验收（P4 闸·plan P4）
- TN12 live e2e: 建 bshard 盘 → ZK close（prove→Groth16→tx）→ **链上 LAND**（NO TX NO TRUTH）。
- J1 跨节点同证 settle_txid + NWT 红队端到端（journal vacuous/proof 伪造）+ Bettor 验落链 + byte-equal（guest payout_root == golden-ref）。
- 诚实口径: P4 live LAND = **bshard 路 ZK-settle 达成**·非"全系统脆性消失"（非-bshard 路另议）。

---
**待 Bettor+NWT 审本草稿** → 提 issue/改 → P3 covenant 接口锁定 → 我落码（prove 接入 + close_attest_zk builder）。现在纯设计·零码·守 P3 gate。
