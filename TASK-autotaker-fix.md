# TASK：修复 Exchange AutoTaker UI 配置不生效 Bug

**执行者**：QClaude (Qwen3.6 本地脑)
**出题人**：Opus 4.7
**预计工作量**：约 150-200 行代码改动，单文件居多

---

## 1. 目标

让 `http://localhost:3100/exchange` 的 AutoTaker Config 面板可用 —— 勾选 `AutoTaker enabled` 真的把状态写入数据库，刷新页面后保持，后端生效。**顺手补齐两个 UI 有但后端没读的假字段**（cooldown 和 mode）。

## 2. 背景（当前 Bug）

### 2.1 前端 placeholder

`kasia-console/src/ui/exchange.eta:1600-1606`：

```js
async saveAutoTakerConfig() {
  const c = this.autoTakerConfig;
  await Promise.all([
    fetch('/api/exchange/limits', { method: 'PUT',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({}) }),              // ← 空对象！
  ]);
  // TODO: save autotaker config to config_entries when API is ready
}
```

三个问题：body 空；端点错（/api/exchange/limits 是写限额的，不是 autotaker）；变量 `c` 拿到没用。

### 2.2 后端在读但 UI 写不进去

`kasia-console/src/services/trade-protocol-filter.js:467-514` 读这 4 个 key：

```js
autotake_enabled           // 主开关（字符串 'true' / 'false'）
autotake_min_discount_pct  // 默认 '0.5'
autotake_max_amount_usdt   // 默认 '50'
autotake_daily_limit       // 默认 '3'
```

存放表：`config_entries`，通过 `data/settings/configs.js` 的 `getConfig(key)` / `setConfig(key, value, {category})` 读写。

### 2.3 UI 有但后端**没实现**的两个字段

| UI 字段 | 后端现状 |
|---|---|
| **Cooldown (sec)** | `trade-protocol-filter.js:517` 硬编码 `< 30_000`，不读 config |
| **mode（approval/auto）** | 后端没有这个概念，永远走 approval 路径（createExecution 生成 proposal） |

这两个也一起补齐。

## 3. 改动清单（6 项）

### 改动 1 —— 后端：新增 `GET /api/exchange/autotaker-config`

**文件**：`kasia-console/src/api/exchange.js`
**位置**：在 `PUT /api/exchange/limits`（约 1003 行）之后插入

**功能**：返回当前 6 个 autotake 配置。所有值如果不存在都用默认值。

```js
// GET /api/exchange/autotaker-config — 读取 AutoTaker 配置
fastify.get('/api/exchange/autotaker-config', async (request, reply) => {
  const { getConfig } = await import('../data/settings/configs.js');
  return reply.send({
    enabled:          (await getConfig('autotake_enabled')) === 'true',
    mode:             (await getConfig('autotake_mode')) || 'approval',
    min_discount:     parseFloat(await getConfig('autotake_min_discount_pct') || '0.5'),
    max_amount:       parseFloat(await getConfig('autotake_max_amount_usdt') || '50'),
    daily_limit:      parseInt(await getConfig('autotake_daily_limit') || '3'),
    cooldown_sec:     parseInt(await getConfig('autotake_cooldown_sec') || '30'),
  });
});
```

### 改动 2 —— 后端：新增 `PUT /api/exchange/autotaker-config`

**文件**：同上
**位置**：紧跟改动 1 之后

**功能**：接受 6 个字段部分更新（undefined 字段不写）。对每个字段做校验。

```js
// PUT /api/exchange/autotaker-config — 更新 AutoTaker 配置
fastify.put('/api/exchange/autotaker-config', async (request, reply) => {
  const { enabled, mode, min_discount, max_amount, daily_limit, cooldown_sec } = request.body || {};
  const { setConfig } = await import('../data/settings/configs.js');
  const cat = { category: 'exchange_autotaker' };
  const updates = [];

  if (enabled !== undefined) {
    await setConfig('autotake_enabled', enabled ? 'true' : 'false', cat);
    updates.push(`enabled=${enabled}`);
  }
  if (mode !== undefined) {
    if (!['approval', 'auto'].includes(mode))
      return reply.code(400).send({ error: 'mode must be approval|auto' });
    await setConfig('autotake_mode', mode, cat);
    updates.push(`mode=${mode}`);
  }
  if (min_discount !== undefined) {
    const v = parseFloat(min_discount);
    if (isNaN(v) || v < 0 || v > 50)
      return reply.code(400).send({ error: 'min_discount must be 0-50' });
    await setConfig('autotake_min_discount_pct', String(v), cat);
    updates.push(`min_discount=${v}`);
  }
  if (max_amount !== undefined) {
    const v = parseFloat(max_amount);
    if (isNaN(v) || v < 1)
      return reply.code(400).send({ error: 'max_amount must be >= 1' });
    await setConfig('autotake_max_amount_usdt', String(v), cat);
    updates.push(`max_amount=${v}`);
  }
  if (daily_limit !== undefined) {
    const v = parseInt(daily_limit);
    if (isNaN(v) || v < 1 || v > 100)
      return reply.code(400).send({ error: 'daily_limit must be 1-100' });
    await setConfig('autotake_daily_limit', String(v), cat);
    updates.push(`daily_limit=${v}`);
  }
  if (cooldown_sec !== undefined) {
    const v = parseInt(cooldown_sec);
    if (isNaN(v) || v < 5 || v > 3600)
      return reply.code(400).send({ error: 'cooldown_sec must be 5-3600' });
    await setConfig('autotake_cooldown_sec', String(v), cat);
    updates.push(`cooldown_sec=${v}`);
  }

  if (updates.length === 0) return reply.code(400).send({ error: 'No valid fields' });
  return reply.send({ ok: true, updated: updates });
});
```

