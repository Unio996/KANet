// Unit tests for skills.mjs — skill parsing and extraction
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractSkills } from "../src/skills.mjs";

describe("extractSkills", () => {
  it("returns empty directives and unchanged reply when no skills present", () => {
    const reply = "Hello! How can I help you today?";
    const { cleanReply, directives } = extractSkills(reply);
    assert.equal(cleanReply, reply);
    assert.equal(directives.length, 0);
  });

  it("extracts annotate skill with JSON params", () => {
    const reply = 'Nice to meet you! <<SKILL:annotate:{"tags":"developer","notes":"Introduced as a frontend dev"}>>';
    const { cleanReply, directives } = extractSkills(reply);
    assert.equal(cleanReply, "Nice to meet you!");
    assert.equal(directives.length, 1);
    assert.equal(directives[0].action, "annotate");
    assert.equal(directives[0].params.tags, "developer");
    assert.equal(directives[0].params.notes, "Introduced as a frontend dev");
  });

  it("extracts block skill without params", () => {
    const reply = "I'm unable to assist with your request. <<SKILL:block>>";
    const { cleanReply, directives } = extractSkills(reply);
    assert.equal(cleanReply, "I'm unable to assist with your request.");
    assert.equal(directives.length, 1);
    assert.equal(directives[0].action, "block");
    assert.deepEqual(directives[0].params, {});
  });

  it("extracts multiple skills from one reply", () => {
    const reply = 'Noted. <<SKILL:annotate:{"tags":"spam","trust_level":"blocked"}>> <<SKILL:block>>';
    const { cleanReply, directives } = extractSkills(reply);
    assert.equal(cleanReply, "Noted.");
    assert.equal(directives.length, 2);
    assert.equal(directives[0].action, "annotate");
    assert.equal(directives[0].params.trust_level, "blocked");
    assert.equal(directives[1].action, "block");
  });

  it("handles skill in the middle of text", () => {
    const reply = "Thanks for sharing. <<SKILL:annotate:{ \"tags\": \"helpful\" }>> I'll remember that.";
    const { cleanReply, directives } = extractSkills(reply);
    assert.ok(cleanReply.includes("Thanks for sharing."));
    assert.ok(cleanReply.includes("I'll remember that."));
    assert.ok(!cleanReply.includes("SKILL"));
    assert.equal(directives.length, 1);
  });

  it("handles unblock skill", () => {
    const reply = "Welcome back! <<SKILL:unblock>>";
    const { cleanReply, directives } = extractSkills(reply);
    assert.equal(cleanReply, "Welcome back!");
    assert.equal(directives[0].action, "unblock");
  });

  it("handles annotate with trust_level change", () => {
    const reply = '<<SKILL:annotate:{"trust_level":"trusted"}>> You have been very helpful, I appreciate it.';
    const { cleanReply, directives } = extractSkills(reply);
    assert.equal(cleanReply, "You have been very helpful, I appreciate it.");
    assert.equal(directives[0].params.trust_level, "trusted");
  });

  it("collapses excess newlines after stripping skills", () => {
    const reply = "Line one.\n\n<<SKILL:block>>\n\n\nLine two.";
    const { cleanReply, directives } = extractSkills(reply);
    assert.ok(!cleanReply.includes("\n\n\n"));
    assert.equal(directives.length, 1);
  });

  it("gracefully handles malformed JSON in skill params", () => {
    const reply = "Hello <<SKILL:annotate:{bad json}>> world";
    const { cleanReply, directives } = extractSkills(reply);
    assert.equal(cleanReply, "Hello  world");
    // Still extracted the directive, just with empty params due to parse failure
    assert.equal(directives.length, 1);
    assert.equal(directives[0].action, "annotate");
  });
});
