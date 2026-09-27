> **Status**: DRAFT-FOR-REVIEW v0.1（2026-09-27 · J2 设计 · 待 NWT 红队审）

# KTT 可钱包持有 + 铸币/查阅面板 — 设计稿 v0.1

**工作线**: D-035（`docs/DECISIONS.md`，Owner 本机终端亲批 2026-09-27）
**分支**: `coord/j2-ktt-wallet-panel-20260927`（独立 worktree `scratch/_j2_wt_ktt_panel`，基于 `origin/bshard-m3-deploy@ea7f0ea2`，含 D-035 本身那条 ledger）
**流程**（D-035 §4）: 本稿（查现成→设计）→ NWT 审 → simnet 实现与实测 → NWT diff 审 → 合入 → 主网小额实测。**本稿只设计，不写 `.sil`、不改代码**（D-017 §3：代币/市场合约改造 = 钱路，NWT 审后仍需 Owner 批实现）。

## 背景（Owner 原话与决策链，不转述失真）

- **D-035**：Owner 本机终端「你先搞一个生产和查阅这个代币$kanet面板（我记得已经造过了），先制造测试币，然后我们所做的所有组件都可以用到它来进行测试。」「该花钱就花……我们最多花一些转账gas」。Bettor 提示 Track A「0 token」铁律（KTT 不能被误认成"KANet 发币"）后，Owner 定「钱包能持有，名字用 KTT」。
- **取代**：D-017 中"测试币只许 covenant 持有（`owner_scheme` 仅 `0x04`）"一条。依据 Owner 2026-09-15「无限供给！人人都可以mint!何罪之有？」「代币就是代币」——**D-035 §1 的论证与本稿的前提一致：零价值、人人可铸的测试币，限制持有方式防不住任何真实损失**，本稿据此设计不额外收紧任何东西。
- **D-020**（2026-09-15）：KTT 免费无限铸造是既定前提；genesis 校验已改为 `validateOutputStateWithTemplate` 直接核对，下注合并为一笔交易。**不动**（见下文③④对 D-020 的零影响论证）。
- **D-017 附带记录（本稿必须继承的历史教训，不是可忽略的旧闻）**：
  - `docs/DECISIONS.md` D-017 状态注记（1395/1396/1398/1401）记录了 KTT `(b-in)` 接收方模板锁曾经可伪造、后被 Owner 2026-09-14 裁定"撤销 H1(b) 检查本身，代币就是代币"（方案 C，落码 138c2f21/a16f6452/9be0805c）彻底关闭——**当前生产 `KanetTestToken.sil` 已经是方案 C 之后的版本**，不核接收方类型，只核 `owner` 非零 + owner_scheme 已知 + 守恒。本稿新增的 pubkey 持有方案**不重开**这条已关闭的攻击面（见⑥）。
  - D-018（守恒降级 `sum_in>=sum_out`）§6 明文："本降级的经济无害性仅对自发免费无限铸造测试币成立……将来换币……本条必须重审"——本稿设计的 pubkey 持有方案同样只在"KTT 零价值"前提下安全（见⑥"新旧方案混用"）。

---

## ① 查现成（D-031 最低范围）

**结论先行**：能复用的都复用；发现**两处几乎重复的 genesis-artifact 构造函数**（同一逻辑写了两遍），本稿不新增第三处，扩展其中"活"的那一份。

