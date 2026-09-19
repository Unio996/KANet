> **Status**: CURRENT（2026-09-20，NWT；对象 = `coord/j2-batch9-92b-driver-core-v0` 头 `5d4822af`：(i) `77bb80fe` 清理 + (ii) `38ec8d3a` 驱动核心 + S5；一轮、只报 MUST）

# 批 9 · 9-2b(i)+(ii) 审 —— NWT：**1 条 MUST（小）：出口 / relay 的确定性拒绝会被静默无限重试，零报警**

亲跑（单文件）：core 23/0、assembly 44/0、**golden 12/0（字节不变，Bettor 点名）**、c1 45/0、chain-checks 51/0、pointers 27/0、claim-draw 57/0、relay-ipc 33/0。读了核心全文与 S5 diff（`pmtEvidence` 只接受 `source==='relay'` 且距今 ≤ 60 s 的证据，过期 / 来源不明视同没传、回退 300 s 墙钟守卫——方向对）。核心无 DB / relay-manager / wasm import、无调用方，无运行时效果。

## MUST-1：广播阶段的失败一律归为 `broadcast_failed / transient:true / report:false`，包括**确定性**拒绝——每个 tick 静默重试，永远不结算也不报警
- **实测**（`outputs.txt` §1，真核心 + 桩端口，`driveIntent` 桩按真实语义把 builder 错误包成 "exhausted"）：
  - 出口闸拒绝 `proto_settlement_intent_key_invalid`（键格式不合，正是 9-2a MUST-1 在生产里会呈现的样子）⇒ `outcome=failed class=broadcast_failed transient=true`，**alerts=[]**；
  - 出口闸拒绝 `proto_settlement_driver_disabled` ⇒ 同上，无报警；
  - relay 回 `ok:false code=invalid_tx` ⇒ 同上，无报警；IPC 超时 ⇒ 同上；对照 `ok:true` ⇒ `submitted`。
- 结果：只要键形状 / 开关 / relay 侧校验有一处对不上，每个 tick 重建、重发、被拒、只写一行 `last_error`，**没有任何报警**（`prepared_stale` 只管已 prepared 的行，这里意图一直是 `pending`）。"让市场真能结算"最怕的就是这种"静默不结算"。
- **修法（便宜，报警名已在闭集里）**：① 出口闸的拒绝（错误文本含 `proto_settlement_intent_key_invalid` / `proto_intent_key_not_string` / `proto_driver_disabled` / `proto_settlement_driver_disabled`）是**确定性、非瞬时**——立即报 `settlement_step_unexpected_error`（error 级，带 code）并返回 `transient:false`；② 其余广播失败按 `(intent_key, code)` 连续 N 个 tick（可取 3，同 `ticksToError`）仍失败 ⇒ 同一报警（幂等）。测试加两条：出口闸拒绝当 tick 即有报警；`invalid_tx` 连续 3 tick 后有报警且第 4 次不重复。

## 记后续票（非 MUST，不要求下一版）
- `advanceStep` 用 `keyOf()` 算出的基础键做广播命令的 `intent_key`，而不是 `driveIntent` 回调传入的 `intentKey`：只有当行的键带 `#n`（attempt ≥ 2）时两者不同；批 9 只以 attempt=1 创建，目前不触发，但改用回调参数更稳。
- `runTick` 里对 `advanceStep` 没有按条目 `try/catch`（注释写"一个条目失败不拖垮整个 tick"）；`advanceStep` 自己的 `catch` 里若再抛（例如报警端口抛错），整个 tick 中断。
- P1 探针只把 117 个合成错误喂给 grader，全部落 `settlement_c1_programming_error`（在闭集内）；更多传输类形状我没构造。

## 没做
- J2 自报的变异 25/25 未重跑；(iii)（真实端口 / 接线 / 8 态开关 / 启动日志）未到；`claim id` 的生成（`randomBytes(32).toString('hex')`）在 (iii) 的真实端口里，届时核。

## 修正笔 `e83df356` —— 核完：**GREEN**（MUST-1 关闭）
同一条探针在修正笔上重跑（`outputs.txt` §3）：出口闸拒绝（`proto_settlement_intent_key_invalid` / `proto_settlement_driver_disabled`）当 tick 报 `settlement_step_unexpected_error`（error 级）且 `transient:false`；`invalid_tx` 单 tick 不报，**连续第 3 个 tick 报一次、第 4/5 次不重复**；`invalid_tx ×2 → 成功 → ×2` 成功清零、不报；code 每 tick 变化重计、不报；无 code 的 IPC 超时同桶计数、第 3 个 tick 报；对照 `ok:true` 仍 `submitted`。core 25/0、golden 12/0（`e83df356`）。
记票（非 MUST）：出口闸拒绝是"每个 tick 都报"（不幂等），若 tick 间隔短且报警端口不去重，会在 events 表里刷屏；接线时看一眼端口是否按 (intent_key, code) 去重。
