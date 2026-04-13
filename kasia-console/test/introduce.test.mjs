// Tests for the introduce skill
//
// Bug history (2026-04-13): this test used to hit the live Console at
// localhost:3100 with bech32-invalid fixture addresses (`kaspa:qqtrustedintro…`)
// and never clean up. Two consequences:
//   1. The addresses contained 'i' / 'o' / 'b' (not in the bech32 charset),
//      so every Relay catch-up cycle crashed encrypt() with
//      "Invalid Kaspa address: invalid character 'i'"
//   2. By 2026-04-13 the DB had accumulated 3,274 orphan identity rows and
//      1,404 orphan messages across ~470 test runs since 2026-04-04.
// Fix: all fixture addresses are now bech32-valid (no b/i/o/1), and an
// `after()` hook nukes them via better-sqlite3 before exit. TODO: migrate to
// isolated test DB so tests never touch production Console state at all.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { resolve } from "node:path";

const CONSOLE_URL   = process.env.CONSOLE_URL   || "http://localhost:3100";
const INGEST_SECRET = process.env.INGEST_SECRET || "";
const DB_PATH       = process.env.DB_PATH || resolve("./data/console.db");
const headers = { "x-ingest-secret": INGEST_SECRET, "Content-Type": "application/json" };

// All fixture addresses share the `qqtester` prefix so cleanup can find them
// with a single LIKE. Each role uses one distinct bech32 char (t/n/d/g/h/u/s/f)
// followed by 52 chars of valid bech32 padding. Total payload = 61 chars,
// matching the format extractXOnlyPubkeyFromAddress() expects (32 pubkey bytes
// + checksum). No '1', 'b', 'i', 'o' anywhere.
const FIXTURE_PREFIX = "kaspa:qqtester";
const _PAD = "zry9x8gf2tvdw0s3jn54khce6mua7lqpzry9x8gf2tvdw0s3jn54";
const _addr = (roleChar) => `${FIXTURE_PREFIX}${roleChar}${_PAD}`;

const PEER_TRUSTED  = _addr("t");
const PEER_NORMAL   = _addr("n");
const PEER_BLOCKED  = _addr("d");
const TARGET_ADDR   = _addr("g");
const TARGET_ADDR2  = _addr("h");
const PEER_LOCAL    = _addr("s");     // local "setup" identity
const TARGET_REASON = _addr("f");     // used in reason-check test
const TARGET_IDEM   = _addr("u");     // used in idempotency test

async function executeSkill(skillName, peer, opts = {}) {
  const res = await fetch(`${CONSOLE_URL}/api/skills/execute`, {
    method: "POST", headers,
    body: JSON.stringify({ skillName, peer, network: "mainnet", ...opts }),
  });
  return res.json();
}

async function setupPeerTrust(peer, trustLevel) {
  // Ingest a message to create the identity, then annotate trust
  await fetch(`${CONSOLE_URL}/ingest/message`, {
    method: "POST", headers,
    body: JSON.stringify({
      traceId: randomUUID(), network: "mainnet", direction: "inbound",
      localAddress: PEER_LOCAL, remoteAddress: peer,
      contentText: "setup",
    }),
  });
  await fetch(`${CONSOLE_URL}/api/skills/execute`, {
    method: "POST", headers,
    body: JSON.stringify({
      skillName: "annotate", peer, network: "mainnet",
      params: { trust_level: trustLevel },
    }),
  });
}