| 资产 | 路径 | 状态 | 本稿用法 |
|---|---|---|---|
| KTT 合约本体 | `kasia-console/src/lib/sil-v1/KanetTestToken.sil` | **活**，主网集第 8/11 个合约（D-019） | ②在其旁边新增一份 v2 合约（新文件，见②"新旧共存"），不改这份 |
| 领取合约 | `kasia-console/src/lib/KanetTokenClaim.sil` | **活**，但**不在 `sil-v1/` 目录**（历史遗留，T2 时期文件，未随其余合约迁移改名）；`spend()` 第 94-101 行**硬编码 `owner_scheme: 0x04`** 构造新代币输出 | ②③④不改它；⑤记录它是"消费者列表"的一员（见下），佣金计划若要发 KTT 奖励不经过它 |
| genesis artifact 构造 · 活版 | `pool-bshard-artifacts.mjs:432` `computeKttTokenArtifact({amount, ownerCovIdHex}, silvercPath)` | **活**，D-020 `register_append` 的调用方 | ②扩展它（或新增姊妹函数）支持 pubkey owner；③铸币面板直接调它 |
| genesis artifact 构造 · **重复版** | `proto-covenant-builder.mjs:290` `computeKttGenesisArtifact({amount, ownerCovIdHex})` | 🔴 **D-033 proto-v0 已作废**（`kasia-console/src/lib/proto-*`，96 文件，"删除前任何人不得再改动、审、测它"）——**只能参照，不能 import** | 不用；`kcc20-token/signing-key-binding.mjs` 仍 import 它（proto-v0 冻结前的历史依赖，本稿不碰） |
| relay genesis-mint 广播先例 | `kasia-relay/src/lib/p2sh.mjs:1958` `unlockBshardGenesisMintStakeChip` | **活**，单资金输入 → KTT genesis P2SH 输出 + 找零，`populateGenesisCovenants` 绑定 `binding=cov` 组 | ③铸币面板的广播逻辑照抄这个形状（不是抽象成通用函数就是原样复制改地址来源，见③） |
| relay 广播安全闸 | `kasia-relay/src/lib/covenant-broadcast.mjs` | **活**，`computeRequiredFeeSompi`/`validateNetLoss`/`validateFixedValueOutputs` 等通用检查 | ③铸币面板复用这些闸，不新写一套费用/净损检查 |
| sigScript 编码（transfer 入口） | `kasia-console/src/lib/kcc20-token/ktt-transfer-witness.mjs` | **活**，`encodeKttTransferZeroOutAction`，`next_states=[]` 的 leader-of-one 场景，已用 cli-debugger 真实向量核对逐字节一致 | ②的新 pubkey-owned 花费路径需要一个姊妹编码器（新 entry 或扩展现有 `transfer` 的 ABI 后重新生成，见②） |
| claim spend 编码 | `kasia-console/src/lib/kcc20-token/ktt-claim-spend-witness.mjs` | **活**，`export { encodeConvertToRootcloseAction as encodeKtcSpendAction }`——本身只是重导出通用 ABI 编码器，不是 KTT 专属新逻辑 | 不改；③④不涉及 claim |
| 签名绑定纪律 | `kasia-console/src/lib/kcc20-token/signing-key-binding.mjs` | **活**，但 import 自 `proto-covenant-builder.mjs`（冻结）——**模式**（"先从链上状态反推应签公钥，与手上私钥比对，不等 fail-closed 在签名前"）是本稿②⑥要复用的纪律，**不 import 这个文件本身**（它依赖冻结代码），照这个模式在新代码里独立实现一份 | ②的 pubkey-owned 花费必须走这条纪律（见⑥"伪造 owner"对抗项） |
| console 代币定义页面 | `kasia-console/src/api/tokens.js` + `src/ui/tokens-list.eta` + `tokens-create.eta` | **活但与真实 KTT 无关**——`proto_token_defs` 表只存 `name/ticker/description/default_denomination`，**纯 DB 元数据，零链上语义，不产生任何可花费余额**（`tokens.js` 头注原话） | ③④**不能复用这套**当铸币/查阅面板本体（它压根不知道链上 UTXO）；新页面走新路由，**是否复用 `/tokens` 这个 URL 前缀/侧栏入口**列为待定（见④末"待定项") |
| `proto_token_defs` 表 | `kasia-console/src/db/migrate.js` | **活**（非 proto-v0 冻结范围内——D-033 §3 明确列的冻结清单是 `api/proto.js, lib/proto-*, services/proto-*, db/proto-*, ui/proto-*`；`api/tokens.js`/`db/migrate.js`/`ui/tokens-*.eta` 都不在这个清单里，是独立于 proto-v0 冻结的存活表） | ④查阅面板若要落地"本地记录"，新建独立表（见④），不往这张表塞链上语义（保持它"纯元数据登记簿"的现有定位，不越界） |
| 链上索引 | `kaspa_tx_log`（`docs/DATABASE.md:161`） | **活但覆盖面天生不足**：只索引 `watched_addresses`，relay fire-and-forget 无重试，"表里没有 ≠ 链上没有" | ④查阅面板**不能**以它为唯一真相源（见④"局限"） |
| KCC-0020 上游规范 | `D:\silverscript\docs\kcc20-book\src\kcc20-contract.md` | 参考（独立仓，非 kanet-tn12 代码，不受 D-033 约束） | ②owner_scheme 新值直接复用上游命名（见②），不是本稿现造 |

**结论**：② 不新起合约体系，在 `KanetTestToken.sil` 同源基础上加一个 owner_scheme 分支（新文件，见下）；③ 复用 `unlockBshardGenesisMintStakeChip` 的广播形状 + `covenant-broadcast.mjs` 的安全闸；④ 新建一张薄记录表 + 复用 `kaspa_tx_log` 的"不完整"教训（不重蹈覆辙去信任一个天生不完整的索引）；⑤ 不改 `KanetTokenClaim.sil`（超出本稿范围，列为已知消费者）。

---

## ② 新版 KTT 合约：普通地址持有

### 现状（`KanetTestToken.sil` 当前生产版，40-135 行）

- State 六字段：`amount:int, owner:byte[32], owner_scheme:byte, borrow_scheme:byte, borrow_guard:byte[32], extension_commitment:byte[32]`。
- `owner_scheme` 唯一接受值 `SCHEME_COVENANT_ID = 0x04`（"covenant-id/v1"）；花费校验 `require(OpInputCovenantId(owner_input_idx[i]) == prev_states[i].owner)`——owner 字段存的是另一个 covenant 的 covenant-id，"在场证明"而非签名。
- `transfer` 声明为 `#[covenant(binding=cov, from=max_ins, to=max_outs, name=transfer, delegate_name=transfer_delegator)]`：leader 循环验证 `prev_states[]`，每个非 leader 输入各自走 `transfer_delegator` 独立验证自己。
- `witness: byte[]` 参数当前被强制 `require(witness.length == 0)`（KCC-0020 §5 borrowed-receive 路径整体拒绝，H3）。

