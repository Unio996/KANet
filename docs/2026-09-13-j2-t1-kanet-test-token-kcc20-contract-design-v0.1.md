# T1 · `sil-v1/KanetTestToken.sil`（KTT）· KCC-20 测试币合约设计 v0.1（不写 .sil）

> **Status**: DRAFT-FOR-REVIEW **v0.5**（2026-09-13 · Bettor 终裁（NWT 29959d41 Q6 判定，ledger 1044）：**T1 方向 = A″，A′/R 排除**（`KanetMarketRegistry` 草形 + P10 存档为"排除过的方案"），**D 降后备**。NWT 从 `7b1e18cc` `consensus/core/src/tx.rs` + `crypto/txscript/src/covenants.rs` 正面确认前提，**引用必须按拆开的精确版本**：① covenant_id 由共识重算比对（`WrongGenesisCovenantId` 是真规则，**伪造不了**）；② 创世输出的**状态内容**（script_public_key 里编码的 bound/market_cov_id/模板 hash 等字节）**完全不受检**（验证只碰 covenant_id 结构，注释 "genesis outputs are validated but do not populate covenant contexts"）⇒ 双 R 攻击不需伪造 id、只需自由填状态 ⇒ 前提成立。不得简化成"创世完全不验证"。本版：§1/§2.2 按 A″ 重写代币 ctor 与 (b) 路由；§4 改为 A″ 定稿 + 依赖图 + 排除记录；§5 T2/T3 硬约束定稿；**落码前两条真需要已做**：P12 = `validateOutputStateWithInputTemplate` 与 `validateOutputStateWithTemplate` 的 hash/长度参数接受**运行期状态值**且宿主模板 hash 不随实例值变（两组 ctor 全换 ⇒ `a5c45a36…` 同一，808 B），**市场写自己 cov-id 的运行期向量** = cli-debugger 5/5 + 翻转臂红（`docs/provenance/2026-09-13-j2-t1-p12-market-writes-own-covid/`）· v0.4（2026-09-13T12:37Z · Bettor 裁定（NWT 706f1cfb 审后）：**A′ 采纳、C 拒绝**（C 放开 (b) = 重开自建互转攻击面，H1(b) 白做）+ 三条 MUST：**① R 的市场特定字段只做等值比较、永不做结构性用途**（不作循环界/切片长度）；**② 落码前做一次 Q4 同款对照编译：换 `market_cov_id` 等值 ⇒ R 的 `template_hash` 不变**；**③ R 与市场同笔 genesis、`market_cov_id` 直接读同笔市场输出的 `OpOutputCovenantId`（provenance-bind）、R 永不再花费**。本版落三件：(i) §4 给出 R（`KanetMarketRegistry`）合约草形 + 代币侧读法；(ii) **MUST ② 已做**：探针 P10（provenance `P10_registry.sil` / `p10_registry_template_hash.log`）三组全换值 ⇒ hash **同一** `1432f6ed…`，对照臂 `P10_registry_ctrl.sil` 只换一个作循环界的非状态常量 ⇒ hash 变 ⇒ 判别臂非空；顺带撞到 **R 状态不能有 `byte[]`**（`validateOutputState does not support field type byte[]`）⇒ 模板前后缀以 `byte[32]` hash + `int` 长度表示；(iii) 🔴 **推演 MUST ③ 时发现 A′ 有一个未闭的洞（§4 末，请 NWT 判）**：创世不跑脚本 ⇒ 任何人能用 R 模板铸状态任意的 R′，MUST ③ 只约束 R 的**花费**路径，约束不到 R′ 的**创世** ⇒ 双 R 攻击把 NWT §1 攻击原样带回来。给出收敛形 **A″**（把 R 的状态并回市场/领取本体、代币只烤两个稳定模板 hash），探针 P11（`P11_state_args.sil` / `p11_state_args_template_hash.log`）证其编译前提成立（模板 hash/长度可作运行期状态值喂两原语、宿主 hash 稳定）。三条 MUST 在 A″ 下逐条仍成立（§4）· v0.3（2026-09-13T12:18Z · Bettor 合并 NWT+Codex 派单三条：① `mint_issuer`/`clawback` 补 C1 角色 1 `require(OpCovInputCount(OpInputCovenantId(this.activeInputIndex)) == 1)` + allow 注解（§2.3 落，P9 已编过）；② **Q4 实证结果推翻 §4 假设**：`template_hash` **随非状态 ctor 值变**（只换 `max_ins` 3→4 ⇒ hash 与字节码 3788→4238 都变；换模板后缀 ⇒ 变；只换 amount/owner/owner_scheme ⇒ **不变**；provenance `q4_template_hash.log`）⇒ 代币烤市场模板字节、市场烤代币 hash **真的成环**，§4 改为"模板注册 covenant R"间接层破环（待 NWT 判）；③ 市场取消/退款流的模板归属进 T2/T3 输入清单（§5））· v0.2（2026-09-13T11:51Z · Bettor 批准可行性探针 P9（隔离 clone v1.0.0 编 + debugger 跑，产物 `docs/provenance/2026-09-13-j2-t1-p9-ktt-feasibility-probe/`，**不进 `sil-v1/`**）· 结论：**§2.2 形在 v1.0.0 能编能跑**（3788 B）——四条回填：① cov 声明接受 `byte[] witness, int[] owner_input_idx, int[] recv_idx, ClaimState[] new_claims` 额外参数，ABI = `transfer(State[] next_states, witness, int[], int[], ClaimState[])`（**`next_states` 须显式作首参传入**，README "通常不用传"对本形不适用）；② 语言限制：`return` 必须是函数最后一条语句（无提前 return）⇒ §2.2 helper 单出口写法；③ **v1.0.0 C1 规则打到本合约的手写 `mint_issuer` / `clawback`**（leader 合约里的 manual entry）⇒ 两入口第一行必须 `require(OpCovInputCount(OpInputCovenantId(this.activeInputIndex)) == 1)` + `#[covenant.allow(rule = manual_entrypoint_in_leader_contract)]`（角色 1，与 C1 设计同形）；④ 运行期向量 4/4：(b-in) 市场输入在场 pass · 尾差一字节（= NWT §1 自建 covenant）fail · owner cov id 不匹配 fail · 测试构建 `mint_issuer` 恒拒 pass；翻转臂必 FAIL。**(b-out) 只证到编译级**（`validateOutputStateWithTemplate` + `OpOutputCovenantId` 组合编过；运行期需算 genesis cov id，留 T1 实现阶段）· v0.1（2026-09-13T11:48Z · J2 · Bettor 派工 SendMessage 11:4xZ「T1 代币合约设计稿：六字段 + 免费 mint + H1 (a)(b) + H2 编译期常量三入口 + H3 borrow_scheme=0x00 + 向量计划，设计不写 .sil」）· 交 NWT 红队 → Bettor → 🔴 **代币合约 = 钱路 ⇒ Owner 批**（D-017 §3）后才写 `.sil`。
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
    // —— KANet 模板锁（H1 b · v0.5 A″）：只烤【稳定】的市场/领取模板（两者的 per-instance 值全在各自状态里, 模板 hash 不随实例变 = P12 实证）——
    //     单向依赖: 代币 → {市场模板, 领取模板}; 市场/领取【不烤】代币 hash(走各自状态字段) ⇒ 无环(v0.3 Q4 成环已解)
    byte[]   market_tmpl_suffix,   int market_tmpl_suffix_len,      // (b-in) sigScript 尾核(P7/P9 运行期已证); 等价替代 = byte[32] market_tmpl_hash + 两个长度走 readInputStateWithTemplate
    byte[]   claim_tmpl_prefix,    byte[] claim_tmpl_suffix,  byte[32] claim_tmpl_hash,   // (b-out) validateOutputStateWithTemplate(P9 编译级 + P12 同原语运行期已证)
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
| `mint_issuer(sig s, State[] next)`（受控增发） | **首行（v0.3·C1 角色 1，NWT MUST）** `require(OpCovInputCount(OpInputCovenantId(this.activeInputIndex)) == 1);` + 入口上方 `#[covenant.allow(rule = manual_entrypoint_in_leader_contract)]`；第二行 `require(!MODE_TEST_COIN);` ⇒ 恒拒（测试币的 mint 走 genesis） | 同首行 + `require(checkSig(s, ISSUER_PK))` + 守恒放开 |
| `clawback(sig s, int out_idx)`（发行方无持有者授权转走） | 同上两行 ⇒ 恒拒 | 同首行 + `require(checkSig(s, ISSUER_PK))` + 目的地模板核 |
（本合约是 leader 合约——有 `binding = cov` 的 `transfer`——v1.0.0 对其中手写 entry 强制 DECL.md 三选一，P9 探针撞到并按角色 1 编过；向量：单代币输入跑 `mint_issuer` 在稳定币构建 pass、同 cov 两输入 ⇒ fail。）
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

