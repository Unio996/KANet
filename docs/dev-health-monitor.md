# Health Monitor + Self-Healing — Developer Documentation

> **Read this before touching health/self-healing code. 3 minutes prevents 90% of mistakes.**

---

## Fatal Traps (First 30 Seconds)

0. **不猜代码，查了再写。** 列名用 `PRAGMA table_info`，函数名用 grep，参数名看调用方。记忆不可信，代码是唯一真相。每次引用前先验证，零例外。

1. **Agent 目录名有下划线。** Mind 写 `minds/kasia_1/`（`config.name.toLowerCase()`），Health 读取时必须用 `replace(/[^a-z0-9_]/g, '')`（保留下划线）。曾因 `replace(/[^a-z0-9]/g, '')` 丢掉下划线导致 Kasia_1 假红灯 4 天。见 `agent-health.js:127`。

2. **Health check 首次执行必须显式调用。** `setInterval` 首次执行在一个周期后（30 分钟），不是立即。`_runHealthCheck()` 必须在 `setTimeout` 回调中先调一次再注册 interval。见 `mind-manager.js` health check loop。

3. **Relay down = 短路，不查其他指标。** `computeOne()` 检测到 relay 不在 `_relays` 中 → 立即返回 `{ status: 'red', reason: 'relay_down', indicators: null }`。后续代码不能假设 `indicators` 非空。

4. **reflection lastReflectionTime 必须始终更新。** `mind.mjs runReflection()` 中，不管 AI 返回的 JSON 是否合法，都要更新 `kernels.evolution.lastReflectionTime` 并 `save()`。否则每次重启都会重复触发 overdue reflection。见 `mind.mjs:565-568`。

5. **同伴通知有 4 小时冷却。** `notifyOwnerAboutPeer()` 用 `_notifiedPeers` map 追踪。同伴恢复后 `clearPeerNotification()` 重置。不要绕过冷却直接调 `alertOwner`。

---

## Architecture

```
Health Check Loop (mind-manager.js, 每 30 分钟)
  │
  ├── computeAllHealth() ← agent-health.js
  │   ├── getRelayStatus() ← relay-manager.js (进程存活)
  │   ├── getAllAdapterStatus() ← adapter-launcher.js (进程存活)
  │   ├── 7 项 SQL 查询 ← events + chain_events 表
  │   └── reflections.json ← lastReflectionTime 字段
  │
  ├── 自己是绿 → recordMindEvent('health_ok')，如果之前红 → 解除 _healthPaused
  ├── 自己是黄 → silentRepair() ← self-healing.js
  ├── 自己是红 → emergencyRepair() + _healthPaused = true
  └── 同伴是红 → notifyOwnerAboutPeer()（4h 冷却）
```

## Files

| File | Role |
|------|------|
| `kasia-console/src/services/agent-health.js` | 7 项指标计算 + 红绿灯判定 + 30s 缓存 |
| `kasia-console/src/services/self-healing.js` | silentRepair / emergencyRepair / notifyOwnerAboutPeer |
| `kasia-console/src/services/mind-manager.js` | _healthPaused 标志 + health check 定时循环 + proactive 暂停检查 |
| `kasia-console/src/api/health.js` | `GET /api/health/agents` 端点 |
| `kasia-console/src/ui/agent.eta` | Status 选项卡（第 6 个 tab） |

## API

**`GET /api/health/agents`**

返回：
```json
{
  "ts": "2026-03-29T05:00:00Z",
  "agents": [{
    "name": "Martin",
    "address": "kaspa:qptg...",
    "status": "green",          // green | yellow | red
    "reason": null,              // 非绿时：哪个指标触发的
    "indicators": {              // relay_down 时为 null
      "adapter": "green",
      "lastEvent": "green",
      "proactive": "green",
      "reflection": "green",
      "errors": "green",
      "blocks": "green",
      "payFails": "green"
    },
    "stats": {
      "lastEvent": "ISO",
      "lastProactive": "ISO",
      "lastReflection": "ISO",
      "errors2h": 0,
      "blocks2h": 0,
      "payFails24h": 0,
      "active2h": 550,
      "silent2h": 1
    }
  }],
  "summary": { "total": 4, "green": 4, "yellow": 0, "red": 0 }
}
```

缓存 30 秒，页面 60 秒轮询。

## 红绿灯阈值

| 指标 | 绿 | 黄 | 红 |
|------|-----|-----|-----|
| Relay/Adapter 进程 | 运行中 | — | 未运行 |
| 最近事件 | <30min | 30min-2h | >2h |
| Proactive | <间隔×2 | <间隔×4 | >间隔×4 |
| Reflection | <间隔×2 | <间隔×4 | >间隔×4 |
| 错误 (2h) | <3 | 3-10 | >10 |
| 拦截 (2h) | <3 | 3-10 | >10 |
| 支付失败 (24h) | 0 | 1-2 | >=3 |

## Self-Healing 修复动作

| 方法 | 触发 | 调 Brain？ | 动作 |
|------|------|-----------|------|
| silentRepair | 黄色 | 否 | reflection 超时→触发 reflection；blocks 异常→清理目标 |
| emergencyRepair | 红色 | 否 | 同上 + adapter 挂→重启 adapter；支付失败→暂停交易 |
| notifyOwnerAboutPeer | 同伴红色 | 否 | recordMindEvent 记录告警（4h 冷却防重复） |

## proactive 暂停机制

```js
// mind-manager.js
const _healthPaused = {};  // agentName → true

// proactive 循环开头：
if (_healthPaused[name]) { console.log(`paused — health red`); return; }

// health check 恢复：
if (a.status === 'green' && _healthPaused[agentName]) {
  delete _healthPaused[agentName];  // 解除暂停
}
```
