# test-framework — 写测试 / 跑测试 实操教程

> 你想加新测试？看这里。
> 想了解架构原则 → 看 `docs/TEST-FRAMEWORK.md`。

## 跑测试

```bash
# 跑单个 case
node scripts/test.mjs --case=test-framework/cases/broker/sell_kas_no_buy_hallucinate.test.mjs

# 跑整个 domain (broker / future seeker / exchange ...)
node scripts/test.mjs --domain=broker

# 跑全部 domain (除 skip_in_batch case)
node scripts/test.mjs --all

# 输出: ✓ PASS (绿) / ✗ FAIL (红) / ⏭ SKIP, summary 在末尾
```

前置：`node kanet-start.sh` 启动 console（test 用 /api/agent/reply 这条 sync 路径）。

## 写一个新 case

最简结构：

```js
// kasia-console/test-framework/cases/broker/my_new_case.test.mjs
import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const peer = freshTestPeer('my-case-' + Date.now());

export default {
  id: 'my_new_case',
  description: '一句话说这 case 测什么',
  domain: 'broker',                    // cases/<domain>/ 子目录决定
  tags: ['regression'],                // 可选, 用于 cron 优先级
  // skip_in_batch: true,              // 如果是 manual-only (例如真链 e2e)

  steps: [
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '我想买 5 KAS',
      expect: {
        must: {                        // 硬 fail
          reply_does_not_contain: ['卖', 'sell'],
        },
        should: {                      // warning, 不 fail case
          reply_response_time_ms_max: 5_000,
          reply_contains_one_of: ['哪个链', 'which chain'],
        },
      },
    },
    { action: 'cleanup_peer', peer_addr: peer },
  ],
};
```

关键约定：
- 文件必须 `*.test.mjs` 后缀，runner 才发现
- `export default` 一个 case 对象
- `id` 全局唯一（runner 用它做 dedupe + report 标识）
- `domain` 对应 `cases/<domain>/` 子目录名
- 用 `freshTestPeer(seed)` 生成测试 peer（同一 case 多次跑 deterministic）
- 用 `relayId('trader-b')` / `relayAddr('nwt')` 不要硬编码 kaspa: 长地址
- 收尾跑一次 `cleanup_peer` 清掉测试痕迹

## 可用 actions

### send_message
sync DM via /api/agent/reply（无 chain DM, 快）
```js
{ action: 'send_message', from_peer, to_relay_id, message }
// → { reply, latency_ms, skip_reason, raw }
```

### inject_history
注入伪造的 broker ↔ peer 历史对话（用于"已有上下文"的回归 case）
```js
{
  action: 'inject_history',
  peer_addr, relay_addr,
  messages: [
    { direction: 'inbound', text: '想买 1 USDC, BSC' },
    { direction: 'outbound', text: '好的, 买 1 USDC. 用哪个链 付 USDT?' },
  ],
}
```

### sleep
等 N 毫秒（通常用在 send_message 之间留 backend 处理时间）
```js
{ action: 'sleep', ms: 1000 }
```

### query_db
任意只读 SQL
```js
{
  action: 'query_db',
  sql: 'SELECT * FROM exchange_offers WHERE maker = ?',
  params: ['kaspa:qrxw...']
}
// → { rows, count }
```

### wait_for_db_row
轮询直到 SQL 返非空，timeout 后 found=false
```js
{ action: 'wait_for_db_row', sql, params, timeout_ms: 30_000, poll_ms: 2000 }
// → { rows, found, polled_for_ms }
```

### wait_for_offer_status
特化版：等 exchange_offers 行到指定 protocol_status
```js
{ action: 'wait_for_offer_status', maker, status: 'completed', timeout_ms: 180_000 }
// → { row, found, polled_for_ms }
```

### wait_for_broker_outbound_msg
轮询 messages 表等 broker 真发出 outbound DM 给 peer
```js
{
  action: 'wait_for_broker_outbound_msg',
  broker_addr, peer_addr,
  content_contains: '请转',  // 可选
  timeout_ms: 60_000,
}
// → { row, found, polled_for_ms }
```

⚠ peer 必须是 `realLocalPeer()` 不能是 `freshTestPeer()` — 否则 broker 的 chain DM 永远 silent fail（synthetic peer 不在真 Kasia network），此 action 永 timeout。

### cleanup_peer
清测试 peer 的 messages 表行（best-effort）
```js
{ action: 'cleanup_peer', peer_addr }
```

