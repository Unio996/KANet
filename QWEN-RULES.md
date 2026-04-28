# QWEN-RULES.md — 本地 AI 执行指南

> 本文件由 Claude Opus 审定，给本地 Qwen3.6 模型做开发执行时的硬约束。
> 每条规则都有 DO / DON'T 代码示例。违反任何一条 = 代码必须退回。

---

## Rule 1: NO TX NO STATE CHANGE

**WHY**: KANet 构建在 Kaspa 链 100% 信任之上。没有链上 TX = 什么都没发生。先写 DB 再广播 = 乐观写入 = 致命 bug。

**DO**:
```javascript
const result = await sendCommandAsync(relayId, {
  type: 'send_broadcast',
  payload: { t: 'kanet_exchange_v1', ...offerData }
});
if (!result?.txId) throw new Error('Broadcast failed — state NOT advanced');
// TX 上链了，现在才写本地 DB
db.prepare('INSERT INTO exchange_offers (id, broadcast_tx_id, ...) VALUES (?, ?, ...)')
  .run(offerId, result.txId, ...);
```

**DON'T**:
```javascript
db.prepare('INSERT INTO exchange_offers ...').run(offerId, 'pending_xxx', ...);
try { await sendCommandAsync(relayId, { type: 'send_broadcast', ... }); }
catch (e) { console.error('broadcast failed'); }
// DB 已写入但 TX 没上链 = 幽灵数据
```

---

## Rule 2: sendCommandAsync vs sendCommand

**WHY**: `sendCommand()` 是 fire-and-forget，Relay 执行失败 Console 不知道。花钱操作必须用 `sendCommandAsync()` 等回执。

**DO**:
```javascript
// 转账、握手、拆分 UTXO — 全部用 Async
const { txId, error } = await sendCommandAsync(relayId, {
  type: 'transfer', to: address, amount: sompiAmount
});
if (error) return reply.code(500).send({ error });
return reply.send({ txId });
```

**DON'T**:
```javascript
sendCommand(relayId, { type: 'transfer', to: address, amount: sompiAmount });
return reply.send({ ok: true }); // 用户以为成功但钱可能没动
```

---

## Rule 3: Anti-Spam Fail-Closed

**WHY**: Agent 防骚扰的最后一道门。API 不可达时必须拒绝发送，不能放行。

**DO**:
```javascript
let allowed = false;
try {
  const resp = await fetch(`${consoleUrl}/api/agent/outbound-check?target=${peer}&agent=${agentAddr}`);
  const data = await resp.json();
  allowed = data.allowed === true;
} catch {
  allowed = false; // fail-closed: API 不可达 = 拒绝
}
if (!allowed) return;
await sendMessage(peer, content);
```

**DON'T**:
```javascript
try {
  const resp = await fetch(`${consoleUrl}/api/agent/outbound-check?...`);
  // ...
} catch {
  // API 挂了？没事，先发吧
}
await sendMessage(peer, content); // 无论检查结果都发 = 骚扰
```

---

## Rule 4: Eta 模板 x-data 安全

**WHY**: 浏览器把 `>` 当 HTML 标签结束符。x-data 里的 `>` `<` 会导致 JS 泄露为可见文本。

**DO**:
```html
<!-- 简单逻辑内联，但不含 > < -->
<div x-data="{ count: 0, active: true }">...</div>

<!-- 超过 10 行提取到命名函数 -->
<div x-data="exchangeApp()">...</div>
<script>
function exchangeApp() {
  return {
    offers: [],
    async loadOffers() {
      const r = await fetch('/api/exchange/offers');
      this.offers = await r.json();
    }
  };
}
</script>
```

**DON'T**:
```html
<!-- > 直接在 x-data 里 = HTML 解析灾难 -->
<div x-data="{ filter: items.filter(x => x.amount > 100) }">
```

---

## Rule 5: chain_events event_type 白名单

