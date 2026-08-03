# PB-S8 搬运设计 — handlePoolOracleTxSignReq 签名前拜占庭自检

**Status: DESIGN — 待 NWT 红队,未落码。** 归 J2(settler/pipeline 域,PB-S8 是 J2 判"搬运工作量非设计工作量"),Bettor 06:48 派工(`#cvbjqv.2`)。流程照 r402 那套:先设计(本文档,只读)→ NWT 红队 → D-012 终裁后才落码。

## 0. 为什么这条和 r402 同等级(Bettor 原话:"与 r402 同形状:授权≠前提")

`handlePoolOracleTxSignReq`(`trade-protocol-filter.js:538-665`)是 v0.5/v0.6 committee-sig 结算路径(**D-012 §二子集②,当前 live 主力,承载真人钱**)签名放钱前的最后一道关。逐字读完:

```
538  必填字段检查(market_id/winner/input_count/spine_input_count)
550  读 market + phase2_tx_obj(优先取 msg 自带,cross-node 场景消息可以自己带 tx_obj)
564  读 committee_pks(pool_committee 表)
574  找本机 is_oracle=1 的 relay
587  for each local oracle:
591    get_pubkey IPC 拿 voterPubkey
595    myIdx = committeePks.indexOf(voterPubkey)  ← 只查"我在不在委员名单里"
596    if (myIdx === -1) continue                  ← 【唯一的门槛检查,身份/成员检查】
597    if (silentIdx === myIdx) continue            ← forfeit_1 静默委员跳过(这个索引来自 msg 自带字段)
601    for each input: sign_input_for_settle IPC 签名 → 广播 sign_resp
```

**从头到尾,没有一步问过"我自己当时投的是不是这个 winner"。** `msg.winner`(0=YES赢/1=NO赢)、`msg.silent_oracle_index`、`phase2_tx_obj` 都可能是**消息自带值**(尤其 cross-node 场景,注释 L547-549 明确写"payload-supplied tx_obj (cross-node canonical)")——这台机器的委员会成员一旦确认"我在委员名单里",就无条件对消息喂来的任何 `phase2_tx_obj` 签名。这是**身份检查,不是前提检查**——和 r402 里 `msg.maker_pk` 内容比对那道门是同一个形状,只是这次挡在放钱签名而不是退款广播上。

**已知的、同项目里已经修过一次这个洞的先例**:`bettor-prediction-voter.js:1076-1124`(OTC 预测市场 voter 的 `handleTxSignReq`)里的 **PB-S8-1 byzantine 防**——签名前,先查自己当时实际投的票(`chain_events` `event_type='oracle_vote'`),跟这次要签的 `winner` 反推出的期望结果做比对,不一致就拒签。这套牙已经造好、已经在生产用了一段时间(OTC 域),只是没有被搬到 pool 委员会(v0.6/v0.7)这条同样在收真钱的路径上——**"teeth built, not armed" 又一例**,和 r402 里 PB-S8 造好但被 `isBshard` 挡在门外没装上是同一类缺口。

## 1. 原始 PB-S8-1 模式(逐字读 `bettor-prediction-voter.js:1076-1124`)

```js
// PB-S8-1 byzantine 防: verify own Phase 1 vote matches request winner
const winner = parseInt(meta.phase2_winner, 10);
// ...查自己当时投的票(chain_events, event_type='oracle_vote', from_address=自己地址, offer_id+revote_round match)
const myOutcome = JSON.parse(myVoteRow.payload).outcome;
const expectedOutcome = winner === 0 ? (offer.outcome_side === 'YES' ? 'YES' : 'NO') : (offer.outcome_side === 'YES' ? 'NO' : 'YES');
if (myOutcome !== expectedOutcome) {
  console.warn(`byzantine 防: own vote=${myOutcome} ≠ expected=${expectedOutcome}, refuse`);
  return { signed: false, skipped: false };
}
```

要点:
- 若本地找不到自己的投票记录,**不当"检查通过"处理,也不永久拒绝**——`{signed:false, skipped:false}`,`skipped:false` 表示"下一轮 tick 还会重试",不是判死刑(投票可能还没落地,给它追赶的机会,同 r402 冲突分支不静默丢弃的精神一致)。
- 比对对象是**自己数据库里已经存在的、这个节点自己曾经写下的投票记录**,不是消息自带值——verify-value-source 合格,checker 决策时读的是本地 binding 值。

## 2. pool 委员会路径里"自己的票"怎么查(已确认,复用既有查询,不新造)

`decideConsensusV06`(`pool-market-settler.js:1396-1418`)里已经有一模一样的查询模式,用来统计委员票数:

```js
const row = sqlite.prepare(`
  SELECT payload, observed_at FROM chain_events
  WHERE event_type = 'pool_oracle_vote'
    AND payload LIKE ?
    AND payload LIKE ?
  ORDER BY observed_at ASC LIMIT 1
`).get(`%"market_id":"${market.id}"%`, `%"voter_pubkey":"${voterPk}"%`);
// payload.outcome ∈ {'YES','NO','ABSTAIN'}(r412 三态 enum,malformed 归 silent-equiv)
```

`decideConsensusV06` 用这条查询确认了 `winner: 0` ⇔ YES 方≥4 票赢,`winner: 1` ⇔ NO 方≥4 票赢(`pool-market-settler.js:1443-1478`,已读码核对)——`handlePoolOracleTxSignReq` 里的 `voterPubkey`(L593 已算出)可以直接拿去查这同一张表、同一个 `event_type`,**不用新造判据、不用猜字段名**,和 r402 复用 566/587/1365 那三处既有查询是同一种纪律。

