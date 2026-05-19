import http from 'http';

// Channel Monitor — polls dev-coord, broadcasts each new msg ONCE
const POLL_INTERVAL = 10000; // 10s
const MAX_MSGS = 20;
const QCLAUDE_RELAY_ID = '5669b415-dc23-4db2-9c23-4213838c97d7';

// Track by message ID + created_at to avoid re-detecting same msg
let seenIds = new Set();
let lastSeenTimestamp = null; // oldest seen message timestamp

function httpGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: 3100, path, method: 'GET',
      headers: { 'User-Agent': 'Qclaude-Monitor/1.0' },
      timeout: 8000
    }, res => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data: d }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

function httpPost(path, bodyStr) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(bodyStr);
    const req = http.request({
      hostname: '127.0.0.1', port: 3100, path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        'User-Agent': 'Qclaude-Monitor/1.0'
      },
      timeout: 8000
    }, res => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data: d }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function sendMessage(msg) {
  const body = JSON.stringify({ relayId: QCLAUDE_RELAY_ID, channel: 'dev-coord', message: msg });
  return httpPost('/api/chat/send', body);
}

async function poll() {
  const r = await httpGet('/api/chat/messages?channel=dev-coord&limit=' + MAX_MSGS);
  const parsed = JSON.parse(r.data);
  return parsed.messages || [];
}

async function broadcast(msg) {
  try {
    const result = await sendMessage(msg);
    if (result.status === 200) {
      console.log('[Monitor] 📡 BROADCAST OK');
      return true;
    } else {
      const errData = JSON.parse(result.data);
      if (errData.error && errData.error.includes('duplicate')) {
        console.log('[Monitor] Duplicate (skipped)');
        return false;
      }
      console.log('[Monitor] Fail:', result.data.slice(0, 100));
      return false;
    }
  } catch (err) {
    console.log('[Monitor] Send err:', err.message);
    return false;
  }
}

// Initial broadcast
await sendMessage('[Qclaude Monitor] 🔄 监控已启动\n频道: dev-coord\n轮询: 10秒\n模式: 每新消息广播一次，不重复');

// Catch up — index all existing messages
try {
  const allMsgs = await poll();
  for (const m of allMsgs) {
    const id = m.id || '';
    seenIds.add(id);
    // Track the oldest timestamp seen
    if (!lastSeenTimestamp || m.created_at < lastSeenTimestamp) {
      lastSeenTimestamp = m.created_at;
    }
  }
  console.log('[Monitor] Indexed ' + allMsgs.length + ' messages (oldest: ' + lastSeenTimestamp + ')');
} catch (err) {
  console.log('[Monitor] Index error:', err.message);
}

console.log('[Monitor] Starting real-time loop...');

while (true) {
  await new Promise(r => setTimeout(r, 3000)); // 3s warmup

  try {
    const msgs = await poll();

    // Find truly new messages (by ID + after last timestamp)
    // Bug fix 5/19 (Owner 钦定 "找 bug 修"): recursive echo loop —
    // 旧 logic broadcast 自己 wrap message → next poll 读到自己 → 又 wrap → 无限套娃, 每 8s 1 笔 KAS fee.
    // 修法: skip self-broadcasts (by Qclaude relay address tail OR content prefix "[Qclaude Monitor]").
    // self message 仍 add to seenIds 防 future re-wrap, 但 不 push 进 newMsgs.
    const QCLAUDE_ADDR_TAIL = 'htxjv3hd6efu';
    const MONITOR_PREFIX = '[Qclaude Monitor]';
    const newMsgs = [];
    for (const m of msgs) {
      const id = m.id || '';
      const ts = m.created_at || '';
      const sender = m.sender_address || '';
      const content = m.content || '';

      // Skip self-broadcasts (echo loop 防): Qclaude relay sender OR Monitor prefix content
      if (sender.endsWith(QCLAUDE_ADDR_TAIL) || content.startsWith(MONITOR_PREFIX)) {
        seenIds.add(id);  // mark seen so 不会未来仍 trigger
        continue;
      }

      // Only consider messages newer than what we've seen
      if (!seenIds.has(id) && (!lastSeenTimestamp || ts > lastSeenTimestamp)) {
        seenIds.add(id);
        newMsgs.push(m);
      }
    }

    if (newMsgs.length > 0) {
      console.log('[Monitor] Found ' + newMsgs.length + ' new msg(s)');

      const lines = newMsgs.map(m => {
        const sender = (m.sender_address || '').slice(-8);
        const content = (m.content || '').replace(/\n/g, ' ').slice(0, 250);
        return '  [' + m.created_at + '] ' + sender + ': ' + content;
      });

      const now = new Date().toISOString();
      const summary = '[Qclaude Monitor] 📡 NEW (' + newMsgs.length + ') [' + now + ']\n\n' + lines.join('\n\n');

      await broadcast(summary);
    }
  } catch (err) {
    console.log('[Monitor] Poll error:', err.message);
  }

  await new Promise(r => setTimeout(r, POLL_INTERVAL));
}
