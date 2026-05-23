# AutoTaker 详细方案

> Martin 出品 | 2026-04-12 | 状态：待审查（NWT审 → J2测）

## 目标

收到外部 offer 广播时，自动评估价差，满足条件则自动接单。
单边先行：只接 BUY 单（对方卖 KAS 我付 USDT，auto-pay 已验证）。

## 触发点

`trade-protocol-filter.js` `handleExchange()` line 424 之后。
offer 写入 DB 后立即调 `_evaluateAutoTake(offerId, msg)`。

## _evaluateAutoTake 函数设计

```javascript
async function _evaluateAutoTake(offerId, msg) {
  // 1. 基础过滤
  const localAddrs = sqlite.prepare('SELECT address FROM relay_nodes').all().map(r => r.address);
  if (localAddrs.includes(msg._from)) return;       // 不接自己的单 (trap #53)
  if (msg.verification === 'manual') return;         // 只接可自动验证的
  if (msg.expires_at && new Date(msg.expires_at) < new Date()) return; // 跳过过期

  // 2. 方向判断（单边先行：只接 BUY 单）
  // BUY 单 = 对方 give KAS, want USDT → 我付 USDT 得 KAS
  if (!(msg.give_asset?.toUpperCase() === 'KAS' && msg.want_asset?.toUpperCase() === 'USDT')) return;

  // 3. autotake_enabled 开关
  const { getConfig } = await import('../data/settings/configs.js');
  const enabled = await getConfig('autotake_enabled');
  if (enabled !== 'true') return;

  // 4. 价格评估
  const marketPrice = getCachedKasPrice();
  if (!marketPrice) return;
  const offerPrice = parseFloat(msg.want_amount) / parseFloat(msg.give_amount);
  const discount = (marketPrice - offerPrice) / marketPrice;
  const minDiscount = parseFloat(await getConfig('autotake_min_discount_pct')) || 0.5;
  if (discount < minDiscount / 100) return;  // 价差不够

  // 5. 金额上限
  const maxUsdt = parseFloat(await getConfig('autotake_max_amount_usdt')) || 50;
  if (parseFloat(msg.want_amount) > maxUsdt) return;

  // 6. 余额校验
  // 查本地 agent_wallets 找默认 BNB 钱包 USDT 余额
  const agent = localAddrs[0]; // 选第一个本地 agent
  const wallet = sqlite.prepare(
    "SELECT * FROM agent_wallets WHERE agent_address = ? AND chain = 'bnb' AND is_default = 1"
  ).get(agent);
  if (!wallet) return;
  // TODO: 实时查 USDT 余额，或用缓存

  // 7. 日限额
  const today = new Date().toISOString().slice(0, 10);
  const dailyCount = sqlite.prepare(
    "SELECT COUNT(*) as cnt FROM chain_events WHERE event_type = 'autotake_accepted' AND created_at >= ?"
  ).get(today + 'T00:00:00Z')?.cnt || 0;
  const dailyLimit = parseInt(await getConfig('autotake_daily_limit')) || 3;
  if (dailyCount >= dailyLimit) return;

  // 8. cooldown 30s（防 UTXO 冲突）
  if (_lastAutoTakeAt && Date.now() - _lastAutoTakeAt < 30_000) return;

  // 9. 模式分叉
  const mode = await getConfig('autotake_mode') || 'approval';
  if (mode === 'auto') {
    setImmediate(() => _executeAutoTake(offerId, agent).catch(e =>
      console.error(`[autoTaker] execute error: ${e.message}`)
    ));
  } else {
    // approval 模式：生成提案，等 Owner UI 确认
    createExecution({
      orderId: offerId,
      type: 'autotake_proposal',
      source: 'auto-taker',
      agentAddress: agent,
      displaySummary: `AutoTake: BUY ${msg.give_amount} KAS @ ${offerPrice.toFixed(6)} (${(discount * 100).toFixed(2)}% below market ${marketPrice})`,
      actionDetails: JSON.stringify({ offerId, offerPrice, marketPrice, discount, chain: 'bnb' }),
    });
    console.log(`[autoTaker] proposal created for offer ${offerId.slice(0, 8)}`);
  }
}
```

