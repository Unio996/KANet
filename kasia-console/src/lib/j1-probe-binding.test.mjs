// j1-probe-binding 用例 — Codex aaddc1c6/(441) gate#1 点名的负测在 N-1。
// 跑法: node src/lib/j1-probe-binding.test.mjs (kasia-console 下)
import assert from 'node:assert/strict';
import { decideProbeBinding } from './j1-probe-binding.mjs';

const TX_A = 'a'.repeat(64);
const TX_B = 'b'.repeat(64);
const MSG = '[J1tn trough probe 123456-ab · 计划授权样本] 随机尾: deadbeef';
const ME = 'kaspatest:qzdh7nar8wnq4nsag835qv563zkc5q8pufjeq3fcc2nq337mrr04wcfjx6f6u';
const row = (over = {}) => ({ content: MSG, sender_address: ME, tx_hash: TX_A, status: 'pending', ...over });
const CREDIT = new Set(['first-seen', 'confirmed']);
let n = 0, fail = 0;
const t = (name, fn) => { n++; try { fn(); console.log(`  ✅ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); } };

// ── N-1 🔴 Codex 点名负测: 合法 64-hex 但【错误】txid 的行, 绝不能得 firstSeen/confirmed ──
t('N-1 错 txid(合法 64-hex)⇒ contradiction, 零 credit', () => {
  const v = decideProbeBinding({ submitTxid: TX_A, row: row({ tx_hash: TX_B, status: 'confirmed' }), exactMsg: MSG, expectedSender: ME });
  assert.equal(v.verdict, 'contradiction');
  assert.ok(!CREDIT.has(v.verdict));
});
t('N-2 正确 txid + pending ⇒ first-seen', () => {
  const v = decideProbeBinding({ submitTxid: TX_A, row: row(), exactMsg: MSG, expectedSender: ME });
  assert.equal(v.verdict, 'first-seen'); assert.equal(v.txHash, TX_A);
});
t('N-3 正确 txid + confirmed ⇒ confirmed', () => {
  const v = decideProbeBinding({ submitTxid: TX_A, row: row({ status: 'confirmed' }), exactMsg: MSG, expectedSender: ME });
  assert.equal(v.verdict, 'confirmed');
});
t('N-4 content 不逐字相等(引用/转发攻击形状)⇒ not-bound, 零 credit', () => {
  const v = decideProbeBinding({ submitTxid: TX_A, row: row({ content: '转发: ' + MSG }), exactMsg: MSG, expectedSender: ME });
  assert.equal(v.verdict, 'not-bound'); assert.equal(v.detail, 'content-mismatch'); assert.ok(!CREDIT.has(v.verdict));
});
t('N-5 sender 不符(他人复读同文)⇒ not-bound, 零 credit', () => {
  const v = decideProbeBinding({ submitTxid: TX_A, row: row({ sender_address: 'kaspatest:qother' }), exactMsg: MSG, expectedSender: ME });
  assert.equal(v.verdict, 'not-bound'); assert.equal(v.detail, 'sender-mismatch');
});
t('N-6 行无合法 tx_hash(空/短/非hex)⇒ no-valid-txhash, 零 credit', () => {
  for (const h of ['', 'abc', TX_A.slice(0, 63), 'Z'.repeat(64)]) {
    const v = decideProbeBinding({ submitTxid: TX_A, row: row({ tx_hash: h, status: 'confirmed' }), exactMsg: MSG, expectedSender: ME });
    assert.equal(v.verdict, 'no-valid-txhash'); assert.ok(!CREDIT.has(v.verdict));
  }
});
t('N-7 无行 ⇒ no-row', () => {
  assert.equal(decideProbeBinding({ submitTxid: TX_A, row: null, exactMsg: MSG, expectedSender: ME }).verdict, 'no-row');
});
t('N-8 submitTxid 自身非法(前缀/空)⇒ invalid-submit-txid(仪器合同违约层)', () => {
  for (const s of ['', TX_A.slice(0, 8), null]) {
    assert.equal(decideProbeBinding({ submitTxid: s, row: row(), exactMsg: MSG, expectedSender: ME }).verdict, 'invalid-submit-txid');
  }
});
t('N-9 词表封闭: 全部非 credit 判定与两个 credit 判定互斥', () => {
  const cases = [
    decideProbeBinding({ submitTxid: TX_A, row: row({ tx_hash: TX_B }), exactMsg: MSG, expectedSender: ME }),
    decideProbeBinding({ submitTxid: TX_A, row: row({ content: 'x' }), exactMsg: MSG, expectedSender: ME }),
    decideProbeBinding({ submitTxid: TX_A, row: row({ tx_hash: '' }), exactMsg: MSG, expectedSender: ME }),
  ];
  for (const v of cases) assert.ok(!CREDIT.has(v.verdict), `不该得 credit: ${v.verdict}`);
});

console.log(`j1-probe-binding: ${n - fail} PASS / ${fail} FAIL`);
if (fail) process.exit(1);
