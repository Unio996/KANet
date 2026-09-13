# T1/T2/T3 路由变更稿 v0.1 · 删 b-out、领取合约自证（退路①落地）

> **Status**: DRAFT-FOR-REVIEW v0.1（2026-09-13 · J2 · Bettor 裁决落地(ledger 1116)：V-T-6 根因 = silverc `binding=cov` 层
> 结构性无法对非本 covenant 输出做内省（`OpOutputCovenantId`/`validateOutputStateWithTemplate` 单独测都会失败，见
> `docs/provenance/2026-09-13-j2-t1-token-sil-implementation/KNOWN-GAP-V-T-6.v0.3.md`；协议层语义已用 7b1e18cc
> 源码 + kaspa-wasm 真实哈希函数双重确认无误）。走**退路①**：接收方证明责任从代币合约的 `binding=cov` 挪到
> 领取/市场侧的手写 `entry`（P12MarketA2 方向，已证可行）。本稿只定设计，不写 `.sil`；NWT 审后才排 T1 v0.6 实现
> 与 T2/T3 续做。）

## 0. 一句话

代币合约 `transfer` 的接收侧从"b-in（市场在场）/ b-out（新建领取输出）二选一"收窄为**只剩 b-in**——代币
**只能移动到本笔同时作为输入在场的 covenant**（market 模板核实身份）。原来 b-out 想解决的问题（"代币最终要
落进一个全新的领取 covenant"）改交给**领取/市场那一侧的手写 `entry`**（非 `binding=cov`，不受 V-T-6 那个
codegen 限制）去做：market 的派彩 entry 在同一笔里 `readInputStateWithTemplate` 读代币输入的真实 `amount`，
`validateOutputStateWithTemplate` 核自己新建的领取输出，并把自己的 `covenant_id` 写进领取状态（P12 已验证
可行的形）。代币合约自己的守恒式从 `sum_in == sum_out` 放宽为 `sum_in >= sum_out`——多出来的差额 = "被
market 授权烧掉、去向由 market 自己的 entry 独立核实"的那部分，不再要求代币合约自己去看那个它结构上看不了
的外部输出。

## 1. 代币合约 `transfer` 的 (b) 路由：删 b-out

### 1.1 现状（T1 v0.5 A″，待改）

```
if (recv_idx[j] >= 0) {
    require(ownerIsMarketInput(recv_idx[j], next_states[j].owner));   // b-in：市场在场
} else {
    int out_k = 0 - recv_idx[j] - 1;
    validateOutputStateWithTemplate(out_k, new_claims[j], claim_tmpl_prefix, claim_tmpl_suffix, claim_tmpl_hash);  // b-out：新建领取输出
    require(OpOutputCovenantId(out_k) == next_states[j].owner);
}
```
`recv_idx[j] < 0` 那支（b-out）连同它专用的 ctor 常量 `claim_tmpl_prefix`/`claim_tmpl_suffix`/`claim_tmpl_hash`、
`ClaimState` struct、`new_claims[]` 参数**整段删除**。

### 1.2 新形（v0.6 目标）

```
// (b) 只剩一条路：接收方必须是本笔同时在场的市场模板 covenant。
for (j, 0, next_states.length, max_outs) {
    require(ownerIsMarketInput(recv_idx[j], next_states[j].owner));   // recv_idx[j] 恒 >= 0，不再需要符号分支
}
require(sum_in >= sum_out);   // ★ 变更点：从 == 放宽为 >=（见 §1.3）
```
`recv_idx[j]` 从"可正可负的路由选择器"降级为"纯粹的 b-in 输入下标"（不再需要 `0-recv_idx[j]-1` 这套编码，
直接是 `tx.inputs` 的下标，语义更简单，`int[] recv_idx` 参数名可保留或改 `int[] owner_at_input_idx` 更贴切
——命名留 v0.2 展开时定）。

### 1.3 守恒式变更：`sum_in == sum_out` → `sum_in >= sum_out`（★ 本稿唯一的新安全不变量，NWT 请重点审）

删掉 b-out 后，代币合约自己**再也看不见**"多余的那部分钱去哪了"这件事——它只能证明"继续留在某个在场
市场名下的部分（`sum_out`）没有被凭空捏造/篡改"，证明不了"离开的部分（`sum_in - sum_out`）合法落地"。
这条证明责任**整体挪给 market 的手写 entry**（§2），代币合约这边**必须**做的是：不能让"离开的部分"绕开
market 的授权——这靠的**不是**代币合约自己再加一条检查，而是 H1(a) 本来就有的**在场约束**：

> 每个被花费的 `prev_states[i]` 都要求 `OpInputCovenantId(owner_input_idx[i]) == prev_states[i].owner`
> ——也就是说，**代币能被花费的唯一前提 = 它当前的 owner（market 的 covenant_id）必须作为输入出现在同一笔
> 交易里**。这条在 (b) 收窄后**一字不改**（H1(a) 不在本次变更范围）。

