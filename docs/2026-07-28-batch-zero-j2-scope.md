> **Status**: CURRENT

# 批零 · J2 域两格口径(claim-complete / settleMarketLive)

**作者**: J2 · **日期**: 2026-07-28 · **派工**: Bettor 05:46 频道裁定三(「批零口径成文 = 批, 照你说的开工」)
**上游**: `docs/2026-07-25-kanet-trunk-roadmap-modularization-and-external-access.md` §批零 ——
> 「三项的具体口径由各自域主(J2 / J1)填,本文件不代填 —— 我没有它们的一手细节,不编。」

**本文件补的就是那两格。** 第三格(ZK D-number)归 J1,不在本文件。

---

## 0. 先说这份文件的性质 —— 它推翻了自己的上游一句话

批零在路线图里的作用是**卡住第三、四段**,理由原文:

> 第四段要拆预测系统,**而预测系统里正躺着 `settleMarketLive` 的假完成 bug**。
> 带着已知资金正确性缺陷的模块跨边界搬迁 = 把 bug 铸进接口契约。

🔴 **地面核实的结论: 这句话在 2026-07-28 是过期的。** bug 真实存在过(2026-07-03 发现),
但**当天就修了**,欠款 **2026-07-11 已补付**,补付已被链上抽样证实。

🔵 **为什么值得写这一段**: 路线图 §批零 自己写着「口径由域主填,本文件不代填」——
也就是说**这一格从写下的那天起就没有人核过**,而它一直在阻塞真实工作。
这不是文档瑕疵,是**一个不再存在的问题在挡路**。

---

## 1. 格① `settleMarketLive` 假完成 —— ✅ 已修 · 已补付

### 1.1 缺陷是什么(强度: 已实测,三处独立来源)

```
task#33 · 2026-07-03 发现
根因: settleMarketLive 的 claim 循环在 5 条丢单路径上 break 之后, 仍无条件 return { ok: true }
     ⇒ daemon 只查 ok + closeTxid 就写 protocol_status='completed'
     ⇒ 从来没有断言过"每个 winner 都真拿到钱了"
```

**出处(三处,互相独立)**:
- `kasia-console/test-framework/cases/predictions/pool/claim_completeness_regression.test.mjs` 文件头(根因逐字记载)
- `docs/2026-07-03-bshard-claim-completeness-and-retry-design.md` §2
- `docs/iteration/archive/COORD-LEDGER-2026-06_to-07-07.md:862`

### 1.2 实际损失(强度: 已实测 · 链上取证,非估算)

| 项 | 值 | 出处 |
|---|---|---|
| 确认漏付市场 | 20 盘(tier1) | NWT 2026-07-03 链上取证,`scratch/_nwt_final_report.json` |
| 未付 winner-slot | 169 个 | 同上 |
| 未付金额 | 8509.17 KAS | 同上 |
| 误报案例(降级) | `2pu1o` = 虚惊(链上 2/2 全到账,告警是 `verifyClaimLanded` 瞬时假阴性) | 同上 |
| DB 存的 payout_root 是否也错 | 21/21 全对(无更严重问题) | 同上 |

### 1.3 现在什么状态(强度: 已实测)

```
✅ 修复在码里
   bshard-auto-settler.mjs:593  const complete = claims.length === claimData.length
                                 && claims.every(c => c.received === true && !c.error)
   bshard-settle-daemon.mjs:860 三态分流 completed / needs_manual_attribution / settled_partial_claims
   前提站得住: claimData = winnerClaimData(plan.winners) 是 1:1 map 零过滤(:282-285 实读)

✅ 修复【在 live 上真的在跑】—— 不是"commit 了"
   live 库 pool_markets: 82 行带 complete 字段(该字段只有新码会写), 最近一条 2026-07-18
   🔵 其中 1 行 complete=false ⇒ 诚实躺在 settled_partial_claims(4wl3z, expected=2 attempted=2)
      这一行比 81 行成功的更承重: 它证明那条分流路径是活的, 不是"恰好没触发过"

✅ 欠款已补(DB 层)
   当年 20 盘今天全部 claim 数 == 期望 winner 数, 全部 complete=true
   补付时间集中在 2026-07-11 22:54–23:14(桶A resume-skip 修复装载后的一次集中补付)
```

