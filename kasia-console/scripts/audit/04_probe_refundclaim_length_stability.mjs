import { readFileSync } from 'node:fs';
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
const { compileSilV100, ctorBytes32V100, ctorIntV100 } = await import('../../src/lib/pool-bshard-artifacts.mjs');
const { loadProtocolConstants } = await import('../../src/lib/proto-covenant-builder.mjs');
const { ps_tmpl_hash, token_tmpl_hash } = loadProtocolConstants();
const MARKET_ID = 'ef'.repeat(32);
const ANCHORS_JSON = new URL('../../scripts/proto-v0-template-anchors.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const CLAIM_TMPL_HASH = JSON.parse(readFileSync(ANCHORS_JSON, 'utf8')).contracts.KanetTokenClaim.claim_tmpl_hash;
const REFUND_CLAIM_SIL = new URL('../../src/lib/RefundClaim.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
function compile(pool_value) {
  const ctor = [
    ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(MARKET_ID),
    ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(pool_value),
    ctorIntV100(2), ctorIntV100(0), ctorBytes32V100('aa'.repeat(32)),
    ctorBytes32V100(token_tmpl_hash), ctorBytes32V100(CLAIM_TMPL_HASH),
  ];
  return compileSilV100(REFUND_CLAIM_SIL, ctor, 'RefundClaim');
}
const c1 = compile(5000); const c2 = compile(3000);
console.log('len1', c1.script.length, 'len2', c2.script.length);
console.log('state_layout', JSON.stringify(c1.state_layout));
const b1 = Buffer.from(c1.script), b2 = Buffer.from(c2.script);
console.log('prefix differ?', Buffer.compare(b1.subarray(0, c1.state_layout.start), b2.subarray(0, c1.state_layout.start)));
console.log('suffix differ?', Buffer.compare(b1.subarray(c1.state_layout.start + c1.state_layout.len), b2.subarray(c1.state_layout.start + c1.state_layout.len)));
console.log('state region c1', b1.subarray(c1.state_layout.start, c1.state_layout.start+c1.state_layout.len).toString('hex'));
console.log('state region c2', b2.subarray(c1.state_layout.start, c1.state_layout.start+c1.state_layout.len).toString('hex'));