**WHY**: anti-spam 查询 `IN ('comm', 'comm_sent', 'text', 'handshake')`。新增发送路径必须用白名单内的 type，否则消息统计失明。

**DO**:
```javascript
// 发广播 — 用 comm_sent
await ingestChainEvent({
  event_type: 'comm_sent',
  agent_address: agentAddr,
  remote_address: null,
  txid: txId
});
```

**DON'T**:
```javascript
// 自创 event_type — anti-spam 看不到
await ingestChainEvent({
  event_type: 'broadcast_message', // 不在白名单
  agent_address: agentAddr,
  txid: txId
});
```

---

## Rule 6: 参数化查询 + 事务

**WHY**: SQLite 字符串拼接 = SQL 注入。多表写入无事务 = 中途失败留脏数据。

**DO**:
```javascript
const trx = db.transaction(() => {
  db.prepare('INSERT INTO exchange_offers (id, maker) VALUES (?, ?)').run(id, maker);
  db.prepare('INSERT INTO fund_locks (offer_id, amount) VALUES (?, ?)').run(id, amount);
  db.prepare('INSERT INTO chain_events (event_type, txid) VALUES (?, ?)').run('exchange_publish', txId);
});
trx();
```

**DON'T**:
```javascript
db.exec(`INSERT INTO exchange_offers (id, maker) VALUES ('${id}', '${maker}')`);
db.exec(`INSERT INTO fund_locks (offer_id, amount) VALUES ('${id}', ${amount})`);
// 第二条失败 = fund_lock 没建但 offer 已存在
```

---

## Rule 7: CJK 文本不用 \b

**WHY**: JavaScript `\b` (word boundary) 对中日韩字符无效，断言永远 false。

**DO**:
```javascript
// 字符类边界匹配
const hasBuy = /(?:^|[\s,;])买|购买|buy(?:[\s,;]|$)/i.test(text);
```

**DON'T**:
```javascript
// \b 对中文永远 false
const hasBuy = /\b买\b/.test(text);  // 永远不匹配
```

---

## Rule 8: 时间存储与显示

**WHY**: `datetime('now')` 返回 naive 格式，JS 按本地时区解析会偏移。

**DO**:
```javascript
// DB 存储：JS 生成 ISO 字符串
db.prepare('UPDATE offers SET completed_at = ? WHERE id = ?')
  .run(new Date().toISOString(), offerId);

// UI 显示：用 KANet.formatTime()
`<span x-text="KANet.formatTime(offer.completed_at)"></span>`
```

**DON'T**:
```javascript
// SQLite datetime('now') = naive 格式，无时区信息
db.prepare("UPDATE offers SET completed_at = datetime('now') WHERE id = ?").run(offerId);

// UI 直接截 ISO 字符串
`<span>${iso.slice(5, 16)}</span>`
```

---

## Rule 9: 系统 RPC 节点

**WHY**: `api.kaspa.org` 是公共服务，限流且不可靠。KANet 有自己的 RPC 节点。

**DO**:
```javascript
const { getWorkingRpc } = require('../lib/rpc-utils');
const rpcUrl = await getWorkingRpc();
const client = new RpcClient({ url: rpcUrl });
```

**DON'T**:
```javascript
const client = new RpcClient({ url: 'wss://api.kaspa.org/wrpc/borsh' });
```

---

## Rule 10: Kaspa 是 10 BPS

**WHY**: Kaspa 每秒出 10 个块（10 blocks per second），不是 1 个。确认时间按此计算。

**DO**:
```javascript
const KASPA_BPS = 10;
const confirmTimeMs = requiredConfirmations / KASPA_BPS * 1000;
```

**DON'T**:
```javascript
const confirmTimeMs = requiredConfirmations * 1000; // 假设 1 BPS = 大错
```

---

## Rule 11: Qwen3 reasoning kill switch — 必须传 chat_template_kwargs