// Delete everything this test suite wrote. Called from after() so the
// production DB stays clean even if individual assertions throw.
function cleanupFixtures() {
  let db;
  try {
    db = new Database(DB_PATH);
  } catch (e) {
    console.warn(`[cleanup] cannot open DB at ${DB_PATH}: ${e.message} — skipping`);
    return;
  }
  try {
    db.pragma("foreign_keys = OFF");
    const like = `${FIXTURE_PREFIX}%`;
    const ids = db.prepare("SELECT id FROM identities WHERE address LIKE ?").all(like).map(r => r.id);
    if (ids.length === 0) { db.close(); return; }
    const csv = ids.map(i => `'${i}'`).join(",");

    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM messages WHERE sender_identity_id IN (${csv}) OR receiver_identity_id IN (${csv})`).run();
      try { db.prepare(`DELETE FROM conversations WHERE local_identity_id IN (${csv}) OR remote_identity_id IN (${csv})`).run(); } catch {}
      try { db.prepare(`DELETE FROM relation_states WHERE local_address LIKE ? OR peer_address LIKE ?`).run(like, like); } catch {}
      db.prepare(`DELETE FROM identities WHERE address LIKE ?`).run(like);
    });
    tx();
    console.log(`[cleanup] removed ${ids.length} fixture identity rows and related`);
  } finally {
    db.close();
  }
}

describe("Introduce Skill", () => {
  before(async () => {
    await setupPeerTrust(PEER_TRUSTED, "recommended");
    await setupPeerTrust(PEER_NORMAL, "normal");
    await setupPeerTrust(PEER_BLOCKED, "blocked");
  });

  after(() => {
    cleanupFixtures();
  });

  // --- Permission checks ---

  it("trusted peer CAN introduce", async () => {
    const body = await executeSkill("introduce", PEER_TRUSTED, {
      correlationId: randomUUID(),
      params: { target: TARGET_ADDR, reason: "Great developer" },
    });
    assert.equal(body.allowed, true);
    assert.equal(body.executed, true);
  });

  it("normal peer CANNOT introduce (requires trusted)", async () => {
    const body = await executeSkill("introduce", PEER_NORMAL, {
      params: { target: TARGET_ADDR2 },
    });
    assert.equal(body.allowed, false);
    assert.equal(body.reason, "insufficient_trust");
  });

  it("blocked peer CANNOT introduce", async () => {
    const body = await executeSkill("introduce", PEER_BLOCKED, {
      params: { target: TARGET_ADDR2 },
    });
    assert.equal(body.allowed, false);
    assert.equal(body.reason, "insufficient_trust");
  });

  // --- Parameter validation ---

  it("rejects missing target", async () => {
    const body = await executeSkill("introduce", PEER_TRUSTED, {
      params: {},
    });
    assert.equal(body.allowed, false);
    assert.equal(body.reason, "target_required");
  });

  it("rejects invalid target address format", async () => {
    const body = await executeSkill("introduce", PEER_TRUSTED, {
      params: { target: "abc" },
    });
    assert.equal(body.allowed, false);
    assert.equal(body.reason, "invalid_target_address");
  });

  it("rejects target = peer (cannot introduce self)", async () => {
    const body = await executeSkill("introduce", PEER_TRUSTED, {
      params: { target: PEER_TRUSTED },
    });
    assert.equal(body.allowed, false);
    assert.equal(body.reason, "cannot_introduce_self");
  });

  it("rejects reason exceeding 200 chars", async () => {
    const body = await executeSkill("introduce", PEER_TRUSTED, {
      params: { target: TARGET_ADDR2, reason: "x".repeat(201) },
    });
    assert.equal(body.allowed, false);
    assert.equal(body.reason, "reason_too_long");
  });

  it("accepts reason at exactly 200 chars", async () => {
    const body = await executeSkill("introduce", PEER_TRUSTED, {
      correlationId: randomUUID(),
      params: { target: TARGET_ADDR2, reason: "y".repeat(200) },
    });
    assert.equal(body.allowed, true);
    assert.equal(body.executed, true);
  });

  // --- Execution effects ---

  it("creates target identity with brief notes + introduced tag", async () => {
    const res = await fetch(`${CONSOLE_URL}/api/context/${TARGET_ADDR}`, { headers });
    assert.equal(res.status, 200);
    const ctx = await res.json();
    assert.ok(ctx.identity);
    assert.ok(ctx.identity.notes.includes("Introduced by"), "notes should contain brief summary");
    assert.ok(ctx.identity.tags.includes("introduced"), "tags should include 'introduced'");
  });

  it("records full reason in trace events, not in identity notes", async () => {
    const cid = randomUUID();
    const longReason = "This peer runs a reliable mining node in the Singapore region";
    await executeSkill("introduce", PEER_TRUSTED, {
      correlationId: cid,
      params: { target: TARGET_REASON, reason: longReason },
    });
    // Check trace events
    const { events } = await (await fetch(`${CONSOLE_URL}/api/events/trace/${cid}`, { headers })).json();
    const introEvt = events.find(e => e.event_type === "intro_registered");
    assert.ok(introEvt, "should have intro_registered event");
    const payload = JSON.parse(introEvt.payload_json);
    assert.equal(payload.reason, longReason, "full reason in event payload");
    // Check identity notes — should be brief
    const ctx = await (await fetch(`${CONSOLE_URL}/api/context/${TARGET_REASON}`, { headers })).json();
    assert.ok(!ctx.identity.notes.includes(longReason), "notes should NOT contain full reason");
    assert.ok(ctx.identity.notes.includes("Introduced by"), "notes should have brief summary");
  });

  // --- Idempotency ---

  it("same correlationId does not re-execute introduce", async () => {
    const cid = randomUUID();
    const r1 = await executeSkill("introduce", PEER_TRUSTED, {
      correlationId: cid,
      params: { target: TARGET_IDEM },
    });
    assert.equal(r1.executed, true);
    const r2 = await executeSkill("introduce", PEER_TRUSTED, {
      correlationId: cid,
      params: { target: TARGET_IDEM },
    });
    assert.equal(r2.replayed, true);
    assert.equal(r2.executed, false);
  });

  // --- Side effect level ---

  it("introduce skill has side_effect_level = relationship_change", async () => {
    const { skills } = await (await fetch(`${CONSOLE_URL}/api/skills`, { headers })).json();
    const intro = skills.find(s => s.name === "introduce");
    assert.equal(intro.side_effect_level, "relationship_change");
    assert.equal(intro.min_trust_level, "recommended");
    assert.equal(intro.status, "active");
  });
});
