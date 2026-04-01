// Deep integration test — validates expanded context response with real data
// Prerequisites: Console running, INGEST_SECRET set
//
// Usage: CONSOLE_URL=http://localhost:3100 INGEST_SECRET=xxx TEST_ADDRESS=kaspa:qq... node --test test/context-deep.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const CONSOLE_URL   = process.env.CONSOLE_URL   || "http://localhost:3100";
const INGEST_SECRET = process.env.INGEST_SECRET || "";
const TEST_ADDRESS  = process.env.TEST_ADDRESS  || "";

describe("Context API — deep structure validation", () => {
  it("should have TEST_ADDRESS configured", () => {
    assert.ok(TEST_ADDRESS, "Set TEST_ADDRESS env to a known identity address");
  });

  it("returns correct top-level keys", async () => {
    const res = await fetch(
      `${CONSOLE_URL}/api/context/${encodeURIComponent(TEST_ADDRESS)}?network=mainnet`,
      { headers: { "x-ingest-secret": INGEST_SECRET } }
    );
    assert.equal(res.status, 200);
    const data = await res.json();

    // Top-level keys
    assert.ok("identity" in data, "missing identity");
    assert.ok("stats" in data, "missing stats");
    assert.ok("conv" in data, "missing conv");
    assert.ok("history" in data, "missing history");
  });

  it("identity has expanded fields: trustLevel, tags, notes", async () => {
    const res = await fetch(
      `${CONSOLE_URL}/api/context/${encodeURIComponent(TEST_ADDRESS)}?network=mainnet`,
      { headers: { "x-ingest-secret": INGEST_SECRET } }
    );
    const { identity } = await res.json();

    assert.ok("displayName" in identity, "missing displayName");
    assert.ok("trustLevel" in identity, "missing trustLevel");
    assert.ok("tags" in identity, "missing tags");
    assert.ok("notes" in identity, "missing notes");

    // trustLevel must be one of the four valid levels
    const validLevels = ["owner", "recommended", "normal", "blocked"];
    assert.ok(validLevels.includes(identity.trustLevel),
      `Invalid trustLevel: ${identity.trustLevel}`);
  });

  it("stats has correct structure when messages exist", async () => {
    const res = await fetch(
      `${CONSOLE_URL}/api/context/${encodeURIComponent(TEST_ADDRESS)}?network=mainnet`,
      { headers: { "x-ingest-secret": INGEST_SECRET } }
    );
    const { stats } = await res.json();

    if (stats) {
      assert.ok("messageCount" in stats, "missing messageCount");
      assert.ok("firstSeen" in stats, "missing firstSeen");
      assert.ok("lastSeen" in stats, "missing lastSeen");
      assert.ok("conversationCount" in stats, "missing conversationCount");
      assert.ok(typeof stats.messageCount === "number", "messageCount should be number");
      assert.ok(stats.messageCount > 0, "messageCount should be > 0");
      assert.ok(stats.conversationCount >= 1, "conversationCount should be >= 1");
    }
  });

  it("history entries have role, text, at fields", async () => {
    const res = await fetch(
      `${CONSOLE_URL}/api/context/${encodeURIComponent(TEST_ADDRESS)}?network=mainnet&limit=3`,
      { headers: { "x-ingest-secret": INGEST_SECRET } }
    );
    const { history } = await res.json();

    assert.ok(Array.isArray(history), "history should be array");
    if (history.length > 0) {
      for (const entry of history) {
        assert.ok("role" in entry, "missing role");
        assert.ok("text" in entry, "missing text");
        assert.ok("at" in entry, "missing at");
        assert.ok(["user", "assistant"].includes(entry.role),
          `Invalid role: ${entry.role}`);
      }
    }
  });

  it("respects limit parameter", async () => {
    const res = await fetch(
      `${CONSOLE_URL}/api/context/${encodeURIComponent(TEST_ADDRESS)}?network=mainnet&limit=2`,
      { headers: { "x-ingest-secret": INGEST_SECRET } }
    );
    const { history } = await res.json();
    assert.ok(history.length <= 2, `Expected <= 2 entries, got ${history.length}`);
  });
});
