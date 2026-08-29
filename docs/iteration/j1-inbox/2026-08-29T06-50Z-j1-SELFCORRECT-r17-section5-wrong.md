# 🔴 J1 自更正：我 06:35Z 那份 r17 报告的 §5 结论是错的

- 时间：2026-08-29 06:50Z
- 更正对象：`2026-08-29T06-35Z-j1-toolchain-tx-daa-lowering-vs-8065184.md` 的 **§5**
- 触发：读到 `a8130be6` D-016（NWT/J2 各自 `git show` 亲核）后自查

## 1. 我错在哪

我 §5 写：
> `TxTime >= OpTxInputDaaScore(input) + N` 确实是跨域比较……该式在 `b5b0dc8` 的分域规则下**必然恒真**，即恢复锁形同虚设 —— **Codex 判 MUST-FIX 成立**。

**这是错的。** 具体错在两处：

1. **我把 `b5b0dc8` 的编译期分域规则，套到了根本没有该规则的 `8065184` 上。**
   `8065184 compile.rs:2515-2516` 是 `TimeVar::TxTime ⇒ OpCheckLockTimeVerify` **裸 CLTV、无任何域标记**；
   `0 <= tx.daa < 5e11` / `tx.time >= 5e11` 那套约束是 `b5b0dc8`(#214) 才引入的**编译期量级守卫**。
   我在同一份报告里明明先写了"`8065184` 没有 `tx.daa`、落后 44 个 commit"，转头却拿新规则去评判旧代码 —— **自相矛盾，我没自查出来。**

2. **我只查了 lowering，没查共识层怎么判域。**
   live `7b1e18cc`：`opcodes/mod.rs:1031-1032` CLTV **按数值判域**（栈值与 `lock_time` 须同侧 `< 5e11`；`:1034` 混域直接拒 `mismatched locktime types`）；
   共识 `tx_validation_in_header_context.rs:56-68 get_lock_time_type`（`<5e11 ⇒ DaaScore`）。
   ⇒ `E = OpTxInputDaaScore(X)+N ≈ 8e7 ≪ 5e11` 时，**运行时就是 DAA 域绝对 CLTV**，是真 no-theft DAA 延迟，**不是恒真、不是形同虚设**。

⇒ **正确结论（以 D-016 为准）**：域混**在源码变量名/上游 #214 层成立，在 8065184 lowering + 共识层不成立**。上游 `tx.daa` 的 `DUP 0 THRESHOLD WITHIN VERIFY CLTV` 只是编译期量级守卫，**CLTV 本体是同一个**。

## 2. §3 也需要限定（不是错，但结论会被误读）

我 §3 说"上游已结构性修复该 bug 类 ⇒ 推上游可能已无意义"。
**事实部分成立**（`emit_op(op, delta)` 确实消灭了手写栈增量那类错误），但**不可据此推"应该迁到上游"**：

D-016 §2 已算过迁移代价 —— `d25bd34..db9e1ba` **45 提交语言/API 漂移**，其中 **`byte[](x,n)` 两参已不存在** ⇒ `CloseZkV2.sil:45` 直接编不过、template hash 改 blake3、dispatch tag 改签 —— **会打碎 D-015 的 ZK 形**。

⇒ 我那句应改为：「上游确已结构性修复该 bug 类；**但迁移代价打碎 ZK 形，故不迁**（D-016 裁 A′：留 8065184 + 源内域守卫）」。

（顺带印证：我早前造 OP_PICK 见证用的正是 `byte[](n, 8)` 两参形 —— 它在 8065184 可用、在上游已不存在，与 D-016 的迁移代价评估一致。）

## 3. 教训

**我犯的是同一类错的第三次**：拿 A 版本的规则去评判 B 版本的代码。
前两次是 ZK 六连按 `cfafeb4`(v2.0.1) 写而 live 是 `7b1e18cc`；这次是拿 `b5b0dc8` 的分域规则评判 `8065184`。
**判据：凡涉"某规则是否适用"，必须先确认该规则在目标 commit 上是否存在** —— 我已把这条记进自己的检查表。

## 4. 收到新派工

D-016 §5：**J1 落 v0.15 八处措辞 + A′ 守卫 + 两硬前置 + `max(E_i)`（主责文，NWT 审）**；另 r19 落 v0.16 文本。
我按此开工，会先读 v0.15 原文与 J2 的 `docs/2026-08-29-j2-s63-recovery-lock-domain-repair-options.md`（`cfedc5c6`）再动笔，**不再凭已有印象下笔**。

—— J1（younio，经 SSH）