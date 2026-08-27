# §6-3 gate (a) · LOCKED_F → O_AUTHORIZED transition probe · J2↔J1 接口稿 v0.1

> **Status**: DRAFT v0.1 · J2 2026-08-28 · Bettor 派工（Codex bridge `119ec787`：gate (a0) 原语可编译 = PASS；**gate (a) 仍 OPEN**，要的是精确 Shape-B 续继 `LOCKED_F (cov_id = locked_f_cid) → O_AUTHORIZED` 在**部署的 Toccata covenant 路径**上可构造、被共识接受、后继可按意图消费）· 计划 15 行已批-带三条（Bettor）· **等 NWT 一句再动 harness**；本稿先发 J1 对接口（频道断，走 git）。
> 🔴 **作用域**：报备层。不动 `kasia-relay/src/lib/p2sh.mjs`；产物只落 `scratch/`（NWT GREEN 后入 `docs/provenance/2026-08-28-s63a-transition/`，同 kmax v0.9 先例）；不进 `versioned-builds/`；不碰 `SILVERC_*` 路径；**READY 前只做离线部分，不广播**；广播段 = READY + (17) 清单 + ③f 之后（T+125 后），隔离地址、小额 testnet、Owner-controlled。

## §1 分工

| 谁 | 做什么 | 交付 |
|---|---|---|
| **J1** | 按 §2 草案定稿 `.sil`（可改名/改形，但 §2.3 的四个可观察量不变），用 pin `silverc-zk-8065184.exe` 编（同 `docs/2026-08-27-j1-s63-gate-a-buildability.md` 路 (i) 口径），落 `scratch/j1-s63a-transition/` | `S63A_TransitionProbe.sil` + `ctor.json` + `probe.json`（`script` / `state_layout{start,len}` / `abi`）+ 编译器 sha256 + 退出码；§3 的五个确认 |
| **J2** | harness（离线构造 genesis + reveal 两笔、离线签、序列化往返、不变量、四类负向量、证据 JSON）| `scratch/_j2_s63a_transition/` + 一页离线证据文档 |
| NWT | 审 harness 与证据 | — |
| READY 后 | 广播段（另派） | ⑤⑥ 实证 |

## §2 合约草案（J2 拟，J1 定稿）

### §2.1 设计要点（为什么这个形）
- **自身 cov_id 不能 ctor-bake**：`cov_id = covenant_id(funding.outpoint, [out])` 依赖含 ctor 的 script ⇒ 烤自身 cid 是鸡生蛋。生产 `PayoutShard.sil` 的做法是**不烤**：`validateOutputState` 编译期 lower 成"续【本 cov_id】"，relay 侧给后继输出 `CovenantBinding(authInput, Hash(inputCovId))`，共识重算验（`p2sh.mjs:1752-1830`，链上 d7c0bacc/bf389372）。本探针照此：**自身身份靠 validateOutputState + 运行时 `OpInputCovenantId(selfInIdx)` 读**，不烤。
- **LOCKED_F / O_AUTHORIZED = 同一 covenant 的两个 state**（`phase` 0→1），后继 redeem = `prefix ‖ state(phase=1) ‖ suffix`，地址变、cov_id 不变 —— 这正是 Codex 要的"同 covenant identity、后继 state/script 改变"（③④），且是 `unlockBshardConsolidate` 已证模式的最小化。
- **三支各自可观察**：`transition`（LOCKED_F 支 Fa 的最小形）/ `claim`（O_AUTHORIZED reactive-claim 的 terminal 形，`==0`）/ `recovery`（O_AUTHORIZED recovery 的 terminal 形）。四路焊 / O co-input / 反向焊**不在本探针**（那是完整 A-covenant 的事；本探针只答 gate (a) 的续继可构造性）。
- **recovery 下界暂用 baked ms**（`tx.time >= t_recovery`，已证形）。v0.15 要的 `TxTime >= OpTxInputDaaScore(O_AUTHORIZED) + N`（DAA 单位）**单列为 §3 确认 ⑤**：J1 请单独探一支 `recovery_daa` 看 (i) `OpTxInputDaaScore` 原语存在否 (ii) 能与哪个"当前 DAA"原语同单位比较——**不要**把 ms 的 `tx.time` 与 DAA 混比（NWT 钉的混单位 vacuous）。

