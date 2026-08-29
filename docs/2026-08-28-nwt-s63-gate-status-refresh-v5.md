# §6-3 门现状表 v5（刷新 · 给 Owner 一页）· 2026-08-28

> **Status**: CURRENT（SUPERSEDES v4 `docs/2026-08-27-nwt-s63-gate-status-refresh-v4.md`）
> **作者 NWT · 派工 Bettor · 只读汇总不裁门。**
> 🔴 **顶层不变**：§6-3 Shape-B 设计层 CONDITIONALLY CLOSED；**没有任何一门给 build/部署/钱路 授权**。
> **本轮相对 v4 = (a) buildability 走出第一步（Codex 119ec787：a0 原语 PASS / gate (a) OPEN + 7 条最小验收）+ 7 条证据表入表**；§10 v1 code-layer 全 GREEN 收口（Codex c8b7896a）；watchdog v0.4 enable-gate 全绿。

> 🆕 **D-016 状态注记（2026-08-29 · recovery lock 锁域）**：Codex `14c81c1c` 判 v0.15 recovery 谓词 `TxTime >= OpTxInputDaaScore(input)+N` **混锁域 ⇒ 不可表达 / 设计层 REOPENED**。**NWT 独立四坐标核 = 在 lowering+共识层 refute**（收敛 J2 `cfedc5c6`，Bettor 裁 A′ / D-016）：
> - Codex 域混判断 **在源码名/上游 #214 层成立、在 pinned 8065184 lowering + live 共识层不成立** ⇒ **recovery lock 在 8065184 【可表达】、非"REOPENED 于域混"**。事实坐标：`8065184 compile.rs:2515-2516`（`TxTime → raw OpCheckLockTimeVerify`，无域标记）；`7b1e18cc opcodes/mod.rs:1031-1032`（CLTV 按数值同域判）`/:1034`（混域拒 `mismatched locktime types`）`/:1037-1038`（`stack>lock_time` 拒 `requirement not satisfied`）；`tx_validation_in_header_context.rs:56-68`（`<5e11 ⇒ DaaScore`）`/:71+`（`tx.lock_time < block_daa ⇒ finalized`）`/:83-88`（`sequence==MAX` 绕过终局）。⇒ `E = OpTxInputDaaScore+N < 5e11` 是 DAA 量级 ⇒ magnitude-determined CLTV 逼 `lock_time`(DaaScore)`≥E`、共识只在 `block DAA > E` 终局 = **真 DAA 延迟**。
> - **真 MUST-FIX（构造侧，Codex 那条掩盖了它们）**：① recovery tx 须 `lock_time = E`（DAA 数）**非 0**（现 `p2sh.mjs` 全 `lockTime:0n` ⇒ CLTV 因 `E>0` 拒 ⇒ recovery UNBUILDABLE）/ 多输入 `lock_time = max(E_i)`；② 被锁输入 `sequence ≠ MAX`；③ 源域守卫 A′ `require(E>=0); require(E<5e11); require(tx.time>=E)`（≡ 上游 `tx.daa` lowering `WITHIN[0,5e11)`）。均 builder 侧代码（另报备）。
> - **Shape-B 设计层维持 CONDITIONALLY CLOSED**（topology PASS，Codex 同意），**不因域混 REOPEN**；**gate-(a) 仍 OPEN**：源读立机制+可建性，Codex "mechanically evidenced" bar 待 **READY 后 N6（`lock_time=E-1`→UnsatisfiedLockTime）/N7（`5e11+t`→mismatched types）/N8（tip≤E→未终局）+ before/after 边界真链 land**。

## 🆕 §6-3 (a) buildability — Codex 119ec787 七条最小验收【证据清单表】

> **对象** = J2 transition probe harness（新 `.sil` `S63A_TransitionProbe(cid, t_recovery)`，1 字节 phase state 三支 transition/claim/recovery；harness 造 genesis + reveal + dry-run，**不广播、不碰 p2sh.mjs、不用 relay 钥、隔离生产钱路**）。**a0（原语可编译）= PASS**（J1 04cc8087：四支全编 460B / `OpCovOutputCount==1` 与 `==0` 两收紧形编译器接受 / 阴性对照 legacy 产物逐字节相同 = 未触 OP_PICK 路径，边界已标）。

| # | Codex (a) 判据 | 证据形态 | 谁产 | 离线可得 vs 须 READY | 对应层 |
|---|---|---|---|---|---|
| 1 | **非零权威 cid** | reveal 的 `CovenantBinding(0, Hash(cid))` 里 cid ≠ 0 + 断言 | J2 harness | 🟢 离线 | gate-(a) 精确转换 |
| 2 | **消费精确输入** | dry-run 断言 spend 的 outpoint == genesis `LOCKED_F` 那个精确 outpoint（非任意 UTXO）| J2 harness | 🟢 离线 | gate-(a) |
| 3 | **同 cid 绑定** | 🔴**承重**：生产 `_continuationAddress`（白名单 state 编码，Bettor 裁：probe state 用白名单长度族让生产函数**直接算**、删自算 splice）算出的 continuation 地址 == reveal 里的续继地址（**字节对拍生产函数、非重实现**）| J2 harness + 生产函数 = oracle | 🟢 离线 | gate-(a) 承重 |
| 4 | **后继状态真变** | 1 字节 phase state：transition/claim/recovery 三支各断言 state **实际改了**（非 no-op；NWT 加条）| J2 harness | 🟢 离线 | gate-(a) |
| 5 | **RPC 回读可进 claim/recovery 支** | 真节点回读该 covenant UTXO + 能据此构造进 claim/recovery 支的后继 tx | J2 harness broadcast 段 | 🔴 **须 READY**（真链读回，离线只能验结构） | gate-(a) + 部署路 |
| 6 | **四错形按预期理由失败** | 4 负向量（错 cid / 错输入 outpoint / 错 continuation 地址 / 错·陈 state）各带**预期拒因层**（N3 分链层已花 outpoint / 脚本层陈 state 两层；NWT 加条）| J2 harness | 🟢 离线 | gate-(a) |
| 7 | **证据 durable** | `evidence.json`（往返序列化 + 不变量 + ①②③④ 断言 + 4 负向量拒因）→ `docs/provenance/2026-08-28-s63a-transition/` | J2 + Bettor | 🟢 离线（存档） | 通则 |

