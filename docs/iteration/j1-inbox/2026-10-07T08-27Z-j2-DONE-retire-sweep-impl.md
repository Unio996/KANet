# J2 → Bettor: 回收工具(retire / sweep)实现交件 — 账本1867

分支 `coord/j2-retire-sweep-impl-20261007`(新提交, 无 amend/rebase)。**未部署、未改 env、未重启、主网零动作。**
设计 `docs/2026-10-05-j2-retire-sweep-tool-design-v0.1.md`(030159ab)已批的范围; 不做 tick。

## 交付物
| 项 | 位置 |
|---|---|
| relay 构造器 `unlockClaimRetire` / `unlockTicketSweep`(p2sh.mjs 末尾新区段, 不改既有函数; commit 带 `acknowledged: T-J1-2026-04-28`) | `kasia-relay/src/lib/p2sh.mjs` |
| 命令三层注册 `zk_claim_retire` / `zk_ticket_sweep`(不进 READONLY_ALLOWLIST) + relay.mjs case | `commands.mjs` / `relay.mjs` |
| 枚举器(只读, 注入 db/rc/p2sh) | `kasia-console/src/lib/zk-recovery-enumerate.mjs` |
| 操作员脚本, 默认 `--max 0` dry-run, 主网必须 `--mainnet-ok`, 需显式 `DB_PATH` | `kasia-console/scripts/zk-recover.mjs` |
| `stampSelfCovId`(已批, 随下次 Owner 批的重启生效) | `zk-recovery-params.mjs` + claim tick 一行 |
| 单测 | `recovery-builders.test.mjs`(15) / `zk-recovery-enumerate.test.mjs`(含 4 条变异) / `zk-recovery-params.test.mjs`(+stamp 段) |
| 证据 | `docs/provenance/2026-10-07-j2-retire-sweep/` |

复用: `_matchUtxo`/`_combineActionAndRedeem`/`_encodeKttTransferZeroOutAction`/`_assertTxInvariants`(同 `_unlockClaimFamily` 骨架)、`computeKanetTokenClaimArtifact`/`computeKttTokenArtifact`/`computePoolSideTicketArtifact`(铸造同款, 仅 additive 返回 `entryAbi`)、`computePariMutuelPayout`+`deriveCloseFeeLeaves`+`getMarketBets`(claim tick 同款重算赢家叶)、`zk_recovery_params`、`buildFactsResponse`、`listUnfinishedZkNativeMarkets`(名额占用者栏)。

## 行为与安全面
- 优先读盘上 `metadata.zk_recovery_params`(铸造时值); 没有才回落当前 env 并在清单里标 `env-fallback`。盘上 sink 与当前 env 不同时, 照盘上值找到并回收(单测覆盖)。
- 去向只由 sink_pk 派生; sink_pk 必须能在 claim/票 redeem 字节里找到(= ctor 常量真烤在里面)。无 to/change_address/outputs 参数。无钱包、无签名。
- 年龄: builder 读链上 UTXO 的 blockDaaScore 与虚拟 DAA, 不够(门槛+50)不广播; 枚举器另加软余量(默认 1000 DAA, `--margin`)。输入 sequence = 门槛(合约 `ageDaa` 即 OpCheckSequenceVerify)。
- fee ≤ 合约上限 5,000,000; 默认值未填(≤0)直接抛。
- 票: 只扫已终态盘; claim: 逐对(claim UTXO + owner==其 covenant id 的代币 UTXO)退役, 代币 UTXO 个数≠1 ⇒ 跳过不猜。
- 审计: 每笔先 `check_utxo_landed`(sink 地址, minDepth 3)再写 `metadata.zk_recovery_audit[]`(NO TX NO STATE CHANGE)。
- 清单含只读「live 名额占用者」栏(与 create-v07 的 ZK_MAX_LIVE_MARKETS 闸同源)。

## simnet 验证(官方 2.0.1, 全 simnet)
- **负例 N1**: 年龄不够 ⇒ builder 抛"年龄未到", 不广播。**负例 N2**: 绕过 builder 门(`age_margin_daa=-1e9`)直接广播 ⇒ 节点拒 `one of the transaction sequence locks conditions was not met`。(`e2e_run3/4.log.txt`)
- **真花 10 笔**(6 笔 claim retire + 4 笔票 sweep), 全部在 sink 地址核到落链面值: claim 对(0.5+0.5=1.0 KAS)→ sink +0.979(最终费 0.021); 票 0.07 → +0.0664(费 0.0036)。清单见 `simnet_spends.json`。其中 3 笔经 `zk-recover.mjs --max N` 落审计。
- 清单行为: 到龄前 `未到龄`(显示 age/门槛), 到龄后 `可 retire/sweep`; 回收后重跑 ⇒ 全部 skipped(gone), 可回收为 0(幂等)。
- 例 A(1 注, 2 claim+1 票)、例 B(3 注, 4 claim+3 票)均回收清空。

## 手续费(实测, 非估算)
节点对 fee=1 的拒绝文本(100 sompi/克)。**发现**: 沿用 claim 家族的计算预算 300/100 时 retire 下限 4,787,600, 距合约上限 5,000,000 只剩 4.4% 余量; 实测最小可行预算 claim=10/token=10/票=5(更低未试), 默认取 40/40/20 后:
| 站点 | 实测下限 | 常量 | 倍数 |
|---|---|---|---|
| claim retire | 1,587,600 | 2,100,000 | 1.32× |
| 票 sweep | 275,000 | 360,000 | 1.31× |
(`measured_floors.json`; 本地 mass 上界估算对回收交易偏保守(30,064 vs 实测 15,876), observe 模式只 warn。)
主网后果: 每个 claim 回收 ≈ 1.0 − 0.021 KAS, 每张票 ≈ 0.07 − 0.0036 KAS。

## 你问的: 重启前已领的盘, selfCovId 能否从本地数据推出?
**不能。** `kaspa_tx_log.outputs_json` 只存 `{address, amount_sompi}`(无 covenantId、无输入); claim 只有 txid 进 `zk_escape_audit`; `chain_events` 无 claim 回执。耗尽后链上也不再有带该 id 的 UTXO。⇒ 照现做法: 未耗尽的盘枚举器从活续约 UTXO 读; 重启后新 claim 由 stamp 记录; 其余用 `--cov-id <盘末段>=<64hex>` 手填(需另有来源, 如当时 relay 日志里 claim 阶段 A 回执)。主网此刻没有已领盘, 实际无缺口。

## 已知边界 / 请你知道
1. 重启前主网无已领盘 ⇒ 无需 `--cov-id`; 重启后才开始 stamp。
2. 票龄 365 天、claim 龄 30 天来自盘上 `zk_recovery_params`; simnet 为验证用 400/6000 DAA(票龄需 harness-only 去掉 create-v07 的 60 天余量守卫, 该改动未入库)。
3. 脚本不起 relay 子进程, 直接调 builder(与 relay case 同一份代码); 命令注册保留是为将来 tick/IPC 同形调用。
4. simnet 已全部拆除(kaspad/矿工/桩/控制台); 主网 kaspad 4752 与主网控制台 23808 全程未碰。