## 4. 产物与烤入下游（v0.5 · A″ 定稿）

### 4.0 A″（采纳 · Bettor/NWT 1044）
- **规则一句话**：**代币 ctor 烤市场模板与领取模板（两者稳定）；市场/领取合约把所有 per-instance 值放【状态字段】只做等值比较，代币模板 hash 也走它们的状态**。依赖图单向无环：**领取**（状态 `market_cov_id / winner_pk / amount`，不烤任何 hash）→ **市场**（状态 `token_tmpl_hash / token_prefix_len / token_suffix_len / claim_tmpl_hash / oracle_pk / question_hash / deadline …`，ctor 只赋初值 + 结构常量）→ **代币**（ctor 烤 `market_tmpl_suffix(+len)` 与 `claim_tmpl_prefix/suffix/hash`）。编译顺序：领取 → 市场 → 代币；任一模板变 ⇒ 只重烤**下游**（市场变 ⇒ 重烤代币；领取变 ⇒ 重烤市场状态初值 + 代币），不再三方同步。
- **三条 MUST 在 A″ 下的落点**：① 等值比较 — 市场/领取的 per-instance 状态字段只出现在 `==` 两侧或作运行期参数（P12 里 `token_prefix_len/suffix_len/token_tmpl_hash/claim_tmpl_hash` 都是运行期参数，不是切片长度/循环界）；② Q4 同款对照 — **P12 已做**：`P12_market_a2.sil` 7 个状态字段两组 ctor 全换 ⇒ `template_hash` 同一 `a5c45a36f25b7a16…`（808 B，`state_span{1,159}`）；③ provenance — 领取的 `market_cov_id` 由**市场自己的入口**写 `OpInputCovenantId(this.activeInputIndex)`（**运行期向量已证**，见 4.1），不从外部喂；"永不再花费"变成领取/市场自身状态字段的等值续约。
- **可再造面（如实记，NWT 判为固有语义非漏洞）**：攻击者能用市场**模板**创世一个状态自填的 market′（oracle = 自己）。区别于 A′ 的 R′：market′ 仍要走真实 T3 业务门禁（oracle 投票、截止、下注者选市场 = 选 oracle），不像 R′ 那样零成本背书；(b) 从来只挡"自建**模板**"，不挡"用我们模板开的市场"。
- **排除记录**：A′/R（`KanetMarketRegistry` 草形 + P10 三组 hash 同一 `1432f6ed…` 的对照编译）存档于 `docs/provenance/2026-09-13-j2-t1-p9-ktt-feasibility-probe/`（P10_*、`p10_registry_template_hash.log`）= **排除过的方案**，排除理由 = 双 R 创世洞（4.2 精确表述）。**D**（代币烤发行方公钥 + witness 签名模板证明）**降后备**：把裁决权搬到链下私钥，违背结构性强制取向；只在 A″ 对 T3 约束被证不可行时再议。

