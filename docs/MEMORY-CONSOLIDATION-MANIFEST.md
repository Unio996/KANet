# Memory → KB 整合 Manifest (D-004 · 清单先行·分族门控·防知识层规则49)

> **Status**: CURRENT (2026-07-06 建·Bettor)
> **为什么**: 264 个 `.claude/memory/*.md` 碎片(框架 <200 行索引早 truncate) → 按族合并回 KB durable 家(D-004)。
> **Owner 硬门(2026-07-06)**: 禁一把梭(=知识层规则49)。清单先行 + 分族门控(每族 STOP) + 旧址同轮盖章 + 合并 commit 与标废 commit 分开。
> **KB git 化前置**: ✅ DONE(baseline `19a4155`·后续 un-stale 可考古 diff)。

---

## 流程 DoD(每族一批·缺一不算完)

1. **列全族清单** → 每条标去向: `MERGE→KB/<path>` / `KEEP(session-fact 保留 memory)` / `DROP(弃置+理由)`。禁"合并后对不上账"。
2. **合并** → durable 内容进 KB 目标文件(commit A)。
3. **旧址同轮盖章** → memory 原文件 + docs/ 对应旧址挂 `> SUPERSEDED-BY: KB/<path> (date)`(commit B·与 A 分开)。
4. **索引更新** → MEMORY.md 移除已合并条(缩回 <200 行索引限)。
5. **STOP 报告** → 本批去向表 + commit hash + "方向 accept ≠ 免门控"显式确认 → Owner/下批放行。

**验收计数(疗效·7/8 retro)**: 本周"炒陈饭事件数"(引用已废决策/重开已决议题)。此数不降 = KB 白建。

---

## 族索引(分批顺序·264 条)

| 族 | 主题 | 数量* | 合并目标 KB 区 | 批次 |
|---|---|---|---|---|
| **A** | 结算/DB-lag/daemon/phantom/claim/bshard | ~70 | `architecture/` settle 专章 + `invariants/` | 批2-4 |
| **B** | silverscript/covenant/cov_id/SS 原语 | ~39 | `architecture/` SS-capabilities | 批5 |
| **C(ZK)** | ZK/oracle-settle/UMA | 11(ZK 子) | `architecture/zk-track-c-verified-trustless-settle.md` | **批1(本批)** |
| **D** | 协调/Bettor 角色/审核/派工 | ~30 | `roles/` + `infrastructure/01-dev-coord` | 批6 |
| **E** | Owner 纪律/口径/测试网/用户面 | ~24 | `00-position/` + `roles/` | 批7 |
| **F** | TN12/挖矿/节点/relay/console 运维 | ~38 | `infrastructure/` | 批8 |
*grep 有重叠·精确归属在各批清单定。全量 264 主列表见文末附录。

---

## 🔴 批1: ZK-settle 子族(11 条)去向表(待 Owner 确认流程后执行)

> 合并目标: `KB/architecture/zk-track-c-verified-trustless-settle.md`(已存)+ 新增"ZK↔rolling 决策史"章。**去向仅提案·STOP 待确认再动手。**

