> **Status**: CURRENT

# KTT (b-in) 模板锁修法设计 v0.2 — 候选②被 Decoy 攻击证伪，候选④（依赖反转）为新主案

票：**T-KTT-BIN-TEMPLATE-LOCK-FIX**。取代 `docs/2026-09-14-j2-ktt-bin-template-lock-fix-design-v0.1.md`（已标 SUPERSEDED）。

**本文档只设计，不改任何生产 `.sil` 文件**——全部实测用临时实验性副本（`docs/provenance/2026-09-14-j2-ktt-template-lock-fix-bytebudget/` + `docs/provenance/2026-09-14-j2-ktt-bin-template-lock-v4-dependency-reversal/`）跑 `compileSilV100` 真实验证。

## §0 v0.1 方案②为什么被推翻：NWT Decoy 攻击

v0.1 方案②：`KanetTestToken` ctor 删掉 `market_tmpl_suffix`/`len`，`market_tmpl_hash` 挪进 State（genesis 任填），花费时 `ownerIsMarketInput` 用 `readInputStateWithTemplate(idx, mkt_prefix_len, mkt_suffix_len, marketTmplHash)` 核对方——`mkt_prefix_len`/`mkt_suffix_len`/`marketTmplHash` 全部由 `next_states[j].market_tmpl_hash`（State，spender genesis 时任填）+ 调用时的 witness 参数决定。

NWT 的构造性攻击：写一个与市场毫无关系、State 恰好是 4 个 int 计数器的 `Decoy.sil`，老实编译，把编译器自报的真实 `prefix`/`suffix`/`hash` 喂给 `ownerIsMarketInput`——**cli-debugger 直接 PASS**（改 1 个字符做负向对照确认 FAIL，证明测试本身有效，不是判据空转）。根因：`prefixLen`/`suffixLen`/`expectedHash` 这三个值全部是 **spender 自己在调用/genesis 时选**的——`readInputStateWithTemplate` 只保证"这段字节真的是这个 input 的、且 hash 对得上"，从不限制"这个 hash 该不该被信任"，v0.1②在这件事上**比旧的尾部字符串匹配设计还要松**（旧设计至少 ctor-baked 之后不能在花费时改，②允许 spender 每次花费自选）。

## §1 候选④（依赖反转）设计

核心思路：**倒过来**——不让 KTT 在花费时"信任 spender 说的 hash"，而是让 KTT 自己在**编译时**就把"该市场的真身"焊死进自己的字节码，spender 完全没有可以篡改的字段。

### 1.1 `ShardLeaf_direct`（记为 `M`）：`token_tmpl_hash` 挪进 State

```js
contract ShardLeaf_direct(
    byte[32] market_id, byte[32] ps_tmpl_hash, byte[32] shard_pool_id,
    int seal_count, int min_bet,
    byte[32] rootclose_tmpl_hash, byte[32] rootclose_init_payoutRoot,
    // —— genesis State(现 5-field: 原 4-field + token_tmpl_hash) ——
    int init_local_yes, int init_local_no, int init_count, int init_pool_value,
    byte[32] init_token_tmpl_hash   // 🆕 从 ctor-only 挪成 State
) {
    ...
    byte[32] token_tmpl_hash = init_token_tmpl_hash;   // 🆕 成为 State 字段
```

**已实测确认**（`docs/provenance/2026-09-14-j2-ktt-bin-template-lock-v4-dependency-reversal/run.log`）：`token_tmpl_hash` 挪进 State 后，`M` 自己的 `extractTemplateArtifact` 产物（用两组截然不同的 `token_tmpl_hash` 占位值编译）**逐字节相同**——`M` 自己的编译期身份（`M_hash`）与它引用哪个代币模板彻底解耦，这是候选④"无环"的关键前提。

### 1.2 `KanetTestToken`（记为 `KTT_M`）：`market_tmpl_hash` + 长度改回 ctor-baked 常量

