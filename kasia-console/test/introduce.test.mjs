// Tests for the introduce skill
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const CONSOLE_URL   = process.env.CONSOLE_URL   || "http://localhost:3100";
const INGEST_SECRET = process.env.INGEST_SECRET || "";
const headers = { "x-ingest-secret": INGEST_SECRET, "Content-Type": "application/json" };

const RUN = Date.now();
const PEER_TRUSTED  = `kaspa:qqtrustedintro${RUN}aaa`;
const PEER_NORMAL   = `kaspa:qqnormalintro${RUN}bbb`;
const PEER_BLOCKED  = `kaspa:qqblockedintro${RUN}ccc`;
const TARGET_ADDR   = `kaspa:qqtargetintro${RUN}ddd`;
const TARGET_ADDR2  = `kaspa:qqtarget2intro${RUN}eee`;

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
      localAddress: `kaspa:qqlocalsetup${RUN}`, remoteAddress: peer,
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

describe("Introduce Skill", () => {
  before(async () => {
    await setupPeerTrust(PEER_TRUSTED, "recommended");
    await setupPeerTrust(PEER_NORMAL, "normal");
    await setupPeerTrust(PEER_BLOCKED, "blocked");
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
      params: { target: `kaspa:qqreasoncheck${RUN}fff`, reason: longReason },
    });
    // Check trace events
    const { events } = await (await fetch(`${CONSOLE_URL}/api/events/trace/${cid}`, { headers })).json();
    const introEvt = events.find(e => e.event_type === "intro_registered");
    assert.ok(introEvt, "should have intro_registered event");
    const payload = JSON.parse(introEvt.payload_json);
    assert.equal(payload.reason, longReason, "full reason in event payload");
    // Check identity notes — should be brief
    const ctx = await (await fetch(`${CONSOLE_URL}/api/context/kaspa:qqreasoncheck${RUN}fff`, { headers })).json();
    assert.ok(!ctx.identity.notes.includes(longReason), "notes should NOT contain full reason");
    assert.ok(ctx.identity.notes.includes("Introduced by"), "notes should have brief summary");
  });

  // --- Idempotency ---

  it("same correlationId does not re-execute introduce", async () => {
    const cid = randomUUID();
    const r1 = await executeSkill("introduce", PEER_TRUSTED, {
      correlationId: cid,
      params: { target: `kaspa:qqidemintro${RUN}ggg` },
    });
    assert.equal(r1.executed, true);
    const r2 = await executeSkill("introduce", PEER_TRUSTED, {
      correlationId: cid,
      params: { target: `kaspa:qqidemintro${RUN}ggg` },
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