因此：任何一笔花费代币的交易，**market 本身必然是这笔交易的一个输入**（不然过不了 H1(a)）——`sum_in > sum_out`
的差额部分，只可能在 **market 自己的 entry 逻辑**里被决定去向（market 的 entry 是这笔交易里唯一"看得见
全局、能同时读代币输入状态又能写领取输出状态"的代码），而 market 自己的 entry（merkle 证明 + committee
attest + T3 §3.0 的 draw-down 不变量）本来就是这套系统里对"钱该给谁"唯一的权威裁决者。代币合约这边放宽
到 `>=` 不是"少检查一步"，是**把这一步的验证方从"代币合约自己去看一个它结构上看不到的输出"改成"依赖
market 的 entry 已经独立验证过"**——这正是退路①的核心：责任转移，不是责任消失。

**开放问题（留 NWT 裁）**：`sum_in >= sum_out` 本身**不能**单独防"market 恶意烧代币不给任何人"——但这不是
新洞：market 的 entry 本来就是唯一能授权花费的实体（H1(a) 锚死），market 要作恶（比如故意少付），旧的
KAS 域系统里 market 一样能作恶（`.value` weld 一样是 market 自己 require 的）；代币化不改变"market 的
entry 逻辑本身必须写对"这个前提，只是换了记账单位。§3 会重新过一遍"谁负责挡什么"，把这条边界写清楚。

## 2. "代币进入全新领取 covenant"：改为 market 的手写 entry 自证（P12 方向）

### 2.1 机制（以 tokenized `PayoutShard.claim` 为例）

一笔 claim 交易的输入输出结构（token 化后）：

```
tx.inputs  = [ PayoutShard(market) 实例, KanetTestToken 实例（本 pool 当前持有的代币）, (可能有 fee 输入) ]
tx.outputs = [ PayoutShard 续约(KAS dust，或按 §3.0 不变量在 remaining==0 时不留)，
               KanetTestToken 续约(remaining>0 时，owner 仍是本 market，b-in)，
               KanetTestToken(newly-genesis) 领取输出 ]
```

`PayoutShard.claim`（手写 `entry`，非 `binding=cov`——P12MarketA2 已验证这个组合可行）在自己的验证体里新增：

```
// ① 读本笔代币输入的真实状态(readInputStateWithTemplate 是已证安全的原语, P9/RootClaim.claim_draw 已用)
TokenState tk = readInputStateWithTemplate(tokenInIdx, token_prefix_len, token_suffix_len, token_tmpl_hash);
require(tk.owner == OpInputCovenantId(this.activeInputIndex));   // 代币确实认本 market 为 owner(对称于代币侧 H1(a))
require(tk.owner_scheme == 0x04); require(tk.borrow_scheme == 0x00);
require(payout <= tk.amount);
// ② 核领取输出(P12 已证可行的形; market 把自己的 cov_id 写进领取状态, 不是让领取合约自己猜)
validateOutputStateWithTemplate(claimOutIdx,
    ClaimState { market_cov_id: OpInputCovenantId(this.activeInputIndex), winner_pk: bettorPk, amount: payout, token_tmpl_hash: token_tmpl_hash },
    c_prefix, c_suffix, claim_tmpl_hash);
// ③ 若 remaining>0, 核代币续约(b-in, 走代币合约自己的 transferPolicy 校验, market 这边只需保证自己是 owner_input_idx 指向的那个输入——已经是①的前提)
```

领取输出的 `ClaimState` 里的 `market_cov_id` 字段（P12 已有），是**领取方之后花费这个领取输出时**用来验证
"这确实是某个真实 market 派发的"——即 H5（在场≠同意）的证明责任从"代币合约验证输出落点"整体挪到了**领取
covenant 自己未来被花费时，核对 `market_cov_id` 是否等于当时真实花费自己的那个 market 输入的 covenant_id**
（跟 P12MarketA2 的既有设计完全一致，不是本稿新发明）。

### 2.2 为什么这样绕过了 V-T-6 的坑

