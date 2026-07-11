> **Status**: CURRENT

# Gateway UTXO 碎片化防复发设计 — consolidate cron + seeder 限流

**作者**: KANet-UI（2026-07-11，Owner"一鼓作气"派工②(a)）
**背景**: 今晚 28mln 结算撞到 gateway relay（broker-1）UTXO 碎片化——314 笔注的
`sweep_per_bet` 在几小时内把钱包打成 185 笔 UTXO（179 笔 <1KAS），首注 confirm
时 KIP-9 storage mass 超限直接失败（`Storage mass exceeds maximum`）。手工跑了
3 轮 `split-utxos` 才清干净（185→20→...→16，`<1KAS` 归零）。本设计把这个手工
救火动作变成常驻防线，同时给碎片化的源头（seeder 高频挂单+高频 sweep）加限流。

## §1 根因回顾（今晚实测，非猜测）

- `sweep_per_bet`（`pool.js` register-v07/confirm 成功后 fire-and-forget 触发）
  每笔 bet 往 gateway 钱包扫回一笔 dust 级找零/报销 UTXO，28mln 314 笔 = 314 次
  独立小额入账，天然产生大量碎片。
- `market-seeder.js` 5 分钟 tick 持续挂新盘，每盘的 maker stake 锁仓 + register
  流程都经过同一个 gateway relay，碎片累积速度 > 自然消耗速度。
- `mining-utxo-consolidate.mjs`（既有 #34 Direction C 方案）只盯**单一硬编码
  mining relay**（`MINING_RELAY_ID` env），完全没覆盖 gateway/maker relay 这一类
  ——这次碎片化根本没人监控，直到实战撞见才发现。

## §2 方案 A：gateway consolidate cron（复用 #34 模式，扩展目标范围）

**不新造机制** — `mining-utxo-consolidate.mjs` 的 tick/alert/dedupe 骨架已经
证明可用（今晚 3 轮手工操作走的是它的姊妹端点 `/api/relay/:id/split-utxos`，
同一套底层 `utxo-split.mjs`）。改动点：

1. **目标范围从"单一 relay"扩成"活跃 maker/gateway relay 列表"**：
   `SELECT DISTINCT maker_relay_id FROM pool_markets WHERE protocol_status NOT IN ('completed','cancelled','archived','refunded') AND created_at > datetime('now','-7 days')`
   —— 只盯近期有实际挂单活动的 relay，不扫全表（避免对早已 dormant 的老 relay
   做无意义轮询）。
2. **consolidate 策略用 `split-utxos`（N 等分）不是 `consolidate_utxo`（N→1）**：
   mining relay 只需要"能被 getUtxosByAddresses 读出来"，gateway relay 还要
   持续对外付款（register_append funding、退款、broker fee），N→1 会让下一笔
   funding 操作又要单独拆分一次；`targetCount=20`（今晚验证过的值）保持多笔
   可用面额，用完即补。
3. **触发阈值**：复用 #34 的 `ALERT_THRESHOLD` 语义，但拆两级——
   - `<1KAS` 计数 > 50 → 触发 consolidate（今晚 J2test 撞坏时是 179，broker-1
     健康时只有 3；50 是留出安全边界的保守线，具体数字建议 NWT 红队时结合
     `pool_markets` 平均并发注册量核一次）。
   - `<1KAS` 计数 > 150 → 额外写 `events` 表 warn（同 #34 tripwire 语义，提醒
     operator 这个 relay 可能马上要撞 register-v07/confirm 的 mass 墙）。
4. **tick 间隔**：5 分钟（跟 seeder tick 对齐，不需要 mining 那种 1 分钟高频——
   gateway 碎片化速度是"笔/秒"量级的下注事件驱动，不是 mining 那种"块/秒"量级）。

### 伪代码骨架（复用 `_writeAlertEvent`/`_alertIfOverThreshold` 模式）

