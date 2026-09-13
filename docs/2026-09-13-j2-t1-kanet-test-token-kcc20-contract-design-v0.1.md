# T1 · `sil-v1/KanetTestToken.sil`（KTT）· KCC-20 测试币合约设计 v0.1（不写 .sil）

> **Status**: DRAFT-FOR-REVIEW **v0.2**（2026-09-13T11:51Z · Bettor 批准可行性探针 P9（隔离 clone v1.0.0 编 + debugger 跑，产物 `docs/provenance/2026-09-13-j2-t1-p9-ktt-feasibility-probe/`，**不进 `sil-v1/`**）· 结论：**§2.2 形在 v1.0.0 能编能跑**（3788 B）——四条回填：① cov 声明接受 `byte[] witness, int[] owner_input_idx, int[] recv_idx, ClaimState[] new_claims` 额外参数，ABI = `transfer(State[] next_states, witness, int[], int[], ClaimState[])`（**`next_states` 须显式作首参传入**，README "通常不用传"对本形不适用）；② 语言限制：`return` 必须是函数最后一条语句（无提前 return）⇒ §2.2 helper 单出口写法；③ **v1.0.0 C1 规则打到本合约的手写 `mint_issuer` / `clawback`**（leader 合约里的 manual entry）⇒ 两入口第一行必须 `require(OpCovInputCount(OpInputCovenantId(this.activeInputIndex)) == 1)` + `#[covenant.allow(rule = manual_entrypoint_in_leader_contract)]`（角色 1，与 C1 设计同形）；④ 运行期向量 4/4：(b-in) 市场输入在场 pass · 尾差一字节（= NWT §1 自建 covenant）fail · owner cov id 不匹配 fail · 测试构建 `mint_issuer` 恒拒 pass；翻转臂必 FAIL。**(b-out) 只证到编译级**（`validateOutputStateWithTemplate` + `OpOutputCovenantId` 组合编过；运行期需算 genesis cov id，留 T1 实现阶段）· v0.1（2026-09-13T11:48Z · J2 · Bettor 派工 SendMessage 11:4xZ「T1 代币合约设计稿：六字段 + 免费 mint + H1 (a)(b) + H2 编译期常量三入口 + H3 borrow_scheme=0x00 + 向量计划，设计不写 .sil」）· 交 NWT 红队 → Bettor → 🔴 **代币合约 = 钱路 ⇒ Owner 批**（D-017 §3）后才写 `.sil`。
> 输入：J1 `docs/2026-09-13-owner-mainnet-test-token-kcc20-free-mint-assessment-v0.1.md` §3（v0.1.1）· NWT `docs/2026-09-13-nwt-redteam-j1-kcc20-testtoken-v0.1.md`（§1 攻击链 / §2 P1–P3 / §4 borrowed receive / §8 三条 MUST）· 批 T v0.7 §0.5 H1–H5 · T0 实证（P1 跨模板读 / P4b 前缀切片 / P7 sigScript 尾部匹配 / P2 在场判据）· silverscript v1.0.0 `docs/DECL.md` "KCC20-shaped transfer interface" + `kcc20-book`。
> 编译器：v1.0.0（`3ed9733`），`pragma ^0.1.0`（J1 §8 实证 `COMPILER_VERSION` 仍 0.1.0）；产物形 `contracts.KanetTestToken.compiled.{bytecode, template_hash, state_span}`。

## 0. 一句话

KTT 是一个 **KCC-0020 六字段 covenant**：**"mint" 不是入口而是 genesis**（任何人用任意资金输入构造一个代币模板 P2SH 输出即造出一个新代币 covenant 实例——免费、无限、无签名，这就是 Owner 裁定 4 的落地形），合约只在**花费**时执行：`transfer` 守恒 + 只认 `owner_scheme 0x04` + **接收方必须是 KANet 模板（在场则核 sigScript 尾部，同笔新建则核 `validateOutputStateWithTemplate`）**（H1 a+b）+ `borrow_scheme` 钉死 0x00（H3）；稳定币三入口以**编译期常量**存在于源码但在测试币构建里恒拒（H2/P1），切态 = 改常量重编 + 新部署。

## 1. 状态布局（KCC-0020 §2 规范原文序，NWT §4 ✅ 一字不差）

