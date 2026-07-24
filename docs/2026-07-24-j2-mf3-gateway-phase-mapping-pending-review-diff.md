# J2 MF3 gateway 侧 phase 映射 待审 diff（2026-07-24）

跨节点传递用临时文件，审完随本次 manifest 更新一起删除。

## 变更文件
`kasia-console/src/api/capability.js`

## 新 content_digest（sha256 hex）
```
e32c302f366a73c11267defde9f6466bc8ddb1423fd5d2c57c9ffaf0653dd6c9
```

## 变更内容

Codex MUST-FIX 3 gateway 侧：`sendCommandAsync` 结果不再只看 `txId` 有无（原逻辑把 gate-deny 和 execution-失败通吃 503），改为先看 relay 的结构化 decision（J1 relay 侧 `571441ea` 落地的三档 `phase`）：

- `result.denied === true && result.phase === 'infra_error'` → 503（relay 自己的读取/验证过程故障，如 `GRANT_REGISTRY_READ_FAILED`/`ENVELOPE_VERIFICATION_EXCEPTION`/`GRANT_ENVELOPE_STUB`，非"此请求违反规则"）。
- `result.denied === true`（其余，默认 `phase === 'authorization'`）→ 403（relay 权威闸真实拒绝，body 带 `reason_code` 稳定枚举，设计上不泄密）。
- 其余分支不变（有 `txId` → 200；无 `txId` 且非上述两档 → 503，转账未上链/RPC down）。

设计路线（频道过程，Bettor 06:35 定案）：分类判断下沉到 relay 源头（谁定义 reason_code 谁负责分类），gateway 侧代码零 reason_code 知识、纯按 `phase` 三分支 switch —— 避免 gateway 单独维护一份"哪些 reason_code 是 infra 失败"的例外表跟 relay 定义分两处漂移。

## 真对抗测试证据（真 relay fork + 真 Fastify inject，非 mock）

构造一个 `source_scope` 不匹配的信封（gateway 早拒验不覆盖 `source_scope`，只有 relay 侧 `checkIntentWithinGrant` 会拒——制造"网关早拒验没堵住、relay 权威闸独立堵住"的真实 defense-in-depth 场景）：

- HTTP 403（非旧版通吃 503）
- `body.reason_code === 'VALUE_NOT_IN_SCOPE_SOURCE'`（精确断言，非只判"没被 500"这种弱判据）
- 未误判为 200 LAND
- body 不含任何 64-hex 字符串（no-key-leak，拒绝路径也复核）

4/4 PASS。既有回归 26/2 零新增 + lint 0 errors。

## 请求
NWT 独立核实：① sha256 digest 一致；② phase 三分支映射逻辑真落码；③ 给 `review_ref`。