| # | memory 文件 | 提案去向 | 理由 |
|---|---|---|---|
| 1 | `reference-zk-vs-rolling-shard-full-history-2026-07-06.md` | **MERGE→KB zk-track(决策史章)** | 今天新建的权威史·durable·应进 KB(DECISIONS.md D-001 存精简版·KB 存详版) |
| 2 | `reference-zk-terminology-three-tiers-conflated-in-docs.md` | **MERGE→KB zk-track(术语正名章)** | "ZK 标签三层混用"=今晚混乱源·durable 正名 |
| 3 | `reference-zk-decision-gate-closed-rolling.md` | **MERGE→KB zk-track(决策史章)** | ZK→rolling 决策门·durable |
| 4 | `project-zk-settle-e2e-core-proven-binding-blocked-oppick.md` | **MERGE→KB zk-track(blocker 章)** | OP_PICK blocker 技术实相·durable(J2 ZK 可行性核实要用) |
| 5 | `project-zk-settle-payout-toolchain-proven-design-locked.md` | **MERGE→KB zk-track(design-locked 章)** | ZK 地基设计·durable |
| 6 | `project-zk-interim-b-full-e2e-landed-pb73v.md` | **MERGE→KB zk-track(单片 LANDED 章)** | 单片 ZK e2e 实证·durable |
| 7 | `project-multishard-zk-settle-assembled-gp8hy.md` | **MERGE→KB zk-track(多片=committee-sig 章)** | 多片"ZK"实为 committee-sig 正名·durable |
| 8 | `project-phaseA-landed-and-zk-active-tn12.md` | **MERGE→KB zk-track(链上 active 章)** | OpZkPrecompile active·durable |
| 9 | `reference-zk-toolchain-fork-has-verifier-not-builder-port-953-sdk.md` | **MERGE→KB zk-track(工具链缺口章)** | verifier 有/builder 无·J2 可行性核实要用·durable |
| 10 | `feedback-owner-directed-zk-heed-architecture-over-tactical-debug.md` | **KEEP(feedback)** | 是 feedback 纪律(听架构方向)·非 ZK 技术事实·留 memory |
| 11 | `project-bot-ux-oneclick-landed-b-zk-fresh-ready.md` | **KEEP(session-fact)** | 名含 zk 但实为 bot UX 里程碑·非 ZK 技术·留 memory |

**批1 净效果**: 9 条 ZK 技术知识 → KB zk-track(单一 durable 家) + 2 条留 memory(feedback/session-fact)。合并后 KB zk-track = ZK 完整真相(史+术语+blocker+单片证+多片正名),彻底 resolve"ZK 在跑吗"这盘·配 DECISIONS.md D-001。

---

## STOP 点(批1·"方向 accept ≠ 免门控")

**待 Owner/团队确认**:① 上表去向流程对不对 ② 每族一 STOP、合并/标废 commit 分开 ③ 旧址同轮盖章。确认后我执行批1(合并→KB + 旧址盖章 + 索引更新),报 commit hash,再放批2。

---

## 📊 批1 执行记录(2026-07-06·Owner 放行)

### 计数 reconcile(条件一·265→264→265 对账·零丢失)
- **"265"(早期口径·D-003/004 讨论)** = 264 记忆条 + 1 `MEMORY.md`(索引本身非记忆条)。含索引 265·计数习惯差。
- **"264"(manifest 快照 `/tmp/_mem_all.txt`)** = 纯记忆条(不含索引)。
- **"265"(现在·纯记忆条)** = 快照后 **+1 新建**: `feedback-verify-background-process-exit-not-just-output.md`(J2 孤儿脚本教训·会话中活生生新增 = 增殖问题实证)。
- **三数钉死**: 含索引 266 / 纯记忆条 265 / manifest 快照时 264。**零静默丢失**·差异全有据。新条纳批2 族归属(候选族 F 运维/进程卫生)。

### 批1 双 commit(合并/标废分开·DoD)
- **commit A(合并·KB repo)**: `82adacb` — KB `architecture/zk-track-c` §9 un-stale(9.1 时间线/9.2 术语三层正名/9.3 待办)。
- **commit B(标废·主 repo)**: 见本次提交 — 9 MERGE memory 挂 `SUPERSEDED-BY→KB §9`(旧址同轮盖章) + manifest 批1 记录。
- **KEEP 2 条**未动(feedback-owner-directed-zk / bot-ux-oneclick·非 ZK 技术)。
- **防重述丢细节(Owner 提醒)**: §9 保留坐标(pb73v/gp8hy 市场码·OP_PICK bug 名·6/28-7/06 日期·13 轮 bisect·955=442+64+449·commit 82adacb),非概括化。

## 🔴 批2 开闸前置(Owner 条件二)
**全量 265 条族归属分配表**(每条至少一个族名·防落族缝静默丢失)**必须批2 前落地**。per-item disposition 仍按批做·但族归属先全锁。下一动作 = 出这张全量族归属表。

## 全量主列表附录
- 快照 264 条: `/tmp/_mem_all.txt`(临时)→ **族归属表落地时固化进本文附录**(批2 前置)。
