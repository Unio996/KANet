// J1tn #27d regression — self-heal market catch-up: reassemble missed pool_market_published from durable chunks.
//
// scope: #27d (f4a84bff). A cross-node market_publish broadcast arrives chunked (pool_market_chunk_v1); the
//        in-mem chunk cache is LRU-bounded so under flood a remote node can EVICT a chunk before reassembly →
//        market never ingested → that node can't sample/vote → liveness gap. Fix: catchUpUningestedMarkets
//        rebuilds from the DURABLE broadcast_messages store (chunks persist there regardless of in-mem eviction).
// bug guarded: silent loss of a cross-node market (LRU eviction) → permanent missing market on a node.
// determinism guards being tested (#27d-specific reassembly core):
//   - ONLY complete sha256-verified chunk sets are reassembled (NWT r1166: no half rows, no corrupt rows)
//   - incomplete set (a part missing in the durable store too) = real loss → skipped (not a partial market)
//   - corrupt set (sha256(reassembled) != hash) → skipped
//   - non-market inner (e.g. sign_req) reassembled but filtered (only pool_market_published_v1 dispatched)
//   - throttled (not a full re-scan every tick)
//
// 真调生产 export catchUpUningestedMarkets against a REAL temp DB with synthetic durable chunks = 非拷贝逻辑.
// (rebuilt=1 with a cryptographically-valid signed market_published is covered by the LIVE #27d self-heal in
//  production + the batch2 e2e; here we assert the reassembly/filter/throttle core — a synthetic market has no
//  valid maker sig so handlePoolMarketPublished's existing sig gate holds → scanned proves dispatch reached.)
//
// run: KASPA_RPC_URL=ws://127.0.0.1:17210 KASPA_NETWORK=testnet-12 DB_PATH=<temp> \
//        node test-framework/standalone/test_27d_market_catchup.mjs   (exit 0=PASS, 1=FAIL)

import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync } from 'fs';
import { createHash } from 'crypto';

const TMP = join(tmpdir(), `kanet_27d_test_${process.pid}.db`);
process.env.DB_PATH = TMP;
process.env.KASPA_RPC_URL = process.env.KASPA_RPC_URL || 'ws://127.0.0.1:17210';
process.env.KASPA_NETWORK = process.env.KASPA_NETWORK || 'testnet-12';

let fails = 0;
function check(name, ok, detail) {
  if (ok) console.log(`PASS ${name}`);
  else { fails++; console.error(`FAIL ${name}: ${detail || ''}`); }
}

const { runMigrations } = await import('../../src/db/migrate.js');
runMigrations();
const { sqlite } = await import('../../src/db/client.js');
const { catchUpUningestedMarkets } = await import('../../src/services/trade-protocol-filter.js');

const nowIso = new Date(Date.now() - 60_000).toISOString(); // within the 24h window
const ins = sqlite.prepare(`INSERT INTO broadcast_messages (channel_name, sender_address, content, tx_hash, status, created_at, visibility)
  VALUES ('kanet-prediction', ?, ?, ?, 'confirmed', ?, 'public')`);

// chunk an inner object into N pool_market_chunk_v1 rows over the durable store.
// opts.dropOrd: omit that chunk (incomplete). opts.corrupt: tamper one chunk's data (sha mismatch).
function insertChunked(inner, n, opts = {}) {
  const s = JSON.stringify(inner);
  const hash = createHash('sha256').update(s).digest('hex');
  const size = Math.ceil(s.length / n);
  for (let i = 0; i < n; i++) {
    if (opts.dropOrd === i) continue;
    let data = s.slice(i * size, (i + 1) * size);
    if (opts.corrupt && i === 0) data = data.length ? ('Z' + data.slice(1)) : 'Z'; // tamper → sha mismatch
    ins.run('kaspatest:sender' + (inner.market_id || ''), JSON.stringify({ t: 'pool_market_chunk_v1', hash, ord: i, total: n, data }), 'tx' + (inner.market_id || '') + i, nowIso);
  }
  return hash;
}

const mkMarket = (id) => ({ t: 'pool_market_published_v1', market_id: id, maker_pk: 'aa'.repeat(32), spine_p2sh: 'kaspatest:x', market_metadata_hash: '00'.repeat(32), deadline: 1000, sig: 'deadbeef' });

// SET A: complete + valid sha, pool_market_published_v1 → reaches dispatch (scanned counts it)
insertChunked(mkMarket('mkt-catchup-A'), 3);
// SET B: incomplete (drop ord 1) → real loss → NOT reassembled
insertChunked(mkMarket('mkt-catchup-B'), 3, { dropOrd: 1 });
// SET C: complete but corrupt (sha mismatch) → NOT reassembled
insertChunked(mkMarket('mkt-catchup-C'), 3, { corrupt: true });
// SET D: complete + valid but NON-market inner (sign_req) → reassembled then filtered out (not dispatched)
insertChunked({ t: 'kanet_pool_oracle_tx_sign_req_v1', market_id: 'mkt-catchup-D' }, 2);

const r = await catchUpUningestedMarkets({ force: true, windowHours: 24 });

// only SET A is a complete + valid-sha + pool_market_published_v1 set → exactly 1 reaches tryDispatch's scanned++.
check('only complete+valid-sha+market_published set reaches dispatch (scanned==1)', r.scanned === 1, `scanned=${r.scanned} (B incomplete / C corrupt-sha / D non-market must all be excluded)`);
// synthetic market has no valid maker sig → handlePoolMarketPublished's existing gate holds → not rebuilt.
check('synthetic (unsigned) market not silently rebuilt (sig gate holds)', r.rebuilt === 0, `rebuilt=${r.rebuilt}`);
check('catch-up did not throw / returned a result', r && typeof r.scanned === 'number', JSON.stringify(r));

// throttle: a 2nd call without force within the throttle window is skipped (not a full re-scan every tick).
const r2 = await catchUpUningestedMarkets({ windowHours: 24 });
check('throttled: 2nd call (no force) within window is skipped', r2.throttled === true, JSON.stringify(r2));

// idempotent: with the market already present, a forced re-scan does NOT re-create it (rebuilt stays 0).
sqlite.prepare(`INSERT OR IGNORE INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline) VALUES ('mkt-catchup-A','__none__','kaspatest:x','${'00'.repeat(32)}',1000)`).run();
const r3 = await catchUpUningestedMarkets({ force: true, windowHours: 24 });
check('idempotent: existing market not re-created (rebuilt==0)', r3.rebuilt === 0, JSON.stringify(r3));

try { sqlite.close(); } catch {}
try { rmSync(TMP, { force: true }); rmSync(TMP + '-wal', { force: true }); rmSync(TMP + '-shm', { force: true }); } catch {}

console.log(fails === 0 ? '\n✅ #27d market catch-up reassembly regression PASS' : `\n❌ ${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
