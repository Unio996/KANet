# bshard close_attest 自治-enforce daemon 设计 (Track B / production-trustless)

2026-06-22 · J2 框架 + J1 co-design (verify-value-source 域) · 起因=J2 verify-not-echo 查到 enforce 边界=driver-side/test-only

## 问题陈述 (code-verified, 四方 affirm)

bshard close_attest 的 命门③(winningSide)+命门④(fee broker/intro/committee)enforcement **目前只跑在 test driver / probe**:

1. **relay `sign_input_for_settle` handler 盲签** (`kasia-relay/src/relay.mjs` L609-637):
   `createInputSignature(tx, input_index, wallet.privkey, SighashType.All)` — 无 verify、无 re-derive、给啥签啥。
2. **`enforceCommitteeSign` 调用方只有** `scripts/_j2_c_settle.mjs` (test driver) + `_nwt_probe_menmen3.mjs` (probe)。
   `kasia-console/src/services/` 无 production 自治 bshard close settler。
3. **PayoutShard.sil close_attest entry 链上只 enforce**: ①`blake2b(委员pks)==committeePkHash`(但 committeePkHash 是
   **witness arg** 非 ctor-baked → 不绑 pool_merkle_root)②`blake2b(predicate_commit)!=predicate_commit`(L84 no-op sanity,
   winningSide==judgeLine 是 "oracle phase later" L82 链上**没** enforce)③5 distinct Schnorr sig over sighash。
   ∴ 链上仅保证 **"5 个 distinct key 签了 SOME payoutRoot"**,不绑①正确委员②payoutRoot==judgeLine。

**含义**: 恶意 settler 当 driver → 跳过 enforce 或用 5 个 sybil keypair 直接 call sign → relay 盲签任意 payoutRoot(偷池/付假 fee 地址)。
全 trustless **靠链下委员独立验**,而该验证**当前不存在于 production**。命门③/④ teeth(含 Track B 验过的)=**honest-driver 自审**,挡不住恶意 settler。

## 对照: prediction-market 路已有的 trustless 模式

`bettor-prediction-voter.js` = 每 oracle 的**自治 voter daemon**: recv Phase-2 DM sign 请求 → **独立验自己 vote outcome + redeem_hash** → 才 call sign_input_for_settle。
relay.mjs L612-614 注释证实这是设计意图。**bshard close_attest 没有等价物** = 唯一缺口。

## 方案: bshard close_attest 自治 voter daemon (镜像 prediction-voter)

每个节点跑该 daemon,watch 自己 oracle 在委员集的 close_attest 签名请求,签前**独立 enforce**:

```
settler (任意方, 不信任)
  └─ 广播 close_attest SIGN-REQUEST (event/DM): { preimage(safe_json), predicate, frozen_evidence,
       claimed_payoutRoot, ps_redeem_hex, fee_params, bettors, market_id }
        └─ 每委员节点 daemon (自治, 各自):
             1. 该 market 我的 oracle 被 sample 进委员? (loadCommittee/re-derive 自查)
             2. enforce 独立验:
                · 命门① predicate: blake2b(canonical(predicate))==链上 predicate_commit (从被签 PS input redeem 读)
                · 命门③ winningSide: judgeLine(predicate, FROZEN evidence) == claimed payoutRoot 隐含方向
                · 命门④ fee: computeMarketCommit(predicate, fee_recipients)==链上 commit (broker/intro 链锚) +
                            fix① committee re-derive (pool_merkle_root + endBlockHash + selectCommittee) == fee-leaf 收款集
                · payoutRoot: re-derive(pari-mutuel + fee leaves) == claimed
             3. **只 PASS 才** call 本节点 oracle relay sign_input_for_settle → 广播 sig
             4. FAIL → 拒签(不广播)
  └─ settler 收 ≥4 sig → submit close_attest
```

**trust 模型**: honest majority of 委员**节点**(各自独立验)。恶意 settler 无法伪造其他节点 oracle 的 sig
(那些节点 daemon 独立 enforce 拒签)。= 与 prediction-voter 同强度,与现有 4-of-5 committee 假设一致。

## fix① 在此架构的位置

fix①(enforce 从链锚 pool_merkle_root + endBlockHash re-derive 委员,零 caller/DB 信任)= daemon enforce 的 **committee 轴验证组件**。
单独落在 driver-side enforce 无 production trustless 价值(driver 可绕),但**是 daemon 复用的 canonical verify 函数** → 现在落不浪费。

### fix① re-derive 三锚 (Bettor+J1 sharpen)
- **predicate_commit**: PS redeem offset-518 ctor-baked (J2 probe) ✓ 链锚
- **pool_merkle_root**: PS redeem ctor 常量 (.sil L4-5 "同 predicate_commit baked") → 需 J2 probe 其 offset ✓ 链锚
- **pool members (oracle pks)**: rebuild merkle == 链上 pool_merkle_root 才用 (否则毒 snapshot 偏委员集)
- **pool stakes**: J1 查实 root 只 commit pks 不 commit stakes → stakes=链上 oracle bond (oracle_stake_enrollments),
  各诚实节点独立同观测 → 快照一致 (残留: 观测窗口差/快照后 bond 变 = determinism 风险, 用 create-time 快照锚)
- **endBlockHash**: enforce 内自 `fetchEndBlockHashCanonical(chainReader, deadline_daa)` (anti-grinding) — **不能 passed** (Bettor: 否则毒从 committeePks 移到 endBlockHash)
- **seed**: `deriveCommitteeSeed(market_id, endBlockHash, pool_merkle_root)` 上三派生

## 关键设计问题 (待 J1 co-design)

1. **frozen_evidence 分发**: 委员签前用**冻结共享 ESPN 快照**非各自 live-fetch (determinism + 403 自伤铁律,
   `project-oracle-consensus-launders-poison-rulings`)。snapshot 谁产、怎么绑进 sign-request、各委员怎么验它是 canonical?
2. **跨进程**: enforce 逻辑在 kasia-console (lib judgeLine/deriveFeeLeaves/sampler), relay 是独立进程。
   daemon 跑在 console-side (像 prediction-voter) → console 验完 call 本地 relay sign IPC。✓ 不需 relay 导 console 码。
3. **请求传输**: 复用 prediction Phase-2 DM (`kanet_oracle_tx_sign_req_v1`) 还是新 bshard event 类型?
4. **predicate availability**: 委员需真 predicate (非 hash) 跑 judgeLine → 从自己 market 记录读 + 验 hash==链上 commit。
5. **liveness**: 委员 daemon 多久 tick / DM-driven? quorum-timeout-refund 路 (committee liveness fix 复用)。

## 范围 / 非范围

- **范围 (B)**: 自治 daemon + enforce 搬进签名决策 + fix① re-derive 组件。
- **非范围 (今天)**: 链上 close_attest .sil 强制 winningSide==judgeLine + committee-identity 绑 pool_merkle_root
  (= "oracle phase" SS 大改, J1 SS 域, 分阶段 "shape now behavior later")。daemon 是链下 honest-majority,
  足够 production testnet;mainnet 前评估是否需链上加固。
