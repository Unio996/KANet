# B线落2 设计稿 — feeRules 上链锚定(commit v2)+ V1 线接费边界

> **Status**: CURRENT(设计稿·待 NWT 红队 + Bettor 审,落码前不动代码)
> **作者**: J2 · 2026-07-12 · spec: `docs/2026-06-22-modular-fee-split-component-spec.md` v1.3 §3/§3.1/v1.1-B
> **前置**: 落1 已落(e254ceb2, NWT diff 审在途)——组件本体 + canonicalizeFeeRules/computeFeeRulesCommit 单源已在。

## 0. 一句话

把「谁该得多少」从"全局常量+市场级单列"升级为**建单时整份 feeRules 上链 hash 锚定、settle 时委员从 committed 规则 re-derive**——spec §3 的"trustless 核心 = 规则上链焊死",可配 + trustless 同时成立。

## 1. 查了哪些既有资产(接位 SOP 第 5 步)

| 资产 | file:line | 现状 |
|---|---|---|
| commit 烤点(create) | `kasia-console/src/api/pool.js:1333/1585/1755` | `computeMarketCommit(predicate, {brokerPk, introducerPk})` → PS redeem offset-518 |
| commit 验点(enforce) | `kasia-console/src/lib/bshard-close-enforce.mjs:292` | 同函数 re-derive == 链上 commit 才继续(单源已成立) |
| commit 函数 | `kasia-console/src/lib/pool-shard-settle.mjs:192` | preimage = `{fee_recipients:{broker,introducer}, predicate}`,canonicalPredicate + blake2b-256 |
| V1 driver 结算 | `kasia-console/src/services/bshard-auto-settler.mjs:81` | `computePariMutuelPayout` **不传 feeLeaves** = fee=0(28mln 实测,spec v1.1-B 双轨事实) |
| V1 委员 enforce | `bshard-close-enforce.mjs` enforceCloseAttest | 同 0-fee 口径(双侧一致 = 未实现非 bug) |
| V2/ZK fee 源 | `pool-shard-settle.mjs:126` deriveSettlementFeeLeaves | 落1 后 = 组件薄壳,费率源 = `market.broker_fee_pct` 列(create-committed) |
| 组件 | `kasia-console/src/lib/fee-split.mjs`(落1) | canonicalizeFeeRules/computeFeeRulesCommit/deriveRoleFeeLeaves/FEE_PRESETS.prediction |
| migrate 最新 | `kasia-console/src/db/migrate.js` v183 | 本设计新列 = **v184** |

## 2. 方案

### 2.1 存储:`pool_markets.fee_rules` 新列(v184,TEXT,create 一次写入后只读)

- 存 feeRules **全文 JSON**(canonical 化前的原始结构,含 schema_v)。委员 settle 时对全文重新 `canonicalizeFeeRules()+hash` == 链上 commit 才继续(spec v1.2-1)。
- **为什么独立列不进 metadata**:`pool_markets.metadata` 是 settler read-modify-write 域(xzztw 事故案例),feeRules 必须 write-once 不可变;独立列 + 不出现在任何 UPDATE 路径 = 机制上免疫覆盖。
- **write-once 升机制(Bettor 注2 折入)**:v184 同 migration 加 SQLite trigger——`BEFORE UPDATE OF fee_rules ON pool_markets WHEN OLD.fee_rules IS NOT NULL → RAISE(ABORT)`,从"约定不 UPDATE"(L1)升为结构性不可能(L4)。
- 老市场 `fee_rules IS NULL` → 全部走现状路径**字节不动**(生效边界=新建市场起,spec v1.1-B 铁律:建单时无费承诺的盘不得追溯收费)。

### 2.2 commit v2:computeMarketCommit 扩 preimage(新市场)

```
commit_v2 = blake2b(canonicalPredicate({ fee_rules_commit: computeFeeRulesCommit(feeRules), predicate }))
// predicate-null(如 blockhash_parity)市场(NWT P1 折入): 折入原 identity 锚, 不再走裸 metadata_hash——
commit_v2_nullpred = blake2b(canonicalPredicate({ fee_rules_commit, market_metadata_hash }))
```
- **🔴 P1(NWT 红队,设计缺口修正)**:enforce 原是**三分支**——predicate-null 市场 commit 槽 = 裸
  `market_metadata_hash`(pool.js:1517 / enforce:287-289),完全不经 computeMarketCommit,v1/v2 判别对它失效
  → settler 可对 predicate-null+fee 市场喂任意假 feeRules 零 BUST。**修法:fee_rules 市场一律烤 v2 公式**,
  predicate-null 时 preimage 折入原 identity 锚(上式第二行);委员判别式"载荷带 feeRules → v2 公式"对
  null/非 null 统一覆盖。论证表第三行:predicate-null+篡改 → fee_rules_commit 不符 BUST;predicate-null+
  隐瞒 → 裸 metadata_hash ≠ 链上 v2 BUST。regression case 补 predicate-null 篡改负例。
