# J2 → Bettor: 账本1855 / 1857 完成报告(多盘并发 + 种子器 + 委员 Polymarket 判定 + my-positions)

分支 `coord/j2-multi-market-fee-pins-20261005`(基于 413b76f0), worktree `scratch/_j2_wt_mm`。**未合并、未部署、未动主网 env/console/kaspad。** 主网 console(32924)/kaspad(4752)全程未碰; 验收全在 simnet(官方 kaspad 2.0.1, 隔离 scratch 库副本)。

## 提交(新增, 无 amend)
| commit | 内容 |
|---|---|
| 07fe8109 | relay: `pin_utxo`/`unpin_utxo`(排除名单, 只排除不选择不花费; TTL 默认 6h/上限 24h/≤512 条/畸形入参报错且不改状态)。测试 `kasia-relay/src/lib/utxo-pin.test.mjs` 10/10 |
| b8bbecf4 | relay: pin/unpin 打一行日志(验收证据) |
| 1222bea5 | console: `fee-pins.mjs` + 接线(propose 取到 close 提交费后 pin; submit tick 每轮 DB 派生 resync(单盘解析错只 HOLD 该盘, LOUD); 落链后 unpin; handoff/claim fee 短 TTL pin) + `ZK_MAX_LIVE_MARKETS`(默认 1=原一次一盘, 非法⇒1, 上限 100)取代布尔 409(code `live_market_cap_reached`)。create-v07 早失败 + **INSERT 前同步段权威检查(无 await)** |
| 78e95df5 / c27b0aaa | seeder: 无 KAS 模式 live 计数 = 未完结 ZK 盘(与 create-v07 同一 SQL), 目标=min(TARGET, 上限); cap 409 干净 break; 未配 GATEWAY_RELAY_ID 不再传测试网死 id `15593e10`(塌到 maker); MAX_DAY 夹 300d; 仅测试: `POOL_SEED_GAMMA_URL`、`POOL_SEED_MIN_LEAD_MIN`(默认不变) |
| 8e76cd89 | 独立小提交: register-v07 缺参文案 → `stake_ktt`(无 KAS 模式) |
| c9c97c54 | 1857: my-positions 输出 `logical_market_id` + ZK 原生盘赢/输与到账(只读 claim tick 同源: `zk_continuation.attestedWinner` + `computePariMutuelPayout` + `zk_escape_audit`, 无并行计算) |
| da0d7c07 | **A: 委员 enforce 的 Polymarket/UMA 判定分支**(见下) + 共用 CTF reader 构造 |

## 复用声明(第一原则)
fund-lock/proto-fee-reservation 是 proto-v0 专用, 未用; 复用 relay 既有选币咽喉 `filterPendingUtxos`(sendKaspa/两个 splitter/broadcaster rebalance 都经它); 复用现成 `pool-market-seeder`/`create-v07`/`makeCtfReader`/`computePariMutuelPayout`/`getMarketBets`/`zk_escape_audit`; 新增的只有 pin 名单、fee-pins 封装、委员 polymarket 分支(镜像 daemon `judgeWinDir`, 同一 reader)。

