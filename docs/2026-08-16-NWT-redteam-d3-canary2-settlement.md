# NWT 红队 verdict — D3 canary#2 settlement design(j34vb)

> **Status**: CURRENT
> **审对象**: `docs/2026-08-16-j2-canary2-d3-settlement-design.md`(Status CURRENT,§10 指名 NWT 攻两点:§5 第11个未加载 bettor 的行集完整性缺口 / §2 `side_lock_tx` 本地篡改面。明确排除已撤premise"两root钉死")
> **审者**: NWT · 2026-08-16 · 全程只读(一次 SELECT + 两个只读脚本跑 DB,零写库/零链上/零系统动作)

---

## 结论:两个目标都打穿了实质内容。①行集完整性——找到一个比文档提议的检查强得多的现成信号,j34vb 用它核过是干净的,但同时证明这条风险今晚不是假设,是 8 个盘正在发生的事实。②`side_lock_tx` 篡改面——文档"fail-loud 非静默 fork"的辩护依赖一个前提,而这个前提在本项目自己的记录里已经被证伪。

---

## 攻击①(主攻,§10 点名):第 11 个未加载 bettor——文档提议的交叉核对是【弱化版的循环验证】,而更强的信号就在同一代码库里

### 文档现状

§5 提议"`market_shards(id=1353).bettor_count = 10` 与加载到的行数 10 一致"作为**旁证**,并如实标注"这是旁证不是证明"。

### 🔴 实读发现:`bettor_count` 已被本仓自己判定为不可信,而判定它不可信的正是本仓自己的代码注释

`kasia-console/src/lib/shard-allocator.mjs:48-54`(`#fxcva`,2026-07-05,J2 记的一次公测事故):

> "容量门必须读 `current_leaf_state.count`(真实烤进链上 covenant 脚本的计数),**不能读 `bettor_count`(`pool_bettor_sides` 行数,曾观察到跟链上真实 state 脱钩 3 笔——`recordBettor()` DB 写入没跟上但 `register_append` TX 已经落链推进了链上 count)**。"

⇒ **D3 §5 提议的那个"旁证",是拿一个已经被本仓自己记录过会跟链脱钩的数字,去核另一个从同一张表数出来的数字。** 两者不是独立信号——`bettor_count` 与"加载到的行数"几乎是同一件事的两种问法(都源于 `pool_bettor_sides` 有多少行),同一个 `recordBettor()` 写入滞后的 bug 会让两者**同时**少算,而不会让它们互相拆穿。这正是在册族"独立佐证三假形"(同源验证即使逻辑不同也是空的)的一个新实例。

### ✅ 但更强的信号就在同一份代码里,而且是链锚的:`current_leaf_state.count`

同一段注释指名了权威值应该是什么。我核实了它对本仓不是一句空话:

**j34vb 实测(只读 SELECT,`market_shards WHERE id=1353`)**:
```
bettor_count          = 10
current_leaf_state    = {"local_yes":35000000000,"local_no":4500000000,"count":10,"pool_value":39500000000}
current_leaf_outpoint = 819cc10db15ed3dbbbb014293c11c090356ceefbe4fbc1027ed9da880db47cf5:0
```
⇒ `current_leaf_state.count = 10`,与加载到的 10 行**一致**。**这是比 §5 提议的检查强的证据**(理由见下),对 j34vb 是干净读数。

**🔴 但这条检查不是摆设——我跑了全库对照,证明它真的会发现问题(不是恒等式)**:
```
全库 1341 个带 current_leaf_state 的 shard 行,bettor_count vs leaf_state.count:
  匹配 1333 / 不匹配 8
不匹配的 8 个(全部方向一致:leaf.count > bettor_count,即本地漏行,不是多记):
  eqa7k: bettor_count=25  leaf.count=32   (缺 7 行)
  qswth: bettor_count=10  leaf.count=20   (缺 10 行)
  fxcva: bettor_count=29  leaf.count=32   (缺 3 行 —— 与 #fxcva 那条注释描述的"3笔脱钩"事故坐标吻合)
  28mln: bettor_count=25  leaf.count=32   (缺 7 行)
  aukqt: bettor_count=30  leaf.count=32   (缺 2 行)
  9jaty: bettor_count=4   leaf.count=19   (缺 15 行)
  9ez2u: bettor_count=1   leaf.count=7    (缺 6 行)
  85fit: bettor_count=28  leaf.count=32   (缺 4 行)
```

⇒ **这不是一个理论攻击面,是【8 个市场正在携带这个缺口】的现状**,其中最严重的一个(`9jaty`)本地只有 4 行、链上实际 19 行,漏了 15 个 bettor。⚠ **`fxcva` 与 `9jaty`/`9ez2u` 这几个 market_id 前缀,与本会话/在册记录里出现过的名字重叠**(`9jaty`/`9ez2u` 出现在路 C 退款九盘清单里,`fxcva` 是那条 `#fxcva` 事故注释本身的坐标来源)——**这不是巧合,是同一批历史事故盘还没被这套检查扫过一遍**。我没有去核这几个盘现在的结算/退款状态是否已经吸收了这个缺口,那超出本次审的范围,但**它们现在读数上就是"11 个未加载 bettor"问题的活样本,不是假设**。

### 判定

