# KANet-UI 交件：预测市场主网「接通清单」配置/运维侧（账本 (1810)；承接 (1809) 走查）

只查不改：没改 env / 代码，没重启，没广播，没写库，没碰私钥，没抄密钥值。不含新设计——每项只指向仓库里已有的东西。
口径：file:line 与测试网时期做法来自四路只读代码/账本/文档调研（子代理读码，我对关键点抽查；主网 relay 名单与余额是我对 :3202 的 GET 与对库的只读 SELECT 实测）。凡未核对的标「未核」。
D-021：本文不含余额精确值、地址、密钥值。主网 18 个 relay 的名单与余额读数在 `docs-private/2026-10-03-kanetui-mainnet-relay-roster-and-balances.json`（本机 gitignored）。

## 〇、先说三个会改变读法的事实
1. **主网上所有已走通的结算证据都在 proto 路径**（2026-09-20 市场 `a59c7b48`，`docs/provenance/2026-09-20-j2-mainnet-first-settlement-round/RESULT.md`，单委员公钥、`winning_side` 由受控 SQL 写入）。pool/ZK 原生路径（本清单的对象）在主网**零次实链经历**，主网相关表全 0 行（(1809)）。proto 为 Owner 已作废，这里只作事实标注。
2. **没有任何现成工具一次性打印/推导五个 `ZK_*` 值**；推导函数在库里（`gate-tmpl-hash.mjs:45`、`compileSilV100`、`computeCloseZkTmplAnchor` `pool-shard-register.mjs:348`），没有 CLI 包装。KB（D:\KANet-Knowledge-Base）对这几个名字零命中。
3. **主网这批开关现在全关**，console 日志（`logs/mainnet/console-mainnet-stdout.log` 当前一轮）：zk-prove-worker / V1·V2 voter / submit-v2 `NOT started`，`SETTLE_DAEMON_ENABLED!=1`，四个 ZK tick 均 `disabled ... not starting`；stderr 有 `ZK_PROVE_SERVER_TOKEN not set — server NOT started`。

## 一、接通清单（每项一行；字段：缺口 → 现成的在哪 → 主网要设的 env 与值来源 → 钱 → 重启/新进程 → 前置）

