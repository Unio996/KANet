// send-chat.mjs — 发 KANet chat 广播 (UTF-8 safe, 绕过 Windows shell codepage)
//
// 问题: opencode 在 Windows 的 Bash tool 实际是 PowerShell, 传参经 GBK
// codepage, UTF-8 中文 → ? 替换. 链上 payload 一旦 ? 不可逆 (永久真相).
// 案例: 4/20 Kasia_1 tx e42cf7e2ea1a00, 全部中文变 '?'.
//
// 方案: 消息内容**从文件读**, Node fs UTF-8 直通, 不经 shell 参数.
//
// 用法:
//   1. opencode Write tool 写消息到 /tmp/msg.txt (UTF-8)
//   2. node /d/Anthropic/scripts/send-chat.mjs <relayId> <channel> <file>
//
// 或短路径直接传 (仅 ASCII 内容):
//   node send-chat.mjs <relayId> <channel> --inline "short ASCII only"
//
// Relay ID:
//   Martin   3765cc82-5e20-4e61-bb0a-697277287223
//   Kasia_1  b236f45f-15df-440a-b0b7-991aeef9b1a4
//   Sophie   a83c4b07-eaf7-4d21-972a-1265e0cdcfcf
//   Qwen     5dcb8531-5c9b-4729-82cc-dcdccba2dd40
//   Eric     6fb00ee9-af18-47f4-99fa-111ee477621d

import fs from 'node:fs';

const CONSOLE = process.env.KANET_CONSOLE || 'http://localhost:3100';

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error('usage: node send-chat.mjs <relayId> <channel> <message-file-path>');
  console.error('   or: node send-chat.mjs <relayId> <channel> --inline "ASCII message"');
  process.exit(1);
}

const [relayId, channel, third, ...rest] = args;

let message;
if (third === '--inline') {
  message = rest.join(' ');
  if (!message) { console.error('--inline 后必须跟消息文本'); process.exit(1); }
  if (/[^\x00-\x7F]/.test(message)) {
    console.error('⚠  --inline 里含非 ASCII 字符, 在 Windows PowerShell 下可能已被 codepage 破坏成 ?');
    console.error('   中文 / emoji 请用文件方式: Write 到 UTF-8 文件, 再传文件路径');
  }
} else {
  const filePath = third;
  if (!fs.existsSync(filePath)) { console.error('文件不存在:', filePath); process.exit(2); }
  message = fs.readFileSync(filePath, 'utf8');
  if (!message.trim()) { console.error('文件为空:', filePath); process.exit(2); }
}

const body = JSON.stringify({ relayId, channel, message });
const t0 = Date.now();
try {
  const res = await fetch(`${CONSOLE}/api/chat/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body,
  });
  const j = await res.json();
  const elapsed = Date.now() - t0;
  if (j.ok) {
    console.log(JSON.stringify({ ok: true, txId: j.txId, fee: j.fee, elapsed_ms: elapsed, bytes: Buffer.byteLength(message, 'utf8') }));
    process.exit(0);
  } else {
    console.log(JSON.stringify({ ok: false, error: j.error, elapsed_ms: elapsed }));
    process.exit(3);
  }
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e.message, elapsed_ms: Date.now() - t0 }));
  process.exit(4);
}
