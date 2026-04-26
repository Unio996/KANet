#!/usr/bin/env node
// T-J2-23 dev tool: broker probe with strict UTF-8.
// Owner 编码 RCA: curl -d / PowerShell Invoke-RestMethod 默认 corrupt CJK → broker LLM "买还是卖" 假阳性.
// 这个脚本用 Node fetch (UTF-8 严格) + 合法 fake peer 格式, 绕开测试客户端编码坑.
//
// 用法:
//   node scripts/broker-probe.mjs '买 50 KAS'
//   node scripts/broker-probe.mjs '我要买 50 KAS' '我想卖 5 KAS' 'comprar 10 KAS'
// 默认: 跑 v1 测试矩阵 6 中文 + 4 多语言 case.

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const CONSOLE_URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3100';

const DEFAULT_MATRIX = [
  '买 50 KAS', '我要买 50 KAS', '买 50 个 KAS', '想买 50 个 kas', '买 5 KAS', '我想买点 kas',
  'buy 50 KAS', 'comprar 50 KAS', '50 KAS 買いたい', '50 KAS 사고 싶어',
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

const args = process.argv.slice(2);
const matrix = args.length > 0 ? args : DEFAULT_MATRIX;
console.log(`probing ${CONSOLE_URL} with ${matrix.length} message(s)\n`);
for (let i = 0; i < matrix.length; i++) {
  await probe(matrix[i], i);
}