### 1.4 🔵 而 1.3 最后一格我没有只信库(链上抽样)

**为什么必须链验**: 库自报"已付"**正是当年那个 bug 的形状**。拿它当证据 = 自我认证。

```
判据: 拿当年 NWT 逐笔记的欠款明细(pk + 精确 sompi), 查该 winner 地址【当前 UTXO 集】
     命中 outpoint.transactionId == 今天 DB 记的 claim txid 且 amount == 当年欠款 ⇒ 钱到了这个人手里
     (UTXO 集是链上现状, 不受剪裁影响)
抽样: 当年缺口最大的三盘(75ce9 欠23笔 / d9qfr 欠18笔 / vv0tj 欠18笔)
结果: 59 笔当年欠款 ⇒ ✅ 57 笔链上硬证据到账 · 🟡 2 笔不可判 · 🔴 0 笔"库说付了链上没有"
```

- 🟡 **那 2 笔标"不可判"不标 FAIL**: UTXO 不在该地址,可能是本人已花掉。不知道就不写知道。
- 🔴 **仪器边界**: 原本想用 `getBlock` 回溯历史块逐笔核 —— **走不通**,TN12 已剪裁,报
  `cannot find header`。换判据,没有拿"查不到"当"没有"。
- 🔵 **对照臂**: 先拿已知有余额的地址查一次 UTXO,非空 ⇒ 证明该查询有功率,再去查那 59 笔。

**脚本**: `scratch/j2-batchzero-tier1-current-state.mjs` · `scratch/j2-batchzero-chain-verify-repayment.mjs`

### 1.5 🔴 而三格【没关】—— 不许含混进"已解决"

| # | 未关的格 | 强度 |
|---|---|---|
| ① | **60 盘 `clean_provisional` 从未做过设计稿要求的分层抽样链验**。设计稿 §2.2 原文:「只代表日志窗口内未发现已知疑点,不能代表链上确认无误,**不许直接采信**」 | 已实测(该 60 盘至今无链验记录) |
| ② | **4 盘手驱历史盘**(`ozzeu`/`pb73v`/`gp8hy`/`2ysnl`)当年即标"无法验证",至今没验。今天实查:其中三盘存证里**连 `claim_txids` 都没有**,只有一句人写的 `settled on-chain by driver before daemon` | 已实测 |
| ③ | `counting_source_of_truth_regression.test.mjs` 里的 PENDING 写着「等 NWT 交 golden values 才能填」—— **那批值 2026-07-03 就交了**(`_nwt_final_report.json`),blocker 过期 25 天没人动。⚠ 而那是**补付前**的值,当 fixture 需重新派生 | 已实测 |

### 1.6 完成判据(预注册 · 开工后不许改)

```
(a) 60 盘 clean_provisional 分层抽样链验(按 betCount 规模 / 分片数分层, 每层至少 3 盘)
    判据 = 逐 winner 地址链上核, 与 DB 记的 claim 数一致; 不一致的升级为确认漏付单独立卡
(b) 4 盘手驱历史盘各出一份链上取证结论(可以是"钱已到账"或"查不到, 因剪裁不可得" —— 后者也算闭合,
    但必须写清是哪一种, 不许留空)
🔴 (c) 上面两条的判据都必须带【对照臂】: 同法查一个已知有钱的地址必须非空, 否则"查到空"没有意义
    —— 本文件 1.4 踩过这个坑的反面版本(见 §4.3)
```

---

## 2. 格② `claim-complete` —— ✅ claim 本体通 · 🔴 上游 12 盘卡死(现役)

### 2.1 这个名字底下其实是什么(强度: 已实测)

`claim-complete` = **ZK 线**的收尾能力,与格①(V1 committee-sig 线)不同族。两份设计:
- `docs/2026-07-07-closezk-claim-complete-design.md`(claim entry 本体 + exit-path 矩阵硬门)
- `docs/2026-07-08-closezkv2-claim-driver-design.md`(生产 driver:relay handler + witness builder)

### 2.2 claim 本体: 通的(强度: 已实测)

