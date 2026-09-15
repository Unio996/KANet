import { randomBytes } from 'node:crypto';
const kaspa = await import('kaspa-wasm');
const { compileSilV100, ctorBytes32V100, ctorIntV100 } = await import('../../src/lib/pool-bshard-artifacts.mjs');
const { loadProtocolConstants } = await import('../../src/lib/proto-covenant-builder.mjs');
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const { blake2b } = require('../../node_modules/@noble/hashes/blake2b.js');
const b2b = (buf) => Buffer.from(blake2b(Uint8Array.from(buf), { dkLen: 32 }));
const p2sh = (bc) => Buffer.concat([Buffer.from([0xaa, 0x20]), b2b(bc), Buffer.from([0x87])]);

const ROOT_CLAIM_SIL = new URL('../../src/lib/RootClaim.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const { ps_tmpl_hash, token_tmpl_hash } = loadProtocolConstants();
const MARKET_ID = randomBytes(32).toString('hex');
const CLAIM_TMPL_HASH = 'aa'.repeat(32);
const ctor = [
  ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(MARKET_ID),
  ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(5000),
  ctorIntV100(1), ctorIntV100(0), ctorBytes32V100('bb'.repeat(32)), ctorIntV100(0),
  ctorBytes32V100(token_tmpl_hash), ctorBytes32V100(CLAIM_TMPL_HASH),
];
const compiled = compileSilV100(ROOT_CLAIM_SIL, ctor, 'RootClaim');
const script = Buffer.from(compiled.script);
const spk = p2sh(script);
console.log('utxo_script_hex(P2SH)', '0x' + spk.toString('hex'));

// hypothesis: default prev outpoint for input_idx=0 => txid = 32 bytes all 0x00, index=0
const zeroTxid = new kaspa.Hash('00'.repeat(32));
const outpoint = { transactionId: zeroTxid, index: 0 };
const scriptPublicKey = { version: 0, script: spk };
try {
  const covId = kaspa.covenantId(outpoint, [{ index: 0, output: { value: 10n, scriptPublicKey } }]);
  console.log('kaspa.covenantId(zero-txid,0 outpoint, out0) =', String(covId));
} catch (e) { console.log('attempt1 failed:', e.message || e); }
