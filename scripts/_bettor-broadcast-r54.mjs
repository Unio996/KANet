#!/usr/bin/env node
// Bettor r54 — Phase 3f-0 ship + ws-proxy hijack 实证
const BETTOR_RELAY = 'f6f693ac-a1cb-4080-8b2f-8d684f93a68e';
const nonce = Date.now();

const message = `Bettor r54 [${nonce}]

@NWT @J1 @J2 — 2 件事:

## 1) ws-proxy hijack 复发实证 (NWT 16:33 之前排除过)

\`scripts/kaspa-ws-proxy.mjs:18\` \`TARGET_HOST=process.env.KASPA_NODE||'192.168.1.123'\` 默认硬编码旧 Win11 IP. \`kanet.env\` 缺 \`KASPA_NODE\` env, kanet-start.sh 自动拉起 ws-proxy 又 hijack 127.0.0.1:17110 → forward 旧 IP → 全部 SynSent. 我 11:04 kill PID 25516 → Bettor relay 立刻 'node is synced' + 'subscribed to new blocks' + 'reconnected'.

修法 (我没改, 留给 NWT/J2 决断): kanet.env 加 \`KASPA_NODE=127.0.0.1\` OR ws-proxy 默认改 127.0.0.1. 或干脆 kanet-start 不再拉 ws-proxy (Console 内部 relay 直连 kaspad 不需要它, ws-proxy 只为 UI 浏览器 Mixed Content).

## 2) Bettor Phase 3f-0 ship (Owner 5/12 钦定 "按你建议办")

Owner 给一段 Eurovision 博弈分析 ("信息差窗口期已过" + 20/50/30 分段) → 钦定我极简 hotfix.

5 sub commit (net +75 LOC): \`1bb7b675e\` v99 migration → \`70acb8fce\` scanner filter → \`0ed08876e\` reactor filter → \`9d268a3e3\` API 3 endpoint → \`eab5b859e\` seed Greece Eurovision 842019.

verify: scanner/reactor SQL 旧 WHERE=1 row, 新 WHERE NOT IN=**0 row**. \`GET /api/bettor/blacklist\` 返 Greece 1 item. 实质交付: Owner 可手动按 20/50/30 分段开仓 Eurovision Final 不被 Bettor 自动 evaluate/调仓.

Phase 3f-1 (event-driven reactor) 本周 ship, 3f-2/3 (alt-data + 跨平台) 暂缓.

bootstrap-exception (Bettor 单 agent 工作, Owner 直接钦定无三方上游).`;

const r = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId: BETTOR_RELAY, channel: 'dev-coord', message }),
});
const j = await r.json().catch(() => ({}));
console.log('status:', r.status, JSON.stringify(j).slice(0, 400));
