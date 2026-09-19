> **Status**: CURRENT（2026-09-19，J2；批 6–8 + C1/C2/C3 合入候选的证据；候选头见下；Bettor 裁定 §18.0 选项 (a)，沿批 1–5 先例：候选 → NWT 合入审 → `--no-ff` 合入）

# 批 6–8 + C1/C2/C3 合入候选：合入前证据

## 候选是什么
- 设计分支 `coord/j2-proto-v0-settlement-design-v0.1` **两次** `merge origin/bshard-m3-deploy`（无 fast-forward）：第一次合并主线 `ff4e7560`，第二次在主线又前进 3 笔（T6b 合入 `6a7fdd93` 与两笔协调提交）后追平到 `bda17ee0`。**候选头 = `577a4ebb`（父 `9d883498`、`bda17ee0`），落后主线 0。**（其上还有一笔只含本证据目录的提交，所以设计分支的最终头会是那一笔；代码内容以上述合并提交为准。） 三方试合并两次均 0 冲突；依赖文件（package.json / lock / shared）与主线无差异，故**没有做 npm install**，用现有 node_modules。
- 携带的代码提交（此前只在设计分支侧）：`38e73130`（批 6 claim_draw）、`ef45f568`（C1/C2/C3 + fee cap 替换）、`fd3bbbeb`（批 7 withdraw）、`5e62e24f` + `804349e3`（批 8 ticket_reclaim v1/v2）。批 6–8 的字节层与 simnet 证据在账本 1519–1526 已有，**本文不重审**。
- **改动规模（更正我上一版口径的一处漏统计）**：`kasia-console/src` 下 14 个文件 +1476/−30，**外加 `kasia-console/scripts/proto-v0-template-anchors.json` +15/−3（fee cap 所在文件，我最初圈的路径漏了 `kasia-console/scripts/`）= 15 个代码/配置文件**；其余 31 个文件全是 docs（设计、清单、simnet 证据）。

## 合入卫生项（Bettor 列的四项，逐项用事实核）
| 项 | 结果 | 依据 |
|---|---|---|
| 不接线 | ✅ | 候选相对主线在 `kasia-console/src/services`、`kasia-console/src/api`、`proto-relay-ipc.mjs`、`kasia-relay`、`scripts/m0a-exception-manifest.json` 的改动文件数均为 **0**；§11.1 源码扫描在候选上实跑 PASS（`scan-11-1.txt`：404 个非测试源文件、驱动/HTTP 侧 199 个，0 违规；6 个对照全部符合预期，含"注释里出现不误报"）；withdraw / ticket_reclaim 的 builder 除定义文件外全仓零引用 |
| 无 env | ✅ | 候选 diff 里 env 文件 / 模板 / example 文件数 **0**；新增的 `process.env.*` 引用只出现在 `proto-claim-draw.test.mjs`（3 处）与 `proto-settlement-chain-checks.test.mjs`（2 处）两个**测试文件**（测试自举用），生产代码无新增 env 键 |
| 无迁移外的 DB 改动 | ✅ | `kasia-console/src/db` 改动 0 个文件；候选代码 diff 里新增行含 `CREATE/ALTER/DROP TABLE`、`INSERT INTO`、`UPDATE proto_`、`DELETE FROM` 的行数 **0** |
| fee cap 与账本一致 | ✅ | 见下表；来源 `kasia-console/scripts/proto-v0-template-anchors.json` 的 `feeProfile[kind].cap`，候选改动 15 增 3 删：close_commit 100M→30M、convert_to_claim →52M、新增 claim_draw 50M / withdraw 55M / ticket_reclaim（暂借 1.0 KAS，未接线，1.0 KAS 全局硬顶不变）；market_seal 52M 主线已有。与账本 1514 / 1521 / 1524–1526 所述一致 |

| builder | cap（sompi） | KAS | 状态 |
|---|---|---|---|
| market_seal | 52,000,000 | 0.52 | 主线已有 |
| close_commit | 30,000,000 | 0.30 | 候选：100M → 30M |
| convert_to_claim | 52,000,000 | 0.52 | 候选：→ 52M |
| claim_draw | 50,000,000 | 0.50 | 候选：新增（NWT 按 F3' 推导，账本 1521） |
| withdraw | 55,000,000 | 0.55 | 候选：新增（NWT 推数） |
| ticket_reclaim | 100,000,000 | 1.00 | 候选：暂借占位值，**不进批 9 接线**（T-FEE-PRICING） |

## 测试（候选头 `577a4ebb`，37 个文件，35 个 exit=0 且无 FAIL 行）
每个文件的**完整原始输出**在 `test-outputs/`（仅把本机 OS 账户名所在的临时目录前缀替换为 `%TEMP%`，D-021）；运行器 `run-candidate-tests.mjs`，逐文件末行见 `test-summary.json`：