### 上游 KCC-0020 规范的"pubkey ownership"（`D:\silverscript\docs\kcc20-book\src\kcc20-contract.md:104-137`）

```
byte constant IDENTIFIER_PUBKEY = 0x00;
byte constant IDENTIFIER_SCRIPT_HASH = 0x01;
byte constant IDENTIFIER_COVENANT_ID = 0x02;
...
require(checkSig(sigs[i], prevStates[i].ownerIdentifier));   // pubkey ownership
```

`ownerIdentifier` 直接当 `checkSig` 的 pubkey 参数用——32 字节 x-only Schnorr pubkey，**与现有 `owner: byte[32]` 字段类型完全一致，零 State 布局改动**。本仓 `KanetTokenClaim.sil:106` 已经在用同一模式（`checkSig(s, pubkey(winner_pk))`，`winner_pk` 就是一个 byte[32]），不是新发明。

**owner_scheme 新值**：直接复用上游 `IDENTIFIER_PUBKEY = 0x00`，**不是本稿现编一个数字**——当前生产合约头注（`docs/2026-09-13-j2-t1-kanet-test-token-kcc20-contract-design-v0.1.md:50`）明确记录"`owner_scheme` 填 `0x00–0x03` 的 genesis 实例当前不可花（自毁）"，即 `0x00-0x03` 在现行合约里是死值、未被占用，采用 `0x00` 不与 `0x04`（covenant）冲突，且与上游语义对齐（"pubkey ownership 就是 0x00"），第三方读者对照 KCC-0020 规范能直接理解，不需要额外学一套 KANet 自定义编号。

### 新合约文件：`KanetTestTokenV2.sil`（新文件，不改现有 `KanetTestToken.sil`）

**为什么新文件而不是在原合约里加分支**：
1. **改变编译产物 = 新 covenant-id / 新 template_hash**——任何对 `KanetTestToken.sil` 源码的改动（哪怕只加一个 `if` 分支）都会让编译器产出不同字节码，等价于"发行了一个新代币"。D-019 §5"换锚点纪律"（虽然说的是编译器锚点，原则相通）与本次 D-035 §3"老合约不动"**明确要求老合约字节码不变**——已经在 D-020/主网集里跑通的 `owner_scheme=0x04` 那条路径（`ShardLeaf_direct.register_append` 铸/续代币）绝对不能因为本次改动换了 template_hash 而失联。
2. 新文件复用 D-019 pin 的同一份 v1.0.0 编译器（不需要新工具链），产出一个**新的、独立的 covenant-id 家族**，与老版本**共存**（见下"新旧版本共存"）。

**合约体（草案，`①` 处的 `checkSig` 集成到现有 leader/delegate 结构）**：

```
contract KanetTestTokenV2(
    int      init_amount,
    byte[32] init_owner,
    byte     init_owner_scheme,
    byte     init_borrow_scheme,
    byte[32] init_borrow_guard,
    byte[32] init_extension_commitment,
    int      max_ins, int max_outs
) {
    // State 六字段布局与老合约逐字节相同(便于工具复用/对照);
    byte constant SCHEME_COVENANT_ID = 0x04;   // 与老合约同值, 保留兼容判断
    byte constant SCHEME_PUBKEY      = 0x00;   // 新增: KCC-0020 IDENTIFIER_PUBKEY

    #[covenant(binding=cov, from=max_ins, to=max_outs, name=transfer, delegate_name=transfer_delegator)]
    function transferPolicy(State[] prev_states, State[] next_states,
                             byte[] witness, int[] owner_input_idx, sig[] sigs) {
        require(witness.length == 0);   // H3 borrowed-receive 路径仍整体拒绝, 不变
        int sum_in = 0;
        for (i, 0, prev_states.length, max_ins) {
            require(prev_states[i].borrow_scheme == BORROW_DISABLED);
            if (prev_states[i].owner_scheme == SCHEME_COVENANT_ID) {
                require(OpInputCovenantId(owner_input_idx[i]) == prev_states[i].owner);
            } else {
                require(prev_states[i].owner_scheme == SCHEME_PUBKEY);
                require(checkSig(sigs[i], pubkey(prev_states[i].owner)));
            }
            sum_in = sum_in + prev_states[i].amount;
        }
        // next_states 校验(owner 非零/borrow_scheme 锁 0x00/守恒 sum_in>=sum_out)逐字复用老合约逻辑,
        // 唯一新增: next_states[j].owner_scheme 允许 0x04 或 0x00 两者之一(而不只是 0x04)。
        ...
    }
    #[covenant.delegate]
    function transfer_delegator(byte[] witness, int my_owner_input_idx, sig my_sig) {
        require(witness.length == 0);
        if (owner_scheme == SCHEME_COVENANT_ID) {
            require(OpInputCovenantId(my_owner_input_idx) == owner);
        } else {
            require(owner_scheme == SCHEME_PUBKEY);
            require(checkSig(my_sig, pubkey(owner)));
        }
    }
}
```

