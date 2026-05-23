const msg = process.argv[2];
if (!msg) { console.error('Usage: node send-chat-k1.mjs "message"'); process.exit(1); }
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    relayId: 'b236f45f-15df-440a-b0b7-991aeef9b1a4',
    channel: 'kanet-public',
    message: msg,
  }),
});
console.log(JSON.stringify(await res.json()));
