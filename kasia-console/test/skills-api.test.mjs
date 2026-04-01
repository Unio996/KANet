// Integration tests for Skills API
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const CONSOLE_URL   = process.env.CONSOLE_URL   || "http://localhost:3100";
const INGEST_SECRET = process.env.INGEST_SECRET || "";
const headers = { "x-ingest-secret": INGEST_SECRET, "Content-Type": "application/json" };

describe("Skills API", () => {
  it("lists all skills", async () => {
    const res = await fetch(`${CONSOLE_URL}/api/skills`, { headers });
    assert.equal(res.status, 200);
    const { skills } = await res.json();
    assert.ok(Array.isArray(skills));
    assert.ok(skills.length >= 3, "Should have at least 3 builtin skills");
  });

  it("has correct builtin skills: annotate, block, unblock", async () => {
    const { skills } = await (await fetch(`${CONSOLE_URL}/api/skills`, { headers })).json();
    const names = skills.map(s => s.name);
    assert.ok(names.includes("annotate"));
    assert.ok(names.includes("block"));
    assert.ok(names.includes("unblock"));
  });

  it("builtin skills have correct trust levels", async () => {
    const { skills } = await (await fetch(`${CONSOLE_URL}/api/skills`, { headers })).json();
    const byName = Object.fromEntries(skills.map(s => [s.name, s]));
    assert.equal(byName.annotate.min_trust_level, "normal");
    assert.equal(byName.block.min_trust_level, "recommended");
    assert.equal(byName.unblock.min_trust_level, "owner");
  });

  it("filters by max_trust=normal — only annotate", async () => {
    const { skills } = await (await fetch(`${CONSOLE_URL}/api/skills?status=active&max_trust=normal`, { headers })).json();
    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, "annotate");
  });

  it("filters by max_trust=recommended — annotate + block + introduce", async () => {
    const { skills } = await (await fetch(`${CONSOLE_URL}/api/skills?status=active&max_trust=recommended`, { headers })).json();
    const names = skills.map(s => s.name).sort();
    assert.deepEqual(names, ["annotate", "block", "introduce"]);
  });

  it("filters by max_trust=owner — all 4", async () => {
    const { skills } = await (await fetch(`${CONSOLE_URL}/api/skills?status=active&max_trust=owner`, { headers })).json();
    assert.ok(skills.length >= 4);
  });

  it("auto-registers a new skill with frozen status", async () => {
    const res = await fetch(`${CONSOLE_URL}/api/skills/register`, {
      method: "POST", headers,
      body: JSON.stringify({
        name: "test_auto_skill",
        displayName: "Test Auto Skill",
        description: "Auto-registered for testing",
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.id);

    // Verify it was created with frozen status
    const { skills } = await (await fetch(`${CONSOLE_URL}/api/skills`, { headers })).json();
    const autoSkill = skills.find(s => s.name === "test_auto_skill");
    assert.ok(autoSkill, "Auto skill should exist");
    assert.equal(autoSkill.status, "frozen", "Auto skills default to frozen");
    assert.equal(autoSkill.source, "auto");
    assert.equal(autoSkill.min_trust_level, "owner");
  });

  it("frozen skills are excluded by status=active filter", async () => {
    const { skills } = await (await fetch(`${CONSOLE_URL}/api/skills?status=active`, { headers })).json();
    const autoSkill = skills.find(s => s.name === "test_auto_skill");
    assert.equal(autoSkill, undefined, "Frozen skill should not appear in active filter");
  });

  it("tracks invocations", async () => {
    const { skills } = await (await fetch(`${CONSOLE_URL}/api/skills`, { headers })).json();
    const annotate = skills.find(s => s.name === "annotate");
    const before = annotate.invoke_count;

    const invokeHeaders = { "x-ingest-secret": INGEST_SECRET };
    await fetch(`${CONSOLE_URL}/api/skills/${annotate.id}/invoke`, { method: "POST", headers: invokeHeaders });
    await fetch(`${CONSOLE_URL}/api/skills/${annotate.id}/invoke`, { method: "POST", headers: invokeHeaders });

    const { skills: after } = await (await fetch(`${CONSOLE_URL}/api/skills`, { headers })).json();
    const annotateAfter = after.find(s => s.name === "annotate");
    assert.equal(annotateAfter.invoke_count, before + 2);
    assert.ok(annotateAfter.last_invoked_at, "Should have last_invoked_at");
  });

  it("rejects unauthenticated requests", async () => {
    const res = await fetch(`${CONSOLE_URL}/api/skills`);
    assert.ok([401, 403].includes(res.status));
  });

  it("skills UI page renders", async () => {
    const res = await fetch(`${CONSOLE_URL}/skills`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes("Annotate Peer"), "Should show builtin skill name");
    assert.ok(html.includes("Block Peer"));
  });

  // Cleanup: delete the test auto skill
  it("deletes non-builtin skill", async () => {
    const { skills } = await (await fetch(`${CONSOLE_URL}/api/skills`, { headers })).json();
    const autoSkill = skills.find(s => s.name === "test_auto_skill");
    if (autoSkill) {
      const res = await fetch(`${CONSOLE_URL}/skills/${autoSkill.id}/delete`, {
        method: "POST", redirect: "manual",
      });
      // Should redirect (302)
      assert.ok([302, 303].includes(res.status) || res.status === 200);
    }
  });
});
