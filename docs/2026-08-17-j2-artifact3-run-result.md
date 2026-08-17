# artifact#3 · run 结果与判读（`run-2026-08-17T191713017Z-7ac2c2`）

> **Status**: CURRENT

**制品**：`artifacts/2026-08-17-j1-trough-probe-artifact3-run-7ac2c2.jsonl`（7 行 = 1 runHeader + 6 次触发）
**执行方 attestation**：`docs/2026-08-17-j2-artifact3-executor-attestation-FINAL.md`（MATCH，时间戳早于 run）

## 一、原始结果

| # | 触发 rate | `isSynced` | tips | 结果 | tx |
|---|---|---|---|---|---|
| 样本1 | 0.68/s | **true** | 199 | ✅ confirmed | `930ee539…` |
| 样本2 | 0.99/s | **true** | 203 | ✅ confirmed | `789fb111…` |
| — | 0.47/s | **false** | 216 | ⛔ excluded | — |
| — | 0.79/s | **false** | 236 | ⛔ excluded | — |
| — | 0.92/s | **false** | 257 | ⛔ excluded | — |
| 样本3 | 0.47/s | **true** | 196 | ✅ confirmed | `d357e868…` |

**3/3 计数样本全部 confirmed，0 例失败。** 排除的 3 次**全部**是 `isSynced=false`
（submit 被节点拒 ⇒ 无 submit txid ⇒ 按 `exclusionRule: no submit txid => zero node-health credit` 剔除）。

## 二、🔴 那个 "32.5s" **不是确认延迟** —— 交付里必须这样读

拆开算：`trigger → submit 开始` = **0.9s**（三次相同）；`submit 开始 → confirmed` = **32.5s**（三次相同）。

> 🔴 **三次独立的链上确认，不可能落在 0.1 秒精度内相同。**
> ⇒ 这个数**测的是我们自己的发送 + 轮询流水线**（发送器内部固定等待 `J1_SEND_SLEEP=5` 等 + 轮询 10s 步长），
> **不是链的确认延迟**。同族在册：**周期等于采样 tick 时，测到的是采样本身**。

进一步佐证：**`firstSeen` 与 `confirmed` 时间戳完全相同**（三次皆是）
⇒ 轮询从未观察到"已见未确认"的中间态，**mempool→confirmed 这一段被采样粒度整个吞掉了**。

✅ **能诚实声称的**：在 `isSynced=true` 的 trough 相位，**tx 确实落链并通过 content+sender+txid 三重绑定验证**，
**确认延迟 ≤ 32.5s（上界，且被流水线量化）**。
❌ **不能声称**：确认延迟"是" 32.5s，或据此比较不同相位的确认速度 —— 这个仪器分辨不了。

## 三、🔵 本 run 最有价值的产出：节点有**两个截然不同的相位**，而只有一个与"确认延迟"有关

- **`isSynced=true` + 低产（rate<1）**：submit 成功，3/3 确认 ⇒ **低产不影响落链**（与 J1「低产≠病态」一致）。
- **`isSynced=false`**：**submit 被硬拒**（`transaction.mjs:151` 闸），3/3 excluded。

🔨 **⇒ gate①(b)「逆境下 tx 能否有界确认」这个问法，需要按相位拆开**：
- 在 `isSynced=true` 的逆境（低产）下：**能，且有界**（≤32.5s 上界）；
- 在 `isSynced=false` 下：**问题根本不是"确认多慢"，而是"根本提交不进去"** —— 这是**另一种失败模式**，
  不该与"慢确认"混为一谈，也不该用"确认延迟"这把尺去量。

🔵 **探针的 exclusion 规则在方法上是对的**（不给一个没发生的事件记 credit），
但它的**副作用**是：`isSynced=false` 相位**被系统性地排除在证据之外**。
⇒ **artifact#3 权威闭合的是「`isSynced=true` 逆境下的确认」这一格，不是全部逆境。**
这一句请写进 gate①(b) 的结论里，否则读者会以为整个逆境面都被覆盖了。

## 四、执行合规（Codex 六步，逐条）

1. ✅ checkout **精确 `06b3bb55`**（非 branch tip）—— worktree HEAD 实读一致；
2. ✅ 跑前执行方在 launcher 自报路径**外**独立 `git hash-object`；
3. ✅ 结果 `23ec24ec7ee09068a1a28fc4de5cb4c49cb993be`；
4. ✅ 与 **Codex RE-ACCEPT（桥 `4a31158d`）记录值**比对 = **MATCH**，`hashed_at=2026-08-17T19:14:58Z` **早于 run**；
5. ✅ 只跑 canonical `scripts/j1-trough-probe-launch.sh`；
6. ✅ launcher 六项自检全过（runHeader 落盘：`sourceCommit` / `treeClean` / `instrumentBlob` / `selfSha` /
   sender pinned==actual / RPC entry+wasm 双 pin / relay 前缀）。

**收尾**（照 (388)）：先清掉 worktree 内拷贝的 `node_modules`，再 `git worktree remove`。
✅ **主树依赖完好性已复验**：`kasia-console/node_modules` 仍 225 项，`kaspa-wasm` 链接仍在
—— 这是上一次 junction 删穿事故的那一格，每次都要复验。
