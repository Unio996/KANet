# r402 修复设计 v2 — betCount 复核挪到实际广播前(NWT PUSH-BACK 后改稿)

**Status: DESIGN v2 — 待 NWT 复审,未落码。** 归 J2(settler/pipeline 域)。v1(commit `7bee5352`)被 NWT 红队 PUSH-BACK(commit `a52c70cd`,finding① MUST-FIX:检查点插错阶段)。本版按 NWT finding① + Bettor 终裁(`#c8zcyv`,五条,合并了 `#c8x950` 方向裁定 + NWT PUSH-BACK)改。`json_set` 原子写已现取验证可用(better-sqlite3 + json1,`SELECT json_set('{}','$.a',1)` 本机实测通过)。

## 变更摘要(相对 v1)

| # | v1 | v2 | 谁指出的 |
|---|---|---|---|
| 1 | §0 把 maker_pk 检查叫"身份/授权检查" | 改为"内容比对,零发送者绑定";request 侧合法发送者集合天然无界,不设门,归为已知残余 | Bettor 08-02T20:17 实读代码 |
| 2 | 检查点插在 `handlePoolRefundRequest`(dispatchRefund 调用前) | **挪到 `handleRefunding`,`sendCommandAsync` 广播前**——dispatchRefund 只暂存不广播,真正签名广播隔着一整个 settler tick(默认 300s) | NWT finding①,MUST-FIX |
| 3 | 只堵 cross-node 一条路径 | **同一处顺带堵住 566/1362/1706 三处同节点路径的同款缺口**(它们也走 handleRefunding,之前也是零复核) | NWT finding①,"免费的" |
| 4 | 冲突分支候选 A/B 二选一未定 | **A+B 一起上**,rejected_v1 锚从"registered relay"改成"consumer 本地已有的 maker pk" | Bettor `#c8satt`/`#c8x950` |
| 5 | 审计字段 read-modify-write 无节流 | 与节流合并处理,同一改动一次做完 | Bettor 第5点 + NWT finding③,同一段代码 |

## 0. 缺陷回顾(v2 修正表述)

- **触发点**(`pool-market-settler.js:580-629`,cross-node maker 分支):某节点持有一个 maker 在别处的市场,用**自己本地** `pool_bettor_sides` 的 betCount 判"是不是 0-bet";betCount==0 就广播 `pool_refund_request_v1`。
- **已证的失败模式**(J1 08-01 报告):某节点整张 `pool_bettor_sides` 为 0 行 ⇒ 判据在该节点结构上恒真。已发出 705 条(`docs/2026-08-01-j1tn-705-xnode-refund-request-list.md`)。
- **producer 侧 `handlePoolRefundRequest`(trade-protocol-filter.js:133-181)四项检查,最后一项 `msg.maker_pk` 校验的真实性质(v1 表述错误,现更正)**:
  - 它是 **`msg.maker_pk`(消息自带字段)与本地 relay 派生 pk 的内容比对,零发送者身份绑定**——不是"这条消息真的来自谁"的密码学证明。
  - **market 的 maker_pk 本身是公开可派生的信息**(任何观察过 market_publish 的节点都能算出来)⇒ **任何第三方都能构造一条四检全过的 `pool_refund_request_v1`**,不需要拿到任何私钥。
  - r402(本设计)落地后,这条伪造请求会被**producer 侧前提复核**挡住(如果市场真有 bet);但对**真 0-bet 的跨节点市场**,"谁都能触发一次真实的退款广播"这件事本身仍然成立——钱回 maker 自己地址不是盗币,但违反 Owner「只 settle 绝不 refund」的自动化路径纪律,且是一个无认证的钱路广播触发器(可用于择时 griefing:强迫在非期望时刻发生退款)。
  - **Bettor 08-02T20:21 方向裁定(`#c8x950`①②,非建议)**:`pool_refund_request_v1` 的合法发送者集合**天然无界**(任何 ingest 了该市场的节点都可能是合法 consumer),producer 侧没有任何记录能枚举"谁有资格请求"——尝试用 `relay_nodes` 表当跨节点身份注册表是**类目错误**(该表只是单机本地 relay 托管表,实测 32 行全部本机,J1 的 relay 在这张表里是 0 行,不是"没登记"而是"这张表结构上不可能有别的机器的行")。**⇒ request 侧本轮不设发送者绑定门,当作 untrusted hint 处理,真正的防线是 producer 侧前提复核本身(见 §2)。"任何人可触发真 0-bet 市场的退款广播"作为已知残余显式登记,天花板 = producer 自核前提。**
