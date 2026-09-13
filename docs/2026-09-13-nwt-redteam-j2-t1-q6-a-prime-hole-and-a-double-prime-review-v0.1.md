# NWT 红队 · T1 v0.4 Q6——从 7b1e18cc 源码正面核实"创世不验状态"、判 A″ 采纳

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only，只读读了 `/d/rusty-kaspa` 在 `7b1e18cc` 处的 consensus/txscript 源码，未编译未改动）
> 审对象：T1 v0.4 §4/§6 Q6（`0f49a912`）。方法：`git show 7b1e18cc:<path>` 逐行读，未 checkout、未碰 live 树。

## 结论：**双 R 攻击成立，前提已从源码正面确认**；**采纳 A″，拒绝 D 作为主方案**（D 保留为纯后备）

## 一、从源码正面确认 J2 的前提——分两层，比 J2 原话更精确一层

我读了两处代码，`consensus/core/src/tx.rs:321 populate_genesis_covenants`（交易**构造**helper，客户端调）与 `crypto/txscript/src/covenants.rs:from_tx`（**consensus 验证**层，节点验区块时真的会跑这个）。结论要拆成两句话，J2 的原话把它们合成了一句，我把它拆开：

1. **covenant_id 本身：consensus 会验、不能伪造**。`covenants.rs` 明确有一段"Validate genesis covenant ids by recomputing the id … `if expected_id != covenant_id { return Err(WrongGenesisCovenantId) }`"——**这条是真的共识规则，会跑，不是只在客户端**。攻击者不能把自己的 R′ 的 covenant_id 设成跟别人的一样，或设成任何随便编的值——它必须诚实等于 `hash(自己那笔 tx 的授权输入 outpoint, 自己声明的那组输出)`。
2. **但输出的"状态内容"（`bound`/`market_cov_id`/`market_tmpl_hash` 这些字段的具体字节，编码在 R 的 P2SH redeem/state 里）——完全不在上面这条检查范围内**。`covenants.rs` 那段检查读的是 `output.covenant`（一个独立的 `{covenant_id, authorizing_input}` 结构），根本不碰 `output.script_public_key`（R 的 redeem 脚本、state 编码就在这里）；`tx.rs` 的 `populate_genesis_covenants` 同样只算哈希、不读脚本内容。而且 `from_tx` 函数自己的文档注释写得很直白："**Genesis outputs are validated but do not populate covenant contexts**"——即使 genesis 这一步会验 covenant_id 的哈希对不对，它**明确不**把这个输出纳入任何"这是不是一个真的、被正确初始化的 R"式的语义校验；那类校验只存在于**R 自己的合约逻辑**里，而合约逻辑只在**被花费**（作为未来某笔 tx 的输入）时才执行。

**精确结论**：J2 说"任何人能用 R 模板铸状态任意的 R′"——**成立**，但成立的原因准确说是"covenant_id 造不了假，但 covenant_id 只是个身份标签，状态内容才是攻击载荷，而状态内容从头到尾没有任何共识层或脚本层的检查"，不是"整个创世机制完全不设防"。这个精度差不影响 J2 §4 的攻击构造（攻击本身就没打算伪造 covenant_id，R′ 拿自己诚实算出来的新 covenant_id 完全够用），但**这一点对 T1 落码后写 provenance 存档时的措辞很重要**：不要写成"创世无任何验证"，要写成"创世验证覆盖 covenant_id 身份，不覆盖状态内容合法性"，否则以后有人以为 covenant_id 也能伪造，会往错误的方向去堵这个洞。

**双 R 攻击结论：成立**，J2 §4 的攻击构造（真 R passthrough + R′ 自填状态 + 真市场同笔在场，代币按 R′ 的 `market_tmpl_hash` 放行到攻击者模板）在这个前提下是可执行的，不是假设性担忧。

## 二、A″ vs D——采纳 A″，D 降级为纯后备（不作主方案）

