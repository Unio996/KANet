# ⑧ Oracle slash 逃逸口·co-design 议题 (NWT slash主 + J2 fee门)

> 2026-06-13. Architect 关2 对抗审增补 OPEN ⑧. **co-design 同桌, 禁 fee侧/slash侧各裁各的** (Bettor r808/r809).
> 诚实级别: 这是【议题草案·待 co-design + Owner 终裁】, 非已闭 spec. ⑥⑦⑧ 不闭 = fee spec 不算 ready.

## 1. 问题 (⑧ slash 逃逸口)

oracle 拿【0.5% 干活费(uniform 均分)】= "签名即得", 但若该 oracle 的 bond【没锁到 settle】→ 它拿了钱却【没有可被 slash 的抵押】= 干活费-无-bond = slash 逃逸口。
- 攻击: oracle enroll 锁 bond 短期 → 入委员会 → 签名拿干活费 → bond 在 settle 前 unlock 跑路 → 即使它 echo/乱判, 没 bond 可罚。
- = fee(萝卜)拿了、slash(棒子)逃了。

## 2. Fee 侧门 (J2 r811)

**逃逸口**: oracle 拿 0.5% 干活 work-fee, 若其 lock 在 settle 前到期 → 收 fee + 跑 = 不可 slash = 逃逸。

**fee门 (第3时点 = settle)**: work-fee payout 只付【lock_until_daa ≥ settle_daa】委员 (锁到 settle = 仍 slashable); lock 提前到期委员 → 不付 work-fee。与质押费 0.5% 的 unlock-before-settle=0 规则一致。
- J2 落码: computePoolPayouts work-fee 分账前校验每委员 lock_until_daa ≥ 该市场 settle_daa。

**⚠ 3 时点全景 (落码别混, J2 r794+r811)**:
| 用途 | 时点 |
|---|---|
| ① 委员采样 | **create-snapshot** (F-S3 防 grinding, 别动) |
| ② 0.5% 质押-reward 比例 | **deadline-snapshot** (复用委员 endBlock, 防建后调质押套利) |
| ③ work-fee门 + slash 资格 | **settle_daa** (锁到结算才 slashable) |
三个 stake 时点不同, 跨节点各自从链上同口径 derive。

## 3. Slash 侧 (NWT 域·草案)

**slash 触发 (只罚 provable 行为, 守'abstain-not-guess 不罚诚实弃权')**:
- **(a) unlock-before-settle** [provable, MVP 可落·攻3 修后]: ~~lock_until < settle_daa~~ → **改比【固定 expected-settle-deadline = deadline_daa + MAX_dispute/settle_window】非实际可变 settle_daa**。
  - **🟠 [J1 攻3·settle-delay griefing]** 原写'lock < 实际 settle_daa'有缝: settle 时点可变(dispute 延期/settler backlog/重试), 攻击者【故意拖 settle】(触发 dispute/spam 慢 settler)→ 推 settle 过诚实 oracle 的 lock → 批量误罚诚实委员(罚 settler 延迟非自己错)。
  - **修**: slash 只在 lock_until < 【协议保证的固定线(deadline + MAX_settle_window)】才触发。诚实 oracle 锁过固定线 = 永不受拖延害(settle 实际拖多久无关)。固定线链上可 derive(deadline 链上锚 + 常量窗口)。
  - 这条 fee门(§2)已天然挡费, slash 再没收 bond。
- **(b) byzantine 签错 winner** [provable, MVP 可落·攻4 标 known-limit]: 签的 winner ≠ 共识 settle 的 winner → forfeit bond。settler 已有 PB-S8-1 byzantine 校验 (handleTxSignReq), slash 接它。
  - **🟠 [J1 攻4·known-limit] honest-majority 破时 (b) 反罚诚实**: '共识 winner'=委员多数签的。若 byzantine 3-of-5 多数签错 winner → 成 settle 结果 → 诚实 2-of-5 签对的 ≠ settle → 【诚实少数因签对被罚】(byzantine 多数复合害)。(b) 仅在 honest-majority 假设下成立。**主防=VRF 随机委员 + bond 让 byzantine 多数贵(非 slash)**; slash 是 honest-majority 下的次防。doc 显式标 known-limit。