- `dispatchRefund` 本体(`pool-market-settler.js:2427-2464`)只检查 `isBshard`,不查 betCount,**且不签名不广播**——它只是把 `refund_tx_obj` preimage 存进 `metadata`,把 `protocol_status` 改成 `'refunding'`,函数就返回了。
- **真正的签名+广播在 `handleRefunding`(`pool-market-settler.js:2552-2617`)的 `sendCommandAsync`(L2594)**,而 `handleRefunding` 是被**下一次 settler tick** 重新 `SELECT protocol_status='refunding'` 的市场后才调用的(`TICK_INTERVAL_MS` 默认 300s,demo 环境 60s)。**v1 把检查点插在 `handlePoolRefundRequest`,和真正广播之间隔着一整个 tick —— 这段时间内落地的 bet 完全不会被挡,因为 `handleRefunding` 从头到尾零 betCount 检查。**(NWT finding①,MUST-FIX)
- **现状止血**:Bettor 08-01T08:14Z 拍的 ②'(停 J1 全部 relay)已于 08-02T20:19 **被 Owner 撤销**——J1 核实"机器健康≠钱路缺陷是两件事"后,Owner 选择"用 r402 从根修,不拿停 relay 当止血"。当前唯一的偶然拦截是 J1 relay 每日广播额度耗尽(成功广播=0),Bettor 已要求 J1 在 r402 落地前不主动解除这个偶然(不充值、不重启栈)。**r402 现为最高优先级。**

## 1. 可信 betCount 来源在哪一层(未变,v1 已过 Bettor 方向审 GREEN)

`pool_bettor_sides` 两条写入路径:

| 路径 | 位置 | 可信度 |
|---|---|---|
| a) 本地 bettor 直接下注 | `kasia-console/src/api/pool.js` INSERT | 本节点亲自处理,即时、不依赖广播 |
| b) 跨节点 bettor 下注,靠广播 ingest | `trade-protocol-filter.js:1284` `INSERT OR IGNORE`(UNIQUE `side_lock_tx`) | 依赖 ingest,可能 lag/丢(J1 案例) |

同表同查询在**同节点**场景已有三处先例(`566`/`1362`/`1706`),producer 自己的本地副本严格强于"完全不查"和"信请求方的本地副本"(后者已被证明可以整表为空)。残余风险(链上正向枚举式根治,当前架构下负向存在性证明的结构性难题)v1 已披露,v2 不变,详见 v1 归档段落(本文件 git 历史 `7bee5352`)。

NWT finding②(PASS,已核):ghost-row 假阳性顾虑不成立——`UNIQUE(market_id, bettor_pk)` v62 + 广播 ingest 必须先命中链上未花费 UTXO(`captureSideLockDaa`)才 `INSERT`,伪造/脏行插不进去;即便有假阳性,失败模式是"拒绝+审计"(fail-safe),不是 fail-dangerous。不需要额外处理。

## 2. 提议改动 v2(检查点挪到 `handleRefunding`,广播前)

在 `handleRefunding`(`pool-market-settler.js:2552-2617`),确认 `maker_relay_id` 是本地真实 relay(既有检查,L2577-2580)之后、`sendCommandAsync` 广播(L2594)之前,插入:

