# M0a repo-wide differential lint 卡点 · 设计稿 v0.1

> **Status**: CURRENT（DRAFT v0.1，待 NWT 审）

- **作者**: KANet-UI（执行第一波派工 #voxgak，2026-07-22）
- **依据**: 模块化路线图 v0.4.2（`docs/2026-07-22-kanet-base-modularization-roadmap-v0.2.md` §M0a，Codex MF3 + Owner 无保留全采 + Owner 执行注记"lint 设计稿必须写清 content-anchored 防 M2a 移动误报"）
- **范围**: 只设计不落码（Owner 注记: lint 工具代码本身算执行代码，实现走 design→NWT→code→diff 审完整链，本稿即 design 步）

---

## 1. 目标与五点需求（照抄路线图，防走样）

M0a = 全仓差分门，替代"路径规则"（路径规则对 `src/services/`、`src/api/`、index.js 等存量主体零覆盖 = 形同虚设）：

1. 枚举当前全部裸 `sqlite`/`relay-manager` import 为**不可变 baseline**；
2. 任何**新增 import 文件或新增 import occurrence 一律拒绝**，除非在显式、经审的 allowlist；
3. 每条 baseline 例外挂**应用属主 + 燃尽里程碑**；
4. **改名/移动保持例外身份不清零**——按 import occurrence 内容指纹锚定，非文件路径锚定；
5. ops 只读脚本例外走**显式 manifest + 静态限制**，不靠目录命名。

配套约束：豁免燃尽三钉（NWT）——(a) 每条豁免挂批次燃尽（M2→exchange 归零 / M4→prediction 归零 / M5→豁免表物理删除）；(b) 连续两周零净减少升级阻塞（Bettor COORD-LEDGER 周检）；(c) 豁免基线全量文件路径清单 = M0 交付物公开入库。

## 2. 地面盘点（2026-07-22 实测，git-tracked `*.js/*.mjs/*.cjs`）

枚举命令（= 实现时 baseline 生成器的规范来源，两族各一条正则）：

- 裸 sqlite：正则 `require\(['"]better-sqlite3` 或 `from ['"]better-sqlite3` → **166 文件 / 166 occurrence**（恰好每文件 1 处）。
- 裸 relay-manager：正则 `require\(['"][^'"]*relay-manager` 或 `from ['"][^'"]*relay-manager` → **35 文件 / 37 occurrence**。

分布（sqlite 族）：kasia-console 132（其中 scripts 108 / test-framework 10 / test 7 / **src 仅 7**）+ 根 scripts 20 + 嵌套 `kanet-tn12/` 陈旧副本 8 + tg-bot 5 + kas-market-maker 1。src 内 7 个中 6 个是 `*.test.mjs`，**唯一非测试 = `kasia-console/src/db/client.js`（即仓储层单一入口本体，天然合法）**。relay-manager 族集中在 `src/services` 16 + `src/api` 9 + `src/lib` 3。

两点勘误/说明：

- 路线图 v0.1 盘点写"125 文件裸连 sqlite / 41 裸连 relay-manager"，本次实测 166/35。差异来源 = 统计口径（是否含 tests/scripts/嵌套副本）。**本设计以枚举命令为规范定义，binding 数字在实现批生成 baseline 时以当时 HEAD 为准**，不追认任何口头数字。
- **发现 git 内存在嵌套陈旧副本 `kanet-tn12/`（44 个 tracked 文件，含 8 裸 sqlite + 4 裸 relay-manager）**，疑似历史误提交的整树拷贝。它会污染 baseline（占 12 条豁免额度）。处置建议：**独立卫生卡**（确认零引用后删除），不并入本批；baseline 生成时如实收录并把这 12 条的 burn_down 标 `hygiene-card`，删除时随燃尽归零。

## 3. 核心设计：occurrence 身份模型（本稿的关键决策）

### 3.1 为什么"整行文本哈希"和"文件路径"都锚不住

- **路径锚定**：M2a 纯移动批大规模改路径 → 误报海啸（Owner 注记明说，pass）。
- **朴素整行哈希**：166 处 sqlite import 几乎全是同一行字面 `const Database = require('better-sqlite3')` 的变体——指纹大量相同，**新文件抄同一行 = 指纹命中已有条目 = 假阴性放行**。指纹相同≠同一处 occurrence。
- **隐藏陷阱（本稿主动点出，请 NWT 重点打）**：relay-manager 是**相对路径 import**（`'../lib/relay-manager.js'` / `'./relay-manager.js'`）。M2a 把文件从 `src/services/x.mjs` 移到别的层级时，**相对前缀必然要改**——若指纹把完整 specifier 算进内容，纯移动批照样大规模换指纹 = 误报，Owner 注记防的坑换个面复活。

### 3.2 采用：归一化形态指纹 + 全仓多重集计数（form-fingerprint + multiset count）

**occurrence 归一化**（每个正则命中处）：

