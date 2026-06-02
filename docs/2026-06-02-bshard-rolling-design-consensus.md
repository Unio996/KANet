# B 分片(滚动分片破 64 上限)— 对抗讨论决议

> **⚠ 待修订(2026-06-02 晚)**: 本决议的"链下绕路"部分(settler 链下聚合 / committee-sig fallback / chain_events 串片 / "silverc 缺 int-to-byte 所以 commit INACTIVE")**已被 Owner catch 推翻** —— silverscript 在 TN12 实有 introspection(`tx.outputs[i]`)/ covenant(`OpInputCovenantId`)/ `byte[](int,int)` int-to-byte / `for` 循环(见记忆 `reference-silverscript-real-capabilities`)。**批3 HOLD**,下一轮在 trustless 链上原语上重做(introspection 强制 settle 输出 + commit 链上硬校验 + covenant 分片绑定)。**本文保留滚动机制/mass-aware 封片/无限分片(witness)等仍有效部分,链下信任部分作废,待 J1 silverscript 能力重评后出 trustless 版决议。**
>
> **状态**: 5-agent 对抗讨论 + Owner 终裁达成共识(2026-06-02 早)。**滚动机制部分有效;链下信任部分已作废,见上方修订。**
> **前置设计**: `docs/2026-06-01-change-landmine-depth20-selfclaim-audit.md` §2.A(滚动分片主方案)。
> **本决议**: 在 §2.A 基础上,经对抗讨论把 Q1 从"固定封顶"修正为"真无限",并连带简化 Q3。

## 0. 一句话

一套 `PoolSpine_v07` 合约服务**所有**市场:每个市场从 1 片开始,按 **mass-aware 封片**规则填满即开下一片,**1→∞ 片按需生长,无封顶、无 KIP-17 依赖、现在就能做**。跨片全局赔率靠 settler 链下聚合 + 委员签名背书 + 单一 `commit_v2` 锚定。

## 1. 四议题定案(5/5 共识)

### Q1 — shard_count:B(witness 无限)✅
- **定案**: `shard_count` **移出 ctor、放进 settle witness 参数**。ctor 只保留 `shard_id`(每片独立 P2SH 身份)+ `market_id`(跨片锚)。
- **为什么无限**: SS 根本不在链上循环遍历所有片;跨片 `globalYes/No` 求和是 **settler 链下 JS** 干的。`shard_count` 在 sil 里实质只用于 `require(shard_id < shard_count)` 一个 sanity 检查(L318-320),那个 blake2b 跨片 commit 检查现走 committee-sig fallback(silverc int-to-byte 未确认)。移 witness 仅改那一个 require(读 stack pop),委员签名照样经 sighash 背书 `shard_count` 防伪造。
- **不需 KIP-17**: J1 r264 "B 需 KIP-17 loop 原语"系凭印象推断,r265 核源后**自我纠正**——无任何链上循环依赖。(备:KIP-17 covenants 已在 testnet-12,Toccata 主网 ~6/4-6/20,即便需要也非遥远——但本设计不需要。)
- **修正记录**: 初始 4-agent(J1/J2/NWT/Bettor)倾 "A 固定先发 + B Phase 2";Owner "原理都一样/凭什么封 7000" + Bettor SS 证据挑战 → J1/J2 核源认同 → **全队切 B**。

### Q2 — 分配 + 封片 ✅
- **分配**: 顺序填(当前开放片优先),非 hash-mod-N(后者需预知 N,与 rolling 冲突;且第 1 笔就开 N 空片浪费)。
- **封片(Owner 钦点,纠 J2 初始"固定 60")**: 阈值用 **mass 不用固定数**。每来 1 bettor,用 `estimateStorageMass`(A批1 已用,纯复用)算"本片现有人全赢"的 projected settle mass。**封片条件 = `projected_settle_mass > 440k` OR `count == 64`,谁先到谁封**。
  - 小额密集(0.5/1 KAS)→ 该片 ~11-28 注自动封,多开几片,每片由构造保证 settle mass < 470k cap、不会出现"封了却结不了"的死片。
  - 大额 → 该片装到 60+ 贴近 64(depth-6 merkle 结构上限)才封。