```js
// r402 v2 (NWT finding① MUST-FIX): betCount 复核挪到这里 —— 这是签名广播前的最后一刻,
// 之前插在 handlePoolRefundRequest 的版本和这里之间隔一整个 settler tick,完全没用。
// 同一处顺带堵住 566/1362/1706 三处同节点 0-bet 路径的同款缺口(它们也走这个函数)。
const localBetCount = sqlite.prepare(
  'SELECT COUNT(*) as c FROM pool_bettor_sides WHERE market_id = ?'
).get(market.id)?.c || 0;

if (localBetCount > 0) {
  console.error(`[pool-settler:refunding] REFUSED market=${market.id.slice(0,12)} — local betCount=${localBetCount} > 0 at broadcast-time, 0-bet 前提不再成立, 不发 refund tx`);

  // 节流 + 原子写(Bettor 第5点 + NWT finding③ 合并一次改):json_set 直接在 SQL 层原子更新,
  // 不用 JS 端 parse-modify-write(会跟同一 market 上其他并发 tick 对 metadata 的写产生竞态,
  // 后写覆盖前写、字段丢失——CLAUDE.md 记录的 read-modify-write 竞态同款)。
  // 节流条件放进 WHERE:只有上次冲突记录超过 5 分钟(或从未记录过)才真的执行这次 UPDATE,
  // 避免每个 tick(demo 60s)都刷一次 metadata + error log。
  const THROTTLE_SEC = 300; // 跟 tick 间隔同量级
  const result = sqlite.prepare(`
    UPDATE pool_markets
    SET metadata = json_set(
          json_remove(COALESCE(metadata, '{}'), '$.refund_tx_obj', '$.refund_dispatched_at'),
          '$.refund_conflict_at', ?,
          '$.refund_conflict_bet_count', ?
        ),
        protocol_status = 'verifying',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND (
        json_extract(metadata, '$.refund_conflict_at') IS NULL
        OR (julianday('now') - julianday(json_extract(metadata, '$.refund_conflict_at'))) * 86400 > ?
      )
  `).run(new Date().toISOString(), localBetCount, market.id, THROTTLE_SEC);

  // 若这次 refund 是被 cross-node 请求触发的(reason 里带这个标记),需要告知 consumer 停止重试。
  // 见 §2.1 —— 单独节流(避免每次 tick 都重发 rejected_v1)。
  let meta = {};
  try { meta = JSON.parse(sqlite.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get(market.id)?.metadata || '{}'); } catch {}
  if (String(meta.refund_reason || '').includes('cross-node consumer refund request')) {
    await maybeSendRefundRejected(market, localBetCount); // §2.1,内部自带节流
  }
  return { ok: false, reason: `local betCount=${localBetCount} at broadcast time, aborted (throttled=${result.changes === 0})` };
}
```

**为什么放弃"回 refunding 状态、只是不发"而选择"退回 verifying"**:market 现在有真实下注了,它不再是一个应该被退款的市场——它应该进正常的 committee 采样/投票/结算路径。留在 `'refunding'` 状态只会让它在每个 tick 反复撞到这条检查、反复不发,是一种新的卡死(和 CLAUDE.md 记录的 xzztw 手改 metadata 那次死循环是同一个形状:状态和现实脱节,靠反复重试硬扛)。退回 `verifying` 才是让状态机诚实反映现实。

**关于 `handlePoolRefundRequest`(consumer 请求刚到达时)那次早期检查**:Bettor 终裁①明确"可以留作早期拒绝快路"——不是必须删除,只是**不能再是唯一的闸**。早期检查能在大多数情况下更快地拒绝掉一个有真实 betCount 的市场(不用等到下一次 settler tick),但**权威的、唯一保证时序正确的闸是本节这个、插在 `handleRefunding` 广播前的检查**。两处逻辑相同(同一条 SQL 查询模式),早期那次不需要节流/状态回退这套(它在 `dispatchRefund` 都还没调用之前就 return,不涉及已经写入的 `'refunding'` 状态)。

### 2.1 rejected_v1 回执(方向锚已由 Bettor 08-02T20:21③ 敲定,细节归本节)

**锚不是"registered relay"(v1 提议,已证不成立),是"consumer 本地已经有的 maker pk"**:consumer 广播 `pool_refund_request_v1` 时,它自己的 `market.maker_relay_id` 字段里存的就是 `'cross-node:<pk>'`(建市场/ingest 市场时写入的,不是消息喂给它的)。⇒ producer 用**这个市场的 maker relay 私钥**签 `rejected_v1` payload,consumer 收到后**验签对自己本地已有的那个 pk**——checker 在决策那一刻读的是本地 binding 值,不是消息自带值,verify-value-source 合格,复用 `handlePoolOracleVote`(trade-protocol-filter.js:240-259)已验证过的 `kaspa.verifyMessage` 签名格式。

