# KANet 开发流程框架

> **Status**: CURRENT
> 本文件填补 `CLAUDE.md` 铁律0 长期引用但从未创建的断链(2026-07-07 J1tn 发现并补)。内容 = 团队今天实际在跑、被反复验证有效的流程,不是发明新规矩。

---

## 铁律0：报备 → 审核 → 批准 → 测试

**任何 agent，未经这四步，无权改动任何代码。先报计划，后动手，绝不先斩后奏。**

1. **报备**：贴到 `dev-coord-testnet` 频道——做什么、改哪些文件、为什么这么设计（既有资产核查在先，见 CLAUDE.md 接位 SOP 第5条）。
2. **审核**：reviewer（按 COORD-LEDGER DOMAINS 表，通常是 NWT 或域内 reviewer）逐项核实，不是听方案文字，是**读实际代码/编译产物/字节偏移**——GREEN 或列 finding。money-path/covenant 代码必须字节级验收（byte-exact diff 是唯一判据，功能测试过 ≠ 过关）。
3. **批准**：Bettor（协调域）签字 GO，才允许 commit/落码/广播。
4. **测试**：落码后贴证据（diff + 实测输出，例如 byte-exact diff / clock-check 结果 / testnet dry-run），reviewer 复核证据后才算收尾。

**用户面 / 钱路·covenant·结算 / 重大功能 = 必须 Owner 批**才能动（CLAUDE.md 铁律0 原文）。Bettor = 强制审核闸；绕过审核/写完才报备 = 改动 revert。

---

## 新增：技术不确定性直接问 Bettor（2026-07-07 J1tn 提·实践中验证需要）

**遇到需要验证的技术不确定性时（旧消息是否已经陈饭/某个假设对不对/某条 blocker 是否还开放），直接问 Bettor，不要自己长链条静态回溯调查再拍。**

- **为什么**：J1tn 2026-07-07 接位时,对一条自己都不确定是否已发出的旧消息("escape_trigger blocker"),花了大量周期通读 COORD-LEDGER 自行判断"是否陈饭",而没有直接问协调者——事后 Bettor 一句话就查清真相(消息压根没广播成功，撞在 Phase0 停栈窗口)。协调者手上有全频道可查记录 + 广播成功与否的第一手判断依据，agent 自己脑补大概率绕远路。
- **怎么应用**：技术类不确定性（"这个是不是已经解决的旧问题"、"我理解的现状对不对"、"这条 blocker 还在吗"）→ 频道里直接 @Bettor 问，别自己先做一轮独立调查再回复。**跟"设计前查资产"（CLAUDE.md 接位 SOP 第5条）不冲突**——那条是防重造，本条是防在**确认性问题**上单兵长链条绕路；技术设计/实现方案本身仍应该自己先动脑，只是"这件事是否已经发生/已经解决"这类事实性核实，直接问人比自己考古更快更准。

---

## 参考

- `docs/DECISIONS.md` — 战略决策单一真值
- `docs/iteration/COORD-LEDGER.md` — 当前协调状态
- `docs/ANTI-PATTERNS.md` — 具体踩坑模式
- `docs/kanet-open-iteration-framework-v0.3.md` — OIL 框架（角色/域/公理层）
