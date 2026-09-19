# 批 9-1 设计 v0.3.3（§18–§19，头 `1cb8dfab`）NWT 设计审

2026-09-20。对象：`origin/coord/j2-batch9-1-design-v0.3.3` 头 `1cb8dfab`（父 `a07c2680`，只一份文档，+75/−3），`docs/2026-09-19-j2-proto-v0-batch9-wiring-design-and-checklist-v0.2.md` §18（v0.3.2）与 §19（v0.3.3）。方法：读全文；把稿里能用现场核的"事实"全部核了一遍——`sendCommandAsync` 源码、`SIGNED_INPUT_CEILING_SOMPI` 两处定义、C1 现文件；并对"`finalize()` 重算 id 究竟覆盖交易的哪些字段"**在本仓 wasm 上做了一次实测**（`nwt-txid-coverage-probe.cjs`，原始输出 `nwt-txid-coverage-probe-output.txt`；`kaspa_bg.wasm` sha256 前缀 `51cec45e7f21dd79`）。D-021：无密钥 / 余额 / 地址。

## 结论：**设计方向接受；落码前 4 条 MUST（都是文字级改动）+ 5 条 SHOULD；六个开放问题的 verdict 见 §四。** 我不需要再审一轮设计文本——按 MUST 改进 v0.3.4 后 J2 可进 9-1，我审 diff 时对照。

| 类 | 编号 | 内容 |
|---|---|---|
| **MUST** | **N91-1** | §19.1 只覆盖了"relay 回了一个错误形状"，**没覆盖 console 侧传输失败**：`sendCommandAsync` 在超时 / relay 未运行时是 **reject**（不是 resolve）；且 relay 回执缺 `result` 时 resolve 成 `{}`。C1 模块必须把 `requestFacts` 的 reject 映射成独立码，走同一条 NO TX NO STATE 路径 |
| **MUST** | **N91-2** | §19.2 指针模块必须**从 `finalize()` 之后的交易对象读输出，且只读被 txid 覆盖的字段**。我实测：`computeBudget` / `sigOpCount` / `signatureScript` **不被 txid 覆盖**（改了 id 不变）；covenant 绑定（id 与 authorizing input）、输出面值、sequence、payload、lockTime **被覆盖**。谱系核对只能读输入的 `previousOutpoint`，**不得读 `inputs[].utxo`** |
| **MUST** | **N91-3** | §18.1 第 8 格（赢家票）的指针取自 `proto_bets.ticket_txid/ticket_vout` **原始 DB 列**，是 8 格里唯一不经 `prepared_tx_json` + `finalize()` 验证的来源——信任模型不一致。要求：ticket 也从该 bet 的 landed append 意图的 `prepared_tx_json` 取，并核 `ticket_txid == submitted_txid`、`ticket_vout == REGISTER_APPEND_TICKET_OUT_INDEX(1)`、该输出 spk == 现算 ticket spk |
| **MUST** | **N91-4** | C1 一步的多次只读请求**改并发**（≤3 次形态 O + 1 次形态 L 彼此独立），不要串行；"每步总预算 = tick 间隔的一半"这个定法会让最坏情形系统性饿死（见 §三-③） |
| SHOULD | S91-1 | fee 走形态 L 跳过毒化候选：**够**（作 liveness 残余），但补三样：跳过计数事件、窗口饱和专用报警、9-4 威胁说明写成本估算（§三-②） |
| SHOULD | S91-2 | E 组 fixture 必须含**真实录制的 9-0 relay 回执**（J2 `1e19027d` 的 S1 形状），不是手写 |
| SHOULD | S91-3 | `assertFactsResponse` 的 `requested` 含重复 ⇒ 抛编程错误；条目格式判定补 uint 范围 / 小写 |
| SHOULD | S91-4 | fee 候选排除"我方在途意图的 `submitted_txid` 产出的输出"（避免在浅确认的父输出上构造） |
| SHOULD | S91-5 | 传输错误分级：版本错位类（`facts_echo_missing` / `facts_version_mismatch`）**首次即 error**，只有超时类才走"连续 3 次升级" |

## 一、逐节判定

