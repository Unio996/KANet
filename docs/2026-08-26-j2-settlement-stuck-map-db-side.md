# 结算 stuck 地图 · DB 侧(console.db 只读)· 2026-08-26

> **Status**: CURRENT
> **作者** J2 · **派工** Bettor(续 COORD-LEDGER (622)"完整结算 stuck 地图")· **性质** 只读快照(零改码、零改数据、零 TX)
> **数据源** `kasia-console/data/console.db` 只读,2026-08-26 13:3xZ · **链读缺席**:kaspad 新库 IBD 中(本地 20:35 仍在下 headers),**本文所有数字都是 DB 记账,不是链上事实**;§5 列出哪些必须等 IBD 完成后链上核。
> 🔴 引用本文任何一格时带上「DB 侧」三个字。DB 记账 ≠ 链上未花:8/22 已实测同一批地址链上余额 > DB 记账(51,135 vs 31,910),7/30 也是(20,065 vs 13,230)。

---

## §0 一句话

**DB 侧,结算流水线里没有终态的盘 = 543 盘 / maker 押金 97,690 KAS;这些盘名下的下注记账 = 逻辑键 73,215 KAS(6 个 pocket)+ 分片键 544,121 KAS(从未被链上审计过的 pocket)。** 8/22 报的两批(95 笔/46 盘/6 址/514.82;68 盘/1369 注/63 址/31,910.81/6 spine)在今天的 DB 上**逐字复现**,是本地图里两个子集,不是全部。今日活日志证实四个子系统仍然零产出(§4)。

---

## §1 盘(`pool_markets`)按 `protocol_status`(全库 4,050 盘)

`ripe(8/22)` = `deadline_daa + 60 <= 80095687`(8/22 14:58Z 的 DAA,**下界**:DAA 单调,当时到期的现在必到期;现在到期而当时没到的会漏计,要等 IBD 后重算)。

| protocol_status | 盘 | 形态 | maker 押金 KAS | ripe(8/22) | 备注 |
|---|---|---|---|---|---|
| **verifying** | 93 | bshard·v0.7 | 5,120 | 92/92 有 daa | 30 个 spine;69 盘有逻辑键注;**3 盘带 `settle_txid`(07-04 17:04:25 同秒写入)却仍 verifying** → 状态/链不一致,§5-⑥ |
| **settle_zombie_quarantine** | 189 | bshard·v0.7 | 67,170 | 189 | 最大的 maker 押金 pocket;下注见 §2/§3 |
| **pruned_expired_waived** | 140 | bshard·v0.7 | 13,620 | 131(9 盘无 daa) | = 已知「137 盘 33,735 KAS」批(7/30 链上:137 spine 13,670 + 22 票址 20,065) |
| settle_failed | 49 | bshard·v0.7 | 4,900 | 49 | 06-30~07-04 建 |
| pending_bettors | 31 | 混 | 2,530 | 0 | 未到期,不算卡 |
| refunding | 16 | 混 | 1,600 | 9 | 16/16 有 `refund_dispatched_at` 元数据、0/16 有 `refund_txid` → **派发了但从未落成 refunded**(06-14~07-03 起) |
| attested_v2 | 9 | bshard·v2_zk | 900 | 9 | 等 zk_close |
| pending_oracle_deposits | 8 | anon·pv=null | 800 | —(无 daa) | 06-29 建,非 v0.7 |
| unresolved_needs_authorization | 5 | anon·v0.7 | 650 | 5 | 4/5 带 `evidence_gap`(冻结路径产物) |
| collecting_sigs | 2 | 混 | 300 | 2 | |
| settled_partial_claims | 1 | bshard | 100 | 1 | 已结算、claim 未完 |
| **小计(非终态)** | **543** | | **97,690** | | |
| completed | 267 | 146 bshard / 121 anon | 19,211 | — | 266/267 有 settle_txid;bshard 那 146 盘的 claim 侧见 §3 |
| refunded | 1,517 | 1,496 anon | 197,893 | — | 1,512/1,517 有 refund_txid;剩余未领注见 §2 |
| shard_internal | 1,341 | 分片盘 | 200 | — | 不是逻辑盘,是分片容器(§3 用它映射) |
| archived / cancelled | 321 / 61 | | 190,190 / 1,827 | — | 终态 |

---

## §2 下注 · 逻辑键(`pool_bettor_sides.market_id` = 逻辑盘 id;6,360 行,100% 有 `side_lock_tx`)

