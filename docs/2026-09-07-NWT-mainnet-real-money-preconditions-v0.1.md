# NWT · "主网 = 真钱" 前置清单 v0.1（2026-09-07T13:4xZ · 应 Bettor 主网评估 v0.1 之邀 · 每条带本周实证坐标 · MUST/SHOULD）

> 口径：**MUST** = 上主网前必须落地且有验收证据；**SHOULD** = 可后置但要有替代控制并写明。坐标全部是本周（09-05→09-07）本人核过或本人评审过的文件/日志/ledger；"未核"处标明。主网硬事实（Bettor 给）：Toccata 已激活、节点 v2.0.1、最低费率 100 sompi/gram（TN12 的 ×100）。

## ① 钱路闸（G-1 / G-2）
| # | 级 | 条目 | 本周实证 |
|---|---|---|---|
| 1-1 | **MUST** | **G-1 全量 enforce**（console `sendCommandAsync` 按 class 分档 + relay 侧 `assertNodeTrusted` 盖 p2sh.mjs 29 处 `submitTransaction` + 4 处 `pending.submit` + `_sendKaspaInner`），判据 T_write = networkId ∧ isSynced ∧ hdr−blk ≤ 50，rpc-fail fail-closed | 23:14:19Z 9 笔 `split_utxo` 在 IBD 头相位递上去、三源无（§19/§20，`docs/2026-09-05-NWT-redteam-…`）；relay 唯一检查 `transaction.mjs:150` 不盖 split/consolidate/p2sh（memory `reference-relay-issynced-check-lives-only-in-sendkaspainner…`）；设计 GREEN-final `docs/2026-09-07-j2-g1-g2-…-v0.1.md` v0.2、审 `docs/2026-09-07-NWT-redteam-g1-g2-…`。主网上一笔"节点未同步时递出"的 tx 不是丢，是**可能被别的 peer 中继上链而本机三源无**——账对不上。 |
| 1-2 | **MUST** | **G-2 已落地（8f6699ab + f9054122）且 `KASPA_RPC_LOCAL_ONLY=1`** 必须在主网 env | 09-06 22:55Z ③ 门 rpc-fail 放行 52 min（ledger 967）；`rpc-health.js:118` 原硬编码 `getUrl(Encoding.Borsh,'mainnet')`。**反问的答案**：在主网跑时那行硬编码恰好"对网"，公网 mainnet 节点的 `isSynced=true` 会通过 networkId 核 ⇒ 若不设 LOCAL_ONLY，门会读**公网节点**的 synced 而 relay 用**本机**节点递 tx ⇒ 门开着往落后的本机递（= 22:55Z 形状的主网版）。testnet 端点被当 synced 的反向不会发生（G-2 dataCheck 拒 networkId≠KASPA_NETWORK，`rpc-health-datacheck.test` H1 钉），但**"同网公网节点代替本机"这条只有 LOCAL_ONLY=1 挡**。 |
| 1-3 | **MUST** | ③ 门 fail-closed 语义（G-2 H3）+ `[ibd-gate] skip streak` 心跳；主网上"门静默永跳"= 结算停摆，要有 10 min 心跳告警接到频道 | 09-07 12:24Z 重启后 15 站点 `skip: node not synced (isSynced=false, reason=not-synced)`（本人核）；心跳行在 `ibd-tick-gate.mjs` G-2 hunk |
| 1-4 | SHOULD | `getWorkingRpc` 返回 `isSynced`（G-2 SHOULD-1）+ `api/pool.js:1120` null 检查 | 30 个调用方在本机未同步期拿 null → UI 503（G-2 审 §行为差） |

