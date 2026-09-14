# D-019 pin 修补部署执行页 v0.1（2026-09-14 · KANet-UI · Bettor 1228 预派 · 只写不执行）

> **Status: DRAFT**。权威链：`docs/2026-09-14-j2-d019-silverc-v100-migration-inventory-v0.1.md`（`051af204`，侧分支 `coord/j2-t4-genesis-compare`）+ `docs/2026-09-14-kanetui-mainnet-closezkv2-genesis-autotrigger-audit-v0.1.md`（本人 `3e749698`，确认当前无自动触发面）+ `docs/2026-09-14-kanetui-silverc-v100-versioned-copy-plan-v0.1.md`/provenance `66086cb6`（二进制已就位）。**本页只写方案，不执行**——执行门：本页 → NWT 审 → **前置条件（§0）满足** → Bettor 一声令下 → 执行。

## 0. 前置条件（Bettor 1228 原话，本页照录为阻断条件，不代为判定是否满足）

1. **J2 第 5 笔（schema 迁移 + legacy 函数迁移）NWT GREEN**——本页写作时（2026-09-14），`coord/j2-t4-genesis-compare` 分支 HEAD 是 `051af204`（第 4 笔），"第 5 笔"尚不存在，本页无法核实其内容，§2 里凡是依赖这一笔产物的步骤均标注 🔴 待定，不是本页遗漏。
2. **该侧分支合入主线**（Bettor 执行，不是本页范围）。
3. 以上两条未满足前，本页描述的任何步骤都不能执行——这跟迁移 runbook/热钱包执行页的"执行门"是同一种纪律，不是本页新发明。

## 1. 执行前必读的两个已确认结论（避免重复调查）

- **无自动触发面**（本人 `3e749698` 独立核实）：当前主网 console 上 `ensurePayoutShardV2`/`computeCloseZkTmplAnchor`/`compileCloseZkV2Redeem`/`buildCloseZkV2GenesisFromAttestedState` 四层独立阻断，零市场、五个自治 cron 全 unset、建市场三开关全 0、admin 端点字面不可用——**本次部署过程本身不会意外触发任何创世动作**，这是执行这次部署相对安全的前提，不是本页重新论证一遍。
- **D-019 锚点二进制已就位**（本人 `66086cb6`）：`D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe`，sha256 `4378ba6557f7b7b088d6ad7a400422acb51a7ffd04f86ed974055c4177ef8643`，`kanet.mainnet.env` 已有 `SILVERC_V100_PATH` 一行（当时写入时确认零消费点，**部署后这一行会开始被真正消费**，这正是本次部署的核心变化）。

## 2. 步骤

### ① 主检出 `git pull --ff-only`
共享检出模型下，若合入发生在本地 `.git`（同 Bettor 之前的合入模式），本步骤可能同前几次部署一样发现本地已经在合入后的头上——执行时按实际 `git fetch` + `git rev-parse HEAD`/`origin/<branch>` 核实，不假设一定需要真的 pull。

### ② `kanet.mainnet.env` 补三个新 env

**键名已确认**（本人直接 `git show 051af204` 核实 diff，非转述）：
```
ZK_TOKEN_TMPL_HASH=<待定>
ZK_CLAIM_TMPL_HASH=<待定>
ZK_MARKET_SUFFIX_HASH=<待定>
```
三个键均在 `api/pool.js` `_resolveZkNativeCtorExtras`（两处调用）与 `bshard-close-transport.mjs` `buildZkHandoffRequestV2` 里 fail-loud 校验（`if (!process.env.X) throw`），同 `ZK_GATE_TMPL_HASH`/`ZK_CLOSEZK_SIL_PATH` 既有纪律一致。

🔴 **取值来源目前待定，不是本页疏漏，是真实依赖第 5 笔**：迁移盘点文档 `051af204` §3 原话"D-019 锚点摘要...本文档不重复内嵌数值"——三个值的权威来源是"用 D-019 单源编译器把 T4 相关 `.sil` 模板各编一次拿到的 `template_hash`"，而**这套编译对照工具本身**（`t4-genesis-compare.mjs`/`assertGenesisTemplatesCoherent`，设计见 `e9fe9102`）截至本页写作时**只有方案、还没有落码**——这正是 §0 第 1 项"J2 第 5 笔"要交付的东西。**执行本步骤前必须先确认**：
- 第 5 笔是否已经把三个真实哈希值以某种可核实的形式产出（例如落进一个新的 provenance 文件、或 `scripts/silverc-pin.json` 的姊妹文件）；
- 如果第 5 笔只是把"计算这三个值"的工具/schema 适配层做好、但没有替这次特定的生产部署实际跑一遍算出数字——那么执行这一步之前还需要**先手动跑一次**这套工具，拿到三个真实值，不能假设第 5 笔顺带算好了。
- **不接受用占位/全零/旧文档里黄金样本的全零 ctor 值顶替**——`scripts/silverc-pin.json` 的黄金样本 `RootClaim.sil` ctor 里这三个字段全零，那是"验证编译器能不能编"用的占位值，不是这次生产部署要用的真实值，两者用途完全不同，混用会让 genesis-mint 用错误的模板哈希烤进链上数据。