**关键设计点**：

- **`sig[] sigs` 平行数组**——直接照抄上游 `checkSigs(State[] prevStates, sig[] sigs, ...)` 的形状（`D:\silverscript\docs\DECL.md:59` 证实 `sig[]` 是合法的 covenant 声明参数类型）。`owner_scheme==SCHEME_COVENANT_ID` 的输入不检查对应的 `sigs[i]`（可传任意占位签名，反正不读），**一笔 tx 里两种 owner_scheme 的 KTT 输入可以混着花**（同一 `transfer` 调用同时处理老式 covenant-owned 和新式 pubkey-owned 输入）——这是"共存"设计的核心：不需要"先把 pubkey-owned 的转成 covenant-owned 才能跟市场合约交互"这种额外步骤。
- **`transfer_delegator` 每次只服务一个非 leader 输入**，天然只需要一个 `sig`，不是数组——比 leader 侧简单，不需要为了"数组统一"硬凑一个长度为 1 的数组。
- **Schnorr-only v1，ECDSA 待定**：上游 KCC-0020 规范本身没有 ECDSA identifier type；本仓 `checkSigFromStackECDSA` builtin 存在（`silverscript-lang/src/compiler/static_check.rs:1383`，`signature:datasig, digest:byte[32], publicKey:byte[33]`），但 33 字节公钥装不进现有 32 字节 `owner` 字段，需要改成"`owner=hash(pubkey)` + witness 供 pubkey 现场核哈希"（P2PKH 式），是比 Schnorr 分支更大的结构改动。**待定项，默认值：v1 只做 Schnorr（`SCHEME_PUBKEY=0x00`），ECDSA 列为可选后续扩展（需要新 owner_scheme 值，如 `0x05`，避免与上游 `0x01`/`0x02` 预留冲突），本稿不实现**。

### 新旧版本如何区分与并存

- **区分手段 = covenant-id 本身**：`KanetTestToken.sil`（老）与 `KanetTestTokenV2.sil`（新）是两份不同源码 ⇒ 两个不同的 `template_hash` ⇒ 花费时 `OpInputCovenantId`/P2SH scriptPubKey 天然不同——**不需要额外加一个"版本号"字段**，版本信息编码在脚本哈希本身，这是 covenant 系统的固有性质，不是本稿新设计的机制。
- **不是"升级"，是"新增一族"**：老合约铸出的 KTT 实例永久保持 `owner_scheme` 只能是 `0x04`（合约字节码冻结，改不了）；新合约铸出的 KTT 实例可以是 `0x04` 或 `0x00`。**两族代币互不兼容**（不同 covenant-id = 不同"币种"，尽管语义上都叫 KTT）——这是 covenant-id 是币种身份这一事实的直接推论，不是缺陷。
- **对 D-020 的影响**：**零**。`ShardLeaf_direct.register_append`（D-020 描述的下注单笔交易）铸/续的代币走老合约的 `computeKttTokenArtifact`（`pool-bshard-artifacts.mjs:432`），ctor 里 `owner_scheme` 硬编码 `0x04`（同函数第 436 行 `{kind:'byte', value:4}`）——**这行代码不动**，D-020 的下注路径继续产出老族 KTT，与本稿新族完全隔离，互不感知。
- **对 ShardLeaf/佣金计划既有用法的影响**：**零**。`ShardLeaf_direct.sil` 的 `scanOwnedTokenInputs`/`register_append` 只认它自己烤的 `token_tmpl_hash`（老合约的），新族代币的 covenant-id/template_hash 与之不同，天然不会被市场合约当作合法注额扫描到——这不是需要额外加的隔离检查，是"模板哈希是协议常量、只认一个值"这个既有机制的自然结果。佣金计划（`CommissionSplit.sil` 等）目前完全不涉及 KTT（付 KAS），本稿⑤只写接口，不实现，零影响成立。

---

## ③ 铸币：任何人可铸任意数量到任意地址

**沿用 D-017/D-020 既定原则**：genesis 不校验、零签名、零上限——"任何人可铸任意数量到任意地址"不是本稿新引入的宽松，是 D-017 裁定 4 已经定下的既有前提，本稿只是让"任意地址"里第一次包含"普通钱包地址"（此前只能铸到某个已存在的 covenant-id，实践中"随便铸一个不可花的实例"就是当前 D-017 附带记录里"填 0x00-0x03 = 自毁"那句话描述的现状）。

### 铸币 TX 形状（照抄 `unlockBshardGenesisMintStakeChip` 的骨架，`kasia-relay/src/lib/p2sh.mjs:1958-1993`）

```
inputs:  [ 铸币者自己的一笔资金 UTXO（普通 P2PK，铸币者自己签名授权）]
outputs: [ KTT genesis 输出（P2SH(KanetTestTokenV2 redeem)，State={amount, owner, owner_scheme, ...}）,
           找零输出（可选，回铸币者自己）]
```

