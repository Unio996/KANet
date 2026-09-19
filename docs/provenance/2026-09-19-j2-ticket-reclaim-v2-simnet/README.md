# 2026-09-19 J2 — simnet：ticket_reclaim v2（批8，Bettor 1524 裁定②：[ticket, relay fee 输入] → [P2PK 全额, 找零]）真实共识 ACCEPT + 两条负向臂被拒 + relay fee 估算器死结实证

取代 `2026-09-19-j2-ticket-reclaim-simnet/`（单输入"builder 已完整签名"形状，提交 `5e62e24f`）。Bettor 裁定不动 relay（relay 只广播自己签过的交易），改带 relay fee 输入的形状。
本轮在**新市场 chain4**（`MARKET_ID = c5…`）上从头跑完整 1–9 步（genesis→register_append×2→market_seal→close_commit→convert_to_claim→claim_draw→withdraw→ticket_reclaim），每步断言信号 == 节点值，全部 ACCEPT。
D-021 合规：只含 simnet 数据；委员私钥信封**未入库**（sanitized 记录里已置换为占位说明）。

## 环境（提交前现核）

- 节点：PID 15972，官方 kaspad 2.0.1 simnet，只绑 127.0.0.1；`D:\rusty-kaspa-v201\kaspad.exe` sha256 `8afe6a6859067a859ac255c77946ca881cd5bbae4230a1906fff3841044c6e38`，`--version` = `kaspad 2.0.1`（与批3–8 v1 同一二进制）。
- builder/编码器 commit：`804349e3`（simnet 运行时工作树 = 提交 `c092de3a` + 同一批未提交的 v2 builder 改动；运行后 builder 代码未再改，仅改了文档）。所有交易 version = 1。
- 运行前 NWT 会话状态：本批运行时未收到其占用节点的信号。
- 运行中 fee 输入面值池耗尽一次（chain4 的 register_append#1 反复 `no_viable_change_shape`），重跑 `02_split.mjs` 两次补 0.95 KAS 的 fee UTXO 后从断点续跑；不影响证据（chain4 记录里各步都是节点真实值）。

## 结果

| 项 | 值 |
|---|---|
| ticket_reclaim txid | `08c88ca97c05f58294ab7bc51adfa618c2cc5aabcf72718dd5ef4c20cb5a8185`（区块 daa 4396） |
| 输入 | 0=输家 ticket（register_append#1 输出1，20,000,000，普通 P2SH 无 covenant；side=0，stake=1，bettorPk=委员公钥）；1=relay fee 输入（95,000,000） |
| 输出 | 0=bettor 自己的 P2PK（v0：委员 keypair 的 P2PK），**20,000,000（ticket 全额）**；1=找零回 relay 92,707,700 |
| 签名 | 输入0 由 builder 现签（v0 委员 keypair）；输入1 由 relay 签（`signInputIndices=[1]`） |
| 断言信号 storage / compute | 260 / 15,282（`inputHasCovenant=[false,false]`） |
| 节点 getMempoolEntry | storage 260 / compute 15,282 |
| 区块记录 storage / mass / compute | 260 / 260 / 15,282 |
| 三源逐位相等 | ✅ |
| fee | 2,292,300 sompi = 精确需求 1,528,200（100 × compute 15,282）× 3/2 |
| C1（节点真实 UTXO） | ticket=20,000,000，spk == 按 (bettor_pk, side, stake, marketId) 现算 ✅ |
| 上链后 | 收款输出（20,000,000）在节点上可查；旧 ticket 已被花掉 ✅ |

同一链的其余各步（断言信号 == 节点值，均 ACCEPT）：genesis 210,843/8,083；register_append#1 457,504/33,927；#2 293,116/44,198；market_seal 231,312/60,422；close_commit 134,657/35,560；convert_to_claim 231,312/48,618；claim_draw 179,586/40,407；**withdraw 231,312/30,371（`ad043593…044d`，第二个市场上复现 withdraw ACCEPT，且其篡改签名负向臂再次被节点拒）**；ticket_reclaim 260/15,282。

- **可回收闸**（builder fail-closed，先于解密/签名）：`MARKET_STATE = {closed:1, winningSide:1}` 取自 chain4 记录（见"没有证明的"第 3 条）。
- **签名前断言**：`assertTicketSigningKey` 先通过。

## 负向臂（真实共识，两条都在真笔之前提交，被拒不消耗 UTXO）

**N1 篡改签名**：只翻 ticket `bettorSig` 第 1 个签名字节 1 bit →
> `failed to verify the signature script: script ran, but verification failed`

