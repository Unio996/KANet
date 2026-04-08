// Unit tests for console.mjs — buildPrompt function
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "../src/console.mjs";

const PEER = "kaspa:qr1234567890abcdef1234567890abcdef12345678";

describe("buildPrompt", () => {
  it("returns raw message when no context and no system prompt", () => {
    const result = buildPrompt(PEER, "hello", null);
    assert.equal(result, "hello");
  });

  it("returns raw message when context has no identity and no history", () => {
    const ctx = { identity: null, conv: null, history: [] };
    const result = buildPrompt(PEER, "hello", ctx);
    assert.equal(result, "hello");
  });

  it("injects peer name and trust level", () => {
    const ctx = {
      identity: { displayName: "Alice", trustLevel: "trusted", tags: null, notes: null },
      stats: null,
      conv: null,
      history: [],
    };
    const result = buildPrompt(PEER, "hello", ctx);
    assert.ok(result.includes("[Peer: Alice"));
    assert.ok(result.includes("[Trust: trusted]"));
    assert.ok(result.includes("User: hello"));
  });

  it("injects tags and notes when present", () => {
    const ctx = {
      identity: {
        displayName: "Bob",
        trustLevel: "normal",
        tags: "developer,partner",
        notes: "Met at conference",
      },
      stats: null,
      conv: null,
      history: [],
    };
    const result = buildPrompt(PEER, "hi", ctx);
    assert.ok(result.includes("[Tags: developer,partner]"));
    assert.ok(result.includes("[Notes: Met at conference]"));
  });

  it("injects interaction stats", () => {
    const ctx = {
      identity: { displayName: "Carol", trustLevel: "trusted", tags: null, notes: null },
      stats: {
        messageCount: 42,
        firstSeen: "2026-02-15T10:00:00Z",
        lastSeen: "2026-03-13T15:30:00Z",
        conversationCount: 3,
      },
      conv: null,
      history: [],
    };
    const result = buildPrompt(PEER, "hey", ctx);
    assert.ok(result.includes("[Stats:"));
    assert.ok(result.includes("42 messages"));
    assert.ok(result.includes("3 conversations"));
    assert.ok(result.includes("first seen"));
    assert.ok(result.includes("last active"));
  });

  it("does not show conversation count when only 1", () => {
    const ctx = {
      identity: { displayName: "Dave", trustLevel: "normal", tags: null, notes: null },
      stats: { messageCount: 5, firstSeen: "2026-03-14", lastSeen: "2026-03-14", conversationCount: 1 },
      conv: null,
      history: [],
    };
    const result = buildPrompt(PEER, "test", ctx);
    assert.ok(result.includes("5 messages"));
    assert.ok(!result.includes("1 conversations"));
  });

  it("includes conversation history", () => {
    const ctx = {
      identity: { displayName: "Eve", trustLevel: "normal", tags: null, notes: null },
      stats: null,
      conv: { id: "conv-1", status: "active" },
      history: [
        { role: "user", text: "What's your name?" },
        { role: "assistant", text: "I'm KANet Agent." },
      ],
    };
    const result = buildPrompt(PEER, "How old are you?", ctx);
    assert.ok(result.includes("[Conversation history:]"));
    assert.ok(result.includes("User: What's your name?"));
    assert.ok(result.includes("Assistant: I'm KANet Agent."));
    assert.ok(result.includes("User: How old are you?"));
  });

  it("injects system prompt when provided", () => {
    const ctx = {
      identity: { displayName: "Frank", trustLevel: "owner", tags: null, notes: null },
      stats: null,
      conv: null,
      history: [],
    };
    const sysPrompt = "You are a helpful AI agent.";
    const result = buildPrompt(PEER, "status", ctx, sysPrompt);
    assert.ok(result.startsWith("You are a helpful AI agent."));
    assert.ok(result.includes("---"));
    assert.ok(result.includes("[Peer: Frank"));
    assert.ok(result.includes("[Trust: owner]"));
  });

  it("includes system prompt even with no identity/history", () => {
    const sysPrompt = "System rules here.";
    const result = buildPrompt(PEER, "hello", null, sysPrompt);
    assert.ok(result.includes("System rules here."));
    assert.ok(result.includes("User: hello"));
  });

  it("builds complete prompt with all sections", () => {
    const ctx = {
      identity: {
        displayName: "Grace",
        trustLevel: "trusted",
        tags: "vip,developer",
        notes: "Key partner",
      },
      stats: {
        messageCount: 100,
        firstSeen: "2026-01-01",
        lastSeen: "2026-03-14",
        conversationCount: 5,
      },
      conv: { id: "c1", status: "active" },
      history: [
        { role: "user", text: "Previous question" },
        { role: "assistant", text: "Previous answer" },
      ],
    };
    const result = buildPrompt(PEER, "New question", ctx, "SYSTEM PROMPT");

    // Verify ordering: system → identity → stats → history → new message
    const sysIdx = result.indexOf("SYSTEM PROMPT");
    const peerIdx = result.indexOf("[Peer:");
    const trustIdx = result.indexOf("[Trust:");
    const tagsIdx = result.indexOf("[Tags:");
    const notesIdx = result.indexOf("[Notes:");
    const statsIdx = result.indexOf("[Stats:");
    const histIdx = result.indexOf("[Conversation history:]");
    const msgIdx = result.lastIndexOf("User: New question");

    assert.ok(sysIdx < peerIdx, "system before peer");
    assert.ok(peerIdx < trustIdx, "peer before trust");
    assert.ok(trustIdx < tagsIdx, "trust before tags");
    assert.ok(tagsIdx < notesIdx, "tags before notes");
    assert.ok(notesIdx < statsIdx, "notes before stats");
    assert.ok(statsIdx < histIdx, "stats before history");
    assert.ok(histIdx < msgIdx, "history before new message");
  });
});