```js
// gateway-utxo-consolidate.mjs（新文件，姊妹于 mining-utxo-consolidate.mjs，非改造它）
async function gatewayConsolidateTick() {
  const relayIds = sqlite.prepare(`
    SELECT DISTINCT maker_relay_id FROM pool_markets
     WHERE protocol_status NOT IN ('completed','cancelled','archived','refunded')
       AND created_at > strftime('%s','now') - 7*86400
  `).all().map(r => r.maker_relay_id);
  for (const relayId of relayIds) {
    const r = await sendCommandAsync(relayId, { type: 'get_utxo_summary' }); // 需要 relay 侧补一个只读 summary 命令,别每次全量拉
    if (!r?.ok) continue;
    const under1kas = r.entries.filter(e => Number(e.amount) < 100_000_000).length;
    if (under1kas > 50) {
      await splitUtxos(relayId, 20, { force: true }); // 复用既有 utxo-splitter.js,今晚验证过的同一条路径
    }
    if (under1kas > 150) _writeAlertEvent('gateway_utxo_drift', ...);
  }
}
```

**需要 J2 补的缺口**：relay 侧目前没有"只读 UTXO 计数摘要"命令（我今晚是直连
RPC `getUtxosByAddresses` 查的，不是走 relay IPC）——如果这个 cron 跑在
console 进程里且要通过 relay-manager 的 `sendCommandAsync`，需要确认走哪条路
更省资源（直连 RPC vs relay IPC），这条我不确定哪个是既有惯例，请 J2 定。

## §3 方案 B：seeder 限流

`market-seeder.js` 当前 5 分钟 tick 无节流开关，每 tick 可能挂多少盘取决于
`tick()` 内部逻辑（未细读，J2 域）。今晚的碎片化不是 seeder 单独造成的（主因
是 314 笔 bettor 注册的 sweep），但 Bettor 派工把"seeder 限流"和"consolidate
cron"放一起，方向应该是：**seeder 挂盘速率也要有一个防雪崩阀门**，避免"多个
盘同时进入热下注期"时 gateway 碎片化速度叠加失控。

最小改动（不新增复杂限流算法，复用现有 tick 节奏）：
- seeder tick 内部加一个"本 tick 最多挂 N 盘"上限（`MAX_MARKETS_PER_SEEDER_TICK`
  env，默认给一个保守值如 3——具体数字需要 J2 结合当前市场创建吞吐量定，我没
  有该模块的历史挂盘速率数据）。
- 如果 §2 的 gateway consolidate cron 检测到某个 relay 碎片化已经越过 warn
  阈值（150），seeder 对**同一个 relay**新开盘应该暂停，直到 consolidate 追上
  ——这条需要 seeder 读一下 gateway consolidate cron 的最近状态（简单实现：
  查 `events` 表最近一条 `gateway_utxo_drift` 是否在 X 分钟内且未 resolve）。

## §4 验收标准（提议，NWT/Bettor 定稿）

1. 离线：合成一个 relay 快速堆 200 个 dust UTXO，跑 tick，验证 consolidate 触发
   + `<1KAS` 计数降到目标区间。
2. 在线：观察至少一个真实高频市场（比如下一个大盘）的 gateway relay 碎片化
   曲线，确认 cron 介入后没有再复现今晚的"179 笔 dust 挡住 confirm"场景。
3. seeder 限流：验证同一 relay 碎片化告警期间新挂盘确实被延后，告警解除后
   恢复正常节奏。

## §5 我没做的部分（诚实标注）

- 没有直接改代码——按今晚纪律（钱路/结算相关改动先报计划），这是设计稿，
  落码需要 J2 审后再定分工。
- relay 侧是否需要新增 IPC 命令（`get_utxo_summary`）我没有把握，需要 J2 确认
  现有命令集里有没有等价物，避免重造。
- seeder 具体挂盘速率的历史数据我没有查（不是我的域），§3 的 `N=3` 只是占位
  保守值，不是实测推导出来的数字。
