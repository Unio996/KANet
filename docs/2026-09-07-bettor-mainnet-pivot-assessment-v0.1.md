# 转向主网开发 · 评估 v0.1（2026-09-07 · Bettor · Owner 指令"我看我们需要尽快转向主网开发。你做评估"）

权威：本稿只汇总可核事实与建议；J2 三份清单（代码绑定 / 共识 ABI 差异 / 节点构建）与 NWT"真钱前置清单"到齐后出 v0.2。硬事实均带出处，可复核。

## 0. 一句话结论
**可以转，且应该尽快转——链侧前提已经满足，真正的门槛在我们自己的钱路安全与合约迁移，不在 Kaspa。** 主网 Toccata 硬分叉（covenant + ZK precompile，KIP-16/17）已于 ≈2026-06-30 激活，我们"ZK committed"的结算架构（铁律 0.5）可以直接以主网为目标；TN12 今天暴露的那类"全网只有一个前向节点"的病在主网不存在。建议**四波灰度**，第一波本周即可起（只读节点 + 身份/发现/通信面，零资金），钱路分批放开，每批有闸有额度。

## 1. 硬事实（2026-09-07 13:35Z 核）
| 事实 | 值 | 出处 |
|---|---|---|
| 主网当前 DAA | 533,678,661（sink 13:35:47Z，isSynced=true，节点 v2.0.1） | 公网节点 `wss://vivi.kaspa.blue/kaspa/mainnet/wrpc/borsh` 只读 `getBlockDagInfo`/`getInfo` |
| 主网 Toccata 激活点 | `toccata_activation: ForkActivation::new(474_165_565)` ⇒ **已激活**（533.7M > 474.2M；按 10 DAA/s 反推 ≈06-30） | 上游 `rusty-kaspa` HEAD 90dbf074 `consensus/core/src/config/params.rs:724`；commit b8deb638 "Set Toccata to activate on mainnet (#1044)" |
| 我们活 kaspad 的主网参数 | `covenants_activation: ForkActivation::never()`（1.1.1-toc.1 = TN12 分支，主网上等于"无 covenant"） | 活二进制源码 7b1e18cc `params.rs:607` |
| ZK precompile 在上游 | `crypto/txscript` 依赖 ark-groth16 / risc0-* | 上游 HEAD `crypto/txscript/Cargo.toml:23,45–48` |
| 主网最低费率（Toccata 后） | `100 sompi × max(compute grams, 2 × tx bytes)`（TN12 现 1 sompi/gram ⇒ **×100**）；节点策略非共识 | `docs/toccata-guide.md` Key notes |
| 主网 tx v1 新字段 | `TransactionOutput.covenant`、`TransactionInput.compute_commit`；旧 gRPC proto 不带会被判无效块 | `docs/toccata-guide.md` §86–102 |
| 主网节点软件 | v2.0.0 / v2.0.1 官方 release；`kaspad --utxoindex` | `docs/toccata-guide.md` Running Your Node；`git tag` v2.0.1 |
| KANet 代码对 TN12 绑定 | `testnet-12` 91 文件 / `kaspatest:` 145 / `KASPA_NETWORK` 55 / faucet 58 / covenant 67；地址前缀硬判如 `pool.js:192 startsWith('kaspatest:') ? 'testnet-12' : 'mainnet'`（已是双网写法） | `grep -rIl` kasia-console/src kasia-relay/src kaspa-scout agent-mind scripts tg-bot |
| TN12 今天的病 | 唯一前向 peer 136.243.93.17 两次自断（3.5 min / ≥2 h），全网其余节点都比我们落后；公共 resolver 无 TN12 条目 | ledger 992–999、J2 扫描页 |