## 3. 提议改动(未落码,等 NWT 红队)

在 `handlePoolOracleTxSignReq`(`trade-protocol-filter.js`),`myIdx`(委员身份确认,L595-596)通过、`silentIdx` 跳过判断(L597-600)之后、进入签名循环(L601)之前,插入:

```js
// PB-S8-1 搬运(bettor-prediction-voter.js:1100-1126 同款模式,复用 decideConsensusV06 的
// chain_events 查询, pool-market-settler.js:1398-1404): 身份检查(在不在委员名单)≠前提检查
// (这个committee的4-of-5真的判了这个winner吗)。签名前,用自己当时实际投的票反查,跟消息里
// 的 winner 比对——不一致就拒签,不管消息(尤其cross-node场景)喂来的 phase2_tx_obj/winner 是什么。
const myVoteRow = sqlite.prepare(`
  SELECT payload FROM chain_events
  WHERE event_type = 'pool_oracle_vote'
    AND payload LIKE ? AND payload LIKE ?
  ORDER BY observed_at ASC LIMIT 1
`).get(`%"market_id":"${market.id}"%`, `%"voter_pubkey":"${voterPubkey}"%`);
if (!myVoteRow) {
  // 同 PB-S8-1 原版: 找不到自己的投票记录, 不当"通过"也不永久拒绝——本地 ingest 可能还没追上,
  // 留给下一次 sign_req 重试(委员会同一 market 通常会重发这条消息, 见既有 idempotent 幂等设计)。
  console.warn(`[trade-filter:sign-req] byzantine 防: 本地找不到自己(${voterPubkey.slice(0,12)})对 market=${market.id.slice(0,12)} 的投票记录, 暂不签, 待重试`);
  continue;
}
let myOutcome;
try { myOutcome = JSON.parse(myVoteRow.payload).outcome; } catch { myOutcome = null; }
const expectedOutcome = msg.winner === 0 ? 'YES' : (msg.winner === 1 ? 'NO' : null);
if (myOutcome !== expectedOutcome) {
  console.error(`[trade-filter:sign-req] byzantine 防触发: oracle=${oracle.name} 自己投的=${myOutcome} ≠ 消息声称的winner对应=${expectedOutcome}(msg.winner=${msg.winner}) market=${market.id.slice(0,12)} — 拒签`);
  continue;
}
```

插入点是 `for (const oracle of localOracles)` 循环体内、`myIdx`/`silentIdx` 判断之后——每个本地 oracle 各自查自己的投票记录(不同 oracle relay 在同一台机器上也可能是不同的委员身份,各自独立核对,不能共用一次查询结果)。

## 4. 这次不做的(PB-S8-2 maker/市场替换防,列出但不在本设计范围)

原版 PB-S8-2(`bettor-prediction-voter.js:1128-1132`)检查 `redeem_script_hash` 是否匹配自己 offer 的 metadata,防"maker 掉包"——本质是防止签名对象被替换成别的市场/别的 payout 结构(和今天 predictions 域跑过的 `commingled_route_to_refund_regression` 测试守的 FINDING-2 跨市场替换是同一类风险形状)。

pool 委员会路径的对应版本需要独立设计:`phase2TxObj` 结构上要跟什么本地已知量交叉核(候选:`market.spine_p2sh` 是否等于 tx_obj 里花的那个 UTXO 的地址?`computePoolPayouts` 本地重算的金额是否等于 tx_obj 的 outputs?)——**这条我没有在本轮时间内查完,不装作查过。** 列为本设计的已知缺口,是否本轮一起做还是登记为下一张卡,请 NWT/Bettor 裁。PB-S8-1(投票一致性)与 PB-S8-2(结构完整性)是两个独立的检查,各自成立,不互相依赖——先落 PB-S8-1 不等于放弃 PB-S8-2。

## 5. 请 NWT 打的点

1. **`msg.winner` 的 0/1 映射方向**——我从 `decideConsensusV06` 读到 `winner:0`⇔YES赢、`winner:1`⇔NO赢(L1455/L1473),这个映射在 `handlePoolOracleTxSignReq` 里我假设不变(同一条 pipeline 产出的同一个字段),但没有反向追 `dispatchPhase2` → 广播 `kanet_pool_oracle_tx_sign_req_v1` 那一跳是否有做过转换。请核实字段语义在这一跳有没有变过。
2. **cross-node 场景的"自己的票"**:这个 oracle relay 若是在**另一台机器**广播了它的 `pool_oracle_vote_v1`(而不是本机直接写),本机的 `chain_events` 要靠 `handlePoolOracleVote` 的 ingest 才有这行——如果本机就是那个投票 oracle 的所在机器,理论上应该是同机直接写(不依赖广播 ingest,同 r402 §1 里"本地 bettor 直接下注"那条路径的逻辑),但我没有逐行确认"oracle 自己投票"这条路径是不是保证同机写入。若这个假设不成立,`myVoteRow` 可能系统性找不到,新检查会把所有签名都卡住(不是安全问题,是可用性问题,需要弄清楚再定案)。
3. **对 forfeit_1 静默委员**的处理是否需要单独考虑:静默委员在 `silentIdx === myIdx` 那一步已经被跳过(不进入这次改动插入点之后的代码),这条新检查不会碰到静默委员——确认这个理解对不对。
4. **`continue` 语义**:插入点在 `for (const oracle of localOracles)` 循环体内,`continue` 跳到下一个本地 oracle(不是跳出整个函数)——同一台机器如果托管了多个 committee 成员身份(理论可能,`localOracles` 是复数),一个成员的 byzantine 检查失败不该连坐另一个。请确认这个 `continue` 目标选对了。
