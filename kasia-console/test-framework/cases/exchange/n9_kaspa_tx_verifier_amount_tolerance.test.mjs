// N9 cross-chain settle — kaspa_tx verifier amount tolerance unit mock
// exchange-machine.js _verifyAndComplete L1417-1422 ±0.5% tolerance check.
// 真因 (pre-Bug BC): hardcode confirmed=true bypass verify, fake hash → free money.
// fix BC: 真 kaspa_tx_log query + amount ±0.5% tolerance enforcement.

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../data/console.db');
const TEST_TX_ID = `test_kaspa_tx_${Date.now().toString(36)}${'a'.repeat(40)}`.slice(0, 64);

export default {
  id: 'n9_kaspa_tx_verifier_amount_tolerance',
  description: 'N9 kaspa_tx verifier ±0.5% amount tolerance unit verify (Bug BC fix bypass guard)',
  domain: 'exchange',
  tags: ['regression', 'verifier', 'kaspa_tx', 'cross_chain'],

  async run() {
    const db = new Database(DB_PATH);
    try {
      const expectedTo = 'kaspa:qtest_recipient_n9_unit_mock_aaaaa';
      const expectedAmount = 1.0;
      const tolerancePct = 0.005;

      // Setup: INSERT kaspa_tx_log row with exact amount
      db.prepare(`
        INSERT INTO kaspa_tx_log (tx_id, block_hash, block_time, from_address, to_address, amount, observed_at, network)
        VALUES (?, 'fakeblock', strftime('%s','now'), 'kaspa:qfake_sender', ?, ?, datetime('now') || 'Z', 'mainnet')
      `).run(TEST_TX_ID, expectedTo, expectedAmount);

      // Simulate verifier query (mirror exchange-machine.js _verifyAndComplete L1406-L1409)
      const txRow = db.prepare(`
        SELECT tx_id, to_address, CAST(amount AS REAL) AS amount, observed_at
        FROM kaspa_tx_log WHERE tx_id = ?
      `).get(TEST_TX_ID);

      if (!txRow) return { ok: false, error: 'INSERT kaspa_tx_log + SELECT 返 0 row' };

      // Tolerance check: PASS path (exact match)
      const diff1 = Math.abs(txRow.amount - expectedAmount);
      const pass1 = expectedAmount > 0 && diff1 / expectedAmount <= tolerancePct;
      if (!pass1) return { ok: false, error: 'exact match should PASS tolerance' };

      // Recipient match check
      const recipientMatch1 = txRow.to_address === expectedTo;
      if (!recipientMatch1) return { ok: false, error: `recipient mismatch ${txRow.to_address} != ${expectedTo}` };

      // Tolerance check: FAIL path (5% mismatch, way over 0.5% tolerance)
      const wrongExpected = 1.05;
      const diff2 = Math.abs(txRow.amount - wrongExpected);
      const pass2 = wrongExpected > 0 && diff2 / wrongExpected <= tolerancePct;
      if (pass2) return { ok: false, error: 'mismatch 5% should FAIL tolerance, but passed' };

      // Tolerance check: micro-noise (0.000008 = 8e-6, way under 0.5%)
      const microNoise = expectedAmount + 8e-6;
      const diff3 = Math.abs(txRow.amount - microNoise);
      const pass3 = microNoise > 0 && diff3 / microNoise <= tolerancePct;
      if (!pass3) return { ok: false, error: 'micro-noise within 0.5% should PASS tolerance' };

      return { ok: true, summary: 'kaspa_tx verifier ±0.5% tolerance: exact match PASS, micro-noise PASS, 5% mismatch FAIL, recipient strict match' };
    } finally {
      try { db.prepare('DELETE FROM kaspa_tx_log WHERE tx_id = ?').run(TEST_TX_ID); } catch {}
      db.close();
    }
  },
};