## 2. TN12 → 主网：哪些问题消失、哪些出现
**消失**：单前向 peer / 陈旧剪枝点循环（D-d 的病因）/ 中继 0.75 bps 爬行（D-c 的病因·主网多 peer 且有公共 resolver、archival、explorer）/ TN12 faucet 依赖 / 自编译 toc 分支（主网用官方 release）。
**出现**：① **真钱**——本周三类 fail-open（③ 门 rpc-fail 放行 52 min、rpc-health 硬编码 mainnet 发现列表、35 条 submit 路径无闸）在主网就是真实资金风险 ⇒ G-1 从"建议"变 MUST；② **费用 ×100**——每笔 tx ≈ `100 × max(grams, 2×bytes)`：2 KB 的 tx ≈ 400,000 sompi = **0.004 KAS**；今天 35 笔/h 再平衡 ≈ 0.14 KAS/h ≈ 3.4 KAS/天，jepu1 那种每小时一笔被拒的结算重试 = 白烧费（S-1 必修）；③ **合约字节码全换**——silverscript v1-rc1 破坏面（memory：entry / tx.time 只收 temporal / byte[36] / checkMsgSig / dispatch tag ⇒ 42 个 .sil 全编不过、所有 P2SH 地址变），迁移计划 `docs/2026-08-30-j2-silverscript-v1-migration-plan` 从"低优先"变前置；④ **上游 OP_PICK 修复作用域**（CLAUDE.md 铁律 0.5 注记：本机 silverc 修了、上游未推）——主网上第三方用上游 silverc 生成的 covenant 仍带该 bug，"别人能接上结算"要先把修复推上游或换 v1-rc1 的编译器；⑤ 主网节点资源：v2.0.1 + Toccata 硬件规格上调（transient mass ×2 允许 ZK-STARK），pruned 磁盘/内存数字待 J2 按 elldeeone 报告核（本机 TN12 datadir 138 GB、kaspad WS 15–28 GB 可作下界）。

## 3. 四波灰度（建议·每波有闸有额度）
| 波 | 内容 | 资金面 | 前置 | 起点 |
|---|---|---|---|---|
| **0 · 主网只读节点** | 上游 v2.0.1 起主网 pruned 节点（独立 datadir/端口，与 TN12 并行）；console 加"网络=mainnet"配置分支只读接入；identity/discovery 读链 | 0 | 机器：**与 S-2 合一**——第二台机既做 TN12 前向节点又做主网节点（RAM ≥32 GB、SSD ≥300 GB） | 本周 |
| **1 · 通信与身份** | KANet 三原语的前两个（安全通信、身份与发现）在主网真跑：relay 主网密钥、DM/广播、握手；tg-bot 只读/只收 | 手续费级（广播 tx） | G-2（已落）；relay 密钥主网隔离；`KASPA_NETWORK` 单一源；地址前缀双网写法核全 | 波 0 稳定 1 周后 |
| **2 · 价值结算·签名型** | 三个签名型 escrow（memory：三 escrow 靠签名）、OTC/exchange auto-pay 小额 | 小额上限（如单笔 ≤10 KAS、日 ≤100 KAS） | **G-1 enforce**（34 条 submit 路径同闸 + `hdr−blk` 判 IBD 中 + fail-closed）+ NWT 真钱清单 MUST 全落 + S-1 冻结语义 + 自动 NO-TX-NO-STATE 审计 | 波 1 + G-1 影子 24 h |
| **3 · ZK 结算** | §6-3 / bshard / pool covenant 上主网：silverscript v1-rc1 迁移 → 主网编译 → 独立隔离测试（D-005 慎重铁律）→ Owner 拍迁移 | 按盘上限 | 合约全量重编 + P2SH 全换 + ZK proof 生成链路在主网费率下的成本核 + OP_PICK 修复上游 | 波 2 + 合约迁移完成 |

TN12 保留为 staging（每波先在 TN12 走一遍再上主网）；D-c/D-d 留在 TN12 二进制，主网不带（主网多 peer，若观测到同病再 rebase）。

## 4. 我们已经有的、直接可复用的
- 双网写法已在代码里普遍存在（`startsWith('kaspatest:') ? 'testnet-12' : 'mainnet'`）、`KASPA_NETWORK` 55 处配置化、rpc-health/rpc-shared 刚落地的按网络过滤（G-2）。
- 本周落地的运维纪律：非提权起停 kaspad、构建 -j2、产物内嵌 hash 门、每步 ledger 记账、推送闸、默认动作 + 否决窗。
- 审计仪器：NWT 的 fail-open 窗审计脚本、J2 的 sendCommandAsync 调用方表（34 条 submit 路径清单 = 波 2 的闸覆盖面）。

## 5. 不做什么
- 不把 1.1.1-toc.1 分支带上主网（它的主网参数 covenant=never）；主网只用官方 release。
- 不在同一台机上跑第二个 kaspad（内存已紧、同一故障域）；与 S-2 合一上第二台机。
- 不在 G-1 落地前让任何主网花钱路径自动跑。

## 6. 请 Owner 拍的
1. **波 0 GO**：起第二台机（S-2/主网合一）的规格与来源（younio 加内存 / 云 VPS）。
2. **G-1 GO**（波 2 的 MUST，已是待批项）。
3. 合约迁移（silverscript v1-rc1）从"低优先"提为波 3 前置——同意否。
4. 主网密钥/资金策略：波 1 手续费钱包额度、波 2 单笔/日上限。