### 改动 3 —— 后端：cooldown 读 config 而不是硬编码

**文件**：`kasia-console/src/services/trade-protocol-filter.js`
**位置**：约 517 行附近的 cooldown 检查

**当前代码**：
```js
// 9. Cooldown 30s (UTXO conflict prevention)
if (_lastAutoTakeAt && Date.now() - _lastAutoTakeAt < 30_000) return;
```

**改为**：
```js
// 9. Cooldown (configurable, default 30s, UTXO conflict prevention)
const cooldownMs = (parseInt(await getConfig('autotake_cooldown_sec') || '30')) * 1000;
if (_lastAutoTakeAt && Date.now() - _lastAutoTakeAt < cooldownMs) return;
```

确认 `getConfig` 在这文件里已经 import 过（从 467 行可以看到 `const { getConfig } = await import('../data/settings/configs.js');`）。把 import 移到函数顶部一次性 load，避免重复 import。

### 改动 4 —— 后端：mode 分支（approval vs auto）

**文件**：同上
**位置**：`_evaluateAutoTake` 函数末尾，`createExecution({ ... type: 'autotake_proposal' ... })` 那段（约 585 行附近）

**当前**：无论什么情况都是 createExecution 生成 proposal，等人审批。

**改为**：读 `autotake_mode`。如果是 `approval`（默认），保持现状生成 proposal。如果是 `auto`，直接调用 accept 逻辑（同 `approveAutoTake` endpoint 走的路径，即 `/api/trade/approve-execution/:id` 内部逻辑）。

**推荐实现**（简单版）：**无论什么模式都先生成 proposal，然后 auto 模式下立刻内部调用 approve 路径**。这样审计链一致。

```js
const mode = (await getConfig('autotake_mode')) || 'approval';
const proposal = createExecution({
  orderId: offerId,
  type: 'autotake_proposal',
  source: 'auto-taker',
  agentAddress: localAddrs[0],
  displaySummary: `AutoTake: BUY ${giveAmt} KAS @ ${offerPrice.toFixed(6)} (${(discount * 100).toFixed(2)}% below market $${marketPrice})`,
  actionDetails: JSON.stringify({ offerId, offerPrice, marketPrice, discount, chain: 'bnb', relayId: bestRelay }),
});

if (mode === 'auto') {
  // 立刻内部执行 approve，不等 Owner 点按钮
  try {
    const { approveExecution } = await import('./trade-action.js');  // 确认此导出存在
    await approveExecution(proposal.id);
    console.log(`[autoTaker] AUTO mode: executed proposal ${proposal.id}`);
  } catch (e) {
    console.error(`[autoTaker] AUTO mode execute failed: ${e.message}`);
  }
}
```

**注意**：需要先查 `services/trade-action.js` 有没有导出可复用的 `approveExecution` 函数。如果没有，看 `/api/trade/approve-execution/:id` 端点的 handler，把核心逻辑抽成一个函数，在那里 export 出来。

### 改动 5 —— 前端：`saveAutoTakerConfig()` 改真实发请求

**文件**：`kasia-console/src/ui/exchange.eta`
**位置**：1600-1606 行，整段替换

```js
async saveAutoTakerConfig() {
  const c = this.autoTakerConfig;
  try {
    const r = await fetch('/api/exchange/autotaker-config', {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        enabled:      c.enabled,
        mode:         c.mode,
        min_discount: c.min_discount,
        max_amount:   c.max_amount,
        daily_limit:  c.daily_limit,
        cooldown_sec: c.cooldown_sec,
      }),
    });
    const d = await r.json();
    if (!d.ok) alert('Save failed: ' + (d.error || 'unknown'));
  } catch (e) {
    alert('Network error: ' + e.message);
  }
},
```

### 改动 6 —— 前端：页面加载时读取当前配置

**文件**：同上

**位置**：找到 exchange 页面的 `init()` 或 `async mounted()` / Alpine.js 的 `x-init` 调用。找 `loadWallet()` / `loadOffers()` 之类的加载函数调用点，在同一位置加：

