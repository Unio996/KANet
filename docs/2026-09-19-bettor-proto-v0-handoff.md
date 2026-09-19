> **Status**: CURRENT（**状态层快照，会过时，以账本为准**）。
>
> **接位文件不在本仓库**：Bettor / J2 / NWT / KANet-UI 的稳定层接位文件一直在 `C:\开发过程\多智能体开发框架\开发智能体接位\`（`Bettor-接位.md` 等），那里放角色、纪律、坐标，**不放进度**。本文件是主网期的阶段性快照，供接位者快速拿到"现在链上和库里是什么状态"，读完仍须以 `docs/iteration/COORD-LEDGER.md` 为准。
>
> **接位顺序**：① `C:\开发过程\多智能体开发框架\开发智能体接位\Bettor-接位.md`（稳定层）→ ② 本文件（状态快照）→ ③ `docs/DECISIONS.md` D-017…D-022 → ④ 账本最后 40 条。
>
> 2026-06-15 那份 `docs/2026-06-15-Bettor-tn-handoff.md` 是 TN12 时代，除"工具调用必须是真 invocation"外全部过期。D-021：本文件不写密钥值、真实余额、地址、内网入口。

# Bettor 接位文档 —— 原型 v0 主网金丝雀 + 结算后半程实现

## 0. 你是谁

**Bettor = 协调者 + 审码闸 + 验落链者**。你不自己写业务代码，你派活、审、核链、记账、向 Owner 单点上报。

- **所有给 Owner 的回复必须用中文。**
- Owner 不在终端里当交互对象：不给菜单、不问"要不要我…"，需要拍板的事精炼成一条上报（见 §6）。
- 开发智能体：**J2**（落码）、**NWT**（红队复核）、**KANet-UI**（前端 / 执行页 / runbook）。用 SendMessage 按名字发，名字见 ListAgents。
- **模型分配**：Bettor 用最强模型，J1 / J2 / NWT / KANet-UI 一律 Sonnet。

## 1. Owner 的四条铁令（违反即返工）

1. **不给自己加戏**（D-017 系）：任何约束先回答"它防住的真实损失是什么"，答不出就不加。红队提的 MUST 也适用。零价值测试币不需要防场外流转。
2. **上游问题第一时间反馈**：工具链缺陷发现即报 GitHub issue（账号 Unio996，`gh` CLI），常设授权、不逐次请批；Bettor 先审中性与可复现。**禁止 fork 别人的仓库、禁止向别人的仓库推分支或 PR**——这条犯过一次。
3. **仓库有意公开**（D-021）：`Unio996/KANet` 是 public。入库文字不得含密钥值、真实余额 / 持仓、地址与持有人的对应、未修复漏洞的利用细节、内网 IP / 远程入口。敏感记录写 gitignored `docs-private/`，账本只写相对表述与前缀。
4. **铁律 0**（`CLAUDE.md`）：报备 → 审核 → 批准 → 测试，才可改码。钱路 / covenant / 结算 / 用户面改动必须 Owner 批。

## 2. 现状快照（2026-09-19，全部为 Bettor 亲核）

### 2.1 主网

- 主网节点：官方 `kaspad 2.0.1`，二进制 `D:\rusty-kaspa-v201\kaspad.exe`（sha256 `8afe6a68…`），数据目录 `D:\kaspa-mainnet-data-v201`，RPC `127.0.0.1:17110`，P2P `16110`。只读、`--utxoindex`。
- 主网 console：`:3202`，由 `scripts/start-console-mainnet.ps1` 起，pid 文件 `logs/mainnet/console-mainnet.pid`，日志 `logs/mainnet/console-mainnet-stdout.log` / `-stderr.log`。配置 `kanet.mainnet.env`（gitignored）。
- **原型驱动当前关闭**：`kanet.mainnet.env` 里没有 `PROTO_DRIVER_ENABLED` 也没有 `PROTO_SETTLEMENT_DRIVER_ENABLED`（只有一行历史注释提到前者）。**关闭 = 系统不会自动发起任何链上交易。** 开关只在 Owner 批准的执行窗里临时加，用完立刻删、重启、核实日志出现 `[proto-driver] disabled`。

### 2.2 链上与库（`kasia-console/data/console.mainnet.db`）

| 市场 | 状态 | 说明 |
|---|---|---|
| `357681df…` | cancelled | 闸 3 第一次重试的残留，交易从未被节点接受，零资金移动 |
| `a0c4d628…` | cancelled | 闸 3 第二次：genesis 上链但首笔下注被共识拒（合约偏移 bug），leaf 锁 0.2 KAS 永久不可花 |
| `a59c7b48…` | **betting** | **活市场**：min_bet 1、seal_count 2、own_redeem_len 14746、deadline 2026-09-15T19:34Z（已过）；已有 1 笔 confirmed 下注（YES，stake 1） |

- 残留两行（bet `f8e7c719…` pending + 其 intent ambiguous）属已 cancelled 的市场，驱动不会碰，**不删**。
- 原型 relay（proto-v0-funds）：7 枚 UTXO，约 4.09 KAS。完整 txid 与余额见 `docs-private/proto-v0-funds-seed-transfer-balances.md`。

### 2.3 已完成的闸门

- 闸 1（环境 + 重启）、闸 2（种子转账）、闸 3（主网第一个市场 + 第一笔下注，账本 1473 / 1474，NWT 回执 NWT-VERIFY-20260916-1）全部完成。
- 主网实测手续费：genesis 0.213333 KAS、首笔下注 0.433399 KAS。

## 3. 结算后半程（当前主线工作）

- **设计定稿**：`docs/2026-09-16-j2-proto-v0-settlement-design-v0.1.md` v0.8 @`2bcc6c39`（分支 `coord/j2-proto-v0-settlement-design-v0.1`），NWT GREEN。
- **实现计划**：同分支 `docs/2026-09-16-j2-proto-v0-settlement-implementation-plan-v0.1.md` v0.2。
- **Owner 裁定见 D-022**：批准实现；活市场走路线 (A)；`RootClaim.sil:103 require(payout >= 1000)` 直接删除（与 partial 多赢家偏移修复合并，只给新市场）；refund_flip 维持现状。
- **进度**：第 1 批 v210 建表（`bf8d6b99`）、第 2 批结算意图状态机 + ingest `settle:` 分支（`1b973df7`）已完成；接下来六个 builder（market_seal → close_commit → convert_to_claim → claim_draw full → withdraw → 输家 ticket 回收）。**注意 v210 尚未跑到主网库**（主网库里还没有 `proto_settlement_intents` 表），它会在下次 console 重启时建表。
- **路线 (A) 主网执行参数**（simnet 已按同形状 8 步 ACCEPT）：第二笔押 **NO、stake 999** → 裁决 **YES** → claim_draw payout 1000（full 分支）→ withdraw → 回收输家 ticket。执行后 relay 余约 **2.440398 KAS**。
- **主网执行未批准**：实现完成 + NWT 复核 + 执行页后，另报 Owner 开闸。

## 4. simnet（真共识验证台，唯一权威判据）

- 由 NWT 起，进程可能已随会话结束而停。重起方式：**必须**用主网同款 `D:\rusty-kaspa-v201\kaspad.exe`（先核 sha256 与 `--version`），`--simnet --appdir=D:/kanet-tn12/scratch/_nwt_simnet_data --rpclisten-borsh=127.0.0.1:18510 --rpclisten=127.0.0.1:16610 --listen=127.0.0.1:16510 --utxoindex --disable-upnp`，低优先级，不注册服务、不设自启。
- v2.0.1 `SIMNET_PARAMS.toccata_activation = always()`、`skip_proof_of_work = true`；DEVNET 永不激活 covenant，**不能用 devnet**。
- 工具：`kasia-console/scripts/simnet/`（mine-loop.mjs、run-full-chain.mjs 含 probeMempoolMass）、`kasia-console/scripts/audit/`。证据：`docs/provenance/2026-09-16-nwt-proto-v0-settlement-simnet-verify/README.md`。
- **纪律**：任何结算步骤上主网前，其生产 builder 字节必须先在 simnet 真实提交确认；cli-debugger 只是开发辅助，不作上主网依据。

## 5. 踩过的坑（接位者最容易重犯）

1. **合约自续约偏移**（账本 1468 / 1469）：从完整 sigScript 第 0 字节切片只在见证长度为 0 时成立。修法是 ctor 烤入 `own_redeem_len` + JS 不动点收敛。`RootClaim.claim_draw` 的 partial 分支还有同一个 bug，未修。
2. **P2SH 绑定编译字节**：改任何 `.sil` 都会让既有市场脱钩。活市场路线 (A) 不改合约。
3. **节点 RPC 规则**：version 1 交易 `sigOpCount = 0` + `computeBudget = 70`（账本 1465 / 1466）。
4. **CLTV**：`close_commit` / `refund_flip` 的 active input `sequence` 必须 < MAX（取 0），`lockTime` 设为毫秒时间戳，且提交时节点时间须已过 lockTime。
5. **KIP-9 storage mass**：covenant 输出 KAS 值不可取合约里 `DUST_MIN = 1000` 字面值（会算出约 4000 KAS 手续费）；mass 上限是 storage 与 compute **两个维度各 500,000**，必须分别核；kaspa-wasm 本地 mass 与节点值偏差方向不固定，以 `getMempoolEntry` 为准。
6. **审计工具坑**（ANTI-PATTERNS 候选 84–88）：`ScriptBuilder.drain()` / `ScriptPublicKey.script` 返回 hex 字符串；`test.json` 的 `lock_time` / `version` 必须在 `tx` 对象内；WASM 构造函数不接受 plain object；**自检两侧不能都是自己写的实现**。
7. **cli-debugger 盲区**：只执行 active input；不做节点级 finality 校验；`signature_script_hex` 对 active input 被忽略（上游 issue #253）；`close_commit` 在 debugger 持续 FAIL 但真共识 ACCEPT。
8. **工具版本**：作为结论依据的节点 / 编译器 / debugger，用前一律核 `--version` 与 sha256。曾误用 `kaspad 1.1.1-toc.1` 改版跑 simnet。
9. **生产检出**：`D:\kanet-tn12` 是主网 console 的检出，分支必须是 `bshard-m3-deploy`。**禁止在它上面切分支**（账本 1487）；侧分支一律用 `scratch/` 下独立 worktree，且不得 junction 到活 node_modules（规则 81）。
10. **PowerShell 里不要调 `bash`**（会落到 WSL 失败）；改 env 与重启分成两个工具调用，删完先 grep 核实再重启（账本 1468）。

## 6. 日常操作

- **记账**：每件事写 `docs/iteration/COORD-LEDGER.md`（append-only，编号连续，当前最新 1494）。写法：先把条目写到 scratchpad 文件（引号 heredoc，避免反引号），`sed` 填时间戳，再 `cat >>` 追加。
- **提交**：`git -c user.name=Bettor -c user.email=bettor@kanet.local commit`（共享检出的默认身份是 KANet-UI）。推送：`bash /d/kanet-tn12/_bettor_push.sh <队列条数>`，条数对不上会拒推，先查归属。
- **合入侧分支**：NWT GREEN + 生产检出全新 `SS_ARTIFACT_CACHE_DIR` 与临时 `DB_PATH` 下测试全过，再 `git merge --no-ff`。
- **测试调用**：`utxo-splitter.test.mjs` 需要 `node --experimental-test-module-mocks --test`；closezk 系需要 `DB_PATH`。
- **重启 console**（PowerShell，不要用 bash）：另存日志 → 读 pid 文件停旧进程并等子进程退出 → 确认 3202 释放、无 `relay.mjs` 残留 → `Start-Process ... start-console-mainnet.ps1 -WindowStyle Hidden` → 等监听 → 记新 PID → 核启动读数（silverc-pin PASS、proto relay healthy、driver disabled、18 个 relay、FATAL 0、WARMUP FAIL 0、资金路由 403）。

## 7. 未决与观察项

- `RootClaim.sil`：partial 多赢家自续约偏移 + `payout >= 1000` 删除（D-022，给新市场，改完须 simnet 多赢家真跑）。
- `T-PROTO-LEAF-ARTIFACT-VERSIONING`（账本 1471）：每市场记合约源 commit 与编译 hash，不匹配即 fail-closed。触发条件：出现第二个活市场，或下次改该合约之前。
- `T-PROTO-BETTORPK-BINDING`：v0 用委员 keypair 兼任 bettor 身份，真实多用户场景须另议。
- `T-SILVERC-CACHE-KEY-BINARY-FP`、`T-CLI-DEBUGGER-NO-SIGNED-E2E`、`T-UTXO-SPLITTER-RESTART-CHURN`、kaspa-wasm v1 mass TODO（账本 1467）。
- 上游已报：silverscript #252 / #253 / #254。
- register_append 的 mass 已占区块上限约 89%，市场规模变大须重核。
