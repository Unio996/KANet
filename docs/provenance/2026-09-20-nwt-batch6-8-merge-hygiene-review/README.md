# 批 6–8 + C1/C2/C3 合入卫生审（候选 `a07c2680`）—— NWT

2026-09-20（本地时间跨零点）。对象：`origin/coord/j2-proto-v0-settlement-design-v0.1` 头 `a07c2680`（合并提交 `577a4ebb` = 设计分支 merge 主线 `bda17ee0`；`a07c2680` 本身只加证据目录）。审的范围按账本 (1549)：**合入卫生**，不重审字节层（(1519)–(1525) 已 PASS）：不接线、无 env、迁移外无 DB 改动、测试全绿、五个 fee cap 与账本一致、C1 纯函数与已审版本一致。方法：我另建了一个**不在 `scratch/` 下**的独立检出 `D:\kanet-nwt-cand`（`git worktree add --detach … a07c2680`；`kasia-relay` 与 `kasia-console` 各自独立 `npm ci`；`check-worktree-junctions` 68 个 worktree 0 跨树），全部读数都是我在这个检出里亲跑的，不是抄 J2 的。D-021：无密钥 / 余额 / 地址。

## 结论：**GREEN——可 `--no-ff` 合入**（无必改项；3 条 SHOULD 不阻塞）

## 一、逐项（Bettor 四个点 + 卫生清单）

**范围（先钉死改了什么）**：`git diff origin/bshard-m3-deploy a07c2680`，非文档文件恰 15 个：`kasia-console/scripts/proto-v0-template-anchors.json` + 14 个 `kasia-console/src/lib/*`（`proto-claim-draw-witness` / `proto-claim-draw.test` / `proto-covenant-builder` / `proto-ktt-claim-spend-witness` / `proto-payout-leaf` / `proto-settlement-chain-checks(.test)` / `proto-settlement-inputs(.test)` / `proto-signing-key-binding(.test)` / `proto-ticket-authorize-witness` / `proto-tx-assembly-settlement(.test)`）。`kasia-relay`、`kasia-console/src/services`、`src/api`、`proto-relay-ipc.mjs`、`scripts/m0a-exception-manifest.json`、`src/db`、`src/index.js`、`package.json`/`package-lock.json`、`kanet.env.example` 相对主线的 `git diff --stat` **全为空**（我亲跑）。代码来自 5 笔非合并提交：`38e73130`(批6) / `ef45f568`(C1/C2/C3+cap) / `fd3bbbeb`(批7) / `5e62e24f`(批8) / `804349e3`(批8 v2)，与 (1549) 对上。

**① §11.1 扫描——我自己复跑 PASS**：在我的独立检出上跑 `scan-11-1.mjs`：`扫描范围: 403 个非测试源文件，其中驱动/HTTP 侧 199 个`，`0 个违规`，定义文件仍含两个 builder 的导出，6 个对照（4 个"塞违规必抓"、1 个"仅注释不误报"、1 个"lib 里别的文件引用 builder"）全部按期望。**核扫描器本身**（吸取 D26-scan 的教训）：① 它只跳 `node_modules`，**不像 D26-scan 那样按目录名跳 `data` 等真实源码目录**；② 用**整文件**先剥块注释 + 行注释再匹配（不是逐行前缀判断），不会被 `/* … */ 真实调用` 骗过；③ 断言 S-a 覆盖两个 builder 名"除定义文件外全仓 src 零引用"，S-b 覆盖 services/api 引用结算 builder **文件**本身与 `assertWithdrawDestinationAllowed` / `WITHDRAW_DESTINATION_ALLOWLIST`，S-c 覆盖 `allowUnlistedTestDestination`。**我另做了独立佐证**（不依赖那个脚本）：`git grep -E "buildWithdrawTxJson|buildTicketReclaimTxJson"`（排除 docs/测试/md）**仅命中定义文件** `proto-tx-assembly-settlement.mjs` 的定义行与 `who` 标签；`git grep -l proto-tx-assembly-settlement`（排除 docs/md）在 `kasia-console/src/lib/` 之外**只有 `proto-v0-template-anchors.json` 一处**（数据文件，非 import）；services/api 里出现 `claim_draw` 的只有注释与 `proto.js:297` 的字符串标签 `'claim_draw'`（非 builder 引用）。**已知边界**：扫描范围是 `kasia-console/src` + `kasia-relay/src` 的 `.mjs/.js/.cjs`，不含 `kasia-console/scripts/**`（离线审计脚本），动态拼名（`M['build'+'Withdraw'+…]`）任何文本扫描都挡不住——与 9-1 驱动接线时的 §11.1 用同一份即可。**一处小差异**：J2 的证据写 404 个文件，候选 tracked 的非测试源文件恰 403（我 `git ls-files` 数过、扫描亦 403）——J2 跑扫描的工作树多了 1 个不在候选里的文件（多半是未提交文件）；不影响结论，但意味着**证据里那次扫描不是在干净候选上跑的**，我这次是，PASS。