1. 提取完整 import/require 语句（单行为主；跨行 import 折叠空白后处理）；
2. **module specifier 归一到 basename**：`'../lib/relay-manager.js'` → `relay-manager.js`，`'better-sqlite3'` 不变——相对前缀不参与身份（堵 3.1 第三条）；
3. 空白折叠、引号统一，得 `form` 字符串，如 `const{Database}=require(better-sqlite3)`；
4. **身份 = (module 族, form)；数量 = 该 form 在全仓的出现总数**。

**baseline = 各 (族, form) 的 count 多重集快照**。差分判定不看路径、不看单处，而是看**全仓总量**：

| 现状 vs baseline | 判定 |
|---|---|
| 某 form 的 count > baseline count + manifest 额度 | **ERROR（新增即败）** |
| 出现 baseline 没有的新 form | **ERROR（新增即败）** |
| count 减少 | PASS（= 燃尽，鼓励；`--regen` 显式收缩 baseline 落账） |
| 纯移动/改名（count、form 全不变） | PASS（零误报） |

这套模型下：新增一处哪怕逐字节抄旧行也会把 count 顶过 baseline → 拒；移动/改名对 count 与 form 均无影响 → 放。**"改名/移动不清零、新增必被拒"两个需求同时严格满足，且不依赖任何路径信息做判定。**

### 3.3 错误信息里的路径（只作提示，不作判定）

count 超限时，报错列出"当前占该 form 的全部文件路径，其中不在 baseline 快照路径列表里的标 `← 疑似新增`"。快照路径是**辅助定位的 informational 元数据**（移动后会 stale，但 stale 只影响提示精度，不产生误报/漏报——判定只看 count）。

## 4. baseline 文件设计

- 路径：`scripts/m0a-bare-import-baseline.json`（入 git，= 三钉(c) 的"公开入库可核对清单"载体）
- 生成：`node scripts/gen-m0a-baseline.mjs`（扫描集见 §6.2；只在实现批首次生成 + 之后显式 `--regen` 收缩）
- 条目 schema：

```json
{
  "generated_at_head": "<git HEAD sha>",
  "entries": [
    {
      "family": "sqlite | relay-manager",
      "form": "<归一化 import 形态>",
      "count": 108,
      "snapshot_paths": ["kasia-console/scripts/....mjs"],
      "owners": { "kasia-console/scripts": "operator-ops", "tg-bot": "prediction-app" },
      "burn_down": { "exchange": "M2", "prediction": "M4", "ops-scripts": "M5-manifest 化", "hygiene": "hygiene-card" }
    }
  ]
}
```

- `owners`/`burn_down` 按快照路径的组件归属映射填（exchange 相关→M2、prediction 相关→M4、ops/scripts→M5 前逐步迁 manifest、嵌套副本→卫生卡），满足三钉(a) 每条有主。组件归属映射表在生成器里显式维护，生成时落进文件，人审 diff 可核。
- **shrink-only 不变量（新 lint 规则 R-M0A-BASELINE-SHRINK-ONLY [ERROR]）**：对 staged 的 baseline 文件与 `git show HEAD:` 版本比对——任何 count 增加或新 form 条目 = 硬拒。**baseline 永远只准收缩；增长的唯一合法通道是 §5 manifest**。防"顺手把 baseline 数字+1"这条最省事的绕门。

## 5. manifest 设计（冻结后新增的唯一通道，需求⑤）

- 路径：`scripts/m0a-exception-manifest.json`（入 git）
- 语义：**post-freeze 的经审新增白名单**。lint 差分判定时把 manifest 内条目的额度加到对应 (族, form) 上（§3.2 表第一行）。
- 条目 schema（五字段全必填，缺任一 = R-M0A-MANIFEST-SCHEMA [ERROR]）：

```json
{
  "id": "OPS-20260801-01",
  "family": "sqlite",
  "form": "<归一化形态>",
  "path": "scripts/diag-xxx.mjs",
  "capability": "db-readonly | test-fixture",
  "justification": "一句话用途",
  "review_ref": "频道 txid 或 ledger 锚（谁批的）"
}
```

- **manifest 条目按 path 锚定（与 baseline 相反），这是有意的**：manifest 服务的是 ops 诊断工具/测试夹具这类**低流动、逐个经审**的新文件，不在 M2a 批量移动范围内；path 锚定才能对"这一个文件"施加静态限制。若该文件移动，manifest 必须同步改（否则额度对不上 → lint 报错），**fail-closed 非静默**。
- **静态限制（capability 决定，lint 强制）**：
  - `db-readonly`：该文件内每个 `new Database(...)` 调用必须带 `readonly: true`（静态正则核）；且该文件禁出现 relay-manager import（只读诊断没有碰 relay 的理由）。违者 R-M0A-OPS-NOT-READONLY [ERROR]。
  - `test-fixture`：文件名必须匹配 `*.test.*` 或位于 `test-framework/`（文件名模式是**限制条件**之一，不是豁免依据——豁免依据是 manifest 条目本身，堵"改名成 .test.mjs 白嫖"）；且 review_ref 必填同权。
  - **relay-manager 族无 ops capability**：新增 relay-manager import 没有"只读诊断"正当性，一律走正规审批改仓储层/API，manifest 不开这个口。
