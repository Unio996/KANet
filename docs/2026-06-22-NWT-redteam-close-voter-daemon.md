# NWT 红队 — bshard-close-voter daemon + enforce 接口 (Track B)

2026-06-22 · NWT (adversarial verifier / verify-value-source 域) · 审 J2 已 push 的 daemon 骨架 (65d2c0e9 `bshard-close-voter.js`) + transport (d743c2b1) + J1 接口档 (9fff0977)

**口径**: 这些是落码前/合并前必堵的洞。C1-C7 见频道(已发 C1/C2/C3, J1 认领)。本档新增 D1-D5 = 行级码证, 重点 D1/D2/D3 承重。

---

## 🔴 D1 — equivocation / 同市场双根 (dedup 粒度错)

`bshard-close-voter.js:89-94` 防双签的 dedup key = `(market_id, payout_root)`:
```
WHERE event_type='bshard_close_sig' AND from_address=? AND payload LIKE %market_id% AND payload LIKE %payout_root%
```
**攻击**: 恶意 settler 对【同一 market】先后提议两个不同 payoutRoot(一真一假)。两次 dedup key 不同(payout_root 不同)→ 委员对【同一市场签两个互斥的根】。配合任一 enforce 缝隙, settler 收集到假根的 5 sig。
**修**: dedup 必【每市场至多签一个 payoutRoot】——本节点对某 market 已签过【任何】根, 则拒签该 market 的【不同】根 (committee 对一个市场只能背书一个结果)。改 dedup key 为 `market_id` only, 命中且 payout_root 不同 → refuse(记 equivocation-attempt)。

## 🔴 D2 — claimedPayoutRoot ↔ 被签 tx 未绑 (C3 锐化, 真命门)

`:98` enforce 收 `req`(含 `claimedPayoutRoot` 标量字段); `:107` 签 `req.txSafeJson`。
enforce 验 `claimedPayoutRoot == re-derive`(接口档 step6), 但**签的是 txSafeJson, 不是 claimedPayoutRoot**。若 settler 给【匹配的 claimedPayoutRoot 字段】+【txSafeJson 的 close_attest 输出 commit 另一个根】→ enforce 验标量字段过, 委员签了【输出是恶意根的 tx】。
**修**: enforce 必从 **被签的 txSafeJson 本身**解出 close_attest 输出实际 commit 的 payoutRoot(即对 input_index 算 sighash 覆盖的那个输出), 验【它】== re-derived, 而非信 req 的旁路标量字段。verify-value-source 铁律: 验的值必须是【被签名覆盖的那个值】, 不是 caller 另给的同名字段。

## 🔴 D3 — committee 成员判定信 settler 的 list (命门④ 缺口)

`:86-87` 成员门 = `voterPk ∈ req.committee_pks`(settler 供)。当前 covenant(记忆)只验"5 个 distinct key 签了某 payoutRoot", **不验这 5 个是不是【正确】委员会**。∴ settler 凑【任意】5 个 oracle key 的签名即过 covenant。
**修**: enforce(fix①)必【链锚 re-derive 真委员会】+ 验 `voterPk ∈ re-derived 集`, 不在则**本节点自拒签**(不能因 settler 把我列进去就签)。`req.committee_pks` 只能当便宜预筛, 权威判定必 re-derive。(= 我频道 C5/C6: seed 的 deadline_daa 必 bound + endBlockHash 确定性选块。)

## 🟠 D4 — no-bypass 不变量仍【未落】(C4, 码证仍开)

`:15` 注释明说 (a)(b) "在 relay/console 层落(本文件外)" = **尚未实现**。现状: 6+ console 路径直调 `sign_input_for_settle`, relay handler 盲签。daemon 'enforce-在前'挡不住别的路绕过它直签同一 PS input。
**修(C4)**: gate 必在 **relay 端按【被签 input 是 PS/covenant 输入】判**(签 PS covenant input ⇒ 强制走 daemon enforce, 无视 caller 标签), + 删/堵其他 console 路对 close_attest input 的 sign 调用。+ (a) relay sign 端点非只 localhost(记忆 :3300 曾 0.0.0.0 暴露), 需 socket-perm/per-node token。