`PayoutShard.claim` 是手写 `entry`，不是 `#[covenant(binding=cov,...)]`——V-T-6 v0.3 定位到的 bug**只发生在
`binding=cov` 函数对"非本 covenant 输出"做内省**（`ProbeBoutCov.sil`/`Cov2`/`Cov3`/`Cov4` 四个探针逐层剥离
证实）。`entry` 函数完全不受影响——`ProbeBoutCombo.sil`/`ProbeBoutLoop.sil`（v0.2 探针，纯 `entry`）与
P12MarketA2.sil 本身（真实设计文件，`payout_claim` 是 `entry`）都已经证明"`entry` 里跑
`validateOutputStateWithTemplate` 核外部/全新输出"是好的。**代币合约的 `transferPolicy` 是唯一一个必须是
`binding=cov` 的地方**（框架自动收集同 covenant 的 `prev_states`/`next_states` 靠这个绑定），所以修法是"让
`binding=cov` 只做它能安全做的事(校验自己已知/在场的东西)，把'认领全新输出'这件事挪给不受此限制的手写
entry" —— 不是绕过 bug，是**避免踩进那个只在 `binding=cov` 里存在的坑**。

## 3. H1(b)/H5 责任重新划分 + 向量清单变更

### 3.1 责任重分表

| 判据 | 旧（T1 v0.5 A″） | 新（本稿） |
|---|---|---|
| H1(a) 花费侧 owner 在场 | 代币合约 `transferPolicy`（`binding=cov`） | **不变**——代币合约同一处 |
| H1(b) 接收侧证明("钱去哪了合法") | 代币合约 `transferPolicy` 二选一（b-in 在场 / b-out 输出核) | **拆两半**：b-in 部分仍在代币合约（`ownerIsMarketInput`不变）；"钱离开代币合约去了哪"这部分**挪到 market 的手写 entry**（§2.1 ①②） |
| H3 borrow_scheme/witness | 代币合约 `transferPolicy` | **不变** |
| H5（在场≠同意，NWT 4ac7a6e9 升 MUST） | 代币合约 b-out 分支间接覆盖(核实际落点=同意的证据) | **挪到两处**：① market 侧(§2.1①，market 必须真的读到 `tk.owner==自己`，不能只看在场不看意图) ② 领取 covenant 自己未来被花费时核 `market_cov_id`(P12 既有形，本稿不新增) |
| NWT §1 攻击（自建 trivial covenant 冒充领取输出） | 代币合约 b-out 分支的 `validateOutputStateWithTemplate`+`OpOutputCovenantId` 双重核（且这条路径正是 V-T-6 卡住的地方——防御逻辑本身没写错，是工具链跑不动） | **挪到 market 的手写 entry**：`validateOutputStateWithTemplate(claimOutIdx, ...)` 用 market 自己 ctor 烤的 `claim_tmpl_hash` 核对，自建假 covenant 的 P2SH 字节对不上真实模板 hash ⇒ 挡法本身**逻辑不变**，只是执行体从代币合约的 `binding=cov`（跑不动）换成 market 的 `entry`（P12 已证能跑），**防御强度不因搬家而减弱** |

### 3.2 向量清单变更（对齐 T1 doc §3 + T3 doc §3.0.1）

- **删除**：V-T-6（原"b-out 正向量"）、V-T-7（原"b-out 反向量"）——这两条测的是代币合约自己的 b-out 分支，
  该分支已删，向量对象不存在了。
- **新增（代币合约侧）**：
  - **V-T-6′（反）**："非市场接收方一律拒"——`next_states[j].owner` 指向任何不满足 `ownerIsMarketInput`
    的目标（无论是自建 trivial covenant 还是看起来像领取 covenant 的东西）一律 `recv_idx[j]` 找不到匹配
    在场输入 ⇒ fail。覆盖原 V-T-8（NWT §1 攻击）在新路由下依然成立（`ownerIsMarketInput` 本身没变过）。
  - **V-T-守恒-反**：`sum_in < sum_out`（凭空多出代币）⇒ fail（`>=` 放宽后这条**必须**单独立一条向量钉死，
    不能只靠原来的 `==` 隐含防住）。
  - **V-T-守恒-正**：`sum_in > sum_out`（部分离场去 market 的 entry 授权烧掉）⇒ pass，且必须搭配 §3.2 下面
    market 侧向量的 ⑤ 一起跑（单独测代币合约这一条**不能**证明烧的部分真的合法落地，只能证明代币合约自己
    没被绕过）。
- **新增（market/领取合约侧，P12MarketA2 方向的 tokenized `payout_claim` 一类 entry）**：
  - ① 正：`readInputStateWithTemplate` 读到的 `tk.amount`/`tk.owner` 与领取输出金额/`market_cov_id` 一致 ⇒ pass。
  - ② 反：`tk.owner != OpInputCovenantId(this.activeInputIndex)`（代币其实不认这个 market 当 owner，H1(a)
    对称位置在 market 侧的再验证）⇒ fail。
  - ③ 反：`payout > tk.amount`（超发/超付）⇒ fail。
  - ④ 反：领取输出 `script_hex` 对不上真实 `claim_tmpl_hash`（同 V-T-7 原逻辑，换执行体到 `entry`）⇒ fail。
  - ⑤ 正：`market_cov_id` 写入领取状态后，**领取 covenant 自己未来被花费时**核对该字段与实际花费自己的
    市场输入一致 ⇒ pass（这条要等 T2/T3 领取合约自己的花费 entry 落码才能实跑，本稿只记需求）。
  - ⑥ 反：领取状态 `market_cov_id` 被篡改成一个不相干的假市场 ⇒ 领取被那笔"假市场"花费时 fail（H5 新落点）。