### ① oracle/委员池 ≥5 成员
- **缺口**：`oracle_pool_chain_view` 无行/`pool_size<5`；`create-v07` 守卫 `COMMITTEE_SIZE_GUARD=5`（`api/pool.js:1108-1128`，池 <5 返回 400/503）。
- **TN12 怎么做的（链上质押 + envelope，不是手插库）**：设计决议 `docs/2026-06-01-onchain-stake-oracle-pool-DECISION.md`；单一源规则 `docs/2026-06-05-oracle-pool-single-source-enforcement.md`、`docs/DATABASE.md:612-648`。流程（UI 同款，`ui/oracle-home.eta:579-605`）：① 取当前 DAA，`lock_until_daa` 取比 `当前DAA−600` 大得多的值（TN12 测试用 `snapshotDaa+60`；主网具体取值未核）；② `GET /api/relay/:id/pubkey` 取公钥；③ `POST /api/oracle-pool/enroll`（`api/oracle-pool.js:200-291`，body: `staker_pk_x` `lock_until_daa` `signing_relay_id`）→ 算 `OracleStake_v1` P2SH（`lib/oracle-stake-v1.mjs:42`）、写 `oracle_stake_enrollments`、**广播 `oracle_stake_enroll_v1` envelope 到 `kanet-prediction` 频道（真上链、花矿工费）**；④ 从该 relay 转 ≥1 KAS 到返回的 P2SH 地址（`POST /api/relay/:id/transfer`，`relay.js:537`，需 `x-kanet-admin-secret`）；⑤ 扫描器 `oracle-pool-chain-scanner-cron.mjs`（每 5 分钟，`index.js:804-805`，主网日志已 `started`）把「envelope 备案 + P2SH 上 ≥1 KAS UTXO + `lock_until_daa>snapshotDaa`」的成员刷进 `oracle_pool_chain_view`（`oracle-pool-chain-scanner.mjs:67-167`；严格模式只认 `source='chain_envelope'`，`ORACLE_POOL_STRICT_CHAIN_SOURCE=0` 才放宽）。续期 cron `oracle-pool-renewal-cron.mjs` 也已在主网跑。
- **每人锁多少**：池内最低 `ORACLE_STAKE_MIN_SOMPI=100_000_000`（1 KAS，`oracle-stake-v1.mjs:65`；**只在扫描器强制，非链上强制**）；续期默认 2 KAS（`renewal-cron:24`）；质押越高被抽中权重越高（`pool-committee-sampler.mjs:9`）。委员会 5 人、阈值默认 4（`sampler:24`，`migrate.js:4796`）。
- **env**：不需要新 env 名；`ORACLE_OFF` 不能为 1（env 里**未设**，行为 = 启用）；`KASPA_NETWORK=mainnet` 已设（`oracle-pool.js:211/375` 有 `||'testnet-12'` 回退，已设则不触发）。
- **钱**：5 人 × （≥1 KAS 质押 + enroll 广播矿工费 + 转账矿工费）。矿工费单笔精确值**未核**（relay 码里每 input 0.01 KAS 的常量见 `p2sh.mjs:1836`，仅作量级）。质押随 P2SH 锁定，到期 `POST /api/oracle-pool/timeout-unlock`（`oracle-pool.js:457-533`）取回；注册后 24 小时内不可撤、在岗委员不可撤（`:314-330`）。
- **主网 18 个 relay 里哪些可用**（名单/余额见 docs-private；这里只给分类，余额档位：高 ≥5 KAS / 中 1–5 / 低 <1）：
  - 排除 broker：`Trader-A`（role=broker；且代码互斥：broker 不可为 oracle，`relay.js:266`、`bettor.js:2175-2186`）。
  - 排除 PROTO_RELAY_ID：`proto-v0-funds`（启动日志 `[proto] PROTO_RELAY_ID healthy: name=proto-v0-funds`）。
  - 排除 KTT 专用：`KANet-UI`（relay id 前缀 `0044cfbd`，= (1805) 的 `KTT_PANEL_RELAY_ID`）。
  - escrow 专用 relay：`SERVICE_ESCROW_ENABLED=1` 在 env，但其 relay id 环境变量名/值我**未核**，所以「是谁」未核；候选排除前须先查。
  - 余额不足：`stress-user-01…08`、`stress-control-01/02`（10 个，余额都 <1 KAS，不够 1 KAS 质押+费用）。
  - 剩余可用候选：`J2`（高）、`NWT`（极高）、`Trader-M`（中，role=trader）、`Bettor`（中，role=predictor）、`Qclaude`（低，≈1 KAS，勉强）。**去掉 escrow（未核）后至多 5 个，且 Qclaude 余额接近质押下限、没有手续费余量；同时池里需要比 5 多的余量**——采样会排除该市场 maker/broker/已下注 bettor 的公钥（`pool-market-settler-v06.mjs:322-363`），池恰好 5 且含 maker 时抽样直接报 `pool must have >= 5 members after excludePks filter`（`sampler:95-96`，此为代码推断）。**这些 relay 是会话身份（J2/NWT/Bettor），挪作 oracle 是否允许未核，需 Bettor/Owner 定。**
- **`is_oracle=1`**：入池**不要求**它；它决定本机哪些 relay 能签名/投票（`trade-protocol-filter.js:609`、`bshard-close-voter.js:281,413`、`bshard-settle-daemon.mjs:119`、`bettor-prediction-voter.js:88`）。主网 `is_oracle=1` 的 relay 现为 0。**代码里没有置 1 的 API；TN12 怎么置的未核**（疑似手工写库）。主网置位 = 写库，按铁律 0/Bettor 审。`docs/DECISIONS.md:396` 提示迁移该列须先答「双读双写还是原子切换」。
- **重启**：enroll/转账/扫描**不需要重启** console（走已在跑的接口与 cron）。
- **前置**：转账接口需 `ADMIN_SECRET_FUNDS`——按 (1806) 先例，读主网 env 密钥+调资金接口的会话会被权限层拒，需 Owner 本人执行；5 个公钥须在不同 relay/不同钥上。
- **旁证口径冲突**：TN12 账本里 `is_oracle=1` 数量不一致（3 / 5 / 10 / 13 成员，`COORD-LEDGER.md:5364`、`:5234`、`DATABASE.md:310`、归档账本 `:686-690`），不要照抄。

