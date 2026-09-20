# oracle→winning_side 整合批 A(v212)—— 实现说明(2026-09-20, J2)

范围(Bettor 派单 + 设计 v0.2 §7-A / §10 R1·R4): **纯 DB 防御层**。不含 adapter、不动结算驱动 / relay / builder / 主网 live; 主网要等 Owner 批准的下次重启才应用; 先在隔离 simnet 验。

## 交付
- `kasia-console/src/db/migrate.js` v212: `proto_market_verdicts` 追加表 + `proto_markets` 加 9 列(审计 3 + 判定题 5 + 已有列不变)+ 17 个触发器(verdicts 3 + proto_markets 14: R1 13 + R4 1)。迁移幂等(列 PRAGMA 守卫、表 IF NOT EXISTS、触发器 DROP IF EXISTS 后重建)、单事务。
- `kasia-console/src/db/proto-winning-side-triggers-v212.test.mjs`: 22 例(真 migration 临时库; 含迁移幂等、INSERT 全变体、写一次、值域、status、source/set_at、operator 禁写判定题、verdict 伪造 / 错配、审计不可改、DELETE 守卫、R4 六列 × 各锁因、遗留行、驱动兼容)。
- `mutate-triggers.mjs` + `mutation-raw.txt`: 66 变异(17 整触发器删除 + 49 谓词级改写)全杀(round1 64/65 → round2 65/65 → 终版 66/66, 各轮输出 `mutation-raw-round1/2.txt` 保留); B2 的"outcome 改回 NOT NULL"是表定义、不在触发器变异钩子内, 单独做源码级变异: 2 例变红(`B2-source-level-mutation.txt`)。首轮 64/65(F12c: 只改 verdict_id 的审计不可改缺测)已补测并保留首轮输出 `mutation-raw-round1.txt`。

## 我做的判断(请审: 有别的意图告诉我)
1. **"有判定题"判据** = `resolution_rule_spec / outcome_market_source / outcome_condition_id / outcome_oracle_relay_ids` 任一非 NULL(含空串)。fail-safe 取宽: 清空字段假装无判定题走不通。`outcome_end_ms` 单独不算判定题。
2. **判定题 5 列在本批只加列、不接建市场 API**(设计 §3.1 的建市场校验属批 D / adapter 批); 都可空, 老行全 NULL = "无判定题"。
3. **R4 "锁"的时点取严**: 设计写"首笔下注或 genesis 落链后"; 我取 **genesis 一旦广播**(status 出了 genesis_pending/prepared, 或有 genesis_submitted_txid / shardleaf_txid)或已有任一下注行——比"落链"更早、更保守。
4. **`winning_side_set_at` 必填**(BEFORE 触发器不能替调用方填默认值; 用 AFTER 回填会撞审计不可改)。⇒ 主网 operator 受控 SQL 从此要多写 `winning_side_source='operator'` **和** `winning_side_set_at`(旧写法被拒——这是设计要求的破坏面, 已在 DATABASE.md 写明形)。
5. **verdicts.outcome ∈ {0,1} 或 NULL**(NWT B2: 弃权/异议是一等公民, M5 终局 / R2 需要看到不一致票): NULL 判定不能被引用提升(`v.outcome = NEW.winning_side` 对 NULL 永不成立, 提升触发器不用改)。`evidence_ref` 非空白必填(NULL outcome 也必填)。
6. **INSERT 变体**: 对已存在 id 的任何 INSERT(含 OR IGNORE / upsert DO NOTHING)现在一律 ABORT(SQLite 里 BEFORE INSERT 先于冲突处理, RAISE(ABORT) 不被 OR IGNORE 覆盖——已实测)。生产代码无此类调用; 4 个测试文件里 1 个(proto-bet-intent.test)用 OR IGNORE 重复播种同一 market, 已改成"不存在才插"。
7. **未做**: 设计 §7-A 提到的"close_commit 触发条件加 `winning_side_set_at + grace < now`"(listWork 谓词, 属结算 store/驱动, 与派单"不动 live/驱动"冲突, 且宽限窗在批 D 定义)——留给批 D。

## 同笔改的测试夹具(触发器之后 winning_side 只能在 sealed 上带 source+set_at 写一次)
`api/proto.test.mjs`(INSERT 带值 → 先 sealed 无值插入再写再置 resolved)、`proto-settlement-inputs.test.mjs`(mkMarket)、`proto-settlement-ops.test.mjs`(受控写补 source+set_at)、`proto-settlement-pointers.test.mjs`(seedChain 写值路径; "写回 NULL"用例改为造链时 `noWinner:true`)、`proto-settlement-store.test.mjs`(mkMarket)、`proto-bet-intent.test.mjs`(OR IGNORE 播种)。
回归: 上述 6 个 + proto 家族其余测试全绿; 唯一红的 `proto-relay-ipc.test.mjs` 是本 worktree 缺 kasia-relay 的 kaspa-wasm 依赖(ERR_MODULE_NOT_FOUND, 与本改动无关——在带依赖的树上须复核)。

## 诚实边界
触发器防应用 / 运维失误与手写 SQL, **不防能 DROP TRIGGER / 伪造 verdict 行的机器写权**(设计 §10 R1 末句); `human` 写入口须经带鉴权接口 + 审计(批 B 之后)。verdict 行的真实性(是不是真由抽取器 / UMA 产生)不在本批保证范围。

## 在真库副本上的验证(未碰活库)
用 better-sqlite3 backup API 从只读连接拷出主网 console 库与 9-4 simnet console 库的副本, 对副本跑本迁移: 两库都迁移成功、16 个触发器全装上、市场行数与 (id, status, winning_side) 迁移前后逐行一致; 遗留行(主网首轮 a59c: winning_side 已有值、审计列 NULL)照常——尝试改值被拒、`updated_at` 之类无关更新放行、DELETE 被拒。活库未动; 主网应用仍等 Owner 批准的下次重启。

## NWT 审批 A 的两条 MUST(delta)
- **B1**: verdicts 表 REPLACE / upsert 隐式删旧行、不触发 DELETE 触发器 ⇒ 被 winning_side_verdict_id 引用的判定记录可被改写。修: `BEFORE INSERT ON proto_market_verdicts WHEN EXISTS(同 id)` ⇒ ABORT(`trg_pmv_insert_existing_id`); 测试 D3 覆盖 普通 / OR IGNORE / OR REPLACE / REPLACE INTO / upsert DO UPDATE / DO NOTHING 六种, 且被引用行分毫不动。
- **B2**: verdicts.outcome 改为 `CHECK (outcome IS NULL OR outcome IN (0,1))`; 测试 D2(NULL 合法且 evidence_ref 仍必填)+ V1(NULL 判定对 extractor/uma/human × 0/1 都不能被引用提升)。
- 顺手做的 SHOULD 测试: Q3 六列各自 NULL↔值(锁后)、V3 把"伪造 human verdict 可被引用"钉成已知边界测试(明写不是缺陷)。
- 记票(不在本笔): R4 锁依赖的可变列(txid)写入后是否禁止清空——更稳的加固; 主网 runbook 写入 operator 受控写命令(含 source+set_at; DATABASE.md 已有示例)与"遗留行审计列停在 NULL"一句(DATABASE.md 已写)。