```js
contract KanetTestToken(
    int init_amount, byte[32] init_owner, byte init_owner_scheme, byte init_borrow_scheme,
    byte[32] init_borrow_guard, byte[32] init_extension_commitment,
    // —— 🆕 编译期定死, spender 在花费/genesis 时都无法改变 ——
    byte[32] market_tmpl_hash, int mkt_prefix_len, int mkt_suffix_len,
    int max_ins, int max_outs
) {
    ...
    function ownerIsMarketInput(int idx, byte[32] want) : bool {
        MarketState m = readInputStateWithTemplate(idx, mkt_prefix_len, mkt_suffix_len, market_tmpl_hash);
        return OpInputCovenantId(idx) == want;
    }
    #[covenant(binding = cov, from = max_ins, to = max_outs, name = transfer, delegate_name = transfer_delegator)]
    function transferPolicy(State[] prev_states, State[] next_states, byte[] witness, int[] owner_input_idx, int[] recv_idx) {
        ...
        require(ownerIsMarketInput(recv_idx[j], next_states[j].owner));   // 不再需要传 hash/长度, 编译时已定死
    }
```

**依赖顺序（无环，逐条真实编译验证）**：① 编译 `M`（`token_tmpl_hash` 占位）→ 真实 `M_hash` → ② 用真实 `M_hash` + `M` 的真实 `templatePrefix.length`/`templateSuffix.length` 编译 `KTT_M` → 真实 `KTT_M_hash` → ③ 真实市场 genesis 时，`M` 的 State `token_tmpl_hash` 字段填 `KTT_M_hash`。全程单向依赖，`M` 的编译不需要知道 `KTT_M` 的任何东西（①已验证 `M_hash` 与 `token_tmpl_hash` 值无关），`KTT_M` 的编译需要 `M_hash`（一个已经算好的具体值，不是"KTT_M 反过来影响 M"）。

**为什么堵死 Decoy 攻击**：`market_tmpl_hash`/`mkt_prefix_len`/`mkt_suffix_len` 现在是 **ctor 常量**，在 `KTT_M` 编译那一刻就永久确定，`transferPolicy`/`ownerIsMarketInput` 不再从 `next_states[j]` 或任何 witness 参数读取它们——spender 在花费时**没有任何字段可以篡改**去指向一个 Decoy 合约。想让某个假 token 通过某个市场的 `scanOwnedTokenInputs` 检查，攻击者必须让自己的假 token 编译产物的**整体模板 hash**恰好等于该市场真正认可的 `token_tmpl_hash`——这需要真的构造一个 blake3/blake2b 原像碰撞（不可行），或者干脆就是编译了跟真实 `KTT_M` 字节完全相同的合约（那就不是攻击，是正常的自由 genesis）。

同理，`M` 自己的 `token_tmpl_hash`（State，genesis 任填）也不是攻击面——它决定的是"这个特定 `M` 实例信任哪个 `KTT_M` 模板"，`M` 的 genesis 是受控的后端流程（`market_genesis` 端点），不是任意人可写的入口，这跟 KTT 的自由 genesis 是两种不同的信任语境（同 §9.8 `T-SHARDLEAF-STRAY-TOKEN-DOS` 的既有区分：谁能自由 genesis ≠ 谁的 genesis 值会被信任）。

## §2 与②共同的实现规范：`readInputStateWithTemplate` 只传长度，不传字节数组

v0.1②的一个独立实现细节错误（**②④共同适用，不是只在某一个方案里改**）：对照 `RootClaim.sil:91-92`（`ticket_prefix_len`/`ticket_suffix_len` 直接是 `int` entry 参数）才发现，`readInputStateWithTemplate(idx, prefixLen, suffixLen, hash)` **只需要长度（`int`），不需要调用方另外提供实际 prefix/suffix 字节**——它直接读目标 input 自己已经在链上暴露的字节，按长度切片再核 hash。v0.1②误把 `mkt_prefix`/`mkt_suffix` 写成 `byte[]` witness 参数（只为取 `.length`），白白让 KTT 的 `transfer` sigScript 多背 `ShardLeaf_direct` 的整段 `suffix`（可达 15,000+ 字节）。改成 `int` 长度直接传（④方案里干脆连 witness 参数都不需要，因为长度也是 ctor 常量），已实测编译通过。**但对整体 `register_append` 的 `required_fee` 影响不大**（≈0.599→0.5815 KAS，降约 3%）——该交易成本的大头是三个必须维持 20,000,000 sompi 的 covenant/genesis 输出各自的 KIP-9 storage mass，不是 witness 的线性开销，见 `docs/provenance/2026-09-14-j2-bet-mint-stepB-register-append-mass-fee-estimate/`——此前核算的种子面值 0.5/0.5/0.95 KAS 不需要重算。

