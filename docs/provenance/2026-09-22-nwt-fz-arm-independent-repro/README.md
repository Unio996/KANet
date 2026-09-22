# NWT FZ 臂独立复现(账本1621③/1640/1641 派) — GREEN: F1/F1b hold 在全新独立 simnet 上成立

**任务来源**：Bettor(经 kanet-tn12-8c 转)2026-09-22 14:xx 指令 ——「② FZ 臂独立复现(关 3):在你自己的 worktree 起全新 simnet…只试一次,成与不成都写 provenance」。
本文档是**唯一一次尝试**的完整记录(未重试)。

## 结论(先说)

**GREEN — 在一个从创世起、全新独立起跑的 simnet(与 J2 的树、DB、端口、appdir 完全不共享)上，冻结市场的一笔已 prepared 但未广播的 `close_commit`(resolve 步骤)在 90 秒观察窗内【未被广播】**，driver 把它标为 `status=prepared, last_error='settlement_frozen_prepared_hold'`，节点侧(mempool 查询)确认该 txid 从未进池。这与 J2 F1 对抗重跑的 PC/F1b 臂结论一致，是对 F1(`proto-settlement-intent.mjs` 的 `resolvePrepared()` 冻结重查)这条修复的**第二次独立复现**，且是**第一次在非 J2 own 树/own DB 上**复现。

顺带独立验证了 J2 diagnosed 的③号现象(simnet solo mining 越过 DAA~1000-1100 pmt 永久冻结)：**本次从创世起一次性配齐参数,连续挖矿越过 DAA 1000-1100 区间(实测 DAA 950→1130 区间),pmt 未永久冻结**——出现的是有界的"滞后-爆发"振荡(gap 在 1-9 分钟间波动,每次爆发后回落),不是 J2 描述的"从未低于 14 分钟且持续增长"的永久冻结信号。样本见 `evidence/pmt-daa-samples.jsonl`(逐 30s 打点,覆盖 DAA 163→2905 全程)。**这只能说"从创世一次性起跑"这条路径下、这一次没有复现该冻结**,不能说该现象不存在或"根因已排除"——J2 自己也把③号的根因判定留在"现象钉死,因果未证"这一档,本次结果与之相容,不升级为确定结论。

## 环境(与主网/与 J2 树完全隔离)

- kaspad 二进制核对：`D:\rusty-kaspa-v201\kaspad.exe --version` → `kaspad 2.0.1`；`sha256sum` → `8afe6a6859067a859ac255c77946ca881cd5bbae4230a1906fff3841044c6e38`(与既有 provenance 记录、J2 本轮记录一致)。
- 启动参数(一次性、从创世,全程未重启/未换参数)：
  `D:\rusty-kaspa-v201\kaspad.exe --simnet --appdir=D:\kanet-tn12\scratch\_nwt_fz_repro_kaspad_data --rpclisten-borsh=127.0.0.1:28512 --utxoindex --enable-unsynced-mining --disable-upnp`
  (与主网 `16110`/`17110`、与 J2 已停用的 `28511`/`3299` 端口/appdir 均不同;wRPC 实际落在 P2P 默认 `16511`/gRPC `16510`,与主网 testnet12 端口不冲突)。
- worktree: `D:\kanet-tn12\scratch\_nwt_wt_f1adv_review`(分支 `nwt/f1adv-rerun-review-20260922`,HEAD `749dd855`,与 J2 对抗重跑同一提交)。独立 `npm ci`(kasia-console + kasia-relay 各跑一次)。
- console: 独立 DB `D:\kanet-tn12\scratch\_nwt_fz_repro\console.simnet.db`(全新迁移,v214),独立 relay 行(`proto-f1-adv-relay`),独立 `PROTO_RELAY_ID`,独立 `INGEST_SECRET`,`PROTO_ORACLE_ADAPTER_ENABLED=0`(非判定题场景)。端口 3300。
- harness 脚本:只读拷贝自 `scratch/_j2_f1adv_run/`(J2 的树,未改 J2 任何文件),拷进自己的 `scratch/_nwt_fz_repro/` 后按路径/端口 sed 替换 + 3 处必要的本地修复(见下)。
- 主网 kaspad(pid 16464,`--appdir=D:\kaspa-mainnet-data-v201 --rpclisten-borsh=127.0.0.1:17110`)全程核过未改动、未触碰,收尾再次核对仍在跑。

