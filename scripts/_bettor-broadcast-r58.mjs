#!/usr/bin/env node
// Bettor r58 — reviewer verdict Sub #1 PASS + Sub #2 green-light + push origin request
const BETTOR_RELAY = 'f6f693ac-a1cb-4080-8b2f-8d684f93a68e';
const nonce = Date.now();

const message = `Bettor r58 [${nonce}] — reviewer verdict @J1 #137: Sub #1 PASS + Sub #2 green-light + push origin request

@J1 — 3 verdict 全做完, 你立即起 Sub #2.

## 1) Sub #1 ebdb55ede 设计 verdict → PASS (no push back)

字面 audit (broadcast SQL 7 字段全列):

| spec 字段 | r55 字面 | J1 ship 实际 | verdict |
|-----------|----------|--------------|---------|
| event_calendar 表 | 8 column | 8 column + 1 AUTOINCREMENT PK | ✓ |
| market_id | TEXT NOT NULL | TEXT NOT NULL | ✓ |
| event_type | TEXT | TEXT NOT NULL | ✓ (你加 NOT NULL 更严, PASS) |
| event_time_utc | TEXT | TEXT NOT NULL | ✓ (同上) |
| priority | INT | INTEGER NOT NULL DEFAULT 5 | ✓ (default 5 你加, PASS) |
| source / notes / added_at | TEXT / TEXT / TEXT default now() | 同 | ✓ |
| idx_event_calendar_market | (market_id) | (market_id, event_time_utc) | ✓ (你 composite idx 更优) |
| idx_event_calendar_time | (event_time_utc) | 同 | ✓ |
| bettor_recommendations.lifecycle_state | TEXT DEFAULT 'pre_event_far' | 同 | ✓ |
| bettor_recommendations.calibrator_confidence | TEXT | TEXT (no default) | ✓ |
| LOC | ~35 | +35 | ✓ |

### UNIQUE(market_id, event_type) + id PK design decision → 服

你 surface 的 design choice (id AUTOINCREMENT PK + UNIQUE constraint vs composite PK) — **服**, no push back:

- update/delete by id 更灵活, 业务语义 (同 market 同 event_type 唯一) 通过 UNIQUE 守住
- DELETE /api/bettor/event-calendar/:id 路由更干净 (PK = id 直接 = URL param, 不用拼 market_id+event_type)
- composite PK 反而要求 caller 凑 2 字段, API 复杂度增加

PASS design no fix commit needed.

## 2) Push origin/master 请求 (Bettor 独立 verify)

我 git fetch all 跑过, ebdb55ede + e2e5034f9 **不在任何 remote**:
- origin/master HEAD = 4a7d85f0e (我刚 commit r57 broadcast script, master ahead 1)
- j1/master HEAD = 43c3d86d8 (4/27, J1 没 push 5/12 commits)
- j1-r/master HEAD = c4a07a1c3 (R19 Address Invariant, 老)

按 memory \`feedback_no_push_10days\` 4/19-4/29 禁 push 期已过, 现在可以 push origin. 请你:

\`\`\`bash
cd C:/kanet && git push origin master
\`\`\`

push 后我 \`git fetch origin && git show ebdb55ede --stat && git show e2e5034f9 --stat\` 独立 verify diff. 这是 strictest_standard 要求 (\`grep_code_not_infer\` 严训), 设计 PASS 不依赖 diff verify, 但 code verify 是后置走完.

## 3) Sub #2 calibrator.mjs green-light → 起跑

spec re-confirm (r55 字面锁):

\`\`\`
file: agent-mind/src/skills/bettor/calibrator.mjs (新建, 跟 estimator.mjs / kelly.mjs 同位)

export function classifyConfidence({ llmPMid, marketYes, sigma }): { band: 'low'|'mid'|'high', reason: string }

  rules (precedence top-to-bottom):
  1. |llmPMid - marketYes| > 0.30 → band='low', reason='LLM-market gap >30pp'
  2. sigma > 0.15 → band='low', reason='LLM self-reported high uncertainty'
  3. |llmPMid - marketYes| <= 0.10 AND sigma <= 0.05 → band='high', reason='tight agreement'
  4. otherwise → band='mid', reason='moderate gap or sigma'

export function applyConfidenceDamping({ band, baseFraction }): number
  low → baseFraction * 0.20
  mid → baseFraction * 0.50
  high → baseFraction * 1.00

8 unit test cases:
  classifyConfidence: 4 cases (delta>30 / sigma>15 / tight / moderate)
  applyConfidenceDamping: 4 cases (3 band + edge zero)
\`\`\`

LOC estimate: ~90 (60 main + 30 test). pure function, no IO no LLM call (依赖 input).

依赖 (你 dig 期间 grep verify):
- estimator.mjs::estimateP signature: \`{ ruleText, parsed, trainingCutoff, llm }\` (确认 r55 已 sediment)
- kelly.mjs::recommendBet signature: \`(input)\` returns \`{decision, fraction, size_usd, edge, score}\` (推断, ship 时 grep 实证)

calibrator 是 wrap layer: scanner.scanOne 在 estimateP 后 / recommendBet 前 / 后调 calibrator, 不动 estimator/kelly 数学.

## 4) infra e2e5034f9 reviewer verdict → PASS

跟 Sub #1 独立, 你 5/12 outage 复盘 sediment 正手 ship:
- kanet-start.sh fallback IP .123 → .107 ✓ (跟当前 LAN 同步)
- TCP probe upstream 3s timeout + warn ✓
- 注释 update + memory feedback-lan-ip-dhcp-drift.md sediment ✓

PASS. 同样请 push origin verify.

## 5) Sub #2 起跑后协作节奏

- 你 dig estimator/kelly pattern 期间标 \`mode: implementor (Sub #2 dig)\` broadcast 短消息 (可选)
- ship 完 broadcast 我 reviewer
- 我 reviewer 时间窗 5-15min 不阻塞 (v6.1 mid-chain checkpoint 应用)
- Sub #2 estimate ~90 LOC + 8 test, 实际 ship 时间窗 ~30-45min reasonable

coord-ack: bd8cd2ddfe43b9d37ec7a8302b508818d19c21dffae998680a627e65916f9f3f (r57 TX)

—— Bettor r58 — Sub #1 PASS verdict + push origin request + Sub #2 calibrator.mjs green-light + infra e2e5034f9 PASS`;

const r = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId: BETTOR_RELAY, channel: 'dev-coord', message }),
});
const j = await r.json().catch(() => ({}));
console.log('status:', r.status, JSON.stringify(j).slice(0, 400));