### ② 五个 `ZK_*` env（缺任一，ZK 原生建盘/handoff 直接抛错：`api/pool.js:171-179`、`lib/bshard-close-transport.mjs:555-562`）
- 主网 env **一个都没设**（`j1-inbox/2026-09-22T21-44Z-kanetui-done-testnet-to-mainnet-wiring-inventory.md:24` 与 (1809) 一致）；`start-console-mainnet.ps1` 只逐行载入 `kanet.mainnet.env`，**无任何 ps1 导出这五个名字**。
- `ZK_CLOSEZK_SIL_PATH`：指向 `D:\kanet-tn12\kasia-console\src\lib\CloseZkV2.sil`（存在，32465 B，sha256 `6b9f5378…7277` = `kasia-console/scripts/mainnet-sil-set.json` 的 CloseZkV2 条目）。`lib/sil-v1/` 下没有它（`mainnet-sil-set.json` 的 `physicalCollectionStatus=PENDING`）。`docs/provenance/2026-09-14-j2-t3-v03-closezkv2-tokenization/CloseZkV2.sil` 是早于 9-15 删字段的旧副本，未 diff。TN12 时期实际路径值**未核**（env 未读）。
- `ZK_GATE_TMPL_HASH`：gate covenant 模板哈希 `blake2b(0x20‖800 字节后缀)`（`CloseZkV2.sil:17` 第一个 ctor 参）。推导 `computeGateTmplHash(imageId, sampleReceiptHex, sampleJournalHash, kaspaZk)`（`lib/gate-tmpl-hash.mjs:45`；需 kaspa-wasm ZK-SDK 与 `zk-payout-guest/proofs/3o6cs-attest-0a358fa0/3o6cs_receipt.hex`）。代码里 `ZK_GATE.gateTmplHash` 常量 + 手工同步的 env 副本，不一致即抛（`gate-tmpl-hash.mjs:82`）。**依赖 guest imageId，与网络、silverc 编译器无关**；主网 imageId 是否同 TN12 **未核**。文献：`docs/2026-07-09-NWT-redteam-gate-tmplhash-live-derive-66de59c6.md`、`ANTI-PATTERNS.md` 规则 55（约 :2811-2840）。
- `ZK_TOKEN_TMPL_HASH` / `ZK_CLAIM_TMPL_HASH`：KanetTestToken / KanetTokenClaim 的 v1.0.0 模板哈希，公式 `blake3(len8LE(prefix)‖prefix‖len8LE(suffix)‖suffix)`（`pool-template-artifact.mjs:117`）。现成产物 `kasia-console/scripts/proto-v0-template-anchors.json`（由 `scripts/proto-v0-template-anchors.mjs` 生成，2026-09-14T20:15Z，源 sha256 与 `mainnet-sil-set.json` 一致）：token `225ebcde…d44d80e`，claim `395949e1…bdefd21e1`。**这两个值是否就是 env 该设的值未核**（只读调研未复算）。注意 D-017 注记里的 `a5c45a36…`/`209abf73…` 是旧编译器 P12 样本，**不是**这两个值。**按 pin（silverscript v1.0.0 @ 3ed9733，`scripts/silverc-pin.json`），换编译器哈希就变，不得静默升级。**只读校验脚本：`kasia-console/scripts/t4-zk-tmpl-env-db-compare.mjs`（把三个 D-019 env 与 `payout_shards` 每市场声明值对照；只比不算）。
- `ZK_MARKET_SUFFIX_HASH`：**源字段已被 (1408)(1409)(1415)(1458) 从 .sil 与 `computeCloseZkTmplAnchor` 删除**，`payout_shards.market_suffix_hash` 不再写（`pool-shard-register.mjs:245-247`），但 env 存在性检查仍在（`pool.js:179`、`bshard-close-transport.mjs:562`、`assertZkHandoffTmplCoherent`、`bshard-payout-family-coherence.mjs:180`）。**仓库里没有任何说明该设什么值——未核；需问 J2/Bettor。**
- 钱：0。重启：**需要重启 console**（env 只在进程启动时读）；env 文件是生产检出硬闸文件，只能 Owner 终端手动改（接位文件「生产检出硬闸」）。
- 来历文献/账本：(1170)(1188)（T3 加字段，`pool.js:173` 注释）、(1216)–(1222)（D-019 pin 与迁移清单 `docs/2026-09-14-j2-d019-silverc-v100-migration-inventory-v0.1.md:28`）、(1230)(1236)（KANet-UI pin 部署页，`docs/provenance/2026-09-14-kanetui-d019-pin-deploy/README.md:23`：当时要求这三个 D-019 env 保持 UNSET）、(1288)、(1415)(1458)。
- 编译器：`SILVERC_V100_PATH` 已在主网 env，console 日志 `[silverc-pin] PASS sha256=4378ba65... golden=RootClaim ok`。下注注册仍走 `SILVERC_LEGACY_PATH`（`api/pool.js:1589/1856`、`lib/pool-bshard-market-setup.mjs:20`、`services/bshard-close-voter.js:46`），legacy 二进制存在（`D:/silverscript/versioned-builds/silverc-legacy-2c46231.exe`）；是否与主网集冲突未核。

