# NWT 红队审核 — 通用分润系统收益可见层（对抗性版）

**作者**: NWT · **日期**: 2026-06-28 · **审对象**: `docs/2026-06-28-universal-revenue-split-visibility-layer-design.md`
**触发**: Bettor 派工(审 5 审点) + Owner 要求对抗性
**结论**: **PUSH-BACK(3 BLOCKING·1 DESIGN REJECT·3 CONDITIONAL)**

---

## ⛔ DESIGN REJECT — introducer 角色根本不存在于 DB

设计把"5 角色全可见"作为核心目标，但 DB 链上核查结果：

```
pool_markets 列: id, broker_pk, oracle1_pk, oracle2_pk, oracle3_pk, committee_member_pks=不存在
introducer 相关: ZERO 列
fee/introducer 表: ZERO 张
pool_markets.metadata keys: spine_redeem_script_hex, archived_* (无 introducer 任何字段)
```

**introducer 机制在 DB 里没有任何落点。** oracle 委员在 `pool_committee.committee_pks`（5 个 PK），与 `pool_markets` 通过 market_id 关联，可查到。但 introducer 地址从哪来？

设计稿§2.1 说"affiliate(introducer)都 parse outputs_json"——emit 时怎么知道哪个 output 是 introducer 的？答案：**不知道**。没有存储 introducer_address 的地方，无法按地址 match settle TX outputs。

这不是"CONDITIONAL 等 J2 补"，是 **设计没有数据支撑**。introducer 可见层在当前 DB schema 下物理不可能实现。

**要先回答**: introducer 地址从哪来、存哪里、怎么跟市场关联？没答案前，"5 角色全可见"的设计标题就是过度承诺。

---

## 🔴 BLOCKING-1 — oracle 与 node 地址重叠，emit 无法区分

设计：oracle fee + node fee 是两个独立角色，各自 emit 独立事件。

**实际结构**（DB 验）：oracle = committee members，node fee 也分给 committee members（fee 设计 memory："node→委员 split"）。settle TX 里，同一委员地址收到 oracle share + node share，**在同一个输出里合并**。

emit-pass 按 `address match` 识别角色 → oracle 地址 == node 地址 → **无法区分是 oracle fee 还是 node fee**。

**后果**：不管设计怎么命名，emit 只能产出一条"该委员地址收了 X sompi"的事件，无法拆分 oracle/node。任何试图区分的做法都需要从 settle 计算逻辑里取 feeSplit 结果 ——那意味着 emit-pass 必须重算 pari-mutuel（这反过来要求知道全部 bettor 数据和 feeRules，不是"纯读 outputs_json"）。

设计在 oracle/node 两角色的可见性上存在根本矛盾：要么合并成一个"committee fee"角色、要么 emit-pass 要重算 pari-mutuel（成本完全不同）。

**两选一，必须先决策，否则不能实现。**

---

## 🔴 BLOCKING-2 — UNIQUE 约束冲突，multi-role INSERT 静默丢失

chain_events UNIQUE = `(txid, event_type)`（DB 实查 `sqlite_autoindex_chain_events_2`：col[0]=txid, col[1]=event_type）。

设计倾向"统一 event_type='fee_landed'"：一个 settle TX 产出 broker + oracle + node fee 事件 → 同 txid + 同 event_type → 第一条 INSERT OR IGNORE 成功，后续全被静默丢弃，**无报错、无 log**。

DM 端不会触发，节点视图缺角色，但一切看起来"正常运行"。这是真正危险的静默失败。

**修法**（必须选定）：
- A：event_type 含角色：`broker_fee_landed` / `oracle_fee_landed` / `node_fee_landed`（无需 migration，沿用现有 UNIQUE）
- B：chain_events 加 `role` 列 + 新 UNIQUE(txid, event_type, role)（需 DB migration）

不选定一个就不能动代码。

---

## 🔴 BLOCKING-3 — markEmitted() 单 stamp 封死 multi-role retry

现有 `markEmitted()` 写 `pool_markets.metadata.broker_fee_landed_emitted_at`，候选查询过滤掉有这个 stamp 的市场。

**multi-role 版本**：broker emit 成功后 stamp 写入 → 下次 tick 查询把该市场整个排除 → oracle/node/introducer 无论成功与否，永远不再被扫描。

如果 oracle 地址 match 在第一 tick 因为某原因失败（txRow 刚进 kaspa_tx_log 但 indexer 滞后、或地址大小写 case mismatch），**没有 retry 机会**。

设计提到"幂等·防重复"，但现在的实现是"第一次跑完就再也不跑"，这两个性质不一样。

