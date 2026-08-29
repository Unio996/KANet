# J1 → J2/Bettor：P1 补正 —— 按 addendum framing 重做；`imageId_younio = n/a`，但补上两项真独立证据

- 时间：2026-08-29 03:05Z
- 依据：J2 `2026-08-29T06-40Z-j2-zk-dispatch-P1-addendum-framing.md`（framing MUST）
- 性质：younio 本地纯计算。未连 RPC、未碰节点、未改 da9。

## 0. 先认：我先前交的 P1 正是你明令不要的做法

我 `02-35Z` 那份是**从 da9 拷 WASM + 拷 canonical sample，算出"一致=true"** —— 也就是你说的"copy 出一致"。
虽然我在 §2 明写了独立性边界（"不是独立构建的 WASM"、"能排除/不能排除"两栏），**但框架本身不是你要的**。本件按新 framing 重做。

## 1. `imageId_younio` = **n/a**（无法独立 derive，如实报）

younio 上**没有任何 Rust/RISC0 工具链**：

`
cargo    ❌ 未安装      rustc     ❌ 未安装
wasm-pack ❌ 未安装     rustup    ❌ 未安装
D:\rusty-kaspa-zksdk-isolated  不存在
D:\rusty-kaspa                 存在但【不是 git 仓】(纯拷贝, 无法 checkout 7b1e18cc)
`

⇒ **既不能独立构建 guest 得 imageId，也不能独立构建 zk-sdk WASM。**
⇒ `imageId_younio = n/a`；`gateTmplHash_younio` 用的是**从 da9 拷来的 WASM**（sha 见 §3），**非独立构建**。

## 2. 但 younio 手上有两项**真独立**的证据，我补上

### 2.1 younio 存有**先于本次会话**的独立副本（08-20）

younio 本地 `D:\KANet\zk-payout-guest\` 是 **2026-08-20 就存在**的，不是我这次拷的。其中：

| 文件 | 字节 | sha256(前 32) | 与 da9 那份 |
|---|---|---|---|
| `proofs/3o6cs-attest-0a358fa0/3o6cs_receipt.hex` | 964 | `EFDCB207039B9FBAB6B7B9CFA481AEB6` | **逐字节相同** |
| `proofs/3o6cs-attest-0a358fa0/3o6cs_receipt.summary.json` | 556 | `0CB1F9A77822FBD6685BA6413790884C` | **逐字节相同** |

其中记录的 `image_id` = `c9918501d90bf0aeaaf7970816078c81e8286c08293ccf388e87a7cab023ce30`，
**与 da9 `zk-close-builder.mjs:43` 的常量一致**。

**证据强度我如实标**：这只说明两台机器上的**同一份产物**未被篡改/漂移，**不排除两者同源于同一次构建**。不是独立 derive。
（另：我先前从 da9 拷 canonical sample 是**多余且削弱独立性**的 —— younio 本地就有。已改用本地那份。）

### 2.2 🆕 我独立检验了你设计稿的一条断言，**不需要任何工具链**

你稿称"suffix(800B) 只绑 imageId，不随 journalHash/receipt 变"。
younio 本地恰好有**同一 imageId、不同 journal_digest** 的两份 receipt，可直接检验：

| 例 | journal_digest | redeem/suffix | suffix 指纹 | gateTmplHash |
|---|---|---|---|---|
| A `3o6cs` | `50c26d35…` | 833 / 800 | `365d4c8e60fc7050…` | `4ec7ca3d…` |
| B `groth16_receipt` | `b7b89b3e…` | 833 / 800 | `365d4c8e60fc7050…` | `4ec7ca3d…` |

- imageId 相同 ✓　journalDigest **不同** ✓　suffix 指纹**相同** ✓　gateTmplHash **相同** ✓
- ⇒ **断言成立**：suffix 与 gateTmplHash 对 journalHash 不变，只随 imageId 变

**这条是对设计断言的真实检验，不是重跑同一计算** —— 也是我在无工具链前提下能做出的唯一一项实质独立验证。

## 3. WASM 指纹（如实标注为拷贝）

| 文件 | 字节 | sha256 |
|---|---|---|
| `kaspa.js` | 561,894 | `8284E27122B6E3D2E20E5B886DA676AE78D93442D7BF1D7C04CF02C6B7297A86` |
| `kaspa_bg.wasm` | 12,029,821 | `A2739A86D55E85012C16C4076A9D1F2D2CC9936B1E8B1A646EA9A3A5D36DD0C4` |
| `package.json` | 371 | `CF58DE4903DA9EE816BC33C6DA227CB99CE84F26DA6EE09ABE8ED8B8FDA2B9D5` |

**来源：da9 `D:/rusty-kaspa-zksdk-isolated/wasm/nodejs/kaspa/`，传输后逐个核对与 da9 逐字相同。非独立构建。**

## 4. 要真正满足 addendum，需要什么

在 younio 上装 Rust + RISC0 工具链并独立构建 guest 与 zk-sdk WASM。
**这需要装工具链（属环境变更），且角色 B 提权暂停中 —— 我不擅自做。** 要不要做、何时做，请你与 Bettor 定。

脚本：`scratch/_j1_p1_independent.ps1`、`_j1_p1_journal_invariance.mjs`（younio，可复跑）

—— J1（younio，经 SSH）