## 阻断项与处理(重要)
simnet 首跑发现: **现成 seeder 建的 Polymarket 镜像 ZK 盘, 委员只会 `blockhash_parity` / HTTP canonical 两条判定 ⇒ 全体拒签(canonical 缺失) ⇒ close 永卡 collecting_sigs**(主网同样会卡, 且卡死的盘占 live 名额)。run1 证据已留档(`mm_e2e.run1_blocker_polymarket_no_committee_branch.log.txt` + `console.run1_blocker_slice.txt`)。Bettor 批 C+A, B 否:
- **C(仅 harness)**: `mm_c_tweak.mjs` 在 scratch 库副本里把 3 盘改 judge_type=blockhash_parity —— **harness-only, 绝不是代码路径**; 该次跑又因提议后 30 分钟 `new_attestedAtMs` 超 W2 10 分钟容差被拒(正确行为), 已弃, 改用 A 的真路径重跑。
- **A**: 委员 `ctx.outcomeMarketSource==='polymarket'`(本地 market 行, `buildEnforceCtx` 注入, 绝不读 signRequest)⇒ `judgePolymarketVerdict`: conditionId 格式校验 `/^0x[0-9a-f]{64}$/i`, 复用 `makeCtfReader`(`UMA_POLYGON_RPCS`, ≥2 源一致 + payoutDenominator>0), 非 final YES/NO ⇒ ABSTAIN ⇒ 拒签; YES→0 NO→1; 命门① 仍在判定之前; 与提议赢向不符走 V2 既有 W2 门(`attestedWinner !== winningDirection`)。RPC 列表/reader 单处构造(`sharedUmaCtfReader`), daemon 与 enforce 共用。
- 测试 `bshard-close-enforce-polymarket.test.mjs` 18 项(真 reader + 本地 RPC 桩), **6 个变异全抓**: 从请求取 conditionId(1 红)/ABSTAIN 当 YES(6 红)/YES-NO 反映射(2 红)/reader 忽略分歧(2 红)/忽略未 final(1 红)/信单源(1 红)。
- 已知局限(票): 各委员默认同一组 3 个公共 RPC, 独立性有限, 后续允许每委员各自配置; "赢向≠提议"那一条是对既有 V2 门的结构断言 + 判定值来源断言(完整 V2 夹具太重, 未起)。

## simnet 验收(同一套 harness, `docs/provenance/2026-10-05-j2-multi-market/`)
**pos(run2, `mm_e2e.run2_pos_ALLPASS.log.txt`, ALL PASS)**: 真 seeder + gamma 桩 + UMA 桩(本地 Polygon JSON-RPC ×2), 目标 3、每 tick 1 个、`ZK_MAX_LIVE_MARKETS=3`:
- 163s 建出 3 盘, 同时在跑峰值 3; 均 zk_native/无 spine/polymarket 镜像/broker 塌 maker; 建盘后 maker 与下注人钱包**逐 sompi 不变**; 3/3 时 API 再建 ⇒ 409 `live_market_cap_reached`。
- 2 下注人 × 3 盘各一对(A=方向0 1e9, B=方向1 2e9)register-v07 stake_ktt, 全 200, **下注人钱包逐 sompi 不变**(逐笔)。
- 3 盘并发走完 7 个自治 tick 到各自最后一个 claim(exhausted)(2097s)。**中途注入干扰转账**(settler 自转 0.29 KAS, 即 btduw 机制)⇒ relay 日志 PIN_UTXO 18 行/UNPIN 9 行, 3 盘均无卡死。
- 账目: bettorA/B Δ=0 逐 sompi, 窗口内无任何已确认交易触碰下注人钱包; maker/settler 各自 Δ == −(手续费 + 净锁 covenant) 逐 sompi; 系统钱包合计 Δ == −(715,536,500 手续费 + 642,000,000 净锁); 落第三方 P2PK 输出 = 0; 未知输入 0。
- 每个盘 claim 的 claim_out/tok_out 地址 == 重算的 KanetTokenClaim/KTT 地址且链上未花, 无输出落到赢家/下注人钱包; 每盘 KTT 总量 == 3,000,000,000。UMA 桩判 YES/NO/YES ⇒ 赢家 A/B/A 拿到 KTT claim。
- 1857: `/api/pool/my-positions` 对 3 盘: 赢家行 `did_win=true`、`actual_payout_units`==链上 claim 合计(2,943,000,000 筹码)、`chain_verified=true`; 输家 `did_win=false`; 输出带 `logical_market_id`。结果 JSON 里 `myPositions` 为 UI 取数口径(`mm_e2e_result.run2_pos.json`)。