- `owner` 由面板表单填：
  - 目标是"某人的钱包" → `owner_scheme=0x00`，`owner=`目标钱包的 x-only Schnorr pubkey（32 字节 hex，**不是地址字符串**——地址是 `bech32(pubkey-hash 或脚本)`，KTT 的 owner 字段要的是原始 pubkey 字节，面板需要"输入 kaspa 地址 → 反解出 pubkey"或直接要求用户填 pubkey hex，见④"待定项"）。
  - 目标是"某个市场/领取 covenant" → `owner_scheme=0x04`，`owner=`目标 covenant-id（老铸币语义不变）。
- **`populateGenesisCovenants`（p2sh.mjs:1983）必须调用**——2026-09-26 real-simnet 排障记录（`p2sh.mjs:1971-1976` 头注）：genesis 输出若不显式绑定，后续被 `KanetTestTokenV2.transfer` 的 `binding=cov` 覆盖组内省消费时，kaspad 报 `covenant id 0000...0000 input 0 is out of bounds`——**这不是本稿新发现的坑，是已经踩过一次并留了教训的既有事实**，铸币面板复用这段代码就自动继承这条修复，不需要重新踩一遍。
- **广播安全闸**：复用 `covenant-broadcast.mjs` 的 `computeRequiredFeeSompi`/`validateFixedValueOutputs`（`genesisOutputIndices` 参数正是为这种"输出 0 是全新 covenant genesis，不能按"续约"逻辑核"的场景设计的）——不新写一套。

### 手续费谁出（Owner 原话已给方向，细节待定）

Owner 原话「该花钱就花……我们最多花一些转账gas」——**手续费出在铸币交易本身的资金输入里**（同 `unlockBshardGenesisMintStakeChip` 的 `fee = _bshardFeeV1(1)`，从资金 UTXO 里扣，找零回同一把钱包），**不是一个独立的"谁给谁报销 gas"的问题**——铸币者用自己的钱包签这笔交易、自己出手续费（约 0.01-0.05 KAS 量级，取决于 KTT genesis 输出的 mass），这与主网小额实测惯例（D-035 §4"单笔约 0.01 KAS 量级"）一致。

- **待定项 + 默认值**：面板本身用谁的钱包出手续费？
  - **默认值**：铸币面板要求操作者提供/选择自己控制的一个私钥（同现有 `/tokens/create` 页面"没有内置钱包"的现状一致——console 本身不托管私钥，见 `KANet 定位`"角色分工：Console 传导不碰链"），**不由 console 后端代付**。
  - 若 Owner/Bettor 希望有一个"公共水龙头"（任何访客点一下按钮就能免费铸出 KTT 到自己钱包，不需要自己先有 KAS 出手续费）——那需要 console 侧托管一把"出纳私钥"承担所有访客的手续费，这是一个**独立的信任/资金管理问题**（水龙头私钥的资金上限、防滥用限流），本稿不展开，列为"若要做公共水龙头，需要额外一轮设计"。

---

## ④ 查阅面板：给定地址列出其 KTT

### 核心事实（Bettor 已点出，本节展开论证）："地址"由 (模板, owner, amount) 决定

KTT 的链上落点是 `P2SH(redeem_script)`，`redeem_script` 的字节码 = 模板（固定部分，随 `KanetTestToken.sil`/`KanetTestTokenV2.sil` 的编译产物而定）+ State 编码（含 `amount`/`owner`/`owner_scheme`/...）。**`amount` 不同 ⇒ redeem_script 字节不同 ⇒ P2SH 地址不同**——这不是本稿的选择，是 covenant P2SH 的固有性质（`pool-bshard-artifacts.mjs:442-446` 头注已经实测记录："templatePrefix/templateSuffix 跨不同 amount/ownerCovIdHex 组合字节完全相同"，意味着**只有 state 区之外的部分不变，state 区——含 amount——本身是每个实例独一份的**）。

**直接推论**：给一个钱包 pubkey（owner），**不存在**一个"地址"能一次性代表"这个人持有的所有 KTT"——同一个 owner、不同 amount 的两笔 KTT UTXO 落在两个不同的 P2SH 地址上。这是查阅面板设计必须面对的第一个结构性事实，不是实现细节。

### 不依赖索引器的发现方式：三层，各自的可靠边界写清楚

**第一层 · 铸币/转账回执（本面板自己产生的，100% 可靠）**：铸币③或转账操作完成后，面板/后端**当场记录**这笔操作产出的每一个 KTT 输出的 `(txid, output_index, scriptPubKeyHex/P2SH地址, amount, owner, owner_scheme)`到一张新表（见下"本地记录表"）。这一层对"我自己刚铸出/转出的这一笔"100% 可靠（不是发现，是记账）。

**第二层 · 本地记录表（持久化第一层的产出，供后续查阅）**：