## ② 密钥 / relay / 暴露面
| # | 级 | 条目 | 本周实证 |
|---|---|---|---|
| 2-1 | **MUST** | relay 私钥常驻进程内存（`getPrivateKey()` 40 处：chain.mjs 5 / p2sh.mjs 27 / relay.mjs 3 / utxo-split 2 / …）× ~40 个 relay 子进程 × 同一台机；主网前：每 relay 资金上限 + 热钱包总额上限写死（env）+ 冷/热分离（结算大额走独立签名机或 HSM，至少独立进程 + 独立 OS 用户） | `kasia-relay/src/lib/transaction.mjs:139` `walletOverride`（TG 托管钱包 ad-hoc KaspaWallet 同一进程签）；今晨 9 relay 各 30 UTXO 再平衡 = 全部热 |
| 2-2 | **MUST** | kaspad RPC 只绑 127.0.0.1（现 `--rpclisten-borsh=127.0.0.1:17210` ✓）；**永不加 `--unsaferpc`**（addPeer/ban 需要它，主网上等于开放远程改 peer 集） | 本人 netstat 09-07：`127.0.0.1:17210`、`127.0.0.1:3200`、P2P `0.0.0.0:16311`（应开）；canonical args 无 unsaferpc（memory `reference-kaspad-addpeer-ban-unban-need-unsaferpc…`） |
| 2-3 | **MUST** | llama/LLM 与任何辅助服务 loopback 绑定 + 防火墙应用级规则收窄（memory `project-llama-server-exposure-0000-bind…`：三启动路径 0.0.0.0 + Public allow 曾网络可达）；主网前全服务 `netstat -ano | LISTEN` 清单入 runbook，0.0.0.0 只允许 16311 | 本机 NordLynx/Tailscale/WSL 多网卡（09-07 11:01Z 读）——每个 0.0.0.0 监听都暴露到这些网 |
| 2-4 | **MUST** | `api/relay.js:1774` `/api/relay/:id/send-command` 无 type 白名单直通（settle-daemon 依赖）；主网前：白名单 + origin 强制（`operator-settle.js:72` 那种两档 fail-closed 形） | 调用方表 `docs/2026-09-07-NWT-sendcommand-callers-table-v0.1.md` B17 / J2 4 处核页 §2 |
| 2-5 | SHOULD | 安全发现走最窄通道（memory 家族）；主网 runbook 明确谁能看私钥所在机的 shell | — |

## ③ 结算侧 / 费用面（主网 ×100）
| # | 级 | 条目 | 本周实证 |
|---|---|---|---|
| 3-1 | **MUST** | **再平衡 cron（`lib/broadcaster-utxo.mjs`）主网前重设计或关**：TN12 实测 84 笔/3 h ≈ **28 笔/h**（`console.log.prev-20260906T234648Z` 20:41→23:46Z），每笔 fee **5,099,400 sompi**（mempool 直读 09-07 00:07Z）= 0.051 KAS ⇒ TN12 ≈ 1.4 KAS/h。**主网估算**：若该 fee 主要是 KIP-9 存储质量 × 1 sompi/g，则 ×100 ⇒ **≈5 KAS/笔、≈140 KAS/h、≈3,400 KAS/天**（估算·MUST 由 J2 用真实 mass 复核，memory `feedback-kip9-storage-mass-plurality…`） | 09-07 §17 门外钱路 cron 清单 A1；再平衡是自转账，本金不损但手续费全是真钱 |
| 3-2 | **MUST** | jepu1 类"每小时真广播、无终点"（S-1）：本周 `pool_settle_tx` 行今天 3 条、fail#1116+（ledger）；主网 = 每次被接受即 ×100 费；要 **终态 + 重试上限 + 冻结语义**（`TERMINAL_STATUSES` 另案） | `pool-market-settler.js:3536` 提交退避；jepu1 写者审计 J2 页 |
| 3-3 | **MUST** | **NO TX NO STATE CHANGE 的两处已知违反**：`exchange-machine.js:828-829` kaspa 支付路径 `trusting txId … (submitTransaction = verified)` 直接构造 `confirmed:true`；`bettor-prediction-settler.js:198/216` 拿到 payout txid 即写 `payout_tx`/推进（CLAUDE.md 4/13 状态注记、`cross-chain-verify.mjs` 从未被该路径调用）；主网前必须改成 `check_utxo_landed`(minDepth) 落链核 | 本机库两路痕迹 0（从未执行）——缺陷没显形不等于风险低 |
| 3-4 | **MUST** | 费率参数集中：所有 `priorityFee`/mass 估算按 `KASPA_NETWORK` 取（现 utxo-split `priorityFee: 500_000n` 硬编码；relay fee floor 的 `calculateTransactionMass` 对 v1 covenant panic 被 try/catch 静默跳过 = 断言不是断言，memory `reference-kaspa-wasm-covenant-binding…`） | 主网 100 sompi/g 下静默跳过的 fee floor = 交易被拒或多付 |
| 3-5 | SHOULD | 33735 KAS 卡 137 盘 / 结算停摆 93 盘（memory project-*）：主网前 TN12 上这些先清零，作为流程演练 | — |

