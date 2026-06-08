# 《测试网公开部署 DoD》— 终点【再次对齐】(非重新定义)

> **性质**: **再次对齐**,不是新定义。设计目标 + 方案早已在已锁文档里清楚(Owner 2026-06-01:"我们之前设计目标、设计方案已经很明确了,这次是再次对齐")。本文 = 把"终点"从已有文档**重新对齐 + 收口成一张可验收清单**,5-agent 对抗校验"我们是否还对齐、还差哪些具体缺口",收敛后 Owner 终裁。
> **主持**: Bettor-tn(架构/facilitator) | **对抗方**: J1(SS)/ J2(settler/relay)/ KANet-UI(bot/UI)/ NWT(攻击审)
> **状态**: ✅ **Owner 终裁锁定(2026-06-01):6 条判据认可,执行序从 create-v07 快照起,开干。** 执行中。

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

## 4. 对抗收敛结果(J2/KANet-UI/NWT 已出;J1 SS 三问折入执行,不阻框架)

**框架收敛:5 条判据全员认 + NWT 加第 6 条(verifier gatekeeper)。** 各判据的"真实范围"被对抗逼出:

### #1 完整赌局闭环(带 bettor)— 范围远大于"修个快照"
- create-v07 快照修(L552 pool_merkle_root mismatch)
- **settle 路径 7+ 处 v0.6-only guard 未堵**(J2.a:L606/651/655/669/746/781/1455)→ 带 bettor v0.7 settle 会复刻 T2 那套 multi-tick churn
- **bot console-api 没 wire v0.7 register**(KANet-UI W1)→ 用户 /bet 选 v0.7 市场被 L287 filter 掉 = **用户根本下不了 v0.7 注**,必修
- **WASM 殃及 settle 待验**(J2.e):`_assertTxInvariants` L93 + `unlockPoolSpineP2SH` 都调坏掉的 `calculateTransactionMass` → settle 是否同 panic 未知,待带-bettor settle 实测;若中招,把 891c94d 的 byte-size mass 推广到 settle

### #3 鲁棒 — 今晚同类脆弱点必须系统性堵
- **RPC-timeout-everywhere**(J2.c):全 codebase 只补了 1 处,dispatchPhase2/sampling 仍裸 await → 必 lint `RPC await 必 Promise.race timeout`
- **auto deadline-watcher**(J2.f,~20-30 LOC):settler tick 顶 query `pending_bettors AND deadline<=?` → auto-fire,不靠用户手动 /settle
- **same-tick handleRefunding**(J2.g):dispatchRefund 后同 tick 广播,别等 5min

### #5 用户可用 + 可审计 — 入口大体已 ship,卡在 W1
- ✅ TG bot 0-key deep-link 入口(E1:/bet /mybets /link /swap /help)+ G4 deadline 拦 + variable-stake UX
- ✅ 证据链(V1-V3):/mybets 显示 stake_txid + settle/refund_txid + tn12 explorer 双向 link;押注 confirm 即时自验;DM 凭据指针
- ✅ testnet 攻击挡:bot 推假 settle → 用户 explorer 自验识破;bot 拒推 → wallet 自动 sync 兜底
- ⚠ 阻塞 = W1(bot 没 wire v0.7);claim 一键 button defer(mainnet 才整 wallet sdk)

### #6 verifier baked gatekeeper(NWT 新增,全员认)
- 每 ship 前自动跑 NWT 3-mode(attack-static 等)+ **git pre-commit hook 强制**(KANet-UI 加力)→ 堵"同类坑再生"(7+ guard / RPC-no-timeout 这类不再靠人肉)

### J1 SS 三问(已答,r240,J1 11h 离线后 catch-up)
- **Q1 settle SS 洞**:v0.7 settle ≈ v0.6(委员 sig/4-of-5 阈值/depth-8 merkle/payout 公式 `inputs[0].value × total/winner` **全同**),只多分片 ctor +3 + entry0 +3 args + PoolSide fee 范围化。**4 洞全是跨-shard 一致性**(commit_v2 SS 不 verify blake2b、靠 committee sig + off-chain settler;totalPool/winnerPool caller-supplied 靠 committee sig 覆盖)→ **单片 #1 无关,是多片 #2/批3 的攻击面**。→ **#1 带 bettor settle SS 侧低风险,复用已证 v0.6**。
- **Q2 dispute_reveal slash 最小 SS**:**SS hook 已存在**(PoolSpine v06/v07 entry 1,L254-275,收 disputeOutcomeHash + 5 committee sig,**unanimous t=5**,验 blake2b==committeePkHash),**不需新 SS**。**关键:slash 不在 SS——是 SOCIAL/off-chain**:dispute_reveal 链上暴露 individual 签字 → settler 社交层从 pool standing stake(A.1 决议)forfeit。**SS attest,social slash**。→ #4 演示 = ① settled market(46f8a ✓)② 定 dispute window(spec 未明文,J1 起草)③ coordinator 触 5 委员签 ④ settler 接 off-chain forfeit。
- **Q3 WASM 殃及 settle**:_assertTxInvariants(p2sh.mjs L41)在全 5 个 P2SH submit 站(含 settle 的 unlockPoolSpineP2SH L923)被调,**不会崩**(Σin==Σout+fee + dust 仍 active,graceful)。**但**结合 J2.e:mass-floor(6ed8848 红线7)调坏掉的 calculateTransactionMass 时是**静默降级**(caught→warn)→ 红线7 在 settle 上没真生效。→ **#3 新增项:把 891c94d 的 byte-size mass 扩到 _assertTxInvariants mass-floor**。

## 5. 执行序(Owner 终裁后)

1. **#1 带 bettor settle**(最大块):create-v07 快照 → 7+ v0.6 guard wire → bot v0.7 register(W1)→ #1.4 带 bettor settle 真链测(same-node 先证机制)→ **#1.4b cross-node 真链测(必加)**:J1 是独立节点(LAN :3300 + 自己 kaspad),真实测试网公开=分布式,参与方跨节点。必验:① 委员跨节点签 settle ② 跨节点 maker settle/refund(settler 现有 'skip remote-maker→producer node' 逻辑必须真测能跨节点协调、不是只 skip)③ 三方分账跨节点落链。**same-node PASS ≠ cross-node PASS,两者都要真链 is_accepted。**(顺带验 WASM 殃及 settle 的 mass-floor)
2. **#3 鲁棒**:RPC-timeout 扫荡 + lint + auto deadline-watcher + same-tick UX
3. **#2 规模**:分片(批3)+ T3 多片 E2E
4. **#4 经济范式演示**:J1 定 slash 最小 SS → 落地 → testnet 演示
5. **#6 gatekeeper**:贯穿,git pre-commit hook 立即可上

---

*Bettor-tn 起草 + 对抗收敛(J2/KANet-UI/NWT 已折入,J1 SS 三问待补不阻框架)。边界 Owner 钦定不可议。请 Owner 终裁 6 条判据 + 执行序;终裁后第 1 项 create-v07 快照立即开干。*