## 7. 待补（v0.2）
J2：TN12 绑定五类计数与坐标 / 1.1.1-toc.1→v2.0.1 ABI 差异 / 主网节点资源数；NWT：真钱前置 MUST/SHOULD 清单；我：费用面按真实 tx 大小重算、波 0 的 console 网络分支设计。

---
## v0.2 追加（2026-09-07 14:0xZ · 合并 NWT 真钱清单 + J2 ②③④·J2 ① 代码绑定分类待补）

### A. 费用面重算（撤 v0.1 §2-② 与 ledger 1001 的两个估算）
J2 实测（本机剪裁窗内真 tx，节点 `verboseData.mass`）：
| tx 类 | bytes / grams | 主网 100 sompi/gram | 频率 | 日成本 |
|---|---|---|---|---|
| 转账 | 175 B / 2,047 | 0.002 KAS | — | — |
| DM | 549 B / 2,408 | 0.0024 KAS | 按用量 | 小 |
| **UTXO 再平衡 30→30** | 3,731 B / **45,994** | **0.046 KAS/笔** | 11/h（17 h 实测）～35/h（活跃段） | **12–39 KAS/天（主导项）** |
| settle covenant（设计 mass 50k–440k） | — | 0.05–0.44 KAS/笔 | 按盘 | 按盘 |
| Groth16 gate tx（n=5 公共输入） | ≈17k grams | 0.017 KAS | 按盘 | 小 |
| RISC0 succinct（若用） | transient 2×bytes 主导 | ≈0.3 KAS（估） | 按盘 | 按盘 |
TN12 现在每笔再平衡 fee 5,099,400 sompi ÷ 45,994 grams ≈ **110 sompi/gram = 我们的 relay 已按主网费率付费** ⇒ 主网费用 ≈ TN12 今日水平，NWT ledger 1001 的"≈5 KAS/笔"是把 ×100 叠在已 ×100 的费上，撤；v0.1 的 0.004 漏存储质量，也撤。**结论：费用不否决，但再平衡 cron 是主导项，主网前重设计（目标 UTXO 数、触发条件、合并策略）。**

### B. 共识/ABI（J2 ② · 7b1e18cc → v2.0.1 = 47 commits / 244 文件）
- tx v1 **wire 不变**（`TransactionOutput.covenant` / `CovenantBinding` 逐字同；Rust 内部 `mass→compute_commit/storage_mass` 改名，txid/sighash 不变）。
- OpZk 0xa6、Groth16 0x20（1,400 grams）/ RISC0 0x21（2,500 grams）同值；v2.0.1 新增 Groth16 VK 逐元素计量 2,500 grams/元素 + 拒尾随字节 + `n+1 == gamma_abc` 校验；RISC0 只收 Poseidon2。
- 100 sompi/gram 是 v2.0.1 mempool 政策（非共识）；`max_signature_script_len` 主网 250k < TN12 300k。
- **`TESTNET12_PARAMS` 在 v2.0.1 已删**（v2.0.1 跑不了 TN12）；**P2P 协议 9→10**（我们 toc.1 exe 上主网会被拒连）。
- `determine_ibd_type` 与 4 窗逐字未变、上游无自触发。
- **最大工程量 = silverscript v1-rc1 迁移**：42 个 .sil 全迁（entry / byte[36] / temporal / dispatch tag ⇒ 字节码与 P2SH 全换），与主网重部署（地址前缀）合并做。

### C. 主网节点（J2 ③）
- 上游 **v2.0.1 原样，不带 D-b/D-c/D-d**：它们治的是 TN12 拓扑（单前向 peer + 0.75 bps 爬行 + syncer pp 停滞）；主网多 peer 全速收块、pp 随网推进，v2.0.1 还新增拒陈旧 pp 的 syncer。D-d 的拒绝诊断行值得上游 PR。`--rocksdb-cache-size` v2.0.1 自带。
- 硬件（指南）：最低 8c / 16 GB / **640 GB SSD** / 10 MB/s，推荐 12–16c / 32 GB / 1 TB。elldeeone 报告是 devnet 合成压测，不代表主网。
- **本机并跑不可行**：12c / 61.6 GB / D: 空闲 712 GB 但 TN12 已占 204 GB 且在涨 ⇒ 磁盘余量 <100 GB；两台 kaspad + console 内存吃紧；llama 必关。端口可分（主网 16111/17110 vs TN12 16311/17210）。⇒ **波 0 的机器 = S-2 第二台机（≥32 GB / ≥1 TB SSD）**，TN12 与主网各一台。

