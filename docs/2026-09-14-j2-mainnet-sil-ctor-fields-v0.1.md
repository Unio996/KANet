> **Status**: CURRENT

# J2 交付①：主网集 .sil 现状 + 每合约真实 ctor 字段清单 v0.1

出处：`docs/2026-09-14-bettor-prototype-v0-scope-token-market-ui.md` §4 派工，J2 第一步交付。

## §0 先报一个和范围稿假设不同的事实（收拢前必须先说清）

范围稿 §1.2 写"T3 市场合约现在散落在 `docs/provenance/*` 和 worktree 里，没有收拢到 `src/lib/sil-v1/`"。
**实测（`git status --porcelain` + `git log -1` 对每个文件核过，全部 clean、逐字节 == HEAD）：9 个 T3 文件其实已经在
`kasia-console/src/lib/` 顶层（不在 provenance/worktree 里），且都已合入主线（mtime 全部 2026-09-14 09:18，对应
1290-1304 那批合并）。只有 `KanetTestToken.sil`（T1）已经单独躺在 `src/lib/sil-v1/` 里。**

真正的问题不是"散落"，是：**这 9 个文件和 ~30 个遗留/probe/rolling 架构 `.sil`（PoolSide\*/PoolSpine\*/PoolRoot/
PredictionEscrow\*/WinningsPool_v1/各种 \*Probe\*/RootStub_probe\*）混在同一个平铺目录里**，KANet-UI 或任何人
靠文件名猜不出哪 10 个是主网当前集。

**当前位置**（全部 `kasia-console/src/lib/` 下，git clean，与 HEAD 一致）：

| 合约 | 当前路径 |
|---|---|
| KanetTestToken（T1，代币） | `src/lib/sil-v1/KanetTestToken.sil` |
| PayoutShard | `src/lib/PayoutShard.sil` |
| PayoutShardV2 | `src/lib/PayoutShardV2.sil` |
| KanetTokenClaim | `src/lib/KanetTokenClaim.sil` |
| RefundClaim | `src/lib/RefundClaim.sil` |
| CloseZkV2 | `src/lib/CloseZkV2.sil` |
| RootClaim | `src/lib/RootClaim.sil` |
| RootClose | `src/lib/RootClose.sil` |
| ShardLeaf | `src/lib/ShardLeaf.sil` |
| ShardLeaf_direct | `src/lib/ShardLeaf_direct.sil` |

**收拢到 `sil-v1/` 单一目录这一步我还没做**——扫出 ≥50 个生产文件（`bshard-close-transport.mjs` /
`pool.js` / `pool-shard-register.mjs` / `bshard-settle-daemon.mjs` / `migrate.js` / `shard-allocator.mjs` /
`closezk-v2-mint.mjs` 等，含活跃结算 daemon 路径）按文件名字符串引用这 9 个 `.sil`，移动文件必须同步改全部
引用点，且这台 console 目前是 da9 生产进程在用同一份代码——移动+改引用这个动作本身对 settler/pipeline 域有实际
落地风险（漏改一处 = 结算创世/花费路径静默找不到模板文件）。**这部分我按铁律 0 先报再动**，见本文件末尾"下一步"；
先把范围稿里"今天内"更紧急、零风险的 ctor 字段清单交出来。

## §1 各合约真实 ctor 字段清单（逐文件 `awk` 从源码摘，未转述未打字）

图例：**USER** = 界面该给人类填的；**BACKEND-BAKED** = 协议级常量，界面不暴露，后端写死；
**BACKEND-DERIVED** = 后端从"选中的代币/市场/委员会配置"算出来填，不是人类直接打字；
**GENESIS-ZERO** = 创世起始占位值（0 / -1 / ZERO32），后端固定填，不进界面。

### T1 — KanetTestToken（代币创世）

```
contract KanetTestToken(
    int      init_amount,                 // USER：初始供应量
    byte[32] init_owner,                  // BACKEND-DERIVED：创建者身份(pubkey 或 covenant id，按 init_owner_scheme)
    byte     init_owner_scheme,           // BACKEND-BAKED：owner 字段解释方式(协议常量)
    byte     init_borrow_scheme,          // BACKEND-BAKED
    byte[32] init_borrow_guard,           // GENESIS-ZERO(协议占位)
    byte[32] init_extension_commitment,   // GENESIS-ZERO(协议占位)
    byte[]   market_tmpl_suffix,          // BACKEND-BAKED：market 模板尾部字节(协议常量，H1 模板锁)
    int      market_tmpl_suffix_len,      // BACKEND-BAKED：随上面一起算
    int      max_ins, int max_outs        // BACKEND-BAKED：协议输入/输出数上限常量
) {
```
人类界面上真正要填的只有 **init_amount**（供应量）；名称/ticker 这类展示元数据链上没有，落 DB（范围稿 §1.1 已指明）。

