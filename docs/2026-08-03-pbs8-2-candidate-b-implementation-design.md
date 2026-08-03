# PB-S8-2 候选 B 实现设计 v2 — handlePoolOracleTxSignReq 签名前跨市场替换+毛额守恒检查

**Status: DESIGN v2(可审 diff 粒度)— 待 NWT 红队,未落码。** 归 J2(settler/pipeline 域),Bettor 15:14 派工(#dddkaz①)。v1(commit `7a15bfc6`)方向审 GREEN-with-notes(`#ddnzvm`),但威胁模型 §3 被判"框架写窄了"——本版按裁定重写:RPC 失败不是"检查被绕过",是**状态转移操纵**(逼结算改道成退款)。缓存(v1 §4)从"性能优化"并入这次修正,是同一问题的另一面。流程照今天全部条目:先设计 → NWT 红队 → 落码。

## 0. 覆盖边界(按 Bettor 裁定的精确措辞,不许说满)

> **本设计覆盖:跨市场替换 + 毛额守恒。不覆盖:市场内胜方之间的再分配(可以被任意重分配,包括全给攻击者一个地址)。**

不写"payout 字节已绑定"——那个措辞只有候选 A(全量重算逐笔比对)落地后才能用。这条纪律与今天 PB-S8-1"只锁 winner 方向"的措辞纪律同源(Bettor 09:04/15:14 两次重申)。

## 1. 三个锚点(Bettor #d069uz④ 裁定的清单,逐条给出插入点)

插入位置:`handlePoolOracleTxSignReq`(`trade-protocol-filter.js`),PB-S8-1 的 byzantine winner 检查通过之后(现在的 L647 `if (myOutcome !== expectedOutcome) {...continue;}` 之后)、签名循环(L648 `for (let inputIdx...)`)之前——同一个插入点序列,继续往下叠一层检查,不是另开一个位置。

### 锚点①:spine outpoint 身份(不只地址)

```js
const firstInput = phase2TxObj?.inputs?.[0];
const expectedOutpoint = { transactionId: market.spine_lock_tx, index: 0 };
if (!firstInput?.previousOutpoint
    || firstInput.previousOutpoint.transactionId !== expectedOutpoint.transactionId
    || Number(firstInput.previousOutpoint.index) !== expectedOutpoint.index) {
  console.error(`[trade-filter:sign-req] PB-S8-2 拒签: tx_obj 第一个 input 的 outpoint(${firstInput?.previousOutpoint?.transactionId?.slice(0,12)}:${firstInput?.previousOutpoint?.index}) != 本市场当前 spine outpoint(${market.spine_lock_tx?.slice(0,12)}:0) — 疑似跨市场/陈旧 UTXO 替换 market=${market.id.slice(0,12)}`);
  continue;
}
```

字段来源已核实(不是假设):`tx_obj.inputs[i].previousOutpoint = { transactionId, index }`,逐字读自 `kasia-relay/src/relay.mjs:1132`(`prediction_settle_build_preimage` case,该 IPC 正是 `dispatchPhase2` 用来构造 `preimage.tx_obj` 的那条,见 `pool-market-settler.js:2196-2201`)。`market.spine_lock_tx` 是本地 `pool_markets` 列(建市场时写入,不依赖消息)。

**为什么这条挡"地址匹配挡不住的攻击"(Bettor 原话)**:地址匹配只能证明"花的是某个长得像这个市场 spine 的 P2SH",挡不住"拿这个市场自己一笔旧的/已花费的 UTXO,或者另一个共用同一 redeem script 的市场的 UTXO"构造 tx——这正是今天 predictions domain 里 `commingled_route_to_refund_regression` 守的 FINDING-2 同一攻击家族在签名端的镜像。**outpoint(txid+index)是唯一确定的那一笔**,地址只是类型。

### 锚点②:毛额守恒(链上查值,不靠本地聚合——这是跟候选 A 的关键区别)

**不用本地 `pool_bettor_sides` 求和**(那会重新继承 r402 的"本地数据可能不全"假阳性面,候选 A 才需要处理这个问题,B 刻意绕开)。改为**链上现查每个 input outpoint 的实际面值**,与 `phase2TxObj.outputs` 总额比较:

```js
// 现查每个 input outpoint 的链上真实面值。IPC 命令名+参数+返回形状已逐字核实(不是推断):
// kasia-relay/src/lib/commands.mjs:70 GET_ADDRESS_UTXOS='get_address_utxos', 参数{address:'string'}
// kasia-relay/src/relay.mjs:1209-1219 handler → getAddressUtxos()(p2sh.mjs:1516-1530)→
// 返回 { ok:true, utxos: [{ outpoint:{transactionId,index}, amount:'<sompi string>' }, ...] }。
// 2026-07-18 J1tn 已有先例调用方(kr5l4 consolidate DB-lag 自愈), 纯只读, 不签不广播不动钱, 复用不新造。
const utxoRes = await sendCommandAsync(market.maker_relay_id, {
  type: 'get_address_utxos', address: market.spine_p2sh,
}, undefined, 'internal').catch(() => null);
if (!utxoRes?.ok || !Array.isArray(utxoRes.utxos)) {
  console.warn(`[trade-filter:sign-req] PB-S8-2: 查不到 spine UTXO 集合(RPC 失败/超时), 暂不签, 待重试 market=${market.id.slice(0,12)}`);
  continue;
}
const spineUtxos = utxoRes.utxos;
const inputTotalSompi = (phase2TxObj.inputs || []).reduce((sum, inp) => {
  const match = spineUtxos.find(u =>
    u.outpoint.transactionId === inp.previousOutpoint?.transactionId
    && Number(u.outpoint.index) === Number(inp.previousOutpoint?.index));
  return match ? sum + BigInt(match.amount) : sum; // 查不到的 outpoint 贡献 0——宁可低估输入, 不可高估
}, 0n);
const inputsAllMatched = (phase2TxObj.inputs || []).every(inp =>
  spineUtxos.some(u => u.outpoint.transactionId === inp.previousOutpoint?.transactionId
    && Number(u.outpoint.index) === Number(inp.previousOutpoint?.index)));
const outputTotalSompi = (phase2TxObj.outputs || []).reduce((s, o) => s + BigInt(o.amountSompi || o.value || 0), 0n);
if (!inputsAllMatched || outputTotalSompi > inputTotalSompi) {
  console.error(`[trade-filter:sign-req] PB-S8-2 拒签: 毛额守恒失败 outputs=${outputTotalSompi} inputs(链上现查)=${inputTotalSompi} all_matched=${inputsAllMatched} market=${market.id.slice(0,12)}`);
  continue;
}
```

**这条检查对本地数据完整性零依赖**——它不问"这个市场一共有多少 bettor",只问"这笔 tx 声称要花的每一笔钱,链上真的有那么多吗",链上 UTXO 集合是客观事实,不受本地 ingest 进度影响。这正是它能绕开候选 A 那个假阳性面的原因(Bettor 09:04③ 指出的"用链上守恒把本地数据全不全变成可判定",本条走的是同一个精神但更直接——不需要先证明本地数据完整,直接查链上真值)。

**§1 修订记录**:本节初稿猜测了一个不存在的 IPC 名字(`get_utxos_by_address`),写完设计稿后自己去 `commands.mjs`/`relay.mjs`/`p2sh.mjs` 核实,发现真实命令是 `get_address_utxos`(2026-07-18 J1tn 已有先例调用方,纯只读原语,不需要新造)。现在的版本已按逐字核实结果改写,不再是推断。

### 锚点③:outputs 数量/形状上界

```js
// 协议级常量: 一个非-bshard 市场结构上限 ~64 参与方(bshard 阈值, market_shards 设计文档)
// + 固定几个 fee 输出(broker/oracle/maker fee, 数量与committeeMode/unanimous相关但有界)。
// 用宽松上界(不精确到"应该正好几个"), 只挡"塞几百个 dust output 稀释守恒检查"这类灌水。
const MAX_REASONABLE_OUTPUTS = 64 + 10; // 参与方上限 + fee/bond 输出留白, 具体数字需 NWT/Bettor 核
if ((phase2TxObj.outputs || []).length > MAX_REASONABLE_OUTPUTS) {
  console.error(`[trade-filter:sign-req] PB-S8-2 拒签: outputs 数量 ${phase2TxObj.outputs.length} 超出合理上界 ${MAX_REASONABLE_OUTPUTS} market=${market.id.slice(0,12)}`);
  continue;
}
```

**"64"这个数字的出处已核实**:`migrate.js:5037` 注释——"pool_markets row (独立 market_id + spine_p2sh) holding **≤~64** bettors and settling in ONE normal (non-chunked) settle TX"。**Bettor 15:22 裁定**:原文带"~" ⇒ 这个上界**只能当"灌水检测"用,不能当协议常量**——注释里必须写死"这是启发式,不是协议限制",超限的处理**不是拒签,是拒签+显式高噪告警**(因为超限最可能的触发原因是我们自己的阈值过期,不是攻击——静默拒签会把"我们的常量该更新了"这件事永远埋起来)。

```js
if ((phase2TxObj.outputs || []).length > MAX_REASONABLE_OUTPUTS) {
  // 高噪告警, 非普通 warn: 超限大概率是阈值本身过期(bshard 分片上限若被后续迁移改过, 这个
  // 常量没跟着更新), 不是攻击——按静默 continue 处理会把"该更新常量了"这件事永远埋起来。
  console.error(`[trade-filter:sign-req] 🔴 PB-S8-2 拒签+高噪: outputs 数量 ${phase2TxObj.outputs.length} 超出启发式上界 ${MAX_REASONABLE_OUTPUTS}(非协议常量, 见 migrate.js:5037 "~64" 注释)— 大概率是这个阈值过期需要更新, 也可能是灌水攻击, 两者都需要人看 market=${market.id.slice(0,12)}`);
  continue; // 仍是拒签(不签这笔), 但日志级别刻意拉高, 不是普通 continue 静默路径
}
```

仍需 NWT/Bettor 确认 `migrate.js:5037` 这条 2026 年更早的注释是否是当前唯一/最新的权威阈值(是否有后续迁移改过这个数字),这条"是不是最新"我没有逐版本追。

## 2. 三条检查的失败语义(v2 重写 §3 威胁模型后同步修订)

- 锚点①、③失败:`continue`(跳到下一个本地 oracle/下一次 sign_req 重试),不抛异常——同 PB-S8-1 的"暂不签待重试"精神。
- 锚点③超限:`continue` + 高噪告警(见上,不是普通 continue)。
- **锚点②的 RPC 查询失败:不再当成"普通暂不签"处理**——v1 把它和"找不到自己的投票记录"这类无害重试混为一谈,v2 按 §3 的重新框定拆开:RPC 失败导致的"暂不签"**必须可计数、且计数要有接收者**(同今天已立的"告警必须有接收者"纪律),不能像 v1 那样只留一行 `console.warn` 就算了事——见 §3 具体设计。

## 3. 🔴 威胁模型重写:RPC 失败不是"检查被绕过",是"结算被逼改道成退款"(v1 §3 框架错误,Bettor 15:22 裁定)

**v1 问的问题**:"攻击者能不能利用 RPC 查询失败绕过锚点②?" v1 的答案("只是延迟,除非能撑到 timeout 窗口耗尽")本身没错,但**问题本身问窄了**。

**正确的问法**:窗口耗尽会发生什么?

```
持续 RPC 失败(锚点②查不到链上 UTXO 面值)
  → 委员持续"暂不签待重试"(v1 语义)
  → 市场卡到 deadline 仍未 settle
  → 掉进现有的退款/quarantine 分支(handleRefunding 或类似路径)
  → 违反 Owner「只 settle 绝不 refund」铁律,同 3000 KAS 孤儿永久损失先例的失败形状
```

**⇒ 攻击者(或纯粹的 RPC 不稳定,不需要攻击者)不需要骗过任何检查——只需要让它持续验不了。这是状态转移操纵,不是认证绕过,防法完全不同。**

**"暂不签"的语义在 deadline 前后不同**:deadline 之前,"暂不签待重试"是安全的默认(下一次 tick 还有机会)。**过了 deadline,"暂不签"不再是被动的等待,它变成了一个主动的动作**——它就是"让这个市场滑进退款分支"的那个动作,即使没有人明确按下这个按钮。

**这不需要假设攻击者——今天真实发生过三次**:早上的 RPC 饱和事故(3 分钟内 3569 次失败,WASM 腐化,COORD-LEDGER 记录的今日第三次)已经证明这个栈的 RPC 可用性有直接反例。**本设计给签名放钱路径新增了一个对 RPC 可用性的依赖**——后果不是单个市场卡住,是 RPC 病发作的那段时间**全体委员的签名一起停摆**。

### 3.1 缓解方向(Bettor 建议方向,不是拍板,红队定)

**缓存**(v1 §4 的"性能优化"在这里升格为可用性设计的一部分):同一 market 的 spine UTXO 集合按 `(market_id, spine_outpoint)` 缓存——它在 settle 前结构上不该变;真的变了说明 spine 已经被花掉,那本身就该拒签(缓存失效即安全信号,不是"数据可能过期"那种需要担心的失效)。**缓存既降低对 RPC 的依赖频次,又不弱化检查本身**(检查的仍是链上真值,只是不用每次都现查)。

```js
// 缓存: 同一 market 的 spine outpoint 面值在 settle 前不该变——真变了(缓存 miss 后重查发现不同)
// 本身就是"spine 已被花"的安全信号, 不是过期数据问题。key = (market_id, spine_outpoint)。
const spineUtxoCache = new Map(); // 具体存储层(进程内 Map / 持久化)留给落码阶段, 语义先定
```

**无论缓存与否**,RPC 不可用导致的"暂不签"必须可计数、且计数要有接收者(实现细节留给落码,但设计上必须预留:这类事件要能被某个告警/巡检看到,不能只是一行本地 log,否则"全队停签"这种事故会在没人知道的情况下发生)。

**本设计明确不解决的一层(留给 Bettor/Owner,不是 J2 能单方面定的)**:当一个市场因为 RPC 持续不可用而卡在"验不了、不敢签"的状态,一路撑到 deadline——**这时候到底该怎么办**(强制进退款分支?延长 deadline?人工介入?)是一个**改变现有 deadline/退款语义的产品决策**,不是"加一层签名前检查"这个卡能单独扛住的。本设计只能做到:①不让这条新检查本身成为"逼进退款"的隐藏推手(靠缓存降低触发频率)②让"暂不签"事件可观测(靠计数+告警)。**真正的解法(deadline 逻辑要不要感知"我是不是因为验证依赖不可用才卡住的")没有在本设计里,列为独立的、更大的开放项。**

## 4. 不在本次范围(维持 09:04 裁定,重申不是遗漏)

- 候选 A(全量重算 payout 逐笔比对)独立立卡,不在本设计范围,§1 提到的"链上现查"手法虽然是 A 的假阳性解法的同源思路,但本设计不做 A 要求的完整参与者重建。
- 市场内部再分配(哪个赢家分到多少)不检查——§0 已经把这条写进覆盖边界声明,不重复。
- **deadline 语义是否需要感知"卡在验证依赖不可用"这件事**(§3.1 最后一段)——独立开放项,不在本卡范围内解决。

## 5. 请 NWT 红队的点

1. ~~锚点②的 IPC 命令名/参数形状~~——已核实(`get_address_utxos`,逐字读 `commands.mjs`/`relay.mjs`/`p2sh.mjs` 三处对齐),这条撤销。
2. **§3 的威胁模型重写是否说全了**——J2 按 Bettor 裁定重写,但"RPC 失败→state 被逼退款"这条链路的每一跳(handleRefunding 具体在哪个条件下真的会把一个"验证依赖不可用"的市场推进退款)没有逐行追过,只是按已知的 deadline→退款一般模式推的,请 NWT 逐行核实这条链路是否真如描述。
3. **缓存的具体失效策略**——§3.1 只给了方向(key=市场+spine outpoint,miss 即拒签),没有给出"缓存该在哪一层持久化/要不要跨 tick 存活/要不要有独立 TTL"这些实现细节,留给红队通过后的落码阶段还是现在就要定,请 NWT 判断。
4. **"暂不签"计数+告警的具体落点**——是复用今天刚修好的 `rpc-health-degradation-alert.mjs` 那条(冷却+episode 语义已经修好),还是需要一条新的、专门针对"committee 因验证依赖卡签名"的独立信号,这条我没有设计,列为开放项。
5. **锚点③的数字(64+10)出处**——`migrate.js:5037`,原文带"~",红队判断是否有更新版本。
