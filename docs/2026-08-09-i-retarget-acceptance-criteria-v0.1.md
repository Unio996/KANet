> **Status**: ACCEPTANCE CRITERIA v0.3.1 · NWT · design-only · 零改码/零部署
> **为什么写**: Bettor 14:15 派活("(i)/⑥ retarget 的 DoD = Codex 五条验收证据, NWT主"), 承 `docs/2026-08-09-i-proto-redteam.md`(我的原始红队) + Codex 独立复审(`coordination/codex-bridge/responses/...I-PROTO-SEMANTIC-REDTEAM-CODEX-REVIEW.md`) + 我自己对 H1 框架错误的更正。
> **这份文档不是实现** —— 是给将来实现 (i) retarget 的人(不论是谁)当验收靶子用的清单。实现前必须先走铁律0(报计划→审→批→做)。
> **v0.2**: Bettor 14:20 APPROVED v0.1 作 ⑥ retarget 验收基线, 加两条补全(见 §1⑤ 与新增 §1.5)。
> **v0.3**: Bettor 15:14 认 Codex RED——v0.2 的 §1⑤ conservation("全 output 总和==pot,含网络费 output")本身是错的: Kaspa 网络费是 `sum(inputs)−sum(outputs)` 的残差,不是一个 output;settle_aggregate 没有网络费输出。**v0.2 那句"定稿"作废,v0.3 才是基线**(§1⑤ 换成 Codex 给的正确公式,§1⑥ 与创建路径拒非法两条 Codex ACCEPTED,保留不变)。
> **v0.3.1**: Codex 复审 v0.3(16:13)ACCEPTED/CLOSED 了 conservation 公式,同时补一条防同义反复的精度(见 §1⑤ 末段)。**Codex 明示只闭合了 conservation 这一格** —— (i) retarget 其余项(settle 侧权威绑定/创建路径拒非法/编译 mutation/枚举器语义硬化/舍入溢出测/链上实据)仍全部 OPEN,待实现后独立验。

# (i) retarget 验收标准 —— Codex 五条 + NWT 一条框架更正

## §0 我自己欠的更正(先放在最前面,不是补充,是原稿的一处错)

我原稿(`2026-08-09-i-proto-redteam.md` §4-H1)把"在 `refund_maker_unjoined` 函数体内加 `require(marketMinFee<=marketMaxFee)` 等三条"当成了修复本身,判定"加即承诺"。这是**框架错,不是遗漏细节**:

- 那三条 `require` 只在**有人调用 `refund_maker_unjoined`** 时才执行(= 花费时)。
- 它们**完全不影响 covenant 能不能被创建、maker 能不能把真金存进去**——市场创建/P2SH 派生/注资是链下工具做的,不会去问 SS 里的 require 逻辑答不答应。
- ⇒ 非法区间的市场**照样能被建出来、照样能被注资**,直到某天无人下注、maker 想退款,才在花费时撞上一个"更清楚的报错"。**require() 加固的是失败信息的清晰度,不是资金安全本身。**
- 我当时问的是"这条防线够不够严",该问的是"这条防线挡在哪一步"——**同一族错误见 [[feedback-remove-the-dangerous-action-instead-of-strengthening-weak-control]]**:加固一个挡不住伤害的控制点,给出的是虚假的安全感。

**⇒ H1 的真正权威守卫点 = 市场创建路径(派生 P2SH / 注资之前),不是 covenant 内部。covenant 内的 require 仍该加,但作为纵深防御第二层,不是第一层。**

## §1 验收标准(Codex 五条,原文映射到可检查动作)

### ① 创建路径拒非法界 —— 证明"不产出可注资 artifact"
- **验什么**: 市场创建流程在派生 (i) 的 P2SH 地址**之前**,对 `marketMinFee/marketMaxFee`(以及 §2 补的三条:非负、`min<=makerStakeAmount-MIN_DUST_SOMPI`、maxFee 政策上限)做校验;任何一条不满足 ⇒ **拒绝创建,不产出任何地址/不接受任何注资**。
- **怎么证**: 阴性测试——喂一个非法元组(如 `min=100000000, max=50000`)进创建路径,断言:(a) 函数/流程返回错误而非地址;(b) 没有任何 DB 行/事件被写成"市场已创建";(c) 没有资金被要求或接受。
- **不满足的样子**: 创建路径吞掉非法值、仍派生出一个地址(哪怕之后花不出去)。

### ② 枚举器本体修 —— 权威分类脱离参数名
- **验什么**: `fee-authority-enumerate.mjs` 的 `feeFamily()`(或其继任者)不再靠参数名子串(`market`/`broker`/`oracle`)分类,改为按**它约束的量**(是否绑定 `pot*rate` 结构、还是绑定某个 output 的 haircut/deduction)分类。
- **怎么证**: 加 **rename-invariance 阴性对照**——把 `marketMinFee` 改名成 `minerFeeFloorPerMarket`(或任何不含 market/broker/oracle 子串但语义不变的名字),重跑枚举器,断言**判词不变**。若判词随改名翻转 ⇒ 枚举器仍是名字驱动,不合格。
- **在此之前**: 枚举器**不得**被当作 (i) 的正向验收 oracle(Codex MUST-FIX,我实核当前 blob `cf2b979663` 坐实这条还没修)。

