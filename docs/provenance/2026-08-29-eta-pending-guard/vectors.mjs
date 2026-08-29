// V1–V7 for §B2-6: extract isPendingPaymentMarker / getPaymentTx / getExplorerUrl verbatim from the branch eta and run as an object.
import { readFileSync } from 'node:fs';
import assert from 'node:assert';
const ETA = process.argv[2];
const src = readFileSync(ETA, 'utf8');
const a = src.indexOf('    isPendingPaymentMarker(v)'), b = src.indexOf('    getTimeline(o) {');
assert.ok(a > 0 && b > a, 'anchors');
const body = src.slice(a, b).replace(/^\s*\/\/.*$/mg, '');
const obj = new Function('return ({' + body + '})')();
const KANet = { explorerTxUrl(chain, txHash) { if (!txHash) return null; if (chain === 'kaspa') return `/api/chain/tx/${txHash}`; const map = { bnb: `https://bscscan.com/tx/${txHash}`, eth: `https://etherscan.io/tx/${txHash}`, sol: `https://solscan.io/tx/${txHash}`, tron: `https://tronscan.org/#/transaction/${txHash}` }; return map[chain] || null; } };  // verbatim public/kanet-ui.js:154-164
const row533 = (o) => !!obj.getPaymentTx(o || {});                        // x-show at :533
const rowPending = (o) => obj.isPendingPaymentMarker(o?.payment_tx);       // x-show of new row
const href = (o) => KANet.explorerTxUrl(o?.taker_chain || 'kaspa', obj.getPaymentTx(o || {}));
let pass = 0, fail = 0; const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const M = 'PENDING:ab12cd34:9f8e7d6c', TX = '0x' + 'a1'.repeat(32);
t('V1 marker in column: getPaymentTx null / :533 hidden / pending row shown / getExplorerUrl # / href null (no link) / copy payload null', () => {
  const o = { payment_tx: M, taker_chain: 'bnb' };
  assert.strictEqual(obj.getPaymentTx(o), null); assert.strictEqual(row533(o), false); assert.strictEqual(rowPending(o), true);
  assert.strictEqual(obj.getExplorerUrl(o), '#'); assert.strictEqual(href(o), null); assert.strictEqual(obj.getPaymentTx(o), null);
});
t('V2 real evm txid: byte-identical to pre-change (link bscscan, copy = tx, pending row hidden)', () => {
  const o = { payment_tx: TX, taker_chain: 'bnb' };
  assert.strictEqual(obj.getPaymentTx(o), TX); assert.strictEqual(row533(o), true); assert.strictEqual(rowPending(o), false);
  assert.strictEqual(href(o), 'https://bscscan.com/tx/' + TX); assert.strictEqual(obj.getExplorerUrl(o), 'https://bscscan.com/tx/' + TX);
});
t('V3 column null, meta real tx: unchanged (meta path)', () => {
  const o = { payment_tx: null, verification_meta: JSON.stringify({ payment_tx: TX }), taker_chain: 'eth' };
  assert.strictEqual(obj.getPaymentTx(o), TX); assert.strictEqual(row533(o), true); assert.strictEqual(rowPending(o), false); assert.strictEqual(obj.getExplorerUrl(o), 'https://etherscan.io/tx/' + TX);
});
t('V4 column null, meta holds marker (defensive): getPaymentTx null, both rows hidden', () => {
  const o = { payment_tx: null, verification_meta: JSON.stringify({ payment_tx: M }) };
  assert.strictEqual(obj.getPaymentTx(o), null); assert.strictEqual(row533(o), false); assert.strictEqual(rowPending(o), false); assert.strictEqual(obj.getExplorerUrl(o), '#');
});
t('V5 exact prefix only: lowercase / no colon / leading space are NOT markers (treated as txid, as before)', () => {
  for (const v of ['pending:x', 'PENDING', ' PENDING:x', 'XPENDING:1']) { const o = { payment_tx: v }; assert.strictEqual(obj.isPendingPaymentMarker(v), false, v); assert.strictEqual(obj.getPaymentTx(o), v, v); assert.strictEqual(rowPending(o), false, v); }
  assert.strictEqual(obj.isPendingPaymentMarker(12345), false); assert.strictEqual(obj.isPendingPaymentMarker(null), false); assert.strictEqual(obj.isPendingPaymentMarker(undefined), false);
});
t('V6 finalize replaced marker by txid ⇒ same as V2', () => {
  const o = { payment_tx: M, taker_chain: 'sol' }; assert.strictEqual(rowPending(o), true);
  const o2 = { ...o, payment_tx: TX }; assert.strictEqual(rowPending(o2), false); assert.strictEqual(row533(o2), true); assert.strictEqual(href(o2), 'https://solscan.io/tx/' + TX);
});
t('V7 undefined / {} / bad meta JSON: null, both hidden, no throw', () => {
  for (const o of [undefined, null, {}, { verification_meta: '{bad' }]) { assert.strictEqual(obj.getPaymentTx(o || {}), null); assert.strictEqual(row533(o), false); assert.strictEqual(rowPending(o), false); }
  assert.strictEqual(obj.getPaymentTx(null), null);
});
t('V8 :1394 meta path untouched: source still reads m.payment_tx directly (not via getPaymentTx)', () => {
  const l = src.split('\n').find((x) => x.includes("verifyDetail = 'TX: ' + m.payment_tx")); assert.ok(l, ':1394 line present and unchanged');
});
console.log(`${pass} PASS / ${fail} FAIL`); process.exit(fail ? 1 : 0);