- **(c) echo-without-verify / 判错** [需 guard, roadmap]: slash-on-evidence-mismatch——审计重跑 canonical deriveVote, oracle 票 ≠ 重跑结果 = slash。**但 deriveVote 非严格确定** (NWT 实测: temp 0.1 经验稳 12/12 但非 temp0/无 seed/model 未 pin)→ 严格 slash 会【误罚诚实 oracle】。
  **闭法·两层 (Bettor r810 抓 production-vs-audit 缝)**:
  - ⚠ 单独 audit 用 temp0【不够】: 生产 deriveVote 跑 temp0.1(诚实票)vs 审计跑 temp0(严格)→ 罕见 borderline 两者分叉 → 误 slash 诚实 oracle。
  - **① 生产 deriveVote 也钉 temp0** (生产==审计==严格, 不止改审计) → echo 论证升严格 + slash 安全。**[J2 r803 确认]**: 生产 temp0.1 无特殊理由(git blame 84cdc18a r219 默认低温, 非防 tie) + 实测 temp0 干净(:8000 跑 3/3 YES@1.0 无退化, Qwen 兼容) → **J2 落码 L933 0.1→0 钉死**。seam 闭。
  - **② clear-mismatch-only tolerance**: 即便 temp0, LLM 跨 GPU/版本/batch 极罕见浮点非确定 → slash 只罚【clear mismatch】(oracle 投 YES 但 canonical 证据压倒性 NO), 不罚 razor-thin token 翻转。= strict(①) + tolerance(②) 双保险。
  - **跨节点**: deriveVote 若进 committee 比对, temp+model 版本+backend(:8000) 必【跨节点钉一致】, 否则 committee_pk_hash/投票跨节点不 agree。
  - 归 staged roadmap, 非 MVP。
  - **🔴 [J1 攻1·最毒] slash-on-mismatch 治错票、治不了 lazy-correct echo**: 懒 oracle echo【正确】canonical → 票==canonical → 不被 slash。= slash 必要非充分。echo 纳什均衡(人人抄=验证层消失)mismatch-slash 解不了。**echo 真解分两类**: ① 抄别人票(copying-echo)→ commit-reveal(看不到别人票没法抄)② 人人独立跑同一 canonical(canonical 本身错时没独立 oracle 兜, 如 extractor bug)→ **源/extractor 多样性(不同 oracle 用不同源, 现 findExtractor 单源=最易 echo)+ dispute/UMA 底座 + reputation 战绩**。我 ESPN 格式 bug 就是【line-E measurement 多样性】抓的、非 oracle echo 抓的=活证。doc 必标 slash scope=错票, 非 echo 解。
  - **🔴 [J1 攻2·model 漂移误罚] temp0 只钉采样、model 版本没钉**: L929 model=:8000 当前加载, vote 后 :8000 换 model → 审计重跑输出变 → 误 slash 旧 model 诚实票。**修**: vote-time 记(model_version+temp+seed)进 canonical 票, 审计用【投票时同款 params】重跑。J2 r814 接落码(待 audit 机制定形)。temp0=一半、model-pin=另一半。

## 4. 门C 不变量 (slash 别开新 griefing)

- slash 只罚 **provable 链上事实** (unlock-before-settle / 签错 winner), 不罚【主观判断分歧】(那是 deriveVote 软确定性域, 罚=寒蝉诚实 oracle)。
- 守 [[project-gateC-d1-griefing-residuals]]: 三态共识 abstain-neutral, slash 不能让"该 abstain 却被罚"。
- echo-slash (c) 的 confident-only guard = 防误罚的命门, 不满足别上。

## 5. G5 诚实边界

testnet bond = test-KAS 零价值 → slash 是【机制演示】非真经济威慑。document: mainnet if-deployed 才有真 slash 经济意义。守 G5 报机制非经济闭环。

## 6. OPEN (待 co-design + Owner 终裁)

1. (a)(b) MVP 可落 (各带 J1 红队修: a 固定线 / b known-limit); (c) echo-slash 归 roadmap (温0+model-pin+clear-mismatch), 且 (c) **治错票不治 lazy-correct echo**——echo 真解=commit-reveal(抄票) + 源多样性/dispute-UMA(canonical 错), 非 slash。
2. **bond forfeit 去向 = 进 winner pool** [Owner 终裁 r827]。否决'烧'(量子计算: 烧到无私钥地址留隐患)。非进协议(避 slash 牟利)。**安全 note**: Architect 担心 winner-pool 制造构陷动机 → 被【provable-only slashing】中和: slash 只罚客观链上事实(提前 unlock / 签错 winner), 攻击者无法 fabricate 这些事实 → 构陷不可执行 → winner-pool 安全。
3. (b) byzantine slash 与现 PB-S8-1 校验的耦合点 (J2 settler 域)。
4. lock_until + 固定 expected-settle-deadline 必链上可 derive (跨节点 determinism 铁律) — J2 确认 enrollment P2SH lock_until + deadline 链上可读 + MAX_settle_window 协议常量。
5. **lazy-correct echo 治本(roadmap)**: 源/extractor 多样性(破 findExtractor 单源)+ dispute/UMA 底座 + reputation 战绩 — 进 oracle 能力分档路线图 [[project-oracle-capability-staged-uma-backbone]]。
6. vote-time 记 (model_version+temp+seed) 进 canonical 票 (J2 攻2 修, 待 audit 机制定形)。

## 7. [R5] Monte Carlo 集中度假设 + 监控阈值 (供 §3.C.4 回填)