**A″（把 R 的状态并回市场/领取本体）关闭了这个洞的根本原因**：它不再有一个"任何人可以自由创世、自由填状态"的**独立**对象来充当"背书者"——`market_cov_id` 这类值现在由**市场自己的、已经被 gating（oracle/committee 签名等）保护的花费入口**在创建领取 covenant 时用 `OpInputCovenantId(this.activeInputIndex)` 写入自己的身份。攻击者当然还是能造一个"市场模板铸的、状态自填的 market′"（这跟 R′ 是同一类"创世自由"），**但 market′ 本身要走真实的 T3 市场逻辑**（下注/结算/委员签名门禁）才能产生任何有意义的领取——攻击者造 market′ 得到的只是"一个他自己能设置 oracle 的、他自己的市场"，不是"一把能让代币流向他自己钱包的万能钥匙"。这跟 R′ 的性质完全不同：**R′ 不需要走任何业务逻辑就能生成一份可信凭证；market′ 除了"自己开一个新市场"这个本来就允许的动作之外，什么都做不到。**

**J2 自己诚实记录的"可再造面"（market′ 本身可以自由创世）是这类开放模板系统固有的、可接受的性质**——这跟 Owner 裁定"免费无限 mint"是同一类设计哲学：**允许创建，不允许伪造已存在实例的身份**。我核实过没有更进一步的攻击路径（比如 market′ 能不能冒充成"看起来跟某个真实市场是同一个"——不能，因为 covenant_id 是诚实派生的，market′ 有它自己独一无二的 covenant_id，不会与任何真实市场的 covenant_id 混淆）。

**拒绝把 D 当主方案的理由**：D 本身机制上没问题（签名验证是成熟原语），但它把"哪些模板合法"这件事的最终裁决权从"链上结构+已有的市场业务门禁"整个搬到"一把链下私钥"——这跟这一整套系统"结构性强制、不依赖单点信任"的设计取向（跟 Owner 反复强调的免费/无需许可/结构自证一致）方向相反,且 A″ 已经证明可行、不需要额外信任假设、复杂度还更低（少一个 covenant、少一个输入）。**D 保留作为唯一的后备**——如果实现阶段发现 A″ 对 T3 的约束（"per-instance 值只能进状态"）在某个具体场景下实在做不到，才退回 D，不是现在就两案并行。

## 三、给 Bettor/J2 的处置建议

1. **T1 落码方向 = A″，不是 A′**：J2 §4 已经把 A″ 的形状写清楚了（领取不烤任何 hash，市场烤领取 hash + 代币模板 hash 走状态字段，代币烤市场+领取两个稳定 hash），直接照这个形状写，不需要再造 `KanetMarketRegistry.sil` 这个 R 合约——A′ 草案与 P10 探针可以存档作"排除过的方案"记录,不必再往下推进。
2. **落码前仍要做的（J2 自己列的"未核"，我核实后确认都是真需要，不是走个形式）**：
   - P12：`validateOutputStateWithInputTemplate` 的 `expectedTemplateHash` 参数是否也接受运行期状态值——跟 P11 是同一类必要性验证，A″ 的 H5 检查（市场核代币输出）直接依赖这个原语行为，不能假设"跟另外两个原语一样"就跳过验证。
   - `bind`/写入 `market_cov_id` 那一步的运行期向量（"喂错 cov id ⇒ fail"）——虽然 A″ 不再需要 R 的 `bind` 入口了，但**市场创建领取时写自己 covenant-id 那一步的等价向量仍然需要**，这是 A″ 版本的核心安全断言，不能因为不再叫"R"了就漏掉验证。
3. Q1/Q2/Q3/Q5（mint=genesis / (b)路由 / witness borrowed-receive / pause_guard 折叠）在此前的审查轮次已经 PASS，A″ 的调整不影响这几条的结论，不需要重审。

## 给 J2 的一句更正建议（措辞，非结构）

批 T / T1 系列文档里引用"创世不执行输出脚本"这条时，请统一按本审 §一的精确版本写（covenant_id 身份受检、状态内容不受检），不要简化成"创世完全不验证"——这条区分在未来任何人想"回头看这个洞是怎么关的"时，决定他会不会走错方向去尝试堵"伪造 covenant_id"这个其实早就被挡住的假问题。
