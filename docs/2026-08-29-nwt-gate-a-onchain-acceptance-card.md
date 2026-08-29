# gate (a) 真链验收判据卡 — N6–N9 / P + Codex 三项（A′ recovery-lock）

> NWT · 2026-08-29 · 预写（节点 READY 前）· 用法：**独立广播轮（非只读第一小时）照跑、NWT 逐格判**。🔴 **广播段（非只读 RPC）**：relay 签名广播 dust 注资 + N6–N9/P 提交 + P 落链 ⇒ **须 dust-spend Owner GO**、与只读第一小时**分窗**（序 = 只读第一小时 → 本卡广播轮 → 维护窗 broker 批；见 `docs/2026-08-29-nwt-t0-dispatch-reconcile.md`）。角色：**构造** J2（离线已定）/ **广播** 提权 operator（relay 签名，J2 只读不能广播）/ **逐格判** NWT。尘埃级金额、TN12 无结算钱语义。
> **对象** = D-016 A′ `recovery_daa` 入口在 TN12 上的**链上行为**（探针 v0.3 已离线证字节，见 `docs/provenance/2026-08-29-s63a-probe-v03/` README §4：✅ 证 源→字节确定性 + A′ 三 require 形 + 两 CLTV 分域；❌ **没证链上接受/拒绝** = 本卡）。
> **判据来源**：向量定义 = `build.harness.v03.mjs` `NEG_LOCK`（N6/N7/N8/N9）+ `recoveryDaa`（P）；拒因分类 = `kasia-relay/src/lib/cltv-locktime.mjs:90 classifyLockReject`（四正则，锚 `7b1e18cc` 共识坐标）。

## 0. 前置（全真才跑）
- 节点 READY：**两信号一致**——J2 `_step0_gate.mjs` verdict=READY（sync_ok ∧ daa_ok ∧ ibd_ok，贴全 JSON）**∧** KANet-UI D 行（`getBlockDagInfo` 派生）同判 READY；不一致 ⇒ 停查（句柄/daa 陈）。gate (a) 继承只读第一小时的 READY 判定（不自行单信号判）。
- 探针 UTXO：`SUCC_UTXO`（recovery_daa redeem）**SEED = 1 KAS/链**（🔴 **尘埃不可行**：covenant storage mass ∝ C·p²/v，v 太小 ⇒ mass ≈ 4e12/SEED 爆表；SEED 须 ≥1 KAS 把 storage mass 压到可付）。SEED **临锁**在 covenant、由 P（recovery）取回（减 fee）⇒ 净烧 = 各落链向量 fee（N6–N9 被拒不付）。
- 🔴 **广播 fee 必由 `estimateMassUpperBound` × `MIN_SOMPI_PER_MASS`(100 sompi/mass) × 1.5 buffer 算，绝不用 harness 固定 `FEE=0.01 KAS/input`**。NWT 核 `tx-mass-ub.mjs`：= **7b1e18cc 逐项镜像**（`source_commit` + 每项 `git show 7b1e18cc:` 出处）、covenant 输入/输出 **`plurality p=2`**（`ceil((63+|spk|+32)/100)`；v2 已修 Codex `e6d3d2f8` 的 p=1 低估 = memory `feedback-kip9-storage-mass-plurality-is-not-one-covenant-utxo-is-p2`）；我实跑 `mass-bound.mjs` 得 `p_out=2,1 / p_in=2`、SEED=1 KAS 地板 G1≈0.040/R1≈0.040/P≈0.0078 KAS **>> harness 0.04 总 ⇒ 用 harness fee 必 mempool 拒**。红线 7（fee ≥ mass×100）**只 warn、wasm 对 v1-covenant `calculateTransactionMass` panic 时靠 `tx-mass-ub.mjs` 本地兜底、不 fail-open**（memory `reference-kaspa-wasm-covenant-binding-moved…`）。预算（Bettor→Owner）：净烧 ≤~1.06 KAS + covenant 临锁 ≤8 KAS ⇒ 预授权 ≤10 KAS。
- Bettor 排期 + stop-rule 6（err 激增/节点重启 ⇒ 停手）。
- 每向量 tx **字节已离线定**（N8 与 P 逐字节相同、差在提交时机；N6 只差 lockTime、N7 差 lockTime 量级、N9 只差 sequence）⇒ 广播段只做"提交 + 读拒因/落链"，不重构造。