### §19.1 `assertFactsResponse`（你问：8 项判定顺序与失败码是否覆盖我 S-2 的全部条件）
**S-2 的每个条件都覆盖了**：`ok === true` 严格（#3）、`facts === true`（#4）、`factsVersion === 1`（#4）、`form` 相符（#5）、条目级键齐全（#7：`scriptHex` 字符串 + `'covenantId' in item`）、不得用 `!result.error`（#2 用 `res.error === undefined`，且 #3 独立再判 `ok`）、错误回执无 `ok`（#2/E2 用真实错误回执形状）。顺序（形状→错误→ok→回声→形态→数组→条目→集合）合理：前置失败不看后面，且错误回执在 `ok` 之前被点名为 `facts_relay_error`（带 relay 原文），可诊断。#8 的 `found ∪ missing` 恰等于请求集合、按 `txid:index` **含 index** 匹配、无重复无遗漏，与我 9-0 的 N-T1 同族，E8 有对应变异。**判：覆盖完整。** 缺口只有两处：
- **N91-1（MUST）传输层失败没纳入**。我读了 `relay-manager.js:447-475`：`sendCommandAsync` 在 **console 侧超时** 时 `reject(new Error('Relay command timeout after Ns'))`、在 relay 未运行时 `Promise.reject(new Error('Relay not running'))`；只有 relay 回了消息才 resolve，且是 `resolve(msg.result || {})`（缺 `result` 时得到 `{}`）。而 §19.1 只定义了"收到一个对象之后怎么判"，§19.3-7 的报警映射里"`facts_relay_error`（含超时）"指的是 **relay 侧** `facts_rpc_timeout`（那种走外层 catch 的错误回执）；**console 侧 IPC 超时是 promise reject，`assertFactsResponse` 根本看不到**。要求：`verifyStepInputsOnChain` 对 `requestFacts` 包 try/catch，reject ⇒ 独立码 `facts_transport_error`（`.detail` 带原 message），与 `facts_relay_error` 一起归入 `settlement_facts_transport_error`；测试加 E10 `requestFacts` 抛 `Relay command timeout…` / `Relay not running` 各一（▲ 变异：去掉 try/catch ⇒ 异常逃出 C1、可能被上层当成别的错误吞掉），E11 relay 回 `{}`（`msg.result` 缺失）⇒ `facts_not_ok`。
- **S91-3**：#7 条目格式建议明写范围：`amount` 十进制字符串且 ≤ u64、`scriptPublicKey.version` 为 0..65535 整数、hex 一律**小写**（relay 输出恒小写，大写即异常）；`requested` 自己若含重复（调用方 bug）应抛编程错误而不是"恰好等于"。

### §19.2 指针模块 + `finalize()` 重算 id（你问：`finalize()` 与谱系核对）
J2 的不变量 1（`deserializeFromSafeJSON` 不重算 id，必须 `finalize()`）**我独立实测确认**，并且把范围量出来了——对同一笔带 covenant 绑定输出的 v1 交易，`deserializeFromSafeJSON` 后**不 `finalize()` 时 id 恒等于 JSON 自带值**（所有篡改都不改变它）；`finalize()` 后：

| 篡改 | `finalize()` 后 id 是否变 |
|---|---|
| 输出面值 +1 | **变**（被覆盖） |
| **covenant id 改写** | **变**（被覆盖） |
| **covenant authorizing input 改写** | **变**（被覆盖） |
| 输入 sequence / tx payload / lockTime | 变（被覆盖） |
| 输入 **`computeBudget`** | **不变——不被 txid 覆盖** |
| 输入 **`sigOpCount`** | **不变——不被 txid 覆盖** |
| 输入 **`signatureScript`** | **不变——不被 txid 覆盖** |
（`utxo` 子对象不在交易序列化的哈希范围内，我没有逐字段量它，但按"输入的 `utxo` 是节点上下文而不是交易内容"处理即可。）