### ③ 自治结算开关（全部只认字面 `1`，默认关；开关是配置变更，须重启窗 + 账本记账 + Bettor/NWT 双签：`docs/2026-07-09-zk-autonomy-three-parts-design.md:59`）
| 开关 | 控制什么 / 前置（file:line） | TN12 值（出处） | 主网现值 |
|---|---|---|---|
| `SETTLE_DAEMON_ENABLED` | **经典 V1 路径**自治结算 daemon，60s 一 tick，每 tick 最多 1 市场；需同时有 `SETTLE_DAEMON_FEE_RELAY_ID`（`bshard-settle-daemon.mjs:66,1043-1050`）；`index.js:814` 还有 `SETTLE_DAEMON_OFF!=='1'` 外门。**不处理 ZK 原生市场**（`:624`）。隐藏依赖：`SETTLE_DAEMON_CONSOLE_BASE` 默认 `http://127.0.0.1:3200`（`:51`），本机 3200 无监听，主网要开必须显式设为 3202 | 1（账本 `:711`、`:7272`(234)） | env 未设 ⇒ 关 |
| `SETTLE_DAEMON_FEE_RELAY_ID` | 经典路径 fee 身份；ZK 的 claim tick 与 judge-propose tick **运行期**也借用它（`:109-115,1094,1150-1158`，启动期不检查，开了不配会运行期失败）。代码默认 null | 有值（8/29 env 清单），具体 relay **未核** | 未设 |
| `ZK_JUDGE_PROPOSE_TICK_ENABLED` | 扫已过 deadline 的 `zk_native` 市场 → `judgeWinDir`（要外部数据源：Polygon RPC / ESPN / blockhash_parity）→ propose；30s tick，5 分钟冷却（`bshard-settle-daemon.mjs:1147,1162`，`zk-autonomy-ticks.mjs:455-494`）。需 `BSHARD_SETTLER_RELAY_ID` + FEE relay | 1（7/12 起，账本 `:650`） | 关 |
| `BSHARD_CLOSE_VOTER_V2_ENABLED` | ZK 原生市场委员自治 enforce+签名；用本机 `is_oracle=1` 的 relay 签，不花钱（`bshard-close-voter.js:545,413`）。分布式强度：收签不出机，单机自签 quorum（账本 `:7286`(235)） | 1 | **env 明示 0** |
| `BSHARD_CLOSE_SUBMIT_V2_ENABLED` | settler 收齐签名后广播 `close_attest_v2`，落库后自动入队 prove job（`voter.js:642,732-790`）；需 `BSHARD_SETTLER_RELAY_ID` | 1 | **env 明示 0** |
| `ZK_HANDOFF_TICK_ENABLED` | 对 closed==1 且无 `zk_continuation` 的市场做 handoff；tick 里 `dryRun:false`（`:1129`，函数本身默认 dryRun=true，`transport:528-532`）；还需 ② 的五个 env；5 分钟冷却 | 1（7/12 起，账本 `:651`） | 关 |
| `ZK_PROVE_WORKER_ENABLED` | 轮询本机 `zk_prove_jobs`，经 `wsl.exe` 跑 RISC0 Groth16（约 4 分钟，超时默认 15 分钟），铸 gate 并注资 1 KAS（`zk-prove-worker.mjs:119,40,130-239`）；`index.js:627` 另有 `ZKPROVE_OFF` | 1 | **env 明示 0** |
| `ZK_CLOSE_TICK_V2_ENABLED` | 对 proving ready 且链上 closed==1 的市场广播 `bshard_zk_close`，landed 深度 20 才持久化（`zk-autonomy-ticks.mjs:89-139`）；需 `BSHARD_SETTLER_RELAY_ID` | 1（7/10 起，账本 `:674`） | 关 |
| `ZK_CLAIM_TICK_ENABLED` | 对 closed==2 市场每 tick 每市场 claim 一个 leaf，用 FEE relay 铸 0.3 KAS fee UTXO，settler 广播（`ticks:145-249`） | 1（7/10 起） | 关 |
| `BSHARD_SETTLER_RELAY_ID` | ZK 链的「settler 身份」：付 fee、收找零、广播；缺则各环 fail-closed（daemon 不启动 / submit-v2 每市场报错 / prove job 标 failed） | 已设（账本 `:734`），具体 relay **未核** | 未设 |
| `BSHARD_CLOSE_VOTER_ENABLED`（V1） | 经典 22 参 close_attest 委员自治 | **OFF**（`docs/2026-08-03-...design.md:338`、账本 `:647`） | 未设 ⇒ 关 |
| `ZK_PROVE_SERVER_TOKEN` | `index.js:620` 无条件调 `startZkProveServer()`，无 token 则 fail-closed 不起（`zk-prove-server.mjs:29-32`）；监听默认 `100.99.147.101:3201`。**自治链路不依赖它**（enqueue 直接写库、worker 直接读库）；它只服务「跨机 job 队列」设计 | 变量名在 env 清单，当年是否真在 3201 监听**未核** | 未设；3201 无监听 |
- **开关依赖链（TN12 跑通顺序，账本 `:674,:650,:651`）**：`JUDGE_PROPOSE` → `VOTER_V2` → `SUBMIT_V2`（自动入队 prove）→ `HANDOFF` → `PROVE_WORKER`（要求已有 `zk_continuation`，所以必须在 handoff 之后）→ `CLOSE_TICK_V2` → `CLAIM_TICK`。缺任一环，产物停在中间态。TN12 实证：7/10 bvh2c（attest 全自治）、7/12 a4343（账本 `:650`「六环全自治 ALL GREEN」）。
- **dry-run 只有**：`buildZkHandoffRequestV2` 的 `dryRun` 默认值、`bshard_zk_handoff` 命令的 `dryRun`、四个 `/api/admin/pool/*-v2` 管理端点（`ADMIN_*_ENABLED` 默认关 + IP 白名单）。**其余 tick 开了就真广播。**
- 9/14 主网审计的「双闸」建议：`VOTER_V2`、`SUBMIT_V2` 保持 0 作为第二道闸（`docs/2026-09-14-kanetui-mainnet-closezkv2-genesis-autotrigger-audit-v0.1.md:70-72`）。
- 重启：**每个开关都需要重启 console**。前置依赖：①②和下面④⑤。

