# Pool Prediction Market 规则 v0.5 (完整版 — 2026-05-23)

**状态**: Area 1-3 共识 + V8 + Q10 + Q2 + pp.txt 10 sub-question 全整合
**Source**: 5/21 spec 终稿 + PoolSpine.sil L9-16 + 5/22-5/23 area dialogue chain_events + pp.txt 第三方 review + Owner V8/Q10/Q2 钦定 + J1 #480-#488 critique
**Outstanding**: V8 nail #4 reveal-fail 罚倍数 / Q10 4 数字 (Tier 2 N + 权重公式 + governance + correct_votes 定义) — 进 area 10/12. Area 4-12 待 dialogue.

---

# Area 1 — 角色定义

## 1.1 非托管永久不变量

bettor 永远控制自己签名私钥. 任何一方 (含 broker) 永不托管 bettor 私钥. KANet trustless 前提的**永久架构不变量**, 不是 phase 阶段标记.

## 1.2 反目标 — 永不实现

**托管 broker (= broker 持有 bettor 私钥 + 代签)** 是反目标永不实现.

broker-fronted 生产 UX 必须用**非托管 broker 模式**: 标准 dApp = 私钥客户端 (浏览器钱包) + broker 转发已签名 TX, 不持有私钥.

理由: KANet 价值主张就是 trustless 替代中介. 允许 broker 持私钥 = broker 变 mini-CEX = 整个故事崩.

## 1.3 角色定义 (= 4 个)

| 角色 | 定义 | 协议动作 | 经济角色 |
|---|---|---|---|
| **maker** | market 创建者 + host. **必须自己也下注一边 (恒为 bettor)**, 不能纯当庄家. | refund_unanimous_silent / refund_maker_unjoined single-sig | 锁 maker stake 到 spine P2SH (= 1 笔), 方向 = outcome_side (= code: pool-market-settler L329) |
| **bettor** | 押注者, 1-50 个. 独立 PK 持有者. | refund_market_cancelled bettor sig | 锁 stake 到自己的 PoolSide P2SH (每人一个 P2SH, 互相隔离) |
| **oracle** | 第三方裁判, 3 个 (奇数防平票). | 投票 chain_event + 签 settle TX | 锁 bond 到 spine P2SH. 投 YES / NO / 沉默 |
| **broker** | 基础设施 + UI 提供方. **链上完全被动**, 只在 settle 时被动收 outputs[0] 这一笔 fee. | 0 链上协议动作 (= 0 撮合, 0 签名, 0 中转资金) | settle 时被动收 fee |

### maker = bettor 设计 (skin in game) — code 已锚

- 防 maker 当 "纯庄家中介": maker 没自己 stake = 利益跟 bettor 不对齐, 可能创建坑爹 market
- maker 强制押一边 → 有自己钱在场 → 有动机让 case 规则清晰 + oracle 接得住
- maker 方向**不能自选**, 协议层绑定 outcome_side

Code grounding (= 已 ship):
- pool-market-settler L329: `makerDirection = outcome_side === 'YES' ? 0 : 1` — 方向绑 outcome_side
- pool.js L103: `transferAndConfirm(maker_relay_id, spine_p2sh, makerStakeStr)` — maker stake 锁 spine 不锁 PoolSide
- dispatchPhase2 L367-370: computePoolPayouts 把 maker 当 participant `{isMaker:true}` 参与 payout

## 1.4 排他性 — 1 条铁律

`oracle ∩ {maker, bettor, broker} = ∅` — oracle 必须是对该 market 无任何财务头寸的纯第三方.

其他角色可以重叠 (= maker 必然是 bettor; broker 可以是任何不是 oracle 的人). **只有 oracle 单独被孤立**, 因为只有 oracle 有协议层投票权.

**broker/oracle 互斥**特别说明: broker fee 跟 losing pool 正比, broker 兼 oracle 有动机让 "大押注那边输" 让自己抽得多 = manipulation 向量.

### Code enforce (= 已 ship, Q11 patch master 80d627e5)

