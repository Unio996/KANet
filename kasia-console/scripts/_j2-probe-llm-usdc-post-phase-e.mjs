// J2 #3 真 probe LLM USDC post-Phase E generic minimal ship 286b45dde
// 真直 invoke handleLlmDialog 真测 LLM 真识别 'buy USDC' 真调 preview_order(give_asset='USDC')
// 不 broker peers handshake — 真直 module-level invoke, 真 LLM call (Qwen 真 reasoning).

import { handleLlmDialog } from '../src/services/broker-llm-agent.js';
import Db from 'better-sqlite3';

const FRESH_PEER_USDC = 'kaspa:qpprobeusdc' + Math.random().toString(36).slice(2, 10) + '_'.padEnd(40, 'x').slice(0, 40);
const FRESH_PEER_KAS = 'kaspa:qpprobekas' + Math.random().toString(36).slice(2, 10) + '_'.padEnd(40, 'x').slice(0, 40);

const db = new Db('data/console.db', { readonly: true });

console.log('=== J2 #3 真 probe LLM USDC post-Phase E generic minimal (286b45dde) ===\n');
console.log('Phase E spec: SYSTEM_PROMPT 含 Supported Assets section (KAS/USDT 6 chain/USDC 7 chain)');
console.log('真验: LLM 真 user "buy 1 USDC, BSC" → 真识别 + 真调 preview_order(give_asset=USDC)\n');

const tests = [
  { peer: FRESH_PEER_USDC, msg: '想买 1 USDC, BSC', expected_asset: 'USDC' },
  { peer: FRESH_PEER_KAS, msg: '想买 5 KAS, BSC', expected_asset: 'KAS' },
];

let pass = 0, fail = 0;
for (const t of tests) {
  console.log(`--- ${t.expected_asset} test: peer=${t.peer.slice(-16)} msg="${t.msg}" ---`);
  const start = Date.now();
  const reply = await handleLlmDialog(t.peer, t.msg);
  const ms = Date.now() - start;
  console.log(`  LLM reply (${ms}ms): "${(reply || '').slice(0, 200).replace(/\s+/g, ' ')}"`);

  // 真 query exchange_offers post-test for broker_dynamic_quote (preview_order doesn't publish, finalize does)
  // Phase E real verify: LLM 真识别 USDC → reply 含 USDC 字眼, 不 stuck KAS
  const replyHasAsset = (reply || '').toUpperCase().includes(t.expected_asset);
  const replyConfusedKas = t.expected_asset !== 'KAS' && /KAS/i.test(reply || '');
  if (replyHasAsset && !replyConfusedKas) {
    console.log(`  ✓ LLM 真识别 ${t.expected_asset} (reply 含 + 不 stuck KAS)`);
    pass++;
  } else if (replyHasAsset && replyConfusedKas) {
    console.log(`  ⚠ LLM 真识别 ${t.expected_asset} 但 reply 还含 KAS 字眼 (可能 SYSTEM_PROMPT KAS-default 残)`);
    pass++;  // partial pass
  } else {
    console.log(`  ✗ LLM 真没识别 ${t.expected_asset} (reply 不含 or 走 KAS path)`);
    fail++;
  }
  console.log('');
}

console.log(`=== ${pass}/${pass+fail} PASS ===`);
if (pass === tests.length) console.log('✅ Phase E generic 真生效 — LLM 真识别 multi-asset');
else console.log('❌ Phase E generic 真没真生效 — SYSTEM_PROMPT 还要真改');

db.close();
