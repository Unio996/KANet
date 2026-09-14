> **Status**: CURRENT

# 主线测试基线 RED 清单（rule 82 安全跑法）v0.1

**2026-09-14 · KANet-UI · Bettor 1265 派工**（"主线测试基线 RED 清单文档，用 rule 82 后的安全跑法，只用 --domain/--all，不再逐文件 --case=，把'从来没有运行证据的 184 个'分域列出哪些红、哪些挂起、哪些依赖不可达组件"）。

## 0. 范围与方法

- **跑的是哪份代码**：`origin/bshard-m3-deploy @ 2a977b78`（当前活跃主线；`origin/master@5daad1ad` 是更早的合并快照，落后，本次未用——过程中曾先跑错分支，已重跑更正，见 §7 附注）。
- **跑法**：独立 worktree（`scratch/_kanetui_wt_test_baseline`）+ 独立 `npm install`（对齐目标分支 `package-lock.json`），全程只用 `--domain=<x>`（未使用任何 `--case=` 单文件跑法），避开近 miss 事故那条路径。
- **零改动**：本次是纯读跑测，未改任何生产代码/测试代码/lint 规则。
- **网络安全核实**（rule 82 未合主线，本次手工核实等效项）：`KANET_CONSOLE_URL` 派生落到 `http://127.0.0.1:3300`（worktree 内无 `kanet.env`，走硬编码 fallback），`netstat` 核实该端口全程无人监听；`KASPA_RPC_URL` 走 env-bootstrap.mjs 自带离线占位符（`http://127.0.0.1:1/offline-test-placeholder`），未真实连链；DB 走 env-bootstrap.mjs 自动隔离到 `test-framework/data/test-console.db`（每次跑前自动删重建 + 自动跑 `runMigrations()`，未接触任何生产库/主网 console.db）；relay 走 `containment-guard.mjs` 自动 `redirectToFixture()`。
- **零 hang**：全部 7 个 domain（broker/exchange/oracle/predictions/support/system/tg-bot）+ 1 个未走 `--domain` 的 identity 域均在各自 240s 超时窗口内完成（实测最长 broker ≈57s），**无一超时**。

## 1. 头条发现（按重要性排序）

### 🔴 A. predictions 域（82 个 .test.mjs）—— 全部真实 case-object 从未被跑过，根因是 discovery loop 无错误隔离

`scripts/test.mjs` 的 case 发现循环：
```js
for (const file of files) {
  const mod = await import(pathToFileURL(file).href);   // scripts/test.mjs:122，无 try/catch
  if (mod.default?.id) casesToRun.push(mod.default);
}
```
这段循环跑在**执行循环之前**、且**无 try/catch**。predictions 域下 `pool/` 子目录里混了若干"自跑脚本"（无 `export default`，import 即执行断言，一部分已按新约定打印 `[imported] 本文件是自跑脚本...runner 不计分` 自证清白——这个安全化是好的、已经在生效），但仍有文件会在 import 期**同步 throw**：本次实测撞在 `pool/p1_refund_authorization_gate.test.mjs:61`：
```
Runner error: Error: 定位不到 bettor 退款扫描(sidesRaw)那段查询 —— 生产结构变了, 本用例的判据失效, 必须重写而不是放行
```
这条 throw 本身是该文件**故意设计的"宁可炸也不放行"**（生产结构变了、判据失效时拒绝假装通过）——文件本身的设计意图是对的，但**runner 的 discovery loop 把它当成了整个进程的死刑**：`main().catch(err => { console.error(...); process.exit(2); })`（scripts/test.mjs:226-228）整个进程退出，**该文件字母序之后的所有文件（含 `pool/` 剩余 ~19 个 + `ss-sub4-mutation/` 全部 4 个）永远不会被 discovery 到，更别说跑**。

**实测验证**：`--domain=predictions` 全程**零** `Summary:` 行、`logs/test-runs/` 里**零**条 predictions 域的 case 名（dm_/dm-agent/pool_/ss-sub4 前缀全无命中）——即便 `dm/`(12) + `dm-agent/`(36) + `journey/`(1) 共 49 个真实 `export default` case-object 文件在字母序上排在 `pool/` **之前**、已被成功 `import()` 并 push 进 `casesToRun`，**执行循环因为进程已经在 discovery 阶段崩溃而从未开始**，这 49 个文件同样零证据。