### T3 — PayoutShard（v1，非 ZK 结算的委员分账层）

```
contract PayoutShard(
    byte[32] poolMerkleRoot,       // BACKEND-DERIVED：委员会 depth-8 merkle root
    byte[32] predicate_commit,     // BACKEND-DERIVED：市场判定规则的 canonical hash
    byte[32] token_tmpl_hash,      // BACKEND-DERIVED：所选代币模板 hash(P13 witness+blake3 现场核)
    int      init_consolidated_pool, // GENESIS-ZERO
    int      init_closed,            // GENESIS-ZERO(0)
    byte[32] init_payoutRoot,        // GENESIS-ZERO
    int init_w0..init_w16,           // GENESIS-ZERO(17-word nullifier 起始占位)
    byte[32] claim_tmpl_hash,        // BACKEND-BAKED：KanetTokenClaim 模板 hash
    byte[32] market_suffix_hash      // BACKEND-BAKED
) {
```

### T3 — PayoutShardV2（ZK 结算专用，字段=PayoutShard + 4 个 ZK 占位 + closeZkTmplAnchor）

```
contract PayoutShardV2(
    byte[32] poolMerkleRoot,          // BACKEND-DERIVED
    byte[32] predicate_commit,        // BACKEND-DERIVED
    byte[32] closeZkTmplAnchor,       // BACKEND-BAKED：CloseZkV2 编译模板锚
    byte[32] token_tmpl_hash,         // BACKEND-DERIVED
    int      init_consolidated_pool,  // GENESIS-ZERO
    int      init_closed,             // GENESIS-ZERO
    byte[32] init_payoutRoot,         // GENESIS-ZERO
    int init_w0..init_w16,            // GENESIS-ZERO
    int      init_attestedWinner,     // GENESIS-ZERO(-1)
    int      init_attestedAtMs,       // GENESIS-ZERO(0)
    byte[32] init_betsRootBaked,      // GENESIS-ZERO
    byte[32] init_refundRootBaked,    // GENESIS-ZERO
    byte[32] claim_tmpl_hash,         // BACKEND-BAKED
    byte[32] market_suffix_hash       // BACKEND-BAKED
) {
```
**v0 建议**：范围稿 §2 已明确 ZK 路径本轮绕开——v0 市场创建走 **PayoutShard（非 V2）**，claim 走非 ZK 路径，
不碰 CloseZkV2/Groth16。

### T3 — KanetTokenClaim（claim/refund 落地目的地，纯代币持有 covenant）

```
contract KanetTokenClaim(
    byte[32] init_market_cov_id,      // BACKEND-DERIVED：来源市场 covenant id(自动填，非人类打字)
    byte[32] init_winner_pk,          // BACKEND-DERIVED：赢家 pubkey
    int      init_amount,             // BACKEND-DERIVED：应得代币数量(结算算出)
    byte[32] init_token_tmpl_hash,    // BACKEND-DERIVED
    byte[32] init_market_suffix_hash  // BACKEND-DERIVED
) {
```
这个合约的所有字段都是结算流程自动算出来写入的，**界面上没有人类要填的东西**——只在"claim 页面"展示只读信息。

### T3 — RefundClaim / RootClaim（结构几乎相同，claim/refund 两条腿）

RefundClaim:
```
contract RefundClaim(
    byte[32] ps_tmpl_hash,          // BACKEND-BAKED
    byte[32] shard_pool_id,         // BACKEND-DERIVED
    int init_local_yes, init_local_no, init_count, init_pool_value, // GENESIS-ZERO(由 RootClose.convert_to_refundclaim 填，非直接创世)
    int      init_closed,           // GENESIS-ZERO
    int      init_winningSide,      // GENESIS-ZERO
    byte[32] init_payoutRoot,       // GENESIS-ZERO
    byte[32] token_tmpl_hash,       // BACKEND-DERIVED
    byte[32] claim_tmpl_hash,       // BACKEND-BAKED
    byte[32] market_suffix_hash     // BACKEND-BAKED
) {
```
RootClaim 同构，多一个 `init_claimed_bitmap`（GENESIS-ZERO，已领位图起始 0）。**这两个合约不是直接创世的**——
由 RootClose 的 `convert_to_claim` / `convert_to_refundclaim` 在结算时新建，界面不需要单独的创建表单。

