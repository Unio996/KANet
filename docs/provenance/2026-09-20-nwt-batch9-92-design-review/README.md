> **Status**: CURRENT（2026-09-20，NWT；对象 = `coord/j2-batch9-92-design-v0` 头 `7878b509`（v0.3.3 §19：9-2 设计细化，只文档）；Bettor 令：一轮、只看 J2 标的两处 MUST）

# 批 9 · 9-2 设计审 —— NWT：**1 条新 MUST（S9 严格格式与真实市场 ID 对不上，会把所有真实结算错拒）；发现 1 的方向对；发现 2（S9-b）我裁：采纳，算 MUST（小）**

## MUST-1（新）：S9 严格格式写的是"小写 UUID"，真实市场 ID 是 64 位十六进制 —— 按现设计，出口会把每一条真实结算意图判成 B 类拒掉
- 设计 §19.1 的 S9：`^settle:(market|claim):<小写 UUID>:<step>(#<n>)?$`。
- **真实生产者**：`settlementIntentKeyFor(subjectType, subjectId, step, attempt)` 只要求 `subjectId` 非空，输出 `settle:<type>:<subjectId>:<step>[#n]`。**市场的 subject_id = `proto_markets.id`，其生成式是 `api/proto.js:128` 的 `randomBytes(32).toString('hex')`（64 位小写十六进制）**；`proto.js:86` 的 `randomUUID()` 是**代币定义**的 id，不是市场的。
- **活库实测**（只读，`outputs.txt` §1–2）：`proto_markets` 3 行，**3 行都不符合"小写 UUID"**（长度 64、纯小写十六进制、无连字符）；`proto_claims` 0 行；`proto_settlement_intents` 0 行（还没有任何结算意图，所以问题此刻没有显形）。
- **对真实生产者输出判定**（`outputs.txt` §3）：用真实 `settlementIntentKeyFor` 对 64 位十六进制的市场 id 生成 `seal` / `resolve` / `convert_to_claim` / `claim_draw` 四条键，**设计里的 S9 正则一条都不接受**（只有 UUID 形状的 id 才通过）。⇒ 落进 §19.1 矩阵的 **B 类**（`settle:` 开头但格式不合法）⇒ **四个开关格全部拒 `proto_settlement_intent_key_invalid`** ⇒ 现有的、以及今后按同一生成式创建的任何市场，**结算命令永远出不了出口**。这与"批 9 接线让市场真能结算"的目标直接相反（属"会错拒"，不是"会错花"）。
- **修法**：S9 的 id 段按**真实生成式**写死——市场 id = `[0-9a-f]{64}`；`claim` 的 subject_id 目前设计只说"驱动创建一行 `proto_claims`，其 id 作为 subject_id"（P4）而没定生成式，**必须在 S9 里同时钉死**（建议同为 `randomBytes(32).toString('hex')` 的 64 位十六进制，或保持 UUID——二选一并让驱动照生成；不要让两边各自假设）。**再加一条"生产者↔出口"对照测试**：对每个 step，用**真实** `settlementIntentKeyFor(…)` 以**真实生成式**产出的 id 生成键，喂给出口闸，断言 A 类放行（PSDE=1）——这条测试会在设计阶段就抓到本问题；J2 现在的矩阵测试向量全是手写字符串，没有这条。

## 发现 1（S9 常量内联进 `proto-relay-ipc.mjs`）—— 同意，前提我逐项核实成立
- `STEP_SUBJECT_TYPE` 在 `proto-settlement-intent.mjs:33` 确为**未导出**的 `const`；已导出的 `SETTLEMENT_SUBJECT_TYPES` / `SETTLEMENT_STEPS` 含 `ticket` / `withdraw` / `reclaim`（`:27-28`），批 9 要拒它们，必须再取子集。
- `proto-relay-ipc.mjs` 是 M0a 摘要钉住的文件（`m0a-exception-manifest.json` 的 `PVF-proto-relay-ipc-funnel`，`content_digest` 现存），且目前**只 import 一个东西**（`./proto-relay-guard.mjs` 的 `PROTO_RELAY_ID`）；若改成从 `proto-settlement-intent.mjs` 导入判据，改那张常量表就会静默改变出口判据而摘要不变。所以**内联进 TCB** 是对的。内联时按 MUST-1 修正 id 段。

## 发现 2（S9-b：非字符串 `intent_key` 出口拒）—— 我裁：**采纳；算 MUST（小）**
- 出口现按 `typeof out.intent_key === 'string'` 分类，但**线上看到的是 JSON 序列化后的值**。实测（`outputs.txt` §3）：`relay-manager.js` 的 `fork` 没设 `serialization`（Node 默认 JSON），`new String('settle:…')` 与带 `toJSON()` 的对象**经 IPC 到达子进程时都是原始字符串**，而出口处 `typeof` 是 `"object"`——即出口判 C 类（PDE=1、PSDE=0 时放行），线上却是一个没过 S9 的 `settle:` 字面。这与 J2 自己做快照的原则（"闸判的必须是发出去的"）是同一类：闸看的值与线上的值不一致。
- 修法就是设计里的三行：write 命令 `out` 含自有 `intent_key` 且 `typeof !== 'string'` ⇒ 拒（`proto_intent_key_not_string`，四开关格同）。向量除 `String` 对象 / 数组 / 数字 / 对象外，**加"带 `toJSON()` 返回 `settle:…` 的对象"**（这一条不在设计的向量表里）。现有 producer 全传原始 string，无行为变化。

## 没做 / 未证
- 只审了设计文本 §19.1 与它依赖的真实代码 / 活库形状；9-2a 的实际 diff 还没有（届时我再看矩阵实现与 J2 自报的 ≥14 变异）。
- §19.2 的 9-2b 清单 14 项、§19.3 两条补充决定我没有逐项审（按 Bettor 令，等 9-2b diff）。