```js
async loadAutoTakerConfig() {
  try {
    const d = await fetch('/api/exchange/autotaker-config').then(r => r.json());
    this.autoTakerConfig = {
      enabled:      d.enabled,
      mode:         d.mode || 'approval',
      min_discount: d.min_discount,
      max_amount:   d.max_amount,
      daily_limit:  d.daily_limit,
      cooldown_sec: d.cooldown_sec,
    };
  } catch {}
},
```

然后在 `init()` / mount 阶段调 `await this.loadAutoTakerConfig();`。

## 4. 验收标准

**必须满足**（跑不通就是没做完）：

1. ✅ 勾选 `AutoTaker enabled` → 刷新浏览器 → 仍然勾选
2. ✅ 修改 Min Discount / Max Amount / Daily Limit / Cooldown → 刷新 → 值保持
3. ✅ `curl http://127.0.0.1:3100/api/exchange/autotaker-config` 返回当前所有 6 个字段
4. ✅ `curl -X PUT ... -d '{"enabled":true}'` 返回 `{ok:true, updated:["enabled=true"]}`
5. ✅ 数据库里存在记录：`sqlite3 kasia-console/data/console.db "SELECT key, value_encrypted FROM config_entries WHERE key LIKE 'autotake_%'"` 应该看到 6 条
6. ✅ `getConfig('autotake_enabled')` 返回 `'true'` 字符串时，`trade-protocol-filter.js:469` 的 `if (enabled !== 'true') return;` 能通过
7. ✅ UI 显示的 mode 标签（右边 approval/auto 胶囊）跟着 select 变色

**边界 case**：
- PUT 只带 `{enabled: true}`，其他字段不变 → 只更新 enabled
- PUT 带非法 mode (如 'xxx') → 返回 400
- PUT 带负的 min_discount → 返回 400

## 5. 自测脚本

```bash
# 1. 先启动 console（确保 llama-server 或你 Console 已跑起来）
# 2. 改动写完，重启 Console
# 3. 跑下面的命令

# 查当前配置
curl -s http://127.0.0.1:3100/api/exchange/autotaker-config | jq

# 改 enabled 和 max_amount
curl -s -X PUT http://127.0.0.1:3100/api/exchange/autotaker-config \
  -H "Content-Type: application/json" \
  -d '{"enabled":true,"max_amount":100}' | jq

# 再查确认
curl -s http://127.0.0.1:3100/api/exchange/autotaker-config | jq

# 数据库确认
sqlite3 C:/kanet/kasia-console/data/console.db \
  "SELECT key, value_encrypted FROM config_entries WHERE key LIKE 'autotake_%'"

# 非法值应该 400
curl -s -X PUT http://127.0.0.1:3100/api/exchange/autotaker-config \
  -H "Content-Type: application/json" \
  -d '{"mode":"invalid"}' -w " HTTP %{http_code}\n"
```

然后开浏览器 `http://localhost:3100/exchange`，找到 AutoTaker tab，勾 `enabled`，改 max_amount 到 100，F5 刷新，验证仍然是勾选 + 100。

## 6. 陷阱 / 注意事项

1. **UTF-8 BOM**：`exchange.eta` 是 UTF-8 含中文的，编辑别搞坏编码
2. **category 字段**：新建的 config 全部用 `category: 'exchange_autotaker'`，方便以后 `getAllConfigs('exchange_autotaker')` 批量取
3. **值类型**：`config_entries.value_encrypted` 存**字符串**（见 `configs.js:24` `valueEncrypted = value`），所以 `setConfig('autotake_enabled', 'true', ...)` 要传字符串，不是 boolean
4. **trade-protocol-filter.js 现存逻辑**：读 `autotake_enabled` 用 `if (enabled !== 'true') return` 字符串比较 —— 不要改这个，保持向后兼容
5. **别动硬编码 30_000 以外的 cooldown 逻辑**：`_lastAutoTakeAt` 变量本身（模块级）要保留
6. **mode='auto' 的 approveExecution 接入**：如果 `trade-action.js` 没导出现成函数，宁可**暂不实现 mode=auto 分支**（UI 保留 select 但后端 fallback 到 approval 并打印 warn），也不要硬塞半成品。TODO 清楚留注释。

## 7. 不要做的事

- 不要改 DB schema（不需要 migration）
- 不要动 `market-seeder.js`（maker 侧逻辑，不相关）
- 不要动 reputation 相关代码（已经在 autoTaker 决策路径里，别碰）
- 不要改 `/api/exchange/limits` 端点（保留原功能）
- 不要在 UI 加新字段，就调通现有 6 个

## 8. 完成后报告格式

给出：
1. 改了哪些文件，各多少行
2. 自测 6 条验收标准结果（逐条 ✅/❌）
3. 如果 mode=auto 分支没做（因为 trade-action.js 没合适函数），明说并贴出你看到的现状
4. 任何你发现的额外问题