## 对拷来的 harness 脚本的必要本地修复(均只改本地副本,未碰 J2 树/仓库源码)

1. `make-market.mjs` / `seed-prepared-close.mjs` / `sim-actions.mjs`:三处硬编码的 `REFUSE` 环境校验字符串仍写着 `_j2_f1adv_run`,改成 `_nwt_fz_repro`(否则脚本会拒绝在自己的隔离环境上跑——这是好事,fail-closed 生效了,只是校验字符串要跟着换)。
2. `setup-console.mjs`:relay 名字硬编码写的是 `'f1-adv-relay'`(无 `proto-` 前缀),而 `proto-relay-guard.mjs` 的 `assertProtoRelayHealthy` 要求名字必须以 `proto-` 开头(名字前缀是"这是可 sacrificial 的 proto relay 不是生产 relay 被误接"的人工绊线)——**J2 自己实跑时用的是 `proto-f1-adv-relay`**(见 `docs/provenance/2026-09-22-j2-f1-adversarial-rerun/00-pre-miner-report.md` 行 23),说明 J2 也在自己本地副本上打了同一处修复、只是没把这行改动写回可复用的脚本文件里——**这正是我在①审 J2 provenance 时给的 SHOULD 建议("旧 harness 脚本因主线新增必填参数需要打本地补丁时,provenance 里贴具体 diff")的又一个实例,记一笔**。
3. `launch-console.mjs`:同样的路径/端口校验字符串问题 + 移除了 `--import <oracle-mock>` 参数(本场景是非判定题市场,不需要 ESPN/Polymarket 上游 mock)。

## 时序(逐步真实操作,非脚本化 drive)

| 步骤 | 结果 |
|---|---|
| kaspad 起(单次,全参数) | pid 19120, wRPC 28512 |
| console 起 → 迁移 v214 | 首次因 `PROTO_RELAY_ID=REPLACE_ME` fail-closed(预期,relay 还没建) |
| `setup-console.mjs` | relay 行建好,发现名字前缀问题(见上②),UPDATE 改名后重启 console 通过健康检查 |
| 矿工起(1 blk/s,单矿工,coinbase 付一次性地址不付 relay) | 独立验证③号现象(见下"pmt 冻结独立验证"小节) |
| `fund-relay.mjs fund` | 等币基成熟(~1000 DAA,~17 分钟)后成功,relay 流动余额 3.96 KAS(4×0.99) |
| `make-market.mjs F <deadline+5min>` | 建市场 `2d0cedb2…c1802b`(`seal_count=1`,非判定题) |
| 两笔下注(≥1500,按 Bettor 要求避开 CLAIM_PAYOUT_MIN=1000) | **bet1(side=0, stake=1500)confirmed;bet2(side=1, stake=1600)撞上一个真实的、可复现的 append 竞态缺陷(见下"意外发现"),永久卡死,手工退掉** |
| 退掉 bet2,市场以 1 笔下注 seal(`seal_count=1` 满足) | `status: betting → sealed` |
| SQL 直写 `winning_side=0, source='operator'`(`/resolve` 是占位 501,已核实是唯一路) | 触发器全过(operator 源 + 无判定题字段 + status='sealed' 未变 + 未与冻结同语句) |
| `sim-actions.mjs freeze`(复用仓库真 `freezeMarket()`) | `frozen_reason='operator_emergency_stop\|clock=pmt'` |
| 等三条前置(pmt > deadline+50s ∧ wall ≥ deadline+300s ∧ fee-payer coinbase 成熟) | 分别在 T+X 满足,详见 `evidence/pmt-daa-samples.jsonl` 与脚本自打点 |
| `seed-prepared-close.mjs run`(真 `ops.build('close_commit', …)`,传 `ctx.intentKey`,payer 真签第二输入) | 见下"核心结果" |