**WHY**: Qwen3.6 默认 thinking 模式, 会在 `reasoning_content` 字段吃光 `max_tokens` 几千字符 "Here's a thinking process..." 然后 `content` 空. 后果:
- 延迟 8 倍 (8s → 1s)
- content 空 → 回落 reasoning_content → 需额外 extractJson 从英文推理堆里抽 JSON, 易抓错
- channel-bridge 5 min timeout 概率大

坊间流传的 `/no_think` 前缀在 Qwen3.6-35B-A3B **实测无效** (sys 前缀 / user 前缀都不关 reasoning). 唯一真正的 kill switch 是 API body 加 `chat_template_kwargs: { enable_thinking: false }`.

**DO**:
```javascript
const body = {
  model: 'Qwen3.6-35B-A3B',
  messages,
  max_tokens: 1000,
  temperature: 0.3,
  chat_template_kwargs: { enable_thinking: false },  // ← 必须
};
```

**DON'T**:
```javascript
// 假 kill switch — Qwen3.6 根本不看这前缀
const SYSTEM = `/no_think\n你是摘要助手...`;
// 或
messages.push({ role: 'user', content: userMsg + '\n/no_think' });
```

**实测对比**（同 prompt, Qwen3.6-35B-A3B-Q4_K_M.gguf）:
| 方法 | content | reasoning | 延迟 |
|---|---|---|---|
| 裸 (无 kill switch) | 134c | 1936c 浪费 | 8s |
| sys /no_think | 116c | 1974c (不生效!) | 8s |
| user /no_think | **0c ❌** | 2756c | 更糟 |
| **chat_template_kwargs** | 163c ✓ | **0c ✓** | **1s** |

适用所有 Qwen3.6 API caller: `llm-dispatcher.js` / `retail-dex-dialog.js` / `retail-dex-memory.js` / `scripts/qwen-bridge-worker.js` / `scripts/qwen.js`.

---

## Rule 12: 频道工具 + 阶段汇报 (SOP)

**WHY**: QClaude 是 Claude Code 终端 + Qwen 后端, 收到派单时只看到**当前一条**消息, 前后文蒙圈. 你能跑 Bash/Read/Edit 真动代码, 但常常忘了主动读频道或汇报进度, 导致 Owner 以为你空转实际你在跑.

**DO — 每个派单先读频道上下文**:
```bash
# 看 dev-coord 最近 30 分钟, 了解任务来龙去脉
node scripts/ch-ls.mjs --since 30m

# 看当前派单相关 tx 的完整内容
node scripts/ch-ls.mjs --since 10m --full
```

**DO — 按 SOP 5 阶段走 + 每阶段完成发进度**:
```
阶段 1 读需求 → 2 查代码 → 3 写 → 4 自测 → 5 汇报 DONE
```

每完成 1 阶段立即发进度 (防 channel-bridge timeout 误判空转):
```bash
# Write tool 写进度内容到文件 (UTF-8 安全)
# 文件内容例: [QCLAUDE 进度 2/5] 查代码完毕 — retail-dex.js:418 找到 buildOrderConfirmText, 准备改 createOrder 落 broker_fee_kas
node scripts/send-chat.mjs 5b236c08-03d0-456c-953d-e10001610938 dev-coord /tmp/progress-2.txt
```

**DO — 声明 DONE 前用 grep 自检**:
```bash
# 别只说 "已改", 先证
grep -n "broker_fee_kas" kasia-console/src/services/retail-dex.js
node --check kasia-console/src/services/retail-dex.js
git diff --stat kasia-console/src/services/retail-dex.js
```

**DON'T**:
```
# 闷头写 15 分钟不吭声 → Owner 看到 channel-bridge 报 (timeout) 以为你死机
# 声明 "Bug #1 已改" 但文件里 grep 零匹配 (trust 声明不作数)
# 跳过阶段 4 自测直接汇报 DONE
# 改了 spec 外的文件 (比如顺手改 CRLF 文件)
```

