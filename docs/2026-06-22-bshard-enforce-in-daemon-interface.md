# bshard close_attest enforce-in-daemon 接口 (Track B · J1 co-design)

2026-06-22 · J1 (co-design, verify-value-source 域) · 接 J2 daemon 骨架 (6808ab60) · 起因 = 今天 x4kpq live settle 我 :3300 手动 verify-then-sign 的自动化

## 0. 这块从哪来 (proof-of-concept = 今天真跑过)

今天 x4kpq close_attest, 我 :3300 (第5委员 a102fbde59) 手动:
收 sign-request → 独立验三 (judgeLine==NO + redeem[518]==cb620684 + payoutRoot==83c00472) → PASS 才 call 6a0a8eed sign_input_for_settle。
**Track B = 把这手动流自动化进 daemon 的"PASS才签"决策点** (= bettor-prediction-voter.js `handleTxSignReq` PB-S8-1 byzantine 防的 bshard 版)。

## 1. 核心接口 (J2 daemon 在签名决策点调这个, 替 placeholder enforceCommitteeSign)

```
enforceCloseAttest(signRequest, { rcOn, myRelayId, chainReader }) → { pass: bool, reason?, verdict? }
```

`signRequest` (从 pool_markets.metadata.bshard_close_request 取, settler 供):
`{ txSafeJson, predicate, proposed_evidence, claimedPayoutRoot, psRedeemHex, committee_pk, input_index, idx, siblings_hex, broker_pk, market_id }`

**enforce 流 (全 PASS 才 pass:true; 任一 fail → pass:false + reason, daemon 弃签不广播)**:
1. **本节点是委员?** 验 `committee_pk` ∈ 我本节点 oracle keys (loadCommittee 自查 / ecdsa_pubkey_xonly 匹配)。否则 not-my-business (skip, 非 fail)。
2. **命门① predicate hash-bind**: `blake2b(canonicalPredicate(predicate)) == psRedeemHex[518:550]` (链上 commit, fee-市场是 computeMarketCommit 含 broker/intro)。chain-bound: check_utxo_landed 验 p2sh(psRedeem)==被签 PS input 链上地址。
3. **frozen_evidence 同源** (§2, 我领): `verifyFrozenEvidence(predicate, proposed_evidence)` → match 才继续, 否则弃签 (我观测赛果≠提议)。
4. **命门③ winningSide**: `judgeLine(predicate, verified_evidence)` ∈ {YES,NO} (ABSTAIN→弃签, abstain-not-guess)。
5. **命门④ + fix① committee 链锚 re-derive** (零 caller/DB 信任): enforce 内自 `fetchEndBlockHashCanonical(chainReader, deadline_daa)` + `deriveCommitteeSeed(market_id, endBlockHash, pool_merkle_root[读链上 PS ctor])` + `selectCommittee(poolMembers[验∈pool_merkle_root], seed)` → committeePks。**不收 caller 的 committeePks** (今天 fix② vacuous 的教训: caller-passed=可伪)。
6. **payoutRoot re-derive**: `computePariMutuelPayout(bettors, winningDirection) + deriveFeeLeaves(committeePks[step5], broker_pk)` → settlePayoutRoot == `claimedPayoutRoot`。
7. 全 PASS → `{pass:true, verdict}` → daemon call `sign_input_for_settle{tx_hex:txSafeJson, input_index, safe_json}` 本节点 relay。

## 2. frozen_evidence 同源 (J1 领 · open-Q#1)

**难点**: 每委员 `judgeLine(predicate, evidence)` 必 byte-identical → 需同源 evidence。各自 live-fetch = 403/时序/字段漂移; settler 可塞 poison snapshot。

**解 = settler 提议 + 委员 verify-against-own-canonical-fetch** (trust 锚 = 委员自己的 fetch, 非 settler):
```
verifyFrozenEvidence(predicate, proposedSnapshot) → { match: bool, ownFetch, reason }
```
1. **canonical fetch**: `predicate.data_source_canonical` 固定 URL + finality 后取 **FINAL 字段** (赛果已定数据稳→各委员同取同值)。
2. **per-URL FINAL-cache** (记忆 crossnode-oracle-liveness): FINAL 结果缓存→防 voter self-DoS / 403-flood。
3. **canonical 抽取**: `extractEspnFields` (J1 D-L1 judgeLine 那套, 返 wrapper.fields) → 字段 byte-identical。
4. **比对**: `proposedSnapshot` 字段 deep-equal `ownFetch` 抽取字段 → match。
5. **abstain-not-guess**: ownFetch 字段不足 → judgeLine ABSTAIN → 弃签 (不广播 sig)。
6. **liveness 兜底** (J2 daemon): 太多委员弃签/abstain → quorum-timeout-refund (复用 committee_unformed→refund 路)。

∴ poison snapshot ≠ 诚实委员 fetch → 多数弃签 → settler 偷不了 winningSide/payoutRoot。

## 3. ⚠ load-bearing 不变量 (Bettor 红队 · 设计时钉死, daemon-在前不够)

trustless 真正靠两条, 缺一 daemon 是摆设 (绕它直接 blind-sign):
- **(a) relay sign_input_for_settle 本地不可远程触发**: relay handler / IPC 只本机可达 (非 LAN/远程)。settler 远程够不到 relay。
- **(b) 无 bypass: daemon 是本节点【唯一】call relay sign 的路, 且【每个】sign-request 必经 enforceCloseAttest**。节点上除 daemon 外没东西能 blind-触发 relay 签 close_attest。
- 威胁模型: settler 远程 + oracle 自跑诚实节点。gate = (a)远程够不到 + (b)本地只 daemon 调且必 enforce。
- **现状缺口** (今天证的): relay.mjs `sign_input_for_settle` handler = 盲签, 给啥签啥。Track B 必须: ① relay handler 加"close_attest 类签名只接受 daemon-内部调用"门 (或 relay 不直接暴露此签, 只 daemon 经受控 IPC) ② console 内除 daemon 外删/堵其他 sign_input_for_settle 调 close_attest 的路。

## 4. 分工 / 状态
- J2: daemon 骨架 (bshard-close-voter cron, 镜像 voterTick→processPoolMarket) + transport (metadata.bshard_close_request) + bshard_close_sigs 表 + (a)(b) 不变量落码。
- J1: 本接口 enforceCloseAttest + verifyFrozenEvidence (§1§2) + 接 fix① 四轴链锚 re-derive。
- Bettor: 红队 (a)(b) 不变量 + co-verify。NWT: verify-value-source 红队 (mining 后)。
- 复用今天证过的: judgeLine (D-L1) / computeMarketCommit / deriveFeeLeaves / selectCommittee / sign_input_for_settle IPC。
