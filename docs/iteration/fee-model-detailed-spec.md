# 费用模型 — 细致对抗 spec (Bettor 合成, 2026-06-13)

> Owner 2026-06-13: "这个只是一个费用框架,实施细节,保证规则绝对逻辑严密,还需对抗性细致讨论。包括 orcale 0.5% 质押分配,时间,计算方式,等等需要逻辑严密,非常细致的规定。"
> 守铁律: 用户需求第一 / 简单高效 / 不重造已有 / 防御性 suspect / NO-TX-NO-STATE / 先讨论别动 fee 码 (Owner 终裁前).
> **状态: 对抗讨论收敛中。FACT 已 ground-truth 实证; OPEN 待 Owner 终裁。无 fee 码改动。**

5-agent 对抗产出 (r791-r800): NWT(oracle 质押域) + J2(settler/SS 可落) + J1(红队①②) + KANet-UI(UI 透明+no-broker) + Bettor(合成+ground-truth 定论). 多次自纠 (J2 ×2 验错对象, Bettor ×1 sqrt 断言下太快) = 健康 rule 46.

---

## 1. Fee base = B (fee-on-total) 【LOCKED·Owner r791】

| | A. fee-on-winnings | **B. fee-on-total (Owner 选)** |
|---|---|---|
| 抽法 | 只赢的部分抽 (本金安全) | 总押注额抽 (本金也抽) |
| 用户体感 | 押100赢→本金100%回+赢部分扣3% | 押100→净97进局 (不管输赢先抽) |
| rake 稳定性 | 不稳 (随 losingPool 大小变) | **稳定 (可预测)** |
| broker 收入 | 不可预测=难招 broker | **可预测=好招 broker** |
| anti-cheat | 弱 | **强 (知道结果狂押也先付 3%, Owner anti-cheat 理由)** |

**Owner 选 B 的理由 (existential)**: broker 收入稳定可预测 = 好招 broker。Owner 钦定 "没人当 broker 这产品只有死"。代价: winner 略少 — 用 §6 透明前置兜 (押注前显净预期赔付)。

> ⚠ **stale (R2v2-R3, 以 §9 ⑦ 为准)**: 上表 "押 100→净 97 进局" 是 **entry-framing 近似**。真模型=**settle-time** (fee=3%×totalPool 在结算算), winner 净赔付**依赖最终池组成** (L/W 比), 非固定 97%。UI 必显实算动态净赔付 (§6)。

---

## 2. 三分账 (on TOTAL pool) 【框架·Owner r791 建议值】

```
总抽成 ≈ 3% on 总押注额
├─ broker  1.9%   ← 带量/分发/合规 (资源导入方, 绝大头)
├─ oracle  1.0%   ← 裁决 (= 0.5% 干活均分 + 0.5% 质押比例分)
└─ maker   0.1%   ← 出好题 (真实价值)
```

数值是 Owner 建议、可议; 机制必严密 (本文档重点)。

---

## 3. oracle 1% 细则 (Owner demand 的"逻辑绝对严密"核心)

### 3.A 质押源 【FACT·J2 r791/r794 确认】
- = oracle **enrollment 通用锁定 bond** = `oracle_stake_enrollments.p2sh_addr` (一 oracle 一笔锁仓 stake + lock_until)。
- = 你们口语的 committeeBond / oracle_stake_locked。**非 per-market escrow** (oracle 不按市场质押)。NWT r/J1③/J2 三方对齐。

