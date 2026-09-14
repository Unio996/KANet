> **Status**: SUPERSEDED-BY-REMOVAL — 见 `docs/2026-09-14-j2-ktt-bin-template-lock-fix-design-v0.3.md`。本文档提出的方案②被 NWT (1395/1399) 用 Decoy 合约构造性证伪，v0.2 提出候选④接手，但 Owner 最终裁定(账本 1408) 撤销整个 H1(b) 检查本身（"代币就是代币"）——②④要解决的问题连同问题本身一起被移除，不是候选之间的选型结果。

# KTT (b-in) 模板锁修法设计 v0.1 — 用 State + `readInputStateWithTemplate` 替换尾部字节匹配

票：**T-KTT-BIN-TEMPLATE-LOCK-FIX**。出处：NWT (1395) 红队证伪"132 字节尾部匹配" + Bettor/NWT 后续裁定"v0 修法方向 = 本文档方案 ②（`market_tmpl_hash` 从 ctor 挪进 State + 花费时全模板核对方）+ 链下市场注册表兜底合法性分类"，方案 ③（固定权威签名）降级为备选，触发条件是"第三方可绕 UI 自拼交易"出现时升级为硬阻塞。

**本文档只设计，不改任何生产 `.sil` 文件**——全部实测用 `scratch/_j2_ktt_fixed_v1.sil`（临时实验性副本，未入库，不影响 `kasia-console/src/lib/sil-v1/KanetTestToken.sil` 权威文件）跑 `compileSilV100` 真实验证，字节数/hash 值均为真实编译产物，不是估算。

## §0 背景：旧机制为什么被推翻

`KanetTestToken.ownerIsMarketInput` 原实现：

```js
function ownerIsMarketInput(int idx, byte[32] want) : bool {
    byte[] ss = tx.inputs[idx].sigScript;
    int n = ss.length;
    bool okTail = false;
    if (n >= market_tmpl_suffix_len) { okTail = ss.slice(n - market_tmpl_suffix_len, n) == market_tmpl_suffix; }
    return OpInputCovenantId(idx) == want && okTail;
}
```

`market_tmpl_suffix`/`market_tmpl_suffix_len` 是 ctor-baked 常量。NWT (1395) 红队证明两个致命点：① `want = next_states[j].owner` 由花费者自填，`OpInputCovenantId(idx) == want` 是"我说是就是"的半句自指重言式；② fork `ShardLeaf_direct` 只改 `convert_to_rootclose` 一行（去掉 solvency/ZERO32 守卫）、其余原样编译，与真实 `ShardLeaf_direct` 的公共尾部字节可以做到 634/403 字节（远超我此前"11 合约互不撞尾"证的 132 字节唯一性——那只证明"按规矩写的合约互不撞"，攻击者是刻意 fork 削弱再编译，不受此约束）。NWT 后续核实：真实市场已持有的筹码拉不走（`register_append`/`convert_to_rootclose` 有独立的 owner/hash pin 保护），缺陷收窄为"(b-in) 不提供市场合法性分类担保"（钓鱼类，v0 零价值测试代币下无经济损失，但修法前不能上金丝雀之外的场景）。

## §1 设计：State 承载 + 全模板 hash 核对方

### 1.1 ctor 变更

删除：`byte[] market_tmpl_suffix, int market_tmpl_suffix_len`（2 项）。
新增：`byte[32] init_market_tmpl_hash`（1 项，genesis State 字段，同 `init_owner`/`init_amount` 等既有字段一样"任何人可任填，合约不校验 genesis，只校验花费"）。

```js
contract KanetTestToken(
    int      init_amount,
    byte[32] init_owner,
    byte     init_owner_scheme,
    byte     init_borrow_scheme,
    byte[32] init_borrow_guard,
    byte[32] init_extension_commitment,
    byte[32] init_market_tmpl_hash,      // 🆕 替换 market_tmpl_suffix/len
    int      max_ins, int max_outs
) {
    ...
    byte[32] market_tmpl_hash = init_market_tmpl_hash;   // 🆕 成为 State 的一部分(合约用 #[covenant(...)] 声明式宏,
                                                          //    State 是"合约全部顶层字段"自动合成, 加这行 = 自动进 State)
```

### 1.2 `ownerIsMarketInput` 改写（对照 `docs/TUTORIAL.md` §"State Transition Builtins" `readInputStateWithTemplate` 签名逐字写）

