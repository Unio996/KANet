# M0a repo-wide differential lint 卡点 · 设计稿 v0.2

> **Status**: CURRENT（v0.2，NWT MUST-FIX+三裁定已收敛，待实现批）

- **作者**: KANet-UI（执行第一波派工 #voxgak，2026-07-22）
- **审链**: v0.1（`c5992005`）→ NWT 红队 GREEN-with-1-MUST-FIX+三裁定（`docs/2026-07-22-NWT-redteam-m0a-lint-design.md`，`8c7870bb`）→ 本 v0.2 收敛。实现批 diff NWT 再审。
- **依据**: 模块化路线图 v0.4.2（`docs/2026-07-22-kanet-base-modularization-roadmap-v0.2.md` §M0a，Codex MF3 + Owner 执行注记）
- **范围**: 只设计不落码（lint 工具代码算执行代码，实现走 design→NWT→code→diff 审完整链）

---

## 0. v0.1→v0.2 变更记录（NWT verdict 逐条收敛）

| 来源 | 变更 |
|---|---|
| **MUST-FIX**（count-balance 漏报：form 塌缩实测 116 处同 form，删真+加假在 count 维度与纯移动同形；跨 commit 燃尽银行 headroom） | §3 身份模型整体重构：放弃"全仓标量多重集"，改 **path 参与身份 + git rename 检测保身份延续 + baseline 精确镜像（exact equality）**。NWT 首选修法采纳并收紧（连次选的"减必落账"也并入）。 |
| 裁定①（测试摩擦） | §5 manifest 增 `self-serve:readonly-test` 自助只读测试道（静态可核约束替代人审，显式登记不塌目录豁免） |
| 裁定②（注释剥离） | 行首启发维持；新增 §8"已知残留/不承诺覆盖"节（动态/拼接 require 明示不覆盖，不上 AST） |
| 裁定③（shadow-module） | R-M0A-SHADOW-MODULE 首批带上（§6.1），并明确它与 MUST-FIX 是不同攻击面、不互替 |

## 1. 目标与五点需求（照抄路线图，防走样）

1. 枚举当前全部裸 `sqlite`/`relay-manager` import 为**不可变 baseline**；
2. 任何**新增 import 文件或新增 import occurrence 一律拒绝**，除非在显式、经审的 allowlist；
3. 每条 baseline 例外挂**应用属主 + 燃尽里程碑**；
4. **改名/移动保持例外身份不清零**——不许 M2a 纯移动批产生大规模误报（Owner 执行注记）；
5. ops 只读脚本例外走**显式 manifest + 静态限制**，不靠目录命名。

> **对④"内容指纹锚定非路径锚定"的 v0.2 说明**：路线图④的字面写法是 v0.1 采纳的纯内容锚定；NWT MUST-FIX 用实测（单 form 116 处塌缩）证明**纯内容锚定在本仓现实下不可靠**（删真+加假与纯移动同形）。④的**实质需求**是两条：移动不清零豁免身份 + 移动零误报。v0.2 用 git rename 检测满足这两条实质需求，path 重新参与身份（NWT："path 身份在 form 塌缩的现实下是承重的，不能降级"）。此偏离已经 NWT 红队裁定背书，实现批 diff 审时 Bettor/Owner 可再核这条口径。

配套约束：豁免燃尽三钉（NWT）——(a) 每条豁免挂批次燃尽；(b) 连续两周零净减少升级阻塞（Bettor 周检）；(c) 全量文件路径清单公开入库。

## 2. 地面盘点(2026-07-22 实测，git-tracked `*.js/*.mjs/*.cjs`)

- 裸 sqlite：`require\(['"]better-sqlite3` / `from ['"]better-sqlite3` → **166 文件 / 166 occurrence**。
- 裸 relay-manager：`require\(['"][^'"]*relay-manager` / `from ['"][^'"]*relay-manager` → **35 文件 / 37 occurrence**。
- form 塌缩度（NWT 实测补充，v0.2 身份模型的决定性输入）：`import Database from better-sqlite3` 116 处 / `const Database=require(better-sqlite3)` 26 处 / `import Db from better-sqlite3` 21 处——**form 高度碰撞，不能当身份用**。

