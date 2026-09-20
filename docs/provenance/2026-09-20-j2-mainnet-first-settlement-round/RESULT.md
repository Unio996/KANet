# 主网首轮结算(proto-v0)—— 结果与证据(2026-09-20, J2)

**结论**: 复用主网市场 a59c7b48(2026-09-15 已 genesis + 1 注), 补 1 注后, 结算驱动在主网真节点上自动走完 seal → close_commit → convert_to_claim → claim_draw, 四步全部节点接受 + 落链 + 落库。Owner GO 经 Bettor 转达; 判定(winning_side)由 Bettor 走受控 write-once 流程写入(见"诚实边界")。

市场 `a59c7b483caafddadd0dae5f6811129396cda49415405bbc1c984a9ff1882a79`; winning_side=1(side1 赢); 池 = 1(side0) + 1000(side1) = 1001; 主网 relay `proto-v0-funds`(启动断言硬顶 5 KAS, 本轮 4.0899 → 2.5609 KAS)。

| 步 | txid | 广播 | 驱动日志(20s tick) |
|---|---|---|---|
| 补注 side1/1000(append) | 04553cfdd2d9641738864d6c3d09eff21d64494c83d0c8554c6e1ef7b4fd83f9 | 09:49:04 | proto-driver tick 2 betAppendLanded=1(09:49:12Z landed) |
| seal | 18a01701ec633fa62e1f75e7728e9c2a77deb3d855f8e1db38cf8355d6be284e | 09:49:33 | tick 3 submitted:1 → tick 4 landed:1(09:49:54Z) |
| close_commit(intent step=resolve) | c832e532aefea360a1177b5e9a67a98abf60e1193a035036249640dc414c8f42 | 09:50:53 | tick 7 submitted:1 → tick 8 landed:1 |
| convert_to_claim | da109e35ff795d24c54903d529f466969754c42bbca307183fa0c78bf2d24a70 | 09:51:33 | tick 9 submitted:1 → tick 10 landed:1 |
| claim_draw | 1608804e5264cf50b6b674dd69a87f7520ea82d6f62a31a86cb84963b84ffe18 | 09:52:13 | tick 11 submitted:1 → tick 12 landed:1 |

终态: markets.status=resolved; 4 条 settlement 意图全 landed 且 last_error=NULL; proto_claims 1 行 amount=1001 claim_txid=1608804e…fe18 claimed_at=09:52:32.993Z。
时序: 下注 09:49:03Z → claim landed 09:52:32Z ≈ 3.5 分钟; seal landed(09:49:54) → close_commit landed(≈09:51:10) ≈ 76 s。
relay 余额: 4.0899 → 2.5609 KAS(5 笔约 1.53 KAS; 事前用 simnet 全轮真交易拟合的估计为 1.95 KAS, 实际更省)。
error 级事件: 仅 `settlement_close_commit_refund_flip_open`(09:50:53Z) —— 预期内的 SLA 告警(该市场 deadline 为 5 天前, pmt−deadline ≥ 2h 即报"refund_flip 已开放"; 驱动仍照常提交并赢下竞争)。无 REFUSED、无 fee_window / no_suitable_fee_utxo。

## 为什么复用旧市场(路径选择记录)
relay 现有 UTXO 为 4×0.95 KAS + 3 个小额; 各步 fee 窗口 seal≥0.52 / close≥0.30 / convert≥0.52 / claim≥0.50 KAS(feeProfile 上限, 与 ≤1.0 KAS 签名输入上限之间), 且 <5 KAS 天花板下无法再补。按 simnet 全轮真交易的逐笔消耗拟合: 全新市场(7 笔)会在 claim_draw 因无合格 fee 候选卡住; 复用(5 笔)有余量。链上先核 a59c 最新 append 的两个 covenant 输出仍是主网未花 UTXO。

## 已知代价(已知会, 已缓解)
复用的市场 deadline 已过 5 天 ⇒ RootClose.refund_flip(tx.time ≥ deadline+2h)在 seal 落链后对任何人已开放, seal→close_commit 之间存在被抢先翻成退款态的窗口。缓解: 判定 SQL 预置、seal landed 即刻通知写入、驱动 tick 缩到 20s; 实测窗口 ≈ 76 s, 未被抢。新建市场(deadline+2h 才开放)无此暴露。

## 诚实边界(未证明的)
- 复用旧市场 + 单赢家(两注同一委员公钥)+ 受控判定(winning_side 由 Bettor 走受控 write-once SQL 写入: 我观察到 09:50:42Z 起 w=1; before/after 读数由 Bettor 记账); 仓内尚无正式 resolve 路径(9-3 未做; oracle 整合另轨)。
- 未验证: 新建市场直达主网 / 多赢家 / 并发多市场 / V1·V2 污染费率向量 / probeRefundFlip(未实现)。
- proto 路由在应用层无鉴权, 依赖只监听回环(运行时已核)——已知设计现状, 改动须另走审核。

## 文件
- console-proto-lines.log —— 主网 console stdout 中 proto 驱动 / COVENANT_BROADCAST / REFUSED 行(已 grep 确认无密钥字样)
- db-final-state-readonly.json —— 主网 console 库终态只读读数(市场 / 注 / 意图 / claim / 09:48Z 后 error 事件)
- postround-readonly-state.json —— 只读预检脚本在回合结束后的输出(监听地址 / 路由 / relay UTXO 形状 / 节点同步)
- 上游: 主线 b6f744b5(pointers 形状修)及 docs/provenance/2026-09-20-j2-batch9-94-simnet-clean-round/(simnet 干净轮)。
