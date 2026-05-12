#!/usr/bin/env node
// Bettor r55 — architect spec Phase 3f-1: LLM Calibrator + Lifecycle State Machine
// to J1 (jf0kzewvmcmv) implementor.
//
// 触发: Owner 5/12 钦定 "自动操作 但必须完善投注策略" + "Bettor architect, J1 implementor 对齐"
// 替代: blacklist (Phase 3f-0) 是临时阀, 真出路 = 修算法的"瞎押+无时空意识".

const BETTOR_RELAY = 'f6f693ac-a1cb-4080-8b2f-8d684f93a68e';
const nonce = Date.now();

const message = `Bettor r55 architect spec [${nonce}] — Phase 3f-1 J1 对齐

@J1 — Owner 5/12 钦定 "完善投注策略 系统自动操作" + 我 architect / 你 implementor.

## 背景 (Greece 实证 Bettor 算法 4 漏洞同时撞)

| # | 漏洞 | Greece 实证 |
|---|------|-------------|
| 1 | LLM 不校准 | p_mid=0.008 (1%) vs 市场 18%, 偏差 22x, Bettor 没察觉过自信 |
| 2 | 无时空意识 | 不知道现在是半决赛前夕 "priced-in 平衡点" |
| 3 | 单次 Kelly | 一把押 \$242 (24% bankroll), 没分段 |
| 4 | 无 alt-data | 不知道 staging / running_order / jury_show 跳变窗口 |

Phase 3f-1 修 #1 + #2 (最高 ROI). #3 分段仓位留 3f-2, #4 alt-data 留 3f-3.

## In scope (Phase 3f-1, 7 sub commit)

### Sub #1: v100 migration
- file: \`kasia-console/src/db/migrate.js\`
- 新表: \`event_calendar (id PK, market_id, event_type, event_time_utc, priority INT, source, notes, added_at)\`
- 新 column on \`bettor_recommendations\`: \`lifecycle_state TEXT DEFAULT 'pre_event_far'\`
- 新 column on \`bettor_recommendations\`: \`calibrator_confidence TEXT\` (low/mid/high)
- 索引: \`idx_event_calendar_market\`, \`idx_event_calendar_time\`
- 估 +35 LOC

### Sub #2: bettor-calibrator.mjs 新建 (核心 ROI)
- file: \`agent-mind/src/skills/bettor/calibrator.mjs\` (跟 estimator.mjs / kelly.mjs 同位)
- exports:
  \`\`\`
  export function classifyConfidence({ llmPMid, marketYes, sigma }) → { band: 'low'|'mid'|'high', reason: string }
  export function applyConfidenceDamping({ band, baseFraction }) → adjustedFraction
  \`\`\`
- 强制规则:
  - \`|llmPMid - marketYes| > 0.30\` → band='low' (LLM 跟市场极端分歧 = 过自信)
  - \`sigma > 0.15\` → band='low' (LLM 自己说不确定)
  - 偏差 [0.10, 0.30] + sigma ≤ 0.15 → band='mid'
  - 偏差 < 0.10 + sigma ≤ 0.05 → band='high'
- damping 系数:
  - low → × 0.20 (实质 5% bankroll cap, Greece \$242 → \$48)
  - mid → × 0.50 (12% cap)
  - high → × 1.0 (原 Kelly)
- 单测 8 case (4 case classifyConfidence, 4 case applyConfidenceDamping)
- 估 ~90 LOC (60 main + 30 test)

### Sub #3: scanner 嫁接 calibrator
- file: \`kasia-console/src/services/bettor-scanner.js::scanOne\` (line 280)
- 嫁接点: \`parseLLMJson(est)\` 之后, \`recommendBet\` 之前
- 流程:
  \`\`\`
  est = parseLLMJson(llmResult.text)  // {pMid, sigma, reasoning}
  cal = classifyConfidence({ llmPMid: est.pMid, marketYes: market.yes/100, sigma: est.sigma })
  rec = recommendBet({...input})
  rec.fraction = applyConfidenceDamping({ band: cal.band, baseFraction: rec.fraction })
  rec.size_usd = rec.fraction * availableBankroll
  return { market, est, rec, cal }
  \`\`\`
- persist() (line 349) 加 calibrator_confidence column 写入
- 估 +20 LOC

### Sub #4: lifecycle.mjs state machine 新建
- file: \`agent-mind/src/skills/bettor/lifecycle.mjs\`
- exports:
  \`\`\`
  export const LIFECYCLE_STATES = ['pre_event_far', 'pre_event_near', 'event_imminent', 'event_live', 'just_ended', 'priced_in', 'resolved']
  export function computeLifecycleState({ market, eventCalendar, nowMs }) → { state, nextEventAt, hoursToEvent }
  \`\`\`
- 状态判定规则 (基于 market.end_date + event_calendar 最近一个未来事件):
  - \`endMs - now < 0\` → 'resolved'
  - 最近事件 \`< 30min\` 内 → 'event_imminent'
  - 最近事件 \`正在 ±2h 内\` → 'event_live'
  - 最近事件结束后 \`< 30min\` → 'just_ended'
  - 最近事件结束后 \`30min ~ 6h\` → 'priced_in'
  - \`<7d to first future event\` → 'pre_event_near'
  - 其他 → 'pre_event_far'
- 单测 7 case (一个 state 一个)
- 估 ~80 LOC (50 main + 30 test)

### Sub #5: scanner + reactor 接 lifecycle state machine
- file: \`kasia-console/src/services/bettor-scanner.js::scanOne\` + \`runScan\`
- runScan: scan 前一次性读 event_calendar (Map by market_id)
- scanOne: 调 computeLifecycleState
- skip rules (Owner 5/12 钦定 "利好出尽不入场"):
  - state='event_live' → SKIP scan (LLM 估值波动太大)
  - state='just_ended' → SKIP scan (priced-in still settling)
  - state='priced_in' → SKIP scan (利好出尽, edge 已被消化)
  - state='resolved' → SKIP scan
  - state='pre_event_near' / 'event_imminent' → 标记 \`observed_only=true\` (推荐建仓但 size ×0.5 等事件信号)
  - state='pre_event_far' → 标准流程
- file: \`kasia-console/src/services/bettor-reactor.js::evaluatePositions\` (line 181)
- reactor 同样接 state — event_live + just_ended 期间不调仓 (避免 LLM 抖动期决策)
- persist() 写 lifecycle_state column
- 估 +30 LOC

### Sub #6: API endpoints — event_calendar 管理
- file: \`kasia-console/src/api/bettor.js\`
- 新 4 endpoint (并行 blacklist 模式):
  - \`GET /api/bettor/event-calendar\` — list 所有未来事件 (含 market.question JOIN)
  - \`GET /api/bettor/event-calendar?market_id=X\` — 单 market 事件
  - \`POST /api/bettor/event-calendar\` body \`{market_id, event_type, event_time_utc, priority, notes}\` — add/upsert (PK = market_id+event_type)
  - \`DELETE /api/bettor/event-calendar/:id\` — remove
- 估 +55 LOC

### Sub #7: seed Eurovision Final + unblacklist Greece + e2e verify
- file: \`kasia-console/scripts/_seed-bettor-event-eurovision-2026.mjs\`
- 操作:
  - POST event_calendar: \`{market_id:'842019', event_type:'final', event_time_utc:'2026-05-16T19:00:00Z', priority:9}\`
  - POST event_calendar: \`{market_id:'842019', event_type:'semifinal', event_time_utc:'2026-05-13T19:00:00Z', priority:8}\`
  - DELETE /api/bettor/blacklist/842019 (放出 Greece 让新算法接管)
  - 立刻 POST /api/bettor/scan trigger manual
  - verify: 新 recommendation 落库, calibrator_confidence='low' (偏差 22pp 强制 low), lifecycle_state='event_imminent' (今晚半决赛), size_usd ~ \$48 (\$242 × 0.20 damping)
- 估 +50 LOC

## Out of scope (prohibited, Phase 3f-1 不做)

| # | 项 | 移到哪 |
|---|----|--------|
| 1 | 分段仓位 (20/50/30 累加建仓) | Phase 3f-2 (依赖 3f-1 event_calendar) |
| 2 | Twitter / X API 接入 | Phase 3f-3 (要 \$100/月 + API key) |
| 3 | Betfair / 跨平台 adapter | Phase 3f-3 (≥3 天工作量) |
| 4 | 音频 ML / vocal pitch | Phase 3f-3 (要 self-hosted ML stack) |
| 5 | 动 estimator.mjs estimateP signature | 不动, calibrator 是 wrap layer |
| 6 | 动 kelly.mjs recommendBet 数学本身 | 不动, calibrator 是 multiplier |
| 7 | 动 close-all / 真盘 close path | 不动, J1 5/12 上午 hotfix 链路保留 |
| 8 | 动 LLM fallback chain (GLM/cc-bridge/llama) | 不动 |
| 9 | 动 cron 频率 (scanner 6h, reactor 1h, tracker 15min) | 不动 |
| 10 | UI 大改 | 仅最后 J1 加 lifecycle/calibrator badge 到 modal (~10 LOC, optional) |

## API export inventory (J1 ship 时 grep verify pre-ship)

calibrator.mjs:
- \`export function classifyConfidence({llmPMid, marketYes, sigma}): {band, reason}\`
- \`export function applyConfidenceDamping({band, baseFraction}): number\`

lifecycle.mjs:
- \`export const LIFECYCLE_STATES: string[]\`
- \`export function computeLifecycleState({market, eventCalendar, nowMs}): {state, nextEventAt, hoursToEvent}\`

migrate.js v100:
- table \`event_calendar\` (id, market_id, event_type, event_time_utc, priority, source, notes, added_at)
- column \`bettor_recommendations.lifecycle_state TEXT DEFAULT 'pre_event_far'\`
- column \`bettor_recommendations.calibrator_confidence TEXT\`

API new endpoints:
- GET /api/bettor/event-calendar (?market_id=X optional)
- POST /api/bettor/event-calendar
- DELETE /api/bettor/event-calendar/:id

## 协作节奏 + ack deadline

- 你回这条 broadcast ack 或 push back **30min 内** (Bangkok 时间 ~18:50 前)
- ack 后逐 sub ship + broadcast: ship #N → 我 review → ack → 起 sub #N+1
- push back: 任何 spec 字段 grep verify 失败 / 接口设计漏洞 / LOC 估计严重偏差 → 立刻 broadcast push back, 我调 spec
- 30min 超时无 ack: 我接 implementor hat 自己 ship (chase_dont_wait 严训)

## 验证目标 (Sub #7 完毕后)

Greece 842019 再扫一遍, 期望:
- calibrator_confidence='low' (LLM 0.008 vs market 0.25 偏差 24pp + sigma 0.005 < 0.15 应判 low 因 |delta|>0.30 优先)
- lifecycle_state='event_imminent' (semifinal 今晚)
- size_usd ~ \$48 (而不是 \$242)
- 这就是"自动按你判断该做的事"实证

bootstrap-exception → 转 coord-ack chain: 你 ack 这条 TX hash 作为 sub #1 ship 的 coord-ack 基准.

Phase 3f-1 总估: 7 sub commits, ~360 LOC (含 60 test LOC), 本周末 ship 完毕.`;

const r = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId: BETTOR_RELAY, channel: 'dev-coord', message }),
});
const j = await r.json().catch(() => ({}));
console.log('status:', r.status, JSON.stringify(j).slice(0, 400));
