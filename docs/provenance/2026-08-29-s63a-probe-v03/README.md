# provenance · §6-3 转移探针 v0.3（D-016 A′ · DAA 域 CLTV 相对锚）

> J2 2026-08-29 · 对象 = `scratch/_j2_s63a_transition/` 的 v0.3 产物（本目录为逐字节副本）· 复现方 = J1 r20（younio，`docs/iteration/j1-inbox/2026-08-29T07-35Z-j1-probe-v03-reproduced.md`）· 自证脚本 `verify-e1.mjs` **8/8**（两 cwd，`verify-run1.out` / `verify-run2.out`）。

## 1. 产物与 sha256

| 文件 | 内容 | sha256（前 16 / 全）|
|---|---|---|
| `S63A_TransitionProbe.sil` | 探针源（v0.3：`int n_probe` ctor 第 6 项；入口 3 `recovery_daa` = `e = tx.inputs[idx].daaScore + n_probe; require(e>=0); require(e<500000000000); require(tx.time>=e)`）| `91caacef864c5224` |
| `ctor_phase0.json` / `ctor_phase1.json` | 6 项 ctor（`[t_recovery=1787000000000, phase, pad×3, n_probe=100]`）| `77d6cfce5a1e2379` / `b563026af4540d16` |
| `probe_phase0.json` | silverc 产物（script 273 B, abi 4, state_layout `{start:1,len:36}`）| 整文件 `fbb4fb80d322337e`；**script 字节** `31d506a91c8e46775f74b6292c33fe216d65093e457a52018515f3ae7af87ca4` |
| `probe_phase1.json` | 同上 phase1 | 整文件 `273227f3e14325c3`；**script 字节** `e6e9c073387a347aa112a6aa3e572dc6b1d83080608fe1e17195f82060079189` |
| `build.harness.v03.mjs` | J2 离线 harness 副本（12 步 + N1–N9；**绑定 `D:/kanet-tn12/kasia-relay` 绝对路径与 pinned 编译器**，只作记录，不在本目录直接跑）| `a7c076bc4945b755` |
| 编译器 | `D:/silverscript/versioned-builds/silverc-zk-8065184.exe`（本地分支 `j2-oppick-fix-2026-07-06`@`8065184` 构建；上游无此修复，见 CLAUDE.md 铁律 0.5 状态注记）| `9de7f2f682bc9e50…`（J1 同值 `9DE7F2F682BC9E50…`）|

`MANIFEST.sha256` 覆盖本目录全部文件；复核：`cd docs/provenance/2026-08-29-s63a-probe-v03 && sha256sum -c MANIFEST.sha256`。

## 2. 跨机复现（J1 r20，2026-08-29 07:35Z）

J1 在 younio 用同一 pinned 编译器只读编译同一 `.sil` + 同一 ctor：编译 exit 0/0、273 B、ABI 4、`state_layout` 同、**script0/script1 sha 与整文件 sha 全部逐字节一致**（上表值即 J1 报的值）。J1 另用**自写解码器**（未用 J2 脚本；覆盖 273/273 字节无残留）独立复核 E1。⇒ 两方、两解码器、一份字节。

## 3. E1 字节证（按 J1 r20 §3 **更正后**的完整序列）

`verify-e1.mjs` 断言 `recovery_daa` 入口自 @225 起 **13 个 op 相邻**：

```
@225 0xc0 OpTxInputDaaScore
@226 push 0x64 (=100)            ← n_probe（OpAdd 操作数）
@228 0x93 OpAdd                  ← e = daaScore + n_probe
@229 0x76 OpDup · @230 0x00 OpFalse · @231 0xa2 OpGreaterThanOrEqual · @232 0x69 OpVerify   ← require(e >= 0)
@233 0x76 OpDup · @234 push 0088526a74 (=5e11 LE 最小正编码) · @240 0x9f OpLessThan · @241 0x69 OpVerify   ← require(e < 5e11)
@242 0x76 OpDup · @243 0xb0 OpCheckLockTimeVerify   ← require(tx.time >= e)
```

另断言：`0xc0` 全脚本恰 1 处；CLTV 恰 2 处 `@198`（操作数 push `000e8011a001` = 1,787,000,000,000 = ctor[0]，≥5e11 ⇒ **时间域、无守卫**）与 `@243`（DAA 域、A′ 双守卫后）。**同一脚本两条 CLTV 分处两域、靠数值区分** = D-016「域由数值判、变量名不定域」的字节级佐证。

🔴 **更正记录**：J2 派工文本里的期望序列写成 `0xc0 → 0x93 → push 5e11 → 0x9f → 0x69 → 0xb0`，省略了 `push n_probe` 与整个 `e>=0` 块（4 op）与每次比较前的 `OpDup`。J1 按字面相邻判先报 5 个 🔴，展开后判"代码正确、期望省略"。**J2 的 harness（`build.harness.v03.mjs` E1 步）本来就是"按序出现、允许中间有 op"的子序列判**，所以 12/12 一直是过的——错的是派工文本，不是代码，也不是 harness；本目录 `verify-e1.mjs` 改为**写全 + 相邻**（比 harness 更紧）。判据教训：期望序列必须从字节反解出来抄，不能从 `.sil` 心算。

## 4. 本目录**证了什么 / 没证什么**

- ✅ 证：v0.3 源 → 字节 的确定性（两机同 sha）；字节里 A′ 的三条 require 与 CLTV 的形；两 CLTV 域可由数值区分。
- ❌ 没证：**链上行为**——`recovery_daa` 在 `tx.lockTime = E` / `sequence ≠ MAX` 下被节点接受、在 E 未到 / 域错 / sequence==MAX 下被拒（拒因文本 = `kasia-relay/src/lib/cltv-locktime.mjs` `classifyLockReject` 四种）。这是 gate (a) 广播段 N6–N9 + P，**READY T+0 后**在 TN12 跑（不花钱前提：探针金额 = 尘埃级，且须 Bettor 排期）。
- ❌ 没证：mass/fee（kaspa-wasm 对 v1 covenant tx `calculateTransactionMass` panic，memory `reference-kaspa-wasm-covenant-binding-moved…`）——广播段用 relay 的 fee floor 路径另证。

## 5. 复跑

```
node docs/provenance/2026-08-29-s63a-probe-v03/verify-e1.mjs          # 8/8, 任意 cwd, 零依赖
cd docs/provenance/2026-08-29-s63a-probe-v03 && sha256sum -c MANIFEST.sha256
# 重编译对拍（需 pinned 编译器）: 见 build.harness.v03.mjs 头注释 / J1 scratch/j1-remote/r20compile.ps1
```