## 🟠 D5 — refund liveness 不能 settler-gated

`:100` abstain → 注释靠 "settler 侧 quorum-timeout-refund"。**恶意 settler 不会主动 refund**(乐意让资金卡住/重试别的根)。
**修**: refund 必【deadline 后 permissionless】(Track A CLTV deadline-gate: bettor/任何人可触发 refund), 不能只 settler 能触发。确认 Track A 的 refund 臂对任意人开放, 与本 daemon 的 abstain 路对齐。

## 🔴 D6 — C1 complete-set: aggregate 绑定只半闭, 不抓 direction/identity-swap (Bettor 红队点, 我域 own)

J1 的 C1 两级闭法: 级1 = aggregate (Σstake == 链上 consolidated_pool); 级2 = per-ticket 链锚。
**级1 只半闭**: Σstake 绑定能抓【omission(漏 bettor)/总额篡改】, 但**抓不到 direction-swap / identity-swap** — attacker 把某 ticket 的 direction YES↔NO 翻转 (或换 bettorPk) 而**保持 Σstake 不变** → pari-mutuel 的 winners 集 / 分母变了 → payoutRoot 变, 但级1 aggregate 校验仍过。
**唯一真闭 = 级2**: 从链上扫该 market 全 tickets 重建 bettor 集 (每 ticket 烤 `bettorPk + direction + stake + shardPoolId`), 验【逐 bettor 链锚】== loaded set (不只总额)。bshard bettor 集在【链上 shard 状态 ShardLeaf(pool_value/count/tickets)】, 非 v06 单 sides_merkle_root → enforce 必从【全 shard 链上状态】重建。
**验收(下次我做)**: 造 direction-swap attack-case (Σstake 不变, 翻一个 ticket 方向) → 级1-only enforce 必【漏过】(证半闭), 级2 enforce 必【BUST】(证真闭)。这是 C1 PARTIAL→闭 的判别测。

**⚠ D6-b 跨片完整性 (J2 查码, 我必加验)**: ShardLeaf state 只是【聚合 4 i64: local_yes/local_no/count/pool_value】, 不枚举单 ticket → L2 逐 bettor 重建必扫该 shard 的【全 dust ticket UTXO】(各烤 bettorPk+stake)。**更关键: 一个 logical market 可 auto-roll 多个 shard** (J2 (a) intake 路) → C1 complete-set 必【跨全部 shards 重建】, 只重建单 shard 会漏跨片 bettor → 集不全 → pari-mutuel 错。验收追加: 多片市场造一个【在另一片】的 bettor, enforce 只扫单片必【漏】, 跨全片扫必【全】。

---

## C1-C7 状态 (已发频道)
- C1 bettors 链锚(从链上 register 重建, 非 caller 供) — J1 认领修
- C2 poolMembers 完整有序集 == poolMerkleRoot(非逐个 inclusion) — J1 认领修
- C3 enforce-tx == sign-tx (见 D2 锐化) — J1 认领修
- C4 = D4 (relay 端 gate by 被签内容) — 待 J2
- C5 deadline_daa 必 bound predicate / C6 endBlockHash 确定性选块 / C7 relay sign 认证 — 待 J1/J2 落码钉死

## 验收闸 (NWT 复核)
J1 enforce lib ship 后, 我独立验三点真从链: ① bettors 真从链上 register 重建(D2: 且验被签 tx 的输出根) ② committee 真 re-derive 且非成员自拒(D3) ③ 一个 attack-case(假根/子集委员/equivocation)落码后 enforce 真 refuse, 修前真 pass(测有牙, 非 vacuous)。
