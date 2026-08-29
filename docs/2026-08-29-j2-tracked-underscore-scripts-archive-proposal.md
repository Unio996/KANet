# tracked `scripts/_*` 归档提案（284 个 · 只提案不动码 · Owner 批后执行）

> **Status**: PROPOSAL v0.1 · J2 2026-08-29 · Bettor 令（lint 存量 v7 `be6aff7d` 后续）· 数据全部由本机 `git ls-files` / `git grep` 只读得出（方法见 §4，可复跑）· 触发原因：lint v6 起无参默认范围 = git tracked 文件，`scripts/_*` 这 284 个"临时脚本"因**已入库**而进了仓级不变量（`R-EXPLORER` 存量 4 条里 1 条仍在其中）。

## §0 结论一句
**284 个全是 `.mjs`，全在 `scripts/` 顶层；274 个全仓零引用；有"引用"的 10 个里 9 个只被 baseline/报告文件提名、1 个被 `test-framework/lib/runner.mjs` 真引用。** 建议：按 §2 三档处置——真依赖 1 个留（或改名去 `_`）、baseline/报告提名 9 个随归档同 commit 减 baseline（ratchet 只准降，合法）、其余 274 个 `git rm --cached` + 物理移到 `scratch/_archive_scripts_20260829/`（gitignored，历史仍在 git 里可 `git show`）。

## §1 数据
| 维度 | 值 | 来源 |
|---|---|---|
| 总数 | **284**（`git ls-files 'scripts/_*'`）| 主分支 `6279efd2` |
| 扩展 | `.mjs` 284 / 其它 0 | |
| 前缀 | `_send-*` **236**（全部 `8fb5d0f7` 2026-04-27 一次 merge 带入）· `_bettor*` 19（05-12～05-15）· `_j1tn*` 17（05-27～05-28）· `_tmp*` 2 · `_j2*` 2 · `_shared/_probe/_phasec/_owner/_onboard/_ensure/_audit/_4a` 各 1 | `git log --diff-filter=A` |
| 全仓零引用 | **274** | §4 方法 |
| 有引用 | **10**（下表）| |
| 根目录 launcher / canonical send（CLAUDE.md 说"该留根目录"的形：`_launch_*` / `_<agent>_send.cjs`）| **tracked 0 个**——它们本就是 gitignored 未入库；本提案不涉及 | `git ls-files '_launch_*' '_*_send.cjs'` ⇒ 空 |
| lint 存量关联 | `_send-j2-take-issue2.mjs:12` 仍含 explorer 字面（`R-EXPLORER` 第 4 条；零引用；同批 `8fb5d0f7`）| v7 无参跑 |

### §1.1 有引用的 10 个（引用者全列）
| 文件 | 引用者 | 性质 |
|---|---|---|
| `scripts/_phasec_real_p2p_driver.mjs` | `kasia-console/test-framework/lib/runner.mjs` + `scripts/m0a-bare-import-baseline.json` | **真代码依赖 1 个**（runner）+ baseline 提名 |
| `scripts/_tmp-relay-spawn-via-mgr.mjs` | `scripts/m0a-bare-import-baseline.json` | baseline 提名 |
| `scripts/_j2_backfill_pool_snapshots.mjs` | `scripts/m0a-bare-import-baseline.json` | baseline 提名 |
| `scripts/_j1tn-spof-path-a-measure.mjs` | `scripts/m0a-bare-import-baseline.json` | baseline 提名 |
| `scripts/_j1tn-fire-settle-workaround.mjs` | `scripts/m0a-bare-import-baseline.json` | baseline 提名 |
| `scripts/_send-j2-sophie-usdc-rescue.mjs` | `scripts/sql-time-stringcmp-baseline.json` | baseline 提名（计数 1）|
| `scripts/_send-j2-sync.mjs` | `scripts/tmp-j2-03-report.txt` | 报告文本提名 |
| `scripts/_send-j2-changelog.mjs` | `scripts/tmp-j2-03-report.txt` | 报告文本提名 |
| `scripts/_send-j2-issue2-done.mjs` / `_send-j2-rescue-done.mjs` / `_send-nwt-bundle-channel.mjs` | （已于 v7 `be6aff7d` `git rm`，零引用）| — |
（274 个零引用文件清单：`git ls-files 'scripts/_*'` 减去上表，或 §4 脚本直接输出。）