TUTORIAL 原文签名：

```js
readInputStateWithTemplate(
    int inputIndex,
    int templatePrefixLen,
    int templateSuffixLen,
    byte[32] expectedTemplateHash
)
```

"checks the foreign template hash **and** the foreign input's P2SH commitment before decoding"——这是比原尾部字节比较强得多的原语：forge 需要真的找到一个 blake3/blake2b 原像碰撞让"claim 的 prefix/suffix 字节"经哈希等于 `expectedTemplateHash` 且同时是那个 input 真实 P2SH `scriptPubKey` 的 preimage，不是"凑出同样一段尾巴"就能过。

```js
struct MarketState {                 // 镜像 ShardLeaf_direct 的 genesis State(4-field, 见其源码)
    int local_yes;
    int local_no;
    int count;
    int pool_value;
}

function ownerIsMarketInput(int idx, byte[32] want, byte[32] marketTmplHash, byte[] mkt_prefix, byte[] mkt_suffix) : bool {
    MarketState m = readInputStateWithTemplate(idx, mkt_prefix.length, mkt_suffix.length, marketTmplHash);
    return OpInputCovenantId(idx) == want;
}
```

`m` 的具体字段值不需要被读取——调用本身不抛错就已经证明"`idx` 这个输入的真实 P2SH scriptPubKey 精确等于 `mkt_prefix‖(某个合法 State 编码)‖mkt_suffix`，且这段 `prefix‖suffix` 的 blake3 等于 `marketTmplHash`"，这正是需要的安全性质。

### 1.3 `transferPolicy` 签名变更（`mkt_prefix`/`mkt_suffix` 作为新增 extra call args）

依 `DECL.md` §"Verification mode"："Then comes `State[] new_states`. Remaining params are optional extra call args"——`witness`/`owner_input_idx`/`recv_idx` 已经是这类 extra call args，新增两个跟在后面即可，编译器生成的 entrypoint 会自动把它们暴露成可供调用方传入的参数：

```js
#[covenant(binding = cov, from = max_ins, to = max_outs, name = transfer, delegate_name = transfer_delegator)]
function transferPolicy(
    State[] prev_states, State[] new_states, byte[] witness,
    int[] owner_input_idx, int[] recv_idx,
    byte[] mkt_prefix, byte[] mkt_suffix          // 🆕
) {
    ...
    require(ownerIsMarketInput(recv_idx[j], next_states[j].owner, next_states[j].market_tmpl_hash, mkt_prefix, mkt_suffix));
    ...
}
```

**v0 范围限制（如实标注）**：`mkt_prefix`/`mkt_suffix` 是单一一对（不是数组），意味着本设计只支持"一次 `transfer` 调用里所有 `next_states[j]` 指向市场的那些输出，全部指向同一个市场模板"——这与 v0 "一个市场一次下注只涉及一个市场"的实际使用场景吻合。若未来需要一次 `transfer` 同时路由到多个不同市场，需要把 `mkt_prefix`/`mkt_suffix` 改成按 `j` 索引的数组，是范围外的后续工作，不在本票内。

## §2 字节预算（真实编译产物，非估算）

用 `scratch/_j2_ktt_fixed_v1.sil`（临时实验副本）编译，`compileSilV100` 真实产出：

| 版本 | ctor 形状 | 脚本长度(bytes) | 说明 |
|---|---|---|---|
| 旧设计（此前唯一性研究用的 132 字节占位） | `market_tmpl_suffix`=132B | 3867 | 已推翻的方案，仅供对照 |
| 旧设计（与 T1 原测试同长度的 5 字节占位） | `market_tmpl_suffix`=5B | **3471** | 更公平的"旧设计最小成本"基线 |
| 新设计（本票方案，State 增 32B + `readInputStateWithTemplate`） | 无 ctor 字节数组，`init_market_tmpl_hash`=32B State | **5359** | 真实编译产物 |