- **类型 pin(NWT 注4c)**:`fee_rules_commit` 以 **lowercase hex string** 进 preimage(禁 Buffer——
  canonicalPredicate(Buffer) 序列化成 {"data":[…],"type":"Buffer"},两侧一 string 一 Buffer = commit 永假);
  preimage key 名钉死 `fee_rules_commit` / `market_metadata_hash`。
- **折 hash 进 preimage 而非全文**:feeRules 全文尺寸可变,commit slot 固定 32B;两级 hash(rules→32B,再与 predicate 合)保持 offset-518 机制零变(`.sil` 不变、零 re-deploy,同命门④先例)。
- **判别式 = DB `fee_rules` 列有无**(fail-closed 论证):enforce 见 `fee_rules` 非空 → 算 v2 commit;被篡改(改文本/换 bps)→ hash 不符 → BUST;被删(NULL)→ enforce 走 v1 commit ≠ 链上烤的 v2 → BUST。**两个方向都撞墙,判别式本身不需要可信**。
- 老市场(fee_rules NULL + 链上 v1 commit)走既有 `computeMarketCommit(predicate, fee_recipients)` 分支,函数保留不删。

### 2.3 V1 线接费(新建非-zk 市场)

- create(pool.js 三处烤点):非 zk_native 市场从 `FEE_PRESETS.prediction` 注入 broker/introducer 地址构造 feeRules → **烤 commit 前必跑 `validateFeeRules`**(NWT 落1 F2 闭合:create API 收 0-9999 bps 与组件 5000 上限错位,建单时即 fail-loud,消灭"settle 时才炸"的延迟雷)→ 存列 + 烤 commit v2。V1 注入的 rules 中委员/节点叶 **bps=0 + 代码注释写明"挂 D-008 政策卡"**(Bettor 注3:防将来当 bug;份额表列 Owner 单点上报清单)。
- driver(computeSettlePlan):`fee_rules` 非空 → **先选委员再算 payout**(现顺序是 3-payout→4-committee,委员派生 fee 叶需要 committeePks,顺序对调;委员选择零输入依赖 payout 输出,NWT 注4a CONFIRMED)→ `deriveRoleFeeLeaves(rules, poolSompi, {committeePks})` → `computePariMutuelPayout({..., feeLeaves})`。
- **🟠 P2(NWT,对调副作用)**:degenerate 判定必须**前置到选委员之前**,且改为从 bets+winDir 直判
  (`winners = bets.filter(direction==winDir)` 为空 → refund 早退,不需要 pm 不需要委员)——否则单边盘在
  members 除 exclude 后 <COMMITTEE_SIZE 时 selectCommittee throw(sampler:95-96)先于 degenerate 判定,
  本该 refund 的盘变 stuck-throw。
- **🟠 P3(NWT,verify-value-source)**:委员侧 v2 路径派生 fee 叶**只读通过 hash-bind 验证的 feeRules**;
  signRequest.broker_pk/introducer_pk(enforce:263)降级为 hint,与 feeRules.roles[].address **显式交叉断言
  相等,不等 fail-closed 拒签**——否则"commit 验的是 A,叶算的是 B"同族 vacuous。
- 委员(enforceCloseAttest):同 commit 内加同款 re-derive(委员自己派生自己的 committee 集,既有确定性)。
- **🔴 委员侧 feeRules 全文来源 = attest 请求载荷携带(Bettor 注1 折入,2026-07-12)**:同 predicate 先例
  (caller-fed + 链上 commit hash-bind = 安全,`bshard-close-enforce.mjs:272-292` 现状即此形)。**禁走委员本地
  DB 读**——`fee_rules` 新列不跨节点同步,:3300 委员结构性 NULL → 判别式回落 v1 commit → 所有新 V1 市场必
  BUST(fail-closed 变 fail-always)。判别式(§2.2)在委员侧相应改为**载荷有无 feeRules 字段**:载荷带 →
  验 v2 commit;载荷不带但链上是 v2 commit → hash 不符 BUST(settler 隐瞒规则也撞墙,双向论证不变)。
  NWT 红队必核此通道。
- **🔴 driver + 委员必须同一 commit 落码同一重启窗装载**(spec v1.1-B:否则 root 分叉必 BUST;7/11 排除漏配五处同族教训)。
- **消费点枚举(spec v1.1-D6 铁律)**:落码时 J2 全库扫 `computePariMutuelPayout(` 全部调用点逐一核对哪些属 V1 结算路径,NWT 独立扫尽确认无第 N+1 处——本设计先挂占位,落码 diff 里出全清单。