分布：kasia-console 132（scripts 108 / test-framework 10 / test 7 / src 7，src 内唯一非测试 = 仓储层入口 `kasia-console/src/db/client.js` 本体）+ 根 scripts 20 + 嵌套陈旧副本 `kanet-tn12/` 8 + tg-bot 5 + kas-market-maker 1。relay-manager 集中 `src/services` 16 + `src/api` 9 + `src/lib` 3。

说明两点：v0.1 路线图盘点 125/41 与本次 166/35 差异 = 统计口径，**以枚举正则为规范定义，binding 数字实现批生成时以当时 HEAD 为准**；git 内嵌套 `kanet-tn12/` 陈旧副本（44 tracked 文件含 12 裸 import）污染 baseline → **独立卫生卡**（确认零引用后删除），baseline 如实收录、burn_down 标 `hygiene-card`。

## 3. 核心设计 v0.2：path 键 occurrence 镜像 + git rename 身份延续

### 3.1 排除的方案（含 v0.1 自己的）

- **纯路径规则**（目录白名单）：对存量主体零覆盖，形同虚设（路线图原文，pass）。
- **纯整行哈希**：form 高度碰撞，同 3.2 塌缩问题。
- **v0.1 全仓标量多重集 count**：被 NWT MUST-FIX 打穿——(i) 跨 commit：合法燃尽不落账 = 冻结 baseline 银行 headroom，后续任意新文件抄同 form 行零报警；(ii) 根因是标量 count 无法区分"移动 A→B"与"删 A 加无关 B"。**废弃**。
- 注意 v0.1 的一个正确遗产保留：**relay-manager 相对 specifier 归 basename**（`'../lib/relay-manager.js'`→`relay-manager.js`）仍用于 form 记录与 manifest/shadow-module 检查——但 form 只做**辅助属性**，不再做身份。

### 3.2 采用：baseline = 逐 occurrence 的 (path, form, count) 精确镜像

**baseline 条目粒度 = 文件级**：`{path, form, count_in_file}`（同文件同 form 多处合并计数）。**判定 = 精确相等（exact equality）**：对扫描集内每个文件，staged 内容的 occurrence 集合必须与 `baseline[path] ∪ manifest[path]` **完全一致**，任何方向的偏差都是 ERROR，修复动作全部机械化：

| staged 现状 vs baseline+manifest | 判定 | 修复动作 |
|---|---|---|
| 新文件带裸 import（A，无 baseline/manifest 条目） | **ERROR（新增即败）** | 走 manifest 经审，或删 import |
| 既有文件多出 occurrence（count_in_file 超） | **ERROR** | 同上 |
| **git rename 对（R，`git diff --cached -M --name-status`）** | 身份延续：baseline[旧 path] 视同适用新 path，**但同 commit 必须 stage baseline 路径刷新**（`gen --refresh-paths` 自动按 rename map 重写，owner/burn_down 元数据随行携带），否则 ERROR + 提示命令 | 一条命令，diff = 纯 path 改写，count/form 零变化，lint 自动核验（§4） |
| occurrence 减少（燃尽） | **ERROR（除非同 commit stage 了 `gen --prune` 收缩）** | 一条命令落账，燃尽即时入账 |
| 无变化 | PASS | — |

**为什么这个模型同时闭合 NWT 两个漏报面**：

- **同 commit 删真+加假**：加的那个文件 path 不在 baseline → ERROR，与全局 count 无关（path 键根治）。
- **跨 commit headroom 银行**：燃尽必须同 commit prune 落账（NWT 次选并入）——baseline 永远是现实的精确镜像，不存在"额度"概念，自然无 headroom 可积。"事后往燃尽过的文件重新加回"也会撞精确镜像（baseline 该条已 prune 掉）→ ERROR。
- **移动/改名零误报**（Owner 注记）：git `-M` 相似度匹配天然吸收相对前缀改写等小改；M2a 批量移动 = 一次 `--refresh-paths`，产出纯 path 改写 diff，人审成本 ≈ 零（lint 已机器核验 path 改写与 rename map 一一对应、count/form 不变）。
- **git 不会把语义无关的两个 blob 配成 rename**（NWT 论证）——身份延续只发给真移动。

### 3.3 rename 检测的边界情况（实现批必须处理）

