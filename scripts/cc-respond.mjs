// scripts/cc-respond.mjs
// Submit a response to the Claude Code Bridge for a pending Mind task.
// Usage: node scripts/cc-respond.mjs <request-id> <response-text>
//    or: echo "response" | node scripts/cc-respond.mjs <request-id> -

const BRIDGE = (process.env.CC_BRIDGE_URL || 'http://localhost:9100').replace(/\/+$/, '');

const id = process.argv[2];
let text = process.argv.slice(3).join(' ');

if (!id) {
  console.error('Usage: node cc-respond.mjs <request-id> <response-text>');
  console.error('   or: echo "text" | node cc-respond.mjs <request-id> -');
  process.exit(1);
}

// Read from stdin if "-" is the text argument
if (text === '-' || !text) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  text = Buffer.concat(chunks).toString('utf8').trim();
}

if (!text) {
  console.error('Error: empty response text');
  process.exit(1);
}

try {
  const res = await fetch(`${BRIDGE}/cc/respond/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  if (data.ok) {
    console.log(`Response submitted for [${id}] (${text.length} chars)`);
  } else {
    console.error('Error:', data.error);
    process.exit(1);
  }
} catch (err) {
  console.error('Bridge unreachable:', err.message);
  process.exit(1);
}
