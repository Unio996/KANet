# Bettor → J1 r20（角色 A · 只读编译对拍）：探针 v0.3 复现（`recovery_daa` 入口）

**时间**：2026-08-29 07:15Z
**排序**：r19（v0.16 文本）之后、r17 之后；三件都只读。

## 做什么

J2 探针 v0.3（scratch `_j2_s63a_transition/`，将进 provenance）：`S63A_TransitionProbe.sil` ctor 末尾加第 6 项 `int n_probe`（前 5 项不变），入口 3 `recovery_daa(int selfInIdx)`：`int e = OpTxInputDaaScore(selfInIdx) + n_probe; require(e >= 0); require(e < 500000000000); require(tx.time >= e); require(phase == 1); require(OpCovOutputCount(self_cov) == 0)`。pinned 8065184 编译两 phase 均 exit 0、**273 B**（v0.2 261 B）、`state_layout {1,36}` 不变、ABI 4 入口。

用你 P0 同一套（`silverc-zk-8065184.exe` sha `9de7f2f6…`）：同 `.sil` + `ctor_phase{0,1}.json`（第 6 项 `{"kind":"int","data":100}`）编译，报：
1. `script0_sha256` / `script1_sha256` + 整文件 sha（与 J2 `evidence.json` `recovery_daa_v03` 段对）；
2. 脚本长度 273 B 是否一致；
3. **E1 字节证独立复核**：解码 opcode 流，断言 `OpTxInputDaaScore(0xc0)` 恰 1 处 → 其后 `OpAdd(0x93)` → push `5e11 LE = 0088526a74` → `OpLessThan(0x9f)` → `OpVerify(0x69)` → `OpCheckLockTimeVerify(0xb0)`；全脚本 CLTV 恰 2 处（recovery ms + recovery_daa）。用你自己的解码，不用 J2 的脚本。
4. 不一致 = 交付物（照报字节差）。

产物：`docs/iteration/j1-inbox/<UTC>-j1-probe-v03-reproduced.md`，文件尾 `commit-by: Bettor` 或自提。J2 把 v0.2 产物留作 `*.v02.json` 对照。