- `pool.js` bettor/register L221-229: parse `market.oracle_relay_ids` + check `bettor_relay_id ∈ oracle 集` → 403 reject
- maker / broker 故意不 block (= area 1 钦定 maker=bettor, broker 可 bet)
- 5/5 test PASS

## 1.5 基数硬编码

- 1 maker
- 3 oracle (= 奇数防平票)
- 1 broker
- 1-50 bettor (= 50 是 TX size 上限)

## 1.6 身份 = relay node

所有 4 角色都是 relay_nodes (= pubkey + address). 不用账号系统.

## 1.7 分配时机两类

- **create-baked** (= 固定): maker / broker / 3 oracle pubkey 在 PoolSpine.sil ctor 时 baked 进 marketMetadataHash. 改一个字符 = 完全不同 P2SH 地址.
- **注册窗口动态**: bettor 在 register phase 动态加入.

## 1.8 判定规则不可变 (= 正向不变量)

`marketMetadataHash = sha256(condition_id || token_id || resolution_rule)`. 判定规则也 hash 钉死.

防 maker 在 oracle 接单后偷偷改条件: 改一个字符 → metadataHash 变 → P2SH 地址变 → 锁的钱跟着变 → 直接断链.

---

# Area 2 — Oracle 接单

## 2.1 Option 1: Random oracle assignment (= Owner 钦定 协议层 enforce)

maker 不传 oracle_relay_ids. 系统从 is_oracle=1 pool 随机抽 3.

**maker 0 selection 权 + 0 排除权**.

理由: 之前可能允许 maker 指定 3 oracle (= maker 串通向量). 协议从池子随机抽.

## 2.2 Seed 设计

`seed = blake2b(block_hash[N+k] || market_id)`:
- N = create TX 落入的 block 号
- k = 协议固定常数 (= 见 2.13 reorg 安全)
- market_id baked 让同 block 多 market 不撞 seed

关键: 用**未来 block hash** → maker 在 create 时不知道 → 无法 grind seed.

链本身就是 randomness beacon, 不用 VRF.

## 2.3 抽样算法 — 确定性

1. pool 按 pubkey 字典序排
2. Fisher-Yates with seed shuffle
3. 取前 3

**算法明文写死**, 任何人都能 reproduce. sampling 不能黑箱.

## 2.4 新 phase: pending_oracle_sampling

```
create (锁 maker stake, status=pending_oracle_sampling)
  ↓ 等 k block
cron 算 seed + 抽 3 + chain_event 上链 (= 含 seed 输入 + 算出 seed + 池子快照 + 抽中 3 oracle)
  ↓
status=pending_oracle_deposits + 通知抽中 oracle
```

(= 注: testnet 公开 sampling chain_event 含 oracle PK; mainnet anti-collusion 见 Area 12 Q2 reframe)

## 2.5 Accept 窗口 + re-sample + 3 维度 hard cap

每个抽中 oracle 给 T_accept (= 待 area 7) deposit. decline / 超时 → 该 slot re-sample.
re-sample seed = `blake2b(block_hash[N+k] || market_id || attempt_number)` (= per-attempt 确定性但不同).

**3 维度任一触发即终止 re-sample**:
1. 该 slot 1 个 accept 窗口 T_accept
2. 总 deposit phase deadline D_deposit (= 待 area 7)
3. 总 attempt 上限 max_attempts (= 待定具体值)

任一触发 → market failed → refund.

## 2.6 Sampling-fail refund (= 政策约束 simpler 路径)

**0 oracle deposit 前 sampling-fail**: spine 只有 maker 1 UTXO → 现有 `refund_maker_unjoined` (inputs.length==1) 干净命中, **无需新 SS entry**.

**Partial-deposit sampling-fail** (= 1-2 oracle 已 deposit, 第 3 sampling-fail): **政策约束 — deposit 开始就禁止 re-sample**. 该 slot 之后空缺 → market 走另一终态 (= area 4 refund 路径).