含义与要求（**N91-2，MUST**）：
1. **covenant 绑定被 txid 覆盖**——好消息：`finalize()` 通过 ⇒ 输出里的 `covenantId` 与其 authorizing input 已被 `submitted_txid` 绑定，指针里的 `expectedCovenantId` 直接读**finalize 之后**的对象即可信（相对 `submitted_txid`）。所以 §19.2 末尾的"`kaspa.covenantId(feeOutpoint, groups)` 独立重算并要求相等"**不是防 DB 篡改所必需**（txid 已经绑了），它的价值是**校验 builder 的 genesis 派生没有 bug**（多一个独立来源），**成本≈0，我同意默认强制**，但请在文档里把理由写对，别写成"防 DB 篡改"。
2. **必须从 `finalize()` 之后的交易对象读输出**，不得从原始 JSON 字符串读——两者在被覆盖字段上一致（id 通过的前提下），但**不被覆盖的字段（`computeBudget` / `sigOpCount` / `signatureScript`）在 JSON 里可被改而 id 不变**。指针模块本来只需要输出的 `covenantId`、面值、下标与输入的 `previousOutpoint`——这些都在被覆盖范围内；**明确禁止**读 `inputs[].utxo`、`signatureScript` 等。
3. **谱系核对（不变量 2）只读输入的 `previousOutpoint`**（transactionId/index，被覆盖）。
4. **测试**：P9 除"改输出面值不动 id ⇒ `pointer_txid_mismatch`"外加：P9b 改 **covenant id** ⇒ 同码；P9c 改**不被覆盖**字段（`computeBudget` / `sigOpCount` / `signatureScript`）⇒ 指针模块**不应受影响**（结果与原来逐字段相同），且断言它**没有读取**这些字段（例如把这些字段设成非法值也不改变结果）；▲ 变异：去掉 `finalize()`、改成读原始 JSON。
5. **反序列化失败**（JSON 损坏）要有独立码（建议 `pointer_tx_malformed`），别与 `pointer_tx_missing`（列为空）混。
6. **`prepared_tx_json` 也是 `resolvePrepared` 的重播字节**：上面三个不被覆盖的字段能被改而 id 不变，会让**重播**的交易失效或形状不同——这是既有路径（`resolvePrepared`）的性质，不是 9-1 引入；提一句给 9-2b：重播前建议对同样的三个字段做 `finalize()` 之外的一致性检查（或直接重新序列化比较）。

### §18.1 八格来源表（你没直接问，但与 §19.2 同一处）
- **N91-3（MUST）第 8 格 ticket**：其余 7 格的预期 outpoint/covenantId 都取自意图表的 `prepared_tx_json`（经 `finalize()` 绑定到 `submitted_txid`），**唯独第 8 格取自 `proto_bets.ticket_txid/ticket_vout` 原始列**（由 `markBetAppendLanded` 写入，无任何验证）。同一模块内两种信任模型不应并存。要求：赢家票的指针改为从该 `winnerBetId` 对应 bet 的 landed **append 意图**的 `prepared_tx_json` 取输出[`REGISTER_APPEND_TICKET_OUT_INDEX`]，核 `proto_bets.ticket_txid === submitted_txid` 且 `ticket_vout === 1`，并断言该输出的 spk == 现算的 ticket spk、无 covenant；三者不一致 ⇒ `pointer_ticket_inconsistent`。（DB 列被改错的后果本来只是 C1 报 `missing`，属 fail-closed；但一个模块里信任模型一致，才谈得上"逐格钉死"。）
- **格 3/4/5/6/7 的 covenantId 一致性、格 2 的"每笔 append 的 KTT covenantId 不同"**：读了逻辑无异议。`landed_at` 加 `, pbi.rowid DESC` 的 tiebreak 小改同意（活性问题非安全问题，J2 的核实结论成立）。

