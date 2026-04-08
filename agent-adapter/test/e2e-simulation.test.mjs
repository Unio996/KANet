// End-to-end simulation test — validates the complete adapter pipeline
// without requiring OpenClaw. Tests: context fetch → prompt build → skill extraction.
//
// Prerequisites: Console running on CONSOLE_URL with INGEST_SECRET
//
// Usage: CONSOLE_URL=http://localhost:3100 INGEST_SECRET=xxx TEST_ADDRESS=kaspa:qq... node --test test/e2e-simulation.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getContext, buildPrompt } from "../src/console.mjs";
import { extractSkills } from "../src/skills.mjs";
import { SYSTEM_PROMPT } from "../src/system-prompt.mjs";

const TEST_ADDRESS = process.env.TEST_ADDRESS || "";

describe("Adapter E2E simulation", () => {
  it("should have TEST_ADDRESS configured", () => {
    assert.ok(TEST_ADDRESS, "Set TEST_ADDRESS env to a known identity address");
  });

  it("fetches context from Console", async () => {
    const ctx = await getContext(TEST_ADDRESS, "mainnet");
    assert.ok(ctx, "Context should not be null for known address");
    assert.ok(ctx.identity, "Should have identity");
    assert.ok(ctx.identity.trustLevel, "Should have trustLevel");
  });

  it("builds enriched prompt with system prompt + context", async () => {
    const ctx = await getContext(TEST_ADDRESS, "mainnet");
    const prompt = buildPrompt(TEST_ADDRESS, "你好！", ctx, SYSTEM_PROMPT);

    // Verify all sections present
    assert.ok(prompt.includes("KANet"), "System prompt should be included");
    assert.ok(prompt.includes("[Peer:"), "Peer identity should be included");
    assert.ok(prompt.includes("[Trust:"), "Trust level should be included");
    assert.ok(prompt.includes("User: 你好！"), "User message should be at the end");

    // System prompt comes first
    const sysIdx = prompt.indexOf("KANet");
    const peerIdx = prompt.indexOf("[Peer:");
    const msgIdx = prompt.lastIndexOf("User: 你好！");
    assert.ok(sysIdx < peerIdx, "System prompt before peer");
    assert.ok(peerIdx < msgIdx, "Peer before message");

    console.log("\n--- Generated prompt preview (first 500 chars) ---");
    console.log(prompt.slice(0, 500));
    console.log("...\n");
  });

  it("skill extraction works on simulated AI response with annotate", () => {
    const simulatedReply = '很高兴认识你！我注意到你对KANet很感兴趣。<<SKILL:annotate:{"tags":"interested,friendly","notes":"First real conversation, seems genuinely interested in KANet"}>>';

    const { cleanReply, directives } = extractSkills(simulatedReply);

    assert.equal(cleanReply, "很高兴认识你！我注意到你对KANet很感兴趣。");
    assert.equal(directives.length, 1);
    assert.equal(directives[0].action, "annotate");
    assert.equal(directives[0].params.tags, "interested,friendly");
    assert.ok(directives[0].params.notes.includes("First real conversation"));
  });

  it("skill extraction works on simulated block scenario", () => {
    const simulatedReply = 'I cannot assist with your request. <<SKILL:annotate:{"tags":"spam,phishing","notes":"Attempted social engineering - asking for private keys"}>> <<SKILL:block>>';

    const { cleanReply, directives } = extractSkills(simulatedReply);

    assert.equal(cleanReply, "I cannot assist with your request.");
    assert.equal(directives.length, 2);
    assert.equal(directives[0].action, "annotate");
    assert.equal(directives[0].params.tags, "spam,phishing");
    assert.equal(directives[1].action, "block");
  });

  it("full pipeline: context → prompt → (simulated AI) → skill extraction", async () => {
    // Step 1: Fetch context
    const ctx = await getContext(TEST_ADDRESS, "mainnet");
    assert.ok(ctx);

    // Step 2: Build prompt
    const prompt = buildPrompt(TEST_ADDRESS, "Tell me about yourself", ctx, SYSTEM_PROMPT);
    assert.ok(prompt.includes("[Trust:"));

    // Step 3: Simulate AI response (as if OpenClaw replied)
    const simulatedAiReply = `I'm an AI Agent on the Kaspa Agent Network. I can help you with various tasks related to the KANet ecosystem. What would you like to know? <<SKILL:annotate:{"tags":"curious","notes":"Asked about agent identity"}>>`;

    // Step 4: Extract skills
    const { cleanReply, directives } = extractSkills(simulatedAiReply);

    // Verify clean reply has no skill tags
    assert.ok(!cleanReply.includes("<<SKILL"), "Clean reply should not contain skill tags");
    assert.ok(cleanReply.includes("AI Agent on the Kaspa Agent Network"));

    // Verify directive extracted
    assert.equal(directives.length, 1);
    assert.equal(directives[0].action, "annotate");

    console.log("--- Full pipeline result ---");
    console.log("Clean reply:", cleanReply.slice(0, 100));
    console.log("Directives:", JSON.stringify(directives));
    console.log("---\n");
  });

  it("handles graceful degradation when Console is unreachable", async () => {
    // When ctx is null, buildPrompt still works with system prompt
    // Use a minimal system prompt to avoid false matches from SYSTEM_PROMPT docs
    const miniSys = "You are a KANet agent.";
    const prompt = buildPrompt(TEST_ADDRESS, "hello", null, miniSys);
    assert.ok(prompt.includes("KANet"), "System prompt still included");
    assert.ok(prompt.includes("User: hello"), "Message still included");
    // Peer fallback uses address suffix, no real trustLevel/tags/notes/stats injected
    assert.ok(!prompt.includes("[Stats:"), "No stats without context");
    assert.ok(!prompt.includes("[Tags:"), "No tags without context");
    assert.ok(!prompt.includes("[Notes:"), "No notes without context");
    assert.ok(!prompt.includes("[Conversation history:]"), "No history without context");
  });
});