```sql
CREATE TABLE ktt_holdings_ledger (
  id              TEXT PRIMARY KEY,   -- uuid
  txid            TEXT NOT NULL,
  output_index    INTEGER NOT NULL,
  p2sh_address    TEXT NOT NULL,      -- 这枚 KTT UTXO 自己的地址(不是 owner 的地址)
  amount          TEXT NOT NULL,      -- sompi, 存字符串防精度丢失(同仓惯例)
  owner_hex       TEXT NOT NULL,      -- 32 字节 hex
  owner_scheme    INTEGER NOT NULL,   -- 0x00 / 0x04
  contract_version TEXT NOT NULL,     -- 'v1' | 'v2' (KanetTestToken.sil vs KanetTestTokenV2.sil)
  minted_by       TEXT,               -- 铸币者/发起方标识(可空)
  created_at      TEXT NOT NULL,
  last_verified_at TEXT,              -- 见第三层
  spent_txid      TEXT                -- 已花费则记录花费它的 tx(见下"如何知道已花")
);
```

- 这张表**只登记"本面板曾经处理过的操作"**，不是通用索引——与 `kaspa_tx_log` 定位不同（那张表试图索引"流经 relay 的所有 tx"，天生不完整；这张表只记"我自己做过的事"，范围小但完整，因为是自己写的）。
- **待定项**：这张表挂在哪个数据库（`kasia-console/data/console.db`，还是新建独立库）？默认值 = 挂在 console 主库，同 `chain_events`/`proto_token_defs` 惯例，不新起一个库。

**第三层 · 逐笔回链核实（诚实的局限所在）**：

- **对于已知的具体 P2SH 地址**（来自第一/第二层，或用户手动输入一个地址）：可以用 kaspad RPC `getUtxosByAddresses` 直接问"这个地址现在有没有 UTXO"——**这是可靠的**（`--utxoindex` 打开的节点原生支持按地址查 UTXO，不依赖本仓任何自建索引），可以据此更新"是否已花费"（`spent_txid`）。
- **对于"给定一个 owner pubkey，这个人是不是还持有其他我不知道的 KTT"**——**做不到**，且**诚实写明做不到**：
  - 没有一个"owner → 所有以它为 owner 的 P2SH 地址"的反查表存在（P2SH 地址是 `redeem_script` 的哈希，owner 只是 State 编码里的一段字节，哈希不可逆）。
  - 唯一能穷举的办法是"对每一个可能的 `amount` 值，现算一遍 P2SH 地址，再逐一问节点有没有 UTXO"——`amount` 的值域是任意正整数（`int`），**不可穷举**。
  - 除非有一个**外部真索引器**（比如全量扫描链上所有 UTXO、对每一个尝试反解出是否匹配 KTT 模板前后缀+州区解出 owner），本面板**不实现这个**（工作量 = 一个真正的 covenant-aware UTXO 索引器，远超本稿范围，且违反本仓"不猜索引器行不行、先查现成"的纪律——`docs/2026-08-29-j2-kaspa-tx-log-integrity-and-single-indexer-design.md` 提到的"kaspa-scout 唯一 indexer"方向若将来扩展到覆盖 KTT 模板扫描，是这条路径的正确后续，不在本稿范围）。
  - **面板必须在 UI 上明确展示这条边界**：查阅结果 = "本面板记录中，该地址/owner 相关的 KTT"，不是"这个人持有的全部 KTT"——措辞上避免任何暗示"完整性"的字样。

**汇总（回答 Bettor 的问题）**：不依赖索引器的发现 = 第一层(自己产生的回执，可靠) + 第二层(本地记录，持久化第一层) + 第三层(逐笔用地址向节点核实是否仍未花费，可靠但只能核"已知地址"，不能反查"未知持仓")。**"给定任意一个从未跟本面板交互过的地址/pubkey，列出它的全部 KTT"这个需求，在不建真索引器的前提下无法满足**，本稿据实上报，不假装能做到。

### 待定项汇总（④）

1. 面板输入"地址"具体接受什么格式——kaspa bech32 地址（需要反解出 pubkey，只对标准 P2PK 地址可逆；P2SH/其他脚本地址反解不出 pubkey）还是直接要求 owner pubkey hex？**默认值：两者都收，pubkey hex 优先（无损），bech32 地址仅在能解出裸 pubkey 时接受，否则报错说明"这个地址不是可持有 KTT 的钱包地址形态"**。
2. `ktt_holdings_ledger` 挂哪个库——默认同主库。
3. 是否复用 `/tokens` URL 前缀——**默认值：不复用**，新开 `/ktt` 或 `/ktt-panel` 路由，理由是 `/tokens` 现有语义（`proto_token_defs` 纯元数据登记簿）与"真实链上 KTT 持仓"是两回事，混用同一入口会让用户误以为在 `/tokens/create` 登记的"代币"会产生真实余额——这是一个**用户认知安全问题**，不只是路由整洁问题。

---

## ⑤ 组件接入：即时分账/商品佣金计划的"KTT 付款与分账"模式（接口与影响面，不实现）

**范围声明**：本节只写"如果要做，接口长什么样、影响哪些既有文件"，**不写实现**（D-035 §3"即时分账与商品佣金计划增加 KTT 付款/分账模式"是本工作线的下一步，本稿是"先出设计稿"这一步的产出，不越界）。

### 现状（`CommissionSplit.sil`/`InstantSplit.sil`，D-034 §8 产出）

