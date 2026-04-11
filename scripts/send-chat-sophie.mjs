const msg = process.argv[2];
if (!msg) { console.error('Usage: node send-chat-sophie.mjs "message"'); process.exit(1); }
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    relayId: 'a83c4b07-eaf7-4d21-972a-1265e0cdcfcf',
    channel: 'kanet-public',
    message: msg,
  }),
});
console.log(JSON.stringify(await res.json()));