## 核心结果(逐字)

```
seeded settle:market:2d0cedb2…:resolve fdaa82297a78b260b9930dfdc7ddd03e33e4d1f8fce51318732e9ce359bc92bd
{
 "seenBroadcast": false,
 "seen": null,
 "intent": { "status": "prepared", "submitted_txid": null, "last_error": "settlement_frozen_prepared_hold" },
 "market": { "status": "sealed", "winning_side": 0, "settlement_frozen_at": 1790090665026, "frozen_reason": "operator_emergency_stop|clock=pmt" },
 "node": { "isSynced": true, "pmtMs": 1790091371884, "wallMs": 1790092690633, "daa": "2905" },
 "windowSec": 90
}
```

节点侧独立复核(不依赖 harness 脚本自己的判定,另开一次 RPC 连接直查):
```
getMempoolEntry(txid=fdaa8229…) → found=false
```

代码机制核对(主线,非 J2 树,`kasia-console/src/lib/proto-settlement-intent.mjs:157-171`)：`FROZEN_HOLD_MARK='settlement_frozen_prepared_hold'`,`resolvePrepared()` 在①(mempool 已见)②(链上已落)之后、④(重播)之前插入③号检查——重读冻结列,冻结则 hold,不重播不重建不弃行。本次命中的正是这一条(mempool 未见 ∧ 链上未落 ∧ 冻结列非空 ⇒ hold),逐字匹配代码注释描述的判定顺序。

最终库状态(`evidence/final-state.json`)三行意图: `seal=landed`, `resolve=prepared/settlement_frozen_prepared_hold`, `refund_flip=pending/"pmt 尚未超过 deadline+7200000ms+30000ms 余量(差 7075179ms)"`——refund_flip 未到时间是正确行为(R-a 的 2 小时宽限期,本次冻结发生在 deadline 后不久,远未到 2 小时),不是本次要测的东西,如实记录状态。

## pmt 冻结独立验证(附带任务,非本轮主线,但 Bettor 要求"顺带独立核")

从创世起一次性配齐参数,单矿工 1 blk/s 连续挖矿,每 30s 打点 `{daa, pmtMs, wallMs, wallMinusPmtMin}`(全量见 `evidence/pmt-daa-samples.jsonl`)。挑关键区间(DAA 163 → 2905):

- DAA 163→998:gap 在 1.05~9.00 分钟间反复振荡("滞后若干个 30s tick,一次性补 ~50s"的爆发模式),**从未连续 4 个 tick(2 分钟)以上不动**。
- DAA 998→1130(J2 诊断的冻结窗口核心区间):**照常振荡、照常爆发**(998→1025 一次爆发,1055→1084 stall,1114 又一次爆发),gap 峰值 9.00 分钟,未见任何"从此不再变化"的迹象。
- DAA 1130→2905(继续到本次实际用到的高度):gap 峰值同样在个位数分钟,未见持续增长。

**结论(有作用域限定)**:本次"从创世起一次性配齐参数"这一条路径,在单机单矿工、约 45 分钟的连续挖矿窗口内,**没有复现 J2 描述的永久冻结**。这与③号诊断"未能证实、只钉死了现象"的谨慎口径相容——J2 两次复现都发生在"先漏参数起、再补参数重启同一数据目录"的历史下,本次刻意避开了那条路径,而且没有冻结,是对该假设(重启同数据目录是必要条件)的一次**正面(但非唯一样本)支持**。样本量为 1 次运行,不构成排除性证据;若要坐实"重启同数据目录"是充要条件,需要一个对照臂(同样从创世起跑但中途真的重启同数据目录,换参数),本次未做(不在本轮任务范围内,预算也不允许再插入一次数小时级等待)。