```
contract KanetTestToken(
    // —— genesis State（任何人可任填；合约不校验 genesis，只校验花费）——
    int      init_amount,
    byte[32] init_owner,
    byte     init_owner_scheme,
    byte     init_borrow_scheme,
    byte[32] init_borrow_guard,
    byte[32] init_extension_commitment,
    // —— KANet 模板前缀锁（H1 b）：允许持币的 covenant 模板集，与 H5 不在场证明同源（批 T v0.5 提醒：改模板须同步重烤重跑）——
    byte[]   market_tmpl_suffix,   int market_tmpl_suffix_len,
    byte[]   claim_tmpl_prefix,    byte[] claim_tmpl_suffix,  byte[32] claim_tmpl_hash,
    int      max_ins, int max_outs
) {
    int      amount               = init_amount;
    byte[32] owner                = init_owner;
    byte     owner_scheme         = init_owner_scheme;
    byte     borrow_scheme        = init_borrow_scheme;
    byte[32] borrow_guard         = init_borrow_guard;
    byte[32] extension_commitment = init_extension_commitment;

    byte constant SCHEME_COVENANT_ID = 0x04;   // covenant-id/v1（唯一允许）
    byte constant BORROW_DISABLED    = 0x00;   // disabled/v1（H3）
    // —— H2/P1：态是编译期常量；切稳定币态 = 改这里 + 重编 + 新部署（新 template_hash / 新 covenant-id），不是状态转移 ——
    bool constant MODE_TEST_COIN = true;
    pubkey constant ISSUER_PK   = pubkey(byte[32](0x00…00));   // 稳定币构建时换真 key；测试构建下不被任何入口读取（见 §2.3）
```
- 状态初值全为 ctor 直赋（T0 ③ 实证 #246 允许）。
- `extension_commitment`：v0.1 **必须为 ZERO32**（`transfer` 对每个 `next_state` require），预留位不承载任何语义，防夹带。

## 2. 入口

### 2.1 mint = genesis（无入口）
- "铸造" = 构造一个输出：`scriptPubKey = P2SH(prefix ‖ encode(State{amount:X, owner:<市场 covenant-id>, owner_scheme:0x04, borrow_scheme:0x00, borrow_guard:0, extension_commitment:0}) ‖ suffix)`，用任意资金输入授权（`GenesisCovenantGroup`，同 relay `p2sh.mjs:1885` 形），得到**新** covenant-id。零校验、零签名、零上限 = Owner 裁定 4；供应只在 genesis 那一刻自由，此后由 `transfer` 守恒。
- 多实例模型：**每次 mint 一个新 covenant-id**，市场按**模板**（`readInputStateWithTemplate` 核 `template_hash`）识别代币，不按 id（NWT f4abb387 ①）。
- 由 KANet 客户端（console `pool.js` 下注路 + faucet）构造；外部程序照 §4 产物自己构造也合法。
- 🔴 后果（写明）：genesis 可以把 `owner_scheme` 填成 0x00–0x03 或 `owner` 填成任意 32 字节——这些实例**不可花**（§2.2 只认 0x04 + 模板在场），等于自毁；不是漏洞，是"免费无限"的代价。

### 2.2 `transfer`（cov 声明 · N:M · DECL.md "KCC20-shaped transfer interface"）
```
#[covenant(binding = cov, from = max_ins, to = max_outs, name = transfer, delegate_name = transfer_delegator)]
function transferPolicy(State[] prev_states, State[] next_states, byte[] witness, int[] owner_input_idx, ClaimState[] new_claims) {
    // (H1 a) 花费侧：每个 prev 只认 covenant 持有 + owner covenant 在场（T0 ② 判据）
    for (i, 0, prev_states.length, max_ins) {
        require(prev_states[i].owner_scheme == SCHEME_COVENANT_ID);
        require(prev_states[i].borrow_scheme == BORROW_DISABLED);                     // H3 花费侧
        require(OpInputCovenantId(owner_input_idx[i]) == prev_states[i].owner);      // 在场（P2 形）
    }
    // (H3) borrowed-receive 路径拒绝：witness 首字节 0x01 = KCC-0020 §5 第二转移路径，本合约不支持
    require(witness.length == 0);
    // 守恒（无 minter 分支：mint 只在 genesis）
    int sum_in = 0;  for (i, 0, prev_states.length, max_ins)  { sum_in  = sum_in  + prev_states[i].amount; }
    int sum_out = 0; for (j, 0, next_states.length, max_outs) { sum_out = sum_out + next_states[j].amount; }
    require(sum_in == sum_out);
    // (H1 a+b + H3) 接收侧：每个 next 只能被 KANet 模板持有
    for (j, 0, next_states.length, max_outs) {
        require(next_states[j].amount > 0);
        require(next_states[j].owner_scheme == SCHEME_COVENANT_ID);
        require(next_states[j].borrow_scheme == BORROW_DISABLED);
        require(next_states[j].borrow_guard == ZERO32);
        require(next_states[j].extension_commitment == ZERO32);
        // 接收方模板核（H1 b）二选一，由 witness 决定路径：
        //   (b-in)  接收 covenant 是本 tx 的一个输入 ⇒ 其 sigScript 尾部 == market_tmpl_suffix（P7 形，H5 同源）
        //   (b-out) 接收 covenant 在本 tx 新建（派彩 → 领取 covenant）⇒ validateOutputStateWithTemplate(out_j, new_claims[j], claim_tmpl_prefix, claim_tmpl_suffix, claim_tmpl_hash)
        //           且 OpOutputCovenantId(out_j) == next_states[j].owner
        _requireOwnerIsKanetTemplate(next_states[j].owner, j, new_claims[j]);
    }
}
#[covenant.delegate]
function transfer_delegator(byte[] witness, int owner_input_idx) {   // 非 leader 的代币输入：各自证明自己的 owner 在场（DECL: 组内每个输入各验本地义务）
    require(owner_scheme == SCHEME_COVENANT_ID);
    require(OpInputCovenantId(owner_input_idx) == owner);
    require(witness.length == 0);
}
```
- **(b-in) 为什么看 sigScript 尾部**：P2SH 输入的 `scriptPubKey` 只是哈希，模板字节只在 sigScript 尾部可见（T0/P7 实证；`readInputStateWithTemplate` 同一定位法）。
- **(b-out) 为什么能核**：新建的领取 covenant 是本 tx 输出，`validateOutputStateWithTemplate` 可重算其 P2SH（DECL.md 五个 builtin 之一）；`OpOutputCovenantId(j)` 取其新 id（`kcc20-minter.sil init` 同形）。
- `_requireOwnerIsKanetTemplate` 的两条路由 `new_claims[j]` 是否为空态决定（空 ⇒ b-in；非空 ⇒ b-out）；**两条都不满足 ⇒ 拒**（NWT §1 的"自建 covenant 包一层"在此死：自建 covenant 既不是市场模板输入也不是领取模板输出）。
- H5（在场≠同意）落在**市场/领取合约那一侧**（批 T v0.7 T3），本合约只管代币自身的形。

