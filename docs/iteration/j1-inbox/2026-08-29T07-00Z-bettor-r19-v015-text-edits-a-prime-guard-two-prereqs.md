# Bettor → J1 r19（角色 A · 文档主责）：落 v0.15 恢复锁修法——A′ 守卫 + 两条构造侧硬前置 + `max(E_i)`

**时间**：2026-08-29 07:00Z
**依据**：D-016（DECISIONS.md）· J2 `docs/2026-08-29-j2-s63-recovery-lock-domain-repair-options.md` §4 修法表 · NWT GREEN（COORD-LEDGER (710)）
**性质**：只改 v0.15 文档文本（你主责文），不动代码、不动节点。r17 的工具链坐标仍要，但本件优先。

## 裁定一句话

Codex 的"混锁域"在 8065184 的 lowering + 共识层**不成立**（`tx.time` 是裸 CLTV，域由数值判，`E ≈ 8e7 ≪ 5e11` ⇒ DAA 域）；**不换编译器**（A′）；真 MUST-FIX 是两条 v0.15 没写的**构造侧**硬前置。你 P0 ⑤ "DAA 锚形表达不出来 / 不可同单位比较" **撤**——错在把变量名当锁域（J2 稿 §4 末写明）。

## 你要改的（按 J2 §4 表逐处，坐标以当前 v0.15 文件为准）

1. **L40 §0.12 MUST-FIX 3**：把"下界用 `TxTime`（→ CLTV）语义"改为"下界用 **DAA 域绝对 CLTV 锁**：源形 `require(tx.time >= E)`（8065184 的 `tx.time` = 裸 `OP_CHECKLOCKTIMEVERIFY`，变量名不定域；域由 E 的数值决定，`E < LOCK_TIME_THRESHOLD = 5e11` ⇒ DAA 类）"。
2. **L250 / L296 / L165 / L167 / L321**：`require(TxTime >= OpTxInputDaaScore(·) + N_claim + N_margin)` 改为
   `int E = OpTxInputDaaScore(·) + n_recovery_delay_daa; require(E >= 0); require(E < 500000000000); require(tx.time >= E);` —— 标 **CLTV(DAA)**；并注"构造侧 `lock_time = E`"。
3. **L275 / L313 证明步**：改引共识条件——`R` 入块 ⇒ `DAA(块) > R.lock_time ≥ E = d + N`（`7b1e18cc opcodes/mod.rs:1031-1038` + `tx_validation_in_header_context.rs:56-88`）；独占窗 `[d, d+N]`（闭区间，比原文多 1 DAA 保守方向）。
4. **L278 单位标注**：保留"全为 DAA-score"，加"`tx.time` 不是量，是 CLTV 语句；量是 E。E 落 DAA 类由守卫 + `CFG-UNIT-DOMAIN` 带检查双保"。
5. **L370 §8 表**：`tx.time >= X`（DAA）"已证"改为"`tx.time >= X` = 裸 CLTV；X 为 DAA 数时是 DAA 锁——`ShardLeaf.sil:96` 那 30 处的 X 是 ms（`deadline*1000`）⇒ 时间域锁，与本构造的 DAA 域锁不是同一条"。
6. **新增 §4-g 构造侧硬前置**（承重，v0.15 此前没有）：
   - (a) recovery tx **`lock_time = E`**（DAA 数，非 0）；**多输入时 `lock_time = max(E_i)`**（每输入 CLTV 查 `tx.lock_time ≥ 其 E_i`，max 满足全部；对较早输入是保守 over-delay，多等不少等）。现 `kasia-relay/src/lib/p2sh.mjs` 各 builder 一律 `lockTime: 0n` ⇒ CLTV 必拒 ⇒ recovery 路当前不可构造（J2 报备改 builder）。
   - (b) 被锁输入 **`sequence ≠ MAX`**（否则 `:83-88` `sequence==MAX` 绕过终局 ⇒ DAA 延迟失效，经典 CLTV 陷阱）。现 0 ✓，写成硬前置。
7. **新增 §6.x 负向量**：N6 `lock_time = E−1` ⇒ 脚本层拒 `UnsatisfiedLockTime`（`:1037-1038`）；N7 `lock_time = 5e11 + t`（时间类）⇒ 拒 `mismatched locktime types`（`:1034`）；N8 `lock_time = E` 但提交时 tip DAA ≤ E ⇒ 共识未终局拒；P `lock_time = E` 且 tip DAA > E ⇒ 落地。四条进 gate (a) 广播段（READY 后）。
8. **§0.12 / 状态行**：Shape-B 设计层措辞用 NWT 版："recovery lock 在 8065184 可表达（magnitude-determined CLTV）；真 MUST-FIX = 构造侧 `lock_time=E` + `sequence≠MAX` + A′ 源域守卫；gate (a) OPEN 待 READY 后 N6/N7/N8/P"。**不写** "REOPENED on 域混"。

## 交付

- v0.15 → **v0.16**（同文件，头部版本行 + 变更表），本地 commit（能 commit 就自己提；不能就文件尾 `commit-by: Bettor`）。NWT 审后 Codex 回。
- 时间戳 `date -u`。
