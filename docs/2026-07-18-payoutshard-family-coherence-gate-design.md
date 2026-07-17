# PayoutShard 家族一致性门设计 v0.1(zk_native 铸后禁改 + assertPayoutShardCoherence)

> **Status**: CURRENT(v0.1 设计稿, 待 NWT 红队)

- 作者: J1tn(SS covenant/enforce 域)· 2026-07-18
- 派工: Bettor #p6k49c(治本卡①关联件, J1+J2 SS 域)· 流程: 本稿 → NWT 红队 → GREEN 后落码
- 关联: DISC-20260717-002(coord/codex-bridge, RESPONSE-003 = 本稿的证据链)· 8pson 事故(2026-07-17)· cswib 事故(pool.js:139)
- 行号锚点 commit: `d154e9dc`(bshard-m3-deploy)

## 1. 根因与事故链(读码坐实, 非推断)

同一个病灶的**三次独立发作**:

| 事故 | 方向 | 机理 |
|---|---|---|
| cswib(2026-07-08, pool.js:139 注释) | zk_native=true 市场铸成 **V1** | 一个 endpoint 没读标记 → mint 时家族选择不一致 |
| bshard-close-transport.mjs:281(NWT 红队拦下) | V2 路径错调 `compilePayoutShardRedeem`(V1 专属) | 编译函数家族归属靠人记, 无机器约束 |
| **8pson(2026-07-17)** | genesis 铸 **V2**(zk_native 默认 true, pool.js:1245), 铸后人工把标记翻 false | recompile 权威(见下)从此按 V1 编译, 与链上 V2 字节永久分歧, consolidate 后 daemon 花费地址查错 → 卡死 |

**根设计缺口**(比"操作失误"深一层):

1. **家族事实无处记录**: `payout_shards`(v172)没有 V1/V2 区分列——代码自己承认(pool-shard-register.mjs:258-259 注释"靠调用方自己的市场类型记录")。铸造走了哪条路, 这个**不可变的链上事实**在 DB 里没有任何不可变的对应物。
2. **唯一家族选择器 = 可变标记**: `resolution_rule_spec.zk_native` 是市场行里一个可被 UPDATE 的 JSON 字段(端点路径 bettor.js:1459 之类 + 手工 SQL 均可改)。cswib 修复(`_resolveZkNativeCtorExtras` 单源)只保 **mint 时刻**各调用点读到同一个值, 对 **mint 之后**的标记漂移零防护。
3. **两套花费权威, 只有一套跟链走**:
   - splice 权威(对): `consolidateAllShards`(pool-shard-settle.mjs:406-431)从 stored `payout_redeem_hex` 直接改 state 字节, relay `unlockBshardConsolidate` 同理——继承链上真实字节, **永远不会跟链分歧**;
   - recompile 权威(错): `consolidateAndBuildPsState`(bshard-settle-daemon.mjs:**209**)`compilePayoutShardRedeem(...)` **硬编码 V1 家族**从 DB 列重编译——对 V2-genesis 行必然派生出另一个程序、另一个地址。

covenant 域第一性原理: P2SH 地址 = redeem 字节的纯函数; genesis tx 落链那一刻程序家族链上焊死, 之后任何 DB 写入都改变不了它。**所以家族权威只能是"铸造时刻的事实", 绝不能是任何事后可变的标记。**

## 2. 不变式(拟并入 Economic Kernel, 编号待 Bettor 查资产定)

> **PS-FAMILY**: 每个 PayoutShard covenant 行的编译家族(模板 + pinned 编译器)在 genesis-mint 时刻确定并**随行持久化**; 此后一切编译/派生/花费路径必须从该持久化事实分派, **禁止**从任何可变字段(含 `resolution_rule_spec.zk_native`)推导家族; 花费前必须证明 stored 字节、declared 家族、recompile 产物三方一致, 不一致 = fail-closed 拒花费并喊疼。

## 3. 设计三件套 + 一个权威收敛

### 3.1 v188 schema: `payout_shards.covenant_family`

- 新列 `covenant_family TEXT NOT NULL DEFAULT 'unknown'`, 取值 `'v1_committee' | 'v2_zk' | 'unknown'`。
- **写入点 = 实际编译调用处**(不是市场标记): `ensurePayoutShard`(pool-shard-register.mjs:121 INSERT)写 `'v1_committee'`; `ensurePayoutShardV2`(:257 附近 INSERT)写 `'v2_zk'`。谁编译谁declare, 家族列与编译动作原子同写。
- **存量 backfill**(migrate v188 内一次性): 对每行 `payout_redeem_hex` 跑结构探针(§3.3(b) 同一函数)判família; 探不出 → 留 `'unknown'`(诚实), gate 对 unknown 拒花费并出 event 喊疼, 不猜。
- DATABASE.md 同步(CLAUDE.md 硬规矩)。

### 3.2 zk_native 铸后 immutable(fail-closed)