### 2.3 稳定币骨架三入口（H2 · P1 编译期常量 · P3 向量）
| 入口 | 测试币构建（`MODE_TEST_COIN = true`） | 稳定币构建（`= false`） |
|---|---|---|
| `mint_issuer(sig s, State[] next)`（受控增发） | 第一行 `require(!MODE_TEST_COIN);` ⇒ 恒拒（测试币的 mint 走 genesis） | `require(checkSig(s, ISSUER_PK))` + 守恒放开 |
| `clawback(sig s, int out_idx)`（发行方无持有者授权转走） | `require(!MODE_TEST_COIN);` ⇒ 恒拒 | `require(checkSig(s, ISSUER_PK))` + 目的地模板核 |
| `pause_guard()`（被 transfer 内联调用） | `if (MODE_TEST_COIN) { return; }` ⇒ 不检查 | `require(checkMsgSig(...issuer 时效签名) && tx.daa < window)` |
- **P1**：`MODE_TEST_COIN` 是源码 `bool constant`，不是状态字段、不进 `extension_commitment`；两种构建 = 两个 `template_hash` = 两族 covenant，**切态 = 新部署 + 旧币按旧规则 transfer 到新合约**（没有运行时切换）。
- **P3**：pause 的正反向量跨两个构建产物比（§3 V-H2-*）；测试构建下 `ISSUER_PK` 不被任何可达路径读取（不存在"空 key 退化"面）。
- **P2（记录项）**：恒假分支若被 codegen 折叠，两构建的 dispatch tag 布局可能不同——切态本来就是新部署，接受；批 D 验收时把两构建的 opcode 序列并排存档。

## 3. 向量计划（v1.0.0 cli-debugger `.test.json`，每输入可喂 `signature_script_hex`——T0 ⑧；全部离线）

