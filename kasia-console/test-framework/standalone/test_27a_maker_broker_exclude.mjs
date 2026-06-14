// J1tn #27a regression (part 3) — maker/broker exclude CONSTRUCTION (exclusion-BITES case).
//
// scope: #27a (J1 r303, Bettor r365b): a market's maker_pk + broker_pk MUST be excluded from its own committee
//        (same-PK double-role: collect broker fee + vote as oracle for own market = manipulation). The exclude
//        SET is CONSTRUCTED in sampleAndStoreCommittee (L328-335): market.maker_relay_id → relay_nodes.address
//        → oracle_stake_enrollments.staker_pk_x → excludePks. This file tests that construction end-to-end on a
//        REAL temp DB through the production sampleAndStoreCommittee — the EXCLUSION-BITES case (the maker IS an
//        oracle pool member, so excluding it actually changes the committee), complementing test_27a_committee_
//        exclude.mjs (which tests selectCommittee's exclude APPLICATION in isolation).
// determinism: same market + same pool + same enrollments → same excludePks → same committee, on every node
//        (the cross-node same-input guarantee for the bettor set is #27d's job — see test_27d_market_catchup.mjs).
//
// 真调生产 export sampleAndStoreCommittee + resolveOracleAddresses path against a REAL temp DB = 非拷贝逻辑.
// run: KASPA_RPC_URL=ws://127.0.0.1:17210 KASPA_NETWORK=testnet-12 DB_PATH=<temp> \
//        node test-framework/standalone/test_27a_maker_broker_exclude.mjs   (exit 0=PASS, 1=FAIL)

import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync } from 'fs';

const TMP = join(tmpdir(), `kanet_27a_mb_test_${process.pid}.db`);
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
const { sampleAndStoreCommittee } = await import('../../src/services/pool-market-settler-v06.mjs');

// 6-member oracle pool (> COMMITTEE_SIZE 5 by exactly 1 → excluding the maker leaves exactly 5 = the committee)
const POOL = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'].map(h => h.repeat(32));
const STAKES = POOL.map(() => '100000000');
const POOL_ROOT = '00'.repeat(32);
const DEADLINE_DAA = 1000;
const END_BLOCK = 'ab'.repeat(32);
const MAKER_PK = POOL[0];           // the maker is also pool member 0 → exclusion BITES
const MAKER_ADDR = 'kaspatest:maker';

sqlite.prepare(`INSERT INTO pool_snapshots (market_id, pool_merkle_root, pool_size, pool_pks_json, pool_stakes_json)
  VALUES (?,?,?,?,?)`).run('mkt-mb', POOL_ROOT, POOL.length, JSON.stringify(POOL), JSON.stringify(STAKES));
sqlite.prepare(`INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, deadline_daa)
  VALUES (?,?,?,?,?,?)`).run('mkt-mb', 'maker-relay', 'kaspatest:spine', '00'.repeat(32), DEADLINE_DAA, DEADLINE_DAA);
