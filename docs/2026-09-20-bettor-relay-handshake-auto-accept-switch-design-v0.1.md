# 设计稿：relay 入站握手自动接受加开关（主网默认关）v0.1

> **Status**: CURRENT
>
> 起草 Bettor（架构师帽）· 2026-09-20 · 依据 Owner 本机终端原话「自动接单置 false，握手也加开关，主网默认关。」（DECISIONS.md **D-027** 决定 ②）· 起因 COORD-LEDGER (1554)：KANet-UI 只读盘点发现 relay 进程内建"入站握手自动接受"，收到新对端握手即发一笔接受交易，无任何开关；(1557) 该项的评估细节按 D-021 不入公开仓库，本页只写缓解设计。
>
> **执行门**：本页只是设计。顺序 = 本页 → NWT 设计审（审的是缓解设计，不是漏洞评估）→ Bettor 派实现 → NWT 审 diff → 合入 → 随下一次 console 重启（relay 子进程重启）生效。**Bettor 不写代码。**
>
> **写作依 D-021**：不含密钥、地址、余额；不写攻击路径与量级评估。

## 0. 结论

给 relay 加 env 开关 `RELAY_HANDSHAKE_AUTO_ACCEPT`，只认字面 `'1'`，**所有网络默认关**（同 D-026 约定）；主网 env 不写键（不写 = 关）。关闭态：入站握手照常登记（ingestTx / ingestMessage / pending_actions 不变），**不 claim、不 acceptHandshake、不 sendKaspa、不发问候**，每次留一行日志并 return；追赶路径（catchUpHistory 第 1 段 pending handshakes）整段跳过并留一行；relay 启动时打恰一行 disabled。开启态行为逐字节不变。

## 1. 现状（只读实核，2026-09-20）

| 项 | 读数 | 出处 |
|---|---|---|
| 实时路径 | `processHandshake(txId, payloadHex, senderAddress)`：step 1 ingestTx → BLOCKED 名单检查 → step 2 内存去重 → step 3 DB 去重 → step 4 ingestMessage（登记进 console，触发 pending_actions）→ step 5 claim（console API 原子锁）→ `acceptHandshake` → `sendKaspa` → 记 accept、markSeen → 可选问候再 `sendKaspa` | `kasia-relay/src/rpc-listener.mjs:900-1010`（step 标记行 917 / 920 / 931 / 944 / 953 / 983 / 985） |
| 追赶路径 | `catchUpHistory()` 第 1 段：从 console `/ingest/pending-handshakes` 取 pending，逐个 claim 后 `acceptHandshake` + `sendKaspa` | `rpc-listener.mjs:542-607` |
| 既有 env 闸先例（relay 内） | `KANET_CATCHUP_COMM === 'on'` 控追赶路径第 3 段，关闭态打 `catch-up comm: DISABLED (KANET_CATCHUP_COMM!=on)` | `rpc-listener.mjs:659-670` |
| relay 拿 env 的方式 | console 用 `fork('src/relay.mjs', [], { env })`，`env = { ...process.env, …密钥项 }` ⇒ console 注入的 env 原样流入 relay，无白名单 | `kasia-console/src/services/relay-manager.js:228-252` |
| 主网现状 | 本次与死机前两份 console stdout `HANDSHAKE ACCEPTED` 均 0 行（只证明这两个窗口没发生） | (1554) |

## 2. 设计

### 2.1 开关与语义
- 键名 `RELAY_HANDSHAKE_AUTO_ACCEPT`；**只认字面 `'1'`**（`'on'`、`'true'`、`' 1'`、`'"1"'`、未设等一律关），与 D-026 两开关同一约定；不沿用 `KANET_CATCHUP_COMM` 的 `'on'` 写法，避免仓内出现第三种"开"的拼法（那条既有闸不动）。
- 读取位置：模块顶层一次读入常量 `HANDSHAKE_AUTO_ACCEPT = process.env.RELAY_HANDSHAKE_AUTO_ACCEPT === '1'`（relay 子进程生命周期内 env 不变；与 console 侧"每次调用读"不同，这里进程级常量即可，但**测试须能注入**，见 2.4）。
- 默认关、不按网络分支（D-017 后只剩主网；与 D-026 §2.3 同理）。

### 2.2 三个落点
1. **启动日志**（`rpc-listener.mjs` 现 `protocol support: handshake, comm, payment` 那行附近）：关闭态恰一行 `handshake auto-accept: DISABLED (RELAY_HANDSHAKE_AUTO_ACCEPT!=1, raw=<JSON.stringify 原始值>)`；开启态一行 `handshake auto-accept: ENABLED`。console 侧会以 `[relay:<name>]` 前缀转发，18 个 relay 各一行 ⇒ 部署后 `grep -c 'handshake auto-accept: DISABLED'` 应恰等于 relay 子进程数。
2. **实时路径**：闸放在 **step 4 之后、step 5 claim 之前**——入站握手已被 ingestTx / ingestMessage 登记、pending_actions 行已由 console 建出（保留人工处理的可能）；关闭态打一行 `HANDSHAKE auto-accept disabled — left pending for <last12>`，**不 claim、不 markSeen**（与"漏洞 #6 fix"的注释一致：不 markSeen 才保留将来打开开关后由追赶路径接手的能力），return。
3. **追赶路径**：`catchUpHistory()` 第 1 段整段用同一常量包住，关闭态打一行 `catch-up handshakes: DISABLED (RELAY_HANDSHAKE_AUTO_ACCEPT!=1) — <n> pending left`（n 可选，取自 console 查询；查询本身只读可保留），`handshakeCount` 恒 0；第 2 / 3 段不动。

