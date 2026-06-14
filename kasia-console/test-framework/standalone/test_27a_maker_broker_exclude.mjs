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

try { sqlite.close(); } catch {}
try { rmSync(TMP, { force: true }); rmSync(TMP + '-wal', { force: true }); rmSync(TMP + '-shm', { force: true }); } catch {}

console.log(fails === 0 ? '\n✅ #27a maker/broker exclude-construction regression PASS' : `\n❌ ${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