- **移动+同 commit 内容小改**：`-M` 默认 50% 相似度阈值内仍报 R，身份延续；若同时新增了 occurrence，精确镜像照样抓（count_in_file 对不上）。
- **移动逃过 -M 阈值（大改+移动同 commit）**：降级为 D+A → A 撞新增即败。这是**有意的 fail-closed**：大改到 git 都认不出的"移动"，本就该走 manifest/经审通道重新确权，不给静默延续。写进负向测试。
- **分两个 commit 的移动**（commit1 删、commit2 加）：commit1 强制 prune 落账、commit2 撞新增即败——同样 fail-closed，教育成本用报错信息里的"纯移动请在单 commit 内完成（git mv）"提示吸收。
- copy（C 状态）：不给身份延续（copy = 新增第二处），撞新增即败。

## 4. baseline 文件与编辑守卫

- 路径：`scripts/m0a-bare-import-baseline.json`（入 git，= 三钉(c) 载体——path 键模型下"全量文件路径清单"直接就是 baseline 本体，比 v0.1 的 informational snapshot 更强）。
- 条目 schema：

```json
{
  "generated_at_head": "<git HEAD sha>",
  "entries": [
    { "path": "kasia-console/scripts/xxx.mjs", "family": "sqlite",
      "form": "import Database from better-sqlite3", "count": 1,
      "owner": "operator-ops", "burn_down": "M5-manifest化" }
  ]
}
```

- owner/burn_down 按组件归属映射生成（exchange→M2 / prediction→M4 / ops-scripts→M5 前迁 manifest / 嵌套副本→hygiene-card），映射表在生成器显式维护。
- 工具三模式：`gen-m0a-baseline.mjs`（首次全量）/ `--refresh-paths`（按 staged rename map 纯 path 改写）/ `--prune`（按 staged 删除收缩）/ `--report`（周检摘要，见 §7）。
- **R-M0A-BASELINE-EDIT-GUARD [ERROR]**（v0.1 shrink-only 升级版）：staged baseline vs `git show HEAD:` 逐条 diff，合法编辑只有三种——(a) 条目删除/count 减少；(b) path 改写且与 `git diff --cached -M --name-status` 的 R 对一一对应（form/count/owner/burn_down 不变）；(c) 无编辑。**任何 count 增加或新条目 = 硬拒，增长唯一通道 = manifest**。堵"顺手把 baseline+1"和"伪造 path 改写洗身份"两条门。

## 5. manifest 设计（冻结后新增的唯一通道）

- 路径：`scripts/m0a-exception-manifest.json`（入 git），path 锚定（有意与 baseline 的 rename-following 不同：manifest 服务低流动、逐个确权的新文件；文件移动必须同步改 manifest，否则精确镜像对不上 → fail-closed 非静默）。
- 条目 schema（缺任一 = R-M0A-MANIFEST-SCHEMA [ERROR]）：`{id, family, form, path, capability, justification, review_ref}`。
- **capability 与静态限制（lint 强制）**：
  - `db-readonly`（ops 诊断工具）：每个 `new Database(...)` 必须带 `readonly: true`（静态正则核）+ 该文件禁 relay-manager import。违者 R-M0A-OPS-NOT-READONLY [ERROR]。review_ref = 人审锚（频道 txid / ledger）。
  - `test-fixture`（**裁定①新增自助道**）：静态限制 = 文件位于 `test-framework/` 或匹配 `*.test.*` **且** 每个 `new Database` 带 `readonly: true`——三条全静态可核时，review_ref 允许填 **`self-serve:readonly-test`** 免等人批（静态可核约束本身就是审查；manifest 条目仍必须存在 = 显式登记，不塌成目录豁免）。**非只读测试连接照旧走人审 review_ref**——摩擦落在"真要写连生产库的测试"上，正是该有摩擦的地方。
  - **relay-manager 族不开任何 ops/test capability**：新增 relay-manager import 一律正规审批走仓储层/API。
- 不设目录豁免（规则 58）。

## 6. lint 集成

### 6.1 规则清单（全 ERROR 级——止血门，warn 级 = 没门）