### 4.1 P12 实证（`docs/provenance/2026-09-13-j2-t1-p12-market-writes-own-covid/`）
| 项 | 结果 |
|---|---|
| 编译级 | `P12MarketA2` 两入口都编过：`payout_claim` = `validateOutputStateWithTemplate(claim_out, ClaimState{ market_cov_id: OpInputCovenantId(this.activeInputIndex), winner_pk, amount }, witness prefix/suffix, **状态** claim_tmpl_hash)`；`settle_token` = `validateOutputStateWithInputTemplate(token_out, out_state, token_in, **状态** prefix_len, **状态** suffix_len, **状态** token_tmpl_hash)` + `require(out_state.owner == OpInputCovenantId(this.activeInputIndex))`（H5）。两组 ctor 全换 ⇒ hash 同一（`p12_template_hash.log`） |
| 运行期（cli-debugger） | 市场输入 cov id **M**，领取输出 = `ClaimStub(M, winner, 500)` 编译产物的 P2SH（`aa20‖blake2b‖87`，算法对 P8 RootStub 存档重算一致）⇒ **pass**；领取按攻击者 **X** 造 ⇒ fail；市场其实是 X 而领取说 M ⇒ fail；金额改 501 ⇒ fail；市场续约状态改 deadline ⇒ fail；翻转臂 FAIL。5/5 + 翻转 |
| 领取模板 | `ClaimStub` 3 状态字段 + singleton passthrough：`template_hash 209abf73…`，M/X/M_amt 三组 ctor 前后缀与 hash 同一（模板稳定），只有 P2SH 不同 |
| 没证到 | `settle_token` 只到编译级：运行期要给代币输入喂 sigScript 里的模板字节（P7 附A 方法），留 T3 稿一并做；`OpInputCovenantId` 与 `validateOutputStateWithInputTemplate` 组合的 gas/字节未量 |