## 1. N6–N9 / P 判据表
| # | tx（相对 P 的差）| 提交时机 | **PASS**（拒因逐字 / 落链）| classifyLockReject | 共识坐标 | **FAIL** | **INCONCLUSIVE** |
|---|---|---|---|---|---|---|---|
| **N6** | `lockTime = E−1` | tip 任意 | 拒，err 含 `locktime requirement not satisfied` | `not_yet` | `opcodes/mod.rs:1038` | **被接受/落链**（E−1 也能花 = 锁差一位就破）| 拒但 err 非 CLTV 形（见 §2）|
| **N7** | `lockTime = 5e11 + now_ms`（时间域）| tip 任意 | 拒，err 含 `mismatched locktime types` | `domain_mismatch` | `opcodes/mod.rs:1034` | 被接受（时间域锁混进 DAA 输入还能花）| 同上 |
| **N8** | 字节 = P；`lockTime = E` | **tip DAA ≤ E**（立即提交）| 拒，err 含 `transaction input #<i> is not finalized` | `not_finalized` | `tx_validation_in_header_context.rs:86` / `errors/tx.rs:33` | 被接受落链（E 未到就能花 = 无延迟）| 同上 |
| **N9** | `sequence = MAX (2⁶⁴−1)`；`lockTime = E` | tip 任意 | 拒，err 含 `transaction input is finalized` | `sequence_max` | `opcodes/mod.rs:1056` | **被接受落链**（sequence=MAX 绕过 CLTV = 锁可被 finalize 旁路，正是 builder MUST-FIX 要防的）| 同上 |
| **P** | 基准：`lockTime = E`、`sequence = 0n(≠MAX)`、terminal 输出 | **tip DAA > E**（等锁熟）| **接受 + 落链**，`check_utxo_landed(minDepth)` 到深度 ⇒ SUCC_UTXO 被花 | n/a（应过）| — | **拒**且拒因 = 任一 CLTV 形（锁过严：等到 tip>E 还拒）| 拒但 err 非 CLTV 形（fee/standard ⇒ 修 tx 重投，非 gate FAIL）|

- **N8 vs P = 同一 tx、两次提交**：先在 `tip ≤ E` 投（期望 N8 拒），等 `tip > E` 再投同 tx（期望 P 落）。这条同时证"E 是真 DAA 延迟、且到点就能花"。
- **N6 边界**：N6(E−1 拒) ∧ P(E 接受) 两格一起 = CLTV 边界**恰在 E**、非 off-by-one（Codex 三项之"边界负向量"的核心）。

## 2. fail-closed 形（Bettor 硬要求：**通用节点拒 = INCONCLUSIVE，非 FAIL**）
节点在够到 CLTV 检查**之前**就拒的通用理由 ⇒ 向量没到判据层 ⇒ **INCONCLUSIVE、重投**（清掉噪声再来），**不是** FAIL：
- `transaction is not standard` / mass 超标 / fee 不足 / `orphan transaction` / `already accepted`（重投同 txid）/ `insufficient fee` / RPC 断。
- 判法：拒因文本**先过 `classifyLockReject`**——返回 `{kind:'lock-reject', reason:…}` 且 reason == 该向量期望 ⇒ **PASS**；返回非 lock-reject（或 null）⇒ **INCONCLUSIVE**（记原始 err 文本 + 重投计数，修 fee/mass/standard 后重来）。
- **只有两种情形是真 FAIL**：① 应拒向量（N6–N9）被**接受/落链** = 锁破（安全性 FAIL）；② P 被拒且拒因 == 某 CLTV 形 = 锁过严（活性 FAIL）。其余一律 INCONCLUSIVE 或 PASS。
- ⇒ "节点没接住" 与 "锁没接住" 不混：前者重投，后者才是 gate 结论。
- **重投上限（NWT 定）**：每向量 **≤3 次**，每次**必先修**噪声因（fee/mass/standard/orphan）再投、**非盲投**；3 次仍 INCONCLUSIVE ⇒ **停、报 Bettor**（记原始 err + 计数），不烧窗（stop-rule 6）。间隔 = 修好即投、无固定 sleep。

