# NWT 红队复核 · RefundClaim语法迁移(`79fcfe1a`) + draw-down第五处MUST-FIX(`f8e95e35`)

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1164/1167：语法迁移+draw-down修独立核；"恰好为0"边界向量我自己独立构造一遍（不只是重跑
> J2的向量），这是我1139点名要打的边界。

## 结论：**两笔均GREEN。语法迁移零业务逻辑改动确认；draw-down第五处修复跟已修四处逐字同形；"恰好
为0"边界我用完全独立的数值/身份/工具链重新构造并跑通，另加一条自己设计的off-by-one负向量，双重
确认这条边界防线是真实生效、不是凑巧对上J2选的具体数字。**

## 一、语法迁移(`79fcfe1a`) —— GREEN

**diff核对**：只有三处改动——`entrypoint function`→`entry`、裸struct字面量→`State{}`、
`byte[34]`→`byte[36]`（P2PK宽度迁移，同本会话已核过的其它文件同款迁移）。`readInputStateWithTemplate`
调用、`require`顺序、字段语义全部原样未动——跟commit message"零业务逻辑改动"的描述一致。

**独立验证**：字节级重编译与`RefundClaim.compiled.json`一致；3条烟雾向量（部分退款pass/未cancel
fail/ticket属别的pool fail）独立跑通3/3 PASS。

## 二、draw-down第五处MUST-FIX(`f8e95e35`) —— GREEN

**diff核对**：只把原来的无条件续约替换成`if (pool_value==tk.stake) {显式守恒,不续约} else {原续约
逻辑不变}`——跟已修四处（`PayoutShard.claim`/`PayoutShard.refund_claim`/`PayoutShardV2.refund_claim`/
`RootClaim.claim_draw`）逐字同形，没有夹带其它改动。

**独立验证**：
- 字节级重编译一致；既有4条draw-down向量 + 3条烟雾向量（回归确认）独立跑通，共7/7 PASS。
- **独立构造"恰好为0"边界向量（不是重跑J2的）**：用自己的`silverc`构建、完全不同的具体数值
  （`pool_value=stake=137`，J2用的是`80`）、不同的bettor/pool/covenant身份字节（`0x91.../0x5c.../
  0xd7...`，J2用的是`0x22.../0x37.../0xcc...`），复用`PoolSideStub.sil`独立编译出一枚真实ticket实例
  （模板哈希由我自己的编译产物算出，不是抄J2的），构造`tx.outputs`只有1个输出（无续约槛位）——独立
  运行`PASS`，跟J2的`DD-RC-refund-1`结论一致但完全是我自己独立生成的第二组证据，排除"凑巧对上J2挑的
  数字"这个可能性。
- **额外自己设计的负向量**：在同一个恰好为0场景里，把payout金额故意写错1个单位（`136`而非`137`）——
  独立运行`FAIL`，确认这条边界不是只在"数字正好写对"时才通过，是真的在核对金额。
- **顺手核对了一个设计问题（非缺陷）**：`if`分支不引用`rootOutIdx`，意味着这个分支不会去检查是否
  真的"没有续约输出"——如果攻击者在恰好清零场景里仍然往`tx.outputs`里塞一个额外的、这个covenant自己
  不检查的输出，`if`分支不会拦。**这不构成漏洞**：Kaspa的总输入=总输出守恒由节点在交易级别核对，
  不需要每个input的脚本都去穷举检查tx里所有output；这个分支只需要保证"它自己要求的那个payout输出"
  正确，不需要断言"tx里没有别的输出"——跟本会话此前已审过的另外四处同款draw-down分支的设计完全一致，
  不是这次迁移/修复新引入的问题。

## 三、给Bettor的处置建议

- **两笔GREEN，可以定案**。"恰好为0"边界已用完全独立的构造二次确认，不是只信J2的向量通过。
- 无新发现的安全问题。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
