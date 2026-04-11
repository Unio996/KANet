// Helper: send long chat messages that exceed curl's Content-Length quirks
const msg = process.argv[2];
if (!msg) { console.error('Usage: node send-chat.mjs "message"'); process.exit(1); }

const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    relayId: '3765cc82-5e20-4e61-bb0a-697277287223',
    channel: 'kanet-public',
    message: msg,
  }),
});
const data = await res.json();
console.log(JSON.stringify(data));
