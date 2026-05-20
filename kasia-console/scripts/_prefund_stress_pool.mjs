// _prefund_stress_pool.mjs — Phase 5-6 KI 45 Sub-1 (NWT N19.94 spec)
//
// Pre-fund Trader-A + KANet BSC USDT pool for 5-5-A 1h burst.
// Per Phase 5-1 snapshot Sec 1: Trader-A=$1.16, KANet=$0 — both insufficient for buyer agent USDT transfers.
//
// Source: broker (Trader-B) BSC USDT pool ($448).
// Target: $5 each → enough for 1h burst at 10-30 KAS/cycle × $0.034 = $0.34-$1.02 per cycle.
// idempotent: skips relay already ≥ $5 USDT BSC.
// audit: emit chain_events as source='pool_prefund_test_5-5-A'.

import { readFileSync } from 'node:fs';
try {
  const env = readFileSync('C:/kanet/kanet.env', 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

import Database from 'better-sqlite3';

const DB_PATH = 'C:/kanet/kasia-console/data/console.db';
const CONSOLE_URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3100';
const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const TARGET_USDT = 5;
// NWT N19.94 spec: ['Trader-A', 'KANet'] — 但 grep verified KANet 无 BSC 钱包 (agent_wallets WHERE chain='bnb' = 0 row).
// J2 #577 push back: fund Trader-A only ($5), KANet defer (需 wallet 生成不 prefund). buyerPool = 4 (NWT/Trader-M/J2/Trader-A).
const TARGETS = ['Trader-A'];

const db = new Database(DB_PATH, { readonly: true });

async function getRelayUsdt(relayId) {
  try {
    const r = await fetch(`${CONSOLE_URL}/api/relay/${relayId}/wallets`, { signal: AbortSignal.timeout(15_000) });
    const d = await r.json();
    const bnbWallet = (d.chains || []).find(c => c.chain === 'bnb');
    return bnbWallet ? { walletId: bnbWallet.id, address: bnbWallet.address, usdt: bnbWallet.usdtBalance ?? 0 } : null;
  } catch (e) { return null; }
}

const brokerBnb = db.prepare(`
  SELECT id FROM agent_wallets WHERE relay_node_id = ? AND chain = 'bnb' AND is_default = 1
`).get(BROKER_RELAY_ID);
if (!brokerBnb) {
  console.error('FATAL: broker bnb wallet not found');
  process.exit(1);
}

console.log(`[prefund] broker bnb wallet ${brokerBnb.id}, target ${TARGET_USDT} USDT each → ${TARGETS.join(', ')}`);

const results = [];
for (const name of TARGETS) {
  const relay = db.prepare(`SELECT id FROM relay_nodes WHERE name = ?`).get(name);
  if (!relay) { results.push({ name, status: 'relay_not_found' }); continue; }

  const w = await getRelayUsdt(relay.id);
  if (!w) { results.push({ name, status: 'wallet_fetch_fail' }); continue; }

  if (w.usdt >= TARGET_USDT) {
    results.push({ name, status: 'skip_already_funded', current_usdt: w.usdt });
    console.log(`[prefund] SKIP ${name} (current ${w.usdt} USDT >= target ${TARGET_USDT})`);
    continue;
  }

  const needed = TARGET_USDT - w.usdt;
  console.log(`[prefund] ${name} needs ${needed.toFixed(3)} USDT → fire transfer broker → ${w.address}`);

  try {
    const res = await fetch(`${CONSOLE_URL}/api/relay/${BROKER_RELAY_ID}/wallets/${brokerBnb.id}/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset: 'usdt', amount: needed.toFixed(3), to: w.address }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.txHash) {
      results.push({ name, status: 'funded', amount: needed.toFixed(3), txHash: data.txHash });
      console.log(`[prefund] ✓ ${name} funded ${needed.toFixed(3)} USDT, TX ${data.txHash.slice(0, 16)}`);
    } else {
      results.push({ name, status: 'transfer_fail', http: res.status, body: data });
      console.log(`[prefund] ✗ ${name} transfer fail: ${res.status} ${JSON.stringify(data).slice(0, 150)}`);
    }
  } catch (e) {
    results.push({ name, status: 'transfer_err', error: e.message });
    console.log(`[prefund] ✗ ${name} err: ${e.message}`);
  }
}

console.log('\n=== prefund summary ===');
for (const r of results) console.log(`  ${r.name}: ${r.status}${r.txHash ? ` TX=${r.txHash.slice(0, 16)}` : ''}`);

db.close();
const ok = results.every(r => r.status === 'skip_already_funded' || r.status === 'funded');
process.exit(ok ? 0 : 1);