## ④ 审计 / 证据（把今天的人工核变自动）
| # | 级 | 条目 | 本周实证 |
|---|---|---|---|
| 4-1 | **MUST** | **submit 对账器**：relay 每次 `submitTransaction`/`pending.submit` 成功都写 `submitted_txs(txid, relay, type, at)`；cron 每 N min 用 `kaspa_tx_log`（relay block-added 索引）+ `getUtxosByAddresses` 核"已递出但 T+10 min 三源无" ⇒ 告警 + 该 relay 冻结新 submit（= 23:14Z 形状自动抓） | 今天 35 笔三源核靠我手写 `_nwt_utxo_landing_check.mjs` / `_nwt_txlog_check.cjs`（§18）；`kaspa_tx_log` 1.6e7 行、前缀查询走范围索引 <1 s |
| 4-2 | **MUST** | canonical 日志行契约入 lint：闸/盯守按行 grep（`skip: node not synced (`、`[rpc-shared] REBUILD`、`IBD self-trigger`、`[node-trust] HOLD`）；新路径必须逐字打（memory `feedback-new-code-paths-must-emit-the-canonical-log-lines…`） | D-c MUST-② 实证：自触发行与 `IBD started` 同毫秒（§21） |
| 4-3 | **MUST** | 钱路 tick 的"闸/占空比/放行"计数每 10 min 一行 + `/api` 露出（G-1 §2.3 `[node-trust] stats`）；主网 dashboard 只认这些行 | — |
| 4-4 | SHOULD | `logs/test-runs` 覆盖式证据改追加 + 主网变更前强制跑 domain 套件（CLAUDE.md：本仓无自动回归） | check-tests-fresh 今天报 181 用例零证据 |

## ⑤ 灰度：主网最小面
| # | 级 | 条目 | 可行性 |
|---|---|---|---|
| 5-1 | **MUST** | **只读/只收阶段**：主网 kaspad（`--utxoindex`，RPC loopback）+ console 索引/discovery/接收（block-added 索引、`kaspa_tx_log`、identity 读）**零 submit**——用 G-1 的 class 机制加第四态 `NODE_TRUST_GATE=readonly`（CHAIN_WRITE + 手续费级一律 hold，READ 放行），relay 侧 `assertNodeTrusted` 同态 | 可行：G-1 设计已按 type 分档；readonly = "T 恒 false 对写类"，零新判据。验收 = 主网 7 天 `[node-trust] HOLD` 计数 = 写类调用数、`kaspa_tx_log` 主网索引增长、零 submit 行 |
| 5-2 | **MUST** | 第二阶段只开 **手续费级**（handshake / send_message / publish_card / send_broadcast）+ 单 relay + 资金上限 ≤ X KAS；第三阶段再开 transfer/escrow/settle，逐 type 白名单 | 主网上每条协议消息 = 真费；先量 24 h 消息数 × 主网费 |
| 5-3 | SHOULD | 主网 peer 面：TN12 单前向 peer 病主网不存在（Bettor），但 D-c/D-d 仍应上（主网 relay 爬行是否存在未证——今天 ③ 相位显示爬行与连接状态相关，memory `reference-kaspad-relay-crawl-was-connection-bound…`）；主网先跑 24 h 观察 `Processed N blocks` 分布与 D-c 触发次数（应 ≈0） | — |

## 排序建议（给 Bettor/Owner）
先 ④-1 对账器与 ③-3 两处违反（它们决定"账对不对"，主网上错一次就是真损失）→ ①-1/①-2/②-4 闸与白名单 → ②-1 密钥分离与上限 → ③-1 再平衡费用复核（可能直接决定"主网能不能这样跑"）→ ⑤-1 只读灰度 7 天 → ⑤-2 手续费级。每条的"可核"= 表里那列坐标；没有坐标的（②-5、③-5、④-4、⑤-3）是 SHOULD。