**模型假设 (NWT 20000 市场模拟, 'accept linear' 的实测依据)**:
- 委员 k=5; sampling = linear stake-weighted WITHOUT replacement; reward = 0.5% uniform(均分) + 0.5% stake-weighted(按 committee 内 stake 比例)。
- 分布族测了: ①一鲸(40%)+9小 ②均匀10 ③power-law(stake_i=1/i, N=20) ④超集中(1鲸70%/90%) ⑤2-3鲸 ⑥多小(50 均匀)。
- 结果: top-oracle fee/stake ∈ **[0.64, 1.00]** (集中场景全亚比例, 鲸越大越低); 小 oracle 至多 **1.17x**(分散 power-law)。= 复利对鲸鱼 self-limiting, 净 mildly 去中心化。

**监控触发阈值 (实质押集中度'超假设'才判定需 cap)**:
- 监控三量: (i) max-oracle stake 占比 (ii) eligible oracle 池大小 N (iii) fee-Gini vs stake-Gini 差。
- **触发重审 (b) per-oracle cap 条件 (任一)**:
  - max-oracle stake 占比 > 40% **且** 池 N < 10 (模拟该档仍亚比例, 但超此 envelope 未验);
  - 或 实测 fee-Gini − stake-Gini > 0.10 (超 power-law 档的 1.17x 放大);
  - 或 出现模拟未覆盖的分布(如多鲸>3 且各>20% 同池)。
- 未超 envelope = accept linear 持续 (实测 justified); 超 = 进 (b) cap 议 + 附正式 sybil 证明 (sqrt 已证破 sybil-中性, cap 按身份非按质押笔)。

## 8. [R1 步③] cross-node deriveVote 测 INVARIANT (NWT+J2)

> R1 关键路径: deriveVote 承重分布式结算(两节点同题→同票), 必证 cross-node。:3300 误删 guard(#282-284)= 这墙的具象 bug。

**测前 assert (INVARIANT, 不满足整测 FAIL)**:
1. 两节点 deriveVote 路【whole-repo 同 commit】(byte-identical bettor-prediction-voter.js + derivevote-prompt.mjs + oracle-evidence-extractors.mjs)。git rev-parse HEAD 两节点同 + 三文件 0-diff。
2. 两节点 LLM 调用参数【identical】: model_version + temperature(=0) + seed(若有)+ backend(:8000 同实例 .106)。
3. canonical vote 记录加 model_version (J2 攻2 修) → assert 两节点投票时 model_version 同。

**测法 (同票实证)**: 喂【同一 boundary prompt】(① 清晰题 ② 小margin ③ no-question→应 ABSTAIN ④ 主观)到两节点 deriveVote → **两节点必出 byte-identical vote** → 贴双节点原始输出。任一不同 = cross-node determinism 破 = FAIL(查是函数/param/model 哪层漂)。

= 这 INVARIANT 堵住 :3300 那类静默漂移(函数版本/param 不同→不同票→committee 不 agree)。R1 闭 = 此测两节点 4 题全同票 + 双节点原始输出贴档。

**⚠ [J2 r822] R1 测范围必含 settle determinism 对拍 (非只 deriveVote 同票)**: :3300 settler 113 行 stale = settle 逻辑(payout/committee bond/fee)漂 → 同市场两节点 settle 可能算出不同输出 → committee_pk_hash 分歧 → 跨节点 settle 不可见(DoD#1.4b 那类墙)。所以 R1 cross-node 测两层: ① deriveVote 同票(本节)② **settle determinism 对拍**(同市场两节点 settle → payout 逐 sompi + committee_pk_hash byte-identical)。whole-repo sync 1dfa83a7b 一并修 settler(→origin == :3200 已验 0-diff)。

## 9. [R4] bond 守恒核验 (NWT 核 J2 r822) — PASS

- **R4-a Σbond_in = Σbond_returned + Σbond_slashed (一笔不丢)**: ✓ 闭
  - committeeMode (v0.6/v0.7 生产): N×oracleBond = N×oracleBond(全还 L1443) + 0(門C slash 未 live)。
  - v0.5 silent: N×oracleBond = (N-1)×oracleBond(还) + 1×oracleBond(静默 forfeit L1442)。
- **R4-b slashed 去向守恒 (不凭空)**: ✓ 逐 sompi 无泄
  - v0.5 静默 1×oracleBond = 50% winnerForfeit + 25% makerForfeit + 25%(2×perOracleForfeit) = 100%, floor 余 remainder-fold 折进 maker(L1415-6)= exact 无 floor 泄。
  - committeeMode 未来 slash → **进 winner pool** [Owner 终裁 r827: 否决烧(量子: 烧到无私钥地址留隐患); provable-only slashing 中和构陷顾虑]。
- **bond ⊥ fee-on-total**: bond reserve (N×oracleBond) 是 SS floor, fee-on-total 只改 fee base 不动 bond reserve。两守恒(⑥ fee + R4 bond)正交、各自逐 sompi 闭。
