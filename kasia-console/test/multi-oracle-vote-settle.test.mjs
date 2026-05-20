/**
 * Multi-Oracle Vote Settlement — Phase 4a Sub 5 e2e test (Bettor r234 spec).
 *
 * Tests collectMultiOracleVotes() with 5-of-5 unanimous + revote_round filter + misbehave + auto-pause.
 *
 * Run: node --test test/multi-oracle-vote-settle.test.mjs
 */
import { describe, it, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { collectMultiOracleVotes as collectMultiOracleVotesReal } from '../src/services/bettor-prediction-settler.js';

let db;

// r235 Sub 6 加: 真 ECDSA sign for test votes. cache keypairs by voterId 防 重新 derive expensive.
let kaspa;
const _voterKeypairs = new Map();  // voterId → { privKey, xOnlyPubkey }

async function ensureKaspa() {
  if (!kaspa) kaspa = await import('kaspa-wasm');
  return kaspa;
}

async function getVoterKeypair(voterId) {
  if (_voterKeypairs.has(voterId)) return _voterKeypairs.get(voterId);
  await ensureKaspa();
  // Deterministic private key from voterId (= 32-byte hash, hash voterId → fake but deterministic privkey).
  // 不 cryptographically safe — tests only.
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(voterId).digest();
  // Force odd-y (kaspa-wasm PrivateKey requires valid x-only). Just use first 32 bytes as is.
  const privKeyHex = Buffer.from(hash).toString('hex');
  const privKey = new kaspa.PrivateKey(privKeyHex);
  const xOnlyPubkey = privKey.toPublicKey().toXOnlyPublicKey().toString();
  const kp = { privKey, xOnlyPubkey };
  _voterKeypairs.set(voterId, kp);
  return kp;
}

function setupTestDB() {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE exchange_offers (
      id TEXT PRIMARY KEY,
      maker TEXT,
      maker_kaspa_addr TEXT,
      outcome_oracle_relay_id TEXT,
      outcome_oracle_relay_ids TEXT,
      protocol_status TEXT DEFAULT 'matched',
      outcome_side TEXT,
      revote_round INTEGER DEFAULT 0
    );
    CREATE TABLE chain_events (
      id TEXT PRIMARY KEY,
      txid TEXT NOT NULL,
      event_type TEXT NOT NULL,
      from_address TEXT,
      to_address TEXT,
      payload TEXT,
      observed_by TEXT NOT NULL DEFAULT 'test',
      observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE relay_nodes (
      id TEXT PRIMARY KEY,
      name TEXT,
      is_oracle INTEGER DEFAULT 1,
      voter_misbehave_count INTEGER DEFAULT 0
    );
  `);
}

function seedOffer(offerId, makerAddr, revoteRound = 0) {
  db.prepare(`INSERT INTO exchange_offers (id, maker, maker_kaspa_addr, protocol_status, outcome_side, revote_round)
              VALUES (?, ?, ?, 'matched', 'YES', ?)`)
    .run(offerId, makerAddr, makerAddr, revoteRound);
  return db.prepare('SELECT * FROM exchange_offers WHERE id=?').get(offerId);
}

function seedRelay(relayId) {
  db.prepare(`INSERT INTO relay_nodes (id, name, is_oracle, voter_misbehave_count) VALUES (?, ?, 1, 0)`)
    .run(relayId, `relay-${relayId.slice(0,8)}`);
}

async function seedVote(offerId, makerAddr, voterId, outcome, revoteRound = 0) {
  await ensureKaspa();
  const { xOnlyPubkey, privKey } = await getVoterKeypair(voterId);
  const unsigned = {
    t: 'kanet_oracle_vote_v1',
    offer_id: offerId,
    voter_relay_id: voterId,
    voter_pubkey: xOnlyPubkey,
    outcome,
    evidence_url: null,
    evidence_hash: 'a'.repeat(64),
    vote_timestamp: new Date().toISOString(),
    revote_round: revoteRound,
  };
  const message = JSON.stringify(unsigned);
  const signature = kaspa.signMessage({ message, privateKey: privKey });
  const payload = JSON.stringify({ ...unsigned, signature });
  db.prepare(`INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
              VALUES (?, ?, 'oracle_vote', ?, ?, ?, 'test', CURRENT_TIMESTAMP)`)
    .run(randomUUID(), `vote:${voterId}:${offerId.slice(0,8)}:${randomUUID().slice(0,8)}`, `kaspa:${voterId}`, makerAddr, payload);
}

describe('Phase 4a Sub 5 — 5-of-5 unanimous + revote + misbehave (Bettor r234)', () => {
  beforeEach(() => setupTestDB());

  it('1. unanimous YES — 5 YES → resolved YES', async () => {
    const offer = seedOffer('off-unan-yes', 'kaspa:m1');
    for (let i = 1; i <= 5; i++) { seedRelay(`v${i}`); await seedVote(offer.id, offer.maker_kaspa_addr, `v${i}`, 'YES', 0); }
    const r = await collectMultiOracleVotesReal(offer, db);
    assert.equal(r.resolved, true);
    assert.equal(r.winner, 'YES');
    assert.equal(r.total_voters, 5);
    assert.equal(r.round, 0);
  });

  it('2. unanimous NO — 5 NO → resolved NO', async () => {
    const offer = seedOffer('off-unan-no', 'kaspa:m2');
    for (let i = 1; i <= 5; i++) { seedRelay(`v${i}`); await seedVote(offer.id, offer.maker_kaspa_addr, `v${i}`, 'NO', 0); }
    const r = await collectMultiOracleVotesReal(offer, db);
    assert.equal(r.resolved, true);
    assert.equal(r.winner, 'NO');
  });

  it('3. 4 YES + 1 NO — NOT unanimous → dissent + revote round 0→1', async () => {
    const offer = seedOffer('off-4y1n', 'kaspa:m3');
    for (let i = 1; i <= 4; i++) { seedRelay(`v${i}`); await seedVote(offer.id, offer.maker_kaspa_addr, `v${i}`, 'YES', 0); }
    seedRelay('v5'); await seedVote(offer.id, offer.maker_kaspa_addr, 'v5', 'NO', 0);

    const r = await collectMultiOracleVotesReal(offer, db);
    assert.equal(r.resolved, false);
    assert.equal(r.dissent, true);
    assert.equal(r.round, 0);
    assert.equal(r.next_round, 1);
    assert.equal(r.majority, 'YES');

    // v5 dissented → misbehave_count++
    const v5 = db.prepare(`SELECT voter_misbehave_count, is_oracle FROM relay_nodes WHERE id='v5'`).get();
    assert.equal(v5.voter_misbehave_count, 1);
    assert.equal(v5.is_oracle, 1, 'still oracle (= 1 dissent, < 3 threshold)');

    // offer revote_round bumped
    const offerAfter = db.prepare(`SELECT revote_round FROM exchange_offers WHERE id=?`).get(offer.id);
    assert.equal(offerAfter.revote_round, 1);
  });

  it('4. < 5 voters → pending (= waiting more votes)', async () => {
    const offer = seedOffer('off-3v', 'kaspa:m4');
    for (let i = 1; i <= 3; i++) { seedRelay(`v${i}`); await seedVote(offer.id, offer.maker_kaspa_addr, `v${i}`, 'YES', 0); }
    const r = await collectMultiOracleVotesReal(offer, db);
    assert.equal(r.resolved, false);
    assert.match(r.reason, /waiting more votes/);
    assert.equal(r.voters, 3);
    assert.equal(r.required, 5);
  });

  it('5. revote_round filter — old round votes ignored', async () => {
    const offer = seedOffer('off-roundfilter', 'kaspa:m5', /* round= */ 1);
    // 4 votes from round 0 (= stale, must be ignored)
    for (let i = 1; i <= 4; i++) { seedRelay(`v${i}`); await seedVote(offer.id, offer.maker_kaspa_addr, `v${i}`, 'YES', 0); }
    // 5 votes from round 1 (= current)
    for (let i = 1; i <= 5; i++) { await seedVote(offer.id, offer.maker_kaspa_addr, `v${i}`, 'YES', 1); }

    const r = await collectMultiOracleVotesReal(offer, db);
    assert.equal(r.resolved, true);
    assert.equal(r.winner, 'YES');
    assert.equal(r.round, 1);
    assert.equal(r.total_voters, 5, 'only round 1 voters counted');
  });

  it('6. misbehave auto-pause at 3 dissents — voter is_oracle → 0', async () => {
    const v = 'v-bad';
    seedRelay(v);
    db.prepare(`UPDATE relay_nodes SET voter_misbehave_count = 2 WHERE id = ?`).run(v);  // already 2 dissents

    // Set up offer where v is dissenting voter
    const offer = seedOffer('off-pause', 'kaspa:m6');
    for (let i = 1; i <= 4; i++) { seedRelay(`v${i}`); await seedVote(offer.id, offer.maker_kaspa_addr, `v${i}`, 'YES', 0); }
    await seedVote(offer.id, offer.maker_kaspa_addr, v, 'NO', 0);

    await collectMultiOracleVotesReal(offer, db);

    const after = db.prepare(`SELECT voter_misbehave_count, is_oracle FROM relay_nodes WHERE id = ?`).get(v);
    assert.equal(after.voter_misbehave_count, 3);
    assert.equal(after.is_oracle, 0, 'auto-paused at threshold 3');
  });

  it('7. max revote rounds done — round 2 + dissent →留 verifying, refund-eligible', async () => {
    const offer = seedOffer('off-maxround', 'kaspa:m7', /* round= */ 2);
    for (let i = 1; i <= 4; i++) { seedRelay(`v${i}`); await seedVote(offer.id, offer.maker_kaspa_addr, `v${i}`, 'YES', 2); }
    seedRelay('v5'); await seedVote(offer.id, offer.maker_kaspa_addr, 'v5', 'NO', 2);

    const r = await collectMultiOracleVotesReal(offer, db);
    assert.equal(r.resolved, false);
    assert.equal(r.dissent_max_rounds, true);
    assert.equal(r.round, 2);
    assert.match(r.reason, /max revote rounds/);

    // revote_round NOT bumped further (= max done)
    const offerAfter = db.prepare(`SELECT revote_round FROM exchange_offers WHERE id=?`).get(offer.id);
    assert.equal(offerAfter.revote_round, 2);
  });

  it('8. dedupe same voter — multi-vote in same round → counted once', async () => {
    const offer = seedOffer('off-dedupe', 'kaspa:m8');
    seedRelay('v-spam');
    for (let i = 0; i < 5; i++) await seedVote(offer.id, offer.maker_kaspa_addr, 'v-spam', 'YES', 0);
    for (let i = 2; i <= 5; i++) { seedRelay(`v${i}`); await seedVote(offer.id, offer.maker_kaspa_addr, `v${i}`, 'YES', 0); }

    const r = await collectMultiOracleVotesReal(offer, db);
    assert.equal(r.resolved, true, 'v-spam counted once, plus 4 unique = 5 voters');
    assert.equal(r.total_voters, 5);
  });

  it('9. missing maker_kaspa_addr → reject', async () => {
    const r = await collectMultiOracleVotesReal({ id: 'x', maker_kaspa_addr: null }, db);
    assert.equal(r.ok, false);
    assert.match(r.reason, /missing maker_kaspa_addr/);
  });

  it('10. no votes yet → ok=false reason="no oracle votes received yet"', async () => {
    const offer = seedOffer('off-empty', 'kaspa:m10');
    const r = await collectMultiOracleVotesReal(offer, db);
    assert.equal(r.ok, false);
    assert.match(r.reason, /no oracle votes/);
  });
});