**净变化：+1888 bytes（相对旧设计最小基线 3471）**。这个增量来自 `readInputStateWithTemplate` 自身的字节码开销（P2SH commitment 核验 + 解码 `MarketState` 4 个 int 字段）远超省下的"尾部 slice+compare"逻辑。这不是 ctor 里烤的常量字节（旧设计的 132/5 字节尾部是 ctor-baked，直接计入脚本体积；新设计的 `mkt_prefix`/`mkt_suffix` 改成**调用时 witness 提供**，不烤进编译产物本身——`transferPolicy` 花费时的**sigScript**会因为要带上这两个变长字节数组而变大，但那是"花费交易"的尺寸，不是"这份编译产物/genesis P2SH 承诺"的尺寸；**genesis 阶段的 mass 惩罚（p²/v 那种）只看 genesis 输出的 scriptPubKey，与 redeem 脚本大小无关**（见 `docs/provenance/2026-09-14-j2-bet-mint-stepA-ktt-genesis-mass-fee-estimate/`），花费阶段的 sigScript 增大只影响**线性** mass（NWT 已核实"输入侧大 sigScript 是线性 mass，输出侧才有 p²/v"）。

**结论**：genesis 侧（bet_mint 步骤 A）的 mass/fee 预算**不受本次修法影响**（redeem 脚本变大不改变 genesis 输出 mass 公式）；花费侧（bet_mint 步骤 B，`register_append` 消费 KTT 时走 `transfer`）的 sigScript 会因为新增 `mkt_prefix`/`mkt_suffix` witness 参数而变大，具体增量取决于真实市场的 `mkt_prefix`/`mkt_suffix` 实际长度（待 ShardLeaf_direct 侧稳定后才能量出真实值——**目前 ShardLeaf_direct 本身没有变化，它自己的 `extractTemplateArtifact` prefix/suffix 依旧是此前测过的 1 字节 prefix + ~15501-15654 字节量级的 suffix, 视具体 ctor 而定**，这个量级会直接体现在 KTT `transfer` 调用的 sigScript 里，是本设计目前**最大的一块新增花费侧成本**，需要在 bet_mint 步骤 B 的 mass 实验里精确量出，不是本文档能替代的）。

## §3 对 T3 侧的连带：`ShardLeaf_direct.token_tmpl_hash` 是否仍可 ctor-baked？

**已实测确认：仍可以，且结果恒定。** 用两组截然不同的 `init_market_tmpl_hash`/`init_owner` 占位值（`Z32` vs `F32`）编译新设计的 KTT，`extractTemplateArtifact` 算出的 `token_tmpl_hash` **逐字节相同**（`9190f53ee3eeecc3cdabf6ae7e788dcf8f1ed5c9be33380e6b92db3ca599e6f0`）——因为 `market_tmpl_hash` 现在是 **State 字段**（`extractTemplateArtifact` 排除的正是 State 区域），不再是 ctor-baked 常量，KTT 自己的模板身份（供 `ShardLeaf_direct` 的 `token_tmpl_hash` ctor 字段引用）与它未来会指向哪个市场彻底解耦——这正是 T-PROTO-TEMPLATE-CONST-ASSUMPTION-CORRECTED 那条票要修的编译期环的根治方式：把"逐市场变化的东西"从 ctor 移进 State，让"稳定不变的东西"（这里是 KTT 自己的字节码结构）留在能被 `extractTemplateArtifact` 排除法命中的位置。

`ShardLeaf_direct.sil` 本身**不需要任何改动**——`token_tmpl_hash` ctor 字段的语义和计算方法完全不变，只是它引用的 KTT 编译产物现在是"修法后的 KTT"（新的 `token_tmpl_hash` 数值，因为源码变了），需要在 anchors 脚本或 market_genesis 现算逻辑里换成新值，这是落码时的机械更新，不是设计问题。

## §4 向量计划（如实标注：本设计不挡 fork，只挡尾部伪造与编译期环）

