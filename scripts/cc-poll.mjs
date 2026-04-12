// scripts/cc-poll.mjs
// Poll the Claude Code Bridge for the next pending Mind task.
// Usage: node scripts/cc-poll.mjs [bridge-url]
// Returns: JSON with { id, system, user, model } or empty if none pending.

const BRIDGE = (process.argv[2] || process.env.CC_BRIDGE_URL || 'http://localhost:9100').replace(/\/+$/, '');

try {
  const res = await fetch(`${BRIDGE}/cc/pending`);
  if (res.status === 204) {
    console.log('No pending requests.');
    process.exit(0);
  }
  const data = await res.json();
  console.log(`\n=== PENDING REQUEST [${data.id}] (${data.age_ms}ms ago) ===`);
  console.log(`Model: ${data.model}`);
  if (data.system) {
    console.log(`\n--- SYSTEM (${data.system.length} chars) ---`);
    console.log(data.system.slice(0, 2000));
    if (data.system.length > 2000) console.log(`\n... (${data.system.length - 2000} more chars)`);
  }
  console.log(`\n--- USER (${data.user.length} chars) ---`);
  console.log(data.user.slice(0, 3000));
  if (data.user.length > 3000) console.log(`\n... (${data.user.length - 3000} more chars)`);
  console.log(`\n=== To respond: node scripts/cc-respond.mjs ${data.id} "your response" ===`);
} catch (err) {
  console.error('Bridge unreachable:', err.message);
  process.exit(1);
}