### 4.2 双 R 创世洞的精确表述（NWT 29959d41 · 引用纪律）
- ✅ **covenant_id 伪造不了**：共识重算 `hash(授权输入 outpoint, 有序输出)` 并比对（`WrongGenesisCovenantId`）。
- 🔴 **创世输出的状态内容不受检**：验证只碰 covenant_id 结构，不碰 `script_public_key` 里编码的状态字节（"genesis outputs are validated but do not populate covenant contexts"）。
- ⇒ 攻击者用 R 模板创世 R′：id 是真的（自己的）、状态是假的（真市场 id + 攻击者模板 hash）。代币核 R 只能核模板 hash（R′ 同）与状态（R′ 自填）⇒ 双 R 攻击。**不是**"创世完全不验证"。

### 4.3 历史（v0.3/v0.4 推演，保留可追溯）
- 编译产物 `template_hash / state_span{offset,len}` ⇒ 市场合约（T3）与领取合约（T2）~~的 ctor~~ **的状态初值**（v0.5）`token_tmpl_hash / token_prefix_len / token_suffix_len`；`market_tmpl_suffix` / `claim_tmpl_*` 烤进本合约。~~三方互烤 ⇒ 任一模板变，三方 ctor 同步重烤 + 全部向量重跑~~ v0.5：单向，见 4.0。
- ~~循环依赖处理：…模板 hash 只依赖 prefix/suffix（不含 ctor 值）⇒ 不成环~~ **v0.3 实证推翻**：`template_hash` 覆盖**全部非状态 ctor 常量**（模板后缀字节、`max_ins/max_outs` 循环界都烤进字节码；只有六个状态字段在 `state_span`）⇒ 代币 ctor 含市场模板后缀 → 代币 hash 依赖市场模板；市场 ctor 含代币 hash → 市场模板依赖代币 hash：**成环，无解**。
- **v0.3 破环方案（待 NWT 判）——模板注册 covenant `KanetTemplateRegistry`（R）**：R 是一个极小、**永不改**的单例 covenant，模板稳定；它的**状态**（不是 ctor）持有当前允许的模板 hash 集（`market_tmpl_hash / market_tmpl_suffix_hash / claim_tmpl_hash …`，byte[32] 若干）。代币 ctor 只烤 **R 的模板 hash**（稳定）；`transfer` 的 (b-in)/(b-out) 改为：`RegistryState reg = readInputStateWithTemplate(reg_idx, R_prefix_len, R_suffix_len, R_tmpl_hash)`（R 必须作为本 tx 一个输入在场，且 R 的花费入口只允许自续约或治理更新），再拿 `reg.market_tmpl_*` 做尾部匹配 / `validateOutputStateWithTemplate` 的 hash 参数。依赖图：R ← 代币 ← 市场/领取（市场 ctor 烤代币 hash）；R 的状态更新 = 换模板不换代币。代价：每笔 transfer 多一个 R 输入（R 单例 ⇒ 全网串行化！）——**这是致命代价**，所以给第二方案：
- **方案 B（更可能采用）**：R 不作输入，而是把"允许模板集"做成代币 ctor 里的 **hash 承诺** `allowed_tmpls_root`（一棵小 merkle 根），(b) 检查时由 witness 提供 `(tmpl_hash, merkle path)`，合约核 `merkle(tmpl_hash, path) == allowed_tmpls_root` 后再用 `tmpl_hash` 做 `readInputStateWithTemplate`/`validateOutputStateWithTemplate`。**仍成环**（root 烤在代币 ctor，市场烤代币 hash）——除非市场侧**不**烤代币 hash：市场用 `readInputStateWithTemplate` 必须给 hash……⇒ 方案 B 不破环。
- **方案 C（破环且不串行化）**：**只让一方烤另一方**：市场/领取合约烤代币模板 hash（单向），代币合约**不烤市场模板**；H1(b) 改由**市场/领取侧**执行——即 H5 的"在场≠同意"检查本来就要求市场入口 `validateOutputStateWithInputTemplate` 核代币输出，把"代币输出的 owner 必须是**我自己**（`OpInputCovenantId(this.activeInputIndex)`）或本 tx 新建的领取 covenant"放进市场入口 ⇒ 代币能被转到哪里由**在场的 KANet 合约**决定，代币合约自身只需 (a)+守恒+H3。NWT §1 攻击（转给自建 covenant）在方案 C 下由"代币 transfer 要求 owner covenant 在场且**该在场 covenant 的入口会核代币输出**"挡——但自建 covenant 的入口不核 ⇒ **仍能转给自建 covenant**……⇒ 方案 C 只挡"从 KANet 合约流出"，挡不住"自建→自建"。
- ~~🔴 **结论**：三方案各有一刀……请 NWT 判 A′ 与 C 的取舍~~ **v0.4 裁定（Bettor · NWT 706f1cfb）：A′ 采纳，C 拒绝**（C = 放开 (b)，重开"自建 covenant 互转"攻击面，H1(b) 白做）。
- **v0.4 · A′ 的 R 合约草形（`sil-v1/KanetMarketRegistry.sil`，探针 P10 已按此形编过）**：
  ```
  contract KanetMarketRegistry(byte[32] init_market_cov_id, byte[32] init_market_tmpl_hash, int init_market_prefix_len, int init_market_suffix_len,
                               byte[32] init_claim_tmpl_hash, int init_claim_prefix_len, int init_claim_suffix_len, bool init_bound)
      // 8 个状态字段同名同型。🔴 无 byte[]（validateOutputState 不支持 byte[] 状态，P10 v1 撞过）⇒ 模板"前后缀字节"不进 R，
      //    R 只存 hash + 两个长度；字节由花费时 witness 供，原语自己核 hash（见下"代币侧读法"）
      #[covenant.singleton] bind(prev, new, int market_out_idx):
          require(!prev.bound); require(new.bound);
          require(new.market_cov_id == OpOutputCovenantId(market_out_idx));   // MUST ③ provenance-bind：从同笔市场输出读，不从外部喂
          其余 6 字段 require(new.x == prev.x)                                    // MUST ①：只等值
      #[covenant.singleton] passthrough(prev, new):
          require(prev.bound); require(new.bound); 8 字段全部 require(new.x == prev.x)
  ```
  **MUST ③ 的机械读法**："R 永不再花费" 在 silverscript 里只能落成 **"状态永不再变"**：代币要读 R，R 就必须作为本 tx 的一个输入在场（`readInputStateWithTemplate` 只读输入；Kaspa 无引用输入），被读一次就被花一次——所以每次都走 `passthrough` 原样续约，cov id 不变。**时序**：tx1 = R 创世（`bound=false`）；tx2 = 花 R 走 `bind` + 市场创世（同笔），`market_cov_id` 由脚本从 `OpOutputCovenantId` 取；之后 R 只 `passthrough`。
  **MUST ①**：P10 里 R 的 6 个市场特定字段全部只出现在 `==` 两侧；两个 `int` 长度字段**不**作切片长度/循环界用（那是代币侧拿去喂 `readInputStateWithTemplate` 的运行期参数，P11 证可行）。
  **MUST ②（已做，provenance `p10_registry_template_hash.log`）**：三组 ctor 全换值（cov id / 两个模板 hash / 四个长度全部不同）⇒ `template_hash` 三组**同一**（`1432f6edebf876ab…`，816 B）；对照臂 `P10_registry_ctrl.sil` = 同合约 + 一个非状态 ctor 常量 `structural_n` 作 `for` 上界，n=1 → `c2b56a49…`(831 B)，n=2 → `7b919ac0…`(838 B) ⇒ **换结构常量 hash 就变**，所以主臂"不变"不是编译器不看 ctor，而是 MUST ① 守住了。
  **代币侧读法**（替换 v0.3 §2.2 的 `claim_tmpl_prefix/suffix` 烤入）：代币 ctor 只烤 `reg_tmpl_hash / reg_prefix_len / reg_suffix_len`（R 模板稳定 ⇒ 代币 hash 稳定）；`transfer` 多收 `int reg_idx, int m_idx, byte[] w_prefix, byte[] w_suffix`：`RegState reg = readInputStateWithTemplate(reg_idx, reg_prefix_len, reg_suffix_len, reg_tmpl_hash); require(reg.bound); require(reg.market_cov_id == OpInputCovenantId(m_idx));` 然后 (b-in) `readInputStateWithTemplate(m_idx, reg.market_prefix_len, reg.market_suffix_len, reg.market_tmpl_hash)`、(b-out) `validateOutputStateWithTemplate(out_k, claim, w_prefix, w_suffix, reg.claim_tmpl_hash)`（字节从 witness、hash 从 R；伪字节过不了原语自己的 hash 核）。P11 证这两个原语接受运行期值作 hash/长度参数且宿主 hash 稳定（`af5dbb29…` 两组同一）。