| 规则 | 内容 |
|---|---|
| R-M0A-BARE-IMPORT-DIFF | §3.2 精确镜像判定 + rename 身份延续（全局规则每次必跑） |
| R-M0A-BASELINE-EDIT-GUARD | §4 baseline 编辑三合法形态核验 |
| R-M0A-MANIFEST-SCHEMA | §5 字段齐全性 + self-serve 条目的三条静态限制核验 |
| R-M0A-OPS-NOT-READONLY | §5 capability 静态限制 |
| R-M0A-SHADOW-MODULE | **裁定③首批带上**：禁新建与守门模块同 basename 的文件（堵 `relay-manager.js` 冒充子面）。**注意（NWT）：它不闭合 count-balance 主漏报，与 §3.2 修法是不同攻击面、不互替。** |

### 6.2 扫描集

`git ls-files -- '*.js' '*.mjs' '*.cjs'` ∪ `git diff --cached --name-only`，读 **staged/index 内容**（防 working-tree 干净 staged 藏私货）。gitignored（`scratch/`、`_*`）天然不在内——本门只守"入库"闸，不守物理运行（operator 自担，与临时脚本铁律零冲突）。全仓两族正则 + `git diff --cached -M --name-status` 实测 <1s，实现批 DoD 附计时。

### 6.3 命中正则与降噪

命中 = §2 两条正则 + `import(...)` 动态字面量形式。行首 `//`、`*` 跳过（**裁定②维持**：启发式非 AST，生成与检查同一套单源函数，两侧一致偏不产生差分噪音）。

## 7. 三钉对接

(a) baseline 逐条 `burn_down` 挂批次；(b) `--report` 输出各燃尽桶 baseline 条目数一屏摘要（精确镜像模型下 baseline 条目数 = 现实豁免数，周检数字天然真），Bettor 一条命令贴 ledger；(c) baseline 本体即全量路径清单入库。

## 8. 已知残留 / 不承诺覆盖（裁定②入档）

- **动态/拼接 require**：`require(variable)`、`require('better-sql'+'ite3')`、`await import(computed)` 正则天然抓不到，AST 也难。M0a 定位 = 入库闸的纵深一道非唯一门（M0c 运行时能力强制才是终局门），**明示不承诺覆盖，不为此上 AST**（成本不划算，NWT 裁定同意）。
- 物理运行面（scratch 脚本直连 DB）不在范围（§6.2）。
- 注释启发式的幽灵 occurrence 残留：单源一致偏，无差分噪音。

## 9. 负向测试清单（实现批 DoD，缺一不收）

1. 新文件加裸 sqlite import（逐字节抄现有行/同 form）→ ERROR；
2. 既有文件加第二处 import → ERROR；
3. 纯移动（git mv，含 relay-manager 相对前缀改写）+ 同 commit `--refresh-paths` → PASS 零报；
4. 纯移动**不带** baseline 刷新 → ERROR + 提示命令；
5. **删一处旧 + 加一处新文件裸 import，净 count 不变 → ERROR**（NWT MUST-FIX 对偶 case，v0.1 漏的那条）；
6. 删 occurrence 不带 `--prune` → ERROR；删 + prune 同 commit → PASS；
7. 移动+大改逃过 -M 阈值 → 降级 D+A 撞新增即败（fail-closed 有意行为）；
8. 手改 baseline count+1 / 伪造 path 改写（无对应 R 对）→ R-M0A-BASELINE-EDIT-GUARD ERROR；
9. manifest 登记 db-readonly 脚本（readonly:true）→ PASS；漏 readonly / 带 relay-manager import → ERROR；
10. self-serve:readonly-test 条目：三静态限制全满足 → PASS；文件不在测试路径模式 / 非只读 → ERROR（自助道不适用，要人审 review_ref）；
11. 新建文件名 `relay-manager.js` 于任意路径 → R-M0A-SHADOW-MODULE ERROR;
12. 全仓 lint 计时 < 3s。

## 10. 实现批预算（诚实报）

单批：生成器（含 refresh-paths/prune/report 三模式 + rename map 处理）+ 5 条规则 + 两 JSON + 负向测试 ≈ **工具代码 350-450 行 + 测试 ~200 行**（较 v0.1 增 ~100 行，来源 = rename 检测与编辑守卫）。纯 lint 域零钱路零运行时行为。依赖：无（M0a 与 M-1 并行，路线图钉死排序）。