- **不设目录豁免**。`scripts/` 目录身份不给任何豁免（需求⑤原文 + ANTI-PATTERNS 规则 58 黑白名单枚举教训的正面应用：豁免靠逐条显式登记，不靠命名约定）。

## 6. lint 集成

### 6.1 规则清单

| 规则 | 级别 | 内容 |
|---|---|---|
| R-M0A-BARE-IMPORT-DIFF | ERROR | §3.2 差分判定（全局规则，每次 lint 必跑，不管 argv 目标是什么——同 checkR10/manifest 系列的全局模式） |
| R-M0A-BASELINE-SHRINK-ONLY | ERROR | §4 baseline 文件只准收缩 |
| R-M0A-MANIFEST-SCHEMA | ERROR | §5 manifest 字段齐全性（对齐既有 R-MANIFEST-SCHEMA-COMPLETE 的"缺 key = 这个维度没人想过"哲学） |
| R-M0A-OPS-NOT-READONLY | ERROR | §5 capability 静态限制核验 |

全部 ERROR 级（阻塞 commit）。M0a 是止血门，warn 级 = 没门。

### 6.2 扫描集（防绕门的关键定义）

`git ls-files -- '*.js' '*.mjs' '*.cjs'` ∪ `git diff --cached --name-only`（staged 新文件）。要点：

- **不是只扫 argv 传入的 staged 文件**——差分判定需要全仓 count，R-M0A-* 作为全局规则每次跑全量。实测 git grep 全仓两条正则 <1s，pre-commit 可承受（实现批 DoD 里带计时数据）。
- 扫 **index/工作树版本**（拿 staged 内容，防"working tree 干净、staged 藏私货"）；未 tracked 未 staged 的文件不扫（反正 commit 不进去）。
- gitignored（`scratch/`、`_*` 等）天然不在 `git ls-files` 内——scratch 一次性脚本不受门限制，与"临时脚本铁律"零冲突。**但这也意味着本门只守"入库"这一道闸，不守物理运行**——scratch 里的裸 import 脚本照样能跑（operator 自担），与现状一致，不在 M0a 范围。

### 6.3 命中正则与降噪启发

- 命中 = §2 两条正则（require / from / `import(...)` 动态形式补进 alternation）。
- 行首 `//` 或 `*`（块注释体）跳过——防注释里提到模块名产生幽灵 occurrence。启发式非 AST，**生成 baseline 与差分检查用同一套函数**（单源），有偏差也两侧一致偏，不产生差分噪音。

## 7. 三钉对接

- (a)：baseline `burn_down` 字段逐条落批次（§4）。
- (b)：生成器带 `--report` 模式，输出"各燃尽桶当前 count vs baseline count"一屏摘要，Bettor 周检直接跑一条命令贴 ledger。
- (c)：baseline `snapshot_paths` = 全量文件路径清单，入库可核对。

## 8. 负向测试清单（实现批 DoD，缺一不收）

1. 新文件加裸 sqlite import（逐字节抄现有行）→ ERROR；
2. 现有文件加第二处 import（count+1）→ ERROR；
3. 纯移动带裸 import 的文件到别的目录（含 relay-manager 相对前缀改写）→ PASS 零报；
4. 改名同上 → PASS；
5. 删一处 import → PASS；
6. 手改 baseline count+1 企图混过 → R-M0A-BASELINE-SHRINK-ONLY ERROR；
7. manifest 登记 db-readonly 新诊断脚本（带 readonly:true）→ PASS；
8. 同上但漏 readonly:true / 带 relay-manager import → ERROR；
9. manifest 条目缺 review_ref → ERROR；
10. 全仓 lint 计时 < 3s（pre-commit 体感门）。

## 9. 开放问题（请 NWT 裁）

1. **新增测试文件的摩擦度**：本稿把新测试夹具也纳门（manifest `test-fixture` 通道，§5）。代价 = 每个新的直连 DB 回归测试要登记一条 manifest。备选 = 测试目录放行——但那是目录豁免（规则 58 病），我不推荐。请裁：接受摩擦（推荐）or 设更轻量通道。
2. **注释剥离深度**：§6.3 行首启发 vs 完整注释剥离。单源一致性下我判启发够用，请核。
3. **form 归一化粒度**：specifier 归 basename 后，理论上有人可建同名文件 `relay-manager.js` 于别处再 import 冒充——count 会顶超 baseline 被拒（新增必败先兜住），但若同时删旧 occurrence 则 count 平衡可混入。**残留面 = "删一处真的+加一处假的"**，需要配 R-M0A-SHADOW-MODULE（禁止新建与守门模块同 basename 的文件，ERROR）补丁规则，已纳入 §6.1 之外的候补，请裁是否首批带上（我倾向带，+15 行）。

## 10. 实现批预算（诚实报）

单批：生成器 + 4(+1) 条规则 + baseline/manifest 两 JSON + 负向测试 ≈ **工具代码 250-350 行 + 测试 ~150 行**，纯 lint 域零钱路零运行时行为，diff 审一轮可收。依赖：无（不等 M-1 清单；M0a 与 M-1 并行是路线图钉死的排序）。