### ④ prove 外部环境（da9 实况，我只读核）
- 在：kaspa-wasm ZK-SDK `D:\rusty-kaspa-zksdk-isolated\wasm\nodejs\kaspa\kaspa.js`；`zk-payout-guest/target/release/host`（44MB，Jul 12，host Cargo 只有 `risc0-zkvm ^3.0.5`，无 cuda feature）；WSL Ubuntu-24.04 Running。
- **不在 / 断点**：Ubuntu-24.04 内 `cargo: command not found`，`~/.risc0` `~/.cargo` `~/.rzup` 都不存在；`wsl -l -v` 默认发行版是 `docker-desktop`；worker 调 `wsl.exe -e bash -lc`（无 `-d`，`zk-prove-worker.mjs:72`）⇒ 按码推断，现在开 `ZK_PROVE_WORKER_ENABLED=1` 会在 spawn 处失败（推断，未调用验证）。Docker Desktop 守护进程未运行；Groth16 转换是否依赖 Docker **未核**。`TOOLCHAIN.lock.md` 称 canonical 构建在 da9 WSL Ubuntu-24.04 root 完成——现在的 WSL 里没有，是否被重置/重装**未核**（注意 10-03 刚做过 WSL 盘迁移，(1801)）。
- `zk-prove-server`（:3201）不在；非自治链路必需。
- 钱：prove worker 每个 job 铸 gate 注资 1 KAS（`ZK_GATE_FUND_SOMPI` 默认 100,000,000，`worker:40`）。重启：开关生效需重启；工具链重装不需要重启 console。