## 4. 对 T2/T3 稿 §3 入口分类的影响

- **T3 doc(`2026-09-13-j2-t3-market-set-token-rewrite-design-v0.1.md`)§2 两个公共代码块**：`tokenOutOk`
  helper（原用于"每条共花入口调一次或多次"）与本稿 §1.2 的新形一致（本来就是 b-in 形，无需改）；`noTokenInput`
  helper（B 类不在场证明）不受影响。**§2 的"领取输出"代码块**（`validateOutputStateWithTemplate(claim_out,
  ClaimState{...}, ...)`）**已经是** market 侧手写 `entry` 里的代码（不是代币合约里的），本稿只是把这一点
  从"隐含"改成"显式钦定"——不需要改这段伪码本身，需要改的是**确认执行体归属**：这段代码永远只出现在
  market/领取一侧的 `entry`，**绝不出现在代币合约的 `binding=cov` 函数体内**（T3 doc 原文没有明确禁止后者，
  本稿补上这条边界）。
- **T3 doc §3 的 23 条入口分类（A15/B8）**：**分类本身不变**——A 类（会与代币共花）里"创建 KanetTokenClaim
  的入口"（`PayoutShard.claim`/`refund_claim`、`PayoutShardV2.refund_claim`、`RootClaim.claim_draw`、
  `CloseZkV2.escape_claim`/`claim`）本来就已经是手写 `entry`（T3 doc 里这些合约从来不是 `binding=cov`
  ——`binding=cov` 只存在于代币合约自己身上），**这些入口原本的改法描述（§3 逐条表格）不需要重写**，只是
  §2 的 `tokenOutOk`/领取输出 两个 helper 块之间的**边界现在写清楚了**：`tokenOutOk`（b-in 形）可以出现在
  代币合约或 market 侧都行（两边都是同一逻辑），**领取输出那段只能在 market 侧**。
- **T3 §3.0 的四处 draw-down MUST-FIX（本会话已在 `coord/j2-t3-market-sil` 起草，未提交，因 NWT 依赖暂停）**：
  **完全不受本稿影响**——那四处改的是"最后一笔清零时不留续约输出"这个分支逻辑，是 market 自己的 `entry`
  内部结构，跟代币合约的 (b) 路由变更是两件独立的事，可以照旧继续做（已起草的 diff 保留有效，等本稿 NWT
  过了、T1 v0.6 落码后，与四处 MUST-FIX 一起收口）。
- **T2 骨架方向**：T2 doc 的 Q1 裁决"(b) 领取合约自核代币输出"与本稿方向完全一致（这就是退路①，T2 早就
  是这个方向，V-T-6 只是 T1 落码时才发现"自核"具体怎么核会撞 `binding=cov` 的坑）——T2 骨架的裁决**不需要
  改**，只是等 T1 v0.6 把代币侧配合改完。

## 5. 未核到 / 留 NWT 裁

1. `sum_in >= sum_out` 这条放宽本身的攻击面（§1.3 开放问题）——是否需要额外的"烧掉的量必须严格等于某个
   可验证的领取输出总量"这类**跨输出求和**约束？（若需要，这类约束同样只能在 market 侧的手写 `entry` 里做，
   因为需要同时看代币输入状态 + 全部领取输出，代币合约自己看不到全局）。
2. `int[] recv_idx` 改名与参数精简（§1.2 提到）——留 v0.2 逐条展开时定，不影响本稿的机制结论。
3. 多个领取输出（一笔 tx 里同时结算多个 winner）时，market entry 需要遍历读多次 `readInputStateWithTemplate`
   还是一次读够——这是 T3 §3 逐条参数签名展开（T3 doc §7 已记"23 条入口的完整参数签名未逐条展开"）时才
   会撞到的细节，本稿不展开。
4. 本稿只覆盖"代币从 market 直接付给领取方"这一种 b-out 场景；`ShardLeaf_direct.convert_to_rootclose`
   （`owner = OpOutputCovenantId(rcOutIdx)`，代币从叶子片转去 RootClose，同样是"新建输出"形）**同样受
   V-T-6 影响，同样需要改成"RootClose 侧的手写 entry 自证"**——T3 doc §3 对应那一行的改法描述也要同步补
   这条边界（本稿已在 §4 提到"分类不变，只是边界写清楚"，这一条是具体例子之一，留 T3 v0.3 展开时逐条过）。
