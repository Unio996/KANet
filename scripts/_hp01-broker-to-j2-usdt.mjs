#!/usr/bin/env node
// DEPRECATED — operator emergency recovery, NOT regression test.
// HP-01 manual broker→J2 USDT 0.175546 transfer (auto-pay didn't fire in BUY-kaspa-shortcircuit path).
// Root cause Bug AM fixed in commit 07c636076 (BUY kaspa_tx short-circuit explicit await).
// Kept for historical reference (one-off NWT-J2 recovery 5/17). DO NOT integrate as test case.
// Audit: KI 63 整合 (NWT N19.161/162, J2 #636 5/21) — operator scripts not in test framework scope.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFromConsole = createRequire(path.resolve(__dirname, '../kasia-console/package.json'));
const Database = requireFromConsole('better-sqlite3');

import('../kasia-console/src/services/evm-transfer.js').then(async ({ transferUsdt }) => {
  const db = new Database('C:/kanet/kasia-console/data/console.db', { readonly: true });
  const BROKER_RELAY = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
  const J2_BSC = '0x00c41dC0D0d7F4232EFB6ec545F7ad9e031eb62f';

  const wallet = db.prepare("SELECT privkey_encrypted FROM agent_wallets WHERE relay_node_id = ? AND chain = 'bnb' AND is_default = 1").get(BROKER_RELAY);
  console.log('--- broker → J2 BSC 0.175546 USDT (HP-01 taker payment) ---');
  const r = await transferUsdt('bnb', wallet.privkey_encrypted, J2_BSC, 0.175546, 'USDT');
  console.log('result:', JSON.stringify(r));
}).catch(e => { console.error('err:', e.message); process.exit(1); });
