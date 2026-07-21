# NWT 红队 — PayoutShard 家族一致性门设计 v0.1(2026-07-18)

> **Status**: CURRENT
> **对象**: `docs/2026-07-18-payoutshard-family-coherence-gate-design.md`(e907d5a8, J1tn)
> **verdict**: **🟠 GREEN-with-MUST-FIX(1项, 热路径成本) — J1 自提四点逐条打, 三点通过一点需要补强**

## J1 自提四点逐条验证

**点①(§3.3c V2 anchor 自解回喂 ctor 位偏移漂移)——设计本身自带防护, 记录清楚但不阻塞**: 这条我第一反应对上了本项目自己的既有教训(memory `reference-hardcoded-sil-offset-staleness-live-derive-required`: 硬编码 .sil 字节 offset 会静默过期, 必须 live-derive+round-trip 自证)——但仔细推演这次的具体机制后, **风险方向跟那条教训不完全一样, 更轻**: 那条教训里 offset 错了会**直接产出一个静默错误的值**没人发现; 这里 `closeZkTmplAnchor` 就算 offset 漂移解出脏值, 紧接着的 §3.3(c) 本身就会用这个值重新编译并跟 stored G0 做 byte-exact 比对——**offset 漂移的必然后果是 recompile 产物跟 G0 对不上, coherence check 直接 FAIL, 不会静默放过**。也就是说这个函数天然是自校验的:漂移的失败模式是"错误地拒绝一个其实没问题的 covenant"(可用性代价), 不是"静默认可一个错误 covenant"(安全代价)——方向是对的。**建议**(非阻塞): 在代码注释里明确写下这条自校验论证(为什么固定 offset 在这里是安全的, 不是"图省事"), 给以后接手的人一个可以推翻/复核的依据, 而不是靠"看起来能跑"活下来。

**点②(backfill 探针误伤在途盘)——同意 J1 自己的判断, 但要求把"dry-run 报告"从建议升级成 DoD 硬性前置**: 这个顾虑成立且分量重——今天整个上午的危机就是"markets 静默卡住结算"造成的,如果 backfill 把某些结构不明的**在途**盘错判成 `'unknown'` 然后被 gate 拒绝花费, 相当于**制造一批新的今天上午同款危机**, 而且是这次"治本"操作自己引入的。**MUST-FIX**: §5 DoD 补一条硬性前置——**backfill 迁移落码前, 必须先对生产库跑一遍只读探针 dry-run, 产出完整报告(总行数/v1_committee 数/v2_zk 数/unknown 数, 并列出 unknown 里哪些行对应的市场当前 `protocol_status` 是活跃在途态), 人工过一遍这份报告确认没有活跃在途盘会被打成 unknown 才能真正跑 migration**。这不是"建议做", 是"不做就不能上线"的硬 gate。

**点③(§3.4 权威切换 blast radius, recompile vs splice 对现网 V1 盘 byte-equal 需要 live 抽验)——同意, 同样升级为硬性前置**: "理论上 V1 行两者本就相等"这句话本身就是今天全天反复出现又反复被打脸的那类表述(memory `feedback-retry-consistency-proves-determinism-not-correctness`)。**MUST-FIX**: §3.4 落码 DoD 必须包含"权威切换前, 对现网当前**所有处于 verifying/settling 状态**的 V1 盘(不是随机抽几个,是全量或至少覆盖所有活跃态), 跑 splice 结果 vs recompile 结果的 byte-exact 对照, 逐行记录, 全部一致才能真正切换默认权威", 不能只做几个样本就下"理论上相等"的结论。

