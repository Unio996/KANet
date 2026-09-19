> **Status**: CURRENT（2026-09-20，J2；9-1 首批 **A 笔**：NWT 合入审的三条 SHOULD（S1 / S2 / S3）的落码证据；基线 = 主线 `c8089747`，分支 `coord/j2-batch9-1-code-v0`）

# 9-1 首批 A 笔：NWT 三条 SHOULD

只动测试与一处注释，**没有任何生产逻辑改动**。

| 项 | 改动 | 文件 |
|---|---|---|
| **S1** 钉六个 cap 字面值 | 新增测试：经生产读取函数 `loadFeeProfileCap` 断言六个 cap 的字面值（独立来源 = 测试里写死的常量），另断言六个键都存在、每个带非空 `_source`、都不超过全局硬顶 1.0 KAS、未知 kind 抛错 | 新 `kasia-console/src/lib/proto-fee-profile-caps.test.mjs`（10 项） |
| **S2** 过期注释 | `proto-tx-assembly-settlement.mjs:889` 的 `feeProfile.withdraw.cap(暂借占位, 待NWT推数)` 改为"NWT 按 F3' 推的专属值 55,000,000，来源见 anchors JSON 的 `_source`，字面值由 `proto-fee-profile-caps.test.mjs` 钉死"。**只改 :889**（Bettor 确认）；:1048 的 ticket_reclaim 占位注释仍有效，**未动** | `proto-tx-assembly-settlement.mjs`（+1/−1，仅注释） |
| **S3** 测试前提 fail-loud | 两个测试自己检查前提，缺前提就说明"缺什么、正确怎么跑"并 `exit 1`：`drain-finality-safe-blocks.test.mjs` 需 `KASPA_NETWORK`（头注也补上）、`broadcaster-utxo.test.mjs` 需 `--experimental-test-module-mocks`（检查放在建临时目录/跑迁移**之前**，缺前提时无副作用） | 两个测试文件 |

## 变异对照与原始输出（`mutation-a-raw.txt`，脚本 `mutate-a.mjs`，每次 finally 还原并核 sha256）
- **S1**：对六个 cap 各做 +1 sompi 与 −1 sompi（12 个）、withdraw 超全局硬顶、删 `close_commit._source`、删 `claim_draw` 整个条目——**16 个变异全部变红**（各 1–3 条 FAIL）；基线 10/0；anchors JSON 已还原且 sha256 一致。
- **S3（Bettor 要求真做一次贴原始输出）**，每个测试三种情形：① 缺前提 + 有检查 ⇒ 明确的"前提不满足"说明（缺什么 + 正确运行命令）、exit 1；② 缺前提 + **去掉检查块（变异）** ⇒ 退回泛泛/裸异常——`drain-finality`：`Error: KASPA_NETWORK not set or unknown: undefined …`（来自 `shared/lib/kaspa-network.mjs`），`broadcaster-utxo`：`TypeError: mock.module is not a function`——**证明明确说明确实是这段检查产生的，不是靠原有的裸异常**；③ 前提满足 ⇒ 正常通过（drain `ALL PASS`、broadcaster 14/14）。两个测试文件均已还原、sha256 一致。

## 相关既有测试回归（`test-outputs/`，仅把本机临时目录前缀替换为 `%TEMP%`，D-021）
`proto-fee-profile-caps` 10 passed, 0 failed｜`proto-tx-assembly-settlement` 43 passed, 0 failed（注释改动后回归）｜`broadcaster-utxo` 14/14（带 flag）｜`drain-finality-safe-blocks` `ALL PASS`（带 `KASPA_NETWORK=simnet`）。lint：5 个文件 0 errors（`lint-kanet.txt`）。

## 超出设计文字 / 需要 NWT 知道的取舍
1. `drain-finality-safe-blocks.test.mjs` 把**静态 import 改成了动态 import**：静态 import 会被提升到检查之前，前提不满足时 `rpc-listener` 的顶层 throw 会先抛出泛泛的错，检查就没有机会执行。这是让 fail-loud 成立的必要结构改动，测试体本身未动。
2. 两个检查块用 `⟦PREREQ-CHECK-BEGIN/END⟧` 注释标出，**是永久保留的代码注释**——变异脚本靠它精确摘掉检查块；不影响运行。
3. `proto-fee-profile-caps.test.mjs` 需要先设临时 `DB_PATH` 再动态 import `proto-covenant-builder`（它经 `db/client.js` 受 M0a 约束，拒绝默认连活库），结束时清理临时目录。
4. 变异 ②（去掉检查）跑 `broadcaster-utxo` 时，因检查被摘掉，测试会先建临时目录并跑迁移再在 `mock.module` 处崩，**每次会在 `%TEMP%` 留下一个 `kanetui-broadcaster-utxo-test-*` 临时目录**（无害、非仓内、未清理）。
5. 本笔的证据文本里一度残留本机账户名路径：我第一次用 heredoc 里的 node 脚本脱敏，反斜杠被工具层吃掉导致**没有匹配上**（与上一批同一个坑）；靠自检的"残留数 3"发现，改用 Write 工具落盘的脚本重做，固定字符串 grep 复核残留 0。
