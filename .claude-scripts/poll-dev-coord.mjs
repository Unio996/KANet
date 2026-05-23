import { execSync } from 'child_process';

try {
  const now = new Date().toISOString();
  const res = execSync('curl -s "http://127.0.0.1:3100/api/chat/messages?channel=dev-coord&limit=3"', { encoding: 'utf8' });
  const data = JSON.parse(res);
  const msgs = data.messages || [];
  for (const m of msgs) {
    const ts = new Date(m.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Bangkok', hour12: false });
    const text = m.content || '';
    const preview = text.length > 100 ? text.substring(0, 100) + '...' : text;
    console.log(`[${now}] ${ts}  ${m.sender_address?.slice(-12)} [${m.channel_name}]:\n${preview}\n`);
  }
  if (msgs.length === 0) {
    console.log(`[${now}] no new messages`);
  }
} catch (e) {
  console.error(`[${new Date().toISOString()}] poll error: ${e.message}`);
}