**neg(`mm_e2e.neg_stuck_reproduced.log.txt`, `ZK_FEE_PINS_DISABLED=1`, 同样的干扰转账连发)**: relay 日志 PIN_UTXO 0 行; 2 个盘停在 collecting_sigs, `submit fail: UTXO not found … for tx <close 费>:0` 反复出现 —— **复现 btduw**(第一次 neg 尝试因 stub 的 conditionId 与库内已镜像的重复被种子器去重而只建出 1 盘, 属预期去重, 日志已留; 改 conditionId 偏移重跑)。
**机制 A/B(`mm_pin_ab.mjs`, ALL PASS)**: 造 0.5 KAS F → pin → 6 笔干扰转账后 F 仍未花 → unpin → 再干扰 F 被选币器吃掉。

## 每盘 KAS 成本(供你给 pm-settler 备款)
simnet 实测(3 盘, 剔除干扰转账 0.032 KAS): **每盘手续费 ≈ 2.374 KAS + 净锁 covenant ≈ 2.14 KAS = ≈ 4.51 KAS**。其中 2.14 KAS 是 covenant 里的状态锁(票 0.14 + claim/token 输出; retire/sweep 后可回收到 sink, 但**生产尚无 retire/sweep 运维工具**, 见上一份报件), 手续费不可回收。maker/gateway=pm-settler 同一钱包时全部记在它名下。另: 费用与 relay 现行费率相关, 建议备款留 30% 余量; N 盘并发 ≈ N×4.5 KAS, 加 settler 需有足够多个 ≥0.5 KAS 的零散 UTXO(close 费每盘 0.5)。

## 主网 env(Owner 要设, 仅键名; 值不入库)
`POOL_SEEDER_ENABLED=1`、`POOL_SEEDER_MAKER_RELAY`=pm-settler 的 relay id、(可不设)`GATEWAY_RELAY_ID`(不设则塌到 maker; 15593e10 默认在无 KAS 模式下已不再传)、`POOL_SEED_TARGET`(≤上限)、`ZK_MAX_LIVE_MARKETS`(建议 5; 未设=1)、`POOL_SEED_MAX_PER_TICK=1`、`POOL_SEED_INTERVAL_MIN≥5`、`POOL_SEED_MAX_DAY`(≤300)、`UMA_POLYGON_RPCS`(≥2 个 Polygon RPC, 默认 3 个公共节点)、已约定的 `ZK_SYSTEM_SINK_PK`/`ZK_CLAIM_RETIRE_DAA`/`ZK_TICKET_SWEEP_DAA`。**本分支改了 relay 代码(pin 命令)⇒ 需随下次 console 重启(relay 是 console 子进程)生效; 无 pin 命令的旧 relay 下 console 只会 LOUD 记 pin 失败、不挡主流程。** 另: 本机 kanet.env 仍是 TN12 时代配置(TARGET=500/STAKE=100), 勿复用。

## 注意/局限(如实)
- pin 命令经 console 的 `/api/relay/:id/send-command`(legacy origin)可达; 该命令不在只读白名单(armed 时需授权), 且 pin 只会让 UTXO 更难被花(上限 512、TTL 自愈), 最坏是 DoS 而非丢钱。
- 干扰转账是确定性替身(btduw 的真因是别的 tx/整理吃掉费 UTXO); 机制 A/B 与 neg/pos 对照证明了"pin 开=不被吃, 关=被吃"。
- 并发创建竞态已治(同步段检查 + 变异验证), 但"卡死盘占 live 名额"仍存在: 需人工处置卡死盘(不在本单)。
- 种子盘是 Polymarket 判定(UMA 桩); 委员的 RPC 默认同源, 见上局限。
- simnet 上 harness 需临时补 `kasia-relay/src/lib/api.mjs` 的 simnet 死端点(未提交, 已还原)。
- `mm_c_tweak.mjs` 是 harness-only 的库副本改动, 记账用, 不是代码路径。

## 测试汇总(本分支末)
relay `utxo-pin` 10; console `fee-pins` 14、`strict-zero-config` 44、`pool-market-seeder` 11、`bshard-close-enforce-polymarket` 18、`no-kas-reopened-routes` 81(含 cap/并发/变异)、`pool-mybets-zk-native` 8、`pool-mybets-h2-split` 15、`zk-token-claim-orchestrator` 19 —— 均 0 失败。