- **受影响文件数**：predictions 域 82 个 `.test.mjs` 里 63 个是真实 `export default` case-object（dm 12 / dm-agent 36 / journey 1 / pool+ss-sub4-mutation 剩余部分），**全部 63 个自建库以来可能从未真正执行过一次**——不是"红"，是"没有任何证据能说是红是绿"。
- **这不是本次唯一一个会触发同种崩溃的文件**：`pool/` 下另有 `claim_confirmation_depth_gate_regression` / `shard9_phantom_exclude_regression` / `zk_autonomy_ticks_regression` 三个文件同样是"自跑脚本 + 显式 `process.exit()`"模式（本次因为字母序在它们之前就已经撞上了 `p1_refund` 而未触达，但只要 `p1_refund` 被修好，下一次大概率撞上这几个之一）。
- **本次未修**：这是 runner 机制层面的缺陷（discovery loop 缺错误隔离），修法涉及改 `scripts/test.mjs` 本体，超出本次"纯读跑测"授权范围，如实记录、留 Bettor/NWT 判断优先级与修法（候选方向：discovery loop 加 try/catch，把单文件 import 失败当作"该文件跑测失败"而非"整个 batch 中止"，并在 Summary 里显式列出"因 import 失败被跳过"的文件清单，而不是让后续文件连带隐形消失）。

### 🟡 B. system 域：import 期全局 env 污染 tripwire 命中 4 个文件（机制本身工作正常，是内容需要人分档）

`--domain=system` 跑测时，② 检测哨（2026-08-09 事故后加的 tripwire）如期打印：
```
⚠⚠ import 期 process.env 被改动 —— 这些改动【早于任何 case 开跑】, 会留给之后所有用例:
   .../system/hotwallet-admission.test.mjs         改了: RELAY_HOTWALLET_PER_RELAY_MAX_KAS
   .../system/llm-health.test.mjs                  改了: RELAY_HOTWALLET_PER_RELAY_MAX_KAS
   .../system/relay-child-rpc-state-vs-console.test.mjs  改了: RELAY_HOTWALLET_TOTAL_MAX_KAS
   .../system/relay-health-monitor.test.mjs        改了: RELAY_HOTWALLET_TOTAL_MAX_KAS
   🔨 人来分档: 非 case 文件污染全局 = bug 要修; 用例确需前置环境 = 合法, 请在该文件加注释认领。
```
这**不是**本次调查发现的新洞——这正是 tripwire 该有的行为，在正确报告。但截至本次跑测这 4 条尚**无人认领**（既没有确认是 bug 也没有加注释认领为合法前置）。本次未逐文件判定归属，按 tripwire 原话转交人工分档。

### 🟠 C. exchange 域：3 个真实 source-level regression（与 console 是否可达无关）

`exchange_sol_tron_publish_no_slice_crash.test.mjs`（node:test 自跑源码级断言，安全、无副作用）：
- ✖ `state-machine._validateAddr handles sol+tron chain types (non-EVM branch)`
- ✖ `timeoutVerifying uses verifying_started_at threshold (~30 min) for state filter`
- ✖ `timeoutVerifying broadcasts timeout_v1 + transitions reopens (per 4/11 KI-20 sediment)`

文件自身注释已标注 SOL/TRON 分支是"5/12 sediment §3.3 待补"——即已知未完工区，非本次新退化，但截至本次跑测仍是**真实 RED**（不是环境导致的假红）。

### 🟢 D. system 域：2 个真实 RED（node:test 独立文件，与 console 是否可达无关）

- `llm-health.test.mjs` — `llm-watchdog.mjs uses env var override (Anti-pattern #1)`：断言 `scripts/llm-watchdog.mjs` 源码含 `process.env.LITELLM_EXE`，实际源码只有 `LLAMA_EXE`/`LLAMA_MODEL`/`PROXY_SCRIPT`/`CONSOLE_URL`/`NWT_RELAY_ID` 五个可覆盖项，`LITELLM_EXE` 全文件零命中。要么测试断言已过期（watchdog 早已改用 `PROXY_SCRIPT` 起 Node 脚本而非独立 LiteLLM 可执行文件），要么源码确实少了这个 anti-pattern #1 覆盖点——两边哪个对需要域主判断，本次未擅自改任一边。
- `ws-proxy-hijack-detection.test.mjs` — `relay-manager.js exports getRelayRpcState with 5s timeout override`：`AssertionError: 5s timeout override missing`。同上，需域主判断。

## 2. 逐域清单

