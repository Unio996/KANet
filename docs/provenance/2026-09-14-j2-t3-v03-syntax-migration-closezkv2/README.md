# CloseZkV2.sil v1.0.0 纯语法迁移（T3 v0.3 §7 第一步）

按 Bettor ledger 1131 指示：只做机械迁移到编译通过 + 既有向量不变，不动业务逻辑、不加 scan。

## 改动清单（全部机械，零逻辑变化）

1. `entrypoint function` → `entry`（4 处：zk_close/escape_trigger/escape_claim/claim）。
2. 裸 struct 字面量 → `State { ... }`（4 处 `validateOutputState` 调用）。
3. `ScriptPubKeyP2PK` byte[34]→byte[36]（2 处，本次之前已顺手修过，见 f2fce916）。
4. 两参 `byte[](x, N)` → `x as byte[N]`（`attestedWinner,1` / `stake,8` ×2 / `payout,8` ×1）。
5. `ScriptPubKeyP2SH` 比较补 `byte[](...)` 动态转型（1 处，`zk_close` 的 gate redeem 校验）。
6. **新发现的一类（本文件独有，前三文件未撞到）**：`tx.time` 在 v1.0.0 只收 `temporal` 类型，不能直接跟
   `int` 表达式比较（`escape_trigger` 的 `tx.time >= attestedAtMs + 21600000` 必须写成
   `tx.time >= temporal(attestedAtMs + 21600000)`）——同 memory `reference-silverscript-v1rc1-...` 记过的
   "tx.time 只收 temporal" 条目，这是第一次真撞上并修复的具体案例。语义不变（比较的数值完全一样），纯类型迁移。

## 验证：既有向量 8/8 PASS（`run.log`），无一改动

`CloseZkV2.test.json`(既有, 未改动) 的 8 条向量原样跑：`zk_close_regression_vs_repro4_verified_data` /
`escape_trigger_ms_unit_pass_at_threshold` / `escape_trigger_ms_unit_fail_before_threshold` /
`claim_normal_first_winner` / `claim_dust_boundary_final_winner` / `claim_negative_wrong_merkle_proof` /
`claim_negative_closed_eq_3_should_reject` / `claim_negative_double_claim_same_index_blocked` — **全部 PASS**，
含 `escape_trigger` 的 ms 单位阈值边界向量（这条直接命中 tx.time 迁移的那一行, 迁移前该文件整体连 parse 都过
不了, 迁移后这条边界向量本身语义结果不变）。

`escape_claim` 无既有向量覆盖（如实记, 非本次引入的缺口）——已用 bisect 隔离编译通过（`scratch/_t1v06_check/
bisect.mjs` 逐 entry 隔离排查, 未入库, 一次性诊断工具, 用于定位本文件是 `escape_trigger` 撞了 tx.time 迁移坑）。

## 编译前提

`CloseZkV2.ctor.json` 的 `attestedAtMs` 用真实 epoch-ms 量级值(1700000000000)而非占位 0——占位 0 会撞
`temporal(...)` 的编译期 `LOCK_TIME_THRESHOLD`(500000000000) 检查(区分"块高"与"时间戳"两种语义域, 本身
是 v1.0.0 的正确行为, 不是 bug), 用占位 0 编译会得到误导性的"编不过"结论, 记录以免下次重复踩。
