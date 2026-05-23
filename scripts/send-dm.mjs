// send-dm.mjs — UTF-8 safe chain DM via /api/relay/:id/send-command (mirror send-chat.mjs pattern)
//
// 真因: Bash on Windows 经 PowerShell shell encoding (GBK default) → curl 命令行参数中文 corrupt.
// /api/relay/:id/send-command 收到 message 真 ASCII '??' (loss-of-fidelity).
// 真 server-side preHandler ENCODING_BAD_RE 仅 detect U+FFFD/lone surrogate, 不 catch GBK→ASCII '??'.
//
// 真修 (T2.17 / NWT r292 Bug #12): client-side UTF-8 file-based read, Node fetch UTF-8 safe.
//
// 用法:
//   1. Write tool 写消息到 /tmp/msg.txt (UTF-8)
//   2. node scripts/send-dm.mjs <relayId> <target_kasia> <message-file>
// 或短路径 (仅 ASCII):
//   node scripts/send-dm.mjs <relayId> <target_kasia> --inline "ASCII only"
//
// Relay IDs 速查:
//   J2       c9c37c37-9a8c-484c-9893-20185d97ccf9
//   NWT      5b236c08-03d0-456c-953d-e10001610938
//   Trader-B 0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0
//   Trader-M 385f68eb-21a8-4e83-bb33-fa9f54a038ea

import fs from 'node:fs';

const CONSOLE = process.env.KANET_CONSOLE || 'http://localhost:3100';

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error('usage: node send-dm.mjs <relayId> <target_kasia> <message-file-path>');
  console.error('   or: node send-dm.mjs <relayId> <target_kasia> --inline "ASCII message"');
  process.exit(1);
}

const [relayId, target, third, ...rest] = args;

let message;
if (third === '--inline') {
  message = rest.join(' ');
  if (!message) { console.error('--inline 后必须跟消息文本'); process.exit(1); }
  if (/[^\x00-\x7F]/.test(message)) {
    console.error('⚠  --inline 含非 ASCII 字符. PowerShell shell encoding 可能 corrupt CJK. 中文 / emoji 用文件: Write 到 UTF-8 文件 + 传文件路径.');
  }
} else {
  const filePath = third;
  if (!fs.existsSync(filePath)) { console.error('文件不存在:', filePath); process.exit(2); }
  message = fs.readFileSync(filePath, 'utf8');
  if (!message.trim()) { console.error('文件为空:', filePath); process.exit(2); }
}

const body = JSON.stringify({ type: 'send_message', target, message });
const t0 = Date.now();
try {
  const res = await fetch(`${CONSOLE}/api/relay/${relayId}/send-command`, {
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
