# 《测试网公开部署 DoD》— 终点【再次对齐】(非重新定义)

> **性质**: **再次对齐**,不是新定义。设计目标 + 方案早已在已锁文档里清楚(Owner 2026-06-01:"我们之前设计目标、设计方案已经很明确了,这次是再次对齐")。本文 = 把"终点"从已有文档**重新对齐 + 收口成一张可验收清单**,5-agent 对抗校验"我们是否还对齐、还差哪些具体缺口",收敛后 Owner 终裁。
> **主持**: Bettor-tn(架构/facilitator) | **对抗方**: J1(SS)/ J2(settler/relay)/ KANet-UI(bot/UI)/ NWT(攻击审)
> **状态**: v0 对齐草案。

## 0.0 锚:目标/方案的权威出处(本 DoD 从这些派生,不新增)

- `docs/KANet-Positioning.md` — 定位:协议基础设施,三原语(安全通信/身份发现/价值结算),只建地基。
- `docs/DEVELOPER-GUIDE.md` — 唯一权威全系统文档。
- `docs/2026-05-30-oracle-economic-security-v0.6-spec.md` — v0.6 经济安全 spec(Owner 5/30 锁)。
- `docs/2026-05-31-oracle-v06-committee-bond-decision.md` — A.1 委员 bond 决议。
- `products/03-prediction-pool.md` — 预测池产品 spec。
- `docs/2026-06-01-change-landmine-depth20-selfclaim-audit.md` — 找零核弹 + 分片 + 自取 audit(含红线 + qlfpv 案例)。
- `docs/ALPHA-CHECKLIST.md` — Alpha 达标。

**DoD 的 5 条判据都是上面文档已有目标的"测试网公开版"收口,不引入任何新目标。对抗时如发现某条偏离了上述文档初衷 → 退回对齐,不是改目标。**

---

## 0. 固定边界(不可议,Owner 2026-06-01 钦定)

- **我们团队的终点 = 公开部署到测试网**。验证**范式 + 技术**,**不涉及经济利益**(testnet 钱无价值,只探讨范式和技术)。
- **mainnet 公开部署 NOT 我方 scope** — 不具备资源/合规/运维/审计体量,交给有能力的团队用我们蹚通的范式去尝试。
- Owner: "我们虽然追求理想,但我们需要懂得边界。"
- **对抗约束**: 任何人不许把下面的判据**拔到 mainnet 生产级**。判据只服务"测试网范式演示可公开"。

## 1. DoD 草案(5 条,达标即可公开部署到测试网)

| # | 判据 | 验收线(真链/实证) | 主责 |
|---|---|---|---|
| 1 | **完整赌局闭环**(带 bettor) | 开市→押注→settle→赢家+oracle+broker 分账,全公链 `is_accepted`。基准已有:46f8a/xfu62。缺口:create-v07 快照(带 bettor 的 v0.7 settle 会挂) | J1+J2 |
| 2 | **规模**(破 64 上限) | 分片落地 + 多片 E2E(T3)真链:≥2 片 ~130 bettor 并行结 + 全局赔率正确 + 全赢家分到 + Σ balance is_accepted | J1+J2+KANet-UI |
| 3 | **鲁棒** | 无 crash/churn;node/settler 稳;异常路径(卡单/退款/争议/0-bet)都有兜底**且真测过**。今晚教训:RPC 超时 / 一坏市场不拖死 tick / 重启不连环 | 全员 |
| 4 | **经济范式演示**(有界) | stake 锁 + `dispute_reveal` slash 机制**功能性可见、可审计**,在 testnet 跑通演示,证这套自洽经济设计成立。**非** mainnet 级硬化/审计 | J1+J2 |
| 5 | **用户可用 + 可审计** | bot/UI 普通用户友好入口(押注/自取/查 TX);每笔链上可查;主权自取 button | KANet-UI |

## 2. 给对抗方的靶心问题(请各挑刺,别客气)

- **@J1**: #1 带 bettor 的 v0.7 settle,除 create-v07 快照外还有哪些没测的洞?#4 `dispute_reveal` slash 在 testnet "演示成立" 的最小 SS 实现是什么?
- **@J2**: #2 分片并行结的 settler 调度,#3 鲁棒还有哪些"今晚同类"的脆弱点(超时/状态机顺序/RPC)没堵?#4 slash 的 settler 侧最小落地?
- **@NWT**: #3/#4 攻击面 — testnet 范式演示下,哪些作恶路径**必须**演示挡住才算"范式成立"(哪怕经济激励低)?哪些可以诚实标"mainnet 才硬化"?
- **@KANet-UI**: #5 普通用户(非跑 relay 的 web2 用户)入口的最小可用集?#1/#2 的 UI 可验证证据链?

## 3. 守的纪律(降到 testnet 仍不松)

- 降到 testnet 范式演示,仍**不报"经济安全闭环 / 可托付真金"** —— 只报"经济范式在 testnet 跑通演示"。诚实分级到底(守 G5)。
- 每条判据**真链 is_accepted 才算过**,审过/单测过 ≠ 真过(T2 14 层教训)。

---

*Bettor-tn 起草 — 边界 Owner 钦定不可议,5 条判据征对抗收敛,收敛后 Owner 终裁。收敛即定稿,create-v07 快照作为第 1 项立即开干。*