- 判定点: 该 logical market 的 `payout_shards` 行已存在(= genesis 已 mint)后, 任何写 `resolution_rule_spec` 的路径若改变 `zk_native` 值 → 拒绝(API 400 / 内部 throw), 不静默纠正。
- 覆盖已知写点: bettor.js:1459(exchange offer 更新)+ pool.js spec 写点(:124/:1246/:4070 逐一核, 落码时全量 grep 收口)。
- **诚实边界**: 手工 SQL 绕过 API 无法在此层拦(SQLite trigger 可选项, 但 J2 手工修数据是既有运维现实, trigger 会把合法 runbook 也锁死——本稿不选 trigger)。手工翻转的**危害**由 §3.1/§3.3 消解: 家族列不从标记推导, 标记翻了家族事实不动, gate 照常拦。

### 3.3 `assertPayoutShardCoherence(psRow)` — 花费前三方一致

新函数(落 `pool-shard-register.mjs` 或独立 `payout-shard-coherence.mjs`, 单源供 console+daemon):

- (a) `covenant_family` ∈ {v1_committee, v2_zk}, `'unknown'` 直接 FAIL;
- (b) **结构探针**: stored `payout_redeem_hex` 的家族判别——复用 `readPayoutShardV2AttestedState` 的 fail-closed 手法(bshard-close-enforce.mjs:196-218, 长度/marker/值域三重), V1 侧同款写一个; 探针结果必须 == declared 家族;
- (c) **recompile byte-equality**: 按 declared 家族分派 `compilePayoutShardRedeem` / `compilePayoutShardV2Redeem`(V2 的 `closeZkTmplAnchor` **从 G0 自身固定 ctor 位解出回喂**, 自含, 不依赖当年 env)— 产物必须 byte-exact == stored `payout_redeem_hex`(genesis 态, `consolidatedPool=PS_SEED`);
- (d) `p2sh(stored) == payout_ps_addr`。
- FAIL → 不花费 + `events` 表喊疼(复用既有告警管道, 同 spc-daa-index-monitor 手法)+ 市场标记 blocked 待人工卡。
- 调用点: ①`ensurePayoutShard`/`V2` 的 **existing-row 早返回分支**(pool-shard-register.mjs:111-112 / :248-249——Codex 点名的"返回既有行不验一致性"缺口); ②`consolidateAndBuildPsState` 使用 ps 行前(bshard-settle-daemon.mjs:675 调用处前置); ③close-transport 的 V2 路径入口。
- 成本: (c) 是一次 silverc 子进程调用(百 ms 级), 只在 settle 生命周期点跑, 非热路径。

### 3.4 recompile 降级为校验(权威收敛, J2 daemon 域共建)

- `consolidateAndBuildPsState:209` 的 `redeem0` 改为: **stored G0 + splice state**(与 relay/`consolidateAllShards` 同一权威——本来就有现成 splice 代码), 家族分派的 recompile 仅作为 §3.3(c) 校验存在, 不再是花费地址的独立来源。
- 这是 Codex "prefer one runtime authority" 建议的落地; 属 daemon 行为改动, 设计定向在本稿, 落码归 J2 域(或 J2 审后 J1 落), NWT diff 审必过。

## 4. 存量与 8pson

- backfill 后预期: 正常流程盘 = 家族列与探针一致, 直接通过; **8pson = `'v2_zk'` + 市场标记 false = incoherent**, gate 拒花费(现状本就 stopped, 行为不变但从"人工记得别动"变"机器拒动")。
- 8pson 资金处置 = 独立卡(fail-closed refund, 涉资金移动, 设计→NWT→**Owner 批**), 不在本稿 scope。

## 5. DoD

1. regression cases(`kasia-console/` 既有测试风格): ①V2-genesis 行 + 标记翻转尝试 → API 400; ②incoherent 行(手工造 V2 redeem + v1 declared)→ assert FAIL + event 落表 + 零花费; ③正常 V1/V2 行全绿; ④backfill 探针对已知家族行判对(拿 a1993=V1 实行 + 8pson=V2 实行当 fixture)。
2. lint 规则 `R-PS-FAMILY-DISPATCH`: `compilePayoutShardRedeem|compilePayoutShardV2Redeem` 的调用点必须在家族分派/coherence-gate 保护内(白名单机制同既有 R-MANIFEST 系)。
3. DATABASE.md v188 条目 + ANTI-PATTERNS 追加一条"家族选择器不得可变"。
4. 不做什么: 不改 relay splice 路径(已是正确权威); 不动 v0.6 settler; 不迁移存量 V2 盘的 ZK 结算路径(D-001 committed 主线自己的节奏); 不加 SQLite trigger(理由 §3.2)。

## 6. NWT 审读重点(自提, 架构师不自审)

1. §3.3(c) 的 V2 anchor 自解回喂——ctor 位偏移是否会被未来 .sil 改动漂移(是否需要 findUnique 式 live 定位而非固定 offset, 同 computeCloseZkTmplAnchor 3o0a6 教训);
2. §3.1 backfill 探针对**历史早期行**(v172 之前遗留 shape?)的误判风险——'unknown' fail-closed 是否会误伤在途结算盘, 需不需要 backfill 前先跑一遍全表探针 dry-run 出报告;
3. §3.4 权威切换的 blast radius: 现网所有正在结算的 v1 盘, redeem0 从 recompile 换成 splice 是否 byte-equal(理论上 V1 行两者本就相等, 但"理论相等"要 live 抽验几行才算数——D2 铁律);
4. §3.2 不选 trigger 的取舍是否成立。
