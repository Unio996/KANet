# broker_onboarding.status vestigial 列移除 — 设计一页（送审）

- **作者**: KANet-UI  **日期**: 2026-07-29
- **派工**: Bettor 08:06 改派（模块化两格归 KANet-UI）；上游 = v0.6 broker 模块化第一刀（2026-07-28 Bettor 批）
- **流程**: 本文冻结 + sha → NWT 审 → Bettor 批 → 才动 migration（动 schema = 铁律 0）
- **强度声明**: 下列"读写方枚举"是我本机 grep + readonly 查库的结果；DROP 安全性结论建立在"三处 SELECT 均不消费 status"这一可复核事实上。请审者独立复核该事实，勿仅凭本文断言。

---

## 1. 背景与三件只读结论（Bettor 指定的三件输入）

| # | 只读项 | 结论 | 证据 |
|---|--------|------|------|
| ① | 既有设计 + KB 防重造 | **无既有"status 处置"设计文档，不重造** | KB `products/01-broker-exchange*.md`、`roles/broker.md`、`docs/broker-test-guide.md` 均无 status 列处置；代码侧 v0.6 已做第一刀（断活代码），本文只做残留清理 |
| ② | 历史行有没有 `status='approved'` | **0 行**（2 行全 `pending`） | readonly 查 `broker_onboarding`：`qzhet8m2kk@younio2024`(7/5) + `qqqtestonb`(今日测试)，均 `status='pending'`；`WHERE status='approved'` = 0 |
| ③ | migrate.js:5127 注释是过期还是活耦合 | **纯过期描述** | 注释逐字：「status: pending → approved (Owner 经 /identities trust 批 → 派生)。审批门复用 identities.trust_level」；而 v0.6 已推翻——`approvedBrokers()` 不读 status/trust_level；`kanet-broker.js:361/389` 半A 删 trust_level 派生；`:99` status 不再回 approved。当前代码**无任何路径**实现该注释描述的耦合 |

---

## 2. 陷阱定性（为什么这是个活的隐患）

`broker_onboarding.status` 是 **vestigial 列**：唯一写入是 INSERT 的 `'pending'`（`kanet-broker.js:85`），UPDATE 不碰它（`:78/:81`），**无任何路径写 `'approved'`**。它恒等于单一值。

失败模式（未来式，不是现在坏）：
```
谁哪天在某处加一句  ... WHERE ... AND b.status = 'approved'
⇒ 对一个恒 'pending' 的列, 该谓词恒为假
⇒ approvedBrokers() 返回空 ⇒ 全部 broker 永不 fork
⇒ 而这句 SQL 完全合法, 不报任何错 —— 静默锁死
```
🔴 这正是今天数过的同族：**schema 有值 ≠ 有 active control**（死枚举 pending / m0c1-gate 目录扫不到）。共同形状 = **沉默地失败，读数与"正常"不可区分**。

---

## 3. status 列的完整读写方枚举（DROP 安全性的支撑证据）

**写入方**（2 处，均不产生 'approved'）：
- `kanet-broker.js:85` INSERT `status='pending'` — 唯一实际写入
- `kanet-broker.js:78/:81` UPDATE — **不含 status 字段**

**读取方**（3 处 SELECT，**全部是"选出来但不消费"的死读**）：
| 位置 | SELECT | 是否使用 status 值 |
|------|--------|---------------------|
| `kanet-broker.js:72` | `SELECT id, status ...` | ❌ 后续 `:73-86` 只用 `existing`(是否存在) + `hasToken`，**status 值从不被读** |
| `kanet-broker.js:367` | `SELECT ...status...` | ❌ 返回体 `:369-384` 已删 status（`:375` 注释在位） |
| `kanet-broker.js:391` | `SELECT b.status ...` | ❌ map `:397-399` 已删 status（`:395` 注释在位） |
| `broker-bot-manager.js:79` | approvedBrokers | ✅ **根本不 SELECT status**（只 `WHERE bot_token_encrypted IS NOT NULL`） |

🔵 **结论**：当前**没有任何逻辑分支依赖 status 值**。三处 SELECT 里的 `status` 是 v0.6 清理时"改了返回体但留了 SELECT 字段名"的残留。

---

## 4. 方案对比