```
✅ CloseZkV2.sil:145            claim entrypoint 在
✅ commands.mjs:104             closezk_v2_claim 已注册
✅ p2sh.mjs:2274                unlockCloseZkV2Claim 已实现(含 verify-value-source 现读现验)
✅ 6 个 attested_v2 盘存证里有真实 zk_close + claim 的 txid 对
   (1dv70 / tyr91 / bvh2c / b0uoi / …, zk_escape_audit 字段逐笔记载)
```

### 2.3 🔴 而真实缺口在【上游】: 12 盘从来没走到 claim

```
tick: zkJudgeProposeAutonomousTick(kasia-console/src/lib/zk-autonomy-ticks.mjs:406)
12 盘 protocol_status='verifying' · 全部【从未 propose 成功过】· 卡 9–20 天
最近一次重试: 2026-07-28 05:5x —— 写这份文件时它还在跑
```

**两族,错误字符串逐字取自 `events` 表**:

| 族 | 盘 | 失败步 | 错误(逐字) |
|---|---|---|---|
| ① (7 盘) | 7jy3s · ldtyn · 8xykm · cswib · yxllc · s6zwj(以上 `judge`)· 3mzoh(`endblockhash`) | `:424 judgeWinDir` / `:428 endBlockHash` | `getBlockAtDaa: backward walk exhausted MAX_WALK=250000 without crossing deadlineDaa=…` |
| ② (5 盘) | 9ez2u · 9jaty · kr5l4 · j34vb · **tha3l** | `:432 buildProposeCloseRequestV2` | 裸 `unreachable` |

> 🔴 **更正(2026-07-28,J2 自查)**: 本表初版写作「族① 8 盘 / 族② 4 盘」,把 `tha3l` 放进了族①。
> **错因**: 我是从一屏日志输出里**目测**分的族,而不是按数据分组。改按 events 表逐盘取最近一条错误事件、
> 用错误字符串分类后重跑 ⇒ `tha3l` 的最近错误是 `propose: unreachable`,属族②。
> 🔵 这条更正**改变派工对象**——族① 是 J1 的 `getBlockAtDaa` 域,族② 不是,所以放错族 = 派错人。

🟡 **族②的归因我不写** —— `unreachable` 是 wasm trap 的字面文本。我心里有候选(mega-UTXO 那族 wasm 崩),
但那是**未验的猜**,不进结论。

### 2.4 🔴 族①的根因: 同一天 · 同一堵墙 · 只修了一条路

```
2026-07-11 桶A 修法(docs/2026-07-11-backlog-markets-resume-fix-and-cleanup-design.md):
   V1 daemon 路 resume 时不再无条件 computeSettlePlan ⇒ 绕开 getBlockAtDaa 的 MAX_WALK 墙
🔴 而 zkJudgeProposeAutonomousTick 是【同一天】新加的第六件, 它无条件调
   ctx.judgeWinDir + ctx.endBlockHash ⇒ 原样撞同一堵墙
⇒ 同一天, 同一堵墙, 一条路绕过去了, 另一条路照撞 —— 没有任何检查会告诉我们这件事
🔴 且这些盘 deadline 已过 488h+ ⇒ 那个 DAA 离 tip 太远, 重试一万次也是同一个距离
   (这不是"重试会好"的错)
```

### 2.4bis 🔵 而族① 的墙,在【我们这台】的索引里有一个更具体的形状

J1 06:16 交了他那台的索引空洞体检(2 个洞)。**settle daemon 跑在我们这台** ⇒ 影响结算的洞在这边。
同法在本机 `spc_daa_index` 跑(只读,一次有序扫描;🔵 对照臂:阈值降到平均间隙 8 ⇒ 报出 1569 个,证明循环有功率):

```
本机 spc_daa_index: 160 万行, 覆盖 DAA 56,983,539 → 69,329,387
                    (2026-07-10T02:51Z → 2026-07-28T04:32Z)
🔴 > MAX_WALK 的洞【3 个】(与 J1 那台的 2 个【窗口不重合】—— 两台各自独立, 本就没有理由重合):
   ① DAA 58,168,048 → 59,053,402  间隙 885,354 (≈30.7h)  07-11T19:54Z → 07-13T02:39Z
   ② DAA 60,735,480 → 61,371,827  间隙 636,347 (≈22.1h)  07-15T16:56Z → 07-16T15:01Z
   ③ DAA 63,982,832 → 64,350,406  间隙 367,574 (≈12.8h)  07-20T10:49Z → 07-20T23:36Z
```

