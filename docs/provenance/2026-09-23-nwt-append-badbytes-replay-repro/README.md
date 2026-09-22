# NWT — 背靠背两笔下注第二笔 append 建出确定性坏字节·无退避永久重播(账本1645/1646 派)独立复现

**任务来源**:Bettor(claude-90,经 kanet-tn12-52 转)2026-09-22 指令——把我 9-22 FZ 独立复现时意外撞到
的"背靠背两笔下注、第二笔 append 建出坏字节后被无退避永久重播"独立复现一次,只报事实不修:最小复现
步骤、坏字节验证失败原文、重播次数与间隔、涉及代码行、严重度判断、兜底形状建议。

## 结论(先说,含一次自我纠正)

**关键发现,更正原始框架**:这**不是竞态**(不依赖背靠背下注的时序窗口)。本次复现里,bet1 的 append
在 bet2 尝试构建**之前已经完全 landed**(bet1 落地于 18:31:20,bet2 的构建/广播发生在 18:31:58,相隔
38 秒,由**正常的 20 秒驱动 tick** 触发,不是我手动加速造成的)——`assertNoInFlightAppend` 守卫本次
**正确地**先短暂拦截了一次(bet1 还在 submitted 阶段时),bet1 落地后守卫自然放行,bet2 走**全新一次**
构造,构造时用的是 bet1 已经**正确落链的真实状态**,结果**依然**产出一笔验证失败的交易。**这证明根因
是"作为某市场第二个 sequential append 去构造"这个场景本身的确定性构造缺陷,不是"抢跑用了过期指针"
的时序假象**——9-22 那次因为背靠背下注,我误把"守卫时序敏感"当成了主因,这次严格复现证明与时序无关,
特此更正。

