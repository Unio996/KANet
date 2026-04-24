## 第零条 bis：NO TX NO STATE CHANGE — 链上行为铁律

> **KANet 构建在对 Kaspa 链 100% 信任之上。链是唯一事实源。**
> TX 上了链就一定会被 Scout 扫到、被对端节点处理。
> 如果 TX 没上链，那就是**什么都没发生**。

**铁律：每一个链上行为、每一个链上动作，都必须跟着真实 TX 走。**

| 操作 | 正确 | 错误 |
|------|------|------|
| publish 挂单 | 广播成功拿到 txId → 写 DB | ~~先写 DB 再广播~~（陷阱 #43） |
| accept 接单 | 广播成功拿到 txId → 写 DB | ~~先写 DB 再广播~~ |
| paid 付款通知 | 广播成功拿到 txId → 才 processPaymentSubmit | ~~广播失败也 processPaymentSubmit~~（4/11 发现） |
| delivered 交割通知 | 广播成功拿到 txId → 才 transition(completed) | ~~sendKaspa 返回就 completed~~ |
| cancel 取消 | 广播成功拿到 txId → 才写 cancelled | ~~先写再广播~~ |

**代码规则：**

```javascript
// ✅ 正确：广播成功才推进
const bcastResult = await sendCommandAsync(relayId, { type: 'send_broadcast', ... });
if (!bcastResult?.txId) throw new Error('Broadcast failed — state NOT advanced');
// 广播上链了，现在才写本地 DB
processPaymentSubmit({ ... });

// ❌ 错误：try-catch 吞掉广播失败，照样推进
try { await sendCommandAsync(...); } catch { console.error('failed'); }
processPaymentSubmit({ ... }); // 广播没上链但本地推进了 = 乐观写入
```

**UTXO 并发：** 连续两个广播（如 accept 后紧跟 paid）可能因 UTXO 冲突失败。解决：paid 广播前等前一个 TX 确认（1-2 秒），或 Relay TX 队列串行化。

**检查清单——所有协议消息发送点：**

| 消息 | 文件 | 行 | 当前状态 |
|------|------|-----|---------|
| kanet_exchange_v1 (publish) | exchange.js | ~270 | ✅ 广播失败不写 DB（4/10 修复） |
| kanet_exchange_accept_v1 | exchange.js | ~278 | ✅ 广播成功才 processAccept（4/12 P0-③，陷阱 #51） |
| kanet_exchange_paid_v1 (_autoSendKas) | trade-protocol-filter.js | ~978 | ✅ 5 次重试+失败不推进（4/12 P1-C，陷阱 #54） |
| kanet_exchange_delivered_v1 | exchange-machine.js | ~548 | ✅ 广播成功才 completed（4/11 修复） |
| kanet_exchange_cancel_v1 | exchange.js | ~352 | ✅ local-first 合理（4/12 共识：cancel 只在 open 态，无对手方资金风险） |
| kanet_exchange_timeout_v1 | exchange-machine.js | ~400 | ✅ 广播成功才 reopen（4/12 P0-⑤，陷阱 #52） |

**教训来源：** 2026-04-11 跨节点测试。taker 节点 auto-pay USDT 成功，paid 广播因 UTXO 冲突失败被静默吞掉，但 processPaymentSubmit 照常推进本地状态。maker 节点永远收不到 paid 消息，永远不知道要 deliver KAS。交易永远卡在 verifying。花了 3 小时才定位到这一行 try-catch。

---