**而把 12 盘的 `deadline_daa` 对进去,族① 立刻有了一个干净的解释**:

| 盘 | deadline_daa | 位置 |
|---|---|---|
| 7jy3s / ldtyn / 8xykm / cswib / yxllc / s6zwj | 55.37M–56.83M | 🟡 **全部在索引【地板】之下**(本机索引最早 56,983,539)—— 不是洞,是**从没覆盖过** |
| 3mzoh | 63,404,896 | ✅ **在已覆盖区间内** ← 🔴 **族① 里唯一的例外** |
| tha3l / 9ez2u / kr5l4 / j34vb / 9jaty(族②) | 57.79M–61.45M | ✅ 全在已覆盖区间内 |

🔴 **⇒ 两条可交付给 J1 的线索(他的域,我不下判断)**:
```
① 族① 的 6 盘在索引地板之下 ⇒ 「把 MAX_WALK 调大」对它们【一定无效】——
   缺的不是步数, 是那一段索引【从来就不存在】
🔴 ② 而 3mzoh 是反例: 它的 deadline_daa 【在索引覆盖内】, 却仍报 backward walk exhausted
   ⇒ 读起来像"能答这个问题的索引存在, 而那条路径没去问它"
   🟡 但我【没有】读 getBlockAtDaa 的实现去确认它到底查不查 spc_daa_index ⇒ 这一格是【未验的观察】,
      不是结论。归 J1 域, 由他核。
```
⚠️ **作用域**: 本体检查的是 `spc_daa_index`(DAA→block 映射)。而 §1/§2.6 里 lock tx 的覆盖率用的是
`kaspa_tx_log` —— **两个不同的索引,本体检不覆盖后者**,别把这里的"3 个洞"读成那边的解释。

### 2.5 🔴 告警在响,而它响给谁看

```
_maybeWriteStuckAlert(zk-autonomy-ticks.mjs:384) 每 2 小时朝 events 表插一条 level='critical'
2026-07-28 03:46–04:58 之间, 12 个盘各插过一条 ⇒ 🔵 告警机制本身是活的、没坏
🔴 但它写进的是数据库表 —— 没有订阅方, 20 天没有人读
⇒ 「自我报告的健康机制」的一个新变体: 这次它没沉默, 它一直在喊, 而喊的地方没有耳朵
```

### 2.6 🟡 钱在哪 —— 部分已定,部分未定(这一格诚实留口)

**✅ 已定(链上硬证据,带有功率的对照臂)**:

| 盘 | leaf state 声称 | 链上当前 leaf 地址实查 | 判定 |
|---|---|---|---|
| ldtyn | 127.78 KAS | **127.78 KAS** | 🔴 钱仍锁着,分文不差 |
| 8xykm | 120.42 KAS | **120.42 KAS** | 🔴 同上 |
| cswib | 102.55 KAS | **102.55 KAS** | 🔴 同上 |
| 7jy3s | 1.50 KAS | **1.50 KAS** | 🔴 同上 |
| | | **合计 352.25 KAS** | 现役锁死 |

**🟡 未定(8 盘,含 kr5l4 / 9jaty)**: leaf state 声称有钱,但**三类地址链上都查不到**——
建盘 leaf 地址 / 当前 state 派生的 leaf 地址 / payout_shard genesis 地址,全 0。

**🔨 追加一层(Bettor 06:02 派工「从 side_lock 往下再推一层」· 只读)**:

```
① PS 层: 在 kaspa_tx_log.outputs_json 里找【谁付给了 PS 地址】(= consolidate 那一步)
   🔵 对照臂: 已 completed 的 85fit 同法查 ⇒ 命中 1 笔 / 907ms ⇒ 查询有功率
   结果: kr5l4 / 9jaty / 9ez2u / s6zwj / tha3l / 3mzoh 各命中【1 笔】, 而那一笔是
        20,000,000 sompi = 0.20 KAS 的【创世 dust mint】—— 不是池子的钱
        j34vb / yxllc 命中 0 笔
   ⇒ 🔵 结论: 这几盘的下注款【从来没有进过 PS】。consolidate 没发生, 不是"发生了钱走了"

② shard 叶层(抽 kr5l4 的 3 个 side 地址, 全窗口 outputs_json 扫):
   🔵 对照臂 85fit 的 side 地址 ⇒ 命中 1 笔 0.20 KAS(创世 dust)⇒ 有功率
   kr5l4 三个地址 ⇒ 命中【0 笔】, 连 0.20 的创世 dust 都没有
   ⇒ 🟡 读起来像"这些 shard 叶从来没在链上被铸出来过", 但这是 3/22 抽样, 我不外推到全盘
```

**🔴 而这一层同时【推翻了我自己上一步的一个推论】,必须写下来**:

```
我一度想用 side_lock_daa 是否为空当判据("空 = 没入过块")
🔴 它是错的, 而推翻它的正是我自己前面的链上证据:
   ldtyn / 8xykm / cswib / 7jy3s 四盘 side_lock_daa 【全为空】,
   而它们的钱【实实在在锁在链上】(127.78 / 120.42 / 102.55 / 1.50, 分文不差)
⇒ ⇒ side_lock_daa 为空只反映那一列的回填覆盖范围, 不反映有没有入块。不可当判据。
🔵 记这一条的理由: 它长得非常像一个判据 —— 列名里带 daa, 语义上"入块高度",
   而它恰好在 12 盘里有区分度(105/694 · 59/70 · 0 · 0 …), 看起来像信号。它不是。
```

**🔨 第三层(决定性) —— 我前两层【查错了对象】**

实读一笔 lock tx 的 outputs 才看清:下注款付给的是**每笔各自的 P2SH**,
而 `pool_bettor_sides.side_p2sh` 这一列指的是别的东西 —— 它**只收过 0.20 KAS 创世 dust**,
**在已成功结算的盘上也一样**。
🔴 **⇒ 所以「kr5l4 的 side 地址一分钱没进过」这句是真的,但它什么也不说明** ——
一个正常工作的盘,它的 side 地址同样一分下注款都不会进。我前两层在拿一个**永远为空的对象**当判据。

```
判据(第三层): 从每笔 lock tx 的 outputs 取出那个 per-bet P2SH, 查它【当前】还有没有钱
🔵 对照臂(这次选对了): 已 completed 且确认付过款的盘 —— 预期【已空】
   85fit 37 个 per-bet 地址 ⇒ 全空 · ajnid 26 个 ⇒ 全空 ✅ 判据在"钱已流走"方向有判别力
结果(卡住盘):
   7jy3s  ✅ 1.50 KAS 仍锁在 per-bet 地址(该笔从未 register 进 leaf)
          🔵 且实测该地址 == 它的 leaf 地址(逐字符相同)⇒ 与 §2.6 那 352.25 是同一笔, 不重复计
   其余各盘的 per-bet 地址 ⇒ 全空(kr5l4 325 个全空, 涉 12,715 KAS)
```

🔴 **而这一层还废掉了一个我差点当证据用的负结果**:

```
"side_lock_tx 不在本地链索引里" —— 🔴 不能当"没上链"
   实测: 对照臂 85fit(完整结算、钱确实付出去过)也只有 37/46 在索引里
   ⇒ 索引天生不全, "查不到"在【好盘】上同样发生 ⇒ 零判别力
```

```
🔴 所以 kr5l4 那类盘的钱在哪, 我仍然交"不知道"。但"不知道"已经窄到只剩一个候选:
   已排除(每条都带有功率的对照臂):
     · per-bet lock 地址(钱确实从这里离开了)
     · 建盘 leaf 地址 / 当前 state 派生的 leaf 地址
     · PS 地址(只收过 0.20 创世 dust ⇒ consolidate 没发生)
   剩下的唯一候选: 钱已 register 进 leaf, 而【库里记的 leaf state 与链上不符】
     ⇒ 我据库派生的地址就是错的, 钱在另一个我算不出来的地址上
   🔵 这个候选有正面佐证: ldtyn/8xykm/cswib 三盘库里的 leaf state 与链上分文不差 ——
     说明这条链路本来是准的, 而 kr5l4 那 22 片不准 ⇒ 是这几盘的记账坏了, 不是机制没有
```

