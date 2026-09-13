# NWT 红队 · T1 KanetTestToken（KTT）合约设计审

> **Status**: FINAL v0.1（2026-09-13 · NWT）
> 审对象：`docs/2026-09-13-j2-t1-kanet-test-token-kcc20-contract-design-v0.1.md`（`5dd1231c`）。P9 可行性探针（Bettor 批，频道 11:52Z）已确认 `transfer` 形 v1.0.0 能编能跑，正好用于校验本审的几个假设。

## 结论：PASS-with-MUST，核心机制（Q1/Q2）站得住，但发现一处 T1 自己没提到的 C1 交互，且 Q3 的表述需要收紧

## Q2（最要紧）：(b) 二选一路由是否漏合法流——没找到第四种被误拒的合法流，但发现退款流的归属未定，需在 T2/T3 落稿前钉死

我沿着三条已命名的流逐一走了一遍：
- **下注**（bettor 持币想转给市场）：市场 covenant 作为本 tx 输入 ⇒ (b-in) sigScript 尾部核，走得通。
- **派彩**（市场结算，钱要进赢家的领取 covenant）：领取 covenant 是本 tx 新建输出 ⇒ (b-out) `validateOutputStateWithTemplate`，走得通。
- **领取→再下注**（赢家想拿旧奖金去下新注）：这本质上还是"下注"——领取 covenant 被花费、代币转给（新）市场 covenant，市场仍然是本 tx 的输入 ⇒ 还是 (b-in)，同一机制，不是第四种。

**我没找到被误拒的第四种合法流**。但我发现一个**没被命名、且不属于这两条路由任何一条的流**：**市场取消退款**。旧 KAS 模型下 `PoolShard_fold.refund_draw` 是直接付 P2PK 给 bettor 本人（`ScriptPubKeyP2PK`）——**这条路在新代币模型下完全不成立**，因为 (a) 强制 `owner_scheme==0x04`（只许 covenant 持有），退款目标不可能是裸地址。退款要走哪条路：如果退款目标复用 T2 的领取 covenant 模板（把"退款"当成"另一种 claim"），那它落在 (b-out)，机制上没问题；但**T1 现在完全没提这件事**，T2 稿也还没写。这不是 T1 的缺陷（退款是 T3/T2 的业务逻辑，不该在代币合约里定），但**必须在 T2/T3 落稿前明确写清"退款=复用同一份 claim_tmpl_hash 还是需要第二个模板"**——如果需要第二个模板，T1 现在 §1 的 ctor 参数列（只有一份 `claim_tmpl_prefix/suffix/hash`）就要扩，晚发现比早发现贵。**MUST（记在 T2/T3 的输入清单里，不阻塞 T1 本身）**：T2 设计稿必须显式回答"退款是否复用 claim 模板"。

## Q4：模板 hash 不含 ctor 值——原则成立，但需要一次廉价的实证，别停在假设

这条假设（`template_hash` 只依赖 prefix/suffix 字节模式，不依赖 ctor 具体值，所以三方互烤不成环）在方向上是对的——这正是"模板匹配"这个机制存在的意义：`readInputStateWithTemplate`/`validateOutputStateWithTemplate` 要认的是"这是不是某种字节码结构的实例"，天然不能依赖那个实例自己的具体参数值（否则就是循环定义：要知道值才能算出用来验证值的哈希）。这与 H1 (b) 已经在用的"模板前缀烤成 ctor 参数"设计逻辑一致，也与 `kcc20-minter.sil` 范例的既有假设一致。

**但这仍然只是一个合理推断，不是已验证的事实**。**MUST（低成本，落码前必须做）**：拿**同一份** `.sil` 源码，喂**两组不同的 ctor 参数值**分别编译，对比两次产出的 `template_hash`/`prefix`/`suffix` 是否逐字节相同——这是一次编译两次的对照实验，不需要新写任何合约逻辑，成本极低（P9 探针已经证明能编能跑，加这一步就是多编一次）。在这一步做完之前，"三方互烤不成环"停留在"合理但未证实"，不应该当作已核实的设计前提往下走。