| | 文件 | exit | 末行 |
|---|---|---|---|
| ✅ | `kasia-console/src/lib/broadcaster-utxo.test.mjs` | 0 | ℹ fail 0 |
| ✅ | `kasia-console/src/lib/proto-bet-intent.test.mjs` | 0 | ✅✅ ALL PASS — proto-bet-intent 单步状态机(幂等/单调/恢复/inputs_spent 歧义终态) 全绿 |
| ✅ | `kasia-console/src/lib/proto-broadcast-ops.test.mjs` | 0 | 16 passed, 0 failed |
| ✅ | `kasia-console/src/lib/proto-claim-draw.test.mjs` | 0 | 47 passed, 0 failed |
| ✅ | `kasia-console/src/lib/proto-close-commit-gate.test.mjs` | 0 | 7 passed, 0 failed |
| ✅ | `kasia-console/src/lib/proto-committee-key.test.mjs` | 0 | ✅✅ ALL PASS — proto-committee-key(生成+加密存储+往返正确+随机IV+零log) 全绿 |
| ✅ | `kasia-console/src/lib/proto-covenant-builder.test.mjs` | 0 | 16 passed, 0 failed |
| ✅ | `kasia-console/src/lib/proto-ktt-transfer-witness.test.mjs` | 0 | 6 passed, 0 failed |
| ✅ | `kasia-console/src/lib/proto-leaf-state.test.mjs` | 0 | 33 passed, 0 failed |
| ✅ | `kasia-console/src/lib/proto-market-intent.test.mjs` | 0 | ✅✅ ALL PASS |
| ✅ | `kasia-console/src/lib/proto-mass-ceiling.test.mjs` | 0 | 16 passed, 0 failed |
| ✅ | `kasia-console/src/lib/proto-register-append-witness.test.mjs` | 0 | 5 passed, 0 failed |
| ✅ | `kasia-console/src/lib/proto-relay-guard.test.mjs` | 0 | ✅✅ ALL PASS — PROTO_RELAY_ID 基础设施(启动断言 6 分支 + 请求体拒绝 6 分支) 全绿 |
| ✅ | `kasia-console/src/lib/proto-relay-ipc.test.mjs` | 0 | PASS |
| ✅ | `kasia-console/src/lib/proto-settlement-chain-checks.test.mjs` | 0 | 21 passed, 0 failed |
| ✅ | `kasia-console/src/lib/proto-settlement-inputs.test.mjs` | 0 | 15 passed, 0 failed |
| ✅ | `kasia-console/src/lib/proto-settlement-intent.test.mjs` | 0 | ✅✅ ALL PASS — proto-settlement-intent 六步状态机(幂等/单调/依赖/恢复/inputs_spent 歧义终态) 全绿 |
| ✅ | `kasia-console/src/lib/proto-signing-key-binding.test.mjs` | 0 | 11 passed, 0 failed |
| ✅ | `kasia-console/src/lib/proto-single-operator-guard.test.mjs` | 0 | ✅✅ ALL PASS |
| ✅ | `kasia-console/src/lib/proto-tx-assembly-register-append.test.mjs` | 0 | 13 passed, 0 failed |
| ✅ | `kasia-console/src/lib/proto-tx-assembly-settlement-golden.test.mjs` | 0 | 12 passed, 0 failed |
| ✅ | `kasia-console/src/lib/proto-tx-assembly-settlement.test.mjs` | 0 | 43 passed, 0 failed |
| ✅ | `kasia-console/src/lib/proto-tx-assembly.test.mjs` | 0 | 32 passed, 0 failed |
| ✅ | `kasia-console/src/lib/settle-safe-json.test.mjs` | 0 | ✅ ALL PASS (15) |
| ✅ | `kasia-console/src/services/proto-driver.test.mjs` | 0 | 8 passed, 0 failed |
| ✅ | `kasia-relay/src/lib/cltv-locktime.test.mjs` | 0 | cltv-locktime: 17 PASS / 0 FAIL |
| ✅ | `kasia-relay/src/lib/covenant-broadcast-relay.test.mjs` | 0 | 22 passed, 0 failed |
| ✅ | `kasia-relay/src/lib/covenant-broadcast.test.mjs` | 0 | 56 passed, 0 failed |
| ✅ | `kasia-relay/src/lib/covenant-roundtrip.test.mjs` | 0 |   ❌ harness-flip (expect FAIL) |
| ✅ | `kasia-relay/src/lib/recovery-lock-builder.test.mjs` | 0 | recovery-lock-builder: 16 PASS / 0 FAIL |
| ✅ | `kasia-relay/src/lib/serialize-roundtrip.test.mjs` | 0 |   ❌ harness-flip (expect FAIL) |
| ⚠️ | `kasia-relay/src/lib/tx-mass-ub.test.mjs` | 1 | [mass-floor:observe:auth] site=V10a txid=f672fdec8f9f4cf72fb69cf7eb1965e776ea3a8188875d7630c24d4794f0e494 source=reject authoritative_mass=null ub_ok=inconclusi |
| ✅ | `kasia-relay/src/lib/utxo-facts.test.mjs` | 0 | 42 passed, 0 failed |
| ⚠️ | `kasia-relay/src/lib/wallet.test.mjs` | 3221226505 | Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76 |
| ✅ | `kasia-relay/src/drain-finality-safe-blocks.test.mjs` | 0 | [drain-finality-safe-blocks.test] ALL PASS |
| ✅ | `kasia-relay/test/getblockatdaa-boundary.test.mjs` | 0 | === boundary 测: 10 PASS / 0 FAIL === |
| ✅ | `scripts/m0a-lint.test.mjs` | 0 | [m0a-lint.test] 32 passed, 0 failed |