🔴 **而这里还有一格必须写进来: DB 自己的两套记账互相对不上。**

| 盘 | `pool_bettor_sides` 求和 | `market_shards.current_leaf_state` 求和 |
|---|---|---|
| 9jaty | 8,500 KAS | **56,500 KAS** |
| 9ez2u | 500 KAS | **3,500 KAS** |
| kr5l4 | 25,075 KAS | 25,075 KAS(这盘两者一致) |

⇒ **所以"这些盘里有 N KAS"这句话,现在没有一个可引用的数。** 谁要引用,必须先说清用的是哪套账。

### 2.7 完成判据(预注册 · 开工后不许改)

```
(a) 12 盘逐盘有终局: 要么 propose 成功走完 close→claim, 要么走退款路, 要么裁定"物理不可判"并
    落一条带理由的终态 —— 🔴 不许继续留在 verifying 让 tick 永远重试
(b) 族① 的墙有一个不依赖 backward walk 的解(deadline 太老时的替代 endBlockHash 来源),
    或者显式裁定"超过 MAX_WALK 的盘走退款", 二选一, 成文
(c) 族② 的 unreachable 定位到【具体哪一行 + 那一行的实际参数值】, 不接受候选式归因
(d) 🔴 钱的去向: 8 盘每盘一个链上结论(仍锁着 / 已退 / 已被花走且去向为 X)
(e) 那条 critical 告警要有一个【会被人看到】的出口 —— 否则下一次卡 20 天还是没人知道
```

---

## 3. 两格对第三、四段的结论

```
✅ 格① settleMarketLive: 不再构成阻塞 —— 缺陷已修、欠款已补、补付已链上抽样证实
   🟡 但 §1.5 三格历史债仍开着(它们是【历史账目完整性】, 不是【现役资金缺陷】, 不该卡搬迁)
🔴 格② claim-complete: 仍构成阻塞, 且理由比路线图原来写的更硬 ——
   不是"躺着一个已知 bug", 是【12 个盘此刻正卡着, 其中至少 352.25 KAS 链上锁死,
   另有 8 盘钱的去向未知】
⇒ ⇒ 🔴 所以批零卡第三四段这件事【结论不变, 但理由要换】。
   拿一句过期的话卡着真实工作, 和拿一件真事卡着, 是两回事 —— 后者才守得住。
```

---

## 4. 我自己的仪器坑(留给下一个人,别重踩)

### 4.1 判据的两个数出自同一个坏计数器 = 空判据

我第一版判据是「`evidence.winners` vs `claim_txids.length` 对不对得上」。
🔴 **这是空的** —— #33 当年查实:这两个数**出自同一个坏计数器**(任何带 `txId` 的尝试都算数,
含没到账的)。两数一致只证明它们同源,不证明钱到了。**救我的是去读当年的设计稿,不是自己对着库现推。**

### 4.2 "查了三条路都是空" —— 其实是同一条路查了三遍

我先后查了 ①建盘 `side_p2sh` ②建盘 `shard_p2sh` ③用 `shard_redeem_hex` 派生的地址,全 0,
一度当成三路独立佐证。
🔴 **实测发现 `p2sh(shard_redeem_hex)` 逐字符等于库里存的 `shard_p2sh`(抽 8 行 8/8 相等)**
⇒ ③ 和 ② 是同一个地址。而 leaf 地址是 **state-in-address**,随 state 变 —— 三条路都查的是创世地址。

### 4.3 🔴 对照臂选错 = 对照臂没有功率

第一次的对照臂我选了一个**已 completed 的盘**:它本来就该是空的,所以"查到空"什么也证明不了。
换成**当前活着、有下注的盘**(jkq9e,leaf state 声称 15.00 KAS)后:
派生地址链上实查 **15.00 KAS**,且**与建盘地址不同** ⇒ 一次同时证明了「派生有功率」和「leaf 地址确实随 state 变」。
🔵 **⇒ 对照臂必须选一个"如果工具是好的就必然非空"的样本,不是随便选一个已知样本。**

### 4.4 失败长成合法答案

