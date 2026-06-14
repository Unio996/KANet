// test_mypositions_onchain_payout.mjs — #27e regression (KANet-UI sprint, Bettor r-APPROVE).
//
// Guards: a SETTLED winning position's my-positions actual_payout_kas == the ACTUAL on-chain settle
// output to the winner (metadata.phase2_outputs), NOT the over-stated payoutIfWin projection (which
// omits the oracle fee + committeeMode SS bond-floor). Fixture = the demo market lwrcl, whose authoritative
// on-chain winner output is 141.427 KAS (J2 reconciliation: input+output double-proof) vs the old
// projection 148.1. Derives the golden from on-chain phase2_outputs (not hardcoded) so it survives #28
// (oracle_bond tuning changes the on-chain value AND the expected display together).
//
// Run from kasia-console:  node test-framework/standalone/test_mypositions_onchain_payout.mjs
// PASS only against an #27e-deployed Console (old code returns the projection → FAIL = the deploy gate).

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const CONSOLE = process.env.CONSOLE_URL || 'http://127.0.0.1:3200';
const LWRCL_ID = 'ext-pool-v07-1781439783496-lwrcl';
const WINNER_RELAY = 'AutoBetter-3';                 // the DM-bet persona (external bettor, P2PK payout)
const WINNER_PAYOUT_ADDR = 'kaspatest:qqvax2yukqzxe8lrt0nxk30vm6enc2wse90sqn47';  // settler P2PK(bettor_pk), the actual settle out#6
const EPS = 1e-4;

const require = createRequire('D:/kanet-tn12/kasia-console/package.json');
const Database = require('better-sqlite3');
const db = new Database('D:/kanet-tn12/kasia-console/data/console.db', { readonly: true, timeout: 8000 });

let pass = 0, fail = 0;
const check = (name, cond, detail) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail ? ` (${detail})` : ''}`); fail++; } };

// 1) golden = on-chain winner output (sum phase2_outputs to the winner's P2PK payout address)
const row = db.prepare('SELECT metadata, settle_txid FROM pool_markets WHERE id=?').get(LWRCL_ID);
if (!row?.settle_txid) { console.log('  ✗ lwrcl not settled (fixture missing)'); console.log('\n#27e: 0/1'); process.exit(1); }
const meta = JSON.parse(row.metadata || '{}');
const onChainKas = (meta.phase2_outputs || [])
  .filter(o => o.address === WINNER_PAYOUT_ADDR)
  .reduce((s, o) => s + (Number(o.amountSompi) || 0), 0) / 1e8;
check('golden: on-chain winner output present (> 0)', onChainKas > 0, `${onChainKas} KAS`);
check('golden ≠ stale projection 148.1 (real fee/bond deducted)', Math.abs(onChainKas - 148.1) > 1, `${onChainKas.toFixed(4)} KAS`);
console.log(`  on-chain winner output (golden) = ${onChainKas.toFixed(8)} KAS`);

// 2) winner's address → my-positions actual_payout must equal the on-chain golden
const winner = db.prepare('SELECT address FROM relay_nodes WHERE name=?').get(WINNER_RELAY);
const pos = await fetch(`${CONSOLE}/api/pool/my-positions?linked_addr=${encodeURIComponent(winner.address)}`).then(r => r.json()).catch(e => ({ error: String(e) }));
const lwrclPos = (pos.positions || []).find(p => p.market_id === LWRCL_ID && p.did_win === true);
check('my-positions returns the settled winning lwrcl position', !!lwrclPos, pos.error || 'not found');
if (lwrclPos) {
  check('actual_payout_kas == on-chain settle output (display = chain truth)',
    Math.abs(Number(lwrclPos.actual_payout_kas) - onChainKas) < EPS,
    `display ${lwrclPos.actual_payout_kas} vs on-chain ${onChainKas.toFixed(8)} — pre-#27e shows the 148.1 projection`);
}

console.log(`\n#27e regression: ${pass}/${pass + fail} PASS`);
db.close();
process.exit(fail > 0 ? 1 : 0);