### ③ 重启前基线
| 项 | 本页写作时的已知值（执行时必须重新核实，不能直接抄本页数字） |
|---|---|
| 旧 PID | `15396`（本人核实，写作时刻） |
| relay 子进程数 | `10`（第 1 批 stress 账号，`Get-CimInstance Win32_Process -Filter "ParentProcessId=<PID>"` 核实） |
| kaspad daa | 执行时重新探针（`KASPAD_PROBE_URL=ws://127.0.0.1:17110 KASPAD_PROBE_NETWORK=mainnet node scripts/kaspad-rpc-probe.mjs --timeout-ms=8000`） |
| `relay_nodes` mainnet 计数 | `10`（本页写作时；**如果第 2 批迁移在本次部署之前已执行，这个数字会变成 16，执行时按实际情况记录，不套用本页数字**） |
| `events.hotwallet_relay_killed` 计数 | `0` |
| `migrate.js` 当前版本 | `v204`（`grep -n "// ── v" kasia-console/src/db/migrate.js | tail -1` 本页写作时核实；第 5 笔如含 schema 迁移，执行时这个基线号会更高，按实际重新核） |

### ④ 停旧起新
同既有惯例（`Get-Process -Id <PID> | Stop-Process` → `scripts/start-console-mainnet.ps1`），不重复展开机制——本次跟之前几次主网重启的操作形状一致，风险点全在②的三个 env 值是否正确，不在重启动作本身。

### ⑤ 重启后验证
- 监听 `127.0.0.1:3202` under 新 PID。
- 🔴 **"日志含 pin 自检（二进制 sha256 + 黄金样本）通过行"——本人已读 `assertSilvercV100Pinned`/`assertSilvercV100GoldenSample`（`coord/j2-t4-genesis-compare` 分支当前版本的 `pool-bshard-artifacts.mjs`）两个函数本身，目前是纯断言函数（校验不过 `throw`，校验过**没有**任何 `console.log`/`console.error` 输出）**——如果第 5 笔没有额外补一行"通过"日志，执行时可能根本看不到 Bettor 期待的这一行。执行前需要确认：第 5 笔是否新增了这行日志；如果没有，这一项验证要么改成"确认没有 pin 相关的 FATAL/throw 出现在 stderr"（反向确认，没报错=隐含通过），要么在部署前顺手加一行 `console.log`（如果加，走正常报备流程，不在部署当天临时加代码）。本页不假设一个可能不存在的日志字符串。
- `migrate.js` 版本号确认已推进（对照③基线，`PRAGMA user_version` 或等价方式核实，具体命令按当时 `migrate.js` 实际暴露的核查方式）。
- 10 个（或按③执行时实际数字）relay 重新被 health-monitor cron 拉起，`[relay-hotwallet-monitor] started`/`[relay-health-monitor]`（或对应初始化行）均出现。
- 无 `FATAL`/`UNMET`/`MODULE_NOT_FOUND`（同既有验收惯例，≥65s 观察窗口）。
- 补充一项本页新增、Bettor 原话没点名但逻辑上必须做的检查：**手动跑一次 §2 描述的三个新 env 的 fail-loud 校验路径**（不需要真的创建市场——可以是一次读代码确认 `process.env.ZK_TOKEN_TMPL_HASH` 等三行在新进程里确实读到了非空值，例如通过一个只读诊断脚本 `console.log(!!process.env.ZK_TOKEN_TMPL_HASH)` 而不是等某个真实调用点意外触发才发现漏配），因为 §1 已确认这些调用点当前不会被自动触发，**光靠"进程正常跑起来"这一件事本身证明不了三个 env 真的配对了**——env 写错/漏写不会让 console 启动失败，只会在未来某次真的创建 zkNative 市场时才报错，那时候可能已经不是"部署当天"这个容易回滚的时间点了。

### ⑥ 回滚
两层（同热钱包部署执行页既有的"轻/重"两级回滚模式）：
- **轻**（env 配错/新值有问题）：`kanet.mainnet.env` 把 `SILVERC_V100_PATH`/三个新 `ZK_*_TMPL_HASH`/`ZK_MARKET_SUFFIX_HASH` 改回执行前记录的值（或直接删掉新增的这几行，回到部署前的"零消费点、功能不启用"状态），重启 console。
- **重**（代码本身有问题）：`git revert`（**不强推**，Bettor 原话，留给 Bettor 决定是否/何时推），回滚合入主线的那几笔提交，重启 console。
- 两层回滚前都要先确认：回滚动作本身不会撞上 §1 提到的"当前无自动触发面"这条结论失效的场景（例如如果部署之后、发现问题之前已经有人手动创建了 zkNative 市场——这种情况回滚 env/代码不会撤销已经发生的链上动作，需要按当时实际状态单独评估，不是本页能预先写死的分支）。

### ⑦ 证据清单
落 `docs/provenance/<执行日期>-kanetui-d019-pin-deploy/`，同已有惯例（热钱包部署证据页格式）：
- 旧/新 PID、③/⑤ 两组基线数字对照表。
- `stdout`/`stderr` 独立副本（同 `docs/provenance/2026-09-14-kanetui-hotwallet-mainnet-deploy/` 的命名惯例，`console-mainnet-stdout-PID<新PID>.log`/`-stderr-...log`）。
- 三个新 env 的**取值来源**记录（哪个工具/哪次编译产出的、谁跑的、对应哪个 provenance）——不只记"写了什么值"，还要记"这个值是从哪来的"，因为这正是本次部署跟以往几次最大的不同点（以前写的 env 值都是地址/数字上限这类容易独立核实的公开信息，这次是编译产物哈希，独立核实的方法本身也要留档）。
- ⑤ 验证结论逐项对照。

## 3. 与其它待办的关系

第 2 批迁移仍等 Owner 令，跟本页无关，互不阻塞——但如果第 2 批先于本次 pin 部署执行，③ 的 `relay_nodes` 基线要按 16（不是本页写的 10）记录，执行时留意这条时序依赖。