### T3 — RootClose（市场主壳：下注归集 + 委员判定 + 分流到 claim/refund）

```
contract RootClose(
    byte[32] committee_hash,          // BACKEND-DERIVED：从配置的委员会 pubkey 集算出
    int      deadline_ms,             // USER：市场截止时间（唯一直接来自人类填写的时间类字段）
    byte[32] claim_tmpl_hash,         // BACKEND-BAKED
    byte[32] refundclaim_tmpl_hash,   // BACKEND-BAKED
    byte[32] token_tmpl_hash,         // BACKEND-DERIVED：选中的代币
    int init_local_yes, init_local_no, init_count, init_pool_value, // GENESIS-ZERO
    int      init_closed,             // GENESIS-ZERO
    int      init_winningSide,        // GENESIS-ZERO
    byte[32] init_payoutRoot          // GENESIS-ZERO
) {
```
**市场创建界面人类要填的核心字段 = `deadline_ms`（截止时间）+ 选哪个代币（下拉选已创建的 KanetTestToken）**；
议题/描述文字链上没有，落 DB（同代币名称/ticker 处理）。

### T3 — ShardLeaf / ShardLeaf_direct（下注归集叶子，v0 单分片场景用 ShardLeaf_direct）

```
contract ShardLeaf_direct(
    byte[32] market_id,               // BACKEND-DERIVED：所属市场
    byte[32] ps_tmpl_hash,            // BACKEND-BAKED
    byte[32] shard_pool_id,           // BACKEND-DERIVED
    int      seal_count,              // BACKEND-BAKED(v0 单分片=1)
    int      min_bet,                 // USER：最小下注额（市场创建表单可选项）
    byte[32] rootclose_tmpl_hash,     // BACKEND-BAKED
    byte[32] rootclose_init_payoutRoot, // GENESIS-ZERO
    byte[32] token_tmpl_hash,         // BACKEND-DERIVED
    int init_local_yes, init_local_no, init_count, init_pool_value // GENESIS-ZERO
) {
```
ShardLeaf（非 direct）同构，多一个 `payout_cov_id` + `deadline`（partial-shard sweep 用，多分片场景才需要）。
**v0 建议用 ShardLeaf_direct**（单分片路径更简单，市场规模小，符合"能跑就行"）。

## §2 v0 界面最少字段清单（汇总给 KANet-UI）

- **代币创建表单**：`init_amount`（供应量，USER）+ 名称/ticker（DB 展示用，非链上字段）。
- **市场创建表单**：选代币（下拉）+ `deadline_ms`（截止时间，USER）+ `min_bet`（最小下注，USER，可选/给默认值）+ 议题文字（DB）。
- **下注界面**：选市场 + 选 YES/NO + 下注额；不涉及新 ctor 字段，是花费 ShardLeaf_direct 的 `bet` 类 entry 调用参数（下一步后端 API 交付时一并给出 entry 签名）。
- **结算/claim 界面**：只读展示 + 一个 claim 按钮；claim 家族（KanetTokenClaim/RefundClaim/RootClaim）字段全 BACKEND-DERIVED，人类不填。

## §3 下一步（收拢到 sil-v1/ + 后端 API）

收拢文件到 `src/lib/sil-v1/` 单一目录这一步，因为要同步改 ~50 处生产代码引用（含活跃结算 daemon），
我会先给 Bettor 一份"移动+改引用点清单"，走一次轻量审核确认改动范围后再动手，不在没人看过全量 diff 之前
碰这些活跃路径。ctor 字段清单（本文件）现在就发给 KANet-UI，线框稿可以先用这份定字段，不用等收拢完成——
收拢只是换路径，不改字段本身。

同时开始后端 API 设计（代币创世 / 市场创建走 RootClose+ShardLeaf_direct / 下注 / claim），会严格避开范围稿 §3
三类私钥路径。
