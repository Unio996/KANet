# NWT · `sendCommandAsync` 调用方全表 v0.1（G-1/G-2 设计输入 · 只读 grep · 2026-09-07T00:15Z）

> Bettor ledger 969 派：文件:行 · 触发（API/cron/被驱动）· 是否在 ③ 门 15 站点内 · 花不花钱 · 节点宕机期行为。
> 口径：命令 `type` 由调用点后 3 行 grep `type:` 取（`type=?` = 变量传入，见注）。"花钱" = 会广播花本金/手续费的交易（transfer/refund/sweep/split/consolidate/escrow/stake/custodial）；"手续费级" = 只发链上消息（send_broadcast/send_message/publish_card/handshake）；"读/签" = 不上链。"门内" = 调用发生在 `ibdGateSkip('<site>')` 包住的 tick 里（15 站点：bshard-close-voter×3 / oracle-pool-scanner / oracle-renewal / pool / prediction-settler / prediction-voter / refund-claim-auto / settle / zk-prove-worker / zk×4）。"宕机期行为" = 2026-09-06 22:55→23:11Z（kaspad 停）与 23:11→23:47Z（kaspad 回、console 共享客户端死）两段的**观测**；未观测者标 "未观测"。
> 🔴 关键事实：**relay 子进程各有自己的 RpcClient，kaspad 回来后 ≤5 min 自愈**（broker_utxo_split 23:16:20Z 首次 ok；broadcaster-utxo 23:13:54Z 9/9 成功）；console 共享客户端不自愈（G-2）。所以"门外 cron"在 kaspad 宕机期失败、在 console 客户端死期照常成功——闸不在 console 这边就拦不住。

## A. cron / 定时触发（门外·主动）
| # | 文件:行 | 触发 | type | 门内? | 钱 | 宕机期行为（观测） |
|---|---|---|---|---|---|---|
| A1 | `lib/broadcaster-utxo.mjs:59` | cron `broadcasterUtxoTick`（~3–5 min） | `split_utxo` | ❌ | **花钱**（自转账 + 手续费） | 22:55–23:11 无 tick 落在段内；23:13:54Z 9/9 成功（kaspad IBD 头部相位中）；23:22–23:38Z 四个 tick failed=8/8/4/5（relay 侧 UTXO/RPC 失败，无 txid）；窗内共 35 笔真交易 |
| A2 | `lib/mining-utxo-consolidate.mjs:91` | cron `miningConsolidateTick` | `consolidate_utxo` | ❌ | **花钱**（合并 + 手续费） | 未观测（窗内无行） |
| A3 | `services/broker-intake-watcher.js`（多处，经 broker-action-queue） | cron `broker-intake.tick` / `broker-intake.refundTick`（5 min） | utxo split / refund / transfer（type 由 queue 传） | ❌ | **花钱** | `broker_workflow_markers` 4 次 execution 阶段 `WebSocket is not connected`（22:56–23:11），23:16:20Z 起 no-op ok |
| A4 | `services/broker-buy-completion-watcher.js` | cron `broker-buy-completion.tick` | transfer/deliver（变量） | ❌ | **花钱** | 未观测 |
| A5 | `services/broker-bot-manager.js` | cron `broker-bot-manager.reconcile` | 变量 | ❌ | 视命令 | 未观测 |
| A6 | `services/market-seeder.js` | cron `seeder.tick` / `seeder.depositWatcher` / `seeder.refundWorker`（5 min/30 s/30 s） | publish/transfer/refund（变量） | ❌ | **花钱**（auto-pay/退款） | 未观测（seeder 23:5x 启动行在新进程） |
| A7 | `services/exchange-machine.js` ← `index.js:275` | cron `exchange.expireTick` | send_broadcast（timeout/reopen） | ❌ | 手续费级 | 未观测 |
| A8 | `services/broker-state-machine.js` / `broker-state-reconciler.js` / `broker-state-authority.js` | cron reconcile/sweep | 变量（对账·回收） | ❌ | 视命令 | 未观测 |
| A9 | `services/bshard-settle-daemon.mjs` → `lib/bshard-close-transport.mjs:268/289/304/519` | cron settle/zk ticks | 变量 / `check_utxo_landed` / `get_address_utxos` / `get_pubkey` | ✅（settle/zk 站点在门内） | 读为主；settle 提交经 `pool-market-settler.js:3536`（`pool_settle_tx`，**花钱**） | **门 fail-open 时跑进来**：jepu1 `pool_settle_tx` relay 层 15 次尝试（14 RPC timeout + 1 `Rejected transaction`），fail#1116，无 txid |
| A10 | `lib/pool-broadcast.mjs:33` | 被 settle/close 流程驱动 | `send_broadcast`（sign_req chunk） | ✅（经门内 tick） | 手续费级（chunk tx） | 未观测（窗内无 chunk 行） |

