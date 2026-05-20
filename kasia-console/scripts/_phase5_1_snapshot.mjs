// Phase 5-1 snapshot script — Owner钦定 + NWT N19.66 spec
// Output: docs/exchange-asset-snapshot-2026-05-20.md
import Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';

const DB_PATH = 'C:/kanet/kasia-console/data/console.db';
const NOW_ISO = new Date().toISOString();
const SINCE_24H = new Date(Date.now() - 24*60*60*1000).toISOString();
const SINCE_7D = new Date(Date.now() - 7*24*60*60*1000).toISOString();
const CHAINS = ['kaspa','bnb','eth','polygon','arbitrum','base','optimism','avalanche','sol','tron'];

const db = new Database(DB_PATH, { readonly: true });

async function fetchKasBalance(relayId) {
  try {
    const r = await fetch(`http://127.0.0.1:3100/api/relay/${relayId}/balance`, { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    return d.balance ?? null;
  } catch { return null; }
}

async function fetchAllWallets(relayId) {
  try {
    const r = await fetch(`http://127.0.0.1:3100/api/relay/${relayId}/wallets`, { signal: AbortSignal.timeout(20000) });
    const d = await r.json();
    const byChain = {};
    for (const w of (d.chains || [])) {
      byChain[w.chain] = { usdt: w.usdtBalance ?? 0, usdc: w.usdcBalance ?? 0, native: w.nativeBalance ?? 0 };
    }
    return byChain;
  } catch { return {}; }
}

const relays = db.prepare("SELECT id, name, address FROM relay_nodes ORDER BY name").all();
const wallets = db.prepare("SELECT relay_node_id, chain, address FROM agent_wallets WHERE is_default=1").all();
const walletsByRelay = {};
for (const w of wallets) {
  walletsByRelay[w.relay_node_id] = walletsByRelay[w.relay_node_id] || {};
  walletsByRelay[w.relay_node_id][w.chain] = w.address;
}

console.log('Phase 5-1 snapshot — collecting balances (agent × chain) ...');

const sec1 = [];
sec1.push('## Sec 1 — Agent × Chain 资产快照\n');
sec1.push('| Agent | KAS | BSC USDT | ETH USDT | Polygon | Arbitrum | Base | Optimism | Avalanche | SOL | TRON |');
sec1.push('|-------|-----|----------|----------|---------|----------|------|----------|-----------|-----|------|');

for (const r of relays) {
  // NWT N19.67 Fix #4: Opus = coordination relay, no wallets
  if (r.name === 'Opus' && !r.address) {
    sec1.push(`| ${r.name} | _coord relay no wallets_ | — | — | — | — | — | — | — | — | — |`);
    console.log(' ', r.name, '(coord relay, skipped)');
    continue;
  }
  const row = [r.name];
  const kasBal = await fetchKasBalance(r.id);
  row.push(kasBal?.toString() ?? '—');
  const allWallets = await fetchAllWallets(r.id);
  for (const c of CHAINS.slice(1)) {
    const has = walletsByRelay[r.id]?.[c];
    if (!has) { row.push('—'); continue; }
    const bal = allWallets[c];
    if (bal === undefined) { row.push('?'); continue; }
    const usdt = Number(bal.usdt ?? 0);
    row.push(usdt > 0 ? usdt.toFixed(3) : '0');
  }
  sec1.push('| ' + row.join(' | ') + ' |');
  console.log(' ', r.name, '✓');
}

console.log('\nSec 2 — CEX inventory ...');
const exc = db.prepare("SELECT exchange, label, base_url, is_default FROM exchange_accounts ORDER BY exchange").all();
const sec2 = [];
sec2.push('\n## Sec 2 — 5 CEX 账户清单\n');
sec2.push('| Exchange | Label | Default | Auto-trade | Auto-withdraw | KAS/USDT min order |');
sec2.push('|---|---|---|---|---|---|');
// NWT N19.67 Fix #1: API verify min order from N19.61
const cexCap = {
  bybit:   { autoT: '✓', autoW: '✗ 手动 (Owner)', minAmt: '$5 USDT (instrumentInfo minOrderAmt)' },
  mexc:    { autoT: '✓', autoW: '✗ 手动',         minAmt: '~$1 USDT (默认 spot)' },
  gateio:  { autoT: '✓', autoW: '✓ API',          minAmt: '$3 USDT (min_quote_amount)' },
  bitget:  { autoT: '✓', autoW: '✗ 手动',         minAmt: '$1 USDT (minTradeUSDT)' },
  kucoin:  { autoT: '✓', autoW: '✗ 手动',         minAmt: '$0.10 USDT (minFunds — 最低)' },
};
for (const x of exc) {
  const c = cexCap[x.exchange] || { autoT: '?', autoW: '?', minAmt: '?' };
  sec2.push(`| ${x.exchange} | ${x.label||'-'} | ${x.is_default?'✓':''} | ${c.autoT} | ${c.autoW} | ${c.minAmt} |`);
}

console.log('\nSec 3 — 24h net flow ...');
const flow = db.prepare(`SELECT event_type, COUNT(*) c FROM chain_events WHERE observed_at > ? GROUP BY event_type ORDER BY c DESC LIMIT 25`).all(SINCE_24H);
const sec3 = ['\n## Sec 3 — 24h chain_events 流量\n', '| event_type | count |', '|---|---|'];
for (const f of flow) sec3.push(`| ${f.event_type} | ${f.c} |`);

const offerStats = db.prepare(`SELECT protocol_status, COUNT(*) c FROM exchange_offers WHERE created_at > ? GROUP BY protocol_status`).all(SINCE_24H);
sec3.push('\n### Exchange offers 24h by status\n', '| status | count |', '|---|---|');
for (const o of offerStats) sec3.push(`| ${o.protocol_status} | ${o.c} |`);

const hedgeStats = db.prepare(`SELECT event_type, COUNT(*) c FROM chain_events WHERE event_type LIKE 'hedge%' GROUP BY event_type`).all();
sec3.push('\n### hedge lifetime (all time)\n', '| event | lifetime |', '|---|---|');
for (const h of hedgeStats) sec3.push(`| ${h.event_type} | ${h.c} |`);

console.log('\nSec 4 — 7-day broker pool trend ...');
const sec4 = ['\n## Sec 4 — Broker pool 7-day trend (chain_events tx flow approx)\n'];
const broker = relays.find(r => r.name === 'Trader-B');
if (broker) {
  // address_balances 是 current-state, 没时序. 改用 chain_events tx where to/from = broker addr.
  // 7-day net flow KAS aggregated by day. tx event payload 含 amount.
  try {
    const txIn = db.prepare(`
      SELECT DATE(observed_at) day,
             SUM(CAST(json_extract(payload,'$.amount') AS REAL)) total_in
      FROM chain_events
      WHERE event_type='tx' AND to_address=? AND observed_at > ?
      GROUP BY day ORDER BY day DESC LIMIT 7
    `).all(broker.address, SINCE_7D);
    const txOut = db.prepare(`
      SELECT DATE(observed_at) day,
             SUM(CAST(json_extract(payload,'$.amount') AS REAL)) total_out
      FROM chain_events
      WHERE event_type='tx' AND from_address=? AND observed_at > ?
      GROUP BY day ORDER BY day DESC LIMIT 7
    `).all(broker.address, SINCE_7D);
    const days = {};
    for (const r of txIn) days[r.day] = { in: r.total_in, out: 0 };
    for (const r of txOut) days[r.day] = { in: days[r.day]?.in ?? 0, out: r.total_out };
    if (Object.keys(days).length) {
      sec4.push('| Day | KAS in | KAS out | net |', '|---|---|---|---|');
      for (const [day, d] of Object.entries(days).sort().reverse()) {
        const net = (d.in || 0) - (d.out || 0);
        sec4.push(`| ${day} | ${Number(d.in || 0).toFixed(2)} | ${Number(d.out || 0).toFixed(2)} | ${net.toFixed(2)} |`);
      }
    } else {
      sec4.push('(chain_events tx 7-day 无数据 broker addr)');
    }
    sec4.push('\n*Note*: address_balances table 是 current-state only (no `snapshot_at` col). 真 trend 需新 cron 写 time-series.');
  } catch (e) {
    sec4.push(`(query err: ${e.message})`);
  }
}

const sec5 = ['\n## Sec 5 — Per-CEX Capability Matrix\n', '见 Sec 2. Phase 5-2.5 router 按 capability 分路: 重度压测/自动 e2e → Gate.io, 其他 → Bybit + Owner 周期手动 rebalance.'];

console.log('\nSec 6 — broker capacity calc ...');
const sec6 = ['\n## Sec 6 — Broker 日 cycle capacity\n'];
sec6.push('**假设**: 每 cycle = 200 KAS × $0.034 = $6.74 USDT');
sec6.push('');
sec6.push('| 维度 | 余 | cycle / day max |');
sec6.push('|---|---|---|');
const kasPool = await fetchKasBalance(broker.id);
const brokerEvm = await fetchAllWallets(broker.id);
const bscUsdt = brokerEvm.bnb?.usdt ?? 0;
const usdtCycles = Math.floor(bscUsdt / 6.74);
sec6.push(`| KAS-bound (broker) | ${kasPool?.toFixed(0) ?? '?'} KAS | ${kasPool ? Math.floor(kasPool/200) : '?'} |`);
sec6.push(`| USDT-bound (BSC) | \\$${bscUsdt.toFixed(2)} USDT | ${usdtCycles} |`);
sec6.push('| Bybit risk limit | TBD (查 Bybit account API) | TBD |');
sec6.push('');
// NWT N19.67 Fix #3: 校准 burst vs idle
sec6.push('**Bottleneck**: USDT-bound 是 current limit (' + usdtCycles + ' < 106 KAS-bound) at qty=200.');
sec6.push('');
sec6.push('**实测 24h (NWT N19.67 Fix #3 校准)**: 9 exchange_completed (含今早 hedge test burst 集中 5h 窗内 ~2 cycle/h) + idle baseline ~0. 重度压测目标 10k cycle → 当前 K-pool + USDT-pool 都撞死.');

const sec7 = [
  '\n## Sec 7 — Alarm Threshold Propose (NWT review)\n',
  '| Metric | Threshold | Action |',
  '|---|---|---|',
  '| broker K-pool < 5,000 KAS | 红线 | broadcast Owner notify + auto-throttle cycle |',
  '| broker BSC USDT < $50 | 黄线 | broadcast warn |',
  '| Bybit KAS balance > 1,000 KAS (积压) | 黄线 | Owner withdraw |',
  '| hedge_failed > 5 in 1h | 红线 | circuit breaker (已 ship Phase 1a) |',
  '| any non-broker relay KAS < 1 | info | log only |',
];

const header = `# KANet Exchange Asset Snapshot — 2026-05-20

**Generated**: ${NOW_ISO}
**Scope**: 7 agent × ${CHAINS.length} chain × 5 CEX + hedge lifetime + 24h flow + 7-day trend + capability matrix
**Phase**: 5-1 (NWT N19.66 spec, J2 ship)
**Status**: first cut — NWT review pending

`;

const out = [header, ...sec1, ...sec2, ...sec3, ...sec4, ...sec5, ...sec6, ...sec7].join('\n');
writeFileSync('C:/kanet/docs/exchange-asset-snapshot-2026-05-20.md', out);
console.log('\n✓ wrote C:/kanet/docs/exchange-asset-snapshot-2026-05-20.md (' + out.length + ' bytes)');
db.close();
