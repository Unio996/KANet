# J2 pre-activation D 项(gateway phase 透传 + G4 BUST⑧) 待审 diff（2026-07-24）

跨节点传递用临时文件，审完随本次 manifest 更新一起删除。

## 变更文件
`kasia-console/src/api/capability.js`（新 content_digest 见下）
`kasia-console/test-framework/cases/m0c1-gate/g4-pilot-custodial-e2e.mjs`（测试文件，非 manifest 管控范围）

## 新 content_digest（capability.js，sha256 hex）
```
ef47843a2f04d8512e2ef3e9d7181b305d2e386a86eaa3a3a977e861b4049504
```

## 背景

Codex MSG-122 final GREEN 放行四 MUST-FIX，但列出 4 项 armed=on 前的 pre-activation 修正（A/B/C/D）。D 项：`validateCommandPayload`（relay.mjs:340，在 `authorizeCommand` 之前）失败时回一个无结构的 503，G4 的 `reachedExecLayer` 判据用 `/RPC down|relay 侧拒绝/` 正则猜 `body.error` 文案，可能把这类"根本没到执行层"的响应误判成"到达执行层"（弱判据同款风险）。

## 发现：不需要等 relay 侧改动（J1 离线也不卡）

读 `relay.mjs` 确认：真实 execution phase 失败（RPC down/广播异常，relay.mjs:1331）本来就带 `phase:'execution'`（MF3 那次 J1 加的，跟这次 D 项无关，是既有代码）。真正的 gap 纯在 gateway 侧：`capability.js` 的 fallback 分支（无 `denied`、无 `txId` 时）回一条硬编码通用文案，把 `result.phase`（如果 relay 发了）整个吞掉不透传。

## 修法

1. **`capability.js`**：fallback 分支加 `phase: result?.phase || null` 透传到 HTTP body。`validateCommandPayload` 失败（relay.mjs:344，目前不带任何 phase 字段）和 IPC 超时（拿不到任何 result）都会是 `phase: null`——不需要区分是哪种没到执行层，统一归"非 execution"。
2. **G4 harness `reachedExecLayer`**：从 `/RPC down|relay 侧拒绝/` 正则猜文案，改成检查结构化 `r.body?.phase === 'execution'`。
3. **新增 BUST⑧**：真实端到端构造 `validateCommandPayload` 失败场景——省略 `intent.amount`（gateway 的信封结构校验只查 `intent` 顶层是 object，不查内部字段类型；amount cap 检查也只在 `'amount' in intent` 时才跑，省略等于跳过网关早拒验），一路到 relay 才被 `COMMAND_PAYLOAD_SCHEMA` 的 typeof 检查拦下。断言：`reachedExecLayer(r) === false`（真实攻击靶：验证旧正则确实会命中这条固定文案里的"RPC down"四字，误判成 `true`——用代码实测过：`/RPC down|relay 侧拒绝/.test('转账未上链（relay 无 txId，可能 RPC down 或执行失败）')` === `true`）+ `body.phase !== 'execution'`。

400 语义（Codex preferred nicety：validation 失败回 400 非 503，需要 relay 侧显式加 `phase='validation'`）留给 J1 回来后 root-fix 补，不阻塞本次（minimal 已经堵住弱判据洞本身）。

## 测试结果

G4 harness：27/27 PASS（24 既有 + 3 条新 BUST⑧ 断言）。既有回归 26/2 零新增 + lint 0 errors。

## 请求
NWT 独立核实：① sha256 digest 一致；② phase 透传逻辑真落码；③ BUST⑧ 场景真实可复现（非 mock）；④ 给 `review_ref`。
