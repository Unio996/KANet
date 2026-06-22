# NWT 红队独立验收 — J1 D2 + C2 闭 (commit 86523223)

2026-06-22 · NWT (verify-value-source 红队) · 独立行级复核 + 源码级核 + 独立攻击 harness。**verify-not-echo**: 不信注释, 对照实码/共识源/链上口径坐实。

承接 `docs/2026-06-22-NWT-redteam-verdict-2291daa1.md`。J1 在 86523223 闭 **D2 (verify-value-source 最承重命门) + C2-anchor**。

**总口径(诚实)**: D2 ✅ **真闭, airtight** (源码级证 + 3-impl byte-match teeth)。C2 ✅ **逻辑+锚闭** (1 个 stake-skew 残口属 daemon-hook 域, 见下)。
⚠ **Track B 仍未 production-trustless**: E1 (daemon ctx 未 wire) / D4 (relay no-bypass) / D1 (dedup) / C3-assert / D5 仍开 = J2 棒。本验收只覆盖 enforce **逻辑层**。

---

## 🔴 D2 — ✅ 真闭 (airtight, 最承重)

J1 修: `verifyClosePayoutRootBinding` 从被签 `txSafeJson` 反解 **covenant-bound continuation output** 的 P2SH scriptPubKey, 验 == `p2sh(splice(psRedeem, closed=1, payoutRoot=reDerivedRoot))`。caller 标量降 defense-in-depth。

### NWT 最深攻击 = 'move-binding decoy' — 已被【共识层 sighash】堵死 (源码核实)
我假设的命门: D2 用 `covenant.covenantId != null` 识别 continuation。**若 covenant binding 不被 sighash 覆盖**, 恶意 settler 收委员 sig 后把 binding 从真 continuation(R_bad)挪到 decoy(R_good)→ enforce 看 decoy 通过 → 签了 R_bad tx。
**核实 (rusty-kaspa `consensus/core/src/hashing/sighash.rs` L228-238)**:
```
pub fn hash_output(hasher, output, version) {
  hasher.write_u64(output.value);
  hash_script_public_key(hasher, &output.script_public_key);   // ← 嵌 payoutRoot
  if version >= 1 {
    hasher.write_bool(output.covenant.is_some());
    if let Some(c)=&output.covenant { hasher.write_u16(c.authorizing_input).update(c.covenant_id); }  // ← covenant 被 sighash 覆盖
  }
}
```
→ `outputs_hash` (L197, SIGHASH_ALL 时 hash 全部 outputs) 含每个 output 的 covenant binding。close_attest tx = **version 1** (p2sh.mjs L1782) + SIGHASH_ALL → **covenant binding 被签名覆盖** → settler 收 sig 后无法挪 binding(挪了 sig 失效)→ **'move-binding decoy' 攻击在共识层被堵**。D2 identification airtight。

### NWT 新发现 = version-gate (已修)
上面 airtight 性 **依赖 tx.version>=1**(version 0 不折 covenant)。J1 原码**不校验 version** → 理论上 settler 送 v0 txSafeJson 可绕 identification(虽 v0 close_attest 另会 9999-units BUST, 但 verify-value-source 铁律: 别靠"它会在别处 BUST")。
**修 (J1 本次 + NWT flag)**: `verifyClosePayoutRootBinding` 加 `if (Number(signedTx.version) < 1) reject`。

### teeth (3-impl byte-match, NWT 独立 harness `scripts/nwt-trackb-d2-c2-redteam.mjs`)
honest continuation 用【两条独立路】triangulate:
- 路A: silverc 重编 `closed=1+payoutRoot` ctor (= claim driver 口径)
- 路B: relay-faithful `_serializePayoutStateHex` 全 state 区替换 (= p2sh.mjs `_continuationAddress` 口径)
- 路A P2SH == 路B P2SH ✅, 且 J1 内部 splice(第三路)接受两者 → **3-impl byte-match** (证 splice 非 vacuous、口径真等于链上)。
攻击全 BUST: 假根-标量 / move-binding-decoy / version-0 / continuation-无-covenant。**11/11**。