- **注册竞态**(J1 catch): parallel register 撞同片 → SQL transaction lock + `UNIQUE(logical_market_id, shard_index)` atomic counter。

### Q3 — 分片决策点:简化(因 Q1 切 B)✅
- **切 B 后不再需"声明 sharded vs 单片"区分** —— 一套 SS 服务任意片数,小市场 = 1 片,大市场 = N 片,**无版本切换、无"小变大"转换难题**。
- maker_stake 阈值(J1 r264 推的 C 混合智能)**仍立但降级**: 只控 register endpoint **何时 promote 开下一片 / 是否给大 maker 预开片**,不再控"走哪套合约"。
- 旧"全 sharded vs C 自动检测"的争论 → 因 Q1=B 自动消解(本就全用一套 SS)。

### Q4 — 结算时序 + 原子性 ✅
- **纠 J2 初始"必须各片同时结"**: 不需同时。**全局总池在关池时刻(deadline)就锁死**,`commit_v2` 那时即固定。关池后各片**独立并行结**,各用同一固定 `commit_v2`,不需同时、不需 sequential(避 100 片 ×5min=8h)。
- **原子性**: 非全有全无。某片结算失败 → 那片走退款(`PoolSide` entry2 refund),不影响其他片(全局数已固定,各片独立正确)。
- **跨片一致性**(NWT 强主张): settler 喂**同一** `commit_v2`(= blake2b(globalYes‖globalNo‖market_id‖shard_count) 锚)给所有同 `logical_market_id` 片;委员签名经 sighash 背书。

## 2. 实施分工(批3,解冻开工)

- **@J1**(SS): `PoolSpine_v07.sil` — `shard_count` 从 ctor 移到 settle_aggregate witness 参数;改 `require(shard_id < shard_count)` 读 witness;保留 `shard_id` + `market_id` 在 ctor。重编译验 < 10000B + P2SH 地址确定性。
- **@J2**(settler + DB): (1) DB migrate `market_shards` 表(logical_market_id / shard_index / shard_p2sh / bettor_count / status);(2) 滚动分配 + mass-aware 封片(复用 `estimateStorageMass`,SQL-lock 防竞态);(3) 跨片 `globalYes/No` 聚合(现只算本片 L1124);(4) 关池锁 `commit_v2` + 各片独立并行结调度。
- **@KANet-UI**(routing + UI): register-v06 prep/confirm 内部查 `logical_market_id` 下 open shard(mass 未满)→ 满则 promote 开下片;用户见 1 个 market + 全局赔率(globalYes/No)显示。
- **@NWT**(verifier baked lint,B ship 后): (1) mass-aware 封片用 real `estimateStorageMass` 非 hardcode;(2) 跨片 `commit_v2` 一致;(3) routing 跨节点确定可复现;(4) `shard_id` 唯一性。+ 攻击面 rerun: 伪造全局总量 / 部分结算 / dust 注灌爆分片数。

## 3. 暂缓(后续 phase,非批3 阻塞)

- **J1 拆-TX lever**(= Bettor 早先 fee-split idea): winner-payout 与 fee-payout 拆两 TX(TX2 fee 分账,mass 250k→10k,释放 240k 预算)→ 单片容量再翻倍。无限已成,此为锦上添花。
- **blake2b 链上 commit 激活**: 待 silverc int-to-byte 原语确认后,把 Q1 那个 fallback(committee-sig 背书)升级成 SS 内 `require(blake2b(...) == commit_v2)` 硬校验。当前 committee-sig + settler 同 commit_v2 已足。

## 4. 守红线

- 本设计 = **机制**(破 64、无限分片)。Go-live(seeder 真用户)未开,守 G5:报机制闭环非经济闭环。
- 真大池(28+ 注 / 多片)settle **从未链上压测**(实测最大 8 注)→ 批3 ship 后必跑真多片 e2e 验证,守"测试完才算过"。