## §2 处置三档（建议）
| 档 | 范围 | 动作 | 数 |
|---|---|---|---|
| **A 留** | `_phasec_real_p2p_driver.mjs`（`test-framework/lib/runner.mjs` 真引用）| 留；若要守"`_` = 临时"的命名纪律，改名去 `_` 并同步 runner 与 m0a baseline 的 path 键（baseline 有 rename 身份延续机制，见 lint `R-M0A-*` 注释）| 1 |
| **B 归档 + 减 baseline** | 被 `m0a-bare-import-baseline.json` / `sql-time-stringcmp-baseline.json` 提名的 7 个 + `tmp-j2-03-report.txt` 提名的 2 个 | `git rm --cached` + 物理移 `scratch/_archive_scripts_20260829/`；**同 commit** 从 baseline 删对应条目/减计数（两个 ratchet 都"只准降"⇒ 合法；`tmp-j2-03-report.txt` 是陈报告，本身也可归档）| 9 |
| **C 归档** | 其余零引用 | `git rm --cached` + 物理移 `scratch/_archive_scripts_20260829/`（含 `_send-j2-take-issue2.mjs` ⇒ `R-EXPLORER` 第 4 条自消）| 274 |
- **为什么是 `--cached` + 移而不是 `git rm`**：物理文件保留在 gitignored 归档目录，接位者要考古 `ls` 即得；git 历史仍完整（`git show 8fb5d0f7:scripts/<name>`）。
- **为什么不"修"它们**：236 个 `_send-*` 是 04-27 某次 merge 把一批一次性发送脚本整体带入；`_send-nwt-bundle-channel.mjs` 本就 parse 不了 = 从没跑过——修死脚本 = 花钱维护垃圾。
- **风险**：零（无运行时加载：`kanet-start.sh`/launcher/console/relay 都不 import `scripts/_*`，§4 (c) 核 = 仅 1 条注释提名）。唯一要跟的是 A 档 runner 引用与 B 档两份 baseline 的同步。

## §3 执行单（Owner 批后，一笔或两笔 commit，侧分支）
1. `mkdir scratch/_archive_scripts_20260829 && git ls-files 'scripts/_*' > list.txt`；从 list 剔除 A 档 1 个。
2. `while read f; do git rm --cached -q -- "$f"; mv "$f" scratch/_archive_scripts_20260829/; done < list.txt`。
3. 编辑 `scripts/m0a-bare-import-baseline.json`（删 6 条 path 键）、`scripts/sql-time-stringcmp-baseline.json`（删 `_send-j2-sophie-usdc-rescue.mjs: 1`，total −1）；`tmp-j2-03-report.txt` 一并归档。
4. `node scripts/lint-kanet.mjs`（无参）：期望 `R-EXPLORER` 存量再 −1、`R-M0A-*`/`R-SQL-TIME` 因 baseline 降不报升额；`R-LEGACY`/其它不变。
5. `cd kasia-console && node test-framework/...`：只跑 runner 相关 case 确认 A 档路径仍通（runner 只 import 那一个）。
6. commit 说明"临时脚本铁律：一次性脚本不入库（Owner 2026-06-27）；历史见 `git show 8fb5d0f7`"。

## §4 引用检查方法（可复跑）
```
# (a) 清单
git ls-files 'scripts/_*' > /tmp/us.txt
# (b) 每文件: 代码类引用 (排除 scripts/_* 自身与 .md) / 文档引用
while read f; do b=$(basename "$f"); c=$(git grep -l -F "$b" -- ':!scripts/_*' ':!*.md' | wc -l); d=$(git grep -l -F "$b" -- '*.md' | wc -l); echo "code=$c doc=$d $f"; done < /tmp/us.txt | sort -rn
# (c) 运行时加载面 (启动脚本/launcher/console 是否 import scripts/_*)
git grep -n "scripts/_" -- kanet-start.sh kanet-stop.sh kasia-console/src kasia-relay/src '*.ps1' '*.sh' | grep -v "^scripts/"
```
（b）用 basename 字面匹配 = 宁可多算不漏算（同名子串会计入）；(c) 2026-08-29 实跑 = **1 命中，且是注释**：`kasia-console/src/services/trade-protocol-filter.js:881` 注释提到 `scripts/_j2tn_backfill_snapshot_v2.mjs`（operator 手工回填提示；该文件**不在** tracked 284 内，是 gitignored 本地脚本）⇒ 运行时 import/加载 = **0**。
