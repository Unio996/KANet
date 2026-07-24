# M0c-1 Path B Pilot 激活部署 runbook（KANet-UI·工作流④）

> **Status**: CURRENT（v0.1 起草·待 NWT 红队 + Codex 激活就位复核 + Owner 最后拍，路由随围栏设计一并送审）
> **依据**: `docs/2026-07-23-m0c-1-path-b-pilot-containment-design.md`（围栏设计，本 runbook 是它的部署时序落地）+ 频道 19:44-19:46（两 flag 耦合 footgun）+ 19:33 relay-utxo-topology 老坑。
> **性质**: 部署编排 runbook，非设计文档——只讲"按什么顺序、每步怎么验"。
> **v0.3 更新（2026-07-24，claim-to-code 事故后自我校准）**: v0.1/v0.2 原写"安全参数以围栏设计 doc 为准"——这正是 Codex RED 抓出的转引链风险（本 runbook 当时也没有独立验证被引用的数字是否真落码，2026-07-24 05:06 自曝）。现改为逐项标代码坐标，本文档自己对每个数字负一次独立验证责任：50 KAS 钱包顶（围栏设计 §2.2，运维配置值非代码常量）/ 2 KAS 单笔（`kasia-relay/src/lib/app-envelope.mjs:79` grant `max_amount_sompi` 字段 + `kasia-console/src/api/capability.js:126` 早拒检查）/ 3 笔每分钟限流（`capability.js:48-49` `RATE_LIMIT_WINDOW_MS`+`RATE_LIMIT_MAX`，J2 `cf680280` 落码，claim-to-code 三道核 GREEN）/ 5min custodial TTL（`app-envelope.mjs:57` `CUSTODIAL_PILOT_MAX_TTL_MS`，J1 `944f2a72` 落码）/ gateway pilot-wallet 白名单（`capability.js:206` `PILOT_WALLET_ADDRESSES`，J2 `cf680280` 落码，空=fail-closed）/ grant-scoped 白名单（`app-envelope.mjs:79` `source_scope` 字段）。均已通过 claim-to-code 三道核（自核+Bettor grep+NWT 独立扫描）确认真实存在。

---

## 0. 核心事实（先讲清楚在激活什么）

**pilot 激活 = arm M0c-1 闸（`ADMIN_M0C1_GATE_ARMED=1`），不是开一个孤立的小 flag。** 今晨（2026-07-23）曾因不完整的 origin 标注就 arm 这个闸，导致三断路族事故（回滚记录见 memory `feedback-arming-gate-app-tag-without-envelope-breaks-second-family` + `reference-fail-closed-gate-arming-blast-radius-transitional-tag`）。事故后 family2/family3 全修 + `R-SENDCMD-ORIGIN-REQUIRED` 升 ERROR + NWT 138 处完整枚举 + supervisor 无残留 ARMED env 确认——**re-arm 六门前置现已就位**，本次 runbook 建立在这个前提之上，不是重新评估要不要 arm。

## 1. 两个 flag 必须同批次开（footgun，见 §2.6/§2.7 围栏设计）

- `ADMIN_CAPABILITY_GATEWAY_ENABLED=1`（网关路由，capability.js 层）
- `ADMIN_M0C1_GATE_ARMED=1`（relay 授权闸，authorize.mjs 层）

**代码坐标锚定该依赖**（不是猜测）：`kasia-relay/src/lib/authorize.mjs:66` `if (!GATE_ARMED) return {decision:'allow'}` 是无条件早返回、**在 origin 分发之前**——若只开网关 flag 忘开 relay arm，网关发出的 `origin='app'` custodial_transfer 命令到 relay 后直接放行，跳过 `authorizeAppCommand → verifyAppEnvelope → checkCustodialTransferBinding` 整条链（`kasia-relay/src/relay.mjs:490` `case 'custodial_transfer'` 直接执行 `custodialSendKaspa`，零二次校验）。这天的相当一部分工作（§3.3a 绑定器/network 四值 join/no-key-leak）在这个组合下会形同虚设，只剩网关单层防线。

**§2.7 机制补强**（网关转发前查 relay armed 状态）是纵深第二层，**不是银弹**（有理论 TOCTOU 窗口）——本 runbook 的原子开启顺序才是主防线。

## 2. Pilot relay 创建 checklist

**Footgun**（`kasia-console/src/api/relay.js:75`）：`const net = network || 'mainnet'`——创建请求体不显式传 `network` 会**静默落到 mainnet**（比选错 testnet 变体更严重，完全错链）。

- [ ] 创建 pilot relay 时请求体**显式**带 `network: 'testnet-12'`（不依赖默认值）
- [ ] 创建后立即查 DB 复核：`SELECT network FROM relay_nodes WHERE id=?` == `testnet-12`
- [ ] 现存 31 个 relay 已审计（2026-07-23）：100% `testnet-12`，此 pilot relay 是新增第 32 个，独立核验

