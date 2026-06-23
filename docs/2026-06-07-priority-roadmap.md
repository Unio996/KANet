# KANet 预测+预言机 优先级路线图(2026-06-07 Owner 拍)

> 阶段判断:**机制层做完了(settle/forfeit/fee/UI 链证+验过),下一阶段主战场 = "预言机能不能在真实世界判得对、攒下可信记录"。** 本文 = 总纲,4+ 线归到 3 个优先级。守诚实边界(testnet + G5 不报经济闭环)。

## ✅ 已扎实(链证/Bettor 验过,基线)
- 4-of-5 委员结算(含 D12 自然失联 forfeit)链上证
- 找零核弹 fee:settle 链证 + disagreement math 验(:3200 live)
- UI 整盘:建市/web 押注/我的市场/oracle 仲裁人中心/进度 + 大白话(三关闭)
- LLM 证据层:读真 ESPN 数据判对+强理由(单点验)

---

## P0 — 预言机可信度(最核心)= 两半:预审端 + 裁决端
**结构性洞察(Owner 2026-06-07):** 主流死结 = 开放出题 → 没法裁的垃圾单(Augur 垮在这)→ Polymarket 只能人工中心化策展挡。**KANet 的解 = Agent 预审核(出题端)+ 去中心化预言机(裁决端),让开放出题不崩、又不收口创建权。本质救命。** 光做裁决端、出题端放垃圾进来照样崩 → 两半都是 P0。

### P0-A 预审端(LLM 预审核,出题端质量门)— Owner 钦定加入
**问题:现预审很浅** —— isStructuredSpec 只查字段非空;"LLM 检查规则清晰度"按钮还是 stub(静态评分,没真审)。
**目标:** 建市时 LLM 真审 (1) 数据源能否确定取到答案 (2) 判定规则有无歧义/主观词 (3) 将来可否无歧义裁 → 不合格**拦在创建前**(自动+去中心化版的 Polymarket 策展)。
**流程:** 对抗性讨论出设计 → 按方案建 → 测试循环迭代(全自动)。Owner: 全队对抗 + Bettor facilitate + 收敛。

### P0-B 裁决端(并行判定攒战绩)
| 子项 | 内容 | Owner | 状态 |
|------|------|-------|------|
| Track D 并行判定 | 5 预言机判真实独立源 vs UMA finalized 打分 → oracle_history shadow 准确率 | J2 引擎 + Bettor 筹划/验 | 🔨 kutzj 首条 shadow 分进行中(引擎已接通 pool_markets b1704da0)|
| 攒战绩 | 多 finished sports + 跨域 → 逼近 Phase2 毕业线 ≥90%/≥100 单·分域 | J2 + Bettor | 待 |
| 证据层硬化 | ESPN→ 扩 BBC/多源 + 对抗题(标题陷阱/源冲突)测 | J2 + Bettor | 待 |
| Phase 1 UMA 镜像 | derivePolymarketVote 真实单真测(48h gate) | J2 | 待 |

**标尺:** 出题端拦得住垃圾单 + 裁决端对真实市场准确率有据可查、非 0 战绩。Phase 2 发执照硬 gate 不碰。

## P1 — 找零核弹全闭 + 工程纪律
| 子项 | 内容 | Owner |
|------|------|-------|
| 找零核弹全路 | disagreement 链测;maker_unjoined/bettor-side 验;dispute/claim 扫全;**3 份 fork 合并 1 个 computeMassAwareFee helper** | J1 + Bettor 关2 |
| 部署纪律 | 固化 commit+push+pull+restart(脚本/checklist),防 committed≠live / cp≠ship / push≠pull(本会话反复撞)| 团队 + Bettor |
| 回归守 | 每条 fix NWT lint baked | NWT |

## P2 — 真实运营链路(中期)
- auto 出题(真实源)+ auto 押注 + auto 结算 循环(测试 bot + mock → 真用户真市场)
- winner 自动兑回 / 押注 funnel 接 9 链(backend 早 ship,UI 接)

## 关卡(每项不变)
Bettor 关1(事前审)→ impl → Bettor 关2(实测行为+看链,非纸面)→ NWT 关3(regression)。标尺 = 系统真工作 + 用户能用,非 KAS。

## 诚实边界
testnet + 现仍多 mock canonical;UMA/LLM 证据层真测刚起步;未报经济闭环(G5)。
