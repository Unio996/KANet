#!/usr/bin/env node
// DEPRECATED — operator emergency recovery, NOT regression test.
// HP-03 manual settle: broker → NWT 0.1754 USDT BSC + UPDATE escrow status (Bug AO/AP gap recovery).
// Root cause Bug AO/AP fixed in commits 3bb3f2cd5 + 6dd563565 (chain_events.observed_by NOT NULL + sweep race guard).
// Note: contains UPDATE user_escrow_balances SET status='settled' raw SQL — KI 63 lint rule allows in scripts/ (operator scope), not test-framework/.
// Kept for historical reference (one-off recovery 5/17). DO NOT integrate as test case.
// Audit: KI 63 整合 (NWT N19.161/162, J2 #636 5/21) — operator scripts not in test framework scope.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireConsole = createRequire(path.resolve(__dirname, '../kasia-console/package.json'));
const Database = requireConsole('better-sqlite3');

import('../kasia-console/src/services/evm-transfer.js').then(async ({ transferUsdt }) => {
  const db = new Database('C:/kanet/kasia-console/data/console.db');
  const BROKER = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
  const NWT_BSC = '0xd3618e37354700d21FE8728Bd278Dc1924974799';
  const w = db.prepare("SELECT privkey_encrypted FROM agent_wallets WHERE relay_node_id = ? AND chain = 'bnb' AND is_default = 1").get(BROKER);
  console.log('--- broker → NWT BSC 0.1754 USDT (HP-03 settle) ---');
  const r = await transferUsdt('bnb', w.privkey_encrypted, NWT_BSC, 0.1754, 'USDT');
  console.log('result:', JSON.stringify(r));
  if (r.ok) {
    const upd = db.prepare("UPDATE user_escrow_balances SET status = 'settled', settle_tx = ?, updated_at = datetime('now') WHERE id LIKE '613ff5df%' AND status = 'active'").run(r.txHash);
    console.log('escrow settled UPDATE:', upd.changes);
  }
}).catch(e => { console.error('err:', e.message); process.exit(1); });