### persona_turn
驱动 persona state machine 一步：自动生成用户消息 + send + 接收 reply + 状态推进
```js
import cnNewbie from '../../personas/cn_newbie.mjs';

{ action: 'persona_turn', persona: cnNewbie, from_peer, to_relay_id }
// → { message, reply, latency_ms, persona_state, persona_done }
```

多轮就重复多个 persona_turn step。state 自动持久在 ctx.vars，跨 step 续。

## 可用 assertions

写在 `expect.must` (硬 fail) 或 `expect.should` (warning)：

| assertion | 含义 |
|-----------|------|
| `reply_contains: 'X'` 或 `['X', 'Y']` | reply 必含所有 |
| `reply_does_not_contain: 'X'` 或 `['X', 'Y']` | reply 必不含任何 |
| `reply_contains_one_of: ['X', 'Y']` | reply 至少含一个 |
| `reply_response_time_ms_max: 5000` | 反应时间上限 |
| `reply_response_time_ms_min: 500` | 反应时间下限 (用于确认走了 LLM 路径) |
| `reply_skip_reason_equals: 'sibling_broker'` | 验 skip 原因 |
| `db_row_count: 1` | query_db 返指定行数 |
| `found: true` | wait_for_* 是否找到 |
| `row_field_equals: { protocol_status: 'completed' }` | 行字段值 |

## 写一个新 persona

```js
// kasia-console/test-framework/personas/my_persona.mjs
export default {
  id: 'my_persona',
  name: '一句话描述这是什么用户',
  description: '更详细的人格说明',

  initialState() {
    return { stage: 'intent', /* 自定义字段 */ };
  },

  step(state, brokerReply) {
    // brokerReply 是上一轮 broker 的回复 (string, 可能 '')
    // 返回 { message, nextState, done }
    //   message: 这一轮发给 broker 的话 (null = 不发)
    //   nextState: 推进后的 state (可以原样返回)
    //   done: true = 对话结束 (case 后续 step 不再调 persona_turn)

    switch (state.stage) {
      case 'intent':
        return {
          message: '我想买 5 KAS',
          nextState: { ...state, stage: 'wait_chain' },
          done: false,
        };
      case 'wait_chain':
        if (/哪个链|which chain/i.test(brokerReply)) {
          return {
            message: 'BSC',
            nextState: { ...state, stage: 'done' },
            done: false,
          };
        }
        // broker 没问 chain → 不耐烦, 取消
        return { message: 'NO', nextState: state, done: true };
      default:
        return { message: null, nextState: state, done: true };
    }
  },
};
```

设计原则（J2 整理）：
- 流程结构用 state machine（确定性）
- 单条 phrasing 可以用 LLM（自然，但贵 + 慢）— 如果纯字符串够用就纯字符串
- persona 模拟"真人会问的真问题"，不是"测试预期broker的字段"

## 写一个新 adversarial probe

待 J1 主导设计接口规范。当前接口约定（draft）：

```js
// kasia-console/test-framework/adversarial/my_probe.mjs
export default {
  id: 'my_probe',
  name: '攻击模式名字',
  description: '攻击什么 / 期望 broker 怎么防御',

  // 生成一组 test case 给 runner 跑
  generateProbes(broker_endpoint, ctx) {
    return [/* array of test case objects */];
  },
};
```

## 把测试发现的 bug 沉淀回 ANTI-PATTERNS

测试 fail → 修 → 沉淀。流程：
1. 复现 bug 的 case 加进 `cases/<domain>/` 守住（防退化）
2. 修 bug
3. 重跑 case PASS
4. 把根因写进 `docs/ANTI-PATTERNS.md` 作为 R 编号条目
5. 新 case / persona / adversarial 触类旁通的攻击向量加进库

## 约定

- 加 case / persona / adversarial 之前先 grep 一遍 `cases/`, 看有没有已经做了类似的（"永不新建先迭代"）
- case `id` 用 snake_case，描述性，全库唯一
- `tags` 标 `security` / `critical` / `regression` / `ux` / `real_chain` 用于 cron 调度
- 改 lib/ 之前 RFC 给三方 review（架构层面影响所有 case）
- commit 前 `node scripts/lint-kanet.mjs` 跑一遍

## Owner

| 部分 | 负责 |
|------|------|
| lib/ (核心 runner / actions / assertions) | NWT 主，三方 review |
| personas/ | J2 主 |
| adversarial/ | J1 主 |
| cases/ | 谁加谁 own |