## B. HTTP API 触发（用户/操作员/tg-bot/外部程序·门外·被动）
| # | 文件:行 | type | 钱 | 备注 |
|---|---|---|---|---|
| B1 | `api/bettor.js:1112/1415/1600` | `transfer` | **花钱** | 下注/escrow 打款 |
| B2 | `api/bettor.js:1893/1905` | `prediction_refund_tx` | **花钱** | 退款 |
| B3 | `api/bettor.js:1167` | `send_broadcast` | 手续费级 | |
| B4 | `api/chat.js:688` | `transfer`（faucet） | **花钱** | 水龙头 |
| B5 | `api/chat.js:250/806` | `send_broadcast` | 手续费级 | |
| B6 | `api/escrow.js:73/119/173` | `create_escrow` / `lock_escrow` / `execute_escrow` | **花钱** | |
| B7 | `api/exchange.js:309/492/656/708/797` | `send_broadcast` | 手续费级 | 协议消息 |
| B8 | `api/oracle-pool.js:506` | `stake_unlock_tx` | **花钱** | |
| B9 | `api/oracle-pool.js:32/56/73/85/130` | `get_pubkey` / `ecdsa_sign` | 读/签 | |
| B10 | `api/pool.js:517` | `pool_side_refund_cancelled_tx` | **花钱** | |
| B11 | `api/pool.js:1852` | `sweep_per_bet` | **花钱** | |
| B12 | `api/pool.js:1528/1789/2007`（变量）+ `:1534/1795/2018` | 变量 / `check_utxo_landed` | 读为主 | |
| B13 | `api/pool.js:220/229` | `send_broadcast` | 手续费级 | |
| B14 | `api/pool.js:246/294/1513/1639/1652/3990/4010/4022` | `get_pubkey` / `ecdsa_sign` / `get_per_bet_address` / `send_message` | 读/签/消息 | |
| B15 | `api/relay.js:518` | `transfer` | **花钱** | 提币 |
| B16 | `api/relay.js:1532` | `publish_card` | 手续费级 | |
| B17 | `api/relay.js:1774` | 变量（`/api/relay/:id/send-command` 直通） | **视命令**（可花钱） | 内部调用面（settle-daemon 也走它） |
| B18 | `api/tg-wallet.js:207` | `custodial_transfer` | **花钱** | tg 钱包 |
| B19 | `api/trading.js:2473` | `transfer` | **花钱** | |
| B20 | `api/trading.js:2329` / `api/discovery.js:396` / `api/admin.js:27` | `handshake` | 手续费级 | |
| B21 | `api/operator-settle.js:72` | 变量（operator 专道） | **视命令** | |
| B22 | `api/capability.js:177/267` | `get_arm_status` / 变量（app 信封） | 读/视命令 | |
| B23 | `api/coord-status.js:29` | `ecdsa_sign` | 签 | |

## C. 结论（给 G-1/G-2）
1. **门内**只有 A9/A10 那条 settle/close 链（含 `pool_settle_tx` 广播）；其余 **8 族 cron（A1–A8）全部门外**，其中 A1/A2/A3/A4/A6 会花钱。
2. 宕机期真正拦住它们的不是 ③ 门而是 **relay 子进程的 RPC 失败返回**（fail-loud 各自处理）；kaspad 回来后 relay 侧 ≤5 min 自愈 ⇒ 门外 cron 在 **console 共享客户端死期（23:11→23:47Z）照常成功广播**（A1 35 笔）。⇒ G-2 修共享客户端不影响它们；G-1 若想"节点不可信时停手"，闸必须加在 relay 侧或 `sendCommandAsync` 入口（按 `KASPA_NETWORK` 节点 `isSynced` 且 `networkId` 一致才放行花钱类 type）。
3. B 类由外部触发，宕机期表现 = 请求失败返回 5xx/超时（`send-command` 400 s 超时路径 3 条 503 已见于 seg2a）；不需门，但需要"节点不可信"时的明确拒绝码而非静默超时。
4. **待核（我未逐个读代码）**：A4/A5/A6/A8 的具体 type 与是否有自己的同步检查；`type=?` 的 6 处变量传入点的取值域。

Pin：console 20:41:14Z 进程（旧）与 23:46:48Z 进程（新）的 `console.log` / `console.log.prev-20260906T234648Z`；grep 于 2026-09-07T00:1xZ；调用点行号随 HEAD 12a368ba…fc58326f。
