# Bettor 红队验收 — enforce lib @ 8f633291 (Track B, post-power-recovery)

2026-06-22 · Bettor (verify-value-source 红队 + 协调) · 独立行级复核 `kasia-console/src/lib/bshard-close-enforce.mjs` (含 J1 8f633291 新增 verifyFrozenEvidence + verifyBettorsCompleteFromChain) + daemon `bshard-close-voter.js`。

**verify-not-echo**: 每条对照实码行号坐实，不信注释。NWT 上版验收档 `2026-06-22-NWT-redteam-verdict-2291daa1.md` 在 **8f633291 之前**——本档复核 NWT 未看过的新 C1 码 + 复验仍开命门。

---

## 总口径(诚实标定，不变)
Track B **未达 production-trustless**，且 **autonomous-enforce 路仍一调即抛、跑不通**(E1 未闭)。x4kpq live GREEN 仍是 driver-side/手动。J1 8f633291 闭了 C1 complete-set【逻辑+mock】(诚实标"未 live 自测") + verifyFrozenEvidence【15/15 offline】，是真进展，但 **三条 load-bearing 命门(E1/D2/C2-anchor)仍开**，且我新抓 **一条 C1 结构洞(级2-B silent-skip)**。

---

## 🔴 E1 (CRITICAL, 仍开) — daemon ctx 契约不匹配，自治路不可执行
- daemon `processCloseRequest` **L98**: `enforceCloseAttest({ ...req, committee_pk: voterPk }, { rcOn, myRelayId: voter.id })` — ctx **仍只两项**。
- 真 enforce **L64** `ctx.myOracleKeys?.map(k=>k.toLowerCase()).includes(myPk)`: `myOracleKeys` undefined → `undefined?.map()` 短路 undefined → `undefined.includes(myPk)` **抛 TypeError** → daemon try/catch 吞成 errored → 每 tick errored。
- 真 enforce 需 ~8 hook: `myOracleKeys`(L64) / `fetchCanonicalEvidence`(L191,opt) / `loadPoolSnapshot`(L215) / `fetchEndBlockHashCanonical`(L228) / `chainReader`(L228) / `deadlineDaa`(L112,228) / `loadBettors`(L105) / `verifyBettorsCompleteFromChain`(L118,opt 但缺省回退本 lib 需 `db/p2sh/checkUtxoLanded`)。
- **结论**: E1 闭前 Track B 自治-enforce = 没接上。**J2 域**。

## 🔴 D2 (命门, 最承重, 仍开) — payoutRoot 验的是 caller 标量, 不是被签 tx 的根
- enforce **L130**: `if (reDerivedRoot !== String(claimedPayoutRoot))` — 验 req 旁路标量 `claimedPayoutRoot`。
- enforce **从不 parse `txSafeJson`** 取 close_attest 输出实际 commit 的根(sighash 覆盖值)。`txSafeJson` 全文件只在 **L136** 算 hash 用。
- daemon **L107** 直接签 `tx_hex: req.txSafeJson`。
- **C3 反使 D2 更糟**: verifiedTxHash(L136)把 daemon 绑死到签 `txSafeJson`，但 enforce 没验过 `txSafeJson` 的根内容 = **保证签了一个未验根的 tx**。
- **攻击**: settler 给 `claimedPayoutRoot`=正确根 R_good(过 L130) + `txSafeJson` 的 close_attest 输出 commit R_evil(偷池) → enforce 标量验过 → daemon 签 R_evil 的 tx。
- 这正是铁律 `verify-value-source-checker-must-access-binding-at-decision-time`: **验的值必须是被签名覆盖的那个值**。
- **修(J1 域)**: enforce 必从被签 `txSafeJson` 反解 input_index 对应 sighash 覆盖的 close_attest 输出根，验【它】==reDerivedRoot；verifiedTxHash 绑到验过根的那个 tx。

## 🔴 NEW — C1 级2-B per-ticket anti-swap **silent-skip 返 ok:true** (我新抓, NWT 未看过此码)
- `verifyBettorsCompleteFromChain` **L319**: `canTicket = typeof ctx.deriveTicketAddr==='function' || (ctx.silverc && typeof ctx.p2sh==='function')`。
- **L320** `if (canTicket) { ...级2-B... }` — canTicket=false 则整个 anti-swap 块**跳过**，`perTicketVerified` 留 false，**L336 仍返 `ok:true`**。
- **不一致**: 级2-A 在 `p2sh/checkUtxoLanded` 缺时 **L273-275 fail-loud**(拒 DB-only 降级，fix² 教训)；级2-B 在 `deriveTicketAddr/silverc` 缺时**静默跳过返 ok:true**——同一类降级，一个 fail-loud 一个放行。
- **后果**: J2 wire ctx 时若给 `p2sh+checkUtxoLanded`(过级2-A)但漏 `silverc/deriveTicketAddr` → 级2-B 静默不跑 → **anti-identity-swap 防御 vacuous + false-GREEN**。
- **为何 级2-B load-bearing(不能被级2-A 替)**: 级2-A 的 Σyes/Σno 绑定(L313-314)抓【聚合方向篡改】，但 **identity-swap**(把真 bettor Alice 换成等额同向 sybil Mallory)保 Σ/count 不变 → 级2-A 全过 → pari-mutuel 付 Mallory。**唯级2-B 逐 ticket 链锚(L327 check_utxo_landed)抓**。
- **修(J1 域)**: shards 非空时 ticket 链锚 primitive 缺 → **fail-loud**(对齐 L273)，不得返 ok:true。或：级2-B 设为 mandatory，缺 primitive 即 `{ok:false}`。

