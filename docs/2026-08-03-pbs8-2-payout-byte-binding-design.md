# PB-S8-2 设计 — handlePoolOracleTxSignReq 签名前 payout 字节绑定

**Status: DESIGN — 待 NWT 红队,未落码。** 归 J2(settler/pipeline 域),Bettor #czopcr P1 派工(2026-08-03),Codex 定性:"live 放钱路径剩下的 authorization-to-bytes 绑定;winner 对但 payout 字节被改的请求今天仍能过 PB-S8-1"。流程照 r402/PB-S8-1/卡①:先设计 → NWT 红队 → 落码。

## 0. 缺口是什么(PB-S8-1 锁了什么、没锁什么,已在 NWT #cvind4 记账措辞里写清)

PB-S8-1(今天已落码部署)只做一件事:签名前反查自己当时投的票,跟 `msg.winner` 反推出的期望结果比对——**只锁 winner 方向一致性**。它完全不检查 `phase2_tx_obj`(即将被签名的那笔真实转账)里的**金额/地址**是否跟这个 winner 匹配的真实 payout 结构一致。

⇒ 攻击/故障形状:一条 sign_req 消息,`winner` 字段跟这个 oracle 自己投的票**完全吻合**(PB-S8-1 检查通过),但 `phase2_tx_obj.outputs` 里的具体金额/地址被替换成任意值(篡改/bug/跨市场替换)——**PB-S8-1 对此毫无防御**,委员会无条件在 `sign_input_for_settle` 上签这笔被改过字节的 tx。

## 1. 可用于本地重算的基础(已读码确认,不是假设)

`computePoolPayouts`(`pool-market-settler.js:1540-1660+`)是**纯函数**,输入:
```
participants: [{ stake, direction, isMaker }, ...]   ← 需要本地 pool_bettor_sides + maker 信息重建
winner, brokerFeePct, oracleBond, minerFee, unanimous, silentOracleIndex, committeeMode, oracleCount
```
零 DB 访问,给定同样输入必产出同样输出(BigInt 整数运算,记忆里 R1 承重墙"cross-node byte-identical"就是靠这条)。

**参数来源核实(逐个查,不是假设都能拿到本地值)**:
- `brokerFeePct`:`pool_markets.broker_fee_pct` 是**本地存储列**(`migrate.js:4034`),建市场时写入,不依赖消息——committee 成员能读到自己本地这张表,不用信 `msg`。
- `participants`(每个 bettor 的 stake/direction):来自本地 `pool_bettor_sides`——**这里有和 r402 §1 同款的可信度问题**:本地这张表如果 ingest 不完整,重算出的 payout 就是错的(不是"检测到攻击",是"我这边数据本来就缺"),必须显式区分这两种失败。
- `oracleBond`/`minerFee`/`oracleCount`/`committeeMode`:需要逐项核实是否已存在于 `pool_markets` 或 `pool_committee` 的本地列,还是目前只在 `dispatchPhase2` 内联计算、从未持久化——**这条我没有查完,列为设计阶段未决项,不是当作已确认**。

## 2. 提议方向(未定稿,两个候选,不替 NWT/Bettor 选)

**候选 A(全量重算比对)**:签名前,本地跑一遍 `computePoolPayouts()`(同参数来源上面列的),把结果跟 `phase2TxObj.outputs` 逐笔比对(participantIndex→amount),不一致拒签。
- 优点:真正堵住"winner 对但字节改了"这整类问题,不管改的是哪个 output。
- 代价:①工程量大(要重建完整 participants 列表+补全所有 fee/bond 参数来源,§1 未决项要先查完)②继承 r402 那个"本地数据可能本来就不全"的残余风险——一个 ingest 不完整的委员节点会对**正确**的 tx_obj 报"不一致"而拒签(假阳性,伤的是可用性不是安全性,但需要设计冲突时的处理:是拒签+报,还是允许信任本地数据不全时退化到只查 §3 的窄检查)。

**候选 B(窄绑定检查,不做全量重算)**:只核对几个不依赖完整 bettor 列表就能验的**结构性**锚点,不重算金额:
- `phase2TxObj` 花费的 UTXO(`spine_p2sh` 相关字段)== 本地 `market.spine_p2sh`(防跨市场替换,同今天 predictions domain 里 `commingled_route_to_refund_regression`/FINDING-2 那类攻击形状)。
- outputs 总和(σ outputs)不超过 σ inputs(基本守恒,不需要知道每个 bettor 具体是谁)。
- 若 `phase2TxObj` 携带某种**本地已经独立观察到的锚点**(比如 maker 地址、broker 地址,这些在 `pool_markets` 建市场时就已经落库,不依赖 bettor 完整名单),核对这些字段跟本地记录一致。
- 优点:工程量小,不继承 r402 的"本地数据不全→假阳性"问题(不依赖完整 bettor 列表)。
- 代价:**不堵单个 bettor 金额被篡改这类攻击**(只堵跨市场替换/总量level 异常)——覆盖面比候选 A 窄,是"止血"级别不是"根治"。

## 3. J2 的初步倾向(供 NWT/Bettor 参考,不是拍板)

倾向 **候选 B 先做,候选 A 登记为候选 A 的后续卡**——理由:
1. 候选 A 直接继承 r402 已经暴露过的"本地 pool_bettor_sides 可能不全"残余风险,而这次是在**签名放钱**这个更敏感的位置引入同样的假阳性面,需要单独想清楚"重算不一致时到底是拒签还是别的处理",这本身是一轮设计,不该和候选 B 那种结构性锚点检查混在一起一次性做完。
2. 候选 B 覆盖的"跨市场替换"类攻击,是今天 `commingled_route_to_refund_regression` 已经在护的**同一个攻击家族**(跨市场 spine 替换)在签名端的对应位置——先补这块,风险收益比更高,且不需要等 §1 那些未决的参数来源核实完。
3. **这条只是我的初步方向,不是设计定稿**——candidate A/B 的选择本身也可能不是二选一(候选 B 先落,候选 A 作为独立的下一张卡),这需要 NWT/Bettor 一起看。

## 4. 本设计的诚实边界(如实标,不是走过场)

- §1 参数来源(oracleBond/minerFee/oracleCount/committeeMode 是否已本地可得)**没有查完**,不装作已查完。
- 候选 A/B 都还没有具体的插入点代码草稿(不像 r402/PB-S8-1/卡①那样直接给可审的 diff)——这份文档是**方向设计**,细粒度实现设计要等候选定了之后再出第二版。
- 时间原因(Bettor 今日容量检查中,我已接了两张 P1,这是第二张,报的 ETA 是"今天内出设计稿"不是"今天内出完整实现"):这版故意停在方向层,把深度判断权交还给 NWT/Bettor,不为了赶自己报的 ETA 而假装查得比实际深。

## 5. 请 NWT/Bettor 裁的点

1. 候选 A vs B(或"B 先 A 后")这个排序对不对。
2. §1 未决的参数来源(oracleBond/minerFee/oracleCount/committeeMode 本地可得性)要不要我现在就去查完,还是候选定下来之后再查(如果选 B,这些参数很可能用不上)。
3. 候选 B 里"哪些锚点算结构性、不依赖完整 bettor 名单"这个清单,我列的三条(spine_p2sh/总和守恒/maker-broker 地址)是不是遗漏了什么关键的。