## _executeAutoTake 函数

复用 exchange.js accept 路径（不重新发明）：

```javascript
let _lastAutoTakeAt = 0;

async function _executeAutoTake(offerId, agentAddress) {
  // 1. 查 offer 确认仍为 open
  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ? AND protocol_status = ?').get(offerId, 'open');
  if (!offer) return;

  // 2. 找 taker relay
  const relay = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(agentAddress);
  if (!relay) return;

  // 3. 选链（默认 bnb）
  const selectedChain = 'bnb';

  // 4. 广播 kanet_exchange_accept_v1（5次重试，trap #51 铁律）
  const { sendCommandAsync } = await import('./relay-manager.js');
  let acceptTx = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await sendCommandAsync(relay.id, {
        type: 'send_broadcast',
        channel: 'kanet-exchange',
        message: JSON.stringify({
          t: 'kanet_exchange_accept_v1',
          offer_id: offerId,
          taker: agentAddress,
          selected_chain: selectedChain,
        }),
      });
      acceptTx = res?.txId || null;
      if (acceptTx) break;
    } catch (err) {
      console.error(`[autoTaker] accept broadcast attempt ${attempt}/5: ${err.message}`);
    }
    if (attempt < 5) await new Promise(r => setTimeout(r, 200 * attempt));
  }

  if (!acceptTx) {
    console.error(`[autoTaker] accept broadcast failed for offer ${offerId.slice(0, 8)}`);
    return;
  }

  // 5. 广播成功 → processAccept 推进状态
  const { processAccept } = await import('./exchange-machine.js');
  processAccept({
    offer_id: offerId,
    _from: agentAddress,
    _tx: acceptTx,
    selected_chain: selectedChain,
  });

  // 6. 记录 chain_event 留痕
  recordChainEvent({
    txid: acceptTx,
    eventType: 'autotake_accepted',
    fromAddress: agentAddress,
    toAddress: offer.maker,
    payload: JSON.stringify({ offer_id: offerId, give: offer.give_amount + ' ' + offer.give_asset, want: offer.want_amount + ' ' + offer.want_asset }),
  });

  _lastAutoTakeAt = Date.now();
  console.log(`[autoTaker] accepted offer ${offerId.slice(0, 8)} via TX ${acceptTx.slice(0, 12)}`);

  // auto-pay 由 handleExchangeAccept 内部触发（line 464-471），不需要这里重复
}
```

## 配置项（config_entries）

| key | 默认值 | 说明 |
|-----|--------|------|
| autotake_enabled | false | 总开关 |
| autotake_min_discount_pct | 0.5 | 最小价差百分比 |
| autotake_daily_limit | 3 | 每日最多接几单 |
| autotake_max_amount_usdt | 50 | 单笔最大 USDT |
| autotake_mode | approval | approval / auto |
| autotake_cooldown_min | 0.5 | 两单间隔（分钟），默认30s |

## 改动范围

**仅 trade-protocol-filter.js 一个文件：**
- `handleExchange()` 末尾加 `_evaluateAutoTake` 调用（1行）
- 新增 `_evaluateAutoTake()` 函数（~50行）
- 新增 `_executeAutoTake()` 函数（~40行）
- 新增模块顶部 `let _lastAutoTakeAt = 0;`

**不改的文件：**
- exchange-machine.js（processAccept 已有）
- exchange.js（API 不变）
- action-executor.mjs（Mind 层不参与 autoTake）

## 安全约束

- NO TX NO STATE CHANGE 铁律（trap #51）：广播成功才 processAccept
- 不接自己的单（trap #53）
- 默认 approval 模式，Owner 确认后才执行
- 日限额 + cooldown + 金额上限 三重保护
- auto 模式需 Owner 在 config 显式开启
- CEX 对冲在 accept 广播成功后触发

## J2/NWT 审查意见（已确认）

1. 价差阈值：config_entries ✓
2. CEX对冲时机：accept广播成功后 ✓
3. approval提案：复用 execution_states ✓
4. cooldown 30s：内存 _lastAutoTakeAt ✓
