# 9-2b (ii) 补笔：NWT e4039235 MUST（广播阶段失败不再静默）

- 出口分闸四种确定性拒绝（`proto_settlement_intent_key_invalid` / `proto_intent_key_not_string` / `proto_driver_disabled` / `proto_settlement_driver_disabled`）⇒ 当 tick 立即 `settlement_step_unexpected_error`（error），`transient:false`
- 其余广播失败按 `(intent_key, code)` 连续 3 个不同 tick ⇒ 同一报警一次（幂等，成功清零，code 变了重计）
- 测试末行 25/0；变异 8/8（首轮 F6 幸存已补强，`mutation-raw-round1.txt` 保留）；lint 见 lint.txt
- 记票未做（NWT）：advanceStep 广播用 keyOf() 基础键（仅 #n 不同）；runTick 对 advanceStep 无按条目 try/catch
