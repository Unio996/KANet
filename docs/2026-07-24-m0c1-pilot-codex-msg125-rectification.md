# M0c-1 Path B Pilot — Codex MSG-125 审整改清单（C/E 结构性闭合 + D 证据 + 序列重排）

> **性质**: 协调工件。响应 Codex `RESPONSE-20260724-MSG125-CODEX-REVIEW` + Owner 转达。
> **Codex 判**: package 真实性 GREEN / A+B GREEN / D 代码 GREEN·但 **C 未闭 + E 未结构性闭 + D 证据不全 → 整体 RED-for-activation**。非要 terminal 安全·是"钱动之前先证/先隔离"这一族的结构性要求。
> **Bettor 认账**: E 我第二次判轻(先 defer arm-before-fund 成 optional·再用 env allowlist 而非 durable 结构控制)。这轮做到结构性。
> **审基**: 当前 tip a3193c48。改完新 tip + regen package manifest/M0a digest 重提。

## E（要害）— durable 结构隔离·env 缺失也 fail-closed

**Codex 判**: env allowlist(`process.env.PILOT_WALLET_ADDRESSES`)缺失/畸形/重启未加载时 set 空 → legacy `/send` 静默重开。runbook 靠 operator 纪律保 env=fail-open·**不满足"pilot 钱包对 legacy 路径结构性不可达"**。
**修（二选一·Bettor 定 durable DB 列方案）**:
- **durable wallet 列**: `tg_custodial_wallets` 加 `access_mode TEXT DEFAULT 'normal'`(pilot 钱包建行时 = `'capability_only'`)。legacy `/send` 查出行后·`if (w.access_mode === 'capability_only') return 403`——**从 durable 行状态拒·env 没了也拒**。env allowlist 保留作 defense-in-depth 早拒·非唯一权威。
- DB 改: migrate.js 新版本 + DATABASE.md 更新(改表前必查·加列)。
- env 边界测试(Codex req 2): configured/unset/empty/malformed env·capability_only 钱包**都拒**(durable 列兜底)。
→ @J2(schema/migrate/DATABASE.md)+ @KANet-UI(legacy 路由查列·capability 路由建行设列)·先报设计·NWT 红队。

## C — 充值前证 live Console 能解密 pilot 行（no-broadcast 诊断）

**Codex 判**: helper 自读自过是内部一致·8-hex 指纹是人工 sanity 非 runtime 证明·唯一权威是 §4.5 转账(在充值后)。要**充值前**证。
**修**:
- 新增 **no-broadcast live Console 诊断**(只读命令/API): 用 Console 真实 DB 连接读 pilot 行 → 用运行中 Console 的 key decrypt → rederive public 地址 → 只返 `{ok, address}`(绝不返/log key/mnemonic)。
- runbook: restart/arm 后、钱包**零余额**时跑这诊断·比对返回地址 == Owner 批准地址·**过了才充 50 KAS**。收据加诊断结果字段。
→ @J2/@KANet-UI(新只读诊断)+ @KANet-UI(runbook/收据)·先报设计。

## 序列重排（arm-before-fund）— Codex req 4 + finding 5

runbook 现在"建行→充 50KAS→provision grant→arm/restart→§4.5 转账证明"·**充值在验证前**。重排:
1. Owner 批不可变 package + 候选值
2. 建 capability_only durable 钱包行 + grant·**零余额**
3. start/arm + 跑 no-fund runtime DB/key/地址证明(C 诊断)+ legacy 路径拒 pilot 检查(E)
4. 上面全过·**才充 50 KAS**
5. 立即走单独授权的最小 live smoke·或 revoke/rollback
→ @KANet-UI runbook 重排。

## D 证据 — transaction-window fault-injection

**Codex 判**: 33/33 concurrency 证唯一行·但没测"INSERT 后、readback 验证前故意抛异常/进程死→零残留行"。
**修**: 加 test-only fail-closed 注入点(事务内 INSERT 后立即受控 throw·或等价)·subprocess 跑·断言退出后目标行数=0。代码 GREEN·就差这证据。
→ @J2(regression)。

## regen（Codex req 6）
所有改动的 load-bearing blob 更 M0a digest + regen package manifest/evidence。→ 最终整合我做。

## 流程（认真整改·不牙膏）
E/C 先报设计(DB schema + live 诊断·NWT 红队)→ 一批改完 → 我+NWT 三重深核(**我这轮额外: E 构造 env-unset 场景亲验 durable 列仍拒 / C 亲验诊断读的是 live 连接非 helper 自己 / D fault-injection 亲验零残留 / 序列重排整序列扫充值在验证后**)→ 一次 Codex 重提。E 这条我判轻两次·这轮做到结构性·不再靠纪律兜。