### 两个标 ⚠️ 的文件——不是候选引入的，证据如下
两个都在 `kasia-relay/` 下，而**候选没有改任何 relay 文件**（`git diff --stat 主线 候选 -- kasia-relay` 为空）。用同一个脚本 `rerun-abnormal.mjs` 分别对候选与**主线基线**（生产检出，HEAD = 主线 `bda17ee0`，不在 `scratch/` 下，只读运行，这些测试无文件写入）各跑一遍（`rerun-candidate/`、`rerun-baseline-main/`）：

| 测试 | 候选（在 `scratch/` 下） | 主线基线（不在 `scratch/` 下） | 结论 |
|---|---|---|---|
| `wallet.test.mjs` | 打印 `[wallet.test] ALL PASS` 之后被 Windows libuv 退出断言（`async.c:76`）带崩，exit 3221226505 | **完全相同** | 既有的 Windows 退出崩溃，与候选无关；通过行在崩溃之前 |
| `tx-mass-ub.test.mjs` | 34 PASS / **1 FAIL**：`P-src 夹具来源自检… 夹具路径不得指向 scratch` | **35 PASS / 0 FAIL** | 该自检禁止仓库路径含 `scratch` 段，而候选 worktree 恰在 `scratch/` 下——**位置造成的**；其余 34 项同样通过 |

**没有做到的**：没有把候选放到 `scratch/` 之外原样跑一遍 `tx-mass-ub`（那需要另一份带 node_modules 的检出，而本轮不做 npm install、也不得 junction 活 node_modules）。这一项靠"relay 目录候选与主线零差异 + 基线 35/0 + 失败文本恰是路径自检"推得，是推断不是直接实测。

## 第一轮运行的 5 个异常与我的两处失误（如实留档）
第一轮我在候选的第一个版本（`9d883498`）上跑全量，出现 5 个"异常"，成因分别是：
- `broadcaster-utxo.test.mjs`（exit 1，`TypeError: mock.module is not a function`）：该测试头注要求 `node --experimental-test-module-mocks --test`，**是我的运行器没带 flag**。
- `drain-finality-safe-blocks.test.mjs`（exit 1，`KASPA_NETWORK not set`）：`rpc-listener` 顶层读该环境变量，**是我的运行器没设**（该测试头注没写这个前提，实际需要）。
- `serialize-roundtrip.test.mjs`（exit 3221226505）：libuv 退出断言，**间歇性**——同一个测试在第二轮运行中 exit 0（本文件所在的全量重跑亦通过）。
- `wallet` 与 `tx-mass-ub`：同上表。
运行器已修（给这两个测试带上各自要求的 flag / 环境变量）后，在最终候选头上把全量重跑了一遍，即上面的表。**失误一**：我修运行器后用 `rm -rf` 清掉了第一轮的原始输出目录，本该留档而不是替换，已无法恢复、也从未提交；上面的成因与退出码是按当时的运行记录写的。**失误二**：我没有让运行器对这两个测试预先带上它们的必要调用方式就宣布"全量已跑"，所以第一轮的 5 个异常里有 2 个是我制造的假异常。

## lint
`lint-kanet.txt`：对候选相对主线的全部 `.js/.mjs` 文件加我的 3 个脚本共 17 个文件，**0 errors**，536 条 warning。其中相对主线基线**新增**的是 2 条 `R-BYTE-CENSUS-PREDICATE`（`proto-claim-draw.test.mjs:163` 与 `proto-tx-assembly-settlement.test.mjs:318`）：都是测试里 `decodeInt` 辅助函数的 `buf[0] === 0x81`（脚本数字里 −1 的标准编码），是启发式规则的近似误报，在批 6 提交 `38e73130` 就已存在、不是合并带来的，非阻塞、我没有改动。其余 warning 为既有（`R-COMMAND-REGISTRATION` 3 条 `chain_get_*` 半截注册、`R-LEDGER-SIZE`、`R-DOC-STATUS` 530 条）。

## 没做 / 未证
- 没有起 simnet（不需要：本候选无新代码，批 6–8 的 simnet 证据在账本 1519–1525 已有）；没有重审批 6–8 的字节层（按 Bettor 裁定）。
- 测试通过 ≠ 行为在真实节点上正确——这份证据只证明"合入没有破坏任何既有测试、没有接线、没有 env / DB 改动、fee cap 与账本一致"。
- `.gitignore` 的 `*.log` 会静默吞日志，本目录全部用 `.txt`；`git ls-tree` 对过。
