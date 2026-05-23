#!/usr/bin/env node
// T-J2-23 dev tool: broker probe with strict UTF-8.
// Owner 编码 RCA: curl -d / PowerShell Invoke-RestMethod 默认 corrupt CJK → broker LLM "买还是卖" 假阳性.
// 这个脚本用 Node fetch (UTF-8 严格) + 合法 fake peer 格式, 绕开测试客户端编码坑.
//
// 用法:
//   node scripts/broker-probe.mjs '买 50 KAS'
//   node scripts/broker-probe.mjs '我要买 50 KAS' '我想卖 5 KAS' 'comprar 10 KAS'
//   node scripts/broker-probe.mjs --target=send-command   (PZ-BROKER-DM-ENCODING v2 矩阵)
// 默认 (--target=reply): 跑 v1 测试矩阵 6 中文 + 4 多语言 case (broker LLM 中文意图识别).
// --target=send-command: 跑 v2 矩阵 5 case (preHandler encoding guard 验证, hit 400 OR 放过).

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const J2_RELAY_ID = process.env.J2_RELAY_ID || 'c9c37c37-9a8c-484c-9893-20185d97ccf9';
const CONSOLE_URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3100';

const DEFAULT_MATRIX = [
  '买 50 KAS', '我要买 50 KAS', '买 50 个 KAS', '想买 50 个 kas', '买 5 KAS', '我想买点 kas',
  'buy 50 KAS', 'comprar 50 KAS', '50 KAS 買いたい', '50 KAS 사고 싶어',
];

// PZ-BROKER-DM-ENCODING v2 — preHandler encoding guard for /api/relay/:id/send-command.
// expectStatus 400 = preHandler reject (encoding bug); 200/503 = preHandler 放过 (走到 relay-manager).
// Note: 503 期望因 fake peer / fake target / relay 不忙才返, 不算 fail.
const SEND_COMMAND_MATRIX = [
  // Valid UTF-8 — preHandler 放过, 走 relay-manager (success or 503 is fine, NOT 400)
  { type: 'send_message', target: 'kaspa:qpfake_probe_valid_zh', message: '买 50 KAS', expectStatus: [200, 503] },
  { type: 'send_broadcast', channel: 'kanet-test', message: '50 KAS 卖单广播测试', expectStatus: [200, 503] },
  // Invalid UTF-8 — preHandler 400 reject
  { type: 'send_message', target: 'kaspa:qpfake_probe_lone_surr', message: 'hello \uD83D bad', expectStatus: [400] },
  { type: 'send_broadcast', channel: 'kanet-test', message: 'broadcast � content', expectStatus: [400] },
  // type=transfer 不含 user message — preHandler skip (无关 path 不该 hit guard)
  { type: 'transfer', target: 'kaspa:qpfake_xfer', amount: '0.001', expectStatus: [200, 503] },
];

function makePeer(seed) {
  const ts = Date.now().toString(36);
  return `kaspa:qpfake_probe_${ts}_${seed.toString(36)}`;
}

async function probe(message, idx) {
  const peer = makePeer(idx);
  const body = JSON.stringify({ relayNodeId: BROKER_RELAY_ID, peer, message });
  const utf8len = Buffer.from(message, 'utf-8').length;
  const codes = [...message].map(c => c.charCodeAt(0).toString(16)).join(',');
  const t0 = Date.now();
  const res = await fetch(`${CONSOLE_URL}/api/agent/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body,
  });
  const dt = Date.now() - t0;
  const data = await res.json().catch(() => ({}));
  const reply = data.reply ?? data.error ?? '';
  const verdict = res.ok && /(哪个链|哪条链|which chain|qué cadena|cadena para|どのチェーン|어느 체인)/i.test(reply) ? '✓ DET'
                : res.ok && reply === '' ? '✓ SILENT (handler regex 命中)'
                : res.ok && /(买还是卖|买.*卖|are you.*buy.*sell)/i.test(reply) ? '✗ LLM ASK DIRECTION'
                : res.ok ? '🟡 OTHER'
                : `✗ HTTP ${res.status}`;
  console.log(`[${String(idx + 1).padStart(2)}] ${verdict.padEnd(20)} (${dt}ms, utf8=${utf8len}B, codes=[${codes}])`);
  console.log(`     msg=${JSON.stringify(message)}`);
  console.log(`     reply=${JSON.stringify(reply).slice(0, 200)}`);
}

async function probeSendCommand(item, idx) {
  const url = `${CONSOLE_URL}/api/relay/${J2_RELAY_ID}/send-command`;
  const body = JSON.stringify(item);
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body,
  });
  const dt = Date.now() - t0;
  const data = await res.json().catch(() => ({}));
  const ok = item.expectStatus.includes(res.status);
  const verdict = ok ? `✓ ${res.status}` : `✗ ${res.status} (expect ${item.expectStatus.join('/')})`;
  const msgPreview = (item.message || '(no message)').slice(0, 30);
  console.log(`[${String(idx + 1).padStart(2)}] ${verdict.padEnd(22)} type=${item.type.padEnd(15)} (${dt}ms) msg=${JSON.stringify(msgPreview)}`);
  if (data.error) console.log(`     err=${JSON.stringify(data.error).slice(0, 200)}`);
  return ok;
}

const args = process.argv.slice(2);
const targetFlag = args.find(a => a.startsWith('--target='));
const target = targetFlag ? targetFlag.split('=')[1] : 'reply';

if (target === 'send-command') {
  console.log(`probing send-command preHandler at ${CONSOLE_URL} (relay=${J2_RELAY_ID.slice(0,8)}) with ${SEND_COMMAND_MATRIX.length} case(s)\n`);
  let pass = 0;
  for (let i = 0; i < SEND_COMMAND_MATRIX.length; i++) {
    if (await probeSendCommand(SEND_COMMAND_MATRIX[i], i)) pass++;
  }
  console.log(`\nresult: ${pass}/${SEND_COMMAND_MATRIX.length} PASS`);
  process.exit(pass === SEND_COMMAND_MATRIX.length ? 0 : 1);
} else {
  const positionalArgs = args.filter(a => !a.startsWith('--'));
  const matrix = positionalArgs.length > 0 ? positionalArgs : DEFAULT_MATRIX;
  console.log(`probing ${CONSOLE_URL} with ${matrix.length} message(s)\n`);
  for (let i = 0; i < matrix.length; i++) {
    await probe(matrix[i], i);
  }
}
