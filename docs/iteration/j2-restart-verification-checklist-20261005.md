# 重启后只读核验清单（2026-10-05 合并项）

> **Status**: CURRENT（运维核验清单；全部只读，不动资金/env/进程）。作者 J2，2026-10-05/06。
> 约定：`$LOG` = 主网 console 的 stdout 日志；`$DB` = `console.mainnet.db`（只读方式打开：`new Database(path,{readonly:true,fileMustExist:true})`）。
> 不含任何密钥/持仓数字；金额均为协议常量。

对应的合并项与提交（在已部署树上用 `git merge-base --is-ancestor <sha> <deployed-HEAD>` 逐个核）：

| 项 | 提交 |
|---|---|
| register-v07 成本闸（每 pk / 全系统每 UTC 日）+ linked_addr | 36e457f4 |
| 手续费压降 A | 09806305 |
| 0 注盘 cancelled/no_bets，dispatchRefund 无 spine 结构性拒绝 | 28c2868e |
| 无赢家盘终态 completed + no_winners | 12533c90 |
| 盘 metadata 记录铸造时回收参数 zk_recovery_params | 6540e21e |
| 重开路由放行不再打 "403" 日志 | 6f4d59b4 |

## 0. 代码确实在跑
- 上面每个 sha 都是已部署 HEAD 的祖先。
- console 启动干净（无 `ERR_MODULE_NOT_FOUND`）。
- 成功的 create/bet **不得**再出现 `[mainnet-no-kas-stake] 403 route=create-v07`；应出现 `[mainnet-no-kas-stake] reopened, allowed route=… reopen=…`。

## 1. no_bets
前提：存在 0 注且已过 deadline+300 秒的盘。
- `$LOG`：`[pool-settler] no-spine chip market=<12位> 0 bets at deadline+300s → cancelled(no_bets); nothing on chain, no refund dispatch`
- DB：`SELECT id, protocol_status, json_extract(metadata,'$.cancel_reason'), json_extract(metadata,'$.cancel_pool_sompi') FROM pool_markets WHERE id LIKE '%<末5位>'` ⇒ `cancelled` / `no_bets` / `'0'`
- **不得**出现：该盘的 `[pool-settler:min-pot]`、`buildMakerRefundPreimage` 警告。

## 2. 手续费常量
- 自转：`$LOG` 出现 `TRANSFER <x> → … fee: 0.003036`（发给自己地址；旧值 0.032）。发给别人地址的转账仍约 `0.032…`（预期）。
- 覆盖 tx（relay `invariant` 行 `[unlockBshard… invariant] Σin=… Σout=… fee=<sompi>`）：

  | 站点 | 期望 fee(sompi) |
  |---|---|
  | register | 7100000 |
  | consolidate V2 | 14000000 |
  | zk handoff | 12900000 |
  | zk close | 25400000 |
  | close attest V2 | 10000000（不变） |
  | genesis mint | 1000000（不变） |
  | claim | 9600000 |
- `grep -c "under the required amount" $LOG` 应为 0；任何命中 = 余量不足或主网 feerate 上升。
- 第二来源：`[mass-floor:observe]` 行的 `actualFee=`。

## 3. no_winners
前提：判决已定且赢向一侧无人押（ABSTAIN/Polymarket 未决议时**不得**触发）。
- `$LOG`：`[zk-autonomy] … ✅ market=<8位> 判决已定(winDir=N)且赢向一侧无人押 ⇒ completed + no_winners(未 propose, 零链上动作)`
- DB：`SELECT protocol_status, json_extract(metadata,'$.no_winners'), json_extract(metadata,'$.judged_winner'), json_extract(metadata,'$.judged_at') FROM pool_markets WHERE id LIKE '%<末5位>'` ⇒ `completed` / 1 / 0|1 / ISO 时间
- `SELECT count(*) FROM events WHERE event_type='zkJudgeProposeTick_propose_error' AND payload_json LIKE '%<id>%'` ⇒ 0
- 名额释放：`listUnfinishedZkNativeMarkets` 的 SQL 不再列出它。
- `GET /api/pool/my-positions?linked_addr=<地址>`：该盘的行 `no_winners:true`、`did_win:false`。
- ABSTAIN 期间：盘保持 `verifying`，judge tick 的 `errored` 照旧重复（与改前一致）。

## 4. recovery_params 戳
只对**重启之后创建**的盘生效；更早的盘没有该字段（预期）。
- `SELECT json_extract(metadata,'$.zk_recovery_params') FROM pool_markets WHERE id LIKE '%<末5位>'` ⇒ `{"sink_pk":"<64hex>","retire_daa":…,"sweep_daa":…,"claim_out_value_sompi":<50000000|40000000>,"stamped_at":"…","source":"create-v07"}`
- `grep "zk-recovery-params" $LOG | grep DRIFT` 对这些盘应为空。

## 5. 成本闸 429
**无法只读证明**：429 需要真实超限下注，且被拒时不写日志。可只读核的：
- Owner 设的 env 键：`ZK_BET_MAX_PER_PK_DAY`、`ZK_BET_MAX_GLOBAL_DAY`（未设 ⇒ 默认 5 / 50）。
- 当日用量（UTC）：`SELECT s.bettor_pk, count(*) FROM pool_bettor_sides s JOIN pool_markets m ON m.id=s.market_id WHERE s.created_at >= date('now') AND json_extract(m.resolution_rule_spec,'$.zk_native')=1 GROUP BY s.bettor_pk`。
- 第一次真实超限 ⇒ HTTP 429，`code` 为 `bet_cap_pk_day` 或 `bet_cap_global_day`，带 `Retry-After` 与 `resets_at`。

## 6. claim 0.40
- env：`grep ZK_CLAIM_OUT_VALUE_SOMPI <env 文件>` ⇒ `40000000`（只核键与数，不要打印其它键）。
- 生效时机 = 重启后**第一笔主网 claim**（需要有赢家的盘结算）。证据：claim 费用转账 `TRANSFER 1.496 → …`（3×0.4 + 0.096 + 0.2 KAS；0.5 时为 1.796），`kaspa_tx_log.outputs_json` 里 claim 输出各 `40000000` sompi。
- 新盘的 `zk_recovery_params.claim_out_value_sompi` 也应为 `40000000`（见第 4 项）。
- 若第一笔 claim 因 storage mass 被拒 ⇒ 撤回该 env（0.40 的建模最坏值 412,501，上限 500,000）。

## 重启后的红旗
- `ERR_MODULE_NOT_FOUND`；
- close 提交费出现 `UTXO not found`（52e4997c 的 pin 应已防止）；
- 有注的盘上出现 `[pool-settler:min-pot]`；
- 任何 `claimAutonomousTick_degenerate` 事件。