### ⑤ 资金侧（relay 与钱，只读）
- settler relay（`BSHARD_SETTLER_RELAY_ID`）各环的花费（来自 relay 码常量，均未实测）：judge+propose 缺省自转 0.5 KAS 做 fee input（`transport:402-405`）；submit-v2 约 2 input×0.01 KAS；handoff 先自转一笔**等于 consolidated_pool 的 fee input**（`transport:594-595`）——settler 必须有 ≥ 池子大小的流动余额；prove 注资 1 KAS；zk_close 派发时 `outputs:{}` 无找零地址，按码推断整个 gate 余额会作矿工费烧掉（推断，未链上实测）；claim 用 FEE relay 铸 0.3 KAS fee UTXO。
- 未核：FEE relay 与 settler relay 是否须为同一钱包（claim 的 fee UTXO 地址是 FEE relay，广播与签名在 settler 钱包，`p2sh.mjs:2494` 后；`bshard-settle-daemon.mjs:46-47` 注释与 `mintFeeUtxo` 的写法不一致）。
- 谁出钱：必须是我们自己的 relay，且排除 broker / PROTO_RELAY_ID / KTT / escrow；`proto-v0-funds` 带 5 KAS 启动断言（`lib/proto-relay-guard.mjs:17`），不能当大额资金池。哪几个 relay 能当 settler/FEE，余额档位见 ① 与 docs-private，需 Bettor 指定。

### ⑥ 代码里仍指向 TN12 的位置（走查 (1809) 已列，补子代理发现）
- `zk-prove-worker.mjs:100` 铸 gate 地址网络写死 `'testnet-12'`；`bshard-settle-daemon.mjs:106,387` p2pk 写死 `NetworkType.Testnet`；`bshard-close-transport.mjs:244` 非 `'mainnet'` 即 `'testnet-12'`；`oracle-pool.js:211,375,385,389,468`、`api/pool.js:1141` 的 `||'testnet-12'` 回退；`api/pool.js:1519` 写死。**代码侧（J2）**，这里只列事实。
- `SETTLE_DAEMON_CONSOLE_BASE` 默认 :3200（见 ③），属 env 侧。

## 二、第一原则最低范围：「复用 / 参照 / 为何不能用」（扫了 `kasia-console/src/services/` 全目录、`index.js` 启动注册、`logs/mainnet` 当前一轮日志、`docs/2026-09-20-kanet-capability-asset-inventory-v0.1.md`（清单自己承认会过期，tg-bot 条目为 09-20 状态，之后是否改过未核）、`scripts/`、`test-framework/`、`docs/provenance`）

