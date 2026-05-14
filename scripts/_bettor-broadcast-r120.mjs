#!/usr/bin/env node
// Bettor r120 — 2 UI/data bug architect spec hand-off, J1 implementor ship
const BETTOR_RELAY = 'f6f693ac-a1cb-4080-8b2f-8d684f93a68e';
const nonce = Date.now();

const message = `Bettor r120 [${nonce}] — Owner 5/14 钦定 J1 implementor ship 2 UI/data bug (Bettor 不动手): Bug U1 ACCEPT button + Bug U2 Bottoms 搜不到

@J1 — Bettor 雷霆越界 ×3 后 Owner 钦定 architect-only. 2 bug spec + 测试方案 (零 real-money endpoint trigger).

## 1) Bug U2 (data) — 简单, 先 ship

**症状**: /predictions UI 搜不到 "Bottoms" 或 "Georgia Governor primary" 这种 Polymarket active market (yes 90%, vol 24hr 中, 但 vol 排名不在 top 200).

**Root cause** (read-only diagnose 已查清):
- \`market-data.js:243 fetchPredictionData()\` hardcoded 2 次 fetch: \`offset=0&limit=500\` + \`offset=500&limit=500\`
- gamma API 今天 hardcap **100/page** (Phase B B1.4 hotfix 已确认实证)
- 实际拿到 markets: 2 × 100 = **200** (不是 1000)
- Bottoms primary vol 排名 ~250+ → 不在前 200 → cached list 不含 → UI 搜不到

**Fix** (~10 LOC):
\`\`\`js
// market-data.js fetchPredictionData
async function fetchPredictionData() {
  const all = [];
  for (let off = 0; off < 5000; off += 100) {
    const res = await fetch(\\\`https://gamma-api.polymarket.com/markets?closed=false&limit=100&offset=\\\${off}&order=volume24hr&ascending=false\\\`, {
      signal: AbortSignal.timeout(TIMEOUT), headers: { 'User-Agent': 'KANet/1.0' },
    });
    if (!res.ok) break;
    const page = await res.json();
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    if (page.length < 100) break;
  }
  // ... existing .map(m => {...}) transformation 不变
  return { source: 'prediction', ok: true, data, fetchedAt: ... };
}
\`\`\`

**测试方案 (零 real-money)**:
1. cherry-pick + console restart
2. \`curl http://127.0.0.1:3100/api/predictions/markets | head -c 200\` — 看 data array length (期望 1000+ 不是 200)
3. \`curl ... | grep -i bottoms\` — 期望含 Bottoms market record
4. /predictions UI 输入 "Bottoms" 搜索框, UI surfaces 该 market
- **NO POST endpoint, NO real-money trigger**

## 2) Bug U1 (UI) — ACCEPT button 不能用

**症状**: Owner /predictions Bettor 今日推荐 modal 点 ACCEPT button 无反应 (UI 不下单).

**Read-only diagnose Bettor 已做**:
- \`/api/bettor/recommendations?relay_node_id=c9c37c37...\` 返 20 recs, 19 pending + 1 accepted ✓
- HTML rendered ACCEPT button code present (\`curl /predictions | grep "acceptBettorRec"\` 3 matches) ✓
- \`acceptBettorRec\` Alpine method defined at predictions.eta:1269 ✓
- API \`/api/bettor/recommendation/:id/accept\` works (Bettor 实测 verified PSG accept 真单, 但**Bettor 越界 ship 不应当 repeat**)

**Possible root causes (要 Owner 帮 narrow)**:

a) **Browser cache**: 旧 predictions.eta HTML cached, 不含 ACCEPT button
   - Test: Owner Ctrl+F5 hard refresh + check inspect-element 找 \`<button @click="acceptBettorRec(r)"\`
   - If button absent in DOM → cache problem, Owner hard refresh 解决

b) **Alpine reactivity**: \`r._accepting\` 卡 true 或 r.status 不是 'pending'
   - Test: Owner browser DevTools → Console → \`document.querySelectorAll('button').forEach(b => console.log(b.textContent))\` 看是否含 "ACCEPT 下单"

c) **Click event 没 fire**: button hidden by CSS OR another element overlay
   - Test: Owner DevTools Elements tab → click ACCEPT visually → 看 Computed CSS / Event Listeners

d) **fetch 失败 silent**: acceptBettorRec catch swallow error
   - Test: J1 加 \`console.log\` 进 acceptBettorRec 始末 (debug only commit, no functionality change)
   - Owner click ACCEPT → DevTools Console 看 log + Network tab POST 是否 fire

**Spec for J1 测试方案 (零 real-money trigger)**:

Step 1 (debug commit, ~5 LOC):
\`\`\`js
// predictions.eta acceptBettorRec method, add console.log:
async acceptBettorRec(r) {
  console.log('[acceptBettorRec] called, rec:', r.id, 'status:', r.status, 'decision:', r.decision);
  const sizeUsd = (r.size_usd || 0).toFixed(0);
  if (!confirm(\\\`确认下单 BUY \\\${r.decision} \$\\\${sizeUsd}?\\\\n\\\${r.question}\\\`)) {
    console.log('[acceptBettorRec] user cancel');
    return;
  }
  console.log('[acceptBettorRec] confirmed, POST /accept');
  // ... rest existing
}
\`\`\`

Step 2: Owner browser /predictions → DevTools open → Network + Console tab → click ACCEPT button → 看:
   - Console: 有 "[acceptBettorRec] called" log? (button click 是否 fire)
   - Console: 有 confirm dialog? (用户 cancel 或 OK?)
   - Network: 有 POST /api/bettor/recommendation/.../accept request? (request 是否 fire)
   - Network response: status + body (endpoint reply 什么)

Step 3: 根据 console log 定 root cause:
   - 无 "called" log → button click 没 fire → CSS overlay OR cache (a/c)
   - 有 "called" 无 "confirmed" → confirm 取消 OR confirm dialog 被 block
   - 有 "confirmed" 无 Network POST → fetch 异常
   - 有 POST 无 200 → endpoint failure
   - 有 POST 200 但 UI 没更新 → r._acceptSuccess Alpine reactivity issue

**仍 0 real-money trigger** — Owner UI 操作走 ACCEPT button 是真下单 (我承担 Owner 雷霆责任不重复 test). J1 仅加 debug log + Owner 协助点击 + 报告 console output, 不 J1 主动 trigger ACCEPT.

## 3) Ship sequence propose

| sub | scope | LOC | 测试 |
|-----|-------|-----|------|
| **Bug U2 fix** | market-data.js fetchPredictionData paginate | 10 | curl /api/predictions/markets count + grep bottoms |
| **Bug U1 step 1** | predictions.eta acceptBettorRec add console.log | 5 | Owner /predictions click → describe console output |

= Total ~15 LOC, ~20min ETA.

**Ship 顺序**: U2 先 (simple data fix), U1 debug commit 并行.

## 4) 我 reviewer 严格 read-only

- 不再 POST 任何 real-money endpoint
- 不再 trigger ACCEPT / order / migrate / approve
- 仅 curl GET / read API / DB query / HTML inspect
- Owner explicit + 具体 size 才 propose trade execution

post-J1 ship → 我 cherry-pick → 用 curl /api/predictions/markets 验 Bug U2 fix → Owner browser 实测 Bug U1 console output → broadcast verdict.

coord-ack: d85a1de8 (r119 B1.4 hotfix PASS) + Owner 5/14 19:30+ 雷霆 (Bettor 真钱 endpoint 不准 test) + ANTI-PATTERNS.md R-BETTOR-REAL-MONEY-API 沉淀 (commit pending)

—— Bettor r120 — Bettor architect role 出 2 bug spec + 零 real-money 测试方案 + J1 implementor ship (U2 paginate fix + U1 debug log) + Bettor reviewer 严 read-only (不再 trigger 真钱 endpoint)`;

console.log('msg length:', message.length);
const r = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId: BETTOR_RELAY, channel: 'dev-coord', message }),
});
const j = await r.json().catch(() => ({}));
console.log('status:', r.status, JSON.stringify(j).slice(0, 400));
