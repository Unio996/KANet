# M0c-1 机制A — Path B pilot 试点围栏设计（relay 侧，配对 `docs/2026-07-23-m0c-1-path-b-pilot-containment-design.md`）

> **Status**: CURRENT（relay 侧定案+落码完成·待 NWT 红队 + Codex 激活就位复核）
> **作者**: J1（relay 侧）· 2026-07-23
> **主线依据**: Owner 批准 Path B（`#xx36z6`）→ Bettor 五工作流①「试点围栏设计」relay 侧部分。gateway 侧见配对文档，本文档不重复其内容，只讲 relay 侧增量。
> **红线**: 专用低余额 pilot 钱包做硬止损顶，绝不暴露所有用户托管钱包。
> **范围边界**: 只设计+落码围栏本身（default-off 网关背后，不影响现网），不碰激活（`ADMIN_CAPABILITY_GATEWAY_ENABLED`/`ADMIN_M0C1_GATE_ARMED` 均未动）。

---

## 1. relay 侧权威层定案：grant-scoped `source_scope`（非硬编码）

**两个候选（`#xx6ofb` 讨论过）**：
- ① 硬编码 `PILOT_WALLET_ADDRESS`（env 配置）——J1 初始倾向，理由：pilot 短命、不想为临时用途扩 grant schema。
- ② `source_scope` 新 grant 列，`checkIntentWithinGrant` 权威 enforce——Bettor 建议，理由：数据驱动非硬编码（换 pilot 钱包不用改代码）+ 天然接吊销即时生效 + 复用既有 `SCALAR_DIMENSIONS`/`payee_scope` 同款架构，不是新建机制。

**定案：采纳 ②**。J1 原提案撤回——复用现成机制的复杂度比预想低（`SCALAR_DIMENSIONS` 数组加一条 `{dim:'source', fields:['fromAddress'], grantCol:'source_scope', kind:'membership'}`，跟 `payee` 维度完全同构），而且跟这一整晚"改一处漏一处"的教训相反方向——是"少一个特例分支、多复用一层既有验证过的机制"。

**落码（`kasia-relay/src/lib/app-envelope.mjs`）**：
```js
const SCALAR_DIMENSIONS = Object.freeze([
  { dim: 'payee', fields: ['target', 'to_address'], grantCol: 'payee_scope', kind: 'membership' },
  { dim: 'amount', fields: ['amount'], grantCol: 'max_amount_sompi', kind: 'amount' },
  { dim: 'market', fields: ['marketId'], grantCol: 'market_scope', kind: 'membership' },
  { dim: 'branch', fields: ['branch', 'winner'], grantCol: 'branch_scope', kind: 'membership' },
  { dim: 'source', fields: ['fromAddress'], grantCol: 'source_scope', kind: 'membership' },  // 新增
]);
```
`checkIntentWithinGrant` 的既有循环 `if (!(f in env.intent)) continue` 天然只对声明了 `fromAddress` 字段的命令类型生效——现网唯一是 `custodial_transfer`，不影响其他命令类型（无需额外门控代码，机制本身就是按需触发）。

**NULL 语义（缺维度默认最严，同族纪律）**：grant 若不设 `source_scope`（NULL），任何含 `fromAddress` 的 intent 一律拒——这意味着**已落码的现有 `tg-wallet.js` 现网调用方**（走 `origin='legacy-unmigrated'`，根本不经过这条 `origin='app'` 专属的检查路径）**不受影响**；但未来任何走 `origin='app'` 路径的 grant，若 operator 忘了设 `--source`，自动拒绝而非"意外不限制"。

**与 `checkCustodialTransferBinding` 密码学核验的关系（两层独立，非互相替代）**：
- `checkCustodialTransferBinding`（`§3.3a`）证明"cmd 里的这把 `privkeyHex` 确实是 `fromAddress` 对应的钥匙"——防的是钥匙-地址不匹配。
- `source_scope`（本节）证明"这个 `fromAddress` 本身是这个 grant 被授权动用的"——防的是即使钥匙和地址完全自洽、签名完全合法，也不能动用未被明确授权的钱包。
- 自测 `scratch/j1-custodial-binder-smoketest.mjs` 用例 ⑧ 专门隔离验证：用一把**完全合法、密钥地址精确匹配**的另一个钱包（非 pilot 钱包）发起请求，`source_scope` 独立拦下（不是靠"钥匙不对"这条理由 deny）——这正是"绝不暴露所有用户托管钱包"红线的核心测试。

**DB 迁移**：`kasia-console/src/db/m0c1-grant-registry-schema.js` DDL 加列；`migrate.js` v191 补 `ALTER TABLE` 幂等迁移（existing DB 需要，新建库走 DDL 直接含新列）。`m0c1-grant-provision.mjs issue` 加 `--source <addr1,addr2>` 参数（同 `--payee` 模式）。

---

## 2. 全局 TTL 收紧（`MAX_ENVELOPE_TTL_MS`）

