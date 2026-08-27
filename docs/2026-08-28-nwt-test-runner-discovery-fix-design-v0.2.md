# NWT — test-runner 发现盲区修法设计 v0.2（reframe：撤 Option A · 盲区已闭 · 给 Bettor 已裁）

> **Status**: CURRENT（SUPERSEDES v0.1 `269b7f1b`）
> 作者 NWT · 2026-08-28 · 派工 Bettor（B）· 承 J2 `docs/2026-07-28-test-runner-discovery-and-real-chain-marker-design.md`（A/B 分类逐个读头）· **Bettor 裁 1（撤 Option A、保 *.test.mjs）已定** · 零落码（lint 规则另 commit `a53b8817`）。

## 0. 一句话（v0.1 → v0.2 的翻转）
v0.1 倾向 **案 A（glob 放宽 + 守卫）**。**v0.2 撤回它**：runner **import-to-discover**，而 18 个非-`.test.mjs` 里 **17 个是顶层自执行 standalone 脚本**（`node <file>` 跑）——**为发现而 import 它们 = 发现即执行**（g5 那次 = 真广播真花钱）。⇒ **保持 `*.test.mjs` + `export default` 约定 = 安全边界**；盲区**实际已闭**（唯一错位 fixture 已修）。

## 1. 承重实核（2026-08-28）
- **runner 发现 = import-then-check**：`scripts/test.mjs:147-148` `if (mod.default?.id) casesToRun.push(mod.default); else SKIP(no default export)`。**SKIP 在 `import()` 之后** ⇒ 无 default export 的文件被 SKIP，**但其顶层代码已在 import 时执行**。
- **17/18 非-.test.mjs = standalone 自执行脚本**（`export default`=0 + 顶层 `await`/`async` + header 写 `node <file>`）。其中 **g5-pilot-custodial-real-chain-smoke = 真链**（M0c-1 custodial_transfer 真广播 ≤2 KAS）。⇒ **import g5 去"发现" = 真花钱**。
- **唯一真 case-object 错位**：`fixture_step_ok_false_no_expect`（`export default`=1，靠 not-.test.mjs 排除、设计成永久红）——glob 放宽会把它当 case 跑而染红套件。**已 `_`前缀修（`842c8777`）**。

## 2. 8 个非-m0c1 未分类读头结论（并入分类表）
| 文件 | export default | 跑起来碰什么 | 处置 |
|---|---|---|---|
| `agent-tunnel/_smoke_pair_handshake_e2e` | 0 | 🔴 真链（real chain pair_invite 走真 relay 广播） | standalone·双守卫排除·已加 STANDALONE marker |
| `agent-tunnel/_smoke_peer_chat_signed` | 0 | 无链（合成 pair 行 + 签名 POST） | standalone 排除 |
| `agent-tunnel/_smoke_tunnel_local` | 0 | 无链（localhost 隧道） | standalone 排除 |
| `predictions/pool/shard9_phantom_exclude_regression` | 0 | 无链（stub/DB） | standalone 排除 |
| `predictions/pool/step_ok_false_hard_red_regression` | 0 | 无链（消费 `_fixture_…` via --case） | standalone 排除 |
| `predictions/pool/zk_autonomy_ticks_regression` | 0 | 无链（header "offline test"，原语引用是离线测） | standalone 排除 |
| `predictions/dm-agent/soak_runner` | 0 | 无链（24h soak，长跑）——不宜进 --all | standalone 排除 |
| `predictions/pool/fixture_step_ok_false_no_expect` | **1** | 无链，**故意坏掉 fixture、就该红** | **唯一错位 → `_`前缀修（842c8777）** |
（m0c1-gate 另 9 个见 J2 v0.1 表：g5=真链 standalone / harness=支持文件 / 余 7 隔离-安全 standalone。）

## 3. 为何【不】glob 放宽（裁 1）
- **发现即执行**：runner 靠 `import()` 认 case，import 顶层自执行脚本 = 跑其副作用。g5 = 真链 ⇒ glob 放宽发现 g5 = **无人值守真广播**。`:148` 的 SKIP 兜不住（副作用已在 import 时发生）。
- **17 个 standalone "扫不到"是【正确】的**——它们本就 `node <file>` 手动跑（gate 脚本 / soak / 消费 fixture），不是 runner case。
- ⇒ **盲区实际已闭**：唯一真 case-object 错位（fixture）已修；`*.test.mjs`+`export default` 约定是安全边界。

## 4. 若将来仍要放宽（硬约束）
必须 **STATIC 守卫（grep 文本、绝不 import 去判）**，只 import"静态看着像纯 case-object"的文件：
1. **文本含 `export default`**（grep，不 import）；
2. **跳 `_`前缀**（惯例助手/smoke/fixture）；
3. **检出顶层自执行**（`^await`/`^(async`/`import.meta.url ===`/`node <file>` header）**则不 import**——自执行脚本永远只 `node <file>`。
三者任一不满足 ⇒ 不纳入发现。**绝不 import-to-discover。**

## 5. 三守卫（现状 = 已落）
1. **`*.test.mjs` 命名约定**（runner 现状，安全边界）。
2. **`export default` = case-object**（runner `:147-148` SKIP no-default——但注意它在 import 后，故守卫真正靠 §4 的 static 检查，不能靠它挡 import 副作用）。
3. **`R-REALCHAIN-SKIP-BATCH` lint（`a53b8817`）**：case-object 真链声明缺 skip_in_batch ⇒ BLOCK；撞花钱原语无声明无隔离 ⇒ WARN；standalone 撞原语缺 STANDALONE marker ⇒ WARN。真链 standalone（g5 / _smoke_pair_handshake）已加 marker。

## 6. 证据留法（真链用例，不变）
- 普通回归：`logs/test-runs/<case>-latest.json`（覆盖式）。
- 🔴 真链用例：追加式 `logs/test-runs/real-chain/<case>-<UTC>.json`（不覆盖）+ txid 一行进 ledger。（Bettor 采，随 lint 轮或紧随。）

## 7. 遗留限制（诚实标注）
- lint 的原语检测**静态分不清真-vs-mock**、且**测不到 HTTP 触发的真链**（g5 走 custodial_transfer HTTP endpoint，非直接 `sendKaspa`）⇒ 那类真链的 marker 是**作者纪律**，非机械强制。lint 的 WARN-standalone 只网住**直接调原语**的 standalone。这是静态分析的固有边界，非 lint 漏洞。