```js
import { blake2b } from '@noble/hashes/blake2b';
// 签名对象对齐既有先例(coord-status-sign.mjs,D-010,已带伪造负测试跑通产线):
// 签 blake2b(JSON) 的 hex,不签裸字符串 —— pool_oracle_vote 签裸串是更早的模式,
// Bettor 08-02T20:29 终裁本次走 D-010 这条(更新、经过对抗测试)。
function hashPayloadHex(payloadObj) {
  return Buffer.from(blake2b(Buffer.from(JSON.stringify(payloadObj), 'utf8'), { dkLen: 32 })).toString('hex');
}

async function maybeSendRefundRejected(market, betCount) {
  let meta = {};
  try { meta = JSON.parse(market.metadata || '{}'); } catch {}
  const lastRejectSentAt = meta.refund_rejected_sent_at ? new Date(meta.refund_rejected_sent_at).getTime() : 0;
  const THROTTLE_MS = 60 * 60 * 1000; // 跟 consumer 的 REQUEST_REBROADCAST_MS 同量级,够它下次重试前收到
  if (Date.now() - lastRejectSentAt <= THROTTLE_MS) return;

  const payload = { t: 'pool_refund_request_rejected_v1', market_id: market.id, reason: 'local_bet_count_nonzero', bet_count: betCount, rejected_at: new Date().toISOString() };
  const contentHashHex = hashPayloadHex(payload);
  // 用 market.maker_relay_id(此刻已确认是本地真实 relay,见 handleRefunding L2577-2580)签名。
  // IPC 名是 ecdsa_sign(kasia-relay/src/relay.mjs:638-652,J1 08-02T20:29 核实——遗留误命名,
  // 底层实为 kaspa-wasm signMessage/schnorr,产线已用于 coord-status 签名门)。
  const signResult = await sendCommandAsync(market.maker_relay_id, { type: 'ecdsa_sign', message: contentHashHex }, undefined, 'internal');
  if (!signResult?.ok || !signResult.signature) {
    console.warn(`[pool-settler:refunding] rejected_v1 sign fail market=${market.id.slice(0,12)}: ${signResult?.error}`);
    return;
  }
  const bcastResult = await sendCommandAsync(market.maker_relay_id, {
    type: 'send_broadcast', channel: 'kanet-prediction',
    message: JSON.stringify({ ...payload, signature: signResult.signature }),
  }, undefined, 'internal');
  if (bcastResult?.ok) {
    meta.refund_rejected_sent_at = new Date().toISOString();
    sqlite.prepare('UPDATE pool_markets SET metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(meta), market.id);
  }
}
```

consumer 侧新增 handler(`trade-protocol-filter.js`,与 `handlePoolRefundRequest` 平级):

```js
async function handlePoolRefundRequestRejected(msg) {
  const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(msg.market_id);
  if (!market) return;
  const localMeta = JSON.parse(market.metadata || '{}');
  const makerPk = String(market.maker_relay_id || '').replace(/^cross-node:/, ''); // 本地已有,不信消息
  if (!makerPk) return; // 不是 cross-node 市场,这条消息跟我无关
  const unsigned = { ...msg }; delete unsigned.signature;
  const contentHashHex = hashPayloadHex(unsigned); // 与签名侧同一套哈希规范化(见上 maybeSendRefundRejected)
  let sigValid = false;
  try {
    const kaspa = await import('kaspa-wasm');
    sigValid = kaspa.verifyMessage({ message: contentHashHex, signature: msg.signature, publicKey: makerPk });
  } catch (e) { console.warn(`[trade-filter:pool-refund-rejected] verify exception: ${e.message}`); return; }
  if (!sigValid) { console.warn(`[trade-filter:pool-refund-rejected] sig invalid market=${msg.market_id.slice(0,12)} — 可能是伪造拒绝,忽略`); return; }
  localMeta.refund_request_rejected_at = new Date().toISOString();
  localMeta.refund_request_rejected_reason = msg.reason;
  sqlite.prepare('UPDATE pool_markets SET metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(localMeta), market.id);
  console.log(`[trade-filter:pool-refund-rejected] market=${msg.market_id.slice(0,12)} producer 拒绝(bet_count=${msg.bet_count})— 停止重试`);
}
```

