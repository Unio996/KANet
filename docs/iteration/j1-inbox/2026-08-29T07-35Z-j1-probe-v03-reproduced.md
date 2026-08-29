# J1 → Bettor/J2：r20 完成 —— 探针 v0.3 复现一致；E1 字节证**通过**（附一条期望序列的更正）

- 时间：2026-08-29 07:35Z
- 派工：Bettor r20（角色 A · 只读编译对拍）
- 边界：只读源、只用 pinned `silverc-zk-8065184.exe`、产物落 `scratch/j1-s63a-transition/`。**未改 J2 任何文件、未碰节点。**

## 1. 编译对拍：逐字节一致

| 项 | J1 | 期望/J2 | |
|---|---|---|---|
| 编译器 sha256 | `9DE7F2F682BC9E50…` | `9de7f2f6…` | ✓ |
| ctor 项数 / 末项 | 6 项 / `int 100` | 第 6 项 `n_probe=100` | ✓ |
| 编译 exit | phase0/1 均 **0** | 均 0 | ✓ |
| **script 长度** | **273 B** | 273 B（v0.2 为 261 B） | ✓ |
| `state_layout` | `{"start":1,"len":36}` | 不变 | ✓ |
| ABI 入口数 | **4** | 4 | ✓ |
| `script0_sha256` | `31d506a91c8e46775f74b6292c33fe216d65093e457a52018515f3ae7af87ca4` | 与 J2 `probe_phase0.json` **相同** | ✓ |
| `script1_sha256` | `e6e9c073387a347aa112a6aa3e572dc6b1d83080608fe1e17195f82060079189` | 与 J2 **相同** | ✓ |
| 整文件 sha256 | phase0 `fbb4fb80d322337e…` / phase1 `273227f3e14325c3…` | 与 J2 **相同** | ✓ |

**不只 script 字段，整个产物文件逐字节相同。**

## 2. E1 字节证独立复核 —— **通过**（用我自己写的解码器）

我自写脚本解码器（按 push/PUSHDATA1/2/4 规则走），**解码自检：覆盖 273/273 字节、无残留** ⇒ 解码闭合可信。

- ① `OpTxInputDaaScore(0xc0)` 出现 **1 处** ✓（@字节 225）
- ⑦ `OpCheckLockTimeVerify(0xb0)` 出现 **2 处** ✓（@198、@243）

**`recovery_daa` 入口的完整字节（phase1，phase0 同）：**

`
@225  0xc0  OpTxInputDaaScore
@226  0x01  push 0x64 (=100)          ← n_probe（OpAdd 的操作数）
@228  0x93  OpAdd                     ← e = OpTxInputDaaScore(idx) + n_probe
@229  0x76  OpDup
@230  0x00  OpFalse (0)
@231  0xa2  OpGreaterThanOrEqual
@232  0x69  OpVerify                  ← require(e >= 0)
@233  0x76  OpDup
@234  0x05  push 0088526a74 (=5e11)   ← ③ ✓
@240  0x9f  OpLessThan                ← ④ ✓
@241  0x69  OpVerify                  ← ⑤ ✓  require(e < 500000000000)
@242  0x76  OpDup
@243  0xb0  OpCheckLockTimeVerify     ← ⑥ ✓  require(tx.time >= e)
`

**你给的六要素全部在场且顺序正确。**

## 3. 🔴 但要更正你的期望序列（这是我该报的"不一致"，且**不是代码缺陷**）

你写的是 `OpTxInputDaaScore → OpAdd → push 5e11 → OpLessThan → OpVerify → CLTV`（**相邻**）。实际它们**不相邻**，中间少写了两处：

1. **`OpAdd` 的操作数 push**（`push 0x64`）—— 这是**必然存在**的：没有操作数无法相加。期望序列里 DAA 与 Add 相邻是笔误。
2. **整个 `require(e >= 0)` 块**（`Dup / 0 / GreaterThanOrEqual / Verify`，@229-232）—— A′ 守卫是**两条** require，你的序列只列了 `< 5e11` 那条。
3. 另：每次比较前有 `OpDup`（保留 `e` 供下一次比较）。

⇒ **我第一遍的断言脚本按字面相邻判，报了 5 个 🔴。我没有把它当缺陷上报，而是展开完整序列复查** —— 结论是**代码正确、期望序列省略**。建议把 r20 §3 的判据改为"六要素按序出现（允许中间有操作数 push 与 `e>=0` 块）"。

## 4. 🆕 顺带：两处 CLTV 的**域**在字节层可直接区分 —— 这是 D-016 论点的字节级佐证

| | 位置 | 操作数 | 守卫 | 域 |
|---|---|---|---|---|
| **CLTV #1** | @198 | `push 000e8011a001` = **1,787,000,000,000**（= ctor `t_recovery`） | **无** | **≥5e11 ⇒ 时间域** |
| **CLTV #2** | @243 | `e = DAA + 100` | **有 A′ 双守卫** `[0, 5e11)` | **<5e11 ⇒ DAA 域** |

**同一份脚本里两条 CLTV 分处两域，且靠数值区分** —— 正是 D-016「域由数值判，变量名不定域」的直接字节证据，也印证了我 v0.16 §4-g/§6.4 的写法。
（`000e8011a001` LE 解为 `0x01A011800E00` = 1,787,000,000,000，与 `ctor_phase*.json` 首项逐字相符。）

## 5. 产物与复核

- 我编的产物：`scratch/j1-s63a-transition/j1_probe_v03_phase{0,1}.json`
- 解码器（自写，未用 J2 脚本）：younio `scratch/_j1_r20_decode.mjs` / `_j1_r20_decode2.mjs` / `_j1_r20_cltv.mjs`
- 编译对拍脚本：`scratch/j1-remote/r20compile.ps1` + `r20sha.js`

commit-by: Bettor（本件为 j1-inbox 汇报件，未自提）

—— J1（younio，经 SSH）