两份合约的 ctor 与花费逻辑目前**只处理 KAS**（`tx.outputs[i].value`，原生 Kaspa 输出金额），角色的"应得份额"是 KAS sompi 数额，最终结算是"P2SH 输出锁一笔 KAS，各角色按 `CommissionSplit.split` 拆到各自地址"。

### KTT 模式意味着什么（接口层面）

1. **锁定资产从"这笔 UTXO 的 KAS 面值"变成"这笔 UTXO 携带的 KTT State.amount"**——`CommissionSplit`/`InstantSplit` 目前的 `split`/`refund` entry 读 `tx.outputs[i].value`（原生金额）做守恒校验；KTT 模式下需要改读一个 KTT 输入的 `State.amount`（`readInputStateWithTemplate`，同 `KanetTokenClaim.spend` 已经在用的模式），**这不是加一个参数就行，是整个"这笔合约锁的是什么资产"这个前提在合约层面分叉**——大概率意味着一个**独立的合约变体**（`CommissionSplitKtt.sil`），而不是在现有合约里加 `if (assetType==KTT)` 分支（同②"新文件而非改老合约"的理由：字节码变了就是新 covenant-id，且 KAS 与 KTT 混在一份合约里会让"这笔钱到底是什么"这个问题变得依赖运行时状态而非结构，增加审计难度）。
2. **付款人的 KTT 需要先"进场"**——现在的即时分账/佣金计划由付款人直接把 KAS 发到订单地址（`checkout-static` 系列，D-034 §8）；KTT 模式下付款人要构造一笔"把自己的 KTT 转给订单 covenant"的交易（走②的 `transfer`/`transferPolicy`，`next_states[j].owner = 订单covenant的id`，`owner_scheme=0x04`），订单合约收到后再按角色拆分——**这条路径天然要求付款人的 KTT 是 pubkey-owned（②的新方案）**，因为普通消费者的钱包不是一个 covenant，无法用旧的 `owner_scheme=0x04` 方式持有 KTT；**这正是本稿②的存在理由与⑤的唯一依赖关系**：没有②，⑤的"消费者用自己钱包里的 KTT 付款"这件事根本无法表达。
3. **手续费/找零仍然是 KAS**——KTT 转账交易本身仍需要 KAS 支付矿工费（silverscript 合约不能支付自己的手续费，见 relay 惯例），"KTT 付款模式"不意味着整条链路完全脱离 KAS，只是"标的资产"变成 KTT。

### 影响面清单（若要实现，需要动的文件，仅列举不实现）

- 新增 `kasia-console/src/lib/sil-v1/CommissionSplitKtt.sil`（或类似命名）——新合约，不改 `CommissionSplit.sil`。
- `commission-plan-sdk.mjs`（`createCommissionSplitProtocol` 等）需要一个 KTT 版本的姊妹函数（同②的"新旧代币族各自独立的编排代码"原则）。
- `checkout-static/` 系列（`resolve-order-wasm.js`/`resolve-order-browser.js`）的角色解析逻辑（`resolveRulesForOrder`）目前算的是 KAS sompi 份额，KTT 模式下需要一个平行版本（金额单位变了，`feeSplitLib.feeSplit` 的输入输出契约要不要跟着变，是这份姊妹版本要回答的第一个问题，本稿不展开）。
- **零影响**：`ShardLeaf_direct`/`PayoutShard`/`RootClose` 等下注市场合约族——它们与 `CommissionSplit`/`InstantSplit` 是完全独立的合约家族（D-034 §8 的即时分账不经过下注市场路径），本节改动不触碰它们。

---

## ⑥ 对抗清单