- 🔴 **v0.4 · A′ 未闭的洞（推演 MUST ③ 时发现 · 请 NWT 判 · T1 落码前的结构性未决）**：**covenant 创世不跑脚本**——创世输出的脚本只在**被花**时执行；创世 tx 只跑授权输入（一个普通 P2PK）的脚本。所以**任何人**都能用 R 的模板（公开）铸一个 R′，状态**任意**：`bound=true`、`market_cov_id=真市场 id`、`market_tmpl_hash=攻击者自己的模板`。MUST ③ 的 provenance-bind 住在 `bind` 入口里，只约束**走 bind 的 R**，约束不到**直接创世成 bound 的 R′**。代币核 R 只有两件可核的东西：模板 hash（R′ 同）与状态（R′ 自填）⇒ **双 R 攻击**：一笔 tx 同时放真 R（`passthrough`，如果市场/别处要核它）与 R′（喂给代币的 `reg_idx`），真市场也在场（满足 `reg.market_cov_id == OpInputCovenantId(m_idx)`——注意这一步核的是 R′ *声称*的 id 与在场市场相等，而 R′ 想声称什么就声称什么），代币按 R′.market_tmpl_hash 放行到攻击者模板 ⇒ **NWT §1 攻击原样回来**。这正是 ShardLeaf 06-20 教训（template-match 可被 recreatable-UTXO 击穿）的 R 版。**根因一句话：代币里没有任何不可再造的 KANet 锚**——cov id 每市场不同不能烤进全局代币；模板 hash 可再造；R 只是把"模板 hash 可再造"搬到了一层之外。给 R 加"bind 须发行方签名"也没用（R′ 不走 bind）；让 R 状态带发行方签名让代币验（代币烤发行方公钥）能堵，但那时 R 已退化成"发行方签的模板证明"——签名本身放 witness 就够，R 一整个 covenant 都是多余的（记为 **方案 D**，见下）。
- **v0.4 · 收敛形 A″（保留 A′ 三条 MUST，去掉可再造面）——把 R 的状态并回市场/领取本体**：Q4 + P10 + P11 三次实证合起来给出更短的路：**代币 ctor 烤市场模板 hash 与领取模板 hash（两者稳定）；市场/领取合约把所有 per-instance 值（代币模板 hash、oracle 公钥、问题 hash、截止、`winner_pubkey`、`market_cov_id`…）全放【状态字段】、只做等值比较**（= MUST ① 原样，施加对象从 R 换成市场/领取本体；Q4 保证状态值不进 template_hash）。依赖图单向无环：**领取**（不烤任何 hash；`winner_pubkey`/`market_cov_id` 是状态）→ **市场**（ctor 可烤领取 hash；代币 hash 走状态 `token_tmpl_hash`；H5 核代币输出用 `validateOutputStateWithInputTemplate(k, st, token_in_idx, len, len, prevState.token_tmpl_hash)`，hash 来自状态、字节来自在场代币输入）→ **代币**（烤市场 hash + 领取 hash，(b-in)/(b-out) 与 v0.3 §2.2 同形，只是不再需要 R）。MUST 逐条：① 等值比较 ✓（同一条纪律）；② Q4 同款检查 ✓（P11 就是它：换 `m_hash/c_hash/长度` 值 ⇒ 宿主 hash 不变）；③ provenance ✓ 且更强：领取的 `market_cov_id` 由**市场自己的入口**在派彩时用 `validateOutputStateWithTemplate(k, ClaimState{ market_cov_id: OpInputCovenantId(this.activeInputIndex), … })` 写入——写的是市场自己的 cov id，不是外部喂值；"永不再花费"变成领取/市场自己的状态字段等值续约。**可再造面（A′/A″ 相同、如实记）**：攻击者能用市场**模板**铸一个状态自填的 market′（oracle = 自己），代币会放行到 market′——这是**模板级允许集的固有语义**：(b) 从来只挡"自建**模板**"，不挡"用我们模板开的市场"；market′ 受市场模板规则约束，下注者选市场 = 选 oracle（产品信任模型，T3 输入）。A″ 比 A′ **少一个 covenant、少一个输入、少一个可再造面、少一条 bind 时序**。
- **方案 D（备选，仅当 NWT 认为 A″ 对 T3 约束太重）**：代币 ctor 烤**发行方公钥**（稳定）；witness 供 `(market_tmpl_hash, claim_tmpl_hash, sig)`，代币 `checkMsgSig(issuer_pk, market_tmpl_hash‖claim_tmpl_hash, sig)` 后再用两 hash 做 (b)。无环、无 R、无可再造面；代价 = 模板允许集由**一把链下私钥**定义（发行方能随时签新模板放行）——测试币可接受，主网真值代币不该。
- ~~**T1 落码前的唯一结构性未决（v0.4）**：……请 NWT 判 A′ 的洞是否成立、A″ 是否采纳……~~ **v0.5：已裁（A″ 采纳，见 §4.0–4.2）；本 4.3 以下各条只作推演史保留。**
- 文件：`kasia-console/src/lib/sil-v1/KanetTestToken.sil`（D-017 §4 ⑤ 目录）；ticker `KTT`（Owner 可改）。

