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
- **(a) unlock-before-settle** [provable, MVP 可落]: lock_until < settle_daa = 没履约到结算 → forfeit bond + 干活/质押费 0。链上可验 (lock_until 是链上锚)。这条 fee门(§2)已天然挡费, slash 再没收 bond。
- **(b) byzantine 签错 winner** [provable, MVP 可落]: 签的 winner ≠ 共识 settle 的 winner → forfeit bond。settler 已有 PB-S8-1 byzantine 校验 (handleTxSignReq), slash 接它。
- **(c) echo-without-verify / 判错** [需 guard, roadmap]: slash-on-evidence-mismatch——审计重跑 canonical deriveVote, oracle 票 ≠ 重跑结果 = slash。**但 deriveVote 非严格确定** (NWT 实测: temp 0.1 经验稳 12/12 但非 temp0/无 seed/model 未 pin)→ 严格 slash 会【误罚诚实 oracle】。
  **闭法·两层 (Bettor r810 抓 production-vs-audit 缝)**:
  - ⚠ 单独 audit 用 temp0【不够】: 生产 deriveVote 跑 temp0.1(诚实票)vs 审计跑 temp0(严格)→ 罕见 borderline 两者分叉 → 误 slash 诚实 oracle。
  - **① 生产 deriveVote 也钉 temp0** (生产==审计==严格, 不止改审计) → echo 论证升严格 + slash 安全。**[J2 r803 确认]**: 生产 temp0.1 无特殊理由(git blame 84cdc18a r219 默认低温, 非防 tie) + 实测 temp0 干净(:8000 跑 3/3 YES@1.0 无退化, Qwen 兼容) → **J2 落码 L933 0.1→0 钉死**。seam 闭。
  - **② clear-mismatch-only tolerance**: 即便 temp0, LLM 跨 GPU/版本/batch 极罕见浮点非确定 → slash 只罚【clear mismatch】(oracle 投 YES 但 canonical 证据压倒性 NO), 不罚 razor-thin token 翻转。= strict(①) + tolerance(②) 双保险。
  - **跨节点**: deriveVote 若进 committee 比对, temp+model 版本+backend(:8000) 必【跨节点钉一致】, 否则 committee_pk_hash/投票跨节点不 agree。
  - 归 staged roadmap, 非 MVP。

**slash 额度**: forfeit 该 oracle 锁定 bond (committeeBond/enrollment P2SH)。

## 4. 门C 不变量 (slash 别开新 griefing)

- slash 只罚 **provable 链上事实** (unlock-before-settle / 签错 winner), 不罚【主观判断分歧】(那是 deriveVote 软确定性域, 罚=寒蝉诚实 oracle)。
- 守 [[project-gateC-d1-griefing-residuals]]: 三态共识 abstain-neutral, slash 不能让"该 abstain 却被罚"。
- echo-slash (c) 的 confident-only guard = 防误罚的命门, 不满足别上。

## 5. G5 诚实边界

testnet bond = test-KAS 零价值 → slash 是【机制演示】非真经济威慑。document: mainnet if-deployed 才有真 slash 经济意义。守 G5 报机制非经济闭环。

## 6. OPEN (待 co-design + Owner 终裁)

1. (a)(b) MVP 可落; (c) echo-slash 归 roadmap (需 deriveVote 严格确定 + confident-guard) — 对吗?
2. slash 的 bond forfeit 去向? (烧/进 winner pool/进协议) — 经济设计点。
3. (b) byzantine slash 与现 PB-S8-1 校验的耦合点 (J2 settler 域)。
4. lock_until 必须链上可 derive (跨节点 determinism 铁律, 我 broker-fee BREAKER 教训) — J2 确认 enrollment P2SH 的 lock_until 链上可读。