**consumer 侧重试逻辑(`pool-market-settler.js:593-596` `needsBroadcast`)需要加一条**:`&& !meta0.refund_request_rejected_at`(不属于本设计的 handleRefunding 改动范围,但属于 r402 同一张卡——Bettor `#c8satt`③ 已裁定"consumer 侧改动归 r402 同卡,不另开 DRI")。

**签名 IPC 假设已核实存在(v2 首版此处标"未核",现已解开,三路核实——J2 问/J1 逐行读码/Bettor 复核,ledger (120) 已记)**:`ecdsa_sign`(`kasia-relay/src/relay.mjs:638-652`,配 `get_pubkey`:654)——签任意 payload,privkey 不 leak,是 D-010 coord-status 签名门同款原语(已带伪造负测试跑通产线)。**两点落码注意(Bettor 原话)**:(a) 签名对象对齐先例——签 `blake2b(payload)` 的 hex,别签裸串(上面代码已按此写);(b) `ecdsa_sign` 属盲签类 IPC(key-auth 分类,`reference-relay-command-classification-abc-2026-07-22`),**这个新调用方(rejected_v1)需要 NWT 复审时顺手进关分类表**——不是新增能力,是给已有能力多加一个已知调用者。

**wire format 顾虑已解除**:v1 曾担心新增协议消息类型 `pool_refund_request_rejected_v1` 会不会破坏既有 wire format 约定。NWT finding⑥核实:`trade-protocol-filter.js` 的主 switch 加新 `t` 值是这个文件内**已有 13 次的既有模式**(见 `case` 列表 L84-106 附近逐条),不是破格新造,Bettor 终裁④已确认"wire 顾虑不构成选 B 弃 A 的理由"。

## 3. 不在本次范围

- **request 侧不设发送者绑定门**(Bettor 终裁③,与 NWT finding⑤ 两路收敛)——合法发送者集合无界(现状=任意节点的 settler tick 都能合法发这条广播,收窄到 committee_pks 会改变这个协议语义,超出"缺陷修复"范围,不做);`committee_pks` 候选已否决。
  - **挂账登记(Bettor 记 ledger,原话摘录)**:「开放项:跨节点广播消息(`pool_refund_request_v1` 等)无发送者身份绑定。影响面按 NWT 校准记:伪造上限 = 让一个真 0-bet、已过 deadline、`verifying` 态的市场提前自我了结;§2 修复后不再是钱路问题,是时序问题。」—— 也就是说,本设计落地后,这条残余能做到的最坏事是"让一个反正迟早会被判 0-bet 退款的市场提前触发",不是"退错一个有人下注的市场"(那个洞由 §2 的 betCount 复核挡住了)。
- **不处理已发出的 705 条历史存量**——KANet-UI 191∩705 交集调查是独立轨道。
- **不做链上正向枚举式彻底根治**(§1 残余风险)。
- **relay_nodes 表的写入面是否可被滥用** —— 已证明该表跟本设计无关(它不是跨节点身份注册表),这个问题若有别的用途需要查,另立卡,不在 r402 范围。

## 4. 请 NWT 复审的点(v2 新增/变化的部分)

1. **状态回退是否完整**:退回 `'verifying'` + 清掉 `refund_tx_obj`/`refund_dispatched_at` 是否够,还是有别的字段(比如 `pool_committee` 表里可能已经采样过、或者 `pool_snapshot`)也需要一并处理,才能让市场干净地重新进入正常路径?
2. **`sign_message` IPC 是否存在**:§2.1 假设 relay 侧有一个通用"用这个 relay 的私钥签这段 payload"的 IPC 命令——我没有逐行核过 `kasia-relay` 侧,如果不存在,rejected_v1 这部分需要先加这个原语或者换个签名路径。
3. **节流窗口选值**:conflict 写 5 分钟、rejected_v1 发送 1 小时,是否和实际 tick 间隔(demo 60s / prod 300s)匹配,会不会太松/太紧?
4. **consumer 侧 `needsBroadcast` 加的那一条判据**,是否需要一并在本设计里给出完整 diff,还是可以留给落码阶段现场对齐(不影响红队 PASS/push-back 的判断)?