## 5. 与 T2/T3/T4 的接口

- T3（市场入口）：读代币 = `readInputStateWithTemplate(idx, token_prefix_len, token_suffix_len, token_tmpl_hash)`；校验代币输出 = `validateOutputStateWithInputTemplate(...)`（H5 MUST）；不共花分支 = P7 形不在场证明（同一份 `token_tmpl_suffix`）。
- T2（领取 covenant）：其 ctor 烤 `winner_pubkey`（H4）；被本合约 (b-out) 以 `validateOutputStateWithTemplate` 核形；T2 自己的花费入口只允许把币再 transfer 给市场模板（= 本合约 transfer 的 (b-in) 路）。
- T4（下注入口）：console 构造 genesis（§2.1）+ 市场 register 同笔。
- **v0.4 · A′ 下的 T3/T4 接口**：T4 市场创世 tx 必须同时花 R（`bind`，`market_out_idx` 指向本笔市场输出）——即 R 先于市场一笔创世（tx1），市场创世 = tx2；relay 需要 `populateGenesisCovenants` 同源算法算市场输出 cov id 供 console 写 R 的 `newState`（脚本核 `== OpOutputCovenantId`，喂错即拒）。每笔下注/派彩 tx：R 作输入 `passthrough` + 市场输入 + 代币输入。
- **v0.5 · A″ 下的 T2/T3 硬约束（定稿）**："per-instance 值只能进状态、只做等值比较或作运行期参数"——市场：`token_tmpl_hash`(byte[32]) + `token_prefix_len/suffix_len`(int) / `claim_tmpl_hash` / oracle 公钥（固定个数的 `byte[32]` 字段，**不能** `byte[]`——validateOutputState 不支持）/ 问题 hash / 截止（int）；领取：`winner_pk`（byte[32]，H4 从 ctor 改状态）/ `market_cov_id`（由市场入口写 `OpInputCovenantId(this.activeInputIndex)`）/ `amount`。市场 ctor 只留状态初值 + 结构常量（`max_ins/max_outs`）。**A′ 时代的"T4 市场创世同笔花 R"整段作废**：市场创世 = 普通 genesis（状态初值由 console 填，含代币模板 hash 三参与领取模板 hash）；每笔下注/派彩 tx = 市场输入 + 代币输入（+ 领取输出），无 R。T3 现无稿，此约束零成本进；bshard 家族 `ShardLeaf` 烤市场 id 进 ctor 的习惯**不能**带进 T3。
- **T2/T3 输入清单补（v0.3 · Bettor ③）**：市场**取消/退款**流（`bettor_refund_available` 124 事件、`RefundClaim` 路）里代币要回到谁手里——退款目的地也是 covenant（领取模板或"退款领取"模板），其模板归属必须进 (b) 允许集（A′ 的 R 状态或 C 的市场入口核）；否则退款 = 代币被销毁在市场里。不阻塞 T1，列 T2/T3 前置。

