# J1 Track B 交付 — D2 (verify-value-source) + C2-anchor 闭 (2026-06-22)

承接 NWT 红队验收 `docs/2026-06-22-NWT-redteam-verdict-2291daa1.md` 的 **J1 棒** (verdict L105):
> J1: 闭 D2(从被签 tx 反解根)+ C1 级2(全 shard 链上重建 bettor 集)+ C2 poolMerkleRoot 链上 ctor 读。

C1 级2 已于 commit `8f633291` 落 (`verifyBettorsCompleteFromChain`)。本次闭 **D2 + C2-anchor**。
文件: `kasia-console/src/lib/bshard-close-enforce.mjs`。诚实口径: Track B 仍 **未 production-trustless** (E1 daemon-未-wire 是 J2 棒); 本交付是 enforce **逻辑层** 的命门补齐 + 离线 teeth 验。

---

## 🔴 D2 闭 — payoutRoot 验【被签 tx 实际 commit 的根】, 非 caller 旁路标量 (最承重)

**修前** (verdict D2): `if (reDerivedRoot !== String(claimedPayoutRoot))` 只验 req 旁路标量 → settler 给【匹配标量】+【txSafeJson 的 continuation output commit 另一个根】即绕过。

**修后**: 新 `verifyClosePayoutRootBinding({txSafeJson, psRedeemHex, reDerivedRoot})` —
- close_attest 把 payoutRoot 烤进 **PS continuation output 的 P2SH scriptPubKey** (SIGHASH_ALL 覆盖 = 委员签名真绑的值)。
- 委员从被签 `txSafeJson` 反解 **covenant-bound continuation output** (`covenant.covenantId != null` 唯一识别; change output = null), 验其 scriptPubKey == `p2sh(splice(psRedeem, closed=1, payoutRoot=reDerivedRoot))`。
- **单源派生** (零 silverc / 零 caller): P2SH spk = `0000`(version) ‖ `aa20`(OP_BLAKE2B+PUSH32) ‖ blake2b256(redeem) ‖ `87`(OP_EQUAL)。state splice = closed@offset(state_start+9) + payoutRoot@(state_start+18)。
- 多 covenant output → **全部**必 commit re-derived root (防 decoy: settler 加假根 cov_id-output → 任一不符 BUST; 全对 → 无论 final witness `self_out_idx` 指哪个都安全)。
- caller 标量 `claimedPayoutRoot` 降为 **defense-in-depth** (早报错配, 非 load-bearing)。

**链上口径实证** (offline probe, kaspa-wasm `D:/rusty-kaspa/wasm`):
1. `serializeToSafeJSON` output 格式: `{value, scriptPublicKey:"0000aa20<32B>87", covenant:{covenantId}|null}` — 实测。
2. P2SH scriptHash = **plain blake2b-256(redeem)** (无 key) — byte-equal kaspa `createPayToScriptHashScript`。
3. PayoutShard `state_start=1` (pool-shard-settle.mjs `state_start:1` + relay `_POOL_STATE_START=1`)。
4. splice(closed+payoutRoot 进 input redeem) == relay `_continuationAddress`(全 state 区替换) byte-equal (`_j2_A_close_attest` 实证 recompile==splice==psContAddress)。

**teeth test**: `scripts/j1-trackb-d2-payoutroot-binding-test.mjs` (7/7) — 用真 kaspa-wasm 造 txSafeJson:
- T1 honest PASS = 证【我 lib `_splice`+`_p2shSpkHex` == 真 Kaspa P2SH byte-equal】(2-impl byte-match)。
- T2/T3 D2-attack (tx commit 别的根 + 匹配标量 / decoy) → **REJECT** (修前漏过 / 修后真拒, 单变量 A/B)。
- T4 no-covenant-output / T5 parse-fail / T6 短 redeem / T7 root-灵敏度 全 fail-loud。

---

## 🟠 C2-anchor 闭 — poolMerkleRoot 从链锚 PS redeem 读, 不静默信 DB

**修前** (verdict C2): `reDeriveCommittee` 用 `snap.pool_merkle_root` (DB/snapshot) 当种子 + wantRoot → settler 中继假 root → 自选他控委员会。

**修后**:
- 新 `extractOnChainPoolMerkleRoot(psRedeemHex)` — poolMerkleRoot 是 ctor `byte[32]` 常量, silverc **inline 在每个 `require(cXCur == poolMerkleRoot)` 站点** (probe: 共 10×; close_attest 5 委员校验 = 5 副本 @ offsets `[1002,1266,1530,1794,2058]`, 264B 等距, PUSH32 前缀)。读这 5 个 **cross-check 必全相等** (任一不符 = 非-canonical .sil / silverc build-drift → **throw fail-loud, 永不 wrong-pass**)。
- `reDeriveCommittee` 现: onChain root = `ctx.onChainPoolMerkleRoot` (daemon scout 链读优先) ?? `extractOnChainPoolMerkleRoot(psRedeemHex)`; 缺则 **fail-loud**。`DB root 必 == onChain` (否则 fail-loud)。**种子 + buildPoolMerkleTree 校验都用链锚 root** (settler 不可 grind 委员选择)。
- ⚠ **.sil-pinned** (= offset-518 predicate_commit 同款 fragility): PayoutShard 22-arg shape。.sil 变 → offsets 变 → cross-check 自动 fail-loud (安全降级)。J2 daemon 应优先 `ctx.onChainPoolMerkleRoot` (scout 读 PS state) 绕过 offset 依赖。

**teeth test**: `scripts/j1-trackb-c2-poolroot-anchor-test.mjs` (8/8) — 用真 silverc 编的 PayoutShard redeem:
- T0 extractor 从真 redeem 抽 == genesis poolMerkleRoot。T1 honest → 5 委员。
- T2 DB-root 篡改 / T3 子集成员 / T4 无链锚 / T6 extractor cross-check 破坏 / T7 短 redeem → 全 fail-loud。
- T5 `ctx.onChainPoolMerkleRoot` 直接注入路 (daemon 链读) → 工作。

---

## 对 J2 (E1 daemon-wire) 的接口说明
- D2/C2 **不新增**必需 ctx hook: `verifyClosePayoutRootBinding` 用 `signRequest.{txSafeJson, psRedeemHex}` (已在 close request); C2 用 `psRedeemHex` (enforceCloseAttest 已传给 reDeriveCommittee)。
- 可选增强: daemon 注入 `ctx.onChainPoolMerkleRoot` (scout 读 PS UTXO state) → 绕过 offset-pin, 更 robust。
- C3 仍待 daemon: enforce 返 `verifiedTxHash` (= blake2b(D2-验过的同一 txSafeJson)), daemon 签前必 `assert(被签 tx hash === verifiedTxHash)`。

## 残留 (非 J1 棒)
E1 (daemon ctx 契约) / D4 (relay no-bypass gate) / D1 (dedup-by-market) / D5 (refund permissionless, Track A) — 见 verdict scorecard。
