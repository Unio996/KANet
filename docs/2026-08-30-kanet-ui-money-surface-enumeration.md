# 重启前花钱面枚举 (KANet-UI · console wasm 撞顶前有序重启用)

> 2026-08-30 · 应新 Bettor(后台协调) 请求 · **纯只读枚举, 非动作**。
> 背景: console 16140 的 kaspa-wasm 线性内存持续涨(J2 六层诊断中), 约撞 4GiB 顶前需一次有序重启;
> 本文枚举"重启窗内会花钱的面", 供 drain/quiesce 决策。**只列清单 + 判据, 不含 quiesce/stop 动作**(那是生产态动作, 非清才另写四条 + NWT 审)。
> 只读脚本: `scratch/_preshutdown_money_surface.mjs`(SELECT 状态表 + 列 timer/ingress + 输出清/非清; 不写 DB、不 stop 定时器、不重启)。

## 三类花钱面 (memory: preshutdown-inflight-check + money-surface-is-timers-plus-ingress)

### (a) 状态型 in-flight — 业务流程中间态 (DB 持久态, console 重启不改 DB)
查表 + transient status(非终态):
- `pending_actions.status`(broadcasting/pending/signing/preparing = 在飞)
- `pool_markets.protocol_status`(collecting_sigs / verifying / refunding / pending_oracle_deposits / pending_bettors = 在飞)
- `exchange_offers.protocol_status`(collecting_sigs / matched / verifying / delivering / open_awaiting_taker_stake / pending_taker = 在飞)
- `mm_orders.status`(pending / accepted / paid / verifying / delivering = 在飞)

### (b) 定时器型广播 — setInterval/cron, 停机那刻可能正广播 (30+ 组件)
> 判"能否被中断"**须读代码看有无 broadcast-then-write-local-state 模式**(有=半截态风险; 无=可自愈, 如 broadcaster-utxo 走 sendCommandAsync、console 只发起+打日志、无本地写 ⇒ 中途杀 console 最坏是某 relay 这轮没做成、下轮补上)。

| 组件 | 路径 | 广播内容 |
|---|---|---|
| **broadcaster-utxo** | `src/lib/broadcaster-utxo.mjs` (index.js:731 cron) | **3min UTXO rebalance**(memory 点名曾漏; 走 sendCommandAsync 无本地写=自愈) |
| bettor-prediction-settler | `src/services/bettor-prediction-settler.js` | 预测结算派奖 |
| bettor-prediction-voter | `src/services/bettor-prediction-voter.js` | oracle 投票 |
| bettor-refund-claim-auto | `src/services/bettor-refund-claim-auto.mjs` | 自动 refund |
| bshard-settle-daemon | `src/services/bshard-settle-daemon.mjs` | 分片结算 tick |
| bshard-close-voter | `src/services/bshard-close-voter.js` | 关闭投票 |
| market-seeder / pool-market-seeder | `src/services/market-seeder.js`, `pool-market-seeder.js` | 做市挂单 |
| pool-market-settler | `src/services/pool-market-settler.js` | pool 结算 |
| pool-auto-better | `src/services/pool-auto-better.js` | 自动下注 |
| oracle-pool-renewal-cron | `src/services/oracle-pool-renewal-cron.mjs` | oracle 续期 |
| broker-* watchers | `broker-intake-watcher` / `broker-buy-completion-watcher` / `broker-bsc-intake-watcher` / `broker-inventory-watcher` 等 | broker 成交/入金/清算 |
| relay-manager | `src/services/relay-manager.js` | relay 命令派发(所有广播的最终出口) |

### (c) ingress 触发型 — 窗内一条 DM/协议消息/HTTP 到达即花钱 (不等 tick)
- 提现 DM: `broker-v2/router.js:182` + `broker-v3/router.js`
- exchange `transition()` auto-pay + auto-deliver(协议消息同步 handler): `exchange-machine.js`
- publish/质押: `api/bettor.js`
- faucet: `chat.js`

## drain clean 判据 (重启安全 ⟺ 全部满足)
1. **(B) 最近 >60s 静默**: tx_records/pending_actions/broadcast_messages/mm_orders/exchange_offers 无新 created/updated;
2. **(A) 无活跃 transient**(或已知可自愈); 历史持久 transient 积压(卡在等结算恢复)重启前后不变、不算活跃在飞;
3. **(B2) 在飞 tx 全 landed**(depth 20); 4. **(C) relay 日志末条 landed**(非 broadcasting)。
> 若非清: **不在脚本里 quiesce** — 另写"停什么/怎么停/怎么等落链或失败/怎么恢复"四条 + NWT 审, 批了才动(生产态动作)。

## 首次试跑快照 (2026-08-30T00:08Z · IBD 期)
- **drain 判据 CLEAN**: (B) 最近 120s 全 0(无新广播/更新); (B2) 最新 tx_records 是 8/23 broadcasted 终态、无近期在飞; (C) relay 末条 = `split_utxo failed: RPC Server -> Rejected transaction`(IBD 期 relay 看不见 UTXO, 广播被拒 = 无活跃花钱)。
- (A) 历史 transient 积压: `pool_markets` collecting_sigs2/verifying93/refunding16/pending_bettors31/pending_oracle_deposits8; `exchange_offers` collecting_sigs3/pending_taker3/open_awaiting_taker_stake2 —— **结算停摆前的持久 DB 态**(非活跃在飞; console 重启不改 DB)。
- ⇒ **当前重启对花钱面安全**(IBD 期无活跃广播); 大概率用不上 quiesce/drain。真重启前再跑一次本脚本确认瞬时静默。