## 意外发现(SHOULD,非本轮主线,如实记录不隐去)

按 Bettor 计划,两笔下注本应几乎背靠背发出(未刻意加等待)。**第二笔下注(bet2, side=1, stake=1600)的 append 步骤永久失败**,现象:
- driver 先用 `assertNoInFlightAppend` 正确拒绝在 bet1 未落地前为 bet2 构建新字节(设计意图正确:同一市场的 append 是单线程链,不能并发)。
- 但**几乎同一时刻已经存在一份 bet2 的 `prepared` 字节**(先于 in-flight 判定建出来的),其输入正确指向 bet1 的**已知 txid**(链式 unconfirmed 依赖,合法模式),但广播时 kaspad 报 `failed to verify the signature script: script ran, but verification failed`。
- **排除了"陈旧输入"假说**:把该意图 `status` 重置为 `pending`(清空 `prepared_txid`/`prepared_tx_json`)、在 bet1 已确认落地之后,让 driver 重新走一遍 prepare,driver 立即重建出**逐字节相同**的交易(同 txid `cb3464680ee4…`)——说明这不是"用了过期指针"的竞态假象,而是这个特定场景(两笔下注几乎同时到达、第二笔的构建发生在第一笔尚未确认时)下,append 覆盖脚本/状态编码的构建逻辑**确定性地**产出一笔验证失败的交易。
- 代码自己的注释已承认这是已知的 v0 限制(`proto-leaf-state.mjs:137`: `"拒绝构造新的步骤B(ambiguous 需要人工处理, v0 不自动清)"`),所以**不作为新 MUST 上报**——但那条注释描述的是"拒绝构建新字节"这一半,没提到"已经构建出的坏字节会被 driver 永久重播、没有任何自动清理或告警升级路径"这一半(本次实测:同一条 `replay_rejected` 错误每 20s 重复 broadcast,持续到我手工介入退单为止,driver tick 摘要里稳定显示 `errored:1`,没有观察到任何频率衰减/退避/告警升级)。这半条是否值得单独立一条 SHOULD 交给 Bettor 判断是否需要补一条"prepared 行连续 N 次相同错误 → 升级为 ambiguous/告警"的兜底,本文档只如实记录现象,不代为定级。
- 恢复方式:直接 `DELETE FROM proto_bet_intents / proto_bets`(该 bet 从未真正广播成功过、未曾改变任何链上状态,删除是"撤回一次失败的下注尝试"而非伪造已上链状态,不违反 NO-TX-NO-STATE)。之后市场以唯一 1 笔确认下注(`seal_count=1`)正常 sealed。

## 证据清单

- `evidence/pmt-daa-samples.jsonl` — 45 分钟连续挖矿的 pmt/DAA 逐 30s 打点(约 90 行)。
- `evidence/actions.jsonl` — harness 各步骤(make_market/bet/freeze/seed_prepared_close_*)的时间戳化记录。
- `evidence/final-state.json` — 收尾时市场行 + 三条 settlement_intents 行的完整字段快照。
- `D:\kanet-tn12\scratch\_nwt_fz_repro\evidence\snapshots\final\console.simnet.db(+wal+shm)` — 收尾 DB 快照(进程已停,静态文件;5.6MB,未入库,留在本机 scratch,按需可查)。
- 本次全程未触碰主网(`kaspa-mainnet-data-v201`, pid 16464)/未触碰 J2 的树(`_j2_wt_e2e`)或 J2 的运行目录(`_j2_f1adv_run`,只读拷贝后即与之脱钩)。

## 收尾

kaspad(pid 19120)/console(pid 23832,含其 relay 子进程)/miner(pid 32404)均已 `taskkill /F` 停止,PowerShell 按命令行核对无残留(`_nwt_fz_repro`/`_nwt_wt_f1adv_review`/`proto-f1-adv-relay` 均零匹配)。主网 kaspad(pid 16464)收尾复核仍在跑、未改动。

—— NWT, 2026-09-22