### §2.2 草案源
```silverscript
// S63A_TransitionProbe.sil — gate (a) 精确 Shape-B 续继探针 (J2 草案 v0.1, J1 定稿)。
// 不是 A-covenant; 只证 LOCKED_F(phase=0) → O_AUTHORIZED(phase=1) 同 cov_id 续继可构造 + 后继可进 claim/recovery。
pragma silverscript ^0.1.0;

contract S63A_TransitionProbe(
    int t_recovery,        // recovery 下界 (ms, 与 ShardLeaf deadline*1000 先例同单位; DAA 锚形见 §3 ⑤ 单探)
    int init_phase         // genesis = 0 (LOCKED_F)
) {
    int phase = init_phase;   // 0 = LOCKED_F, 1 = O_AUTHORIZED   (state 1 字段 = PUSH8+8 = 9B, 以 silverc state_layout 为准)

    // —— entry 0: transition (Codex ②③④: 消费 exact LOCKED_F, 后继同 cov_id, 后继 state 有意图地变) ——
    entrypoint function transition(int selfInIdx, int selfOutIdx) {
        require(phase == 0);                                     // N3b: 陈/错 phase 的输入在此拒
        byte[32] self_cov = OpInputCovenantId(selfInIdx);       // 运行时读自身 cov_id (不烤)
        require(OpCovOutputCount(self_cov) == 1);                // 唯一续继 (a0 已证 ==1 可编)
        byte[32] out_cov = OpOutputCovenantId(selfOutIdx);
        require(out_cov == self_cov);                            // N2: 漏 CovenantBinding ⇒ out_cov≠self_cov 在此拒
        validateOutputState(selfOutIdx, { phase: 1 });           // N4: 后继 script/state 不对在此拒 (编译期 lower 续本 cov_id)
        require(tx.outputs[selfOutIdx].value == tx.inputs[selfInIdx].value);   // 全额承接, 不 skim
    }

    // —— entry 1: claim (O_AUTHORIZED reactive-claim 的 terminal 形; Codex ⑤ "能进 reactive-claim 支") ——
    entrypoint function claim(int selfInIdx) {
        require(phase == 1);
        byte[32] self_cov = OpInputCovenantId(selfInIdx);
        require(OpCovOutputCount(self_cov) == 0);                // terminal, 禁续链 (a0 已证 ==0 可编)
    }

    // —— entry 2: recovery (O_AUTHORIZED recovery 的 terminal 形; 下界暂 baked ms) ——
    entrypoint function recovery(int selfInIdx) {
        require(tx.time >= t_recovery);                          // parser 限: tx.time 只能 standalone require
        require(phase == 1);
        byte[32] self_cov = OpInputCovenantId(selfInIdx);
        require(OpCovOutputCount(self_cov) == 0);
    }
}
```

### §2.3 四个不变的可观察量（J1 改形也要保住）
1. genesis 输出 = 本合约 P2SH（phase=0）且由 relay `populateGenesisCovenants` 得**非零** cov_id（Codex ①）。
2. `transition` 消费 **exact** 那个 genesis outpoint（②），后继输出带 `CovenantBinding(selfInIdx, Hash(cov_id))` 且共识接受（③）。
3. 后继 redeem 与输入 redeem **只差 state 字节**（phase 0→1），地址变、cov_id 不变（④ "非 no-op"）。
4. 后继能走 `claim`（`==0`）或 `recovery`（⑤）；负向量 N1–N4 各在预期层被拒（⑥）。

## §3 请 J1 确认的五件（回 §1 交付里）
① `validateOutputState(idx, { phase: 1 })` 对**单 int 字段 state** 可编译，且 `state_layout.{start,len}` 值（预期 len=9）；② `OpInputCovenantId(selfInIdx)` 传入的是**本输入自己的索引**时可读（自身 cov_id 运行时读，非烤）——若 parser/语义要求 self 用别的形（如隐式 self），照实改；③ entry 编号 = 声明序 0/1/2，scriptSig 形 = `args pushes ‖ selector ‖ push(redeem)`（同 `unlockBshardConsolidate` `_pushInt(0)+_pushInt(1)+'00'+push(redeem)`）——请贴 probe.json `abi` 确认参数序；④ `tx.outputs[i].value == tx.inputs[j].value` 双索引形可编（ShardLeaf:106 有先例，只确认）；⑤ **单探一支** `recovery_daa(int selfInIdx)`：`require(<当前DAA原语> >= OpTxInputDaaScore(selfInIdx) + N)`——报 (i) 原语存在否 (ii) 同单位可比否；编不出就报编不出，**不要**用 `tx.time` 顶替。
- 编译产物：`scratch/j1-s63a-transition/{S63A_TransitionProbe.sil, ctor.json, probe.json}` + `sha256sum silverc-zk-8065184.exe` + 退出码；同 J1 buildability 报告的阴性对照（legacy 编译器）可选。

## §4 J2 harness 摘要（细节在计划 15 行；此处只列 J1 相关的接口）
- 从 `probe.json.script`（number[]）得 redeem@phase0；state splice 用 `state_layout.start/len`；后继 redeem = 自算 splice（**不调**生产 `_continuationAddress`——它的长度白名单不含 9B；但 harness 自测第一条 = 用白名单内 payoutshard 族已知 state 与生产函数**字节对拍**，防复刻漂移，Bettor 条件②）。
- 负向量：N1 错 cid（`CovenantBinding(0, Hash(other))` ⇒ 共识层拒）；N2 漏 binding（⇒ 脚本 `out_cov == self_cov` 拒）；**N3a** 链层 = 花已消费 outpoint（missing outpoint/orphan，链的事）；**N3b** 脚本层 = phase=1 的 UTXO 再走 `transition`（⇒ `require(phase==0)` 拒）；N4 错后继 script（phase 未变或别的模板 ⇒ `validateOutputState` 拒）。离线只能钉"哪一层、哪条 require"，拒绝码 READY 后实测。
- 证据（Codex ⑦）：.sil sha256 / ctor / 编译器 sha256+版本 / `script` hash / 两笔 tx JSON + 离线 txid / 四负向量 tx + 预期拒因 / MANIFEST。

## §5 顺序
J1 编译 + §3 五确认 → J2 harness（NWT 一句后）→ NWT 审 → 入 provenance → READY 后广播段（不与 (17)/③f 抢）。
