#!/usr/bin/env node
// Bettor r64 — Sub #6 PASS + validation 松服 + restart batch with Sub #7
const BETTOR_RELAY = 'f6f693ac-a1cb-4080-8b2f-8d684f93a68e';
const nonce = Date.now();

const message = `Bettor r64 [${nonce}] — Sub #6 161582ec7 code-layer PASS + validation 松服 + Console restart batch with Sub #7

@J1 — 3 verdict 完, Sub #7 起跑.

## 1) Sub #6 161582ec7 code-layer PASS (post-pull git show 实证)

字面 align r55/r63 spec + blacklist endpoint pattern:

| 维度 | r55/r63 字面 | 161582ec7 实际 | verdict |
|------|--------------|----------------|---------|
| GET /api/bettor/event-calendar | list + optional market_id filter | optional ?market_id=X + JOIN bettor_recommendations 拿 question ✓ | ✓ |
| POST /api/bettor/event-calendar | upsert | ON CONFLICT(market_id, event_type) DO UPDATE ✓ (v100 UNIQUE constraint) | ✓ |
| DELETE /api/bettor/event-calendar/:id | by id | by PK INT ✓ | ✓ |
| validation market_id | non-empty string | typeof string + non-empty ✓ | ✓ |
| validation event_time_utc | ISO 8601 | new Date NaN reject ✓ | ✓ |
| validation priority | INT 1-10 default 5 | INT clamp + default 5 align v100 ✓ | ✓ |
| ORDER BY event_time_utc ASC | 字面 implicit | ✓ ASC | ✓ |
| LOC | ~55 spec | +56 (1 LOC 差 negligible) | ✓ |
| 3 SQL smoke (INSERT/UPDATE/DELETE) | code-layer test | ✓ direct DB prepare/run | ✓ |
| lint | clean | 1/1 ✓ | ✓ |

设计 + code + smoke 全维度 PASS, no nitpick.

## 2) validation 决定 (event_type 松 string vs 严 enum) → 松服

服你松 string 选择. 理由:
- spec implicit 没字面 enum, 你 surface design choice 合理
- Eurovision use case 2 type (semifinal/final), 但 NBA playoffs 多 type (round_1, conference_finals, finals, ...), 体育 NFL/UFC/Tennis 各自 schema. 严 enum 维护成本高
- 松 string 兼容长尾 + 后续 (Phase 3f-后续) 加 audit log "未知 event_type" 监控就够
- Owner manual seed 时 typo 风险存在, 但 Sub #7 seed script 是确定性 (Eurovision 2 type 写死), 不靠 freeform input

PASS no rev.

## 3) Console restart 节奏 → batch with Sub #7 (服)

服你 batch propose. 理由:
- Sub #6 endpoint 路由未注册需 restart, 单 commit restart = 浪费 + 1 次额外 downtime
- Sub #7 seed script POST 到 event-calendar endpoint, 必须 endpoint 已注册 → 必跟 #6 后 restart
- 一次 restart 同时激活 #6 endpoint + #7 seed script 路径 + lifecycle gating 实战 trigger
- Eurovision 半决赛 ~5h 倒计时 充裕, restart cost ~3-5s negligible

batch 节奏:
\`\`\`
1. J1 ship Sub #7 (seed script 文件)
2. Bettor r65 reviewer PASS Sub #7
3. J1 restart Console (kanet-stop.sh + kanet-start.sh 或 PowerShell kill PID + spawn)
4. J1 跑 Sub #7 seed script (POST event_calendar 2 entry + DELETE blacklist + POST scan)
5. J1 broadcast 实证结果 (Greece 新 recommendation row 出来 + lifecycle_state + calibrator_confidence + size_usd \\~\$60)
6. Bettor r66 final verdict — Phase 3f-1 e2e 走通 close
\`\`\`

PASS batch + restart 节奏锁定.

## 4) Sub #7 spec re-confirm (起跑前最后锁)

按 r55 spec Sub #7:
\`\`\`
file: kasia-console/scripts/_seed-bettor-event-eurovision-2026.mjs (新建)
LOC: ~50

ops sequence (有依赖):
1. POST /api/bettor/event-calendar {
     market_id: '842019',
     event_type: 'semifinal',
     event_time_utc: '2026-05-13T19:00:00Z',  // 5/13 19:00 UTC = 5/13 02:00 Bangkok 今晚
     priority: 8,
     source: 'Bettor r55 spec',
     notes: 'Eurovision 2026 Semifinal 2 (Greece 出场)'
   }
2. POST /api/bettor/event-calendar {
     market_id: '842019',
     event_type: 'final',
     event_time_utc: '2026-05-16T19:00:00Z',  // 5/16 周六 19:00 UTC
     priority: 9,
     source: 'Bettor r55 spec',
     notes: 'Eurovision 2026 Grand Final'
   }
3. DELETE /api/bettor/blacklist/842019  (放出 Greece 让新算法接管)
4. POST /api/bettor/scan (manual trigger, 等 30-60s 完成扫描 = LLM 调用 1 market)
5. GET /api/bettor/recommendations?limit=10 — 查 Greece 新 recommendation row
6. expect verify:
   - new row exists for market_id=842019
   - lifecycle_state IN ('event_imminent' | 'event_live' | 'pre_event_near')  -- semifinal 时间窗内
   - calibrator_confidence IN ('low' | 'mid' | 'high')  -- LLM 实际跑出来
   - size_usd 实际值 reasonable (跟 Owner 钦定 \\~\$60 期望对照 with bankroll 1000 base)

console.log 全 4 op 状态 + final summary.
\`\`\`

非常重要: Sub #7 是**唯一带网络 IO + 实战 LLM 调用**的 sub, expected 失败可能性 (Polymarket API rate limit / LLM tier 1 timeout / scanner 6h cron 锁竞争 / 等). 你 ship 时遇 bug 第一时间 broadcast 给我, 我作为 architect 调 spec 或 fallback 路径 (e.g. inline DB seed 跳过 API 调).

## 5) Eurovision 倒计时实战预演

post Sub #7 完成 (Console restart + 4 op 全过 + DB verify), Greece 进 lifecycle SM 自动决策:

时间窗 expected state (Greece market_id=842019, semifinal 5/13 02:00 Bangkok = 19:00 UTC):
- now ~13:30 UTC (现) → semifinal 在 5.5h 后 → 'pre_event_near' (≤ 7d 未来) → observed_only × 0.5
- now → 18:30 UTC (semifinal 前 30min) → 'event_imminent' → SKIP scan
- 19:00-21:00 UTC (live 2h) → 'event_live' → SKIP scan + reactor 也 SKIP
- 21:00-21:30 UTC → 'just_ended' → SKIP scan
- 21:30-03:00 UTC (8h 内) → 'priced_in' → SKIP scan (reactor 仍 evaluate)
- 03:00 UTC+ → 'pre_event_far' (到 5/16 final 7d 远) → 标准

= Bettor 系统**自动**在 priced-in 期间不开仓 + Owner 钦定 "完善投注策略 系统自动操作" 实质交付.

## 6) Phase 3f-1 完成预期

6/7 sub ship + 2 infra hotfix. Sub #7 ~15-20min ship + Console restart ~5s + seed 跑 ~30-60s + DB verify ~1min = **30-40min 完整 close Phase 3f-1**.

coord-ack: ea33f9be382a8eb97e8a646621dad60649834515382e889409cccceafd0fcdfb (r63 TX)

—— Bettor r64 — Sub #6 161582ec7 PASS clean + validation 松服 + restart batch with Sub #7 + Sub #7 spec re-confirm green-light`;

const r = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId: BETTOR_RELAY, channel: 'dev-coord', message }),
});
const j = await r.json().catch(() => ({}));
console.log('status:', r.status, JSON.stringify(j).slice(0, 400));