**点④(不选 trigger 的取舍)——成立, 论证站得住**: 推演过"手工 SQL 绕过 API 直接改 zk_native"这条路径在新设计下的实际后果——因为 §3.1 把 `covenant_family` 设计成**只在铸造那一刻写入、此后不再从 `zk_native` 推导**, 手工翻转 `zk_native` 已经**不可能**再影响家族判定本身, 唯一还能造成的后果是"市场被路由到跟它实际铸造家族不匹配的结算管线", 而这个后果会在 §3.3 的 coherence check 那一步被结构性拦下(fail-closed 拒花费), 不会静默产生错误结果——最坏情况退化成"这个盘卡住需要人工介入"(今天 8pson 的原始症状), 不会退化成"资金算错/花错地址"。**不加 trigger 是合理的, 论证成立, 不需要额外补强。**

## 我自主发现的一点(MUST-FIX, J1 四点之外)

**§3.3 调用点①(`ensurePayoutShard`/`V2` 的 existing-row 早返回分支)会把这次新加的完整 coherence check(含 (c) recompile, 百毫秒级 silverc 子进程调用)变成一个真实的高频热路径, 不是设计稿描述的"非热路径"**。读了实际调用链坐实: `ensurePayoutShard`(pool-shard-register.mjs:318)是从 `registerBettorOnShard` 里调用的——这个函数**每笔下注都会调一次**(不是每个市场一次), 靠自己内部"如果 payout_shards 行已存在就早返回"这一段实现幂等。设计稿明确把新的 coherence check **正好加在这个"已存在, 早返回"分支上**——意味着**从这次改动落地之后, 市场铸造后的每一笔新增下注都会触发一次带 silverc 子进程编译的完整一致性校验**, 不是"只在结算生命周期点跑"这种低频场景(那描述准确对应的是调用点②)。

这个模式今天已经在这个项目里发生过一次(188s console 冻结全案: 一个"看起来无辜"的函数被发现调用频率远超预期, 累积成系统性卡顿)。对一个热门市场(比如今天记忆里提到过的 28mln 那种 154 个赢家的规模), 每笔下注多出百毫秒级的子进程 spawn 开销, 累积起来是有意义的延迟增量, 不是"non-hot-path"这句话能带过去的。

**MUST-FIX**: 调用点①不应该跑完整的 (a)(b)(c)(d) 四步——**(c) recompile byte-equality 这一步(唯一真正昂贵的一步)应该只保留在调用点②③(结算生命周期, 真正低频)**, 调用点①(每笔下注都会摸到)只需要跑便宜的 (a)(b)(d)(family 非 unknown + 结构探针 + 地址匹配, 都是内存/DB 操作, 无子进程 spawn), 昂贵的 recompile 校验放在真正动钱之前(结算/花费时)做才对得起"非热路径"这个前提假设——省下的成本不影响安全性, 因为真正"允许花钱"之前(调用点②③)仍然会做完整四步验证, 调用点①只是"确认这行存在且看起来没坏", 不是最后一道钱路闸门。

## 未打穿的部分
- §1 根因分析(三次同族事故对照表)读码扎实, 三行事故各自的机理描述跟我今天参与诊断 8pson 那次(以及查到的 cswib/close-transport 历史记录)吻合, 没有发现编造或引用错位。
- §2 不变式(PS-FAMILY)措辞精确("家族权威=铸造时刻事实, 禁止从可变字段推导"), 直接对应根因, 没有过度扩大范围或留模糊地带。
- §3.1/3.2 的设计(covenant_family 列+铸造点原子写+immutable 校验点)逻辑自洽, 覆盖点列举具体(bettor.js:1459/pool.js 三处), 不是空泛的"逐一核实"。
- §4(8pson 处置独立立卡, 走 Owner 批)边界划得对, 不在这份设计里夹带资金处置决定。

## Verdict

**GREEN-with-MUST-FIX(3项: backfill dry-run报告升级为硬性DoD前置 / §3.4权威切换全量活跃盘byte-equal核对升级为硬性DoD前置 / 调用点①拆分四步只跑便宜三步recompile留给结算时刻)**。核心不变式和整体架构方向站得住, 三项 MUST-FIX 都是"落码时必须带上"而非推翻设计, 修完直接可以进落码阶段, 不需要重新设计。

— NWT 2026-07-18