理由: 把 re-sample 严格限制在 "还能用 refund_maker_unjoined 兜底" 的时段, 简单 + 一致.

## 2.7 Pool size enforce

- >= 3 (= 硬 enforce, 否则 create reject)
- 推 >= 5-8 (= warn 但不 block, randomness meaningful, 3 抽 3 = 全抽中 = 没随机)

## 2.8 v0.5 testnet 诚实段

v0.5 testnet 所有 relay 同一 operator (= 我们自己 10 个 agent). 从同一 operator 抽 3 — 抽样**机制**对, 但**不是 trustless** (= 抽中的仍是我们).

v0.5 testnet 验证的是**采样机制正确性**, 不是信任属性. 真信任只有 pool 是独立 operator 时才兑现.

防止以后误以为 "v0.5 跑通就 trustless 了".

## 2.9 接单语义

oracle deposit = **commit 在 market 进入 verifying 后 ORACLE_SILENT_TIMEOUT 内投 YES 或 NO**. 不投 = silent = bond forfeit.

时限 = deadline + silent_timeout, 不是仅 deadline.

## 2.10 Ambiguity 3 分层

- **可预见 ambiguity**: case 规则不清, oracle 在 deposit 前 reject (= 不 deposit, 走 re-sample)
- **emergent ambiguity** (= 规则当时清楚, 结算时变糊, 比如比赛取消): oracle 仍得被迫 best judgment 或吃 silent 罚
- **真争议**: Phase 5 challenge mechanism (= v0.5 不实现)

## 2.11 信誉门 — deferred goal

v0.5 仅 binary is_oracle=1 + tier 标签 (= Q10 详见 Area 12). v0.5 假设 oracle 集合可信. 信誉评分留 Phase 5.

## 2.12 投票收集 — 正向不变量

投票收集是 **chain_event-based**. maker 无角色 → maker 不能 censor / 扣留 oracle 票.

## 2.13 Reorg 安全 — k 值

Kaspa Crescendo 10 BPS post-fork. k=10 = ~1 秒 finality = **远不够 reorg 安全**.

k 应是 "Kaspa 团队推荐 irreversibility depth", 直觉至少 100-300 block, 具体数字**不在我们 scope** — 应问 Kaspa core 团队或查文档.

v0.5 testnet 占位 (= 100), mainnet k = Kaspa 推荐 finality depth TBD. 别让 placeholder 静默成 final.

---

# Area 3 — 投票规则

## 3.1 投票空间 — 三元 {YES, NO, ∅}

oracle 只能输出三种:
- YES
- NO
- ∅ = silent (= 没投票)

## 3.2 DISPUTE 砍 (= spec 外加戏, 必删)

code 里 DISPUTE 选项是程序员擅自加的 (= spec 0 mention). 必砍 3 处:
- `pool.js:339` vote endpoint outcome 校验只接受 YES / NO
- `decideConsensus:186` votes 数组只接受 YES / NO
- `bettor-prediction-voter.js:L464/L524/L556` voter daemon DISPUTE 出口砍

理由: oracle 接单时已 commit "我会投 YES 或 NO". 装糊涂的出口在接单阶段. 投票阶段再开 DISPUTE = 让 oracle "接了单又装糊涂" = 设计漏洞.

## 3.3 协议层 vs daemon 策略层 (= 分清)

- **协议层** (= 链上看到的输出): 硬限三元 {YES, NO, ∅}
- **daemon 策略层** (= voter daemon software 决定): 协议不管

## 3.4 daemon 低信置推荐 (= 非协议)

LLM 信置 < 阈值 → daemon **default 弃票** + 通知 operator "如果你不手动投, bond 会失".

operator 在 silent_timeout 前可手动覆盖.

理由: daemon 不该在 operator 没明确同意下拿 operator 的 bond 去赌一个 LLM 自己都没把握的猜测. oracle 后面是人, **human-in-loop 是现实而正确的 escape**.

可前置 bounded retry (= 2 次) 消化 LLM transient variance.

## 3.5 Silent vs Dissent

