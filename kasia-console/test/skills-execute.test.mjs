// Tests for POST /api/skills/execute — double-validation endpoint
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const CONSOLE_URL   = process.env.CONSOLE_URL   || "http://localhost:3100";
const INGEST_SECRET = process.env.INGEST_SECRET || "";
const headers = { "x-ingest-secret": INGEST_SECRET, "Content-Type": "application/json" };

describe("Skill Execute (Double Validation)", () => {
  it("rejects unknown skill", async () => {
    const res = await fetch(`${CONSOLE_URL}/api/skills/execute`, {
      method: "POST", headers,
      body: JSON.stringify({ skillName: "nonexistent_skill", peer: "kaspa:qqtest", network: "mainnet" }),
    });
    const body = await res.json();
    assert.equal(body.allowed, false);
    assert.equal(body.reason, "skill_not_found");
  });

  it("rejects frozen skill", async () => {
    // First register a frozen skill
    await fetch(`${CONSOLE_URL}/api/skills/register`, {
      method: "POST", headers,
      body: JSON.stringify({ name: "test_frozen_exec", displayName: "Frozen Test" }),
    });
    const res = await fetch(`${CONSOLE_URL}/api/skills/execute`, {
      method: "POST", headers,
      body: JSON.stringify({ skillName: "test_frozen_exec", peer: "kaspa:qqtest", network: "mainnet" }),
    });
    const body = await res.json();
    assert.equal(body.allowed, false);
    assert.equal(body.reason, "skill_not_active");
  });

  it("allows annotate skill for any peer (min_trust=normal)", async () => {
    const res = await fetch(`${CONSOLE_URL}/api/skills/execute`, {
      method: "POST", headers,
      body: JSON.stringify({
        skillName: "annotate",
        peer: "kaspa:qqtestannotate1234567890",
        network: "mainnet",
        params: { tags: "test_tag" },
      }),
    });
    const body = await res.json();
    assert.equal(body.allowed, true);
    assert.equal(body.executed, true);
    assert.ok(body.skillId);
  });

  it("denies block skill for unknown peer (requires recommended)", async () => {
    const res = await fetch(`${CONSOLE_URL}/api/skills/execute`, {
      method: "POST", headers,
      body: JSON.stringify({
        skillName: "block",
        peer: "kaspa:qqunknownpeer999",
        network: "mainnet",
      }),
    });
    const body = await res.json();
    // Unknown peer has rank 0, block requires recommended (rank 2) → denied
    assert.equal(body.allowed, false);
    assert.equal(body.reason, "insufficient_trust");
  });

  it("denies unblock skill for unknown peer (requires owner)", async () => {
    const res = await fetch(`${CONSOLE_URL}/api/skills/execute`, {
      method: "POST", headers,
      body: JSON.stringify({
        skillName: "unblock",
        peer: "kaspa:qqunknownpeer999",
        network: "mainnet",
      }),
    });
    const body = await res.json();
    assert.equal(body.allowed, false);
    assert.equal(body.reason, "insufficient_trust");
  });

  it("requires authentication", async () => {
    const res = await fetch(`${CONSOLE_URL}/api/skills/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillName: "annotate", peer: "kaspa:qqtest", network: "mainnet" }),
    });
    assert.ok([401, 403].includes(res.status));
  });

  it("requires skillName parameter", async () => {
    const res = await fetch(`${CONSOLE_URL}/api/skills/execute`, {
      method: "POST", headers,
      body: JSON.stringify({ peer: "kaspa:qqtest" }),
    });
    assert.equal(res.status, 400);
  });

  it("increments invoke count on successful execution", async () => {
    // Get current invoke count for annotate
    const { skills: before } = await (await fetch(`${CONSOLE_URL}/api/skills`, { headers })).json();
    const annotateBefore = before.find(s => s.name === "annotate");
    const countBefore = annotateBefore.invoke_count;

    // Execute annotate
    await fetch(`${CONSOLE_URL}/api/skills/execute`, {
      method: "POST", headers,
      body: JSON.stringify({
        skillName: "annotate",
        peer: "kaspa:qqtestcount1234567890",
        network: "mainnet",
        params: { notes: "invoke count test" },
      }),
    });

    // Check count increased
    const { skills: after } = await (await fetch(`${CONSOLE_URL}/api/skills`, { headers })).json();
    const annotateAfter = after.find(s => s.name === "annotate");
    assert.equal(annotateAfter.invoke_count, countBefore + 1);
  });

  // Cleanup
  it("cleanup: delete test frozen skill", async () => {
    const { skills } = await (await fetch(`${CONSOLE_URL}/api/skills`, { headers })).json();
    const frozen = skills.find(s => s.name === "test_frozen_exec");
    if (frozen) {
      await fetch(`${CONSOLE_URL}/skills/${frozen.id}/delete`, { method: "POST", redirect: "manual" });
    }
  });
});
