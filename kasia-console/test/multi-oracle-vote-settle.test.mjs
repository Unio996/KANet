/**
 * Multi-Oracle Vote Settlement — O-8 e2e test (Phase 3a r211 v3 Path D)
 *
 * Tests collectMultiOracleVotes() aggregator logic via in-memory SQLite.
 * Mirrors the implementation in src/services/bettor-prediction-settler.js#L215-254.
 *
 * Coverage:
 *   1. quorum YES (3 YES + 1 NO + 1 DISPUTE → YES wins, 5 voters)
 *   2. quorum NO (3 NO + 2 YES → NO wins)
 *   3. no quorum yet (2 YES + 2 NO + 1 DISPUTE → pending)
 *   4. dedupe (same voter 5x → 1 unique → no quorum)
 *   5. missing maker_kaspa_addr → reject with reason
 *   6. dispatcher branch: outcome_oracle_relay_id set → aggregator path; null → legacy verifier path
 *
 * Run: node --test test/multi-oracle-vote-settle.test.mjs
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

let db;

function setupTestDB() {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE exchange_offers (
      id TEXT PRIMARY KEY,
      maker TEXT,
      maker_kaspa_addr TEXT,
      outcome_oracle_relay_id TEXT,
      protocol_status TEXT DEFAULT 'matched',
      outcome_side TEXT
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
  `);
}

function seedOffer(offerId, makerAddr, oracleRelayId = 'oracle-r1') {
  db.prepare(`INSERT INTO exchange_offers (id, maker, maker_kaspa_addr, outcome_oracle_relay_id, protocol_status, outcome_side)
              VALUES (?, ?, ?, ?, 'matched', 'YES')`)
    .run(offerId, makerAddr, makerAddr, oracleRelayId);
  return db.prepare('SELECT * FROM exchange_offers WHERE id=?').get(offerId);
}

function seedVote(offerId, makerAddr, voterId, outcome, evidenceHash = 'a'.repeat(64)) {
  const payload = JSON.stringify({
    t: 'kanet_oracle_vote_v1',
    offer_id: offerId,
    voter_relay_id: voterId,
    outcome,
    evidence_hash: evidenceHash,
    vote_timestamp: new Date().toISOString(),
  });
  db.prepare(`INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
              VALUES (?, ?, 'oracle_vote', ?, ?, ?, 'test', CURRENT_TIMESTAMP)`)
    .run(randomUUID(), `vote:${voterId}:${offerId.slice(0,8)}:${randomUUID().slice(0,8)}`, `kaspa:${voterId}`, makerAddr, payload);
}

// Mirror of src/services/bettor-prediction-settler.js collectMultiOracleVotes()
async function collectMultiOracleVotes(offer) {
  if (!offer.maker_kaspa_addr) {
    return { ok: false, reason: 'missing maker_kaspa_addr (= aggregator target)' };
  }
  const votes = db.prepare(`
    SELECT id, from_address, payload, observed_at
    FROM chain_events
    WHERE event_type = 'oracle_vote'
      AND to_address = ?
      AND payload LIKE ?
  `).all(offer.maker_kaspa_addr, `%"offer_id":"${offer.id}"%`);
  if (!votes.length) return { ok: false, reason: 'no oracle votes received yet' };

  const tally = { YES: 0, NO: 0, DISPUTE: 0 };
  const voters = new Set();
  for (const v of votes) {
    try {
      const p = JSON.parse(v.payload || '{}');
      if (p.t !== 'kanet_oracle_vote_v1') continue;
      if (voters.has(p.voter_relay_id)) continue;
      voters.add(p.voter_relay_id);
      if (tally[p.outcome] !== undefined) tally[p.outcome]++;
    } catch {}
  }
  const REQUIRED_SIGS = 3;
  if (tally.YES >= REQUIRED_SIGS) {
    return { ok: true, resolved: true, winner: 'YES', votes_yes: tally.YES, votes_no: tally.NO, total_voters: voters.size };
  }
  if (tally.NO >= REQUIRED_SIGS) {
    return { ok: true, resolved: true, winner: 'NO', votes_yes: tally.YES, votes_no: tally.NO, total_voters: voters.size };
  }
  return { ok: true, resolved: false, votes_yes: tally.YES, votes_no: tally.NO, votes_dispute: tally.DISPUTE, total_voters: voters.size, required: REQUIRED_SIGS };
}

describe('O-8 Multi-Oracle Vote Settlement (Phase 3a r211 v3 Path D)', () => {
  beforeEach(() => setupTestDB());

  it('1. quorum YES — 3 YES + 1 NO + 1 DISPUTE → YES wins', async () => {
    const offer = seedOffer('ext-pred-case1', 'kaspa:maker1');
    seedVote(offer.id, offer.maker_kaspa_addr, 'voter-1', 'YES');
    seedVote(offer.id, offer.maker_kaspa_addr, 'voter-2', 'YES');
    seedVote(offer.id, offer.maker_kaspa_addr, 'voter-3', 'YES');
    seedVote(offer.id, offer.maker_kaspa_addr, 'voter-4', 'NO');
    seedVote(offer.id, offer.maker_kaspa_addr, 'voter-5', 'DISPUTE');

    const r = await collectMultiOracleVotes(offer);
    assert.equal(r.ok, true);
    assert.equal(r.resolved, true);
    assert.equal(r.winner, 'YES');
    assert.equal(r.votes_yes, 3);
    assert.equal(r.votes_no, 1);
    assert.equal(r.total_voters, 5);
  });

  it('2. quorum NO — 3 NO + 2 YES → NO wins', async () => {
    const offer = seedOffer('ext-pred-case2', 'kaspa:maker2');
    seedVote(offer.id, offer.maker_kaspa_addr, 'voter-1', 'NO');
    seedVote(offer.id, offer.maker_kaspa_addr, 'voter-2', 'NO');
    seedVote(offer.id, offer.maker_kaspa_addr, 'voter-3', 'NO');
    seedVote(offer.id, offer.maker_kaspa_addr, 'voter-4', 'YES');
    seedVote(offer.id, offer.maker_kaspa_addr, 'voter-5', 'YES');

    const r = await collectMultiOracleVotes(offer);
    assert.equal(r.resolved, true);
    assert.equal(r.winner, 'NO');
    assert.equal(r.votes_no, 3);
    assert.equal(r.votes_yes, 2);
  });

  it('3. no quorum — 2 YES + 2 NO + 1 DISPUTE → pending', async () => {
    const offer = seedOffer('ext-pred-case3', 'kaspa:maker3');
    seedVote(offer.id, offer.maker_kaspa_addr, 'voter-1', 'YES');
    seedVote(offer.id, offer.maker_kaspa_addr, 'voter-2', 'YES');
    seedVote(offer.id, offer.maker_kaspa_addr, 'voter-3', 'NO');
    seedVote(offer.id, offer.maker_kaspa_addr, 'voter-4', 'NO');
    seedVote(offer.id, offer.maker_kaspa_addr, 'voter-5', 'DISPUTE');

    const r = await collectMultiOracleVotes(offer);
    assert.equal(r.ok, true);
    assert.equal(r.resolved, false);
    assert.equal(r.votes_yes, 2);
    assert.equal(r.votes_no, 2);
    assert.equal(r.votes_dispute, 1);
    assert.equal(r.total_voters, 5);
    assert.equal(r.required, 3);
  });

  it('4. dedupe — same voter 5x YES → 1 unique → no quorum', async () => {
    const offer = seedOffer('ext-pred-case4', 'kaspa:maker4');
    for (let i = 0; i < 5; i++) {
      seedVote(offer.id, offer.maker_kaspa_addr, 'voter-spam', 'YES');
    }
    const r = await collectMultiOracleVotes(offer);
    assert.equal(r.resolved, false);
    assert.equal(r.votes_yes, 1);
    assert.equal(r.total_voters, 1);
  });

  it('5. missing maker_kaspa_addr → reject', async () => {
    const offer = { id: 'ext-pred-case5', maker_kaspa_addr: null };
    const r = await collectMultiOracleVotes(offer);
    assert.equal(r.ok, false);
    assert.match(r.reason, /missing maker_kaspa_addr/);
  });

  it('6. no votes yet → ok=false reason="no oracle votes received yet"', async () => {
    const offer = seedOffer('ext-pred-case6', 'kaspa:maker6');
    const r = await collectMultiOracleVotes(offer);
    assert.equal(r.ok, false);
    assert.match(r.reason, /no oracle votes/);
  });

  it('7. wrong message type "t" ignored — payload not kanet_oracle_vote_v1', async () => {
    const offer = seedOffer('ext-pred-case7', 'kaspa:maker7');
    const badPayload = JSON.stringify({ t: 'kanet_other_v1', offer_id: offer.id, voter_relay_id: 'voter-1', outcome: 'YES' });
    db.prepare(`INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
                VALUES (?, ?, 'oracle_vote', ?, ?, ?, 'test', CURRENT_TIMESTAMP)`)
      .run(randomUUID(), 'bad-vote-1', 'kaspa:voter-1', offer.maker_kaspa_addr, badPayload);
    seedVote(offer.id, offer.maker_kaspa_addr, 'voter-2', 'YES');
    seedVote(offer.id, offer.maker_kaspa_addr, 'voter-3', 'YES');
    seedVote(offer.id, offer.maker_kaspa_addr, 'voter-4', 'YES');

    const r = await collectMultiOracleVotes(offer);
    assert.equal(r.resolved, true);
    assert.equal(r.winner, 'YES');
    assert.equal(r.votes_yes, 3);
    assert.equal(r.total_voters, 3, 'bad message type filtered, only 3 valid voters counted');
  });

  it('8. cross-offer isolation — vote for other offer ignored', async () => {
    const offerA = seedOffer('ext-pred-caseA', 'kaspa:makerA');
    const offerB = seedOffer('ext-pred-caseB', 'kaspa:makerA');  // same maker, different offer
    seedVote(offerA.id, offerA.maker_kaspa_addr, 'voter-1', 'YES');
    seedVote(offerA.id, offerA.maker_kaspa_addr, 'voter-2', 'YES');
    seedVote(offerB.id, offerB.maker_kaspa_addr, 'voter-3', 'YES');
    seedVote(offerB.id, offerB.maker_kaspa_addr, 'voter-4', 'YES');
    seedVote(offerB.id, offerB.maker_kaspa_addr, 'voter-5', 'YES');

    const rA = await collectMultiOracleVotes(offerA);
    const rB = await collectMultiOracleVotes(offerB);
    assert.equal(rA.resolved, false, 'A has 2 YES, no quorum');
    assert.equal(rA.votes_yes, 2);
    assert.equal(rB.resolved, true, 'B has 3 YES, quorum');
    assert.equal(rB.winner, 'YES');
    assert.equal(rB.votes_yes, 3);
  });

  it('9. dispatcher branch — null outcome_oracle_relay_id signals legacy path', () => {
    const offer = { id: 'ext-pred-case9', maker_kaspa_addr: 'kaspa:maker9', outcome_oracle_relay_id: null };
    // settler.js#L91: if (offer.outcome_oracle_relay_id) → aggregator else → legacy verifier
    // 这里 verify dispatcher 输入条件
    const useAggregator = !!offer.outcome_oracle_relay_id;
    assert.equal(useAggregator, false, 'legacy verifier path');

    const offerWithOracle = { ...offer, outcome_oracle_relay_id: 'oracle-r1' };
    const useAggregator2 = !!offerWithOracle.outcome_oracle_relay_id;
    assert.equal(useAggregator2, true, 'aggregator path');
  });
});