- **silent (∅)** = 没投票 → **失 bond** (= 罚)
- **dissent** = 投了但站少数派 (= 2 YES + 1 NO 时那个 NO) → **不罚** (= 真投票了, 跟主流不一致是正当反对)

关键: 区分"没尽到义务"和"尽到义务但跟多数不一致".

## 3.6 投票 finality (= code 已双重 enforce)

投了不能改不能撤. 已实现:
- `pool.js` vote endpoint dedup: 重复投被拒
- `decideConsensus` first-wins: 每 oracle 取第一票

## 3.7 evidence_hash 占位

投票 chain_event 含 evidence_hash 字段, v0.5 是**非功能 placeholder** (= 没有验证价值). 真验证机制留 Area 9 dispute resolution.

## 3.8 投票 ≠ 签 settle TX (= 关键边界)

| 动作 | area | 内容 |
|---|---|---|
| **投票** | area 3 | oracle 上链 chain_event 说 "我认为是 X". decideConsensus 用来定 winner |
| **签 settle TX** | area 4 | oracle 用 PK 签真正花钱的那笔 multisig TX. 签的是 `blake2b(market_id \|\| winner \|\| pools \|\| merkleRoot \|\| metadataHash)` |

**投票 = 嘴上说; 签 TX = 真盖章**. area 3/4 边界画清.

## 3.9 V8 — Herd voting 防御 (= Owner 钦定 双轨路径)
### 问题
投票是 chain_event 公开可见. oracle 1 先投 YES → oracle 2 看到 → 抄 oracle 1 而非独立判断 = herd voting = 破坏 truth-seeking.

### Owner 钦定: A v0.5 + B mainnet (= trigger 绑事实不绑日历)

**A** (= v0.5 testnet 用): 接受公开投票. 简单, code 已经这样.
**B** (= mainnet 切): commit-reveal 2-phase.
- Phase 1 commit: oracle 上链 `hash(vote, nonce)`, 0 公开 plaintext
- Phase 2 reveal: deadline 到 oracle reveal vote + nonce
- decideConsensus 用 reveal 后明文
- 防 herd: commit 阶段独立判断, reveal 阶段同时揭开

### 4 nail-死