| 逻辑盘状态 | 注 | 盘 | side 地址 | 未领 KAS | 与既往报告对齐 |
|---|---|---|---|---|---|
| **verifying** | 1,419 | 69 | 69 | **33,004.53** | 其 ripe(8/22) 子集 = **68 盘 / 1,369 注 / 63 址 / 31,910.81 / 6 spine — 与 8/22 Track-A 报告逐字相等**;多出的 1 盘/50 注/1,093.72 是 8/22 未到期或无 daa 那盘 |
| settle_zombie_quarantine | 553 | 36 | 77 | 21,234.49 | 新列出;8/22 未覆盖 |
| pruned_expired_waived | 170 | 9 | 22 | 13,230.63 | = 7/30「22 个 bettor ticket 地址」(链上当时 20,065) |
| pending_bettors | 98 | 3 | 30 | 3,038.28 | 未到期 |
| refunded(未领) | 121 | — | — | 1,168.46 | = **95 笔候选(46 盘/6 址/514.82,claim-auto `:42-56` 原 WHERE 复跑,逐字相等)** + **26 笔/653.64 连候选都进不了**(lock/redeem 都在,缺 `bettor_refund_available` chain_event) |
| unresolved_needs_authorization | 23 | 4 | 11 | 549.48 | |
| collecting_sigs | 4 | 1 | 4 | 188.81 | |
| cancelled | 4 | — | — | 40.00 | |
| **小计(非 completed)** | | | | **73,215** | |
| completed(anon) | 1,831 | 121 | 530 | 245,043.88 | `claim_txid` 空**不等于**没拿到钱:anon 盘由 settle tx 直接付,claim 不是它的付款路径 → **按设计非卡,但本文未核** |

---

## §3 下注 · 分片键(`market_id` = 分片盘 id → `market_shards` → 逻辑盘;29,652 行 / 1,338 分片地址 / 778,638 KAS,100% 有 `side_lock_tx`)

🔴 **这是第一次按逻辑盘状态汇总分片键记账。7/30 与 8/22 两次链上审计数的都是逻辑键地址(22 址 / 63 址),分片键这 1,338 个地址【从未被链上核过】。** 数字只说明 DB 怎么记,不说明钱在哪。

| 逻辑盘状态 | 分片 status | 注 | 分片 | 未领 KAS(DB) |
|---|---|---|---|---|
| **pruned_expired_waived** | open / sealed / settling | 1,845 / 6,967 / 1,818 | 126 / 220 / 60 | 46,736.55 / 183,143.90 / 55,137.13 = **285,017.58** |
| **settle_zombie_quarantine** | open / sealed / settling | 2,222 / 4,110 / 67 | 185 / 130 / 3 | 57,424.62 / 107,483.35 / 1,831.07 = **166,739.04** |
| **verifying** | open / sealed / settling / settled | 816 / 992 / 1,604 / 80 | 82 / 31 / 57 / 4 | 5,909.27 / 1,048.00 / 62,722.85 / 2,236.47 = **71,916.59** |
| settle_failed | open / sealed / settling | 475 / 96 / 91 | 44 / 3 / 4 | 16,866.45 |
| pending_bettors / refunded / refunding / attested_v2 / cancelled | | | | 2,035 / 799 / 527.25 / 141.32 / 76 |
| **小计(非 completed)** | | | | **≈ 544,121** |
| completed | settled(344 分片) | 8,153 | 344 | 233,869.74 → **已结算、claim 未领**(`payout_shards` 146 盘全 `v1_committee`);是 claim 侧不是 settler 侧,§5-⑦ |

🔨 **链上核这一层时判据要换**:分片 `sealed/settling/settled` 表示分片层已发生过转移(`market_shards.current_leaf_outpoint`),**钱可能坐在 leaf covenant 上而不在 `side_p2sh`**。按 `side_p2sh` 查余额会得到「钱没了」这个看起来完整、方向偏悲观的错答案(同 7/30 `bettor_relay_id` NULL 那次)。要沿 `current_leaf_outpoint` 追。

---

## §4 子系统零产出(今日活 `logs/console.log`,PID 27412 自 8/25 20:03Z)

