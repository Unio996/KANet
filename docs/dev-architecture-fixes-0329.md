# 架构修复（3/29）— Developer Documentation

> **KANET_ROOT 环境变量 + Console 碰链关闭。Read before deploying or modifying launch paths.**

---

## Fatal Traps

0. **不猜代码，查了再写。** 列名用 `PRAGMA table_info`，函数名用 grep，参数名看调用方。记忆不可信，代码是唯一真相。每次引用前先验证，零例外。

1. **部署只改 `kanet.env` 一处。** `KANET_ROOT=D:/Anthropic` 在 kanet.env 中定义。所有 JS 文件用 `process.env.KANET_ROOT || 'D:/Anthropic'` 回退。不要在代码里硬编码绝对路径。

2. **Console 不签名，不提交 RPC。** 三个碰链文件已删除/重写：
   - `bcast-sender.js` — 已删除，广播改走 Relay `send_broadcast` IPC
   - `card-publisher.js` — 已删除，发 Card 已走 Relay `publish_card` IPC
   - `utxo-splitter.js` — 重写为 Relay IPC 代理（`split_utxo` 命令）

3. **kaspa-wasm 在 Console 中仅用于地址派生。** `relay.js` 和 `wallet.js` 的 `Mnemonic/XPrv` import 是纯计算（从助记词推导地址），不连 RPC、不签名。这是允许的。

4. **autoSplitAll 在 Relay 启动之后执行。** `index.js` 启动顺序：Adapters → Minds → Scheduler → **Relays → UTXO Split**。Split 通过 IPC 发给 Relay，Relay 必须先跑起来。

5. **kaspa-scout/package.json 仍有硬编码路径。** `"kaspa-wasm": "file:D:/Anthropic/kaspa-mcp/vendor/kaspa-wasm"` 是 npm 构建时依赖，不能用环境变量。部署时需替换为正式包或正确相对路径。

---

## KANET_ROOT 传播链

```
kanet.env                    ← 定义 KANET_ROOT=D:/Anthropic
  ↓
kanet-start.sh               ← 读取 env，export KANET_ROOT 给 Console 进程
  ↓
Console (node index.js)       ← process.env.KANET_ROOT
  ├── scanner.js              ← SCOUT_DIR = KANET_ROOT/kaspa-scout
  ├── relay-manager.js        ← RELAY_DIR = KANET_ROOT/kasia-relay
  ├── adapter-launcher.js     ← ADAPTER_DIR = KANET_ROOT/agent-adapter
  ├── mind-manager.js         ← file:///KANET_ROOT/agent-mind/src/mind.mjs
  ├── index.js                ← KANET_ROOT/agent-mind/src/skills
  ├── relay.js                ← MINDS_DIR + SKILLS_DIR
  ├── events.js               ← reflections.json 路径
  ├── chat.js                 ← confirm-store.mjs 路径
  ├── skills.js               ← SKILLS_DIR
  └── migrate.js              ← agent config.json 路径
```

每个文件开头：`const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';`

## Console 碰链修复 — 调用方变更

### 广播（原 bcast-sender.js → Relay IPC）

**chat.js**（2 处）：
```js
// 前：sendBroadcast(mnemonic, network, channel, message)
// 后：sendCommandAsync(relayId, { type: 'send_broadcast', channel, message })
```
返回值变化：IPC 返回 `{ txId, fee, ok }` 而非 `{ txId, fee, address }`。`address` 需要从 relay 对象取。

**trading.js**（2 处，delivered + paid broadcast）：
```js
// 前：bcastSend(mnem, network, channel, payload)
// 后：sendCmd(order.relay_node_id, { type: 'send_broadcast', channel, message: payload })
```
fire-and-forget 模式（`.then().catch()`），不阻塞交易流程。

**mind-manager.js**（1 处，timeout broadcast）：
```js
// 前：bcastSend(mnem, relayInfo.network, tOrder.id, timeoutMsg)
// 后：sendCmd(tOrder.relay_node_id, { type: 'send_broadcast', channel: tOrder.id, message: timeoutMsg })
```

### UTXO Split（原 utxo-splitter.js 直接 RPC → Relay IPC）

**Relay 新增命令：** `{ type: 'split_utxo', targetCount: 3 }`
- 处理：`kasia-relay/src/relay.mjs` case 'split_utxo'
- 实现：`kasia-relay/src/lib/utxo-split.mjs`
- 返回：`{ ok, split, utxosBefore, utxosAfter, txId?, fee?, reason? }`

**Console utxo-splitter.js** 重写为薄代理：
```js
export async function splitUtxos(relayNodeId, targetCount) {
  return sendCommandAsync(relayNodeId, { type: 'split_utxo', targetCount }, 20_000);
}
```
