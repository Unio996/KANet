# canary#3 = 9jaty 回填 · 书面执行计划 rev-1【零执行 · 待 Owner 扩展授权 + NWT 审】

> **Status**: 🔴 **派工已撤销 · 本文件不再是执行计划, 只作【事实档案】**(2026-08-11 00:05Z @Bettor 撤销 r081, 并向 Owner 撤回"首笔真结算"卖点, 改为「随 A-3 决策包整批处理, 不单独抢跑」)
> **⇒ 谁都不要照 §2 的 S1-S7 去执行。** 仍然有效的是 **§1 / §1-bis / §1-ter 的实测事实** 与 §4 的证据层级表。
> · rev-1(2026-08-11 00:1xZ · J2)
> **派工**: @Bettor 00:00Z「按 canary#2 计划模板出 9jaty 实例化版(S1-S7, ONLY=9jaty, 四纪律头部, dry-run 先行)+ 一节 canary#2 没有的 side_lock_daa 现状」
> **模板**: `docs/2026-08-10-canary2-j34vb-settlement-execution-plan-v0.1.md`
> 🔴 **授权状态(如实)**: Owner GO 的字面是 **canary#2 = j34vb**。扩展到 9jaty = **新授权**,@Bettor 正在单点上桌。
> **GO 到手前, 本文件描述的写操作一个都不跑。** 本文件本身零执行。

---

## 🔴 §0 执行纪律(照 canary#2 逐字继承)

