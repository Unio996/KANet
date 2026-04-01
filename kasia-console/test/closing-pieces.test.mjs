// Tests for the three "收口件": idempotency, side_effect_level, trace query API
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const CONSOLE_URL   = process.env.CONSOLE_URL   || "http://localhost:3100";
const INGEST_SECRET = process.env.INGEST_SECRET || "";
const headers = { "x-ingest-secret": INGEST_SECRET, "Content-Type": "application/json" };

async function executeSkill(skillName, peer, opts = {}) {
  const res = await fetch(`${CONSOLE_URL}/api/skills/execute`, {
    method: "POST", headers,
    body: JSON.stringify({ skillName, peer, network: "mainnet", ...opts }),
  });
  return res.json();
}

// ─── A. Idempotency ───────────────────────────────────────────────

describe("A. Skill Invocation Idempotency", () => {
  const correlationId = randomUUID();
  const peer = `kaspa:qqidempotency_${Date.now()}`;

  it("first execution succeeds", async () => {
    const body = await executeSkill("annotate", peer, {
      correlationId,
      params: { tags: "idempotency_test" },
    });
    assert.equal(body.allowed, true);
    assert.equal(body.executed, true);
  });

  it("second execution with same correlationId is replayed (not re-executed)", async () => {
    const body = await executeSkill("annotate", peer, {
      correlationId,
      params: { tags: "idempotency_test_2" },
    });
    assert.equal(body.allowed, true);
    assert.equal(body.executed, false, "should NOT re-execute");
    assert.equal(body.replayed, true, "should be marked as replay");
  });

  it("different correlationId executes normally", async () => {
    const body = await executeSkill("annotate", peer, {
      correlationId: randomUUID(),
      params: { tags: "different_correlation" },
    });
    assert.equal(body.allowed, true);
    assert.equal(body.executed, true);
  });

  it("no correlationId always executes (backward compat)", async () => {
    const body = await executeSkill("annotate", peer, {
      params: { notes: "no correlation" },
    });
    assert.equal(body.allowed, true);
    assert.equal(body.executed, true);
  });
});

// ─── B. side_effect_level ─────────────────────────────────────────

describe("B. side_effect_level", () => {
  it("builtin skills have correct side_effect_level", async () => {
    const { skills } = await (await fetch(`${CONSOLE_URL}/api/skills`, { headers })).json();
    const annotate = skills.find(s => s.name === "annotate");
    const block = skills.find(s => s.name === "block");
    const unblock = skills.find(s => s.name === "unblock");
    assert.equal(annotate.side_effect_level, "metadata_write");
    assert.equal(block.side_effect_level, "relationship_change");
    assert.equal(unblock.side_effect_level, "relationship_change");
  });

  it("auto-register respects valid side_effect_level", async () => {
    const name = `test_sef_${Date.now()}`;
    await fetch(`${CONSOLE_URL}/api/skills/register`, {
      method: "POST", headers,
      body: JSON.stringify({ name, displayName: "SEF Test", sideEffectLevel: "network_action" }),
    });
    const { skills } = await (await fetch(`${CONSOLE_URL}/api/skills`, { headers })).json();
    const skill = skills.find(s => s.name === name);
    assert.equal(skill.side_effect_level, "network_action");
    // cleanup
    await fetch(`${CONSOLE_URL}/skills/${skill.id}/delete`, { method: "POST", redirect: "manual" });
  });

  it("auto-register defaults invalid side_effect_level to metadata_write", async () => {
    const name = `test_sef_bad_${Date.now()}`;
    await fetch(`${CONSOLE_URL}/api/skills/register`, {
      method: "POST", headers,
      body: JSON.stringify({ name, displayName: "SEF Bad", sideEffectLevel: "invalid_level" }),
    });
    const { skills } = await (await fetch(`${CONSOLE_URL}/api/skills`, { headers })).json();
    const skill = skills.find(s => s.name === name);
    assert.equal(skill.side_effect_level, "metadata_write");
    // cleanup
    await fetch(`${CONSOLE_URL}/skills/${skill.id}/delete`, { method: "POST", redirect: "manual" });
  });
});

// ─── C. Trace Query API ──────────────────────────────────────────

describe("C. Trace Query API", () => {
  const traceId = randomUUID();

  it("returns empty array for unknown traceId", async () => {
    const res = await fetch(`${CONSOLE_URL}/api/events/trace/${randomUUID()}`, { headers });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.events));
    assert.equal(body.events.length, 0);
  });

  it("returns events after skill execution with correlationId", async () => {
    // Execute a skill with our traceId
    await executeSkill("annotate", `kaspa:qqtrace_${Date.now()}`, {
      correlationId: traceId,
      params: { tags: "trace_test" },
    });

    // Query trace
    const res = await fetch(`${CONSOLE_URL}/api/events/trace/${traceId}`, { headers });
    const body = await res.json();
    assert.equal(body.traceId, traceId);
    assert.ok(body.events.length >= 1, "should have at least one skill_executed event");
    const executed = body.events.find(e => e.event_type === "skill_executed");
    assert.ok(executed, "should contain skill_executed event");
  });

  it("requires authentication", async () => {
    const res = await fetch(`${CONSOLE_URL}/api/events/trace/${traceId}`, {
      headers: { "Content-Type": "application/json" },
    });
    assert.ok([401, 403].includes(res.status));
  });

  it("events are ordered by created_at ASC", async () => {
    // Ingest two events with same traceId
    const tid = randomUUID();
    for (let i = 0; i < 2; i++) {
      await fetch(`${CONSOLE_URL}/ingest/event`, {
        method: "POST", headers,
        body: JSON.stringify({
          traceId: tid,
          eventScope: "test",
          eventType: `order_test_${i}`,
          source: "test",
          level: "info",
          summary: `Event ${i}`,
        }),
      });
    }
    const { events } = await (await fetch(`${CONSOLE_URL}/api/events/trace/${tid}`, { headers })).json();
    assert.ok(events.length >= 2);
    // Verify ascending order
    for (let i = 1; i < events.length; i++) {
      assert.ok(events[i].created_at >= events[i - 1].created_at, "events should be in ascending order");
    }
  });
});