// maker relay_node → address (the marketRow LEFT JOIN that yields maker_address)
sqlite.prepare(`INSERT INTO relay_nodes (id, name, network, poll_ms, address, created_at, updated_at)
  VALUES ('maker-relay','maker','testnet-12',1000,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(MAKER_ADDR);
// enrollments: every pool pk → an address (resolveOracleAddresses needs the SELECTED pks); pk0's enrollment
// uses the maker address so the maker-exclude lookup (relay_address=maker_address → staker_pk_x) resolves to pk0.
const enr = sqlite.prepare(`INSERT INTO oracle_stake_enrollments
  (staker_pk_x, relay_address, active, lock_until_daa, p2sh_addr, p2sh_hash, redeem_script_hex)
  VALUES (?,?,1,?,?,?,?)`);
POOL.forEach((pk, i) => enr.run(pk, i === 0 ? MAKER_ADDR : ('kaspatest:o' + i), 999999, 'kaspatest:p' + i, 'ph' + i, 'rs' + i));

// sample: maker (pk0) must be excluded → committee = the other 5 pool members, pk0 NOT among them.
let committee, err = '';
try { committee = sampleAndStoreCommittee('mkt-mb', END_BLOCK); }
catch (e) { err = e.message; }

check('sampleAndStoreCommittee succeeded (maker-exclude path, 6→5)', !!committee, `err=${err}`);
if (committee) {
  const pks = committee.committee_pks.map(p => String(p).toLowerCase());
  check('maker pk (pool member) EXCLUDED from its own committee', !pks.includes(MAKER_PK), `maker=${MAKER_PK.slice(0,8)} committee=${JSON.stringify(pks.map(p=>p.slice(0,8)))}`);
  check('committee size == 5 (the remaining pool after maker-exclude)', pks.length === 5, `size=${pks.length}`);
  check('committee is exactly the 5 non-maker pool members', pks.slice().sort().join(',') === POOL.slice(1).map(p=>p.toLowerCase()).sort().join(','), JSON.stringify(pks.map(p=>p.slice(0,8))));
  // determinism: re-sample same inputs → identical committee_pk_hash
  const again = sampleAndStoreCommittee('mkt-mb', END_BLOCK);
  check('determinism: re-sample → identical committee_pk_hash', again.committee_pk_hash === committee.committee_pk_hash, `${again.committee_pk_hash} vs ${committee.committee_pk_hash}`);
}

// ── BROKER branch (L332-335) — independent exercise (Owner 2026-06-15 requested; NWT gap② residual) ──
// 7-member pool so excluding BOTH maker + broker leaves exactly 5 = COMMITTEE_SIZE (no starve).
const POOL7 = ['aa', 'bb', 'cc', 'dd', 'ee', 'ff', '11'].map(h => h.repeat(32)); // distinct from POOL (no enrollment PK clash)
const STAKES7 = POOL7.map(() => '100000000');
const MAKER7_PK = POOL7[0];                 // this market's maker (own addr, distinct from CASE-1's maker)
const MAKER7_ADDR = 'kaspatest:maker7';
const BROKER_PK = POOL7[1];                 // broker is also pool member 1 → broker-exclude BITES
const BROKER_ADDR = 'kaspatest:broker';     // != maker addr → broker branch (L332 guard) runs
sqlite.prepare(`INSERT INTO pool_snapshots (market_id, pool_merkle_root, pool_size, pool_pks_json, pool_stakes_json)
  VALUES (?,?,?,?,?)`).run('mkt-brk', POOL_ROOT, POOL7.length, JSON.stringify(POOL7), JSON.stringify(STAKES7));
sqlite.prepare(`INSERT INTO pool_markets (id, maker_relay_id, broker_relay_id, spine_p2sh, market_metadata_hash, deadline, deadline_daa)
  VALUES (?,?,?,?,?,?,?)`).run('mkt-brk', 'maker-relay-7', 'broker-relay', 'kaspatest:spine', '00'.repeat(32), DEADLINE_DAA, DEADLINE_DAA);
sqlite.prepare(`INSERT INTO relay_nodes (id, name, network, poll_ms, address, created_at, updated_at)
  VALUES ('maker-relay-7','maker7','testnet-12',1000,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(MAKER7_ADDR);
sqlite.prepare(`INSERT INTO relay_nodes (id, name, network, poll_ms, address, created_at, updated_at)
  VALUES ('broker-relay','broker','testnet-12',1000,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(BROKER_ADDR);
// enrollments for all 7 pool pks (own addresses, no clash with CASE-1); pk0→maker7 addr, pk1→broker addr.
POOL7.forEach((pk, i) => enr.run(pk, i === 0 ? MAKER7_ADDR : (i === 1 ? BROKER_ADDR : ('kaspatest:q' + i)), 999999, 'kaspatest:pp' + i, 'pph' + i, 'prs' + i));

let cb, cbErr = '';
try { cb = sampleAndStoreCommittee('mkt-brk', END_BLOCK); }
catch (e) { cbErr = e.message; }
check('maker+broker market sampled (7→5 after double-exclude)', !!cb, `err=${cbErr}`);
if (cb) {
  const pks = cb.committee_pks.map(p => String(p).toLowerCase());
  check('BROKER pk (pool member, addr != maker) EXCLUDED from committee', !pks.includes(BROKER_PK), `broker=${BROKER_PK.slice(0,8)} committee=${JSON.stringify(pks.map(p=>p.slice(0,8)))}`);
  check('maker also still excluded (both branches bite)', !pks.includes(MAKER7_PK), `maker=${MAKER7_PK.slice(0,8)} committee=${JSON.stringify(pks.map(p=>p.slice(0,8)))}`);
  check('committee == the 5 pool members minus maker(0) and broker(1)', pks.slice().sort().join(',') === POOL7.slice(2).map(p => p.toLowerCase()).sort().join(','), JSON.stringify(pks.map(p=>p.slice(0,8))));
}

// broker_address == maker_address (same relay) → L332 != guard SKIPS the broker branch (no double-count of same pk).
// 6-member pool, maker=broker=pool[0]'s relay → only ONE exclude → committee = 5.
sqlite.prepare(`INSERT INTO pool_snapshots (market_id, pool_merkle_root, pool_size, pool_pks_json, pool_stakes_json)
  VALUES (?,?,?,?,?)`).run('mkt-brk-same', POOL_ROOT, POOL.length, JSON.stringify(POOL), JSON.stringify(STAKES));
sqlite.prepare(`INSERT INTO pool_markets (id, maker_relay_id, broker_relay_id, spine_p2sh, market_metadata_hash, deadline, deadline_daa)
  VALUES (?,?,?,?,?,?,?)`).run('mkt-brk-same', 'maker-relay', 'maker-relay', 'kaspatest:spine', '00'.repeat(32), DEADLINE_DAA, DEADLINE_DAA);
let cs, csErr = '';
try { cs = sampleAndStoreCommittee('mkt-brk-same', END_BLOCK); }
catch (e) { csErr = e.message; }
check('broker_addr == maker_addr → != guard skips broker branch → still 6→5 (no double-exclude starve)', !!cs && cs.committee_pks.length === 5, `err=${csErr} size=${cs?.committee_pks?.length}`);

// ── 问2 (Bettor 2026-06-15): CHAIN-ANCHORED broker_pk exclude catches what the node-local address lookup MISSES ──
// Vector: broker (broker≠maker) enrolled as an oracle under a DIFFERENT relay_address than the market's
// broker_relay_id → the address→oracle_stake_enrollments lookup returns nothing → broker NOT excluded → could be
// VRF-sampled onto its own market's committee. Fix: pool_markets.broker_pk (chain-anchored) excluded DIRECTLY.
// Setup: broker_pk = pool[0]; broker_relay_id's address has NO enrollment (lookup misses); maker has no address.
sqlite.prepare(`INSERT INTO pool_snapshots (market_id, pool_merkle_root, pool_size, pool_pks_json, pool_stakes_json)
  VALUES (?,?,?,?,?)`).run('mkt-q2', POOL_ROOT, POOL.length, JSON.stringify(POOL), JSON.stringify(STAKES));
sqlite.prepare(`INSERT INTO pool_markets (id, maker_relay_id, broker_relay_id, broker_pk, spine_p2sh, market_metadata_hash, deadline, deadline_daa)
  VALUES (?,?,?,?,?,?,?,?)`).run('mkt-q2', '__none__', 'q2-broker-relay', POOL[0], 'kaspatest:spine', '00'.repeat(32), DEADLINE_DAA, DEADLINE_DAA);
sqlite.prepare(`INSERT INTO relay_nodes (id, name, network, poll_ms, address, created_at, updated_at)
  VALUES ('q2-broker-relay','q2broker','testnet-12',1000,'kaspatest:q2broker-noenroll',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run();
let cq, cqErr = '';
try { cq = sampleAndStoreCommittee('mkt-q2', END_BLOCK); }
catch (e) { cqErr = e.message; }
check('问2: chain-anchored broker_pk EXCLUDED even when address→enrollment lookup misses (no broker enrollment)',
  !!cq && !cq.committee_pks.map(p => String(p).toLowerCase()).includes(POOL[0]) && cq.committee_pks.length === 5,
  `err=${cqErr} committee=${JSON.stringify(cq?.committee_pks?.map(p=>p.slice(0,8)))}`);

try { sqlite.close(); } catch {}
try { rmSync(TMP, { force: true }); rmSync(TMP + '-wal', { force: true }); rmSync(TMP + '-shm', { force: true }); } catch {}

console.log(fails === 0 ? '\n✅ #27a maker/broker exclude-construction regression PASS' : `\n❌ ${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