| 向量 | 内容 | 预期 |
|---|---|---|
| V1 正向 | 真实 `ShardLeaf_direct` 编译产物，`mkt_prefix`/`mkt_suffix`/`marketTmplHash` 三者来自同一次真实编译，`want` 与 `OpInputCovenantId` 匹配 | **pass** |
| V2 负向-hash 不符 | `mkt_prefix`/`mkt_suffix` 正确，但 `marketTmplHash` 改 1 字节 | **fail**（`readInputStateWithTemplate` 内部 hash 校验失败） |
| V3 负向-字节不符 | `marketTmplHash` 正确，但 `mkt_suffix` 改 1 字节（不再是那个 hash 的真实原像） | **fail** |
| V4 负向-covenant_id 不符 | 尾部+hash 全对，但 `want`/`OpInputCovenantId` 不匹配 | **fail**（同旧设计 REAL-V3 的性质，未变） |
| **V5 NWT fork 场景——如实标注仍然 pass** | fork `ShardLeaf_direct`（只改 `convert_to_rootclose` 一行，`register_append`/State 布局不变）、拿 fork 的**真实**编译产物算出它自己真实的 `mkt_prefix`/`mkt_suffix`/hash，喂给 KTT | **仍然 pass**——`readInputStateWithTemplate` 只验证"这段字节确实是这个 input 真实脚本的 prefix‖state‖suffix 且 hash 对得上"，不验证"这份字节码内部逻辑是否安全"。**本设计消灭的是尾部字符串伪造(V2/V3 场景)和编译期环(§3)，不消灭"攻击者能自己 fork 一份语义上恶意但字节上诚实自洽的市场合约"这条路**——这条路的防线是 NWT 已核实的"真实市场已持有的筹码拉不走"（`register_append`/`convert_to_rootclose` 自己的 owner/hash pin），加上链下注册表（§5）在 UI/backend 层面从不让真实资金流向未登记的市场，两层配合才完整关闭风险，不是 KTT 一个合约单独扛。 |

## §5 链下市场注册表规格（NWT 裁定"P3 防钓鱼属 UI 注册表层"的落地）

**不需要新表**——`docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md` 已设计的 `proto_markets` 表天然就是这个注册表：它只由 `market_genesis` 这一条受控的后端流程写入（`shardleaf_txid`/`shardleaf_vout` 字段落链后才 `UPDATE`），不存在"外部人能自己插一行"的入口（同 `PROTO_SINGLE_OPERATOR=1` 门禁——未知 market_id 一律 404，§6 已记 NWT 原话）。

- **表**：复用 `proto_markets`，不新增字段（`shardleaf_txid`/`shardleaf_vout` 已经是"这个市场的 covenant 落链坐标"，从中能推出真实 covenant id）。
- **端点**：`buildAndBroadcast` 构造 bet_mint 步骤 B 的 `transfer` 调用前，**必须**先查 `proto_markets`（按 `market_id` 查，确认 `status` 是可下注态且 `shardleaf_txid/vout` 已落链非空），只有查到合法记录才去 RPC 读该市场真实的 `mkt_prefix`/`mkt_suffix`/`marketTmplHash`（走 §1 的编译产物）构造 witness——这一步是**代码层面的强制前置校验**，不是"建议"，未命中直接拒绝构造交易（同 `PROTO_RELAY_ID`/`no_suitable_fee_utxo` 一类 fail-loud 设计纪律）。
- **UI 提示**：市场列表/详情页对"未在 `proto_markets` 里、或 `status` 不是可下注态"的 market_id 一律不可选（前端层面不暴露入口）+ 后端兜底拒绝（双保险，同既有"前端隐藏 + 后端强制"惯例，不靠前端单独把关）。

## §6 NWT 触发点原话（记录，供未来升级 ③ 判断依据）

> NWT 对修法方向 GREEN：v0 = ②（`market_tmpl_hash` 从 KTT ctor 挪进 State、花费时 `readInputStateWithTemplate` 全模板核对方，消编译期环 + 收口 tail forge）+ 链下市场注册表承担"合法市场"分类；③ 作备选、若启用须 M-of-N 门限非单钥；**触发点 = "第三方可绕 UI 自拼交易"出现时 ③ 变硬阻塞**。

## §7 已知限制清单

- 本设计**不覆盖** T-PROTO-TAIL-OPCODE-DISASM（132 字节尾部反汇编）——该票随旧设计一起作废，不再需要（新设计不依赖尾部字节）。
- `mkt_prefix`/`mkt_suffix` 单一对、不支持多市场路由（§1.3 已标注，范围外）。
- bet_mint 步骤 B 的真实 mass 实验（含新设计下 `transfer` 调用的真实 sigScript 大小）尚未跑，是本文档之后的下一步，不在本票范围内（§2 已标注）。
- 本设计依赖 `proto_markets` 表 + `PROTO_SINGLE_OPERATOR` 门禁的组合才完整关闭钓鱼风险（§4 V5 已如实标注单靠 KTT 合约不够）——门禁本身的实现仍等 market_genesis 整体实现一起做。