**定案（答 gateway 侧文档 §2.3 记录的选择）**：直接改全局常量（非 per-type 表）。理由：现网 zero 真实流量经 `origin='app'` 路径（唯一 consumer = 待建的 pilot 本身），收紧全局常量不影响任何现有调用方，比新增 per-type/per-grant TTL 列简单干净；pilot 结束后若要恢复给真实多用户放量，再评估是否需要拆分（M0c-2/M0c-3 范围）。**具体分钟数留红队/Bettor/Owner 拍板**（本设计不预先定死数字），落码时改这一个常量即可，无需额外结构。

---

## 3. `get_arm_status` 只读诊断命令（`§2.7`，Bettor 定为必做非可选）

**背景**：`§2.6` footgun（两个 flag——`ADMIN_CAPABILITY_GATEWAY_ENABLED`（Console/gateway 进程）与 `ADMIN_M0C1_GATE_ARMED`（relay 进程）——分批开导致 relay 侧整条验证链 fail-open 静默失效）光靠 runbook 人工纪律不够硬。Bettor 定性：这是"约定靠自觉守不住，必须上机制"同族问题，决定做运行时互查，非可选。

**落码（三处，均 relay 侧，`READONLY_ALLOWLIST` 同类只读诊断命令）**：
1. `kasia-relay/src/lib/authorize.mjs`：`READONLY_ALLOWLIST` 加 `'get_arm_status'`。
2. `kasia-relay/src/lib/commands.mjs`：注册 `COMMAND_TYPES.GET_ARM_STATUS`，required fields `[]`，无 typeof 约束（同 `get_rpc_state` 模式）。
3. `kasia-relay/src/relay.mjs`：`switch` 新增 `case 'get_arm_status'`，调用既有 `armReport()`（`authorize.mjs` 早已导出，**此前从未被任何调用点使用**——今天记的债，本次还上），直接 `process.send` 回执 `{ok:true, ...armReport()}`，短路 generic handler。

**返回形状**（`armReport()` 既有实现）：`{armed, grantEnvelopeImplemented, legacyUnmigratedPassCount, lastLegacyUnmigratedPassAt}`。gateway 侧转发 `custodial_transfer` 前先发一次 `get_arm_status`（建议 `origin='internal'`，armed=off/on 两态都无条件可答），确认 `armed===true` 才继续转发。

**诚实边界（Bettor `19:41` 自我校准，避免 over-claim）**：这不是"结构上让 footgun 不可能"——存在理论 TOCTOU 窗口（armed 状态在本次查询与 gateway 后续转发之间翻转的边缘 case，例如刚好在两次调用之间 relay 被重启回 armed=off）。这是纵深防御的**第二层、非银弹**——主防线仍是 `§2.6` 的"两 flag 必须同批次原子开启"运维硬约束 + re-arm 六门前置。`get_arm_status` 的价值是**缩小 footgun 命中窗口**（人工分步试探式激活会被立刻拦下）+ 还清 `armReport()` 从未接线的技术债，不是让运维纪律变得不必要。

**自测**：`scratch/j1-get-arm-status-test.mjs`（fork 真 relay，armed=on，直发 `get_arm_status`，断言回执含 `armed:true` 且形状符合 `armReport()` 定义）PASS。

---

## 4. 自测汇总

- `scratch/j1-custodial-binder-smoketest.mjs`：9/9 PASS（新增 ⑦⑧ 两条 `source_scope` 用例，原有 ①-⑥ 全部适配新增维度后重新通过——① 的 grant 签发补 `--source`，属于"新增强制维度导致既有正向用例的 grant 配置也要跟着补齐"的预期连锁，非回归）。
- `scratch/j1-get-arm-status-test.mjs`：PASS。
- `kasia-console/test-framework/cases/m0c1-gate/door5-origin-matrix.mjs`（门⑤回归）：9/9 PASS 无劣化。
- `node --check` 全部改动文件通过；`lint-kanet.mjs` 0 errors。

---

## 5. 与 G4 harness 的关系

`source_scope`/TTL 常量/`get_arm_status` 都是 G4 端到端 harness 的输入依赖（G4 需要一个真实带 `source_scope` 的 pilot grant + 实测 TTL 常量生效 + 可选调用 `get_arm_status` 验证 armed 状态一致性）。G4 harness 的最小正向 LAND 用例将同时作为 KANet-UI runbook §4 激活验证步骤引用的"e2e smoke"（Bettor `19:56` 定型，避免重复建两套 smoke）。

---

## 6. 诚实边界 / 待答问题

1. **TTL 具体分钟数** — 本设计不定死，留红队/Bettor/Owner 拍板（与 gateway 侧文档 §2.3 一致）。
2. **`get_arm_status` 的 TOCTOU 残留窗口** — 见 §3，诚实标为非银弹，主防线仍是两 flag 原子开启。
3. **`source_scope` 目前只在 `origin='app'` 路径生效** — `tg-wallet.js` 现网 `legacy-unmigrated` 路径不经过 `verifyAppEnvelope`，不受本设计约束（这条路径本身在今晚早些时候的 family2 修法里已有独立处理，不是本卡范围）。
4. **限流表清理机制** — 归 gateway 侧文档 §2.4，relay 侧无对应实现。