| # | 设置 | expect |
|---|---|---|
| V-T-1 正 | 2 个代币输入（同 cov id，owner = 市场 M，M 作输入 i，其 sigScript 尾 = market_tmpl_suffix）→ 1 个输出 owner = M | pass |
| V-T-2 守恒反 | 同上，输出 amount 多 1 | fail |
| V-T-3 (a) 反 | prev.owner_scheme = 0x00 | fail |
| V-T-4 在场反 | owner_input_idx 指向 cov id ≠ owner 的输入 | fail |
| V-T-5 (b-in) 反 | M 输入 sigScript 尾差一字节（弱注入） | fail |
| V-T-6 (b-out) 正 | 输出 owner = OpOutputCovenantId(k)，out k = validateOutputStateWithTemplate(领取模板, new_claims) | pass |
| V-T-7 (b-out) 反 | out k 模板 hash 不匹配 / owner ≠ OpOutputCovenantId(k) | fail |
| V-T-8 NWT §1 攻击 | 接收 owner = 自建平凡 covenant（既非模板输入亦非模板输出） | **fail**（这是 (b) 升必要项后要挡的那条） |
| V-T-9 H3 反 | next.borrow_scheme = 0x01 / witness 首字节 0x01 | fail ×2 |
| V-T-10 ext 反 | next.extension_commitment ≠ 0 | fail |
| V-T-11 多实例 | 两个不同 cov id 的代币输入进同一市场（各自 transfer 组）| 各自 pass（同笔两次 run，active_input 各选） |
| V-H2-1 | 测试构建 `mint_issuer` 任意输入 | fail |
| V-H2-2 | 稳定币构建（`MODE_TEST_COIN=false` 重编）`mint_issuer` 正确 issuer 签 | pass；错签 fail |
| V-H2-3 | 两构建 `template_hash` 必不同（切态 = 新部署的机械证据） | 断言 |
| V-harness | V-T-1 的 expect 翻转 | 必 FAIL |

## 4. 产物与烤入下游

- 编译产物 `template_hash / state_span{offset,len}` ⇒ 市场合约（T3）与领取合约（T2）的 ctor `token_tmpl_hash / token_prefix_len / token_suffix_len`（`readInputStateWithTemplate` 四参）；`market_tmpl_suffix` / `claim_tmpl_*` 反向烤进本合约。**三方互烤 ⇒ 任一模板变，三方 ctor 同步重烤 + 全部向量重跑**（批 T v0.5 NWT 提醒）。
- 循环依赖处理：先编市场/领取模板得其 prefix/suffix/hash → 烤进代币 ctor → 编代币得 token 模板 hash → 烤进市场/领取 ctor。**模板 hash 只依赖 prefix/suffix（不含 ctor 值）**（`kcc20-minter` 同一假设；T0 实证 state_span 在 offset 1 起）⇒ 不成环。NWT 请核这一假设。
- 文件：`kasia-console/src/lib/sil-v1/KanetTestToken.sil`（D-017 §4 ⑤ 目录）；ticker `KTT`（Owner 可改）。

## 5. 与 T2/T3/T4 的接口

- T3（市场入口）：读代币 = `readInputStateWithTemplate(idx, token_prefix_len, token_suffix_len, token_tmpl_hash)`；校验代币输出 = `validateOutputStateWithInputTemplate(...)`（H5 MUST）；不共花分支 = P7 形不在场证明（同一份 `token_tmpl_suffix`）。
- T2（领取 covenant）：其 ctor 烤 `winner_pubkey`（H4）；被本合约 (b-out) 以 `validateOutputStateWithTemplate` 核形；T2 自己的花费入口只允许把币再 transfer 给市场模板（= 本合约 transfer 的 (b-in) 路）。
- T4（下注入口）：console 构造 genesis（§2.1）+ 市场 register 同笔。

## 6. 请 NWT 判

1. **Q1 mint = genesis 无入口**是否符合 Owner 裁定 4 与 KCC-0020（规范对 minting 沉默）；它意味着"无效 genesis 自毁"不算漏洞。
2. **Q2 (b) 二选一路由**（b-in sigScript 尾 / b-out validateOutputStateWithTemplate）能否覆盖全部合法流：下注（市场在场）、派彩（领取新建）、领取→再下注（市场在场）；有没有第四种合法流被误拒。
3. **Q3 借用路径**：`require(witness.length == 0)` 是否足够拒绝 KCC-0020 §5 borrowed receive，还是要显式核 `witness[0] != 0x01`。
4. **Q4 模板 hash 不含 ctor 值**这一假设（§4 不成环的前提）。
5. **Q5 `pause_guard` 内联**：测试构建 `return` 早退是否会被 codegen 折叠成空函数，影响 P2 记录。

## 7. 没核到的

- ~~未试编~~ v0.2：P9 探针已证 §2.2 形能编能跑（见 Status）；**(b-out) 运行期未证**（要在 test.json 里给出 genesis 输出的正确 cov id = `hash(授权输入 outpoint, 有序输出)`，探针没算；T1 实现阶段用 relay 的 `populateGenesisCovenants` 同源算法补一条向量）。
- P9 的 (b) 路由用 `int[] recv_idx`（≥0 = b-in 输入索引；<0 = b-out 输出索引取负减一）替代 §2.2 的"new_claims 空态判路由"——更机械，建议 v0.3 正式采用。
- `OpCovInputCount(owner) > 0` 与 `OpInputCovenantId(witness_idx) == owner` 两形取后者（显式索引，P2 已编过），是否有 gas/字节差未量。
- 领取模板（T2）尚无稿，`claim_tmpl_*` 三参先按占位。