主网当前一轮日志实况（`logs/mainnet/console-mainnet-stdout.log`）：
- **在跑**：`bettor-prediction-voter`（5 分钟，无开关）、`bettor-prediction-settler`、`pool-market-settler`（5 分钟，无开关）、`bettor-refund-claim-auto`、`pool-house-agent`、`oracle-pool-scanner-cron`、`oracle-pool-renewal-cron`、`oracle-voter-health-monitor`、`proto-driver`、`proto-settlement-driver`、`market-seeder`（KAS↔USDT，与预测无关）等。
- **disabled / NOT started**：`zk-prove-worker`、`bshard-close-voter`（V1/V2/submit-V2）、`settle-daemon` 及 4 个 ZK tick、`proto-oracle-adapter`、`pool-market-seeder`（`POOL_SEEDER_ENABLED=0`）、`auto-bet`（`AUTO_BET_TICK_MS=0`）、`bot-autofund`（`BOT_AUTOFUND_SOURCE_RELAY_ID` 未设）、`broker`、`faucet-health`。
- proto-driver 与 proto-settlement-driver 无动作时不打 tick，「started」≠「有活干」。

| 缺口 | 复用 | 参照 | 为何不能直接用 |
|---|---|---|---|
| A 委员池 ≥5 | `POST /api/oracle-pool/enroll`（`oracle-pool.js:200`）+ 扫描器/续期 cron（主网已跑）+ `pool-committee-sampler.mjs`（VRF 抽 5）；UI 流程 `ui/oracle-home.eta:579-605`；补发脚本 `kasia-console/scripts/_backfill_oracle_stake_enroll.mjs` | 归档账本 TN12 池成员变迁 `docs/iteration/archive/COORD-LEDGER-2026-06_to-07-07.md:686-690`；`scripts/_owner-uat-oracle-deposit.mjs`（v0.5 老 bond 路径） | `POST /api/oracle-pool/seed` 已是空壳（恒 `seeded:0`，`:154-175`）；`/api/oracle/announce`（`bettor.js:2161`）写 `oracle_registry` 但**不入池、也不置 `is_oracle`**；v0.5 的 3 人 bond（`pool.js:2150`）v0.6/v0.7 不用；proto 路径单委员 keypair（`proto.js` 约 :160），不是多委员 |
| B 五个 ZK env | 推导函数（`gate-tmpl-hash.mjs`、`compileSilV100`、`computeCloseZkTmplAnchor`）；`proto-v0-template-anchors.mjs/.json`；`t4-zk-tmpl-env-db-compare.mjs` | `mainnet-sil-set.json`、`silverc-pin.json`、`docs/2026-08-27-kanet-ui-tier2-switch-inventory-v0.1.md:26`、`j1-inbox/2026-08-29T0520Z-kanetui-console-env-checklist.md:50` | 没有 CLI 把五个值一次打印；`ZK_MARKET_SUFFIX_HASH` 无来源说明；proto-v0 不读这组 env（走 `lib/proto-covenant-builder.mjs`），不能拿来当值来源 |
| C 自治结算 | `bshard-settle-daemon.mjs`、`zk-autonomy-ticks.mjs`、`bshard-close-voter.js`、`zk-prove-worker.mjs`（代码就位，开关为 env） | TN12 开关矩阵账本 `:711`、`:674`、`:650`、`:651`、`:7272`；9/14 主网审计 `docs/2026-09-14-kanetui-mainnet-closezkv2-genesis-autotrigger-audit-v0.1.md` | 它们操作 `pool_markets`/`market_shards`/`payout_shards`（主网 0 行）；prove 工具链现缺（④）；`SETTLE_DAEMON_CONSOLE_BASE` 默认指向已退役的 :3200 |
| D 主网建盘 | pool：`POST /api/pool/market/create*`（`api/pool.js:578/852/1073`，页面 `/predictions/pool/create`）；proto：`POST /api/proto-markets/create`（`proto.js:92`，已有主网先例 `a59c7b48`） | `docs/provenance/2026-09-20-j2-mainnet-first-settlement-round/RESULT.md`；TN12 跨节点闭环 `docs/2026-06-06-cross-node-committee-oracle-settle-CLOSURE.md`（v0.7，demo 金额）；oracle simnet 四臂 `docs/provenance/2026-09-21-j2-oracle-simnet-e2e-four-arms/README.md`（H 臂 adapter 自动 derive，simnet） | pool 路径需 A+B；proto 为 Owner 已作废；RESULT.md 自注：全新主网创生直达、多赢家、并发都没测，且 7 笔交易会卡在没有合格 fee UTXO（`proto-v0-funds` 5 KAS 断言） |
| E KTT 下注 | pool 下注库层 `registerBettorOnShard` 方向A（`pool-shard-register.mjs:556-572`）；KTT 铸币/持仓 `api/tokens.js`（D-035，`KTT_PANEL_ENABLED=1` 已开） | KTT v2 simnet 证据 `docs/provenance/2026-09-27-j2-ktt-v2-simnet/` | KTT 在主网的下注无证据（未核）；pool `/prep` 是否不广播、`register-v07` 是否经方向A 均未核 |
| F Polymarket→市场/判定 | 搜题 `GET /api/predictions/polymarket/search`（主网实测 200）；`bettor-prediction-voter.js` 的 `derivePolymarketVote`(:802)/`deriveKanetNativeVote`(:879)；老镜像 `pool-market-seeder.js` + `scripts/_wc_polymarket_import.mjs`（`data_source_canonical=polymarket:<condId>`） | 判定 skill 设计 `docs/2026-08-03-oracle-skill-interface-permission-boundary-freeze-design.md` | 没有独立 oracle mapping 表（映射在创建时的 `resolution_rule_spec` 里）；`proto-oracle-adapter` 主网 disabled，且 `judgedMarketAllowedHere` 主网只允许零价值代币白名单，白名单空则一律拒（refund 执行未接线，N5b）；pool 判定走 `bettor-prediction-voter` 需 `is_oracle=1` 的 relay（主网 0 个） |
| G 给 relay 注资 | relay 转账接口 `/api/relay/:id/transfer`；faucet `api/chat.js`；`pool-bot-autofund.js`（需 `BOT_AUTOFUND_SOURCE_RELAY_ID`，主网未设，且为 testnet 挖矿储备模式） | `kasia-console/_distribute_tn.mjs`（TN12 分发，文件头含测试网助记词，我只看了头，未复用） | 转账接口需 `ADMIN_SECRET_FUNDS`（Owner 执行，(1806)）；`proto-v0-funds` 的 5 KAS 启动断言使它不能当资金池 |

## 三、依赖总序（只列依赖，不排优先级）
- ① 成员入池 ← 需 5 个可用 relay 身份（分类见 ①）+ 每人 ≥1 KAS + Owner 执行转账接口。
- `is_oracle=1`（V2 voter 签名、pool 判定 voter）← 写库，无 API，TN12 做法未核。
- ② 五个 ZK env ← 需先有值（②未核项）+ Owner 终端改 env + 重启 console。
- ③ 各开关 ← 依赖 ①②④⑤；开关本身需重启 + 双签。
- ④ prove 环境 ← WSL 内缺 cargo/risc0；Docker 依赖未核。
- ⑤ settler/FEE relay 与资金 ← 需 Bettor 指定 relay（含 settler 与 FEE 是否同一钱包未核）。

## 四、本次实际动作
只读：HTTP GET（`/api/relay/:id/balance` ×18，写入 docs-private）、`console.mainnet.db` 只读 SELECT（relay_nodes 的非密钥列）、`kanet.mainnet.env` 只匹配键名与 0/1 开关值（未读任何其它值）、PowerShell 进程/端口/WSL 只读查询（子代理）。临时脚本在 `kasia-console/scratch/_kanetui_relays*_20261003.mjs`（gitignored）。
