# D-019 pin 修补部署执行页 v0.3（2026-09-14 · KANet-UI · Bettor 1228 预派 · 只写不执行）

> **Status: DRAFT**。权威链：`docs/2026-09-14-j2-d019-silverc-v100-migration-inventory-v0.1.md`（`051af204`，侧分支 `coord/j2-t4-genesis-compare`）+ `docs/2026-09-14-kanetui-mainnet-closezkv2-genesis-autotrigger-audit-v0.1.md`（本人 `3e749698`，确认当前无自动触发面）+ `docs/2026-09-14-kanetui-silverc-v100-versioned-copy-plan-v0.1.md`/provenance `66086cb6`（二进制已就位）。**本页只写方案，不执行**——执行门：本页 → NWT 审 → **前置条件（§0）满足** → Bettor 一声令下 → 执行。
>
> **v0.2 变更（Bettor 1230 裁定 v0.1 两处缺口）**：①三个 `ZK_*_TMPL_HASH` env **本次部署保持未设**——它们只在市场创建/`zk_handoff` 调用时读且 fail-loud，未设 = 创世路径关闭，正是 `3e749698` 无自动触发面结论要的守卫；真值等 T4 工具（J2 第 6 笔）落码、由单源产物算出后再另行决定何时写入。§2② 按此改写，v0.1 那版"取值来源待定"的分析不再是阻断本次部署的问题——**本次部署的范围缩小为只换编译器路径（`SILVERC_V100_PATH`已就位）+ 换调用点代码，不涉及给这三个新字段赋真值**。②J2 会在 5b/5c 加开机期自检 LOUD 日志（`SILVERC_V100_PATH` 已设时跑两项校验，打印 PASS/FAIL + sha256 前 16 位 + 黄金样本结果）——§2⑤ 按这行改写，**确切字符串待 Bettor 后续给出，本页先占位、字符串一到立即补**。时序提醒（基线 `relay_nodes` 按执行当天实际值记）已在 v0.1 写法里体现，本版不变。
>
> **v0.3 变更（Bettor 1234：5c 落地 `a9f2d751`，确切自检字符串给出）**：本人核实侧分支 `coord/j2-t4-genesis-compare` 当前 `docs/2026-09-14-j2-d019-silverc-v100-migration-inventory-v0.1.md` §6 原文（不是照抄 Bettor 转述——转述里"sha256 前 16 位"与该文档实际格式"前 8 位"有出入，本页以直接读到的文档原文为准，见下方精确格式引用）。§2⑤ 判据按此改写：重启后日志里 `grep -c '\[silverc-pin\] PASS'` 应为 `1`、`grep -c '\[silverc-pin\] FAIL'` 应为 `0`（Bettor 1234 给出的 grep 判据，不依赖 hex 位数这类容易转述出错的细节，本页采用这条作为主判据）。

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

### ② 三个新 env **本次部署保持未设**（v0.2 Bettor 1230 裁定，v0.1 这里原写"补三个新 env"已作废）

**键名已确认**（本人直接 `git show 051af204` 核实 diff，非转述）：`ZK_TOKEN_TMPL_HASH`/`ZK_CLAIM_TMPL_HASH`/`ZK_MARKET_SUFFIX_HASH`，均在 `api/pool.js` `_resolveZkNativeCtorExtras`（两处调用）与 `bshard-close-transport.mjs` `buildZkHandoffRequestV2` 里 fail-loud 校验（`if (!process.env.X) throw`），同 `ZK_GATE_TMPL_HASH`/`ZK_CLOSEZK_SIL_PATH` 既有纪律一致。

**本次部署不写这三行**——Bettor 1230 裁定：这三个 env 只在市场创建/`zk_handoff` 调用时读且 fail-loud，**未设 = 创世路径关闭**，这正是本人 `3e749698`（无自动触发面结论）要的守卫效果的延续，不是绕过它。真值要等 T4 单源编译对照工具（`t4-genesis-compare.mjs`/`assertGenesisTemplatesCoherent`，设计见 `e9fe9102`，落码是"J2 第 6 笔"——v0.1 这里误认作"第 5 笔"要交付，v0.2 按 1230 原话更正为第 6 笔）落码、真的跑出权威哈希值之后，**另开一次独立的报备+写入动作**，不在本次部署里顺带做。

