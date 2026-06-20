# RECON: External Agent Onboarding — /exchange Surface (facts only, no kit yet)

**Status**: RECON TASK CARD (Owner 2026-06-13 redirect: 真门槛=外部 agent 进得来, 非内部硬化)
**Owner (recon)**: J2-tn (主 — 最深 /exchange publish + broadcast + 端点上下文)
**Co-review**: NWT-tn (KI-21 grep 铁律 + bcast: 加密/determinism 角度)
**Assembler**: Bettor-tn (收 facts → 拼"外部 agent 最小上手包" task card)

## 为什么这个先做（Owner 框定）
项目目标不是"把码磨到能 ship", 是让**外部 agent(或其 Claude Code 工具人)能上手来 TN12 玩**。外部 agent 能不能自己摸进来 = 整个论点的活 demo(无法律人格、靠结构信任、permissionless 自跑通)。门槛太高=论点没被演示。三个内部硬化(#1/#2/#3)不降门槛, 这个直接决定推文发出去后有没有人能进来 = 杠杆最高。

## 入口 = /exchange
协议级自由市场, permissionless 那层, give/want 自由字符串, public 端点已在跑。
**Hello-world** = 外部 agent 往 TN12 发一个 offer → 被另一边观测到。跑通这一下 = 论点演示成功。

## 岔路（recon 要分清, 决定 kit 是两页文档还是打包节点）
- **快速上车**: 外部 agent 调一个跑着的 KANet 节点 public API(curl `POST /api/exchange/publish` 那套)。门槛最低, 靠托管节点。← Owner 建议先上这条(配推文, 当天可玩)
- **纯链上**: 外部 agent 自己往 TN12 广播, 任何节点观测。真 permissionless, 但得摊开广播格式(payload 编码/加密)。← 正式玩法, 后补

## RECON 问题（KI-21: grep + 报 file:line 实, 禁猜。报 EXISTS vs MISSING）

1. **/exchange public 端点清单**: grep 实际 public(无 auth)端点(`POST /api/exchange/publish` + 配套)。每条报: method, path, 必填 body 字段, 要不要 auth。**关键判**: 一个外人拿 curl + 一个 TN12 地址能直接用, 还是必须有本地 relay/adapter 才能调? (= 快速上车可行性)
2. **消息格式**: give/want/verification JSON schema 精确字段 + 哪些必填 + 一个真实 example payload。代码里写死还是有 doc? (= 工具人照着填的模板)
3. **"被另一边观测到"的路**: offer publish 后, 另一个 agent 怎么 OBSERVE? (GET 端点? 扫链? 订阅?) 这条观测路也是 public/curlable 吗? (= hello-world 的下半场)
4. **bcast: 加密层**: 广播 payload 加密还是明文? 若加密=什么 key/scheme, 外人没 relay 能不能解? (= 决定"纯链上"对外人可不可行, 还是必须走 relay)
5. **TN12 地址 + 测试币**: 外部 agent 怎么搞一个 TN12 地址 + faucet/测试 KAS? 有 faucet 端点/流程, 还是手动? (= 第一步卡点)
6. **最小 hello-world 序列**: 基于上面, 外人发一个 offer + 看它被观测, 最短 curl 序列是什么? **别建, 只列步骤 + 标缺口**(哪步现在断/缺文档/要内部 relay)。

## 输出
一份 **facts 报告**(端点表 + 格式 + 缺口清单), **不是 kit**。Bettor 据此拼"外部 agent 最小上手包" task card。报数守 KI-21: grep 引 file:line, EXISTS/MISSING 分明, 禁凭印象拼。

## 不做（边界）
- 不写 kit/文档/SDK(这是 recon, 出 facts)
- 不改码(纯只读调查)
- 不替 Owner 定"快速上车 vs 纯链上"(recon 出两条各自的可行性+缺口, Owner 拍)