- 🔴 **Scope（Codex 119ec787 原意）**：这 7 条闭的是 **"精确 Shape-B 续继 `LOCKED_F → O_AUTHORIZED` 编译 + 离线执行 + RPC 可回读"**；**不含带钱 A-covenant、不含生产钱路**（"最小部署路径 probe 即可、隔离生产钱路"）。**6/7 离线可得**（1/2/3/4/6/7）；**唯 criterion 5 的真回读须本机节点 READY**。设计证明不重开。
- **审尺**：J2 relay 侧 harness（离线构造/签名/dry-run）+ J1 `.sil`/ctor 侧（r11）落地后，NWT 逐件按此 7 行 + 3 条件（N3 两层 / splice 对拍生产 oracle 字节相等 / 证据入 provenance）审。

## 相对 v4 的其余更新（简）
- **§10 跨节点 pubkey 身份 v1 = code-layer 全 GREEN 收口**：C1→C6 + fix-ups 全 NWT GREEN、Codex c8b7896a GREEN-at-code（含 ④-8 两独立源 network CHECK 被点名认可）；**live 仍 HOLD = D-005 迁移 + Codex GREEN-at-live 八臂**（含 DB 身份阳性对照 = ANTI-PATTERNS 规则 74）。
- **watchdog v0.4 enable-gate 全绿**：probe 三态 7/8/9 + `Get-RestartDecision` 纯函数（VA-5/8/8b/8c/8d）+ enable-va spawn-override（TESTMODE 门控 + STARTUP LOUD + e2e brake-not-self-reset 闭环 8/8）；**启用仍待本机 READY + VA + NWT-GREEN + Bettor 令**（D-013 §3；Owner 已授权这组条件，非待 Owner）。
- **D-STAT-1/2/3 三条 CLOSED（设计层）**：同 v4，不重述。w_cap 取数实现四闸 + (d) 非 D-STAT 项仍 OPEN，须本机 READY。

## (a)–(h)/P3 门表（相对 v4 仅 (a) 更新）
| 门 | 状态 | 剩余 |
|---|---|---|
| **(a)** buildability | 🟡 **OPEN（a0 原语 PASS；精确转换 7 条最小验收待跑）** | 上表 7 条（6 离线 + criterion 5 须 READY）+ J2/J1 harness 落地 |
| (b) A2-whole→结算腿 | 🟡 OPEN（执行闸，判据冻） | 真 covenant + 套件机械执行 + 逐格拒因 |
| (c) cov_id durable | 🟡 (c)-1 CLOSED / (c)-2..6 OPEN | 续链上链五项 |
| (d) 具名地板 + reactive-liveness | 🟡 OPEN-PROVISIONAL（结构闭 + D-STAT 设计层 CLOSED + `B_adv` 语义 Owner 冻结 D-013 §2）| 六项残余 + w_cap 取数四闸 + Owner 具名 + 同步后实测 |
| (e) quorum 独立性 | 🔴 OPEN | §10 落地（code GREEN）+ 可复现测量 + 部署时现跑 |
| (f) 跨链 | 🟢 非阻塞（scope fail-closed）| ctor 硬断言+负测（落码）|
| (g) P1 toolchain | 🟢 CLOSED | — |
| (h) Shape-B 变异套件 | 🟢 CLOSED AT DESIGN LAYER | 机械执行=真 covenant 后 |
| P3 fee-source | 🟢 PASS（设计），(a)/(b) 二选一待 Owner | — |

## 🔴 Owner 待决（相对 v4）
- **§6-1 ⑥ 生产签发口 Track + 是否推翻 (527)**——仍待 Owner（§10 GO 已解"抢注"前提之半；推翻 (527) 仍独立 Owner 裁）。
- （§10 GO / `B_adv` 语义 / watchdog v0.3 三件已 D-013 落，B_adv 硬值等实测基线。）

**一句给 Owner**：**(a) 走出第一步**——a0 原语可编译 PASS，精确 Shape-B 续继转换有了 7 条最小验收（6 离线可跑、1 须节点 READY），J2/J1 harness 在做，NWT 按 7 行 + 3 条件逐件审；**全程零 build/deploy/money-path 授权，隔离生产钱路**。§10 v1 code-layer 收口、watchdog enable-gate 全绿。仅 §6-1 ⑥ 一件仍待你。

**引用锚**：Codex `119ec787`（(a) 七条）/ `c8b7896a`（§10 GREEN-at-code）；J1 `04cc8087`（a0 PASS）；D-013（Owner 三决）；v4 表 `docs/2026-08-27-nwt-s63-gate-status-refresh-v4.md`。
