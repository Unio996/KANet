# J2 Codex MSG-125 E(schema半)+D(fault-injection) 待审 diff（2026-07-24）

跨节点传递用临时文件，审完随本次 manifest 更新一起删除。**⚠ DB schema 改动 + 密钥经手 helper 改动，money-path 相关。**

## 变更文件

1. `kasia-console/src/db/migrate.js` — 新增 v193：`tg_custodial_wallets` 加 `access_mode TEXT DEFAULT 'normal'` 列。
2. `docs/DATABASE.md` — 版本历史新增 v193 条目（改表前必查铁律）。
3. `kasia-console/scripts/m0c1-pilot-custodial-insert.mjs` — INSERT 时显式设 `access_mode='capability_only'` + D 项 test-only fault-injection 钩子。digest=`354039aaae8974f4d096c2a67483247a947006d3eb05c969a760271caef8999f`
4. `kasia-console/test-framework/cases/m0c1-gate/pilot-custodial-insert-regression.mjs` — 新增 access_mode 验证 + D 项 fault-injection 测试（⑩⑪）。digest=`d8b9147f3c2b76bc5d92f77162ac0ac06663b255a98fb603b2df0c387ee70b50`

## E（schema 半）

Codex 判：legacy `/send` 靠 `process.env.PILOT_WALLET_ADDRESSES` env allowlist 隔离 pilot 钱包，env 缺失/畸形/重启未加载 = fail-open，legacy 路径会静默重新对 pilot 钱包开放——不满足"结构性不可达"。

修法：`tg_custodial_wallets` 加 `access_mode TEXT DEFAULT 'normal'` durable 列。pilot 钱包建行时（`m0c1-pilot-custodial-insert.mjs` INSERT 语句）显式设 `access_mode='capability_only'`——从诞生那一刻起就是权威 durable 标记，不依赖后续任何步骤补标。legacy `/send` 那半（KANet-UI 负责）查出行后按这一列 fail-closed 拒绝，env allowlist 降级为纵深防御早拒层。

## D（fault-injection 证据）

现有 33/33（旧数字）测试里"候选文件被篡改"场景是在 pre-check③ 阶段被挡，从未真正进到 `db.transaction()` 内部——pre-check 跟事务内 readback check 用同一份数据，结构上不会出现"pre-check 过了、事务内又失败"的自然场景，Codex 要求的"INSERT 后、readback 验证前故意抛异常"这条路径无法自然构造，必须显式注入才能验证。

修法：`M0C1_INSERT_TEST_FORCE_READBACK_FAIL=1` test-only 钩子——**production-inert**（不设这个 env 时零行为改变，代码上只是一次布尔求值 + `||` 短路，不额外分支）。测试子进程设这个 env 触发，断言：① 事务回滚后目标 `tg_user_id` 行数=0（用 `COUNT(*)` 直接证明，非"插入又清理"）② 候选文件按 NWT shred 规则②被 shred（genuine mismatch 分支）③ 对照组：不设 env 时同一套流程正常成功（证明钩子真的 production-inert，不是"平时也会随机失败"的坏钩子）。

## 测试结果

真实调用两个 CLI（execFileSync/spawnSync，非 mock）：**39/39 PASS**（原 33 条 + ①新增 access_mode 断言 + ⑩⑪ D 项 fault-injection 3 条断言）。既有回归 26/2 零新增 + G4 27/27 零回归 + provision-payee-regression 13/13 零回归 + lint 0 errors（正确检出旧 digest 失配）。

## 请求
NWT 独立核实（DB schema + 密钥经手，格外仔细）：① 2 个 digest 一致；② `access_mode='capability_only'` 真在 INSERT 语句里（非留 default）；③ D 项注入钩子真正 production-inert（不设 env 时代码路径跟改动前完全一致）；④ 给 `review_ref`。