### ③ settle 原型绑定正确的量
- **验什么**: retarget 后的 .sil 原型在 `settle_aggregate` 的 broker/oracle fee output(而不是 `refund_maker_unjoined` 的网络费 haircut)上,把 `tx.outputs[0].value`(或对应 oracle 输出)与 `brokerFeePct`/`oracleFeePct` 构成的量绑定。
- **怎么证**: 源码实读 + 枚举器(修好之后的版本)对该 require 判 `PER-MARKET(eq)`,且 `feeFamily` 判定不依赖参数名(见②)。

### ④ 编译/redeem mutation 证明政策费率承诺改变 redeem/地址
- **验什么**: 用 `fee-mutation-test.mjs`(在生产 pin 的 `silverc-legacy-2c46231.exe` 上)对新原型跑一遍——突变 `brokerFeePct`/`oracleFeePct` ⇒ redeem/地址**必须变**(证明真的被烤进 P2SH,不是声明了没用)。
- **怎么证**: 复用既有 mutation-test 工具,不新建;对照组(`market_id`/`minerFee` 等已知会变的参数)必须同批同时验证仍然正确,排除工具本身坏掉的可能。

### ⑤ 正 + 对抗 tx 测试
- **验什么**: 至少覆盖 —— 舍入(链上 floor 顺序 vs 链下 floor 顺序是否逐字节一致,§5 提过的"先除后乘"顺序问题)、零费市场(`brokerFeePct==0` 时 output 结构怎么处理,不能撞 dust 下限)、溢出安全(`pot*bps` 在 i64 下的安全乘除顺序)、output-index 正确性(不能被恶意委员改写成别的 index)、**总值守恒**(v0.3 修正,Codex RED 推翻了 v0.2 的公式——**Kaspa 网络费不是一个 output**,是 `sum(inputs)−sum(outputs)` 的残差;`settle_aggregate` 里 outputs[0]=broker/[1..5]=committee bond+fee/[6..]=winners,根本没有网络费输出,把它当 output 求和要么 false-reject 一笔正确 tx,要么逼实现者造一个假 fee 输出改变 tx 语义):
  - **守恒按真实 tx 值模型**:`sum(全部 inputs) == sum(全部 outputs) + 实际 network fee`(fee 建模成残差,不建模成 output)。
  - **政策分配单独证**,且 basis(全局 pot vs shard-local)必须显式:broker 政策额 = 承诺费率 × 承诺 basis 的确定函数;oracle 额(含拆分/舍入规则);winner = 剩余;**bond-return 本金不得被算成政策费或 winner pot**;network fee = 残差且满足其 bound。
  - **两个对抗用例**:① `sum(outputs)` 故意正确但声称的 fee basis 错;② 一个隐藏/额外 output 使 naive 的 broker+oracle+winners 和看着对、但破坏完整 input/output 守恒。
  - 🔴 **v0.3.1 补(Codex 16:13,防同义反复)**:`actual_network_fee` **必须从序列化后的真实 tx 机械导出**(真 `sum(inputs)−sum(outputs)`,再拿去对照意图的 fee bound 核),**绝不能是调用方传入/单独声称的标量**——否则 `inputs == outputs + claimed_fee` 这条断言的两边用的是同一个 `claimed_fee`,变成恒真或可被伪造,等于没有在验证守恒,只是在验证"我把同一个数抄了两遍"。
- **怎么证**: 每一条至少一个正向用例 + 一个对抗用例(蓄意构造边界值/恶意委员输入),不接受"设计上应该没问题"的口头论证。

### ⑥ (v0.2 新增,Bettor 补全②,承重) retarget 不能拆掉 refund 那条合法的网络费保护
- **验什么**: retarget 的目标是**在 `settle_aggregate` 新增政策费率权威**,不是删掉 `refund_maker_unjoined` 里那个合法的网络费 haircut——`marketMinFee/Max` 在退款处作网络费 bound 本身是**对**的(Codex 确认这是 qlfpv 防砖槽的正当用途),错的只是它被**冒充**成市场费率权威(§0 那条语义错位)。**修语义错位 ≠ 拆掉退款保护。**
- **怎么证**: retarget 后跑一次回归——`refund_maker_unjoined` 的网络费 haircut 逻辑(§4-H1/H2/H3 已验的那部分:range 夹住 stake 折扣、per-market 化、无重定向盗取面)**仍在、仍正确**,不因为新增了 settle 侧的政策费率约束而被连带改动或删除。同 [[feedback-verify-fix-does-not-reproduce-same-bug-elsewhere]] 的反面——修一处别碰坏邻居。

## §2 H1 的完整条件集(不止 min<=max)

Codex 指出条件不止一条,我核对后补全,供②/①的实现参考:
1. `marketMinFee >= 0`
2. `marketMaxFee >= marketMinFee`
3. `marketMinFee <= makerStakeAmount - MIN_DUST_SOMPI`(至少存在一个 dust-valid 的退款值,不能整个区间都低于 dust 下限)
4. `marketMaxFee` 需有政策上限(防止某个市场把折扣定到荒谬大,变相没收 maker 本金——原文的 MAX_FEE=1e8 是 v0.7 给的参考上限,retarget 时应保留同量级或更严的上限)

## §3 谁来实现 / 我的边界

这份文档只定验收标准,不含任何 .sil 改动或创建路径代码。按铁律0,实现前需要 Bettor/Owner 走报计划→审→批的流程。我(NWT)的角色维持红队/验收方,不主动写创建路径校验代码或改 .sil ——若被指派实现,会另外单独报备。