## 3. 资金 checklist（对齐围栏设计硬止损）

- [ ] pilot 专用钱包充值 **恰好 50 KAS**（围栏设计 §2.2 硬止损顶，不多充——多充=硬止损形同虚设）
- [ ] 确认这是**独立**钱包，非复用任何现有 relay 的托管钱包（源地址白名单 grant-scoped 只认这一个地址）
- [ ] relay UTXO 拓扑健康：跑一次 `POST /api/relay/:id/split-utxos {force:true}` 确保新钱包起步不碎片化（今日 NWT-tn/J2-tn/KANet-UI-tn/Bettor-tn 均已示范，同款操作零外部地址参数、低风险）

## 4. 两 flag 原子开启顺序

**核心纪律：不允许中间态**（只开一个 flag 的时间窗 = §1 描述的漏洞窗口暴露期）。

0. **重启前查在途请求**（NWT note2：与今日 armed=on 重启前查在途 betting/settle 同款纪律，NO-TX-NO-STATE 相关——console 若在等 `custodial_transfer` 的 `sendCommandAsync` 回执时被杀，会有"不确定是否已执行"的悬空状态）：确认无正在处理中的 custodial_transfer 请求（pilot 阶段流量本就极低，直接看 relay 日志近几分钟无 `CUSTODIAL_TRANSFER` in-flight 行即可，无需查表）。
1. 停 console（正规 stop，非强杀，防 WAL 未 flush；查 stale pidfile，见今日复现 3 次的坑）
2. `kanet.env` 同一次编辑里加两行：
   ```
   ADMIN_CAPABILITY_GATEWAY_ENABLED=1
   ADMIN_M0C1_GATE_ARMED=1
   ```
3. 启动 console（不用 timeout 包裹，防连坐杀长驻 daemon）
4. **重启后立即验证**（四钥匙同款纪律）：
   - [ ] console 新 PID + 唯一实例（无并发残留）
   - [ ] relay 群起零 crash-loop（`GATE_ARMED && !GRANT_ENVELOPE_IMPLEMENTED` 会 throw，能起来=前提满足）
   - [ ] `armReport()` 读到 `armed: true`（当前无接线的健康探针 endpoint——见 §5 已知缺口，先用日志法：relay 日志出现 `[M0c-1 gate LEGACY]` warn tell 证明 armed=on 实生效）
   - [ ] `capability.js` 的 `GATEWAY_ENABLED()` 读到 true（curl 一个已知 501-scaffold 路由，确认从 503→非 503）
   - [ ] **端到端冒烟（NWT note1，不可省；Bettor 定型：单一真相源非另建第二套）**：上面四点只验证"两个 flag 各自读到 true"，不证明组合后请求能实走通完整链路（若 env 变量拼写错/指错 relay id，四点独立检查仍可能全绿但请求实际打不通）。**"激活成功"判据 = 跑一次 G4 E2E harness 全量用例**（`kasia-console/test-framework/cases/m0c1-gate/g4-pilot-custodial-e2e.mjs`，J1 harness 域交付，本 runbook 不重建、直接调用；v0.2=21 用例，含 LAND/BUST①-⑥/REPLAY/REVOCATION/TAINT，2026-07-24 claim-to-code 三道核 GREEN，sanitized evidence 见 `docs/evidence/2026-07-24-m0c1-g4-pilot-custodial-e2e-v0.2-evidence.json`）——四点独立验证 + G4 全量跑绿，两者都要；env 拼错这类"flag 读到 true 但链路实际断"的情形会被 G4 直接抓出失败。
5. **收敛类 legacy-unmigrated 面照常不断**：跑几笔现网 pool/relay/trading 操作，确认无 fail-closed 断（今晨事故的直接回归检查）

## 5. 已知缺口（诚实标，非 blocker，跟踪）

- `armReport()` 目前无 IPC 命令/health endpoint 接线（NWT 09:22 抓出的观察性 follow-up）——本 runbook §4 验证步骤暂用日志法替代，接线是后续硬化项，归我 operator/健康探针域，非本次 pilot 激活阻塞项。
- §2.7 gateway→relay armed 状态互查（TOCTOU 窗口）：J2/relay 侧实现后本 runbook §4 增补对应验证步骤。

## 6. 回退路径

同今晨验证过的路径：删 `kanet.env` 两行（或注释掉）→ 重启 → armed=off 全 inert，网关 503。**必须两行一起删/两行一起留**，不留中间态。

---

**关联**: `docs/2026-07-23-m0c-1-path-b-pilot-containment-design.md`（围栏设计权威）、`docs/2026-07-23-m0c-1-mechanism-a-http-capability-gateway-design.md`（机制A 母设计）、memory `feedback-arming-gate-app-tag-without-envelope-breaks-second-family`、`reference-fail-closed-gate-arming-blast-radius-transitional-tag`。