## §3 字节预算对比（真实编译产物）

| 版本 | KTT 脚本长度 |
|---|---|
| 原始（旧尾部匹配设计，已推翻） | 3471-3867 B（视占位长度） |
| v0.1②（`byte[]` witness，已作废） | 5359 B |
| v0.1②修正版（`int` 长度，State 存 hash） | 4697 B |
| **④（ctor 烤 hash+长度，无 witness）** | **4326 B（全场最省）** |

④ 比②更省字节——完全不需要 `transferPolicy` 携带任何 market 相关参数。`M`（`ShardLeaf_direct`）自身脚本长度 15,076 B（原始占位版本约 15,687-15,690，字段重排的微小差异，非结构性变化）。

## §4 T3 侧改动点

`ShardLeaf_direct.sil` 需要改的地方（已实测确认，diff 很小）：

1. ctor 参数：`token_tmpl_hash`（ctor-only）→ `init_token_tmpl_hash`（挪进 genesis State 参数组）。
2. 合约顶层新增一行：`byte[32] token_tmpl_hash = init_token_tmpl_hash;`。
3. **`register_append` 的 AB11 `stateBytes` 手写编码必须新增一行原样拷贝 `token_tmpl_hash`（32 字节，无需长度前缀，定长字段）**——目前 `stateBytes` 只编码 4 个字段（`local_yes`/`local_no`/`count`/`pool_value`），漏加这一行会导致续约后 `token_tmpl_hash` 在链上真实字节里丢失/被覆盖成垃圾值，是 T4-lite 人工核清单新增项（本设计文档未验证该编码逻辑本身的正确性，只验证了 ctor/State 结构变更后编译产物的 hash 不变性——AB11 编码的正确性需要落码时的独立向量核实，不能只凭这条书面要求就假设做对了）。
4. `token_tmpl_hash` 在 `scanOwnedTokenInputs`/`register_append`/`convert_to_rootclose` 里全部既有引用**不需要任何修改**——silverscript 里 State 字段和 ctor-only 常量的访问语法完全一样（都是普通合约顶层字段），这是本次改动 diff 小的原因。

`KanetTestToken.sil` 改动见 §1.2，比 v0.1②的改动更少（少了 State 字段本身，`transferPolicy`/`ownerIsMarketInput` 签名更短）。

## §5 代价：④是产品/协议变更，不是安全补丁的自然代价，需要 Owner 单独拍板

NWT 明确要求把这条从"安全方案选型"里拆出来单列，**不能混进②/④的技术选型**：

**④ = 每个市场需要一份独立编译、独立 ctor 常量的 `KanetTestToken` 部署 ⇒ 市场 A 赢得的代币与市场 B 赢得的代币不是同一种资产，不能互转。** 已实测确认（`docs/provenance/2026-09-14-j2-ktt-bin-template-lock-v4-dependency-reversal/run.log`）：两个不同市场的 `KTT_M` 编译产物模板 hash 逐字节不同（`d44e07b7...` vs `474aa220...`）——这不是可以事后调整的实现细节，是④这个安全机制**结构性内建**的产品行为（`market_tmpl_hash` ctor-baked 意味着 `KTT_M` 的编译身份天然与市场绑定）。

**需要 Owner 单独确认的具体问题**（本文档只列出问题，不代 Owner 拍板）：

