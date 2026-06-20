# Oracle Pool 单一源·焊死执行规范 (2026-06-05)

> 背景:2026-06-01 DECISION §2.5 已定 `oracle_pool_chain_view` = 单一读源、`oracle_pool_membership` 转 read-only legacy、lint 禁手插。**但只落地一半**:`derivePoolMerkleRoot` 迁了,relay_address 解析/status/UI 没迁;lint 从没 ship;DATABASE.md 这 3 张表一条没收录。
> 结果:settler 抽样从 chain_view(5 oracle 含 7212edc7)但 relay_address 查 legacy membership(只 4 行缺 7212edc7)→ 委员永远抽不出 → 首个跨节点 settle 卡死 ~1hr。
> **Owner 定性:"设计方案没有定死,造成问题。" 文档(设计)必要不充分,定死=焊进代码+lint+DROP+测试。**

## 0. Canonical 源(唯一真相,不可再争)

| 用途 | Canonical 表 | 写入 | 跨节点 |
|------|------|------|------|
| 池成员 + stake + lock | `oracle_pool_chain_view` (leaves_json) | scanAndDerivePool 扫链 | 同链态 → 构造一致 |
| PK → relay_address | `oracle_stake_enrollments` | enroll envelope broadcast ingest | 同 envelope → 构造一致 |

**`oracle_pool_membership` = DEPRECATED legacy。零新读、零新写。**

为什么链派生:membership 是每 Console 本地 DB 表 → :3200/:3300 各写各漂(Owner "你和 J1 不在一个端点")。chain_view/enrollments 是 broadcast ingest → 两节点读同一条链上 envelope → 物理上不可能漂。**选本地表 = 焊死也跨节点漂;选链派生 = 根上不漂。**

## 1. 六层焊死(缺一层就漂)

1. **代码层 — 单一访问器**:新模块 `src/services/oracle-pool-source.mjs`,只暴露 `getActivePool(daa)` / `resolveOracleAddress(pk)` / `getPoolLeaves(daa)`,内部只读 §0 canonical。**所有调用方走它,禁裸 SQL。**
2. **机器强制层 — lint**:`scripts/lint-kanet.mjs` 规则:`oracle_pool_membership` 出现在 [访问器, migrate.js] 之外 = 报错,commit 拦死。(DECISION L49 早要,这次必 ship。)
3. **物理层 — DROP**:读者全迁后,migrate 出版本 DROP `oracle_pool_membership`。表没了 → 残留引用立即崩(响),杜绝静默读脏数据。
4. **根因层 — 链派生 canonical**:见 §0。
5. **文档层 — DATABASE.md 收录**:补 3 张表条目;membership 标 DEPRECATED→指 canonical。
6. **测试层 — regression**:test-framework case:建市场→抽委员→断言每个抽中 PK 的 relay_address 都从 canonical 解析(今天的 bug 这 case 就抓到)。

## 2. 读者/写者审计(Bettor 2026-06-05 grep 实证)

**写者(active code):**
- `api/oracle-pool.js:128` INSERT INTO membership ← 删/改走 enroll envelope

**读者(全要迁到访问器):**
- `services/pool-market-settler-v06.mjs:185,243,350` ← 350 是 bug(J2 820a6e1 已 swap 到 enrollments,但仍裸 SQL,后续收进访问器);185/243 legacy fallback
- `api/pool.js:1724` PK→relay_id / `:1833` stake/active / `:1661,1665` status snapshot
- `api/oracle-pool.js:334` JOIN
- `ui/oracle-home.eta:408,431` UI 真池显示
- `services/trade-protocol-filter.js:460` remote rebuild

## 3. 派工(Bettor 驱动,各 owner ship)

| 层 | owner | 交付 |
|----|------|------|
| ① 访问器模块 | J2 (settler 域) | `oracle-pool-source.mjs` + settler 收进访问器 |
| ②  lint 规则 | NWT (verifier 域) | lint-kanet.mjs 加 membership 禁用规则 |
| 读者迁移 (pool.js/oracle-pool.js) | J2 | 走访问器 |
| 读者迁移 (UI oracle-home.eta) | KANet-UI | 走访问器 / status endpoint |
| ⑤ DATABASE.md 收录 | KANet-UI (数据/字典域) | 3 表条目 + DEPRECATED 标注 |
| ③ DROP 迁移 | J2 | 读者全迁后 migrate DROP(最后做) |
| ⑥ regression case | Bettor | test-framework committee-address-resolves case |
| 跨节点 | J1 | 同 commit pull + 两节点 lint 跑过 |

**顺序**:① 访问器 + 读者迁移 → ② lint(防新增) → ⑤⑥ 文档+测试 → ③ DROP(确认零读者后)。DROP 必最后,先确认 lint 跑过+无残留引用。

## 4. 守 G5

这是工程一致性硬化,不涉经济闭环声明。报"单一源焊死"按落地实证(lint 跑过 + 表 DROP + 跨节点 root 一致),非口头。