**重播行为**:一旦产出这笔坏字节并持久化为 `prepared`,driver 每个 tick(**精确 20.0 秒一次,零抖动**)
原样重播同一份字节,relay 每次都拿同一个"已知会失败"的 txid 去广播,节点每次都用**逐字相同**的原因拒绝,
**17 次连续重播,320 秒观察窗内零退避、零升级、零告警**,状态一直停在 `prepared`(不是仓库自己定义的
"ambiguous"态,那个态是留给"广播回 inputs_spent 且无正向证据"这一支的,不适用于这种"节点直接拒绝签名
脚本"的失败)。

## 环境

- 节点:`D:\rusty-kaspa-v201\kaspad.exe`(与主网同一份二进制),全新隔离 simnet,appdir
  `D:\kanet-tn12\scratch\_nwt_append_badbytes_kaspad_data`,wRPC `127.0.0.1:28516`。
- worktree:`scratch/_nwt_wt_f1adv_review`(分支 `nwt/f1adv-rerun-review-20260922`,HEAD `749dd855`)。
- **未改仓库源码**;harness 脚本只读拷贝自我自己之前几轮的 `scratch/_nwt_f1_crash_arm/`,按路径/端口替换。
- 主网(pid 16464)全程未触碰;J2 的树全程未进入(J2 在做 D-032)。

## 最小复现步骤

1. 真创世(生产 builder,`make-market.mjs` → `proto-market-intent.mjs::ensureMarketPending`),等 landed
   →`status=betting`。
2. `bet(side=0, stake=1500)`,等 append 落地(`status=landed`)——本轮实测这一步本身撞了一次**无关的**
   瞬时 relay 重启(见下"噪声说明"),不影响结论,只是把 bet1 落地时间推迟到了 18:31:20。
3. `bet(side=1, stake=1600)`——本次是在 bet1**已经 landed 之后**(相隔 38 秒,由正常 tick 驱动,非背靠背)
   才轮到构造,**不需要背靠背时序**即可复现,这是本轮相对 9-22 的关键新发现。
4. 观察:driver 下一 tick 即产出 `prepared_txid` 并广播,relay 报"script ran, but verification failed",
   之后每 20 秒原样重播同一 txid,直到手工介入(本次未介入,只观察记录)。

## 坏字节验证失败原文(逐字)

```
RPC Server (remote error) -> Rejected transaction 30103fea584dda182bd280bfe911ce0bd4d53eeafdf0948479410d0a9dee5d2e: failed to verify the signature script: script ran, but verification failed
```

## 重播次数与间隔(精确测量,320 秒观察窗)

17 次重播,时间戳(节点本机时区,逐字从日志提取)：

```
01:32:18  01:32:38  01:32:58  01:33:18  01:33:38  01:33:58  01:34:18
01:34:38  01:34:58  01:35:18  01:35:38  01:35:58  01:36:18  01:36:38
01:36:58  01:37:18  01:37:38
```

**间隔精确为 20.0 秒,零抖动,零退避**(对照 `proto-driver` 的固定 tick 间隔 `20000ms`)——观察窗内没有
任何一次间隔偏离 20 秒,没有任何"第 N 次失败后放慢"的迹象,与代码里也确实找不到任何速率限制/计数升级
逻辑这一点吻合。完整 17 行日志见 `evidence/all-17-replays.log`。

## 涉及代码行

- **触发点(driver 每 tick 无条件重试)**:`kasia-console/src/services/proto-driver.mjs:133-152`——
  `appendPendingRows` 这条 SQL(`WHERE step='append' AND status IN ('pending','prepared')`)每个 tick
  都会重新选中这一行,`driveBetIntent({..., maxAttempts: 1, ...})` 每次只试 1 次就返回,失败被
  `catch (e) { if (e.hold) out.held++; else out.errored++; }`(`:148-151`)吞掉记成 `errored`,**没有
  任何字段记录"这是第几次连续失败"或"上次失败是不是同一个错误"**,所以下一 tick 会一模一样地再来一次。
- **重播判定路径**:`kasia-console/src/lib/proto-bet-intent.mjs::resolvePrepared`(`:125-179`)——
  `status='prepared'` 的行永远走"④ 同字节重播"这一支(`:151-156` 调 `covenant_broadcast` 命令,
  `replay_tx_json` 传的是原封不动的 `row.prepared_tx_json`),失败只会 `throw`(`:178`),**没有任何分支
  会把"节点直接拒绝签名脚本"这种失败归类为需要重建的情形**——唯一会转 `ambiguous`(停止重播)的分支是
  `rep.code === 'inputs_spent'`(`:165-177`),本轮的失败原因是 `failed to verify the signature script`,
  不匹配这个 code,所以永远落到最后一行 `throw new Error(...)`(`:178`),被 driver 当普通失败重试。
- **确定性坏字节的构造入口**(未深挖到 SIL 层根因,只标出构造函数,供 J2/Owner 判断是否要继续查):
  `kasia-console/src/lib/proto-broadcast-ops.mjs::buildRegisterAppendAndBroadcast`(`:185-232`)——
  `heldOutpointRaw` 非空时(即"这是市场第二个及以后的 append,前一笔的 held KTT 输出存在")走
  `:218-232`/`:252-258` 的 held-input 分支,与首笔下注(`heldOutpointRaw` 为空,无 held 分支)走的是
  **不同代码路径**;真正的字节+签名在 `kasia-console/src/lib/proto-tx-assembly.mjs:512
  (buildRegisterAppendTxJson)`。本次复现证明:即便 held 分支读到的链上状态是**正确落地后的真实值**
  (不是过期指针),构造出的签名脚本依然验证失败——缺陷在这条 held 分支自身的某处编码逻辑(可能是
  leaf state 派生、held-KTT 转移见证或 ShardLeaf_direct 的 register_append 入口 ABI 参数装配),
  本轮未定位到具体是哪一步,只确认"held 分支 100% 复现失败,无 held 分支(首笔)从未失败"这个界限。

## 严重度判断(NWT 自评,供 Bettor/Owner 定级)

**比 9-22 报告时的认识更严重**:9-22 时我把它当"背靠背下注撞上的窄时序竞态",隐含"正常间隔下注不会撞上"
的假设。**本次证明这个假设是错的**——bet2 是在 bet1 完全落地 38 秒后、由正常 tick 触发才构造的,依然
100% 复现。这意味着:**任何市场只要有第二笔及以后的下注,append 就会确定性失败**(至少在这套
市场参数/下注金额形状下;未测试是否所有 stake/side 组合都复现,或是否有某些参数组合能绕开,见下"未覆盖
的变量")。

后果链:该笔下注永远卡在 `status='pending'`(赢家/输家都无法确认下注)→ `sealSql` 的触发条件之一是
"零非终态 append 意图"(`proto-settlement-store.mjs:78-79`,我 F1 崩溃臂那份 provenance 也记过这条
读代码结论)→ **只要有一笔下注的 append 卡在 prepared/pending,整个市场永远无法 seal,不止第二个
下注人的钱受影响,第一个下注人已经落地的下注也永远等不到结算**——除非有人手工 DB 介入(我在 9-22/
崩溃臂两次都是直接 DELETE 那笔卡住的下注+意图行来解围,不是代码自带的恢复路径)。

**如果这个界限(第二笔必然失败)在生产参数范围内普遍成立,这不是"边缘竞态"级别的 SHOULD,是"任何
两人以上参与的市场都无法正常运作"级别的功能性缺陷**——具体定级(MUST 还是 SHOULD)留给 Bettor/Owner,
本文档只如实报告观测到的事实和推导链,不越权定级。

## 建议兜底形状(供参考,不代 Bettor/J2 拍板)

1. **最小改动**:在 `resolvePrepared`(`proto-bet-intent.mjs`)里给 `prepared` 行加"连续同错误计数"
   (可以是新列,也可以是 `last_error` 与本次错误比对+一个计数列),达到阈值 N(比如 5,对应 100 秒)后
   转 `ambiguous`,复用已有的"ambiguous = HOLD,人工审"路径(`:174-177` 那条分支的姊妹逻辑),而不是
   新造一个态。
2. **告警**:达到阈值时调 `alertBetIntent`(该函数已存在,`:102`),写 `events` 表 + 播频道,让人知道
   有市场卡死了,而不是只在日志里默默重复。
3. **不建议**:自动重建字节(比如换个 fee 输入重新 `buildAndBroadcast`)——本次证明失败原因不是"字节
   过期",重建大概率产出**同样错的**字节(因为构造用的链上状态本身就是对的),自动重建只会换一个新
   txid 继续失败,徒增复杂度不解决根因。真正的根因需要 J2 去查 held 分支的签名脚本装配逻辑。

## 未覆盖的变量(如实说明本次复现的边界)

只测了一组参数(bet1 side=0/stake=1500,bet2 side=1/stake=1600,`min_bet=1`,`seal_count` 由
`make-market.mjs` 固定传 1——注意这与"第二笔下注"这个复现条件看似矛盾:`seal_count=1` 本该在第一笔下注
后就直接封盘,不该再接受第二笔;本轮 `sim-actions.mjs bet` 命令没有检查 `seal_count`,直接调用生产
`/api/proto-markets/:id/bet`,这条 HTTP 路由本身在 bet1 落地封盘之前(还是 `betting` 状态)接受了 bet2
的下注请求——即"抢在封盘前多投一注"这个场景本身是否该被路由层拒绝,是另一个可能相关但本轮未展开调查
的问题,记一笔不深挖)。未测试:多组不同 stake/side 组合、`min_bet` 更大的市场、第三笔及以后的下注是否
同样确定性失败。这些留给 J2/Owner 判断是否需要进一步覆盖。

## 收尾

kaspad(pid 30960)/console(pid 5428)/miner(pid 34012)均已 `taskkill /F` 停止,PowerShell 命令行核对
无残留。主网(pid 16464)全程未改动。未修改任何仓库源码(`src/` 零改动)。

—— NWT, 2026-09-23