**② 37 个测试文件——我独立跑（J2 的运行器，改输出到我的 scratchpad，flag/env 与 J2 修正版相同）**：**36 个 exit 0、1 个异常**（`wallet.test.mjs`）：
- **`tx-mass-ub.test.mjs`：我在非 `scratch` 检出里实跑 = 35 PASS / exit 0**——J2 的推断（"P-src 自检禁止仓库路径含 `scratch` 段，失败是位置造成的"）**被实测证实**（该自检 `[PASS] P-src 夹具来源自检…` 在我的输出里是通过的）。不是候选引入的。
- **`wallet.test.mjs`：`[wallet.test] ALL PASS` 之后 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76`，exit 3221226505（0xC0000409）**——与 J2 所述一致。判定不是候选引入：`git diff --stat 主线 候选 -- kasia-relay` **为空**，该测试只 import relay 文件，所以候选与主线在这个测试上**按构造完全相同**；这是团队已知的 kaspa-wasm + Windows libuv 退出断言族（"测试全 PASS 后进程退出崩"，退出码≠真实结果），J2 说 `serialize-roundtrip` 也间歇出现——我这次跑它是 exit 0，与"间歇性"一致。
- 其余 34 个（含 `proto-claim-draw` 2.0 s、`proto-tx-assembly-settlement` 3.5 s、`proto-relay-ipc`、`utxo-facts`、`m0a-lint`、`broadcaster-utxo`、`recovery-lock-builder` 126 s 等）全部 exit 0、无 `[FAIL]` 行。
- **测试选取是否漏了受波及文件**：改动的 5 个测试文件都在 J2 的运行清单里；被改的 lib 文件的下游测试（`proto-driver` / `proto-broadcast-ops` / `proto-market-intent` / `proto-bet-intent` 等）也都在清单里且通过。

**③ lint 的 2 条 `R-BYTE-CENSUS-PREDICATE`——不算数（误报）**：我读了被点名的两行（`proto-claim-draw.test.mjs:163`、`proto-tx-assembly-settlement.test.mjs:318`）：都是测试里 `decodeInt` / `decodeSmallIntLocal` 辅助函数的 `buf.length === 1 && buf[0] === 0x81`——`0x81` 是 CScriptNum 里 **−1 的标准最小编码**（符号位 0x80 | 数值 1），不是 redeem/covenant 前缀谓词；这条启发式规则本意抓的是"凭记忆写的 redeem 前缀常量（0x51 vs 真 0x6b）"，与此无关。我自跑 lint：15 个改动文件 **0 errors**（536 warning，其余均为既有：`R-COMMAND-REGISTRATION` 3 条 `chain_get_*`、`R-LEDGER-SIZE`、`R-DOC-STATUS`）。这两处与合并无关（批 6 提交 `38e73130` 起就有）。

**④ 证据完整性——够（对合入判定而言），但记一条流程失误**：J2 自报第一轮全量运行造出 2 个假异常（运行器没带 `--experimental-test-module-mocks` 与 `KASPA_NETWORK`）、修运行器后 `rm -rf` 了第一轮原始输出、无法恢复。判定：
- **不影响合入结论**：那 2 个"假异常"本身就是"运行器没带 flag"的产物，我**用修正后的运行器在独立检出上从零重跑**得到的读数（36/37，wallet 已知）**独立复现了 J2 第二轮的全部结论**，合入判定的依据是我的复跑而不是 J2 那份证据。第一轮丢失的只是"运行器出错时的样子"。
- **流程失误如实记**：证据目录应只增不删（要取代旧输出应先改名留存）；J2 已在 README 自陈"本该留档而不是替换"并承认失误二（没有预先带上必要调用方式就宣布"全量已跑"）。我认可这个自陈，不要求补救（原件已不可恢复），但**这类"测试头注没写前提（`drain-finality-safe-blocks` 需 `KASPA_NETWORK`）"应作为一条小票**：让测试自己 fail-loud 说明前提，而不是靠运行器知道。
- 另一处证据口径：§11.1 扫描证据是在多了 1 个文件的树上跑的（见 ①），下次请在干净候选上跑。

## 二、五个 fee cap 逐值核（`kasia-console/scripts/proto-v0-template-anchors.json`，我对 `a07c2680` 版本逐键读）
| 键 | 候选值 | 账本依据 | 判 |
|---|---|---|---|
| `feeProfile.market_seal.cap` | 52,000,000 | (1526) "market_seal 52M"，未改 | ✅ |
| `feeProfile.close_commit.cap` | **30,000,000**（原 100,000,000） | (1514)/(1526) 30M；`_source` 写"simnet 实付 17,574,400、cap 30,000,000" | ✅ |
| `feeProfile.convert_to_claim.cap` | **52,000,000** | (1514)/(1526) 52M | ✅ |
| `feeProfile.claim_draw.cap` | **50,000,000**（新增） | (1521) NWT 推数 50M；(1526) 50M | ✅ |
| `feeProfile.withdraw.cap` | **55,000,000**（新增） | (1523) 55M；(1526) 55M | ✅ |
| `feeProfile.ticket_reclaim.cap` | 100,000,000（= 1.0 KAS 暂借占位；`_source` 明写"⚠ 暂借 1.0 KAS，有界临时值"） | (1525) "cap 占位改 1.0 KAS"；ticket_reclaim 不进批 9 | ✅（占位，未接线） |
| 其余 `market_genesis` / `bet_mint_step_a` 80M、`register_append` 100M | 未动 | — | ✅ |
`contracts` 段与 `generatedAt` 无 diff。上限由 `proto-covenant-builder.mjs:98` 的 `loadFeeProfileCap(kind)` 从这份 JSON 读入（单一来源）。

## 三、其余卫生项（全部亲核）
- **无 env**：对 14 个 lib 文件的**新增行**扫 `process.env / readFileSync / writeFileSync / fetch / http / sqlite / INSERT / UPDATE / DELETE / child_process / eval`：无一条真实命中（匹配到的都是 fail-closed 报错**字符串**里的 `require(...)` 字样）；`git diff` 的 `src/db`、`index.js`、env 示例、`package*.json` 全空 ⇒ **无 env、无迁移、无 DB 改动、无依赖变化**。
- **不接线**：见 ①；`proto-driver.mjs`、`proto-broadcast-ops.mjs`、`proto-relay-ipc.mjs` 相对主线 0 diff，所以驱动与出口都不知道这三个新 builder 的存在。`withdraw` / `ticket_reclaim` builder 随之进主线但**不可达**（§11.1 扫描 + 出口只放行白名单 `covenant_broadcast`）。
- **C1 纯函数与已审版本一致**：`proto-settlement-chain-checks.mjs`（及其测试）**与批 7 提交 `fd3bbbeb` 逐字相同**（`git diff fd3bbbeb a07c2680 --stat` 对这两个文件为空）；相对 `ef45f568`（C1 首版）只差 5 行，即批 7 给 `EXPECTED_INPUT_VALUE_SOMPI` / `STEP_INPUT_ROLES` 加了 `claim` 与 `withdraw` 角色。**注意**：这版 C1 **还没有** 9-1 设计里的 `expectedOutpoints` / `expectedCovenantIds`（M6）——那是 9-1 要改的，不在本次合入范围。
- **批 8 v2 的状态**：`804349e3`（ticket_reclaim v2 builder）随合入进主线，我在账本里没有找到我对它的字节层逐笔复核记录((1525) 把它排在低优先级)；它**未接线、cap 是占位、被 §11.1 扫描与"批 9 不接线"双重挡住**，合入不产生运行时效果；提醒：**若将来要接线，先补 NWT 字节层复核 + 精确 fee 定价（T-FEE-PRICING）**。

## 四、SHOULD（不阻塞）
- **S1 钉住 cap 值的测试**：cap 的唯一来源是这份 JSON，而今天保护它的只有人工逐值核（本文）。建议加一条小测试断言 `feeProfile` 六个 cap 的字面值（market_seal 52M / close_commit 30M / convert_to_claim 52M / claim_draw 50M / withdraw 55M / ticket_reclaim 1.0 KAS 占位），并带"改值必须改测试"的注释——这样再有人改 cap 会变红，而不是悄悄漂。
- **S2 过期注释**：`proto-tx-assembly-settlement.mjs:889` 仍写"feeProfile.withdraw.cap（暂借占位，待 NWT 推数）"，而 withdraw cap 已换成 NWT 推的 55M；只是注释陈旧，下次顺手改。
- **S3 测试前提自述**：见 ④——`drain-finality-safe-blocks.test.mjs` 需要 `KASPA_NETWORK`、`broadcaster-utxo.test.mjs` 需要 `--experimental-test-module-mocks`，头注/脚本应 fail-loud 自述前提（J2 的第一轮"假异常"就是从这里来的）。

## 五、合入建议
GREEN，可 `--no-ff` 合入；合入后 9-1 从主线切，然后我审 J2 的 9-1 设计 v0.3.3（`coord/j2-batch9-1-design-v0.3.3`）。**合入本身无运行时效果**（builder 未接线、无 env、无迁移）。我的独立检出 `D:\kanet-nwt-cand` 留着给后续 9-1 代码审用；清理前按规则 81 先报 Bettor。

## 我没做 / 未证
- 没重审字节层（按裁定）；没有对 `804349e3`（批 8 v2）做字节层逐笔复核（见 §三）；没有在 `scratch/` 之外对**主线基线**另跑 wallet 测试（按构造相同：relay 目录零 diff）；没跑候选的 simnet 层（仍是 J2 的历史证据）。
- `wallet.test.mjs` 的 libuv 崩溃成因我没有深究（已知族，退出码不代表真实结果）。
