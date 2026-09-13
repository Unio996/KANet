# NWT 红队复核 · T4 骨架 v0.1（市场创世 console 侧）

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only）
> 审对象：`docs/2026-09-13-j2-t4-market-genesis-console-side-skeleton-v0.1.md` 提交 `0f2fc739`。
> 方法：不只读文档措辞,直接读 `bshard-payout-family-coherence.mjs`（`assertPayoutShardCoherence`/`probeStructuralSignature`）、`pool-shard-register.mjs`（`ensurePayoutShard`/`_checkCoherenceNonBlocking`）、`pool-bshard-artifacts.mjs` 源码;核实 `submit-intent.mjs`/`escrow-landed-gate.mjs`/`tx-landed-reconciler.mjs` 三个 T4 声称"复用"的文件在当前分支上是否真的存在。

## 结论：**方向 PASS,附两条需要在下一版讲清楚的缺口(一条依赖排期、一条 fail-closed 范围)**——都不是要推翻骨架,是要把骨架里默认成立的两处假设写明白

## 一、Bettor 点名的三题

### ① 对照检查是否真覆盖全部字段(含 `gateTmplHash` 等留 ctor 的值)——**覆盖,但靠的是另一条路径,文档没写清楚这条路径的存在,容易让人误读**

直接读 `assertPayoutShardCoherence` 源码：它有四步 (a)(b)(c)(d)。**T4 §2.1 的字段表对应的是步骤 (b)**（`probeStructuralSignature`——零子进程,纯字节 offset 解码状态区,只覆盖**状态字段**)。`gateTmplHash`/6 个模板 hash 这些**留 ctor**的值,不出现在 §2.1 表里,乍看像是漏了。

**但步骤 (c)**（recompile 全字节比对)与**步骤 (d)**（`p2sh(stored redeem)` 与链上地址比对)才是**真正覆盖 ctor 值的地方**：(c) 是把整份 `.sil` 源码 + 传入的 ctor/状态参数重新编译一次,与"即将/已经用的那份 redeem hex"做**逐字节**比较——ctor 烤的值(`gateTmplHash` 等)如果不对,编译产物的**前缀/后缀字节**会不一样,(c) 会直接不等报 FAIL;(d) 是对 (c) 产物再算一次 P2SH 地址,核对链上实际使用的地址——这两步加起来,任何一个字节(不管是状态区还是 ctor 区)填错,都会被抓到,**不需要单独给 `gateTmplHash` 配一行字段表**,因为它从来不是"console 每个市场要填的值"（它是固定烤进单源 `.sil` 文件的常量,全网只有一份,不存在"这个市场填错了"这个问题——会出问题的场景是"单源文件本身被改了/pinned 编译器变了",这正是 (c) 的 recompile 抓的东西)。

**裁决**：覆盖是完整的,**但请 T4 下一版把这条讲清楚**——现在的写法(§2 标题"覆盖面=A″全部状态字段",只谈状态字段)会让不知道 (c)/(d) 机制细节的人误以为 `gateTmplHash` 类留 ctor 的字段没人管。补一句："`gateTmplHash` 等 7 个留 ctor 的值不需要单独字段表,因为它们是全网唯一的编译期常量,不是逐市场填值——步骤 (c) 的整份重编译逐字节比对与步骤 (d) 的 P2SH 地址核对,天然覆盖它们,若单源 `.sil` 或 ctor 常量被意外改动,(c)/(d) 会直接报 FAIL"。

### ② `market_genesis` intent 是否走 (c) 同一套机制,不是另起一套——**方向对,但有一个排期缺口没写进文档：(c) 现在还没合入这条分支**

`git cat-file -e HEAD:kasia-console/src/lib/submit-intent.mjs` **不存在**（`services/escrow-landed-gate.mjs`、`services/tx-landed-reconciler.mjs` 同样不存在于 `bshard-m3-deploy` 当前 HEAD）——这三个文件**只在** `coord/j2-c-no-tx-landed` 这条尚未合入的分支上。往前翻记录：(c) 是我上一批复核过的钱路 patch,GREEN-with-整体完整,**"合入等 Owner 批"**（D-017 §3,钱路必须 Owner 批才能合)——它现在确实还没合。

T4 §1/§3.1 的措辞是"**现状已存在**"/"**复用,零改动**"——这句话对**逻辑设计**成立(T4 确实应该复用 (c) 的机制,不该另起一套,这个方向我批准),但对**当前这条分支的物理状态**不成立——T4 如果现在就在 `bshard-m3-deploy` 上开工写码,`import { ensureIntent } from '../lib/submit-intent.mjs'` 这一行会直接找不到文件。**这不是设计缺陷,是一个没写进文档的排期依赖**：T4 的实际落码,必须发生在 (c) 真正合入主分支**之后**(或者 T4 的开发分支本身是从含 (c) 的树分出去的,合并时按依赖顺序理),不能悬空写。**裁决 MUST 记档(不阻塞设计层裁决,阻塞的是落码顺序)**：请 Bettor 把"(c) 合入"列成 T4 落码前的硬前提,写进批次顺序,不要等 J2 写码时才发现 import 报错。

### ③ 填错自毁的告警是否 fail-closed——**创世前是,创世后"复用既有调用点"这句需要重新论证,不能直接照搬**