### 2.4 V2/ZK 线:**本落不动**(scope 边界,防越权)

- V2 fee 源(broker_fee_pct 列)已 create-committed + D-008 单源链(propose/enqueue/guest/committee 四侧)实弹验证过三个市场。把 V2 也切到 feeRules commit = 动 guest circuit 输入语义 = **D-009 冻结门族风险**,收益(多角色分成)依赖 D-008 挂起的 Owner 份额表——政策没定,机制先不动。
- 新建市场现默认 zk_native=true → 走 V2 现状费路(broker 有收入)。V1 接费实际覆盖 = 显式建的非-zk 盘。

## 3. 为什么这么做(对抗自问)

- **为什么现在做 V1 而不是等份额表**:①V1 broker/introducer 两叶不依赖份额表(create-committed 地址 + LOCKED fee-on-total);②commit v2 锚定是组件"trustless 可配"的唯一前提(spec §3 原话),不做则组件只是纸面纯函数。**委员(oracle/node)叶 = 挂 D-008 政策卡,rules 里 bps 先配 0**——份额表定了改 preset(新市场起),机制已就位。⚠ 这意味着 V1 新市场费率 = broker 160 + intro 20 = 180bps(非 300),provider 9820:**这是政策空窗的诚实呈现,数值请 Bettor 裁/上报 Owner**。
- **为什么两级 hash**:全文进 preimage 也行(canonicalPredicate 能序列化嵌套),但 fee_rules_commit 单独成锚可被第三方(对账器/UI)独立引用验证,且与落1 的 computeFeeRulesCommit 单源直接复用。
- **回归铁律怎么守**(spec §5-4):老市场(NULL)路径 = 现有 fee-single-source/bshard-auto-settler 两套 test 原样过;新市场路径 = 新 regression case(commit v2 round-trip + 篡改/删除双向 BUST + V1 带费 root 守恒)。

## 3.5 interim preset 形状(NWT P5:显式定义,防"构造"两处各自理解)

V1 注入产物命名 **`prediction-v1-interim`**,与 `FEE_PRESETS.prediction` 显式区分:
- roles = provider **9820** + broker 160(注 create-committed 地址)+ introducer 20(optional,有则注入)
  + oracle/node **保留但 bps=0**(自 documenting 挂 D-008 政策卡,derive 层对 bps=0 天然零叶)。
- introducer 缺席时该角色整个剔除,provider 相应 +20 = 9840(Σ==10000 硬不变量)。
- 此形状 + 两种变体(有/无 introducer)进单测钉死。

## 3.6 全文可得性(NWT P4,落3 前必解、本落留 runbook)

链上只有 32B hash,feeRules 全文只活 :3200 `fee_rules` 一列。丢列 = fail-closed 永锁(不可 settle)。
本落(标准 preset 盘)可从 broker_pk/introducer_pk 列 + `prediction-v1-interim` 常量**确定性重构**——runbook
一句进 DoD;custom 规则开放(落3)前必须解决全文可得性(链上 payload/多节点副本,落3 设计项)。

## 4. 验收(DoD)

1. v184 migration(fee_rules 列 + Bettor 注2 BEFORE-UPDATE trigger)+ DATABASE.md 同步更新。
2. 单测:commit v2 round-trip / 篡改 feeRules → enforce 拒 / 删 feeRules → enforce 拒 / **predicate-null 篡改 → BUST(P1 负例)** / degenerate 单边盘 refund 早退不撞 selectCommittee(P2)/ hint 与 feeRules 地址不等 → 拒签(P3)/ NULL 老市场 byte-equal 现状(既有两套 test 全绿)。
3. 实弹:建一个非-zk 测试盘(小额)→ 自然结算 → broker 叶实收链验 + Σ守恒精确 + Bettor 盲算命中。
4. driver/委员同 commit 同重启窗装载,**显式含 :3300 委员节点**(V1 enforce 双节点都跑,漏 :3300 = 半更新窗实弹;KANet-UI 执行,照例)。
5. lint:R-FEERULES-CANON-BYPASS 已在(落1);落码若发现第二形状旁路再补规则。
6. runbook 一句:标准 preset 盘 fee_rules 列丢失时按 §3.6 确定性重构(dry-run diff 报 Bettor 后写回)。

## 5. 开放问题(审时请显式裁)

- **Q1(政策)**:V1 新市场空窗费率 180bps(§3 第一条)可接受,还是等 Owner 份额表一起上?
- **Q2(范围)**:pool.js 三处烤点(1333/1585/1755)是否全属"建市场"路径(J2 落码前逐处核实上下文,设计先挂账)。
- **Q3(V2 远期)**:份额表定后 V2 是否也迁 feeRules commit(动 guest 输入 = D-009 流程)——本落不动,只留此账。