| # | 攻击/风险 | 现状/结论 | 依据 |
|---|---|---|---|
| 1 | **伪造 owner**（攻击者声称自己是某笔 KTT 的 owner，实际不是） | pubkey-owned 分支靠 `checkSig(sig, pubkey(owner))`——伪造需要伪造 Schnorr 签名，密码学不可行；covenant-owned 分支靠 `OpInputCovenantId` 共识层重算比对，"伪造不了"（D-017 §2 状态注记（1395）原话：covenant_id 由共识重算，是真规则）。owner 字段本身（谁被记为 owner）在 genesis 时可以被任意填（零校验），但那只影响"这枚 genesis 出来的实例谁能花"，不构成"伪造已有实例的 owner"。 | `docs/DECISIONS.md` D-017 (1395) 状态注记 |
| 2 | **无签名花费他人 KTT** | pubkey-owned 分支的花费**必须**过 `checkSig`——这是本稿②新增的唯一强制点，不像 covenant-owned 那样靠"在场"就能通过（在场证明对 covenant 有意义，因为 covenant 花费本身受其自己的合约约束；对一个"裸" pubkey，"在场"没有对应的等价物，签名是唯一可行的授权凭证，这正是上游 KCC-0020 把两种 ownership mode 分开定义、给 pubkey 单独配 `checkSig` 而不是复用 `OpInputCovenantId` 的原因）。**风险点**：若②实现时漏掉某个分支的 `checkSig` 调用（比如 `transfer_delegator` 也要同样加 else 分支，遗漏 = 该分支的 pubkey-owned 输入变成无签名可花）——NWT diff 审必须逐分支核对，不能只看 leader 侧。 | ②合约草案 |
| 3 | **守恒绕过**（凭空印出 KTT / 花费时数额对不上） | ②不改守恒式（`sum_in >= sum_out`，D-018 既定，`amount>0` 检查、`owner!=ZERO32` 检查、`borrow_scheme` 锁 0x00 全部照搬）——新增的只是"owner_scheme 分支决定用哪种方式验证 owner 在场/授权"，不触碰金额相关的任何 require。唯一新风险面：`sigs[i]` 与 `prev_states[i]` 的下标必须严格对齐（第 i 个签名对应第 i 个 prev_state）——如果编码器/witness 构造错位（比如把 sigs 数组顺序打乱），可能出现"用 A 的签名花 B 的 KTT"——但由于每个 `owner` 是独立的 pubkey，A 的签名验不过 B 的 pubkey，**下标错位的后果是验证失败（拒绝），不是绕过**，不构成资金损失路径。 | ②合约草案；D-018 §1/§6 |
| 4 | **新旧方案混用**（老 covenant-owned 与新 pubkey-owned 在同一笔 tx 混用、或两个合约版本的实例被当成同一种代币处理） | **同一笔 tx 内混用两种 owner_scheme 是②刻意支持的**（见②"关键设计点"），不是攻击面——因为每种 scheme 各自独立验证，不存在"用一种 scheme 的凭证冒充另一种"的路径（`checkSig` 验的是 Schnorr 数学，`OpInputCovenantId` 验的是共识重算，互不借用彼此的判定结果）。**真正的风险是人的认知层面**：老合约（`KanetTestToken.sil`）与新合约（`KanetTestTokenV2.sil`）是**不同 covenant-id**，若前端/后端某处把两族代币的余额**加在一起展示**（当成"用户有 N 个 KTT"），而实际上这两族分属不同合约、不能互相花费/合并——**这是④查阅面板必须在 UI 上明确区分 `contract_version` 字段的理由**（见④表结构），不能只显示一个笼统的"KTT 余额"数字。 | ②"新旧版本如何区分与并存" |
| 5 | **铸币被抢跑（front-run）** | genesis 本身零签名零校验——任何人看到一笔"即将铸出 KTT 给地址 X"的未确认交易，**无法**抢先铸出"同样内容"抢占（KTT 的身份 = covenant-id = 该笔具体 genesis tx 的输出，不是"owner=X"这个抽象位置；两个人各自铸一笔给同一个 owner X、同样 amount，会产生**两个完全独立、各自有效的 KTT 实例**（不同 txid/output_index ⇒ 不同 covenant-id），不是"后来者抢走先来者的份额"）。**唯一有意义的抢跑场景**：铸币交易本身的**资金输入**（铸币者自己的 UTXO）被双花/抢跑——这是通用 UTXO 双花问题，不是 KTT 特有，relay 侧既有的 `covenant-broadcast.mjs` 广播纪律（同一 UTXO 不能被并发消费两次）已经覆盖，本稿不新增。 | ③"铸币 TX 形状"；covenant-id 身份语义 |
| 6 | **（补充，Bettor 清单未列但②新增机制引出）owner=0 裸花漏洞在 pubkey 分支是否重现** | 老合约 `owner!=ZERO32` 守卫（第 102 行注释："owner=0 会让后续任何裸输入的在场核对恒真通过"）是针对 `OpInputCovenantId` 对未声明 covenant_id 的输入回退 `ZERO_HASH` 这个具体机制的补丁——`checkSig` 没有对应的"零值回退恒真"行为（`pubkey(0x00...00)` 是一个具体的、几乎不可能有对应私钥的点，`checkSig` 对它验证会失败，不会"恒真"）。**结论：pubkey 分支不需要额外的 owner!=ZERO32 特判**（该守卫对 `owner_scheme==0x04` 仍然保留，对 `owner_scheme==0x00` 不是必要条件，但保留也无害——本稿②草案里该 require 是对所有分支统一保留的，不额外收紧也不放松）。**NWT 审时需独立验证这条推理**（"pubkey(全零) 验证是否真的恒假"应有一条真实编译+cli-debugger 向量核实，不能只凭密码学直觉，同仓一贯纪律）。 | ②合约草案 next_states 校验段；老合约 98-102 行注释 |

---

## 尚未回答的问题（本稿范围外，交 NWT/Bettor 定）

1. ②的新合约是否需要 `mint_issuer`/`clawback` 两个稳定币骨架入口（老合约有、当前测试构建恒拒）——本稿默认**照抄**（同 H2/P1 既定纪律"态是编译期常量"），不单独讨论。
2. ③的"公共水龙头"是否要做——本稿只指出这是独立问题，不设计。
3. ④的三个待定项（地址输入格式/DB 挂载位置/URL 前缀）——待 NWT 审或 Bettor 直接拍。
4. ⑤的 KTT 版佣金计划何时启动实现——D-035 §3 只说"增加模式"，未给时间线，本稿不猜。