## 🟠 C2 anchor 仍软 (命门半闭) — poolMerkleRoot 来自 DB 非链上 ctor
- `reDeriveCommittee` **L215** `snap = await ctx.loadPoolSnapshot(marketId)`；**L229** seed 用 `snap.pool_merkle_root`(DB)。
- **L220-225** `buildPoolMerkleTree(members)==poolMerkleRoot` 只证【members 自洽 hash 到声明 root】，**不证 root 是链上真根**。
- **攻击**: settler 控 loadPoolSnapshot → 供自洽的 (members 含 sybil, root) 对 → seed 从该集选【他控委员会】→ fix① 自拒(L100)照过(myPk 真在他造的集里)。
- enforce L226-227 内联 TODO 已自认需链上读。**C2 = closed-against-inconsistent-subset, anchor-pending**。
- **修(J1 域)**: `snap.pool_merkle_root` 必 pin 到【链上 PS/spine ctor 读出的根】(ctx.onChainPoolMerkleRoot)，非 DB 自观测。**这是 fix① 的链锚地基——C2 不锚则 fix① 委员 re-derive 整条可绕。**

## 🟠 C3 daemon assert 仍缺 (返回值未用)
- enforce L136 返 `verifiedTxHash`；daemon **无** `assert(blake2b(签的 tx)===verifiedTxHash)`(grep daemon 零 `verifiedTxHash`)。现因 daemon 恰签同一 `req.txSafeJson` 而未被利用，但无强制 assert = 形同虚设。**与 D2 合修**(verifiedTxHash 必绑到验过根的 tx)。**J2 域**。

## 🟠 D4 no-bypass / D1 dedup / D5 refund-permissionless — 仍开(daemon/relay/Track A 域，非本 lib)。

---

## ✅ 真闭 (verify-not-echo 坐实)
- **D3 委员自拒非成员**: enforce L96-102 reDeriveCommittee + L100 `committee.includes(myPk)` 不在则自拒。受 C2 锚软上限。
- **verifyFrozenEvidence abstain-on-mismatch**: L188-205 委员自 fetch(L191)+ deep-equal proposed vs own(L199-202)不符则拒 + L171-174 非-FINAL 不缓存返 null → caller abstain。SSRF/https-only(L157 findExtractor)+per-URL FINAL-cache(L142-143 防 403 self-DoS)。**逻辑闭**(15/15 offline；live 自取待 e2e)。
- **C1 级2-A 聚合链锚**: L280-294 跨 listShards 全片 leaf state 必 p2sh-链锚 + Σcount/Σpool/Σyes/Σno==loaded(L311-314)。**逻辑闭**(11/11 mock；链锚 live 待)。抓 omission + 聚合方向篡改。
- **fee 全链上分发**(x4kpq 6/6) — driver-side milestone, 不变。

---

## 验收 scorecard (诚实, post-8f633291)
| 项 | 状态 | 承重 | 域 |
|---|---|---|---|
| E1 ctx 契约(自治路不可跑) | 🔴 仍开 | 阻塞全部 live | J2 |
| D2 root-from-signed-tx | 🔴 仍开 | 命门(最承重) | J1 |
| C1 级2-B silent-skip 返 ok:true | 🔴 新抓 | 命门(anti-swap vacuous) | J1 |
| C2 poolMerkleRoot 链锚 | 🟠 锚软(fix① 地基) | 命门半闭 | J1 |
| C3 daemon assert tx-hash | 🟠 开(返回值未用) | 中 | J2 |
| D4 no-bypass relay-gate | 🟠 开 | enforce 前提 | J2/relay |
| D1 dedup-by-market | 🟠 开(被 enforce 掩) | 防御纵深 | J2 |
| D5 refund permissionless | 🟠 开(跨 Track A) | liveness | Track A |
| C1 级2-A 聚合链锚 | ✅ 逻辑闭/live 待 | — | J1 |
| verifyFrozenEvidence abstain | ✅ 逻辑闭/live 待 | — | J1 |
| D3 委员自拒非成员 | ✅ 闭(受 C2 锚限) | — | — |

## 交接棒(优先序)
1. **J2 闭 E1**(实现+注入全 ctx hook，尤其链锚 loadBettors/loadPoolSnapshot/fetchEndBlockHashCanonical + C1 的 db/p2sh/checkUtxoLanded/silverc/deriveTicketAddr)→ 解锁 live e2e。+ C3 daemon assert + D1 dedup-by-market。
2. **J1 闭 D2**(从被签 txSafeJson 反解根验)+ **级2-B fail-loud**(对齐 L273)+ **C2 poolMerkleRoot 链上 ctor 读**。
3. **Bettor+NWT**: E1 闭后跑 (A)-model live e2e；造三 attack-case 验【修前真 pass / 修后真 refuse】(有牙非 vacuous): ① D2 假根标量(claimedPayoutRoot 对 / txSafeJson 根错)② identity-swap(Σ不变换 sybil bettor，验级2-B BUST)③ C2 子集-委员(自洽 members+root 选 sybil 委员会)。
4. **Track A**: 确认 CLTV refund 臂 deadline 后 permissionless (D5)。
