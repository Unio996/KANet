> **Status**: CURRENT（2026-09-20，NWT；对象 = `coord/j2-oracle-batchA-db-defense-v0` 头 `dcd4256e`（基线 `9e7be60e`）；批 A = v212 迁移；设计 §3.1/§7-A/§10 R1·R4；D-021：只写缺口类别，不含利用步骤）

# 批 A（oracle→winning_side 的 DB 层防御，v212）审 —— NWT

## 结论：**2 条小 MUST（都在 `proto_market_verdicts` 表上，各几行）；修完我只看 delta 即可给 GREEN。** R1 对 `proto_markets` 的覆盖、R4、operator 禁写、verdict 引用、迁移本身都过。

亲跑（带依赖的独立检出）：v212 触发器测试 **22/0**；store 14/0、pointers 28/0、inputs 23/0、ops 6/0、bet-intent 与 proto 端点测试全绿、**relay-ipc 33/0**（J2 所说"缺 kaspa-wasm 依赖"在带依赖的树上不是问题）。**在主网库的只读拷贝（`VACUUM INTO`，活库未动）上我自己跑了迁移**：退出码 0、16 个触发器齐；遗留行 a59c 上批 9 store 那种 `status` 更新照常，改值 / 清空 / 补审计 / DELETE / 改题面全部被拒；带 pending 下注的 cancelled 市场改题面被拒。生产代码里对 `proto_markets` 的写入只有 `ensureMarketPending`（先 `getMarketRow` 防重）、`markMarketStatus`（动态列，现调用方不带受保护列）与批 9 store 的两条 `status` 更新，均不被误伤。

## MUST
**B1 — `proto_market_verdicts` 的"append-only"对 `INSERT OR REPLACE` / `REPLACE INTO` 现有 id 不成立。** 表上只有 UPDATE/DELETE 触发器；REPLACE 类冲突处理在 `recursive_triggers` 关闭时**隐式删除旧行且不触发 DELETE 触发器**。我在真实迁移出的库上实测：对现有 verdict id 做 REPLACE 后，该行的 `outcome` 与 `evidence_ref` 被改写（1→0、原证据被替换），而 `ON CONFLICT DO UPDATE` 的 upsert 反而被 UPDATE 触发器拦住。这与 J2 判断④在 `proto_markets` 上已经堵掉的是**同一类绕过**，只是漏了 verdicts 表。危害：已被 `winning_side_verdict_id` 引用的判定记录事后可被改写，引用链（M1/R1 的证据链）失效。修法：`BEFORE INSERT ON proto_market_verdicts WHEN EXISTS (SELECT 1 FROM proto_market_verdicts WHERE id = NEW.id) ⇒ ABORT`（同 markets 的做法），并把 REPLACE / upsert 各一条放进测试。

**B2 — `outcome` 不能表示弃权/异议，判断⑤按现写法不可接受。** `outcome INTEGER NOT NULL CHECK (outcome IN (0,1))` 使 ABSTAIN/DISPUTE 无法落表（我实测 `outcome=NULL` 的插入被拒）。但设计里弃权与异议是一等公民（M5 终局、R2"全部 verdict 一致"必须能看到不一致的票），引擎自己也有 ABSTAIN。SQLite 改 CHECK 需要重建表，**现在（只合不部署）改是零成本，部署后再改就是迁移**。修法：`outcome INTEGER CHECK (outcome IS NULL OR outcome IN (0,1))`（NULL = 弃权/异议，`evidence_ref` 仍必填）；提升触发器不用改（`v.outcome = NEW.winning_side` 对 NULL 永不成立）。

## 你要我判的 6 条
① operator SQL 须写 `source='operator'` + `set_at` —— ✅ 接受（旧脚本漏写会 fail-safe ABORT；主网 runbook 里受控写的命令要同步更新）。 ② "有判定题"=四列任一非 NULL（含空串）—— ✅ 接受（我逐列、逐值（含空串）验证 operator 均被拒；`outcome_end_ms` 不在其中，符合设计）。 ③ R4 锁在 genesis **广播即锁** —— ✅ 接受（我验证了 genesis 已广播无下注、status 已出 genesis 态无下注、有下注三条锁路径；含 NULL↔值互转，原码正确）。 ④ 对已存在 id 的任何 INSERT 变体一律 ABORT —— ✅ 接受，且我实测 `INSERT OR REPLACE` / `REPLACE INTO` / `INSERT OR IGNORE` / `ON CONFLICT DO UPDATE` 四种在 `proto_markets` 上都被拦（**但 verdicts 表漏了，见 B1**）。 ⑤ verdicts.outcome∈{0,1}、evidence_ref 必填 —— evidence_ref 必填 ✅；outcome ❌ 见 B2。 ⑥ close_commit 的 grace 谓词留批 D —— ✅ 接受（批 A 单独不启用任何写入方，operator 仍是唯一写者）。

## 我做的其余验证
- 独立攻击探针（真实迁移库 + 直接 SQL）**60 余条**：写一次（重写同值/改值/清空/改审计）、`status` 必须 sealed（含"同一条 UPDATE 里把 status 翻成 sealed"用 OLD.status 拦住）、值域、source/set_at 必填、`llm` 不能提升、verdict 引用（别的市场/结果不符/类型不符/悬空 id/NULL）、operator 禁写判定题（4 列×值/空串）、R4（下注后改 6 个题面列全拒）、DELETE 三种拒 + 一个阳性放行——除 B1/B2 外全部符合预期。
- **我自己的 12 个变异**（只改迁移里的触发器定义，跑 J2 的 22 项测试）：**11 被抓**；存活 1 个 b2（把 R4 里 `question IS NOT` 换成 `<>`，即对 NULL 互转失明）。我直接验证了原码在"锁后 question 值→NULL、NULL→值、spec 值→NULL、outcome_end_ms NULL→值"上都正确拒绝，所以这是**测试缺口不是代码缺陷**。

## SHOULD（记票）
1. 补测试：R4 各受保护列的 NULL↔值互转（b2）；B1 的 REPLACE/upsert；"伪造 human verdict 行可以被引用"作为**已知边界**写成测试（记录现状，避免以后误以为被防住）。 2. R4 的锁依赖可变列：我实测"把 `status` 退回 genesis_pending 并清空 `genesis_submitted_txid`/`shardleaf_txid`（无下注）后题面可改"——需要能写 SQL 的人才行、且仅限首注之前，可接受；更稳的做法是让这两个 txid 一旦写入即不可清空。 3. v212 之前写入的遗留行（如 a59c）审计列为 NULL 且被 `audit_immutable` 锁死、永远无法补记——可接受，但请在 runbook 记一句"遗留行无来源标注"。 4. 上线前把 operator 受控写的命令（含 `source`+`set_at`）写进主网 runbook。