查下注额时我写了 `SUM(amount_sompi)` —— 那一列**不存在**(真列名 `stake_amount`),
且 `pool_bettor_sides.market_id` 存的是 **shard 级 id**,不是 logical market id。
两处都错,而输出是一张**格式完整的表,每一行都写着 `0 笔 / 0.00 KAS`**。
🔵 救我的是那条**先跑一个已知非零样本**的对照臂,它当场报了"查询没功率"。

---

## 4.5 审查边界: 我审了「那个文件」,而该审的是「会被执行到的那条路径」

为 §2.7 的下一步(用既有链锚路径重建 leaf state)做安全前置审查时,我先报了一句
**「`bshard-close-enforce.mjs` 956 行全文只有 2 条 DB 语句、都是 SELECT ⇒ 模块本身纯读」**。

🔴 **那句只审了那一个文件,而它 `import` 了 8 个模块,我一个都没审。** 补审后:

```
7 个(judgeline / fee-split / pool-committee-sampler / pool-merkle-v06 /
     oracle-evidence-extractors / pool-payout-root …): 零写语句
🔴 shard-allocator.mjs 有【3 条写语句】:
     INSERT INTO market_shards            (:111)
     UPDATE market_shards SET status='sealed'  (:118)
     UPDATE market_shards SET bettor_count=…   (:140)
✅ 而 enforce 路径只 import 并调用它的 listShards(:151-153)—— 函数体是一条 SELECT
```

🔨 **⇒ 正确的说法**:不是「模块纯读」,是
**「被调用的那个函数纯读,而模块里就放着三条写语句」**。
🔵 两句的差别落在下一个人身上:前一句会让他觉得整个模块随便用,而那三条写语句就在同一个文件里,换个 import 就够得到。

🔵 **触发本条的是 NWT 同日的同形状发现**(他审 sibling 伪造面时只 grep 了 `INSERT INTO relay_nodes`,
而那道闸按 `address` 匹配 ⇒ `UPDATE` 改地址与 `INSERT` 等效 ⇒ 整个 UPDATE 面漏掉)。
**⇒ 同族(2026-07-28 一天内三例)**:

| 例 | 测量/审查实际覆盖的对象 | 被贴到的那个更大的对象 |
|---|---|---|
| NWT | `INSERT` 面 | 「能写 address 的路径」 |
| Bettor | 「打断 0 个客户端」 | 「零代价」 |
| 本条(J2) | 「这个文件」 | 「这条路径」 |

🔨 **通则**:文件 / 一个关键字 / 一次测量,都是**手边最容易画的边界**,不是**正确的边界**。
交付前问一次:**我这个判据实际覆盖的是什么,我要用它说的又是什么。**

---

## 5. 强度总表(本文件每一格的定价)

| 格 | 强度 |
|---|---|
| settleMarketLive bug 曾真实存在 + 损失数字 | ✅ 已实测(代码/设计稿/归档 ledger + NWT 当年链上取证) |
| 修复已落码 | ✅ 已实测(逐行读码) |
| 修复在 live 上跑 | ✅ 已实测(live 库有新码才写的字段,含一行 complete=false 的活证) |
| 20 盘欠款已补(DB 层) | ✅ 已实测 |
| 补付真到账 | ✅ 链上抽样已实测(3 盘 59 笔 → 57 硬证据 / 2 不可判),🟡 **抽样非全量** |
| 60 盘 clean_provisional 干净 | 🔴 **未验**(设计稿自己说不许采信) |
| 4 盘手驱历史盘 | 🔴 **未验** |
| 12 盘卡死 + 失败步 + 错误字符串 | ✅ 已实测(events 表逐字) |
| 族① 根因 = MAX_WALK 同墙 | ✅ 已实测(两处调用点逐行读码 + 错误字符串吻合) |
| 族② `unreachable` 的原因 | 🔴 **未验**(只有字面文本,不写归因) |
| 4 盘 352.25 KAS 链上锁死 | ✅ 已实测(带有功率的对照臂) |
| 另 8 盘钱的去向 | 🔴 **未知**(唯一剩下的候选=推进后的 PS 地址,未查) |
| "这些盘里有 N KAS"这个数 | 🔴 **不可引用**(DB 两套账互相矛盾,见 §2.6) |
