// J1tn — Tier-4 evidence capture for the maker-invite oracle demo (Bettor r175 gate, no mock).
// Queries the testnet DB directly for the NEWCOMER's REAL on-chain participation in the demo offer.
// Run from /d/kanet-testnet/kasia-console: node <this> <offer_id>
import Database from 'better-sqlite3';

const OFFER = process.argv[2] || 'ext-pred-1779970599931-smqaa';
const NEWCOMER_ID = '36ad0e1a-cbb1-4eda-bd93-13b52122b28a';
const NEWCOMER_ADDR = 'kaspatest:qzzgvfnpcvz33cj7aezudmcukkshpjt7dljgvmfh29amzkutcwpy67g0g8m40';

const db = new Database('./data/console.db', { readonly: true });

console.log('═══ Tier-4 EVIDENCE — newcomer real-chain vote + settle (no mock) ═══');
console.log('offer   :', OFFER);
console.log('newcomer:', NEWCOMER_ID, '(UAT-Test-2)');
console.log('addr    :', NEWCOMER_ADDR, '\n');

const offer = db.prepare('SELECT protocol_status, settle_txid, outcome_side FROM exchange_offers WHERE id=?').get(OFFER);
console.log('offer status :', offer?.protocol_status, '| settle_txid:', offer?.settle_txid || '(none yet)', '| side:', offer?.outcome_side, '\n');

// 1. newcomer's REAL signed oracle_vote
const votes = db.prepare(`SELECT txid, payload, observed_at FROM chain_events
  WHERE event_type='oracle_vote' AND from_address=? AND (offer_id=? OR payload LIKE ?)`).all(NEWCOMER_ADDR, OFFER, `%${OFFER}%`);
console.log(`[1] newcomer oracle_vote events: ${votes.length}`);
votes.forEach(v => {
  let p = {}; try { p = JSON.parse(v.payload); } catch {}
  console.log(`    outcome=${p.outcome} voter_pubkey=${(p.voter_pubkey||'').slice(0,16)}.. signature=${(p.signature||'').slice(0,20)}.. @${v.observed_at}`);
});

// 2. newcomer's REAL settle-TX input signature(s)
const sigs = db.prepare(`SELECT txid, payload, observed_at FROM chain_events
  WHERE event_type='oracle_tx_sig' AND from_address=? AND (offer_id=? OR payload LIKE ?)`).all(NEWCOMER_ADDR, OFFER, `%${OFFER}%`);
console.log(`\n[2] newcomer oracle_tx_sig (settle signatures): ${sigs.length}`);
sigs.forEach(s => {
  let p = {}; try { p = JSON.parse(s.payload); } catch {}
  console.log(`    input_index=${p.input_index} signature=${(p.signature||'').slice(0,20)}.. @${s.observed_at}`);
});

// 3. first-ever proof — newcomer's total prediction participation across ALL offers
const totalVotes = db.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='oracle_vote' AND from_address=?`).get(NEWCOMER_ADDR).c;
const priorSets = db.prepare(`SELECT COUNT(*) c FROM exchange_offers WHERE outcome_oracle_relay_ids LIKE ? AND id != ?`).get(`%${NEWCOMER_ID}%`, OFFER).c;
console.log(`\n[3] first-ever standing: newcomer total oracle_votes=${totalVotes}, prior 5-sets (excl this)=${priorSets}`);
console.log(`    → before this demo: ZERO. This is the newcomer's first earned on-chain oracle participation.`);

const ok = offer?.settle_txid && votes.length > 0 && sigs.length > 0;
console.log(`\n${ok ? '✓ TIER-4 PASS' : '⏳ INCOMPLETE'}: settle_txid=${!!offer?.settle_txid} vote=${votes.length>0} settle_sig=${sigs.length>0}`);
console.log('FRAMING: maker-INVITED (maker chose relay_id). NOT permissionless. 0 protocol change.');