### §19.3 C1 调用点（你问 3：fee 走形态 L 用 `maxAmount` 跳过毒化候选是否够）
**先纠正一个概念**：`maxAmount = SIGNED_INPUT_CEILING_SOMPI` 的作用是**排除超过 relay 签名输入上限的候选**（我核了两处定义均为 `100_000_000n`：console `proto-tx-assembly.mjs:117`、relay `covenant-broadcast.mjs:55`，一致），**不是**跳过毒化候选——毒化候选由"消费方拿到列表后跳过 `covenantId !== null` 或 spk ≠ relay P2PK"实现（S1，步骤 6）。两件事，稿里写在一起容易被读混，请分开写。
**够不够**：**够，作为活性残余可接受**，理由与残余分开说：
- **安全方向**：跳过而非中止、不做"回落到毒化候选"——对，别改：毒化输入（covenant 绑定 + P2PK spk）我只实测过**简单交易**里被节点接受；在**含其它 covenant 输出**的结算交易里同时花一个 covenantId≠输出的毒化 fee 输入，行为**未测**，所以"宁可跳过"是保守正确的。
- **残余（活性攻击）**：窗口是"过滤 → 面值降序 → 截断 200"。攻击者要挤掉全部干净候选，必须往 relay 地址撒 **≥200 个面值不低于合法 fee UTXO 且 ≤ `maxAmount` 的毒化 UTXO**：单个 fee 输入至少需要约 `minFeeInputFaceValue`（0.95 KAS 量级，见 anchors）与 cap（0.3–0.52 KAS），所以下限约 **200 × ~1 KAS ≈ 200 KAS**（还要付 storage mass 与手续费），且这些 UTXO 是捐给 relay 的、**可由人工整合回收**。对真实 KAS 的市场是**可接受但不是零**的封死成本。
- **要求（S91-1，SHOULD）**：(a) 每次跳过毒化候选写一条 `fee_candidate_poisoned_skipped {count}` 事件（warn），让攻击**可见**；(b) 形态 L 返回后无干净候选（包括"全被跳过"）⇒ 专用报警 `settlement_fee_window_saturated`（error），**区别于**普通 `no_suitable_fee_utxo`；(c) 9-4 威胁说明写上上面的成本估算；(d) 请求里加 `minAmount`（该步最低可行 fee 输入面值）以免窗口被大量"小到不够用"的 UTXO 占位；(e) backlog：若将来要彻底封死，需 relay 侧形态 L 加 `excludeCovenant:true`（属 9-0 改动，走 9-0 同款审）——**现在不做**。
- **S91-4**：fee 候选应排除"由我方**在途**（未 landed）意图产出的输出"（用 `submitted_txid` 集合过滤）——避免在浅确认的父输出上构造、遇 reorg 卡住。
- 毒化向量本身（第三方密钥造毒化 UTXO 喂真实选取函数）我按计划在 9-1 diff 审时起 simnet 补测。

**N91-4（MUST）并发与预算**：§18.2.3/§19.3.8 现写"串行；最坏一步 4 × 13 s = 52 s；每步总预算建议 = tick 间隔的一半"。问题：预算若取 tick 间隔的一半（tick 一般是几十秒），**小于最坏 52 s**，则节点稍慢时该步系统性超预算、永远放弃——**活性被自己的预算饿死**，且是 fail-closed 所以不会被发现为 bug。修法：≤3 次形态 O + 1 次形态 L 是**彼此独立的只读请求**，全部**并发**发出（同一个共享 RpcClient 上并发 `getUtxosByAddresses` 无问题）；最坏一步降到 ≈ 13 s + 余量；预算 ≥ `FACTS_RPC_WAIT_MS + FACTS_RPC_CALL_MS + 余量`（≥ 15 s IPC 超时），且**必须小于 tick 间隔**，具体数值 9-2b 定，但 9-1 文档要写这两条约束而不是"tick 的一半"。

**其余 §19.3 点**：步骤 3 里 `spent:false` 是写死的——请在文档注明"`found` = 在虚拟 UTXO 集里，**mempool 里的花费不反映**"；若同一 outpoint 已被在途交易花费，我们构造的新交易会被节点拒（双花）——安全方向，但**不是由这个断言保证的**，别把它写成断言。步骤 7 报警映射同意，分级见 S91-5。

### §19.4 `chainParents` 与 builder 断言
同意：`chainParents` 全部来自经断言的链上事实；在 `assertMassWithinCeiling` / `selectChangeShape` **之前**核对 `hasCovenant` / `spkLen` / `value`；不符抛 `chain_parents_mismatch`。请 B1 里加：`chainParents` 的 fee 角色项也来自形态 L 条目的事实（`hasCovenant:false`，spk == relay P2PK）而不是常量。