**Relay IDs 速查** (send-chat 用):
| 名 | id |
|---|---|
| NWT auto (QClaude 发进度用这个) | 5b236c08-03d0-456c-953d-e10001610938 |
| Martin | 3765cc82-5e20-4e61-bb0a-697277287223 |
| Kasia_1 | b236f45f-15df-440a-b0b7-991aeef9b1a4 |
| Qwen | 5dcb8531-5c9b-4729-82cc-dcdccba2dd40 |

---

## Rule 13: broker LLM 调用必单 system message — Qwen Jinja 严格拒双 system

**WHY**: Qwen3.6 chat template (Jinja) 严格要求 messages 数组里 `{role:'system'}` 仅 1 个, 必在最前. 第 2 个 system msg 直接 `raise_exception('System message must be at the beginning')` → llama-server 直接 HTTP 500. broker LLM 调用 fall back generic message ('LLM 卡了一下'), user 体验灾难.

**历史教训** (这次 broker 开发实测):
- T-J1-19f (commit 撤过 INTENT_LOCK system msg unshift): J1 已验证 "Qwen 见第二条 system msg 退化返空", 注释 broker-llm-agent.js L195-197
- R33 wire (commit 371e4ca62, J2 ship 04-27 21:44): J2 漏看 J1 注释, 加 `history.unshift({role:'system', stateLockAddendum})` reintroduce 同 anti-pattern
- ux_p15 cron 长期 FAIL + Owner 04-28 真测撞 (06:40 'Yes' / '现在Kas 卖价?' / '?' 全 LLM 500 cascade) — root cause 这条 anti-pattern reintroduce
- Bug-Z24 fix (commit e8f8e064, J1 ship 04-28 14:41): merge SYSTEM_PROMPT + stateLockAddendum 成单 system msg, 通过 ctx.systemAppend pass

**DO**:
```javascript
// _callLlm 调用合并多 prompt 段成 1 个 system message
const fullSystem = ctx.systemAppend
  ? `${SYSTEM_PROMPT}\n\n${ctx.systemAppend}`
  : SYSTEM_PROMPT;
const requestBody = {
  model: 'Qwen3.6-35B-A3B',
  messages: [{ role: 'system', content: fullSystem }, ...messages],
  chat_template_kwargs: { enable_thinking: false },  // Rule 11
};
```

**DON'T**:
```javascript
// caller 注入第 2 个 system msg → Qwen Jinja 100% 500
const stateLockAddendum = llmSystemPromptStateLock(peer);
if (stateLockAddendum) {
  history.unshift({ role: 'system', content: stateLockAddendum });  // ← anti-pattern
}
let llm = await _callLlm(history, ...);
// _callLlm 内部 [{role:'system', SYSTEM_PROMPT}, ...history] → 双 system msg
```

**实测验证 (Bug-Z24 dig 04-28 14:35)**:
```
$ grep "Jinja Exception" /c/kanet/logs/llama-server.log
"Jinja Exception: System message must be at the beginning"
```
broker-llm-io.jsonl 实证: R33 state lock active 时, LLM 调用 100% 触发 (NWT dig, 2075 calls 全 500).

**lint enforce (R37)**: `scripts/lint-kanet.mjs` rule R37 — broker-llm-agent.js `{role: 'system'}` literal 出现次数 ≤ 1, 超过 → pre-commit reject. 物理上无法 reintroduce.

R37 ship: commit `a507aafc9` (NWT 04-28). reviewer 可 `git show a507aafc9` 看 lint 实现 (~25 LOC scripts/lint-kanet.mjs checkR37).

**适用文件** (Qwen3.6 API caller, grep `chat_template_kwargs` 实证):
- kasia-console/src/services/broker-llm-agent.js
- kasia-console/src/services/llm-dispatcher.js
- kasia-console/src/services/market-rules-parser.js
- scripts/channel-bridge.mjs
- scripts/qwen-bridge-worker.js
- scripts/qwen.js