### 3.B 干活 0.5% (均分)
- 委员 mode (v0.7) pays uniform `oracleFeePerSig` 给每个**投票签名**的委员 (pool-market-settler.js L1429-34, FACT)。
- **🔴 OPEN-① echo 搭便车 (J1 红队①, 决定性 nuance by #256)**:
  - 危害**有条件**: deriveVote 是**确定性**的 (canonical prompt + 证据 extract, 同证据→同答案)。echo 者抄多数=出**相同正确答案**→**不腐蚀 outcome**。
  - 危害仅在: ①abstain 边界 (判不了时该弃权, echo 者瞎签) ②抗共谋 (看得到别人票→串)。
  - 根治 (staged): commit-reveal (先提交票 hash 看不到别人票=没法 echo) OR slash-on-evidence-mismatch (事后审, 票≠canonical 证据派生=没收)。
  - **MVP**: 文档为 known-limitation; 现防线 = 确定性 deriveVote + abstain-not-guess (判不了弃权)。绑核验产物/commit-reveal 进**北极星分档 roadmap** (oracle 能力分档扩)。
  - **别写成全场景有害** (J1 #256 自查) = 过度。

### 3.C 质押 0.5% (按比例分)
- = 该 oracle 在 **deadline DAA 快照**那刻的锁定质押 / 全体**投票且合格**委员在 deadline 的锁定质押之和。

**3.C.1 时间单位 = DAA 块数 (非自然日) 【NWT r·锁】**
- 自然日 = wall-clock = 跨节点不一致 + 可操纵 → **禁用**。
- DAA = 链上单调时钟 deterministic 跨节点同 → **用 DAA 阈值**。
- "锁 ≥7 天" = `7 × 86400 × BPS` DAA 块。**⚠ BPS = param-confirm**: NWT 引 tn10=10BPS→6,048,000; 但预测市场跑 **tn12**, BPS 需 ground-truth 确认 (别凭印象, rule 46) 再定阈值。

**3.C.2 快照时点 = deadline DAA, 锚点复用委员 endBlock 【J2 r788·优雅·采纳】**
- 锚 = `getBlockAtDaa(deadline_daa)` 那个块 = 委员采样**同源 endBlock** (committee_pk_hash 同源)。
- 两节点从**同一 endBlock DAA** 取质押快照 = 天然同口径**不另造锚** = 守 "跨节点从链上同一确定点 derive" (NWT 铁律)。
- deadline 后加注**不进**比例 (防临时抢权)。

**3.C.3 边界 【NWT r + J2 r788 settler 可落确认】**
- 中途 unlock (deadline→settle 间) `lock_until < settle`: 质押份额 **0** (不合格)。但**签名不挡** (签名用 key 非 stake, J2) → 该 oracle 仍可投票拿干活 0.5% 均分, 只是不拿质押 0.5% 份额。是否叠 bond 没收 = 看 slash 设计 (门C 残留, 另议)。
- deadline 后质押额变: 比例**冻在 deadline 快照**不受影响。
- 同票不同质押: 干活 0.5% **均分相同** + 质押 0.5% **按 deadline 快照比例不同** (= 质押加权那半的设计意图)。

**3.C.4 🔴 OPEN-② stake 双重复利 (J1 红队②, ground-truth 确认成立)**
- **FACT (Bettor+J1 独立读现役码定论, rule 46)**: 现役 sampler = `pool-committee-sampler.mjs selectCommittee` = **stake-weighted 线性 WITHOUT replacement** (L9 'Owner r3 钦定' / L56 / L117-123 cumulative stake)。J2 r792 初读 oracle-sampler.js (老 v0.5 非现役) → r794 自纠对齐。
- **双重复利成立**: 高 stake → 采样概率高 (线性) AND 质押 0.5% 份额高 (线性) → 鲸鱼通吃 → oracle 数变少 → 去中心化/安全降。
- **但有 bound**: without-replacement = 一 oracle 一席上限 → 鲸鱼非拿多席, 是**更可能入选** × 席内 (uniform 0.5% 半 + stake 比例 0.5% 半)。复利只在席内 stake 比例那半 ≈ **总抽成的 1/6**。uniform 0.5% 半 + 一席上限 兜底。
- **关键 sybil 约束 (防坏修, Bettor)**: Owner r3 钦定 linear sampling = **sybil-中性** (拆质押 E[seats] 不变)。
  - ❌ 不能改 sampling→sqrt (破 sybil-中性; 砍 stake^0.7 已 J2 r101 reproduce 过)。
  - ⚠ 质押 0.5% reward 改 sqrt 的 sybil-safety = **非显然、未证** (Bettor r799 断'破 sybil'下太快已 r800 自纠; J1 #258'默认 sqrt'也未证安全)。sqrt-on-reward 需**正式 sybil 证明**或改 per-identity cap (cap 也要 sybil-safe: 按身份非按质押笔)。**谁都别当 sqrt 已证**。
- **缓解三案 (Owner 终裁)**:
  - (a) **接受 + 文档** [MVP 安全默认]: stake 双权重 = INTENTIONAL (stake=security 贡献, 锁多→采样多+奖多=skin-in-game 对齐)。bound 已小 (1/6 + uniform 兜 + 一席上限)。centralization-vs-security tradeoff 文档明。
  - (b) **per-oracle reward cap**: 单 oracle 单市场/滚动窗口 reward 份额封顶 (抗鲸鱼; 复杂; 需防拆质押绕 cap)。
  - (c) **sqrt 那半**: 低成本压尾险 (J1 lean); **但 sybil-safety 未证, 暂不背书** 直到证明。

### 3.D 落码两时点 【J2 r794 ⚠ 必分清】
- **采样时点 stake** = create 快照 (F-S3 anti-grinding, `pool_snapshots.pool_stakes_json`) → 决定**谁入委员**。
- **奖励时点 stake** = deadline 快照 (§3.C.2) → 决定**质押 0.5% 份额**。
- 两个是**不同快照**, 落码别混。

---

## 4. fee-on-total 实现细则 (取整/dust/floor 优先级)

- SS 校验**输出结构非费用公式** (PoolSpine_v07 L255-257: broker 输出 = P2PK + dust ≥1000 sompi)。fee 烤进 spine ctor @ create = **per-market immutable** (改=P2SH 迁移, [[feedback-ss-ctor-param-change-equals-address-migration]])。
- ~~**每个委员 payout 必 ≥ oracleBond**...质押 0.5% 份额拉低某委员 payout < bond → 必兜 (floor 优先于比例)~~ → **stale (R2v2-R3, 以 §9 ⑥ 为准)**: ⑥ 解 = **bond 单独预留** + fee-share 相加 (payout = bond + fee-share ≥ bond), 根本**无"比例被 floor 兜"的情形**。原 "floor 优先于比例" 会误导 J2 落码, 作废。
- **取整/dust 优先级 (OPEN, 待 J2 落码细)**: brokerFeeRaw = totalPool × 190/10000 (整数 sompi); 各方四舍五入余数归谁 (winner? 还是按现 L1364 distributablePool 逻辑)? dust < 1000 怎么处理? = §需 J2 settler 域定死 + 测。
- **base 改动点**: 现 `computePoolPayouts` L1364 `brokerFeeRaw = losingPool × pct` → 改 `totalPool × pct` (Owner B)。这是**未来 fee 码改动的唯一入口**, Owner 终裁后 J2 land + 链上 Tier 验。

---

## 5. no-broker 一致性 【收敛·采纳 KANet-UI 解】

- **漏洞 (KANet-UI ④)**: 若无 broker 市场省 1.9% → 更便宜 → 用户偏好无 broker → 砸 broker 模型 (= Owner existential 担忧反面)。
- **解 = maker 默认自任 broker** (KANet-UI): 无第三方 broker 时 `broker_relay_id = maker_relay_id` → **永远没'无 broker 市场'** → 用户永远看**恒定 3%** → 无更便宜选项可避 → broker 模型不被砸。
  - ① 1.9% 永远奖"带来 volume 的人" (第三方 broker 或自推广 maker), 激励一致。
  - ② **自洗盘经济 (B 下实算, Architect ⑤ 纠正)**: maker 自任 broker 两边各押 x (总池 2x) 自洗盘:
    - 付费 = 3% × 2x = 0.06x; 回收 = broker 1.9%×2x + maker 0.1%×2x = 0.04x; **净 = −0.02x = 洗盘量的 1% (= 正好 oracle 份额)**。
    - 结论**不是"无自交易套利"** (那是 fee-on-winnings/A 语言, 与 §1 锁定的 fee-on-total/B 不兼容) — 而是**自洗盘不盈利 (净亏 ≈ oracle 1%) 但廉价**: 可 (a) 花钱雇 oracle 裁假市场 (b) 以 1% 成本刷 volume。
    - **🔴 残留风险 (OPEN-⑤, J1 红队)**: volume 是选 B 的存在性理由 (可预测 volume → 好招 broker) → **论证 B 的指标本身可被 1% 成本污染**。若 volume 进 broker 招募/信誉/排名 → 需独立缓解 (wash-volume 检测 / 自押不计 volume 指标); 缓解若用事后审, 复用 ⑧/G5 同源证据 ([门C] 弱耦合)。
  - Bettor 撤回 '诚实 1.1%' 案: maker 自任 broker 仍是恒定 3% 的正解 (服务没缺席 = maker 自分发), 但**自肥论证按 B 重写如上** (非"无套利")。
- **OPEN 落码**: create-v06 无 broker 时自动填 maker_relay_id 进 broker 位; SS ctor broker 输出指向 maker P2PK。J2 域确认可落。

---

## 6. UI 透明 【收敛·J1 #254 + KANet-UI ③⑥】

- 用户只看**总抽成一个数 (~3%)**, 不漏 broker1.9/oracle1/maker0.1 分项 jargon ([[feedback-user-copy-no-impl-jargon]])。
- **winner-side 铁律**: `/confirm` **前**必显**净预期赔付 (已扣 3%)** + 讲明**赢家也付** → 别让赢家结算时惊讶'怎么少了' = bait-and-switch 砸信任。
- 估算标**清非锁定** (赔付随后续押注变)。
- 有无 broker **抽成恒定 3%** (§5) → UI 无需区分。

---

## 7. SS / settler 可落性 【J2 域】
- fee 烤进 PoolSpine ctor @ create = per-market immutable。
- 质押快照锚 = 复用委员 endBlock (§3.C.2) = 跨节点确定性不另造锚。
- 每委员 payout ≥ oracleBond floor (§4)。
- 采样/奖励两时点分清 (§3.D)。

## 8. 诚实边界 + 实施顺序
- **本文档 = spec, 非 done**。Owner 终裁前**零 fee 码改动**。
- **OPEN 待 Owner 终裁 → 见 §9 (Architect addendum 对抗审收口后的完整 OPEN 列)**。
- 终裁后顺序: J2 land base 改 (losing→total) + maker-self-broker + oracle 质押 0.5% 分账 + ⑥⑦⑧ 码 → 链上 Tier4 验 (same-node + **cross-node** J1 节点, [[cross-node-testing-critical-j1-separate-node]]) → 回归。
- testnet-only (mainnet out of scope, G5); 测试币零价值, 标尺 = 机制严密非金额 ([[feedback-measure-system-works-not-money]])。

---

## 9. Architect 关2 addendum 对抗审 — 8 项 resolution (2026-06-13, Bettor 合成)

> Owner 转 Architect 增补 (fee-model-open-addendum.md) → 5-agent 对抗 (r805-r824) → 全 ground-truth/实测/红队闭。多次自纠 (J2×3 / NWT×2 / J1×2 / Bettor×1 sqrt) = 逻辑磨严密。**§3.B(①) / §3.C.4(②) 内联节为旧框定, 以本节为准。**

| # | 项 | 状态 | resolution (实证锚) |
|---|---|---|---|
| ⑤ | 自肥 / volume 刷量 | ✅ resolved (残留~0) | §5 按 B 重写(自洗净亏 1% 不盈利但廉价)。J1+Bettor 实证: volume metric **cosmetic 不 gate**; 主路 prediction 写 `pool_bettor_sides` ONLY(pool.js L1489+)**不喂** reputation `trades`(=mm_orders∪exchange_offers, reputation.js L70-94)=域隔离 **0 泄**; 唯一泄=死掉 legacy ext-pred 16 行历史残留(无新建)。无需自利方排除检测。 |
| ⑥ | 守恒等式 | ✅ resolved | J2: `totalPool = Σpayouts + Σfees(broker+oracle+maker) + dust` (exact sompi)。floor 资金来源=**oracleBond pool-reserved 单独预留**(非 fee 凑)→委员 payout=bond+fee-share ≥ bond 不破 floor (NWT 自纠 bond-funding 框)。 |
| ⑦ | entry-vs-settle + 数值 | ✅ review-PASS (Bettor) | 时点=**settle-time**(totalPool 押注截止才定)。多-bettor canonical 守恒 exact (Bettor 核: 194+6=200, winner 净 94=losers 100−fee 6, J2 r818)。anti-cheat: B **税 cheater 赢家押注**(insider 知果狂押利润 +90.9(A)→+58.2(B))。⚠ **Owner 必知**: '净 97 进局'是 entry 近似, 真模型 settle-time, winner 净**依赖最终池组成** → §6 UI 显**实算动态净赔付**非锁死 97%。 |
| ⑧ | work-fee slash 逃逸口 | ✅ co-design 草案 (待终裁) | → `docs/iteration/oracle-slash-codesign-issue.md`。fee门(J2): work-fee 需 `lock_until ≥ 固定 expected-settle-deadline`(=deadline+MAX_settle_window, 攻3 修)。slash(NWT): (a)unlock-before-固定线 + (b)byzantine **known-limit**(honest-majority 破时复合害, 主防=VRF+bond 非 slash) MVP 可落; (c)echo=roadmap。J1 红队 4 向量全纳入。bond 去向=烧 OR winner pool(非协议)。 |
| ① | echo 搭便车 | 🔁 re-framed (roadmap) | addendum 纠: 危害是**均分 work 的纳什均衡**(抄票省算力→独立验证层萎缩)非仅 abstain 边界。slash-on-mismatch **治错票、不治 lazy-correct echo**(抄【对】答案=票==canonical 不 mismatch, J1 攻1)。echo 真解二分: ①copying-echo→**commit-reveal**(看不到别人票) ②independent-same-canonical→**源/extractor 多样性**(破 findExtractor 单源)+dispute/UMA+reputation。归分档 roadmap [[project-oracle-capability-staged-uma-backbone]]。 |
| ② | stake 双重复利 | ✅ resolved (实测翻案) | NWT 蒙特卡洛 20000 市场: 鲸鱼 fee/stake = **集中场景 0.64-0.98x(亚比例·被惩罚) / 分散场景最大者 1.17x(无 takeover)**。= 机制 **mildly 去中心化, 非鲸鱼通吃**(uniform 0.5%半稀释+WOR 一席上限 压过 stake 加权)。addendum '钦定非证明' 双标 → 实测闭。缓解 **(a) 接受 linear** 实测 justified, **无需 cap/sqrt**; 监控触发=仅若真实集中超模拟假设。 |
| ③ | BPS + deriveVote 确定性 | 🔶 **same-node 证 / cross-node 待证 (R2v2-R1 挡终裁)** | deriveVote: **temp0 钉死**(2dc86635, L933 0.1→0) + **line-E 回归 CLEAN**(正 24/24 + 负弃权 11/11, 无降准) = **same-node 经验确定性实证**。⚠ **但承重作用是分布式结算(两节点同题→同票), single-node 回归没证 cross-node 确定性**(违 same-node PASS≠cross-node PASS)。**model 版本未钉**(L929=:8000 当前加载)= **cross-node 前置 INVARIANT 非 roadmap**: 两节点 :8000 载不同 model→两诚实 oracle 边界题不同票→打穿 echo independent-same-canonical + threshold 三态。**R1 实锤**: J1 :3300 误删 ABSTAIN guard→畸形题两节点不同票(#282-284)=此墙的具象 bug。**闭 R1 DoD**: ①J1 sync :3300→whole-repo 同 commit ②同边界 prompt 两节点(:3200+:3300)跑**同票**贴双节点原始输出 ③测前 assert 两节点 model+temp+seed 同。BPS 值: 从 tn12 在跑节点 `getBlockDagInfo` 实取(待 J2)。 |

### Owner 终裁 OPEN (实施细节, 终裁前零 fee 码改动)
1. **② 缓解**: 实测 mildly 去中心化 → 建议 **(a) 接受 linear + 监控**(实测背书, 最简, 无需 cap/sqrt)。
2. **① echo 根治时点**: MVP=temp0+abstain 现防 + 文档 known-limit; commit-reveal/源多样性归 roadmap → 建议接受 staged。
3. **⑧ slash MVP**: (a)固定线 + (b)known-limit 落码确认; **bond 去向 = 烧 vs 进 winner pool** (Owner 二选一)。
4. **④ 取整/dust 优先级** (J2 落码细) + **③ BPS 值** (J2 实取)。
5. **数值确认**: broker 1.9% / oracle 1%(0.5 均分 + 0.5 质押) / maker 0.1% / 总 ~3% — 确认或调。

**终裁后**: J2 land (base losing→total + maker-self-broker + oracle 0.5% 分账 + ⑥⑦⑧ 码) → Tier4 same-node + **cross-node** → 回归。诚实级别: 本节是**对抗审收口**, fee 模型机制层严密就绪待终裁; G5 报机制非经济闭环。

---

## 10. Owner 终裁 (2026-06-13, "干!!")

5 项 OPEN Owner 已拍:
1. **② 鲸鱼**: ✅ **接受 linear + 监控** (实测背书)。
2. **① echo**: ✅ **staged** (MVP temp0+abstain 现防+文档 known-limit; commit-reveal/源多样性 roadmap)。
3. **⑧ bond 去向**: ✅ **进赢家池 (winner pool)** — Owner 否决 "烧" (理由: 烧到无私钥地址有**量子计算机**未来隐患, 留 honeypot)。Architect 的 "winner pool 制造构陷动机" 顾虑被 **provable-only slashing 中和** (slash 只罚客观链上事实=提前 unlock/签错 winner, 没法 fabricate→构陷不可执行)。
4. **④ dust/BPS**: ✅ 交 J2 落码定。
5. **数值**: ✅ 锁 **broker 1.9% / oracle 1%(0.5 均分+0.5 质押) / maker 0.1% / 总 ~3%**。

**⚠ 落码前置 (硬规程, Owner 干 ≠ 现在落码)**: **R1 (cross-node 确定性, §9 ③) 必须先闭** (J1 sync :3300 whole-repo + 两节点同票实测 + model-pin assert) 才让 J2 动 fee 码。R1 闭 → Bettor 报 "机制层就绪" → J2 land → Tier4 same+cross-node → 回归。
**earlier cross-node landmark (mix0d 等) validity**: 链证 (is_accepted + 4-of-5 签 + settle TX home 构造委员签同一 TX) 客观仍 valid; :3300 settler 113 行 drift 实影响仅 edge-case 未测, sync 后 R1 步②补。