### §19.5 测试矩阵
结构好（E/P/C/B/M 五组、▲ 标变异）。补：**E 组 fixture 用真实录制的 9-0 relay 回执**（S91-2）——`1e19027d` 证据里的 `facts-vs-node.json` 有 S1 的真实形状，手写 fixture 恰是我 9-0 起就在防的"手写夹具绿、生产恒 null"；E10/E11（N91-1）；P9b/P9c/P9d（N91-2）；ticket 三者不一致用例（N91-3）；C 组加"并发请求其中一个失败 ⇒ 整步 fail-closed、不推进状态"。

## 二、（你问 2）§19.2 谱系与 §18.1 不变量
不变量 1（id 重算）✓ 见上；不变量 2（谱系）**只读 `previousOutpoint`**（N91-2）；不变量 3（covenantId 双重一致：第 3、4 格相等）✓ 同意——续约保持 covenant id 是链上共识规则，等式必须成立；不变量 4（指针只是"预期"，真伪由 C1 对链上取证）✓ 这是整个设计的承重点，我同意其表述。

## 三、（你问 4）六个开放问题 verdict（§19.6）
1. **M6 新参数必填 vs 可选**：**必填**，同意。无生产调用方，只改测试；可选参数会让"调用点写漏就静默通过"重现。加一条：缺参数 ⇒ 抛 `SettlementChainCheckError`，`.code = 'chain_check_params_missing'`（C6 的具体码）。
2. **类型化错误 `SettlementChainCheckError`**：**要**，同意保持原标签文本不变。补：(a) `.code` 取值是**闭集**，测试断言"抛出的每个错误都带闭集内的 code"；(b) C7 里现有 16 处正则用例照旧绿——并加一条断言"`.message` 仍含原标签"，防日后有人改文本破坏调用方的正则；(c) 现有三类（`value_drift` / `spk_drift` 及缺失类）也要带 `.code`，而不只是新增两类。
3. **`expectedCovenantId` 双来源默认强制**：**同意强制**，但理由要写对：因为 covenant 绑定被 txid 覆盖（§一-§19.2 实测），DB 篡改已被 `finalize()` 挡住；`kaspa.covenantId(feeOutpoint, groups)` 重算的价值是**校验 builder 的 genesis 派生**（独立来源），只适用于 genesis 组输出（续约输出 covenantId 沿用、无派生）。
4. **`settlement_facts_transport_error` "连续 3 次升 error"**：**同意 3 次，但分级（S91-5）**：(a) 超时 / relay 忙类 = 瞬时，首次 warn，**连续 3 个不同 tick**（不是同一 tick 内的重试）升 error，成功一次清零；(b) **`facts_echo_missing` / `facts_version_mismatch` 不是瞬时**——它们说明 relay 与 console 版本错位（旧 relay 孤儿子进程 + 新 console，正是 E1 防的场景），**首次即 error**，不等 3 次；(c) `facts_transport_error`（console 侧 reject）按 (a)。
5. **每步总预算数值**：**9-1 不定数值，但写两条硬约束**（N91-4）：并发请求；预算 ≥ 两个 relay 常量之和 + 余量（≥ 15 s）且 < tick 间隔；**不得**取"tick 的一半"。
6. **§18.0 合入若被要求拆开**：**已无意义**——候选已由 Bettor `--no-ff` 合入主线（merge `e2e91c6e`），`STEP_INPUT_ROLES` 的 withdraw / ticket_reclaim 两行随之在主线；同意不拆，它们不接线并有 §11.1 扫描守着（我合入卫生审已实跑）。稿里 §19 开头"待 NWT 合入审"应改为"已合入 `e2e91c6e`"。

## 四、我没做 / 未证
- 没审 9-1 代码（不存在）；`finalize()` 覆盖范围我实测的是 tx 的常规字段，**`utxo` 子对象**与 `storageMass` 字段是否入哈希未逐个量；毒化 fee 输入在含其它 covenant 输出的交易里的共识行为未测（9-1 审时起 simnet 补）。
- 200 KAS 的活性攻击成本是量级估算（依 anchors 里的 `minFeeInputFaceValue` 与 cap），未含 storage mass / 手续费的精确值。
- 我的独立检出 `D:\kanet-nwt-cand`（主线合入前的候选）继续用于后续 9-1 代码审；实测探针在其 `kasia-relay/node_modules` 的 kaspa-wasm 上跑，本目录只存脚本与原始输出。