1. **钱包/UI 余额是否按市场分组展示**——如果不同市场的"KTT"互不相同，用户界面上是否需要清楚区分"你在市场 A 有 100 枚"和"你在市场 B 有 50 枚"，而不是笼统显示"你有 150 KTT"（后者会误导用户以为可以合并使用）。
2. **有没有"总资产"概念**——如果产品设计上想让用户看到一个统一的"总测试代币"数字，需要在 DB/UI 层面做聚合展示（链上仍是分市场的独立资产，聚合只是展示层的求和，不代表可互转）。
3. **赢得的代币能否再押别的市场**——**不能**。市场 A 赢的 `KTT_M_A` 实例，其 `market_tmpl_hash` ctor 常量指向市场 A，市场 B 的 `ShardLeaf_direct` 的 `token_tmpl_hash` 只认 `KTT_M_B`，`scanOwnedTokenInputs` 会直接拒绝 `KTT_M_A` 的输入（hash 不匹配）。这是候选④的题中之义，如果产品需要"赢家代币可以滚动复投别的市场"，候选④现在的形态不支持，需要另外设计（比如统一发行一种真正跨市场通用的"标准 KTT"，但那样就要回到"如何安全地做一个跨市场共享的代币模板"这个更难的问题，本文档不展开）。
4. **"代币定义"（DB 层，`proto_token_defs`）与"逐市场筹码"（链上，`KTT_M` 实例）的对应关系**——目前后端设计（`docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md`）里 `proto_markets.token_def_id → proto_token_defs` 是"纯展示，不进 ctor"（同一份 DB 代币定义可以给多个市场复用做展示名/图标）。候选④下，同一个 `token_def_id` 对应的多个市场，其链上 `KTT_M` 实例是**互不相同、互不兼容**的独立资产——DB 层的"这是同一种代币"跟链上"这是不同资产"之间的落差需要在 UI 文案上明确说明（比如"这是 XX 测试币在【市场名】里的筹码，不能跨市场使用"），不能让用户误以为 `token_def_id` 相同就代表可以互转。

## §6 落码要求汇总

- (a) `register_append` 的 AB11 `stateBytes` 新增一行原样拷贝 `token_tmpl_hash`（32 B，见 §4③），入 T4-lite 人工核清单。
- (b) builder（`buildAndBroadcast`）选取市场侧 KTT 输入时，只认 `proto_bets`/`proto_markets` 记录的具体 outpoint，永不按 owner 字段扫描 UTXO——已写入规格稿 `docs/2026-09-14-j2-proto-v0-covenant-construction-spec-v0.1.md` §9.8（`T-SHARDLEAF-STRAY-TOKEN-DOS`），本设计不重复展开。
- (c) `readInputStateWithTemplate` 一律用 `int` 长度参数，不传 `byte[]` witness（§2），②④两个候选共同适用。

## §7 NWT 原话记录

> NWT 对 ④ 机制 GREEN（写入窗口仅 genesis，continuation 只能照抄，decoy/fork 均被原像抗性挡住），但拎出一条产品级影响必须显式写进 v0.2"代价"并单列：④ = 每个市场一份独立编译/独立 ctor 的 KTT 部署 ⇒ 市场 A 赢得的代币与市场 B 的不是同一种资产、不能互转——这条不是安全补丁的自然代价，是产品/协议变更，由 Owner 单独拍，不混进 ②/④ 选型。

## §8 已知限制

- 未做 NWT Decoy 攻击在④设计下的实际负向向量复现（静态论证成立：④下 `market_tmpl_hash`/长度不再是 witness 参数，spender 无法在花费时选择，Decoy 攻击的前提条件已经不存在——但"确认前提不存在"不等于"跑过一次真实攻击尝试仍然失败"，建议 NWT 复跑 `docs/provenance/2026-09-14-j2-ktt-bin-template-lock-v4-dependency-reversal/` 后视情况补一条 cli-debugger 负向向量）。
- §6(a) AB11 `stateBytes` 拷贝要求只是设计标注，未做实际编码/向量验证。
- 全部字节预算数字基于占位 ctor 值，真实市场参数下的精确值需要落码时用真实值重新编译确认（不预期显著变化，因为此前"逐字段隔离"系列 provenance 已确认 ctor 字段的具体取值不改变编译产物长度，只有类型/数组长度会）。