| 子系统 | 最近 tick 原文 | 读法 |
|---|---|---|
| pool-settler | `106 verifying markets, consensus=0 refund=0 … bshardSkipped=103` | 106 = verifying 93 + collecting_sigs 2 + refunding 16 − 未到期;103 走 bshard 分支被跳(设计移交,`pool-market-settler.js:627`) |
| bshard-settle-daemon | `[pre-gate] 11 market(s) gated (unreachable=7 + repeat-offender=4)`,最后一行 09:22:52Z | 11 = (616) 层③原样。🔴 **更正(同日 14:0xZ,Bettor 派工 (4) 实核)**:初稿写「此后 4h 无 tick」是**错的**——tick 每分钟都在跑(`[diag:tick-duration] settleDaemonTick ms≈90` 不断),停的只是 `[pre-gate]` 那一行。原因 = `bshard-settle-daemon.mjs:600` `deadline_daa + FINALITY_BUFFER <= currentDaa`,而 `currentDaa`(`:157` → relay `chain_get_current_daa_score`)在 IBD 期实测返回 **`daa_score: 0`** ⇒ 0 行 ripe → `:964` 静默早退;`:637` 的 pre-gate 行只在有盘被 gate 时才打。 |
| bettor-refund-claim-auto | `95 unclaimed, dispatched=0 … unauthorized=95` | = §2 那 95 笔,P1 闸拒因「无 refund_authorization」(8/22 已报两头堵死) |
| prediction-settler | `3 expired, settled=0 pending=0 errored=3` | 非 pool 线,`no oracle votes received yet` |

四条与 8/22 22:00Z 我在频道报的完全一致 ⇒ **停摆期间没有任何盘被推进**(上次成功结算仍是 07-20 07:35 的 `…-85fit`)。

---

## §5 🔴 必须等 IBD 完成后链上核的数(按优先级)

1. **当前 DAA** → 重算 §1 `ripe`;本文用的 80095687 是 8/22 下界。
2. **68 盘 / 63 址**(§2 verifying):8/22 链上 2,175 UTXO / 51,135.39 KAS vs DB 31,910.81;复核是否仍未花、是否又多了没登记的入金(8/22 §6 那 746 笔 / 18,924 KAS 查无此账)。
3. **95 笔 / 6 址**(§2 refunded):8/22 链上 128 UTXO / 640 KAS vs DB 514.82;地址共用,只能按址不能按笔。
4. **137 spine + 22 票址**(§1/§2 pruned):7/30 链上 13,670 + 20,065;判据仍是「spine UTXO 是否还是 `spine_lock_tx` 原始输出」(= covenant 零转移)。
5. **分片键全部 1,338 址 / 544,121 KAS(§3)**:从未审计;沿 `current_leaf_outpoint` 追,不按 `side_p2sh`。这一格决定 stuck 总量是「三万级」还是「五十万级」——**今天不能下结论**。
6. **3 个 verifying 却有 `settle_txid` 的盘**(`…-gic37 / -gzx6w / -vzhep`,txid 见 DB):settle tx 上链了没有 → 上链了是 DB 状态没推进;没上链是 `settle_txid` 乐观写入(NO TX NO STATE 违例)。
7. **completed-bshard 未领 233,870 KAS(§3)**:是 winner 没来领、还是 payout 树/claim 路径坏 → 抽样核 `payout_shards.payout_ps_outpoint` 是否未花。
8. **16 个 refunding 盘**(§1):`refund_dispatched_at` 有、`refund_txid` 无 → 派发的退款 tx 到底上链没有。
9. settle_zombie_quarantine 189 盘 maker 67,170 + 下注 21,234(逻辑键)+ 166,739(分片键):从未逐盘链上核。

---

## §6 与已知数的对账

| 既往数 | 出处 | 今天 DB 侧 | 关系 |
|---|---|---|---|
| 95 笔 / 46 盘 / 6 址 / 514.82 | 8/22 22:04Z 频道 | 95 / 46 / 6 / 514.82 | **逐字相等**(§2) |
| 68 盘 / 1,369 注 / 63 址 / 31,910.81 / 6 spine | 8/22 Track-A 文档 §3 | 同 | **逐字相等**,= verifying-69 的 ripe 子集(§2) |
| 137 盘 / 33,735 KAS | 7/30 记忆(链上 13,670 + 20,065) | pruned 140 盘:maker 13,620 + 票 13,230.63(逻辑键)+ **285,017.58(分片键,未审计)** | 前两格对得上;第三格是新发现的未核 pocket |
| 243,222 KAS maker bond park | (613) Bettor | 非终态 maker 97,690 + completed-bshard 14,600 + … | 口径不同(613 含已结算盘 bond 容器),**另案 reconcile,本文不替它下数** |
| 106 verifying / bshardSkipped 103 | 8/22 21:57Z 频道 | 今日 tick 原文相同 | 相等(§4) |

---

## §7 本文没做的

- 没读链(IBD);没跑任何 relay 命令;没改任何盘;没碰 `metadata`。
- 没重算 DAA;没解释 settle-daemon 09:22Z 后为何无 tick;没核 completed-anon 1,831 注是否真付过。
- 分片键 pocket 只做了 DB 汇总,**其真实性(钱在不在、在哪)完全未证**。