## 3. Codex 三项（successor / depth / provenance 边界）
| 项 | 测 | **PASS** | **FAIL** | INCONCLUSIVE |
|---|---|---|---|---|
| **same-cid successor readback** | 转移探针续继（`LOCKED_F → O_AUTHORIZED`）落链后，RPC 读续继 covenant UTXO 的 `CovenantBinding` | 续继 cid == 原 cid（**字节对拍**生产 `_continuationAddress` 算出的续继地址 == 链上续继地址，非重实现）| cid 不同 / 续继 UTXO 缺 / 地址不符 = 续继没保 covenant 身份 | RPC 未回读到（IBD 期空值合法，带 daa 下界重读，见 memory `reference-ibd-period-chain-reads-return-empty`）|
| **后继花落链深度** | 续继 tx 不止进 mempool，须**确认到深度** | `check_utxo_landed(successor, minDepth)` 真（blueScore/DAA gap ≥ minDepth）| 卡 mempool / 从不确认（且非节点劣化）| 节点劣化/未 drain ⇒ 重采（非 FAIL）|
| **CLTV+provenance 边界负向量** | ① N6(E−1)∧P(E) 边界（§1）② 链上 redeem 字节 == 探针 script sha | ① N6 拒 ∧ P 接受 ② 落链 tx 的 redeem script sha256 == `probe_phase{0,1}.json` 钉的 script sha（`31d506a9…` / `e6e9c073…`，README §1）| ① 边界 off-by-one（E−1 也接受 / E 也拒）② redeem 字节 sha 不符 = 花的不是所验的那份 covenant | redeem 未回读到 ⇒ 重读 |

- **承重**：③②（redeem 字节 sha 对拍）把"离线所验字节"与"链上所花 covenant"焊上——否则链上落的可能是**另一份** covenant（memory `reference-redeem-byte-verification-cannot-see-unbaked-fields` / `reference-determinism-is-not-correctness-binding-required`）。

## 4. 证据文件命名 + sha 钉法
每向量一份 JSON 写 `docs/provenance/<date>-gate-a-onchain/runs/`：
- 文件名：`gate-a-N6.json` … `gate-a-N9.json` / `gate-a-P.json` / `gate-a-successor.json` / `gate-a-provenance.json`。
- 每份内容（机械可判，NWT 逐字核）：`{ vector, txid, submitted_at_daa (tip DAA at submit), E, lock_time, sequence, submit_result: 'accepted'|'rejected', raw_err (原始节点文本), classify: <classifyLockReject 返回>, verdict: 'PASS'|'FAIL'|'INCONCLUSIVE', retry_count, landed_depth (P/successor) }`。
- P / successor 另记：`landed_txid`、`landed_blue_score`、`spent_outpoint`、`redeem_sha256`（对拍 probe script sha）、`continuation_addr`（对拍生产函数）。
- `MANIFEST.sha256` 覆盖 runs/ 全部 + 本卡 sha；`sha256sum -c` 复核。**读数纪律**：J2 写自己跑的读数，别人的标"未核"（memory `feedback-run-my-own-check-before-writing-its-result`）；单节点证据一律标 "single-node (daX) evidence"，不写 two-vantage。

## 5. gate (a) 收口判据（全绿才 CLOSE，任一 FAIL ⇒ OPEN + 根因）
- **必全 PASS**：N6 ∧ N7 ∧ N8 ∧ N9（各自拒因逐字对） ∧ P（落链 + 深度） ∧ same-cid readback ∧ successor 深度 ∧ provenance 边界（N6/P + redeem sha 对拍）。
- **INCONCLUSIVE 不算数**：任一向量停在 INCONCLUSIVE ⇒ 该向量**未验**，gate 不 CLOSE（既不 FAIL 也不 PASS），重投到 PASS/FAIL。
- **任一 FAIL** ⇒ gate (a) 维持 OPEN，报根因（锁破 = 安全 / 锁过严 = 活性 / 字节不符 = 绑定），**不推进部署**。
- 与既有：这补的是 Codex `119ec787` (a) 七条最小验收里 **criterion 5（RPC 回读进 claim/recovery 支）** + Codex 反复要的 successor/depth/boundary 的**真链段**；1/2/3/4/6/7 离线段仍按 `docs/2026-08-28-nwt-s63-gate-status-refresh-v5.md` 那 7 行审。builder 仍 HOLD、真开对冲/真迁移 = Owner 独立批。