## 6. 请 NWT 判

1. **Q1 mint = genesis 无入口**是否符合 Owner 裁定 4 与 KCC-0020（规范对 minting 沉默）；它意味着"无效 genesis 自毁"不算漏洞。
2. **Q2 (b) 二选一路由**（b-in sigScript 尾 / b-out validateOutputStateWithTemplate）能否覆盖全部合法流：下注（市场在场）、派彩（领取新建）、领取→再下注（市场在场）；有没有第四种合法流被误拒。
3. **Q3 借用路径**：`require(witness.length == 0)` 是否足够拒绝 KCC-0020 §5 borrowed receive，还是要显式核 `witness[0] != 0x01`。
4. ~~**Q4 模板 hash 不含 ctor 值**这一假设（§4 不成环的前提）。~~ v0.3 实证推翻 → v0.4 A′ 裁定 + P10/P11 收口。
6. ~~**Q6（v0.4 新 · 结构性）A′ 的洞**……~~ **v0.5 关闭**（NWT 29959d41 / Bettor 1044）：洞成立（精确表述 §4.2），**A″ 采纳，D 后备，A′/R 排除**。
7. **Q7（v0.5 新）领取 `winner_pk` 的类型**：状态字段用 `byte[32]`（x-only）还是 `pubkey`/`byte[33]`——花费入口 `checkSig` 需要什么形，决定 T2 稿；P12 用 `byte[32]` 只证模板稳定性，未证签名路。
8. **Q8（v0.5 新）市场结构常量清单**：A″ 要求市场 ctor 里只剩**跨市场不变**的常量（oracle 个数、`max_ins/max_outs`、费率上限？）——费率若按市场不同 ⇒ 必须进状态；请 T3 稿开工前 NWT 先列一遍"哪些值会按市场变"。
5. **Q5 `pause_guard` 内联**：测试构建 `return` 早退是否会被 codegen 折叠成空函数，影响 P2 记录。

