# proto-v0 结算驱动 · 主网启用清单 v0（2026-09-20, J2；供 Bettor 上报 Owner 拿 GO）

> 性质：**清单，不是执行**。主网一个字节未动；上线是钱路，按铁律 0 等 Owner 明确 GO。
> 依据：9-4 隔离 simnet 干净整轮全绿（`docs/provenance/2026-09-20-j2-batch9-94-simnet-clean-round/RESULT.md`，主线 b6f744b5）。

## A. 需要 Owner 拍板的（代码做不了主）

| # | 决策 | 现状 | J2 建议（供参考，不替 Owner 定） |
|---|---|---|---|
| A1 | **resolve 来源：`winning_side` 谁写、凭什么** | 结算驱动只在 `markets.winning_side` 已写、`status='sealed'` 时才建 close_commit；**仓里没有写它的正式路径**（9-3 的 `/resolve` `/claim` HTTP 未实现；9-4 用受控 SQL 写）。 | 首轮主网：由 Owner 指定的单一操作员用**受控 SQL**（write-once：`WHERE winning_side IS NULL AND status='sealed'`，前后读数进 ledger），零新代码；正式路径（HTTP+鉴权 或 预言机镜像）另立 9-3，走完整审。 |
| A2 | 主网 relay 出资额与来源 | 启动断言硬顶 `PROTO_MAX_BALANCE_KAS=5`（`>=5` 即拒）；出资由谁打、多少 | ~4 个干净 UTXO 共 ≈3.8–4.0 KAS（每个 ≤1.0 KAS 签名输入上限；每步至少一个 ≥ 该步 cap：seal/close/convert/claim 30–52M sompi，genesis/append 80–100M）。**天花板不改。** |
| A3 | 押注资产 | D-017：自发免费无限铸造的 KCC-20 测试币，只许 covenant 持有 | 沿用；KAS 只用于手续费，真钱面 = 手续费 + relay 那 <5 KAS |

## B. 配置/开关（均需 console 重启才生效——env 只在启动时读）

1. `KASPA_NETWORK=mainnet`（驱动网络只取此配置；relay 收款地址整段前缀必须精确 = `kaspa`，否则整 tick 拒绝并 LOUD）。
2. `PROTO_RELAY_ID=<relay_nodes 里的 id>`：该行 `name` 必须以 `proto-` 开头；relay 进程的 `RELAY_NODE_ID` 必须等于它（relay 侧执行权限门）。未配置 = 无人被授权（fail-closed）。
3. `PROTO_DRIVER_ENABLED=1`（genesis/下注驱动）与 `PROTO_SETTLEMENT_DRIVER_ENABLED=1`（结算驱动）**互相独立、默认都关**；只开前者 = 能建市场能下注、**不会**结算。
4. 可选：`PROTO_SETTLEMENT_DRIVER_INTERVAL_MS`（默认 60000；每步预算 = 间隔一半且 ≥15 s）、`PROTO_SETTLEMENT_DRIVER_TICK_CAP`（默认 3）。
5. proto 路由只在**启动时**通过健康断言才注册（relay 存在 ∧ 名前缀 ∧ 余额 <5 ∧ 节点 isSynced）；不健康 ⇒ 路由 404（fail-closed）。**先出资到 <5 且节点已同步，再重启 console。**
6. kaspad 重启后必须再重启 console（共享 RpcClient 不自愈，见记忆 reference-console-shared-rpcclient…）；`CONSOLE_ENCRYPTION_KEY` 必须持久化（市场委员密钥信封用它加密，丢了=不可恢复）。

## C. 主网自然满足 / 已由 9-4 验证的

- **费率**：simnet 最低 100 sompi/克（NWT 实测）；主网最低费率我未在本轮实测（待 NWT/KANet-UI 核，别当已证）；builder 固定费用画像按步 cap，relay 侧 implied-fee / fixed-value 校验对真 builder 产物全过（9-4 无一笔被拒）。
- **pmt 闸**：close_commit 需节点 pastMedianTime ≥ deadline+30 s；主网块量足自然过。（simnet 短链需人工多挖，是环境特性，非缺陷。）
- **指针形状**：relay 真写入方 `prepared_tx_json=[单个 safe-JSON 串]` 已修（b6f744b5）。
- **四步链**：seal → close_commit → convert_to_claim → claim_draw 在真共识上落链、终态无 pending/failed、claim 到位。

## D. 已知缺口 / 未验证（上线前须知，不是阻塞项的另标）

- ❗ **V1/V2 污染费率向量**（seal 后 / close_commit landed 后注毒）尚未跑（NWT 另起一轮）——**建议作为上线前置**。
- `probeRefundFlip` 未实现（工单）：refund_flip 路径失败表现为 rootClose_*_drift 告警，非静默。
- close_commit 落库假设恰一笔 payout（工单）；单市场单赢家已验，**多赢家/并发多市场未验**。
- 驱动每 tick 重新 import ops（工单，不影响正确性）。
- 9-4 是干净路径 + 单赢家 + simnet 无 PoW/无对手方；不证明主网共识之外的事。

## E. 回滚 / 观测

- **回滚 = 去掉/置空 `PROTO_SETTLEMENT_DRIVER_ENABLED` 并重启 console**：驱动停、零 interval、零 IPC；已建意图与链上状态原样保留，不会自动前进。
- 观测：`[proto-settlement-driver] started/ tick N {…}`、`COVENANT_BROADCAST(intent settle:…)`、events 表 error 级（`settlement_c1_programming_error` 等封闭集告警）；SLA：deadline+1h 未 close 告警、+2h refund_flip_open。

## F. 建议的上线顺序（须 Owner GO 后逐步走）

1. Owner 拍 A1/A2 → 2. 合入包含 b6f744b5 的主线到主网 Tree（已含）→ 3. NWT 完成 V1/V2 → 4. 出资 relay（<5 KAS）→ 5. 重启 console（路由注册）→ 6. **先只开 `PROTO_DRIVER_ENABLED`**，建一个小市场 + 两注走通到 seal → 7. 再开 `PROTO_SETTLEMENT_DRIVER_ENABLED`，操作员按 A1 写 `winning_side`，逐步核 txid。