### 2.3 不做什么
- 不动 `acceptHandshake` / `sendKaspa` / `chain.mjs`；不动 console 侧 `/ingest/pending-handshakes` API 与 pending_actions 状态机；不动 BLOCKED 名单逻辑；不动 `KANET_CATCHUP_COMM`。
- 不加"按对端白名单接受"之类的策略——那是另一个设计，本页只做总闸。
- 不改 `kanet.mainnet.env`；`kanet.env.example` 加一行注释掉的键 + 说明（同 D-026 SHOULD ②）。

### 2.4 可测性
`rpc-listener.mjs` 是长驻监听模块，静态 import `chain.mjs`。为让闸可被单测：把判定抽成小纯函数 `handshakeAutoAcceptEnabled(env = process.env)`（导出），三个落点都调它；`processHandshake` 与 `catchUpHistory` 若无法在测试里直接驱动，实现者用 `--experimental-test-module-mocks` mock `./chain.mjs` 的 `acceptHandshake` / `sendKaspa` 与 console fetch，断言关闭态零调用（console 测试已有此模式先例）。

## 3. 验收判据（落码时逐条过，每条带变异对照）

| # | 判据 | 变异对照（必红） |
|---|---|---|
| V1 | `handshakeAutoAcceptEnabled` 对未设 / `'0'` / `'on'` / `'true'` / `' 1'` / `'"1"'` / `''` / `'01'` / 全角 `'１'` / `'1\n'` 全部为 false，`'1'` 为 true | 改成宽松判断 ⇒ `'on'` 或 `'true'` 那条红 |
| V2 | 关闭态 `processHandshake`：ingestTx 与 ingestMessage 各被调 1 次（登记不变），claim fetch 0 次、`acceptHandshake` 0 次、`sendKaspa` 0 次、markSeen 0 次，stdout 恰一行 `HANDSHAKE auto-accept disabled` | 删闸 ⇒ V2 红；闸挪到 step 4 之前 ⇒ "ingestMessage 1 次"红 |
| V3 | 关闭态 `catchUpHistory` 第 1 段：`acceptHandshake` 0 次、`sendKaspa` 0 次、claim 0 次，一行 `catch-up handshakes: DISABLED`；第 2 / 3 段行为不变 | 删追赶闸 ⇒ V3 红 |
| V4 | 开启态（env=`'1'`）：既有行为逐字节不变（现有涉及握手的测试若有则原样通过；无则加一条"开启态 sendKaspa 恰 1 次"的阳性对照） | 闸写反 ⇒ 阳性对照红 |
| V5 | 启动日志恰一行 DISABLED（关闭）或 ENABLED（开启），带 raw | — |
| V6 | 部署后（下一次 console 重启）：console stdout 中 `handshake auto-accept: DISABLED` 行数 == relay.mjs 子进程数（现 18）；`HANDSHAKE ACCEPTED` 0 行；`auto-accepting handshake` 0 行 | — |
| V7 | 现场 `grep -cE '^\s*RELAY_HANDSHAKE_AUTO_ACCEPT=' kanet.mainnet.env` = 0（静态辅助，权威是 V6）；`kanet.env.example` 有注释行 | — |
| V8 | lint-kanet 0 error；回执附各测试原始输出与变异输出 | — |

## 4. 上线
- 合入主线后不自动生效：relay 是 console 子进程，随下一次 console 重启（与 D-026 / 9-0 relay 重启同批）加载新代码；不为本页单独重启。
- 上线后 pending 的入站握手会停在 pending_actions（不再自动接受），是预期行为；将来若要恢复自动接受，写 `RELAY_HANDSHAKE_AUTO_ACCEPT=1` 进主网 env = 另一次钱路决定，须 Owner 单独批。
- P2 守卫清单（(1569) N-2 第二类）加一项：`RELAY_HANDSHAKE_AUTO_ACCEPT` 不得为 `1`。

## 5. 给 NWT 的审点
- 2.2-2 闸的位置（step 4 后、step 5 前）：登记保留、不 claim 不 markSeen，与既有"漏洞 #6 fix"语义是否一致，有没有会让 pending 行无限堆积的副作用（console 侧 pending_actions 有没有过期机制）。
- 2.1 进程级常量 vs 每次读：relay 生命周期内 env 不变，你判是否接受。
- 追赶路径关闭后 `catch-up done` 汇总行仍打印、计数为 0，是否会被别的监控误读为"正常追赶完成"。
- 2.3 不做对端白名单：你判是否需要在本页之外另开票。
- V2 的"ingestMessage 1 次"是否足以证明登记不变，还是要断言 pending_actions 行真被建出（需 console 侧参与）。