**本次部署 ② 这一步的实际内容缩小为**：确认 `kanet.mainnet.env` 里这三行确实**不存在**（不是"忘了写"，是"确认过不该写"）——执行前跑一次 `grep -c "^ZK_TOKEN_TMPL_HASH\|^ZK_CLAIM_TMPL_HASH\|^ZK_MARKET_SUFFIX_HASH" kanet.mainnet.env`，应为 `0`，作为本次部署"创世路径确实保持关闭"这条前提的可核实证据，写进 §7 证据清单。

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
- **pin 自检 LOUD 日志（v0.3 确定，Bettor 1234·5c `a9f2d751`）**：`kasia-console/src/index.js` 在 `runMigrations()` 之后调用 `checkSilvercPinAtStartup()`（`pool-bshard-artifacts.mjs`）——`SILVERC_V100_PATH` 已设时跑 `assertSilvercV100Pinned`+`assertSilvercV100GoldenSample`，格式：
  ```
  PASS: [silverc-pin] PASS sha256=<前8位hex>... golden=<contractName> ok
  FAIL: [silverc-pin] FAIL <错误信息全文>
  未设 SILVERC_V100_PATH: 不打印任何行（不是隐藏失败——这台机器不需要这条能力）
  ```
  本次部署 `SILVERC_V100_PATH` 已在此前（`66086cb6`）就位，预期落在 PASS 分支。**判据（Bettor 1234 原话，本页采纳为主判据——不依赖 hex 位数这类容易转述出错的细节）**：重启后完整日志里 `grep -c '\[silverc-pin\] PASS'` 应恰为 `1`，`grep -c '\[silverc-pin\] FAIL'` 应为 `0`。该函数本身永不 throw（FAIL 不阻止 console 启动，见迁移盘点文档 §6 原话"真正的承重闸仍是 `compileSilV100` 内部每次真实编译前的断言"）——**这条自检是提前告警，不是安全边界本身**，即便这一项验证时因为某种原因漏看，也不代表创世路径失去防护，写这条区分是为了不让执行方误判"日志没这行=部署不安全"，两者是两回事。
- `migrate.js` 版本号确认已推进（对照③基线，`PRAGMA user_version` 或等价方式核实，具体命令按当时 `migrate.js` 实际暴露的核查方式）。
- 10 个（或按③执行时实际数字）relay 重新被 health-monitor cron 拉起，`[relay-hotwallet-monitor] started`/`[relay-health-monitor]`（或对应初始化行）均出现。
- 无 `FATAL`/`UNMET`/`MODULE_NOT_FOUND`（同既有验收惯例，≥65s 观察窗口）。
- 🔴 **v0.2 改写（因②已改为"保持未设"，原"验证三个 env 确实配对"这条不再适用，改成反方向确认）**：确认三个 `ZK_*_TMPL_HASH` 仍然是 unset（同 §2② 的 `grep -c` 核实一致，重启后再核一次防止部署过程中意外被写入），且 `3e749698` 描述的四层阻断在重启后的新进程上依然成立（尤其第②层"五个自治 cron unset"——本次部署不涉及改动 `kanet.mainnet.env` 里那五个 `*_ENABLED` 变量，理论上不受影响，但重启是状态重置点，习惯性复核一次比假设"应该没变"更可靠）。

### ⑥ 回滚
两层（同热钱包部署执行页既有的"轻/重"两级回滚模式）：
- **轻**（env 配错/新值有问题）：`kanet.mainnet.env` 把 `SILVERC_V100_PATH` 改回执行前记录的值（该行本次部署前已存在，见 provenance `66086cb6`，不是本次新写）；三个 `ZK_*_TMPL_HASH` 本次部署本来就不写（v0.2 ②），回滚层面没有这三行需要处理。重启 console。
- **重**（代码本身有问题）：`git revert`（**不强推**，Bettor 原话，留给 Bettor 决定是否/何时推），回滚合入主线的那几笔提交，重启 console。
- 两层回滚前都要先确认：回滚动作本身不会撞上 §1 提到的"当前无自动触发面"这条结论失效的场景（例如如果部署之后、发现问题之前已经有人手动创建了 zkNative 市场——这种情况回滚 env/代码不会撤销已经发生的链上动作，需要按当时实际状态单独评估，不是本页能预先写死的分支）。

### ⑦ 证据清单
落 `docs/provenance/<执行日期>-kanetui-d019-pin-deploy/`，同已有惯例（热钱包部署证据页格式）：
- 旧/新 PID、③/⑤ 两组基线数字对照表。
- `stdout`/`stderr` 独立副本（同 `docs/provenance/2026-09-14-kanetui-hotwallet-mainnet-deploy/` 的命名惯例，`console-mainnet-stdout-PID<新PID>.log`/`-stderr-...log`）。
- **三个 `ZK_*_TMPL_HASH` 保持 unset 的证据**（v0.2 改写）：部署前后各一次 `grep -c` 结果（均应为 `0`），作为"创世路径确实保持关闭"这条前提的可核实记录——不是记录"值从哪来"（本次没有值），是记录"确实没写"。
- ⑤ 验证结论逐项对照（含 pin 自检 LOUD 日志的实际截图/文本，等 v0.3 补上确切判据后按判据核对）。

## 3. 与其它待办的关系

第 2 批迁移仍等 Owner 令，跟本页无关，互不阻塞——但如果第 2 批先于本次 pin 部署执行，③ 的 `relay_nodes` 基线要按 16（不是本页写的 10）记录，执行时留意这条时序依赖。