---

## 🟠 C2 — ✅ 逻辑+锚闭, 残 1 stake-skew (daemon 域)

J1 修: `reDeriveCommittee` poolMerkleRoot 从【链锚 PS redeem】读 (`extractOnChainPoolMerkleRoot`, 5 inlined 委员-check 副本 cross-check fail-loud), DB root 必 == 链锚, 种子+成员校验用链锚 root。

### NWT 核实
- `extractOnChainPoolMerkleRoot` offset `[1002,1266,1530,1794,2058]` 对【本 repo PayoutShard.sil】probe 实证 (5 副本一致 == genesis poolMerkleRoot)。.sil-pinned (= offset-518 同款), drift → cross-check fail-loud (安全降级, 永不 wrong-pass)。daemon 应优先 `ctx.onChainPoolMerkleRoot` (scout 链读)绕 offset。✅
- 攻击 BUST: 子集-委员 (buildPoolMerkleTree(子集) != 链锚) / DB-relay-假root (DB != 链锚)。

### 🟠 NWT 残口 (verify-value-source, daemon-hook 域) — stake 未链锚 → 委员选择 skew
`selectCommittee` 是 **stake-weighted**, 但 poolMerkleRoot 只 commit **pks 不 commit stakes**。`members[].stake_sompi` 来自 `ctx.loadPoolSnapshot` (DB)。
**攻击**: settler 供【正确 pk 集(过 root 校验)+ 虚高 stake 给他控成员】→ selectCommittee 偏向选他控委员 → 他们签 → 链上 `require(cXCur ∈ poolMerkleRoot)` 只验 pk 成员**不验 stake** → 过 → 偏置委员会得逞。
**修 (daemon/J2, 非 enforce 逻辑能独闭)**: `loadPoolSnapshot` 的 stakes 必是【本节点 scout 自观测的链上 oracle bond】, 非 settler 中继 DB。各诚实节点同观测 → 同 stake → 同 selectCommittee。**进 §3 硬属性: stakes 链锚 = C2 完整闭的前提。**

---

## 🟡 C1 complete-set — aggregate 闭, per-ticket 待 live (J1 已诚实标定)
`verifyBettorsCompleteFromChain`: 聚合链锚 (Σcount/Σstake/Σyes/Σno 从 chain-anchored leaf state, leaf addr==落地址) 闭, anti-omission/anti-dir-tamper 有牙。per-ticket (anti-swap) 依赖 `shardPoolId=_hex32(LM-shard-N)` + ticket-addr 派生口径, **未对真 on-chain ticket byte-equal 验** (lib 顶部诚实标 待 live, J1 域)。NWT 复核: 逻辑分支正确, 真闭待 (A)-model live e2e。

---

## scorecard (NWT 独立)
| 项 | 状态 | 证据 |
|---|---|---|
| D2 root-from-signed-tx | ✅ 真闭 airtight | sighash 源码 L228-238 + 3-impl byte-match + version-gate |
| C2 poolMerkleRoot 链锚 | ✅ 锚闭 | extract 5-副本 cross-check + 子集/DB-relay BUST |
| C2 stake 链锚 | 🟠 残 (daemon) | stake-weighted 选择 + stake 不在 root → loadPoolSnapshot 必 scout 自观测 |
| C1 aggregate | ✅ 闭 | Σ 链锚 + omission/dir-tamper 有牙 |
| C1 per-ticket (anti-swap) | 🟡 logic-only | shardPoolId/ticket-addr byte-equal 待 live |
| E1/D4/D1/C3-assert/D5 | 🔴 开 | J2 daemon 棒 |

**下一棒**: J2 闭 E1 (注入链锚 ctx hook, 尤其 loadPoolSnapshot 的 **stake 必 scout 自观测** = C2 残口) + D4 relay-gate + C3 daemon-assert(`签的 tx hash == verifiedTxHash`) + D1 dedup-by-market。 (A)-model live e2e 后验 C1 per-ticket byte-equal。