1. **每一步先贴命令与期望读数, 再执行**;停止条件命中 ⇒ **停, 不自行放行**。
2. **绝不设** `PS_ADDR_BACKFILL_ALL` / `PS_ADDR_BACKFILL_NO_CHAIN`;**绝不手改 DB / 改脚本绕闸**。
3. **唯一写操作只有 S4**, 且限 `PS_ADDR_BACKFILL_ONLY=<9jaty 逻辑盘 id>`。
4. **证据先落 git 再谈结论** —— 频道会因重启窗中断, git 是通道(canary#2 的实战教训)。

---

## 🔴 §1 现场(2026-08-11 00:0xZ · J2 只读实测 · 零写入)

```
market      ext-pool-v07-1783869105813-9jaty
            zk_native=true · protocol_status=verifying · settle_txid=无
            deadline_daa = 61,452,455
分片        …-9jaty-s0 (protocol_status=shard_internal)
payout_shards  1 行 · payout_ps_addr = kaspatest:pp5pw8hp7uxd2m86pmam…
               payout_redeem_hex 长度 16,564
```

**当前失败形态(实读 `events`, 2026-08-10 23:56:47)**:

```
buildProposeCloseRequestV2: K-18 §3.3 coherence gate FAIL(blocking, step=d):
  p2sh(stored redeem) = 'kaspatest:pzgacphfqmckkx0c2euq2kvrh3vp9cfysw2k0wr9jmcezzmk7awkq673j7swp'
  != payout_ps_addr   = 'kaspatest:pp5pw8hp7uxd2m86pmamnmwn7mc6ta7xcsya4x2n48ajnnq4t0cwc4q6dd6hp'
```

⇒ **与 j34vb 当初【逐字同形】** ⇒ `scripts/backfill-payout-ps-addr.mjs` 对症。
🔵 同一 tick 内 **9ez2u(500 KAS)同样 step(d) FAIL** —— 若 9jaty 成立, 它是下一个候选(**不在本计划内**)。

---

## 🔴🔴 §1-bis canary#2 没有的那一节: **9jaty 的 side_lock_daa 现状 —— 修完第一层【也结不了】**

```
side 行 4 条, 全部 side_lock_daa = NULL
side_redeem_script_hex 长度 = 0(bshard 共享池形态, 逐 bettor 无独立 side UTXO)
deadline_daa 61,452,455  vs  剪裁点 75,508,341
⇒ 墙外 14,055,886 DAA ≈ 17.5 天(按当期 ~801k DAA/天)
```

🔴 **⇒ 回填 `payout_ps_addr` 只会把 9jaty 从 K-18 gate 推进到【第三层】**, 即 j34vb 此刻卡的那一堵:
`bshard-close-enforce.mjs:748-749` 的 `committee-exclude: 无 side_lock_daa (fail-loud 防 cross-node fork)`。
而第三层已由 **Owner 2026-08-10 终裁 = 链上派生永久不可得**(三类候选节点全排除 + explorer 亲查)。

⇒ 🔨 **价值命题必须改写, 这是本文件最重要的一句**:
| ❌ 不成立 | ✅ 成立 |
|---|---|
| 「9jaty 可能是首笔真结算」 | 「9jaty 验证**第一层修法在第二个真实用户上可复用**」 |
| 「结出 8,500 KAS」 | 「把 9jaty 从第一层推进到第三层, **与 j34vb 汇合**」 |

**它的产出是【一个已知的、可解释的失败】, 不是结算。** 而那仍然有价值:
它把「陈旧 payout_ps_addr」这一类从 **n=1** 变成 **n=2**, 并让第三层的受影响集从 1 盘变成 2 盘 —— **对 A-3 处置决策包是实打实的输入**。

---

## 🔴 §1-ter 另一个必须与 8,500 同时上桌的事实: **9jaty 只有【一个】bettor, 且两边都下**

```
bettor_pk = af959f6ab582683d9ca9…   (4 行全部同一 pk · bettor_relay_id 为空)
   方向 1 : 5,000 + 500 = 5,500 KAS
   方向 0 : 1,000 + 2,000 = 3,000 KAS
⇒ 名义 8,500 KAS · 净方向敞口 2,500 KAS
```

⇒ 🔨 **这改变在册红线的【适用形状】**(红线原文:「绝不标记排除真实投注人」):
这里**不是一群人被排除**, 是**一个人、自己对赌两边**。
🔵 **我不下政策判断** —— 那是 Owner 层。**但 8,500 这个数若不带这一条同时出现, 会被读成「8,500 KAS 的公众损失」, 而实况不是。**
⚠ **未查**: 这个 pk 属于谁(不在本机 `relay_nodes`)。**若要据此调整处置, 必须先查清身份**, 不能靠"看起来像自测"推定。

---

## §2 步骤(每步:确切命令 / 期望读数 / 🔴停止条件)

### S1 · 前态快照(只读, 必须先做, 否则 S5 无对照)
```bash
node -e "…SELECT logical_market_id, payout_ps_addr, length(payout_redeem_hex), payout_ps_outpoint
          FROM payout_shards WHERE logical_market_id LIKE '%9jaty%'…"
```
**期望**: 1 行 · `payout_ps_addr = kaspatest:pp5pw8hp…` · `redeem` 长度 16,564。
🔴 **停止条件**: 行数 ≠ 1 ⇒ 停(canary#2 是单行, 多行意味着形态不同, 计划不适用)。

### S2 · dry-run(**不设** `PS_ADDR_BACKFILL_CONFIRMED`)
```bash
PS_ADDR_BACKFILL_ONLY=ext-pool-v07-1783869105813-9jaty node kasia-console/scripts/backfill-payout-ps-addr.mjs
```
**期望**: 打印 `derived` = 从 `payout_redeem_hex` 重算的 p2sh, 且 **== 上面那个 `pzgacphf…`**;`would update 1`。
🔴 **停止条件**: ①`derived` 与 K-18 报的 `p2sh(stored redeem)` **不一致** ⇒ 停(两条独立路径算出不同值 = 有第三个变量);②链上校验 fail-closed ⇒ 停;③`would update` ≠ 1 ⇒ 停(ONLY 闸没生效)。
⚠ **链降速期间 ② 大概率命中** —— 那不是缺陷, 是闸在工作。**链恢复后再跑。**

### S3 · 独立派生核对(纯人工, 零命令)
**我自己算一次** `p2sh(payout_redeem_hex)`, 与 S2 的 `derived` 并排比。
🔴 **停止条件**: 不等 ⇒ 停。(canary#2 的这一步抓过东西, 不是形式。)

### S4 · 实回填(**唯一写操作** · ONLY 单盘)
```bash
PS_ADDR_BACKFILL_CONFIRMED=1 PS_ADDR_BACKFILL_ONLY=ext-pool-v07-1783869105813-9jaty \
  node kasia-console/scripts/backfill-payout-ps-addr.mjs
```
🔴 **停止条件**: `⏭ SKIP … 乐观并发未命中` ⇒ 停, 回 S1 重取前态(说明期间有人动过)。

### S5 · 落值核实(只读, 与 S1 对照)
重跑 S1。**期望**: `payout_ps_addr == derived`;其余字段不变;`settle_txid` 仍 NULL。

### S6 · 结算 tick(过 K-18 gate)
**期望(已改写, 见 §1-bis)**: propose 的错误形态**从 K-18 step(d) 变成 committee-exclude 缺 side_lock_daa**。
🔵 **这【就是】成功判据** —— 不是"结算成功"。
🔴 **停止条件**: 若出现**任何第三种**形态(既非 K-18 也非 committee-exclude)⇒ 停并上报, 那是新信息。

### S7 · 上链判据
**本盘不产生上链结算**(见 §1-bis)⇒ **S7 在本计划中退化为"确认没有产生任何链上写"**:
核 `settle_txid` 仍为 NULL、无新 `payout_tx`。**若出现链上写, 那是异常, 立即停并上报。**

---

## §3 与 canary#2 的差异一览(给审的人看)

| | canary#2 (j34vb) | canary#3 (9jaty) |
|---|---|---|
| 第一层症状 | K-18 step(d) FAIL | **同** |
| 预期产出 | 推进到下一层(实际=第三层) | **同, 且【事先已知】是第三层** |
| side_lock_daa | 8/10 NULL | **4/4 全 NULL** |
| bettor 数 | 多 | **1(两边都下)** |
| 金额 | 395 KAS(整盘) | 8,500 名义 / **2,500 净敞口** |
| 授权 | Owner GO(字面) | 🔴 **待新授权** |

---

## §4 证据层级

| 陈述 | 层级 |
|---|---|
| 9jaty 当前 K-18 step(d) FAIL 及两个地址原文 | ✅ `[CONFIRMED·实读 events 2026-08-10 23:56:47]` |
| 4/4 行 side_lock_daa 为 NULL | ✅ `[CONFIRMED·只读实测]` |
| deadline 在剪裁点下 14,055,886 DAA | ✅ `[CONFIRMED]`;换算成 17.5 天 🟠 `[依当期速率, 链速变则天数变]` |
| 单一 bettor 两边下注 | ✅ `[CONFIRMED·4 行同 pk]` |
| 该 pk 的身份 | 🔴 `[未查]` —— 不在本机 `relay_nodes` |
| 「回填后必然落到第三层」 | 🟠 `[推断·同代码路径]` —— j34vb 已实证走这条路, 9jaty 未实测 |
| 链降速期间 S2 会 fail-closed | 🟠 `[推断·未实测]` |