1. **对 j34vb 本身**:这条更强的检查通过,行集完整性的信心应当从"旁证,10对10"升级为"链锚信号,10对10,且此信号在本库已证明有 8/1341 的判别力"。**不构成 C1(ii) 已解决**——leaf state 本身仍是本地 DB 字段(见下"未验证的部分"),不是本次去 RPC 现读链上 covenant 字节;但它比 `bettor_count` 强,理由是写入路径不同(`current_leaf_state` 在 register_append 流程内联更新,`bettor_count`/行插入靠 `recordBettor()` 另一条路径,#fxcva 事故证明过两者会脱钩)。
2. **建议**:D3 §5 的"旁证"表述应换成"**hard gate:`current_leaf_state.count == 加载行数,不等 ⇒ fail-loud`**,不是可选的交叉核对——这与全文其余部分(betsRoot/refundRoot 不符即弃签)的纪律一致,§5 目前是全文唯一一处允许"知道会漂但只留作旁证"的地方。这条不需要新机制,`current_leaf_state` 已经在 `market_shards` 表上,只是没被 D3 的流程读。
3. **未验证的部分(如实标)**:`current_leaf_state` 本身是否可能在极端情况下也滞后于真实链态(例如它是否只在 register_append 流程内更新,而没有独立于本地写入路径之外的现读校验),我没有追到底——只追到它与 `bettor_count` 走不同的更新路径且历史上更贴近链态(#fxcva 事故 + 本次 8 盘现读一致方向)。**若要把它当成完全等价于"链上现读",需要有人核实它的更新路径是否曾经跳过 RPC 确认这一步直接乐观写入**——我没有追这一层,交 J2/域主。

---

## 攻击②(次攻,§10 点名):`side_lock_tx` 本地篡改面——"篡改会 fail-loud 不会静默 fork"的辩护,依赖一个在本项目自己记录里已被证伪的前提

### 文档的辩护(§2 末)

> "篡改会立刻使 betsRoot/refundRoot 重算与其他节点不一致 ⇒ 不是静默 fork,是 fail-loud 分歧。"

这个论证的机制是对的:D2(`bshard-close-enforce.mjs:607-625`)让**每个委员独立从自己的本地数据重算** betsRoot/refundRoot,与 driver 声称的值比对,不符即拒签。若某一方篡改了自己的 `side_lock_tx`,它算出的根会跟其余委员不同 ⇒ 那一方的签名请求会被**其余委员**拒,不会静默出错。

### 🔴 但这个论证隐含一个前提:委员之间是真独立的(不同机器/不同 DB)。这个前提今天不成立,而且这不是我今晚才发现的——本仓自己已经核实并记录过

`COORD-LEDGER (235)`(J1,2026-08-13,零落码观察+行号核):

> "**armed=真、enforce 齿=真,但 4-of-5 的分布式强度今天为零——收签传输从不出机,单机自签 quorum 是唯一工作模式非绕过风险。**"

`COORD-LEDGER (236)`(Bettor 采纳):

> "**'5 份独立验证'= 同机同 DB/RPC 跑 5 遍(冗余非多样)。**"

⇒ **今天签这份 close_attest 的"5 个委员",是同一台机器上跑的 5 个进程,读同一份 `console.db`。** 如果攻击者(或一个 bug)篡改的是**这台机器**的 `pool_bettor_sides.side_lock_tx`,那么**全部 5 个"独立重算"读到的都是同一份被篡改的数据**,会算出**同一个**(错误的)betsRoot/refundRoot——D2 的比对不会发现任何不一致,因为没有一份干净的副本可以拿来对照。**"fail-loud 分歧"这条防线,在今天的拓扑下,退化成"5 份完全相同的错误答案互相确认"。**

### 判定

1. **这不是 D3 独有的新洞**——这是本项目已经存在、已经被 J1/Bettor 明确记录、且 Bettor 已裁定"不修(ZK 结构性解,修=死路投)"的既有拓扑现实(本会话开头我审 precond3 时也踩到过同一个事实的另一面)。**D3 §2 的辩护语句没有说错任何新东西,但它省略了这个前提,读起来会让人以为"fail-loud 分歧"这条防线今天真的在挡东西。**
2. **建议措辞**(不要求改机制,只要求改这一句的准确度):把"篡改会立刻使…与其他节点不一致⇒fail-loud分歧"改成**"篡改会立刻使…与其他节点不一致⇒fail-loud分歧——这个防线的强度等于'节点独立性'今天的强度,而本仓已记录(COORD-LEDGER (235)(236))这个独立性目前结构性为零(单机5进程同DB)。这条防线是设计上该有的,不是今天实际生效的。"**
3. **不建议在 D3 里修**:这个缺口的正确修法是 Oracle Skill 权限边界冻结线(D-012 §6-1)已经在走的路(委员改签不含交易字节的域分隔 receipt,不是继续靠"独立重算比对"),Bettor 已裁定不单独打补丁。D3 不该也不必扛这个。

---

## 未做的事(如实标)

- 没有跑任何写操作、没有碰任何链上东西、没有验证 `current_leaf_state` 更新路径是否曾跳过链上确认(如上文所标)。
- 没有去查那 8 个 mismatch 盘(尤其 `9jaty`/`9ez2u`/`fxcva`)现在的结算/退款状态是否已经吸收了这个缺口——只确认了缺口本身在库里可读、方向一致、与 #fxcva 注释描述的事故坐标吻合。

## 交付

本文件 + COORD-LEDGER 回写。@J2:攻击①给了一个可以直接换掉 §5 那条"旁证"的更强 hard gate,不需要新机制;攻击②不要求 D3 改机制,只要求改一句措辞的准确度。两条都不阻塞 j34vb 结算(j34vb 本身在攻击① 的更强检查下依然干净),但都值得记进稿子,否则下一个读者会高估现在的防线强度。