**创世前(§5 第①类)**：`assertPayoutShardCoherence` 在 `tier='full'` FAIL 时返回 `{ok:false,...}`,调用方按此决定"不广播"——这条链路我核实是**真 fail-closed**（NO TX 原则,PASS)。

**创世后(§5 第②类,"复用这个既有调用点")**：我读了 T4 点名要复用的 `_checkCoherenceNonBlocking`（`pool-shard-register.mjs:40-52`）——**这个函数从名字到实现都是明确的 non-blocking**：FAIL 时只写一条 `ps_coherence_gate_fail` 事件（`level:'warn'`),`existing`缓存值照常返回,**不 throw、不拦**。它自己的注释把这个设计动机写得很清楚：这是给**既有 bshard 家族的高频热路径**（每次读一个**已经创建好、正在运营**的市场)用的,误报代价是"拦死一整个正在运营的市场的下注"（liveness 重伤),而这个检查点的安全收益趋近于 0（真正的花钱/签名点走的是另一条 blocking 的 `tier='full'` 检查),**权衡之后才定为 non-blocking**,且文件里明确写了"升级到 blocking 需要 7 天观察期+零未归因事件"这个后续计划。

**T4 §5 第②类直接说"复用这个既有调用点",但没有重新论证这个权衡在新场景下是否还成立**——T4 的场景是"市场创世**之后**发现状态漂移",跟原函数设计时想的"每次读一个正常市场"不是同一件事,虽然两者最终共用同一个底层判据函数没有问题,但"漂移了要不要拦"这个策略选择不该被自动继承,应该被重新想一遍。**我把这权衡重新想了一遍,结论是:目前 non-blocking 的选择在 T4 场景下依然成立,但理由不一样,要单独写**——原函数的理由是"liveness 优先,反正真正花钱点还有 blocking 检查兜底";T4 场景下多一条理由更硬：**代币本身免费无限铸造(D-017),一个漂移市场的后果是"这个市场自毁"（收不到/派不出币),不是"资金被偷",风险本身就是有限的,不需要为了防一个无损后果去牺牲整个系统的可用性**。**裁决**：non-blocking 复用批准,**但请 T4 下一版把这条理由显式写出来**(不要只写"复用既有调用点",要写"复用是因为经过重新论证,新场景下的风险上限依然是自毁而非失窃,与原设计的权衡结论一致"),否则以后有人看这段代码,会以为"填错自毁"这条纪律在这里被悄悄放宽了警戒线,其实不是放宽,是同一条纪律在两个场景下恰好给出同一个答案——**但这需要写出来,不能靠读者自己推。**

## 二、J2 §6 三问

1. **`cmdType`/`cmdBuilder` 泛化 vs 单开 `genesisWithIntent`**：批准前者(泛化 `transferWithIntent`)。理由：单开一份复制骨架 = 两套 attempt/mempool/replay 逻辑并存,会重演这个项目已经吃过很多次的"两条相似路径迟早漂移"教训。**但这个小 patch 要单独走一轮 diff 审**（针对 (c) 已合入的文件,改动范围要小、精确、可独立验证),不要跟 T4 那一大批改动混一次提交里审——小改动配小审查,大批量的市场合约改法配大审查,两件事分开走,方便以后回溯任何一边出问题时能精确定位。
2. **7 个解码器工作量取舍**：批准 J2 的折中方案(先只覆盖 4 个代币锚字段,cheap tier 分期做),**但有一条不能延后**——`poolMerkleRoot`/`committee_hash` 这两个字段是我上一轮 Q8 裁决里点名的**信任根字段**(委员/oracle pool,不是一般运营参数),我当时的裁决是"搬状态则 T4 覆盖升 MUST"。**这两个必须在 cheap tier 第一批就做,不能跟 seal_count/min_bet/deadline 这类低风险字段一起延后**——如果延后,意味着这两个字段的漂移只能靠低频的 `tier='full'` 巡检抓到,而不是每次构造前都查,这跟我"信任根字段必须 T4 MUST 覆盖"这条裁决的精神不符(MUST 覆盖不该只覆盖到"迟早会被巡检抓到",应该覆盖到"构造前就查")。
3. **`market_landed_at` 落表位置**：批准延后到 T3/T5 定案,不影响本稿裁决。

## 三、给 Bettor 的处置建议

- **方向 PASS**,骨架的复用/新增分工判断是对的(不重新发明对照检查/genesis 流程/落链门这三件事,是正确的工程判断)。
- **两条需要下一版写清楚**（不阻塞方向裁决,阻塞落码前的文档完整性）：① ctor 值(`gateTmplHash` 等)靠 (c)/(d) 步骤覆盖这条机制要显式写出来,不能让读者自己猜;② 创世后 non-blocking 复用的理由要重新论证并写出来(结论不变,但理由要换成 T4 自己的)。
- **一条排期硬前提(记档,MUST)**：(c) 合入主分支是 T4 实际落码的前提,现在 `bshard-m3-deploy` 上不存在 `submit-intent.mjs` 等三个文件——请 Bettor 把这条列进批次顺序,别等写码时才撞见 import 报错。
- J2 三问：① `cmdType`/`cmdBuilder` 泛化批准,但要单独走一轮小 diff 审;②7 解码器折中方案批准,但 `poolMerkleRoot`/`committee_hash` 不能延后,必须进第一批 cheap tier;③落表位置延后批准。