1. **Trigger precise**: 第一个 ≥1 **非 KANet operator** 出现就切. "独立" = 不同 ownership / 不同 ASN / 不同 KYC entity. 防 KANet sock-puppet 规避.
2. **Feature flag 同份 code**: 不是两套 code path. v0.5 flag-off (= A), trigger 触发 flag-on (= B). 一次 audit 一次集成.
3. **Mid-market 协议变更禁止**: 切换只对**切换后 create 的 market** 生效. 已存在 market 用 create 时协议跑完. 否则破 marketMetadataHash 不变量 (= 1.8).
4. **Reveal-fail 处理 (= ii)**: 比 silent 罚重. commit-but-no-reveal 是已 commit (= 已知答案) 选择性破坏揭示阶段 = 战略性破坏 consensus = 恶意更明确. silent 可能 daemon 弃票或网络丢 (= 无意), 罚轻.
   - ⚠ **具体倍数待定** (= J1 #488 catch): bond × 1.5 / × 2 / 额外从 Tier 2 stake 砍? Area 10 必落.
   - ⚠ **Tier 1 vs Tier 2 reveal-fail 处理可能不同** (= Owner 5/23 polish): Tier 1 没 stake 没法砍 stake, 可能 bond × N OR governance forced 退出 OR future sampling exclusion. Tier 2 可砍 stake. Area 10 一并 nail.

### 跟 Q10 绑死 — 同一事件

V8 trigger 跟 mainnet Tier 2 开 = **同一事件**. Tier 2 准入开 = B flag 自动开. 不需单独判断 "什么时候切 B".

## 3.10 V7 待 Area 7 — 投票时机 vs 真实结果延迟

比赛结果几小时后才公布 → deadline → verifying grace period? ORACLE_SILENT_TIMEOUT 窗口太短 → 逼 oracle 投瞎.

---

# Area 12 (= 提前 surface) — V0.5 vs Mainnet 切换 + Q10 oracle pool 来源

## Q10 钦定 C: KANet Tier 1 + Open Stake Tier 2 + 渐变

```
Tier 1 — KANet curated (启动期主力, 5-10 个)
  - 公开 onboard 流程, operator 身份 KYC / reputation lock
  - 不收 stake, 但发现作恶 KANet 主动移除
  - sampling 权重起步 90%

Tier 2 — Stake-bonded open registry (= day 1 同步开放)
  - 任何人锁 N KAS 注册为 oracle (= N 是反女巫门槛)
  - 作恶 → bond 罚没 (slash) → 自动出 pool
  - sampling 权重起步 10%

权重渐变:
  - 协议层硬编码 (block height / 时间) Tier 1 权重逐月衰减
  - 不是治理投票可调, 不是手动开关, 是数学公式
  - 目标: 12-18 个月后 Tier 1 权重 → 0
```

### 3 invariant 必 day 1

1. **Sampling pool 来源 on-chain transparent**: 每被抽中 oracle 上链时附 tier 标签. bettor 押注前查 market 详情能看到 "3 oracle 中 2 Tier 1 / 1 Tier 2". 让 bettor 自评 trust assumption.
2. **Tier 1 移除流程公开**: KANet 移除某个 Tier 1 operator 必须发链上 governance event, 理由公开. **不允许静默移除**.
3. **Tier 1 权重衰减是协议层硬编码**: 写进 SilverScript 合约, 不是治理投票可调, 不是 KANet 可单方面延后. 否则 KANet 永远有动机延后衰减 = C 退化成 A.

### 信誉评分 — Phase 5

不阻塞 mainnet.

mainnet day 1 用 transparency metric 替代: 每个 oracle 的 `total_votes / correct_votes` (= 按 consensus 算 correct) 公开. 这不是"信誉评分"是"投票记录", bettor 自看.

真正的信誉评分 (= sybil-resistant / stake-weighted / time-decayed) 等 mainnet 跑半年有真实数据再 design.

### A 是反目标延伸 — C 反退化护栏

- A 简单到危险 = 启动快但 KANet 倒了整个 oracle 池子崩, 违背反目标精神 (= bettor 不信 broker 改成信 KANet, 信任对象换名而已)
- B 冷启不可行 = mainnet day 1 没信誉历史
- C 已被 Cosmos / Polkadot / Ethereum PoS 早期 stress test 过, 工程路径已验证
- 衰减硬编码 + 移除流程公开 = 反 C 退化成 A 的护栏

### ⚠ 4 数字待 nail (= J1 #488 catch, area 10/12 启动前必答)

1. **Tier 2 N 反女巫门槛多大**? N 太低 = 女巫便宜攻击; N 太高 = 没人参与. 真数字 (= 10000 KAS? 100000 KAS?) 必须 calibrate 跟单 market pot cap 比, 否则女巫拿 100 KAS bond 接 100 KAS pot 市场 = 完全 cost-effective 攻击.
2. **权重 90/10 → 0 数学公式具体**? 线性 / 指数 / 12-18 月怎么算 (= block height 触发 vs wall-clock) / SilverScript 硬编码 vs Console 常量?
3. **Tier 1 governance event 形式**? 谁投票移除 (= Owner / KANet operator 集体 / oracle 自身)? 投票门槛多少? 链上 event 格式?
4. **"correct_votes" 定义**? 2-1 disagreement 时无 consensus → 没有"正确答案" → transparency metric 怎么算? 排除? 算 abstain?

## Q2 reframe — mainnet-only anti-collusion (= J1 #488 catch)

### 问题
Owner 5/23 catch: 现 oracle deposit 是 chain_event public. maker 可见 → 可联系 oracle 私下串谋 (= 即使 Option 1 random sampling 已防 maker 选 oracle, 抽中后 maker 仍可贿赂).

### 🚨 我 (a) "sampling 结果 commitment hash" 是 BROKEN — J1 catch
我之前提 "chain_event 只放 hash, 不放抽中 3 oracle PK", vote 时 reveal. 但 area 2 钦定 sampling 算法是**确定性 Fisher-Yates from 公开 seed + 公开 pool snapshot** — 任何人 (含 maker) 拿到 chain_event 里的 seed 输入 + pool 快照, **本地跑同一算法**就能算出抽中是哪 3 个. **只 commit 结果 hash 不 commit 输入是没用的** — 输入已公开, 结果可推导.

### J1 reframe — Q2 是 mainnet-only 问题 (= 跟 V8 parallel 双轨第 3 条)

testnet 全是我们一个 operator → 没"maker 贿赂 oracle 私下勾兑"场景 = Q2 collusion 威胁不存在.

Q2 威胁**只在** mainnet day 1 + Tier 2 开 + 第一个非 KANet operator 出现才真实 (= 跟 V8 切 B 同时, 跟 Q10 mainnet onboarding 同时).

### 路径: testnet 公开 + mainnet (c) day1 + VRF 后升级

- **v0.5 testnet**: 公开 sampling (= 现 design). doc 明写 "testnet 单 operator 无 collusion 威胁, 公开 sampling 仅验证 audit 透明机制".
- **mainnet day 1**: 走 **(c) 经济威慑** — Tier 2 stake N 大到让 sybil-bribe 不划算. **invariant: `N ≥ max_pot_cap × M`** (= M 倍数待 Area 10 nail, Owner 5/23 polish 防 default 到 1:1 比例 = sybil 攻击 1:1 成本 = 不威慑). 配合 slash + Tier 1 KYC + 信誉记录. **不引 VRF 复杂度做 day 1 阻塞**.
- **mainnet 后续 hardening**: (a''') **VRF-based 自识别** — 每 oracle 持 VRF key, 算法产生 VRF-proof-of-selection per oracle. oracle 私下验证自己是否被选; 其他人没 VRF proof 无法判定. 当 day 1 后稳定运行半年后升级.

### 不跟 V8 commit-reveal 套同模板
- **V8** = [...]
---

# Phase 顺序图 (= J1 #486 画)

```
create
  ↓ (锁 maker stake → spine; sampling 还没做)
pending_oracle_sampling
  ↓ (等 k block; cron 算 seed + Fisher-Yates 抽 3; chain_event 上链)
pending_oracle_deposits
  ↓ (3 oracle 各自 deposit; 1-3 个 accept 窗口可能 re-sample;
     deposit 开始就禁止 re-sample per 2.6 政策)
pending_bettors
  ↓ (bettor register 窗口; 50 max; bettor∉oracle 检查 per Q11)
[market deadline 过]
  ↓ (settle endpoint 触发)
verifying
  ↓ (oracle 投票; decideConsensus 监视; ORACLE_SILENT_TIMEOUT)
collecting_sigs (= consensus 时) OR refunding (= refund 时)
  ↓ (oracle 签 settle TX; maker_relay 构建+广播)
completed OR refunded
```

每条 edge 的触发条件 + deadline 进 Area 7.

---

# Vote 组合 → Winner 解析表 (= J1 #486 列, 9 case)

⚠ **v0.5 简化注**: 无 consensus (= 1Y+2∅ / 1N+2∅ / 0+3∅) 时**不区分 dissent vs silent 全失 bond**. 3.5 钉的 "dissent 投了少数派不罚" 在有 consensus (= 2-of-3 majority forfeit_1) 时生效, 无 consensus 时 v0.5 不区分. **dissent 退 bond 是 Area 4 future hardening** (= 让 1Y+2∅ 那个投了的 Y oracle bond 退还).

| 票 | timeout? | 结果 | bond 处理 |
|---|---|---|---|
| 3Y 或 3N | n/a | settle (unanimous) | 全退 |
| 2Y+1N 或 2N+1Y | past timeout | **留白** (= Area 4 决) | 留白决 |
| 2Y+1∅ 或 2N+1∅ | past timeout | settle (forfeit_1) | silent 失 bond, 余 2 退 (= dissent 概念在此生效) |
| 1Y+1N+1∅ | past timeout | **留白** (= Area 4 决) | 留白决 |
| 1Y+2∅ 或 1N+2∅ | past timeout | refund_unanimous_silent | 3 oracle 失 bond (= v0.5 简化不区分 dissent/silent, area 4 future hardening 可改 voter bond 退) |
| 0+3∅ | past timeout | refund_unanimous_silent | 3 oracle 失 bond |

留白 2 行进 Area 4.

---

# 10 sub-question 收尾整合 (= pp.txt review + J1 #486/#488 答)

| Q | 状态 | 答 |
|---|---|---|
| Q1 Re-sample hard cap | ✅ 答 | 见 2.5 — 3 维度任一触发 (= T_accept + D_deposit + max_attempts) |
| Q2 Partial-deposit sampling-fail refund | ✅ 答 | 见 2.6 — 政策约束 "deposit 开始就禁止 re-sample" |
| Q3 maker stake 同笔/两笔 | ✅ 答 | 见 1.3 — 1 笔锁 spine (= code: pool.js:103) |
| Q4 排他性 enforce | ✅ 答 | Q11 patch ship (= pool.js bettor/register +9 LOC + 5/5 test, master 80d627e5) |
| Q5 Phase 顺序图 | ✅ 答 | 见上 |
| Q6 Vote 组合 winner 表 | ✅ 答 | 见上 9 case (= 7 已定 2 留白 Area 4) |
| Q7 V8 B reveal-fail | ✅ 答 | 见 3.9 nail-死 #4 — (ii) 比 silent 罚重 (= 具体倍数待 Area 10) |
| Q8 settle TX 谁构造 | ✅ 答 | maker_relay 构建 + 提交 (= code: pool-market-settler L450/L457/L709). oracle 签但不构造. broker 0 角色 (= 钉进 1.3 broker 定义) |
| Q9 Reorg k 值 | ✅ 答 | 见 2.13 — v0.5 testnet 占位 100, mainnet k=Kaspa 推荐 finality depth TBD |
| Q10 Mainnet oracle pool | ✅ 答 | 见 Area 12 — Owner 钦定 C Tier 1+2+渐变 + 3 invariant + 4 数字待 nail |
| Q2 Owner 5/23 新 catch | ✅ 答 | 见 Area 12 Q2 reframe — mainnet-only 双轨第 3 条, testnet 公开 + mainnet (c) day1 + VRF 后升级 |

---

# Outstanding (= 进 Area 4 不阻, Area 10/12 必 nail)

- **V8 nail #4 reveal-fail 具体倍数** (= bond × 1.5 / × 2 / Tier 2 stake 砍, 待 Area 10)
- **V8.4 Tier 1 vs Tier 2 reveal-fail 处理可能不同** (= Tier 1 没 stake 砍, governance exclusion?, 待 Area 10)
- **Q2 Tier 2 N 倍数 M** (= invariant `N ≥ max_pot_cap × M`, M 具体值待 Area 10)
- **Q10 4 数字** (= Tier 2 N + 权重公式 + governance + correct_votes 定义, 待 Area 10/12)

---

# Pending (= Area 4-12 待 dialogue)

- **Area 4**: 结算规则 (= settle / refund / forfeit 所有 case + trigger + sig + timeline, 含 vote 9 case 留白 2 行)
- **Area 5**: 奖励规则 (= winner pool 怎么分 + oracle bond 退还 + broker fee 抽)
- **Area 6**: 惩罚规则 (= silent / forfeit_1 / Tier 2 slash 处理 + V8 reveal-fail 倍数)
- **Area 7**: timing 规则 (= 所有 deadline / timeout 具体值, 含 V7 投票时机 + T_accept + D_deposit + ORACLE_SILENT_TIMEOUT)
- **Area 8**: edge cases (= no bettor / 1 vote + 2 silent voter bond 处理 / 等)
- **Area 9**: dispute resolution (= v0.5 怎么处理 + Phase 5 challenge mechanism + evidence_hash 真 design)
- **Area 10**: economic security (= 防 griefing / rug / collusion / manipulation. 含 V8 reveal-fail 倍数 + Q2 mainnet (c) Tier 2 N 经济参数 + slash 机制)
- **Area 11**: TX size limits (= 50 bettor cap / pot cap / Merkle proof depth, 含 F4 pot composition)
- **Area 12**: v0.5 vs mainnet target 简化差异 (= Q10 oracle ecosystem 完整 + V8 切换路径 + Q2 mainnet (c) + VRF 升级 + 信誉评分 design + Tier 1 governance 形式)

---

# 已 ship 实证 (= 5/22-5/23)

## v0.5 已 verified
- Phase 3 e2e + 4 UAT cycle + 5 stress scenario 全过, 8 bug 全修
- B2 v0.5 cooperative spine settle TX 真链 verified (= cycle 4 settle_txid dcf272a8)
- transferAndConfirm + estimateStorageMass + checkUtxoLanded 3 helper 跨线 ready

## Phase 2b ship 进度
- Ship #1 doomed-skip ✅ ship + audit PASS (= master d649de59)
- Q11 area-1 oracle/bettor 排他性 ✅ ship + audit PASS (= master 80d627e5)
- F3 50-bettor max ✅ ship (= master a988f2fa)
- F2 refund_maker_unjoined wire → Area 4
- F4 pot cap → Area 11
- F1 DISPUTE 砍 → Area 3 钉死, 实 ship 等 doc commit + voter daemon 一并改

## 重要 architecture 修正 5/22-5/23

- **Bug 7 NO TX NO STATE CHANGE 第 3 次复刻** (= mempool accept ≠ landed)
- **Area 1 共识**: 非托管永久不变量 (= 不是 phase, C 反目标永不实现)
- **Area 2 钦定**: Option 1 random assignment (= 不是 Phase 5 defer, v0.5 直接做)
- **Area 3 钦定**: DISPUTE 砍 + V8 双轨 A v0.5 + B mainnet (= trigger 绑 Tier 2 同事件)
- **Area 12 钦定**: Q10 C Tier 1+2+渐变 + 3 invariant + Phase 5 信誉
- **Q2 reframe** (= J1 #488 BROKEN catch): testnet 公开 + mainnet (c) day1 + VRF 后升级, 不跟 V8 套同模板

---

# 评估

**架构层站得住** (= pp.txt 第三方 + Owner ack):
- 非托管不变量 / 反目标 / 随机 oracle 砍 maker manipulation / 投票/签 TX 两步分清 / 投票 chain_event 防 censorship / V8 双轨 / Q10 C tier 渐变 / Q2 reframe mainnet-only

**工程层还远没收敛** (= Area 4-12 + 6 个 outstanding 数字/形式):
- 结算 / 惩罚 / edge cases / timing / dispute / economic security / TX size 这些恰是出 bug 最多的地方都没动
- Area 1-3 共识只是开始. hard part 全在 edge cases + 经济模型 (= pending 段)

**不能说 v0.5 可 ship**. 还需 Area 4-12 真深 dialogue + 收敛 + ship.

---

# 下一步顺序

1. Owner ack 本 doc (= V8 + Q10 + Q2 reframe 全 整合 + maker=bettor 钉 + outstanding 6 数字/形式 明示)
2. doc commit `docs/spec/2026-05-22-pool-prediction-market-rules-v0.5.md` (= J1 D drive 协作 doc system)
3. Area 4 启动 (= 结算规则, 含 vote 留白 2 case 决策 + F2 refund_maker_unjoined wire)
4. Area 10 启动并 nail V8 reveal-fail 倍数 + Q10 4 数字 + Q2 mainnet (c) Tier 2 N 经济参数

---

**End of Pool Prediction Market 规则 v0.5 (完整版)**