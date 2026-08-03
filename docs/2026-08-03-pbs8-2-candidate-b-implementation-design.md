# PB-S8-2 候选 B 实现设计 — handlePoolOracleTxSignReq 签名前跨市场替换+毛额守恒检查

**Status: DESIGN(可审 diff 粒度)— 待 NWT 红队,未落码。** 归 J2(settler/pipeline 域),Bettor 15:14 派工(#dddkaz①,撤销班次收束后继续),延续 09:04 方向裁定(`#d069uz`,B 先 A 后)。流程照今天全部条目:先设计 → NWT 红队 → 落码。

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

**"64"这个数字的出处已核实**:`migrate.js:5037` 注释——"pool_markets row (独立 market_id + spine_p2sh) holding **≤~64** bettors and settling in ONE normal (non-chunked) settle TX"。注意原文本身带"~"(约等于,非精确硬编码常量)——所以 `MAX_REASONABLE_OUTPUTS` 这个宽松上界的设计意图(挡灌水,不精确卡数字)跟源头的"约"字精神一致,不是我编的松弛度。仍需 NWT/Bettor 确认这条 2026 年更早的注释是否是当前唯一/最新的权威阈值(是否有后续迁移改过这个数字),这条"是不是最新"我没有逐版本追。

## 2. 三条检查的失败语义(继承今天 PB-S8-1/r402 同一套纪律)

- 三条都是`continue`(跳到下一个本地 oracle/下一次 sign_req 重试),不是抛异常——同 PB-S8-1 的"暂不签待重试"精神。
- 锚点②的 RPC 查询失败(超时/relay 不可用)**不等于"检测到攻击"**,是"暂时无法验证",同样 `continue` 待重试,不误报。
- 三条检查目前设计为**顺序执行、任一失败即拒签**(不是"三条都失败才拒签")——这是保守方向,红队若认为过严(误伤真实市场),需要在红队阶段提出来。

## 3. 不在本次范围(维持 09:04 裁定,重申不是遗漏)

- 候选 A(全量重算 payout 逐笔比对)独立立卡,不在本设计范围,§1 提到的"链上现查"手法虽然是 A 的假阳性解法的同源思路,但本设计不做 A 要求的完整参与者重建。
- 市场内部再分配(哪个赢家分到多少)不检查——§0 已经把这条写进覆盖边界声明,不重复。

## 4. 请 NWT 红队的点

1. ~~锚点②的 IPC 命令名/参数形状~~——已核实(`get_address_utxos`,逐字读 `commands.mjs`/`relay.mjs`/`p2sh.mjs` 三处对齐),这条撤销。
2. **锚点③的数字(64+10)出处**——需要找到 bshard 分片阈值的权威文档确认这个数字现在还对,不对就要改。
3. **RPC 失败时的"暂不签待重试"是否会被利用**——如果攻击者能故意让 RPC 查询失败(比如让 relay 对特定请求超时),是否能借此绕过锚点②(让检查方"暂不签"而非"拒签",但这只是延迟不是绕过,因为下次 sign_req 重试还是会撞到——除非攻击者能持续让它失败到 timeout 窗口耗尽?这条我没有想透,标出来请 NWT 打。
4. **三条检查的顺序/性能**——锚点②要发一次 RPC(有延迟),放在锚点①(纯本地比较,零延迟)之后合理,但要不要在多个 oracle/多个 input 的循环里做缓存(避免同一个 market 的多次签名请求重复查 UTXO 集合),这是性能优化不是正确性问题,红队看要不要现在做还是留到落码时按需处理。