**N2 fee 取"relay 允许的最大值"**：同一形状，fee = 2 × relay 本地 wasm 估算费 = 2 × 141,000 = **282,000**（这正是 relay 的 `validateNetLoss` 天花板；relay 会放行这个 fee），ticket 与 fee 输入均重新签名 →
> `transaction … is not standard: transaction has 282000 fees which is under the required amount of 1528200 for compute mass 15282`

## 🔴 relay fee 估算器与节点最低费之间无可行 fee（批9 接线阻塞项，比"空 signInputIndices"更深，未修）

- relay `covenant_broadcast` 在签名后用 `computeRequiredFeeSompi`（kaspa-wasm `calculateTransactionMass` × 100）估所需费，`validateNetLoss` / `validateImpliedMinerFee` 的天花板 = `min(2 × 估算, cap, 1 KAS)`。
- kaspa-wasm 本地 mass 对 v1 交易漏计 computeBudget（本项目每输入 70×100 = 7,000 mass）。ticket_reclaim 是 compute 占优形状（storage 仅 260）：relay 估算 141,000 ⇒ 天花板 282,000；节点最低费 100×compute = **1,528,200**。**没有任何 fee 同时满足两边**：付够节点 ⇒ relay 拒签（`net_loss … exceeds fee ceiling 282000`）；付到 relay 天花板 ⇒ 节点拒（N2）。
- 离线测试 ㉖ 用 relay 真代码（`kasia-relay/src/lib/covenant-broadcast.mjs` 的 `validateNetLoss`/`validateImpliedMinerFee`）表征了这一点，并给出对照臂：把 `requiredFeeSompi` 换成精确值后同一笔交易全部放行 ⇒ **唯一原因是 relay 的 fee 估算器**。relay 修好后该测试会变红，提醒同步清单。
- 其他 builder 不受影响，恰因它们 storage 占优、本地 wasm 高估（如 claim_draw 本地估算 305,471 mass vs 节点 storage 179,586）。
- 可选解（需 Bettor 裁定，均触钱路/relay）：① 修 relay `computeRequiredFeeSompi` 为精确 mass（需重验其他 kind 的天花板不被收紧到拒付）；② bettor 自行广播回收（回收是 bettor 自己的操作，不经 relay 的 kind 无关广播代理）。本批不改 relay。

## 给 NWT：请按 F3' 推 `feeProfile.ticket_reclaim.cap` 专属值

- 布局固定：[输家 ticket, fee] → [P2PK 20M, 找零]；节点值 storage=260 / compute=15,282 / 最低费 1,528,200 / builder 实付 2,292,300。当前 cap 为**暂借 1.0 KAS 占位**。
- `ticket_reclaim_full_tx.json`、`withdraw_full_tx.json`（完整交易含见证字节）、`raw-onchain-ticket-reclaim-node-records.json`（register_append#1 / claim_draw / withdraw / ticket_reclaim 区块记录）供字节层与上游 VM 验证。

## 没有证明的（不许外推）

1. n=1：一张输家票（side=0, stake=1），收款脚本为委员 keypair 的 P2PK；withdraw 在此链上是第二次复现（n=2）。
2. 签名的 bettor = 委员 keypair（v0 映射 bettor_pk === committee_pubkeys_json[0]），不是独立用户密钥。
3. `marketState={closed:1, winningSide}` 在本脚本里取自 chain4 记录，**不是**从链上 RootClose/RootClaim UTXO 状态现验的；驱动接线时必须由链上已验证状态提供。
4. 不证明"提前自花 ticket 不影响他人资金"的账目性质（NWT 账本 1491 的源码核查结论，本批未复验）。
5. 字节层独立验证（自写解析器 + 上游编码器 + 上游 VM 跑 authorize_spend）交 NWT。
6. **未经 relay 广播路径**：simnet 直接用 RPC 提交；经 relay 提交因上述死结当前不可行。
7. 未探测更低 computeBudget 能否既过共识又落入 relay 天花板（会偏离全项目统一常量 `PROTO_V0_COMPUTE_BUDGET=70`，且余量极薄，未采用）。

## 复现

`17_run_ticket_reclaim_v2.mjs.txt`（由批8 v1 的 `15_run_ticket_reclaim.mjs` 派生：新市场 chain4 完整 1–9 步）、`18_fetch_v2_records.mjs.txt`；放到 `kasia-console/scratch/_j2_simnet/` 下去掉 `.txt` 运行，需要 simnet 测试身份 state（不入库）。