## Q1：mint = genesis 无入口

符合 Owner 裁定 4（任何人免费无限铸造）与 KCC-0020 规范对 minting 的沉默（我在早前红队评估 §1 已核过规范原文，此处结论一致）。"无效 genesis 自毁不算漏洞"这个框架成立——免费铸造的代价本来就该由铸造者自己承担，不构成对系统的威胁。**PASS**。

## Q3：`require(witness.length == 0)` 是否足够拒 borrowed receive

**够，但理由跟设计稿暗示的不完全一样，需要把措辞说清楚**。读了 §2.2 的实际代码：`transferPolicy`/`transfer_delegator` **根本没有实现** KCC-0020 §5 定义的 borrowed-receive 分支逻辑（没有任何 `if witness[0]==0x01 then...` 这样的代码路径）——`require(witness.length==0)` 起作用的原理不是"检查了 spec 定义的 0x01 选择字节并拒绝它"，是"这个合约的 witness 参数本来就没有被设计成承载任何选择器语义，任何非空值都被当成异常输入拒掉"。**效果上是够的**（没有代码路径可以被"借用接收"触发，因为借用接收的代码压根不存在），但**设计稿的注释/文档不应该让人以为这是在对照 spec 的字节选择器做判断**——建议落码时这条 `require` 的注释改成"本合约不支持 KCC-0020 §5 借用接收路径，`witness` 参数无使用场景，非空即拒"，不要写成"拒绝 0x01 借用接收选择器"这种暗示"读了字节判断值"的措辞，防止以后有人看着这行注释以为可以往 witness 里塞点别的东西试试。**PASS-with-note**，不阻塞。

## 新发现（T1 自己没提到）：`mint_issuer`/`clawback` 也会撞上 C1 规则，需要角色1

刚看到频道 P9 探针结果（11:52Z）：**`v1.0.0 编译器对 KanetTestToken 报了 C1 规则，命中在 `mint_issuer`/`clawback`**——这完全合理：`KanetTestToken` 合约里 `transfer` 声明了 `#[covenant(binding=cov, ...)]`，使这个合约本身也变成"leader 合约"，而 `mint_issuer`/`clawback`/`pause_guard` 三个稳定币骨架入口都是**手写 entry**（不是 cov 声明），跟批 T v0.5 里 FoldNode/PoolLeaf/PoolShard_fold 撞的是**同一条规则、同一个原因**。

**T1 设计稿 §2.3 完全没提到这件事**——它专注于"H2 编译期常量控制这三个入口的行为"，没有考虑到"这三个入口作为手写 entry，本身也需要显式声明跟 covenant 组的关系"。**MUST（落码前必须补，用 C1 角色1同款修法）**：`mint_issuer`/`clawback` 每个入口第一行加 `require(OpCovInputCount(OpInputCovenantId(this.activeInputIndex)) == 1)` + `#[covenant.allow(rule=manual_entrypoint_in_leader_contract)]`。`pause_guard` 是"被 transfer 内联调用"的普通函数（不是独立 entry），大概率不需要——但请 J2 落码前确认它是否真的不是一个独立 ABI 入口（如果编译器把它算作独立可调用入口而不是纯内联函数，同样需要处理）。

这条我之前判断"C1 角色1这条修法不管covenant-id是否共享都安全"——放在这里同样适用：不管 mint_issuer/clawback 会不会真的被跟 transfer 同 tx 花费的场景撞上，角色1都是免费的安全网，直接加，不必等更深的分析。

## 给 Bettor 的处置建议

- Q2 没找到第四种被误拒的合法流，(b) 二选一路由核心机制 PASS；退款流的模板归属问题记入 T2/T3 输入清单，不阻塞 T1。
- Q4 的"不成环"假设方向对但要求落码前先做一次两组 ctor 值对照编译的低成本验证，不能只停在推断。
- 新发现：`mint_issuer`/`clawback` 需要补 C1 角色1修法，这是 T1 落码前的 MUST，现稿完全没提，交 J2 补齐后我再看一眼这两处即可，不需要整稿重审。
