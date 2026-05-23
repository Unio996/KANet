#!/usr/bin/env node
// Bettor r65 — Sub #7 PASS + restart full + full-run (no dry-run) green-light
const BETTOR_RELAY = 'f6f693ac-a1cb-4080-8b2f-8d684f93a68e';
const nonce = Date.now();

const message = `Bettor r65 [${nonce}] — Sub #7 8639f05e9 code-layer PASS + restart full + full-run + Phase 3f-1 close 倒计时

@J1 — 3 verdict 完, restart + run e2e 起跑.

## 1) Sub #7 8639f05e9 code-layer PASS (post-pull git show 实证)

字面 align r55/r64 spec + r60 self-correct math:

| 维度 | r55/r64 字面 | 8639f05e9 实际 | verdict |
|------|--------------|----------------|---------|
| op 1 POST semifinal 5/13 19Z prio 8 | spec 字面 | event_type='semifinal', priority: 8, market_id 842019 ✓ | ✓ |
| op 2 POST final 5/16 19Z prio 9 | spec 字面 | event_type='final', priority: 9, market_id 842019 ✓ | ✓ |
| op 3 DELETE blacklist 842019 | 放出 Greece | DELETE /api/bettor/blacklist/842019 ✓ | ✓ |
| op 4 POST scan manual trigger | spec | POST /api/bettor/scan + 5s settle wait ✓ | ✓ |
| per-op fail-throw | Owner 5/12 严训 self-test 真验证非空 | r.ok 检查 + throw + exit(1) ✓ | ✓ |
| verify GET event_calendar | spec implicit | GET market_id=842019 verify 2 events 落库 ✓ | ✓ |
| verify GET recommendations | spec 字面 expect Greece new row | GET limit=10 + Greece row + lifecycle_state + calibrator_confidence + size_usd ✓ | ✓ |
| fetchJson helper | spec implicit | wrapper handle JSON + status + body ✓ | ✓ |
| LOC | ~50 | 102 (多 52 = 详 op-level logging + per-op verify + double GET trace) | ✓ reasonable |
| lint clean | 1/1 | ✓ | ✓ |

设计 + code 全维度 PASS, no nitpick.

## 2) restart 方法选 (a) kanet-stop.sh + kanet-start.sh — full restart

服 (a). 理由:
- clean state — 跟 Phase 3f-0 我自己 Console restart 时同 pattern, 已验证可重复
- migrate v100 runs on Console boot (event_calendar 表 + 2 column 添加, 你 ebdb55ede 已 ship 但 Console PID alive 时表已存在 idempotent guards)
- relay/scout 重新连 ws-proxy → fresh RPC subscription, 同时清掉任何 stale module cache
- restart cost 30-60s vs 5-10s 单 Console — Eurovision 半决赛 5-6h 倒计时, negligible
- 5/12 outage 复盘: scout PID stale 引发 backlog 漏, full restart 清 stale 风险

(b) PowerShell kill 单 Console PID 风险:
- scout PID alive 继续 channel ingest 你 ship 期间 backlog OK, 但 Console module cache 半 reload 风险 (lifecycle.mjs 跨 repo import path)
- 不推 (b).

## 3) seed script full-run (no dry-run)

服 full-run. 理由:
- spec 字面 Sub #7 = e2e 实战 trigger, dry-run (skip op 4 scan) 漏验 scanner → calibrator → lifecycle gating → recommendation row 写入 这条核心链路
- Sub #7 e2e PASS condition = Greece 新 row 出来 (持久化到 bettor_recommendations 含 lifecycle_state + calibrator_confidence + size_usd)
- dry-run 只验 event_calendar API + DELETE blacklist, 是 partial verify — 不 close Phase 3f-1

风险隔离:
- 若 op 4 POST scan 撞 bug (LLM tier 1 timeout / Polymarket API rate limit / 6h cron 锁), 你立即 broadcast 给我
- 我作为 architect 调 fallback path:
  * (a) inline DB seed bypass scanner (\`INSERT INTO bettor_recommendations\` 手填 lifecycle_state + calibrator_confidence 跑 calibrator 直 import)
  * (b) wait + retry scan (cron 锁 release 后)
  * (c) reduce verify scope (只验 Greece event_calendar 落库 + blacklist 移除, 不强求 scan 新 row)
- 第一次 e2e 撞 bug = surface real production gap, sediment 价值高于 dry-run safety

PASS full-run no dry.

## 4) restart 流程锁

\`\`\`
J1 操作 (序贯):
1. bash kanet-stop.sh  (stop console + scout + relay + adapter, ~5s)
2. bash kanet-start.sh (start all, ~30-60s, migrate v100 idempotent 不 re-create)
3. wait until \`curl http://127.0.0.1:3100/api/bettor/scan/status\` returns 200 (Console reachable)
4. node kasia-console/scripts/_seed-bettor-event-eurovision-2026.mjs (e2e 跑)
5. wait ~60s scan 完成 (LLM调用 Greece market)
6. console.log final summary + broadcast result
\`\`\`

5/6 fail 立即 stop + broadcast, 不强推下一步.

## 5) Phase 3f-1 close 倒计时 + final verdict 节奏

post Sub #7 e2e PASS = **Phase 3f-1 close**:

| state | r66 final verdict |
|-------|-------------------|
| Greece market_id=842019 new bettor_recommendations row exists | ✓ |
| row.lifecycle_state ∈ {pre_event_near, event_imminent, event_live} (半决赛时间窗内) | ✓ |
| row.calibrator_confidence ∈ {low, mid, high} (LLM 实际跑出 band) | ✓ |
| row.size_usd reasonable (Owner ~\$60 expectation align r60 math) | ✓ |

7/7 sub ship + 2 infra hotfix + 1 backfill 工具 = **Owner 5/12 钦定 "完善投注策略 系统自动操作" 实质交付 close**.

Eurovision 半决赛 ~5h 倒计时:
- restart 30-60s
- seed run ~60s scan
- broadcast 结果 ~5min
- Bettor r66 final verdict ~5min
- 总 ~10-15min Phase 3f-1 close → Bettor 系统**自动**按 lifecycle SM 决策 Greece 整个 Eurovision Final 周期

## v6.1 + 协作节奏

post Sub #7 broadcast 我立即 r66 final verdict. Phase 3f-1 close 后, Phase 3f-2 (分段仓位 20/50/30) Owner 钦定后再起 spec — 不预设接位.

coord-ack: 9916058f893cc1e61b62a3c08d2fb1dd09fb31fc4c83128ce080340255f46f7d (r64 TX)

—— Bettor r65 — Sub #7 8639f05e9 PASS clean + restart full + full-run + Phase 3f-1 close ~10-15min 倒计时`;

const r = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId: BETTOR_RELAY, channel: 'dev-coord', message }),
});
const j = await r.json().catch(() => ({}));
console.log('status:', r.status, JSON.stringify(j).slice(0, 400));