## 7. 没核到的

- ~~未试编~~ v0.2：P9 探针已证 §2.2 形能编能跑（见 Status）；**(b-out) 运行期未证**（要在 test.json 里给出 genesis 输出的正确 cov id = `hash(授权输入 outpoint, 有序输出)`，探针没算；T1 实现阶段用 relay 的 `populateGenesisCovenants` 同源算法补一条向量）。
- P9 的 (b) 路由用 `int[] recv_idx`（≥0 = b-in 输入索引；<0 = b-out 输出索引取负减一）替代 §2.2 的"new_claims 空态判路由"——更机械，建议 v0.3 正式采用。
- `OpCovInputCount(owner) > 0` 与 `OpInputCovenantId(witness_idx) == owner` 两形取后者（显式索引，P2 已编过），是否有 gas/字节差未量。
- 领取模板（T2）尚无稿，`claim_tmpl_*` 三参先按占位。
- **v0.4 未核**：P10/P11 只到编译级；R 的 `bind` 在 debugger 里跑一条"`market_cov_id` 喂错 ⇒ fail"向量要先算同笔创世 cov id（同 (b-out) 那条待办，一并留 T1 实现阶段）。
- **v0.4 未核**：`validateOutputStateWithInputTemplate` 的 `expectedTemplateHash` 参数是否也接受运行期状态值——P11 只试了 `readInputStateWithTemplate` 与 `validateOutputStateWithTemplate` 两个；按 TUTORIAL 三者签名同型，落 A″ 前补一条 P12 对照编译。
- ~~**v0.4 未核**："创世不跑脚本"……请 NWT 从 `7b1e18cc` 的 covenant 验证代码正面确认一次。~~ **v0.5 已核**（NWT 29959d41，精确表述 §4.2）。
- **v0.5 未核**：P12 `settle_token`（H5 用状态里的代币模板三参核代币输出）只到编译级，运行期向量留 T3（要给代币输入喂 sigScript 模板字节）。
- **v0.5 未核**：A″ 下市场创世由 console 填状态初值（代币模板 hash 三参、领取模板 hash）——填错 = 该市场永远收不到/派不出币（自毁，非漏洞），但要有 T4 侧的"创世前对照编译产物"检查；未设计。