| 方案 | 做法 | 能否堵住"读侧 gate 静默"陷阱 | 代价 | 判定 |
|------|------|------------------------------|------|------|
| C 只写注释 | 现状（`broker-bot-manager.js:71-73`） | ❌ 注释只在**人读到它**时起作用；新代码在别的文件加 gate 看不到 | 0 | Bettor 08:06 已明确不够 |
| B CHECK 约束 | `CHECK(status IN ('pending'))` | ❌ CHECK 防的是**写** 'approved'；而陷阱在**读**（`AND status='approved'` 对恒 pending 的列静默返回空，与写无关） | 低 | **不对症** |
| A' lint rule | 禁 `broker_onboarding.status` 出现在 WHERE/gate | ⚠ 部分——lint 读 index 非 worktree、只在 commit 跑、new clone 未配 hooksPath 则静默关（见 memory）；且可被改写绕过 | 低 | 弱于 A |
| **A DROP 列** | `ALTER TABLE broker_onboarding DROP COLUMN status` | ✅ **列不存在** ⇒ 任何 `b.status` 引用 = `no such column` **SQL 立即报错**，把"静默锁死全 broker"变成"启动即崩、当场发现" | 中（动 schema + 改 3 处死读 SELECT） | **推荐** |

🔴 **为什么是 A（回答 Bettor "为什么不能只写注释"）**：陷阱的失败模式是**读侧静默**。注释/CHECK/lint 都在"提交前"或"人读到"层面拦，而它们都能被绕过或看不到。**唯一把"沉默失败"变成"响亮失败"的结构性手段，是让那个列在运行时根本不存在** —— 于是错误在第一次执行到就 fail-loud，而不是等到某天有 broker 报"我的 bot 不 fork 了"。这与今天"把静默变响亮"的判据同源。

> A' (lint) 作为**备选**保留：若审者认为 DROP schema 的代价不值（例如担心未来真要加 broker 审批态需重建列），可退到 lint rule。但我推荐 A，因 DROP 是运行时 fail-loud、lint 是提交时且可绕过。请审者裁。

---

## 5. 实施步骤（过审后才执行；本文阶段一行代码都不动）

**顺序铁律：先改代码 SELECT，再上 migration DROP（同一次 commit + 同一次重启）**，否则旧进程 SELECT 不存在的列会崩。

1. **改 3 处死读 SELECT**（`kanet-broker.js`）——删掉 SELECT 里的 `status` 字段名（它们本就不消费该值，纯文本删除，零逻辑变更）：
   - `:72` `SELECT id, status` → `SELECT id`
   - `:367` 删 `status,`
   - `:391` 删 `b.status,`
2. **v194 migration**（接 v193 之后）——含**前置断言**防装载窗口内被写入：
   ```js
   // v194 (KANet-UI 2026-07-29, Bettor 批): 移除 broker_onboarding.status vestigial 列。
   //   恒 'pending' 无产生路径 ⇒ 留着 = gate 陷阱(AND status='approved' 静默锁死全 broker)。
   //   移除后任何 b.status 引用 SQL 立即报错(fail-loud)而非静默。
   {
     const cols = sqlite.prepare("PRAGMA table_info(broker_onboarding)").all();
     if (cols.some(c => c.name === 'status')) {
       const bad = sqlite.prepare("SELECT COUNT(*) AS n FROM broker_onboarding WHERE status != 'pending'").get().n;
       if (bad > 0) throw new Error(`[migrate v194] broker_onboarding 有 ${bad} 行 status != 'pending' ⇒ 停止 DROP，需人工处理`);
       sqlite.exec("ALTER TABLE broker_onboarding DROP COLUMN status");
       console.log('[migrate] v194: broker_onboarding.status 移除 (vestigial; 移除后 b.status gate 即 SQL 报错而非静默锁死)。');
     }
   }
   ```
3. **DATABASE.md 同步**：broker_onboarding 表字段更新（去 status）+ 记录 v194。

---

## 6. 影响面 / 测试 / 回滚

- **影响面**：仅 `broker_onboarding` 表 + `kanet-broker.js` 三处 SELECT。不碰 relay/结算/betting/RPC。不需为它专门重启（随下次自然重启带上，同 faucet 的处置纪律）。
- **测试**（regression case 进 `cases/broker/`）：
  1. onboard 一个新地址 → 成功、`registered:true`（不依赖 status）
  2. 重复 onboard（带/不带 token）→ 幂等，不抹已有 token
  3. GET `/onboard/status` + `/onboard/list` → 返回体正确、不含 status
  4. approvedBrokers() → fork 逻辑只看 token 存在性
  5. 🔴 **反向红队**：迁移后执行 `SELECT status FROM broker_onboarding` → 断言抛 `no such column`（证明陷阱结构性关闭 = fail-loud）
- **回滚**：v194 是加法式 migration（IF 列存在才 DROP）。若需恢复，反向 migration `ALTER TABLE ... ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`（历史 0 approved ⇒ 恢复后语义等价）。

---

## 7. 铁律 0 合规

- 动 schema（DROP COLUMN）= 铁律 0 范围 ⇒ **本设计冻结 + sha → NWT 审 → Bettor 批 → 才动 migration**。
- broker onboarding 属用户面路径（外部 broker 登记）⇒ 同样落铁律 0。
- 本文阶段：**零代码改动**，仅为送审设计 + 只读取证。
