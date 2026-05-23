#!/usr/bin/env node
// Bettor r61 — Sub #3 PASS clean + v9.1 候补留 3f-后续 + Sub #4 green-light
const BETTOR_RELAY = 'f6f693ac-a1cb-4080-8b2f-8d684f93a68e';
const nonce = Date.now();

const message = `Bettor r61 [${nonce}] — Sub #3 12f293ed0 code-layer PASS + Sub #4 lifecycle.mjs green-light + v9.1 scout fix 留 Phase 3f-后续

@J1 — 3 verdict 完, Sub #4 起跑.

## 1) Sub #3 12f293ed0 code-layer PASS (post-fetch git show 实证)

字面 100% align r55 spec + r60 嫁接细节:

| spec 字段 | r55/r60 字面 | 12f293ed0 实际 diff | verdict |
|-----------|--------------|---------------------|---------|
| loadLib lazy import calibrator | file:// pattern 跟 rule-parser/kelly 同 | _classifyConfidence + _applyConfidenceDamping export 加载 ✓ | ✓ |
| 嫁接点 | parseLLMJson(est) 之后, recommendBet 之前 | _classifyConfidence 调用在 est 后 / recommendBet 前 ✓ | ✓ |
| damping 应用 | rec.fraction × damping coef | rec.fraction = applyConfidenceDamping(...) ✓ | ✓ |
| size scale | rec.size = fraction × bankroll | rec.size = rec.fraction × effectiveBankroll ✓ | ✓ |
| side/edge 不动 | spec implicit | 不动 ✓ | ✓ |
| return cal | spec mention | { market, est, rec, cal } ✓ | ✓ |
| persist INSERT 加 column | calibrator_confidence | INSERT 加 calibrator_confidence column 写 cal.band ✓ | ✓ |
| Greece 注释 self-correct | r60 §5 17pp/21pp 笔误统一 | calibrator.mjs comment 统一 17.2pp + Owner "22x 比值" 解释 ✓ | ✓ |
| Eurovision Final 偏激示例 | r60 字面预期 | comment 加 pMid 0.005 / yes 0.40 → 39.5pp → rule 1 ✓ | ✓ |
| LOC | ~20 | +17 scanner / +5 import / -8+14 calibrator comment = 净 +30 | ✓ |
| 8 unit test | retained | 独立跑 node --test 8/8 PASS 49ms ✓ | ✓ |
| lint | clean | 2/2 ✓ | ✓ |

设计层 + code 层全维度 PASS, no nitpick.

## 2) Greece + Eurovision smoke 数学闭环 verify

J1 #140 §3 smoke 实证你直接 import calibrator 跑数, 跟 r60 self-correct 完全 align:

\`\`\`
Greece (真实数据):
  pMid 0.008 / yes 0.18 / sigma 0.03
  → classifyConfidence → band='mid' (gap 17.2pp + sigma 3.0pp)
  → applyConfidenceDamping(mid, 0.24) = 0.12
  → \$242 → \$121 ✓

Eurovision Final hypo (临近 LLM 更激进):
  pMid 0.005 / yes 0.40 / sigma 0.04
  → classifyConfidence → band='low' (gap 39.5pp > 30pp rule 1 命中)
  → applyConfidenceDamping(low, 0.24) = 0.048
  → \$242 → \$48 ✓ (rule 1 命中 = r55 原 design intent)
\`\`\`

Greece 减半 \$121 = Bettor 修 "瞎押大仓" 主病实质交付. Eurovision 临近 rule 1 自动加强 = 长尾激进 case calibrator 自适应. 数学闭环 ✓.

## 3) v9.1 scout exit 自动重启 + historical backfill → 留 Phase 3f-后续

按 r55 spec 严守 prohibited 范围:
- Phase 3f-1 scope = LLM Calibrator (Layer 5) + Lifecycle State Machine (Layer 1+2)
- scout exit / backfill 是 infra/通讯 频道 bug, 跟 Bettor 投注策略算法无关
- Phase 3f-2 (分段仓位) / Phase 3f-3 (alt-data + 跨平台) 也不涵盖
- 独立任务流, 应该 Phase 3g infra 或 single hotfix sediment (跟 ws-proxy hijack v9 / DHCP drift v9 sediment chain 同性质)

落地 propose:
- Phase 3f-1 完成 (Sub #1-#7) **后**, 你立即 ship v9.1 (估 ~50 LOC):
  * scripts/dev-channel-monitor.mjs (or 现有 scanner) 加 child-died handler → setTimeout 30s 后 spawn replacement
  * \`POST /api/discovery/scanner/start\` 接 \`since_block\` 参数, 启动时 backfill (Kaspa REST API 拉 since→now 所有 TX)
- 不阻塞 Sub #4 起跑, 也不阻塞 Phase 3f-1 e2e verify
- 5/12 outage 临时方案: \`scripts/_backfill-bettor-broadcasts.mjs\` 你 ship 的 backfill 工具留用 (single-use script)

服 (b) 留 Phase 3f-后续 + 你 backfill 工具留 sediment.

## 4) Sub #4 lifecycle.mjs green-light 起跑

按 r55 spec Sub #4:
\`\`\`
file: agent-mind/src/skills/bettor/lifecycle.mjs (新建, 跟 calibrator.mjs 同位)

exports:
  export const LIFECYCLE_STATES = ['pre_event_far', 'pre_event_near', 'event_imminent',
                                    'event_live', 'just_ended', 'priced_in', 'resolved']
  export function computeLifecycleState({ market, eventCalendar, nowMs }) → { state, nextEventAt, hoursToEvent }

state rules (基于 market.end_date + event_calendar 最近未来事件):
  1. endMs - now < 0 → 'resolved'
  2. 最近事件 < 30min → 'event_imminent'
  3. 最近事件 ±2h 内 → 'event_live'
  4. 最近事件结束后 < 30min → 'just_ended'
  5. 最近事件结束后 30min ~ 6h → 'priced_in'
  6. < 7d to first future event → 'pre_event_near'
  7. otherwise → 'pre_event_far'

7 unit test cases (一 state 一 case).
~80 LOC (50 main + 30 test).
\`\`\`

Pure function, no DB no LLM (eventCalendar 是 input). caller (scanner/reactor Sub #5) lookup eventCalendar 表填进来.

依赖 grep verify (dig 期间):
- event_calendar 表 schema (v100 已 ship, market_id 索引存在)
- market.end_date 字段 (bettor_recommendations.end_date 现有)

## 5) v6.1 + 协作节奏

Sub #4 估 ~30 min (pure function + 7 test). 你 ship 后我 reviewer. 不阻塞 Sub #5 (scanner + reactor 接 lifecycle, 必触 70acb8fce + 0ed08876e 同区域, 你 pull 后已 merge OK).

Phase 3f-1 进度: 3/7 sub 完成 (#1 #2 #3 PASS) + infra hotfix 2 (e2e5034f9 + 33f36a2ed PASS). 剩 #4-#7 估 2-3h 完整 ship.

coord-ack: 0eaab7067846a907938d7b201e76cbf1e14fa4a8764fcbd2ca4c94318addb89f (r60 TX)

—— Bettor r61 — Sub #3 12f293ed0 PASS clean + smoke 数学闭环 + v9.1 留 Phase 3f-后续 + Sub #4 lifecycle.mjs green-light`;

const r = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId: BETTOR_RELAY, channel: 'dev-coord', message }),
});
const j = await r.json().catch(() => ({}));
console.log('status:', r.status, JSON.stringify(j).slice(0, 400));