**修法**：per-role 独立 stamp（`oracle_fee_emitted_at` / `node_fee_emitted_at` / `broker_fee_emitted_at`），或一次 atomic emit 所有角色成功后才 stamp。

---

## 审点 1 — 可见层破 trustless？

### ✅ PASS（但要问更深的问题）

emit-pass → chain_events INSERT + metadata stamp。settler 不读 `broker_fee_landed_emitted_at`（grep 验）。可见层不影响 covenant/settle 机制。

**但要问**：trustless 基础本身稳吗？设计说"①分得对已 live 验过(x4kpq)"，但 x4kpq 是 driver-side enforce，不是 production-trustless（自治 daemon 未落）。在 enforce 仍 driver-side 的情况下，可见层展示的 fee 金额"正确"只是因为 driver 诚实，不是 covenant 保证。

这不阻 testnet，但设计"可用化"的措辞要校准：当前 = demo-able，不是 production-trustless-visible。

---

## 审点 2 — 链验金额？

### ⚠️ CONDITIONAL（前提 BLOCKING-1 解 + 地址 match 准确）

broker 金额 chain-verified（`outputs_json.amount_sompi`，PASS）。multi-role 理论上沿用同一路径，**但**：
- oracle/node 地址重叠 → 金额拆分需重算（见 BLOCKING-1）
- introducer 地址来源不明 → 金额无法 match（见 DESIGN REJECT）

"都 chain-verified"的承诺只在 broker 角色真实兑现，其他角色目前不可实现。

---

## 审点 3 — PII

### ⚠️ CONDITIONAL — 节点视图禁 tg_user_id

节点全局视图若包含 tg_user_id（broker/introducer 的 TG 身份）= operator 知道 broker 的 TG 账号，PII 泄露。

**要求**：节点视图只暴露 `(role, kaspa_address, earned_sompi)` — 链上公开数据。tg_user_id 禁止进入节点视图。  
multi-role DM 端点（introducer 等）需同 broker DM 一样加 `verifyIngestRequest`。

---

## 审点 4 — oracle/node 2.3 视图够不够？

### ✅ PASS（Phase 1 诚实范围，需标注）

oracle/node 无 TG 映射 → 不走 DM，走节点视图。operator 是节点持有人，他看到"我的节点结算的市场里所有角色各赚多少"满足 Owner 要求。

**必须标注**："以下数据仅含本节点结算的市场（Phase 1 单节点范围）"。

---

## 审点 5 — 可行性

### 🔴 已在 DESIGN REJECT + BLOCKING-1/2/3 中展开

可行性问题不是实现细节，是设计结构性问题：
1. introducer 地址 DB 无落点 → 不可实现
2. oracle/node 地址重叠 → 无法按地址区分
3. UNIQUE 约束 → multi-role INSERT 静默丢失
4. single stamp → retry 被封死

设计给出"单 emitter 参数化覆盖全角色"的方向，但基础假设（每角色地址唯一可匹配）不成立。

---

## 结论汇总

| # | 严重 | 项 | 结论 |
|---|------|---|------|
| DESIGN REJECT | 🛑 | introducer 无 DB 支撑 | 回设计，先定 introducer 数据模型 |
| BLOCKING-1 | 🔴 | oracle/node 地址重叠，无法 emit 区分 | 必须决策：合并角色 or 重算 feeSplit |
| BLOCKING-2 | 🔴 | UNIQUE(txid, event_type) multi-INSERT 丢失 | 选定 event_type 方案 A 或 B |
| BLOCKING-3 | 🔴 | single markEmitted stamp 封死 retry | per-role stamp 或 atomic emit |
| F1 | ✅ | 可见层不破 trustless | PASS（trustless 基础本身 driver-side 需校准口径）|
| F2 | ⚠️ | 链验金额 | CONDITIONAL（broker PASS，其他角色 BLOCKING-1 先解）|
| F3 | ⚠️ | PII | CONDITIONAL（节点视图禁 tg_user_id，DM 端点加 auth）|
| F4 | ✅ | oracle/node 2.3 视图 | PASS（Phase 1 范围，需标注"本节点市场"）|

**总结论：PUSH-BACK（3 BLOCKING + DESIGN REJECT）**。

---

## 最小可行路径（NWT 建议，供 Bettor 拍）

如果 Owner 要"尽快可见"：
1. **只做 broker 可见**（已有 emit，只差 DM 修复 B1/P1/M1 已解）
2. **oracle/node 合并一个角色"committee fee"可见**（地址匹配可做，放弃 oracle/node 分项）
3. **introducer 放 Phase 2**（先补数据模型，有存储才能 emit）

这样砍掉三个 BLOCKING 里的两个，最快能落 demo。introducer 在没有 DB 支撑时不应出现在设计目标里。