| 域 | 文件数 | 真实 case-object 数（`--domain` 会跑） | 结果 | 归因 |
|---|---|---|---|---|
| **broker** | 57 | 36（另 20 个 `skip_in_batch:true` 正确保护未跑，1 个未精确归类） | 2 PASS / 34 FAIL | **34 FAIL 全部同一根因**：`ERROR: fetch failed`——本 worktree 无存活 console 实例（派生 URL :3300 空），非 34 个独立 bug。2 PASS（`state_machine_*_invariants`）是纯 DB 内不变量检查，不需要活 console。 |
| **exchange** | 10 | 6（另 4 个是 node:test 自跑源码级 regression 文件，非 case-object） | 6 FAIL（console 不可达同根因）+ 4 个自跑文件内 8 PASS/3 FAIL | 6 FAIL = 依赖不可达组件；3 FAIL = 见 §1-C 真实 RED |
| **oracle** | 10 | 10 | **10/10 PASS** | 全绿，不依赖 console（自含式断言） |
| **predictions** | 82 | 63（**本次实测：0 个曾被执行**，见 §1-A） | Runner 崩溃（exit=2） | 见 §1-A，runner discovery loop 缺错误隔离 |
| **support** | 4 | 3（另 1 个 `support_no_broadcast_leak_negative` 正确 `skip_in_batch:true` 保护，因其会真实广播到 dev-coord-testnet） | 0 PASS / 3 FAIL | 3 FAIL 同 broker 根因：console 不可达 |
| **system** | 9 | 0（全部 9 个是 `node:test` 独立文件，非 case-object 格式，`--domain=system` 按设计报 "0 run" —— 这是既有安全边界，非缺陷） | 手工逐文件 `node --test` 核实：**60/62 assertion PASS**（handshake-module-state 3/3、hotwallet-admission 11/11、llm-health 7/8、relay-child-rpc-state-vs-console 5/5、relay-health-monitor 7/7、relay-hotwallet-monitor 17/17、relay-mempool-reject-outpoint-extract 4/4、relay-restart 3/3、ws-proxy-hijack-detection 5/6） | 2 真实 RED 见 §1-D；另见 §1-B env 污染 tripwire |
| **identity** | 2 | 0 | 0 run（按设计） | 两个文件头注释明确标注"后部署验收"（需 v198+C3 已在 live 库），只能对活 console 跑，`--domain` 批量跑不适用，非缺陷 |
| **tg-bot** | 6 | 0（隔离前置检查） | `SKIP — Console not reachable` | 依赖不可达组件，模块自带前置检查，零风险自我保护 |
| **agent-tunnel** | 3 个 `_smoke_*.mjs`（非 `.test.mjs` 扩展名） | 0（`findCases()` 按扩展名过滤，结构性不可见） | 本次未跑 | 按设计只能 `node <file>` 手动跑，CLAUDE.md 已文档化的既有安全边界，未在本次授权范围内尝试 |
| **m0c1-gate** | 0 个 `.test.mjs` | 0 | 本次未跑 | 同上，CLAUDE.md 明确警告"不可 glob 放宽去发现它们"（发现即执行，历史上出过真广播真花钱事故），未触碰 |

## 3. "依赖不可达组件"桶的准确含义

broker 34 + exchange 6 + support 3 = **43 个 FAIL**，逐条 trace 核对，**100% 是同一行 `ERROR: fetch failed`**——本次是在一个刻意不起任何 console/kaspad 实例的隔离 worktree 里跑测（避免真打到任何 live 服务），这是**本次调查方法论的预期后果，不是 43 个独立代码缺陷**。这批文件本身是否真的绿，需要在一个起了隔离 console（`KANET_CONSOLE_URL` 显式指向自己起的测试实例）的环境里重跑才能判定——本次未做，因为"起一个 console 实例"超出"纯读跑测"授权范围，如需要请另行派工。

## 4. 建议（未自行实施，留 Bettor/NWT 定夺）

1. **优先级最高**：predictions 域 discovery loop 错误隔离（§1-A）——现状是"63 个测试的存在与否对 CI/人工都不可见"，比明确的 RED 更危险（RED 至少有人看得见）。
2. system 域 4 个 env 污染文件分档认领（§1-B）——tripwire 已经在正确报警，缺的是人来判定 bug vs 合法前置。
3. exchange SOL/TRON 3 项 + system 2 项真实 RED（§1-C/D）——域主判断测试断言是否已过期 or 代码确有缺口。
4. 若要拿到 broker/exchange/support 43 个 "fetch failed" 用例的真实红绿判定，需要另起一个隔离 console 实例（非主网/非 TN12）重跑，非本次任务范围。

## 5. 过程附注

本次调查中途发现最初核对的是 `origin/master@5daad1ad`（落后快照），已切换到实际活跃主线 `origin/bshard-m3-deploy@2a977b78` 重新完整跑测一遍——本文档全部数据均基于后者（正确分支）。切分支途中还发现一个环境细节：该分支的 `src/db/client.js` 已加装 fail-closed guard（ANTI-PATTERNS 规则 74，无 `DB_PATH` 且非 console 入口即 throw），本次系统域的 4 个"文件级失败"最初也是撞了这个 guard（因为手工 `node --test` 未预先设 `DB_PATH`/`KASPA_RPC_URL`），补齐 env 后全部转绿，已在 §2 表格体现修正后的真实结果，未把这层方法论假红计入 RED 清单。