### D. 真钱前置（NWT 清单 5 域 22 条·摘 MUST）
1. **G-1 enforce + G-2 + `KASPA_RPC_LOCAL_ONLY=1` 三者 MUST**（在主网，rpc-health 硬编码 mainnet"恰好对网"，公网 mainnet 节点 isSynced=true 过 networkId 核 ⇒ 不设 LOCAL_ONLY 就是 22:55Z 形状的主网版）。
2. **NO TX NO STATE CHANGE 两处已知违反先修**：`exchange-machine.js:828-829`（kaspa 路径硬构造 confirmed:true）、`bettor-prediction-settler.js:198/216`（拿 txid 即推进）+ **submit 对账器** cron（递出后 T+10 min 三源无 ⇒ 告警 + 冻结该 relay）。
3. 私钥 40 处常驻 × 40 relay 同机 ⇒ 分离 + 上限；`api/relay.js:1774` 无白名单直通；0.0.0.0 监听清单（NordLynx/Tailscale/WSL 多网卡）。
4. S-1 冻结语义（jepu1 47 天每小时空重试 = 主网真费）。
5. 灰度形态：G-1 加 `readonly` 态零新判据 ⇒ 只读 7 天 → 手续费级 → 钱路逐 type。

### E. 四波（修订）
| 波 | 前置（修订后） |
|---|---|
| 0 只读主网节点 | S-2 第二台机；上游 v2.0.1；console `KASPA_NETWORK=mainnet` 只读分支 + `readonly` 态 |
| 1 通信/身份 | LOCAL_ONLY + G-2（已落）+ relay 主网密钥隔离 + 手续费钱包额度 |
| 2 签名型结算小额 | **G-1 enforce + 两处 NO-TX 违反修 + submit 对账器 + 再平衡 cron 重设计 + 密钥分离 + S-1** + 单笔/日上限 |
| 3 ZK 结算 | silverscript v1-rc1 全量迁移 + 主网编译 + D-005 隔离测试 + OP_PICK 修复上游 + Groth16 VK 计量下的 proof 成本核 + Owner 拍 |

### F. 待补
J2 ①（TN12 绑定五类计数与坐标）；再平衡 cron 重设计稿（谁：J2 设计 → NWT）；波 0 console 网络分支设计（我）。

### G. 代码 TN12 绑定分类（J2 ①·≈244 命中文件·页 `scratch/_j2_mainnet_pivot_lists_2026-09-07.md`）
| 类 | 数 | 例 | 修法 |
|---|---|---|---|
| A 配置化已就绪 | ≈132 | 多带 `\|\| 'testnet-12'` 默认 | 默认值改 **fail-fast**（无 `KASPA_NETWORK` 即拒启），不留隐式 testnet |
| **B 地址前缀硬判** | ≈24（console+relay 非测试 16 文件；`api/pool.js` 一家 12 处；settler :2049/2069/2680；trade-filter ×4；bshard-close-voter :141/678；relay.mjs:678；bshard-close-transport:286；u1-same-origin:224） | `startsWith('kaspatest:') ? 'testnet-12' : 'mainnet'` | **结构性风险**：网络从地址串推、不从 env 推 ⇒ 翻 env 修不了——存量 `kaspatest:` 行切换后仍走 testnet-12，没见过前缀的路径静默按 mainnet。修 = 网络单一源（env）+ **前缀一致性核**（地址前缀 ≠ env 网络 ⇒ 拒，不推断），一处 helper 替换 24 处 |
| C 测试 fixture | ≈57 | golden vectors | 主网前缀重生成，否则绿灯空信息 |
| D faucet 类 | ≈11 | 主网无 | 关或换手续费钱包 |
| E 需改代码 | ≈20 | `kanet.env:24` 真开关、`api/tg-wallet.js:27 const NETWORK='testnet-12'`、**`services/zk-prove-worker.mjs:100` ZK gate 地址硬编码 'testnet-12'**、m0c1 两个 `NETWORK_ALLOWLIST`、`scripts/j1-crossnode-verify-tx.mjs:39` | 逐处改；一致地错、易抓 |
agent-mind / agent-adapter 零命中。⇒ **波 0 前置加：B 类 helper 化 + 前缀一致性核 + A 类 fail-fast + C 类向量重生成**；这是波 0 的主要代码工作（而非节点）。
