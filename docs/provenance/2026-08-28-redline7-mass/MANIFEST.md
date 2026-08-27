# 红线 7 本地 mass-ub · 条件② 独立对拍证据（NWT storage-mass oracle）

> **Status**: CURRENT
> 作者 NWT · 2026-08-28 · 派工 Bettor（红线 7 修法条件②：两独立实现对拍）· 配 `docs/2026-08-28-nwt-s63-redline7-mass-fee-silent-disable-v5.1.md`。

## 目的
J2 的本地 mass 上界估算 `kasia-relay/src/lib/tx-mass-ub.mjs`（红线 7 vendored-wasm-panic 兜底）需**独立实现对拍**（条件②）。
- vendored wasm（`'testnet-10'`）**不是有效 oracle**：其 KIP-9 实现 ≠ live commit 7b1e18cc——`|I|=1` 形相等，但 `|I|≥2` 给 3286/4882 vs 正确 0/443。
- console `kip9-mass.mjs` 是经验近似（`C/value`、`SOMPI_PER_MASS=110`），非精确实现。
- ⇒ **本 oracle 由 NWT 纯从 `git show 7b1e18cc:` 源独立实现，不看 J2 原型**，作 storage-mass（wasm 分歧的承重部分）的第二实现。

## 源码出处（全部 `git -C /d/rusty-kaspa show 7b1e18cc:<path>`；live 节点二进制 commit）
- `consensus/core/src/mass/mod.rs:430-503` `calc_storage_mass`（KIP-9）
- 承重取整（逐字）：
  - harmonic 项 = `floor(C · p² / amount)`（:451 `checked_mul(p)?.checked_mul(p)? / amount`）
  - **arithmetic_ins = `|I| × floor(C / mean_ins)`**（:500 `ins_plurality.saturating_mul(storm_param / mean_ins)`——C/mean **先 floor 再 ×|I|**；J2 原型首版取整方向反了、已改逐字）
  - `mean_ins = floor(Σamounts / Σplurality)`（:497）
  - relaxed 条件（:466-479）：`|O|=1` ∨（`inputs.len()≤2` ∧（`|I|=1` ∨ `|O|=|I|=2`））
  - return：relaxed ⇒ `saturating_sub(harmonic_outs, harmonic_ins)`；否则 `saturating_sub(harmonic_outs, arithmetic_ins)`
- `consensus/core/src/constants.rs:25` `STORAGE_MASS_PARAMETER = SOMPI_PER_KASPA × 10_000 = 1e12`（= C）

## 对拍结果 ⇒ 5/5 全等（见 crosscheck-output.txt）
| # | 形 | 输入(sompi) | 输出(sompi) | NWT oracle | J2 手算 | 一致 |
|---|---|---|---|---|---|---|
| H1 | 1-in/2-out relaxed(\|I\|=1) | 200M | 100M/99M | 15101 | 15101 | ✓ |
| H2 | 1-in/1-out relaxed | 200M | 100M | 5000 | 5000 | ✓ |
| H3 | 2-in/2-out relaxed(\|O\|=\|I\|=2) | 150M,50M | 100M,99M | 0 | 0 | ✓ |
| H4 | 3-in/3-out 一般式 | 70M,70M,60M | 60M,70M,69M | **443** | 443 | ✓ |
| H5 | 3-in/2-out 一般式(\|I\|=3) | 100M,50M,30M | 150M,28M | **0** | 0 | ✓ |

- 🔴 **H4/H5 是承重**：它们走一般式（arithmetic 路径），验中了取整顺序 `|I| × floor(C/mean)`——正是旧 wasm 分歧、J2 首版反了的那处。两独立实现在此一致 ⇒ storage-mass 承重面对拍通过。
- **范围**：本 oracle 覆盖 storage-mass（wasm 分歧点）。compute/transient 分量（size×const）由 J2 的上界证明表逐项对源（tx-mass-ub.mjs 文件头 13 行，NWT 已审 GREEN）。链上实证 `getMempoolEntry.mass` 待节点 READY 补（第三独立锚）。

## 文件 + sha256
| 文件 | sha256 |
|---|---|
| `storage-mass-oracle.mjs` | `3ab2ebb5071c036a3693ef02f1d077dbf84e8b560acca2bf79f3e2c691bb2399` |
| `handcalc-crosscheck.mjs` | `acd89aaf10be5f28568377a8c883d8016f37b3cc9cc4b8ef79487e92f3667c3c` |
| `crosscheck-output.txt` | `6ef2dd8f57ac604f8e9f143431aeee22d10d35fd9f93618c43196b315d3839fe` |

## 复算
`node docs/provenance/2026-08-28-redline7-mass/handcalc-crosscheck.mjs` ⇒ `5 PASS / 0 FAIL`。
