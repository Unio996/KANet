const msg = process.argv[2];
if (!msg) { console.error('Usage: node send-chat-eric.mjs "message"'); process.exit(1); }
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    relayId: '6fb00ee9-af18-47f4-99fa-111ee477621d',
    channel: 'kanet-public',
    message: msg,
  }),
});
console.log(JSON.stringify(await res.json()));
