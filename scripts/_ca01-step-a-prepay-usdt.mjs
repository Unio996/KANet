#!/usr/bin/env node
// DEPRECATED 5/21 (Owner ack option 3, KI 63 整合 Group B):
// Operator one-off prepay TX for CA-01 step A. 同 _ca01-step-a-buy DEPRECATED.
// 真链等价 framework: test-framework/lib/real-chain-runner.mjs#transferEvmUsdt (复用).
// DO NOT execute.
//
// CA-01 Step A.2: J2 真 BSC USDT transfer 0.225010 → broker BSC 0xaD12544E
// Uses evm-transfer.transferUsdt with J2's encrypted BSC PK.

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFromConsole = createRequire(path.resolve(__dirname, '../kasia-console/package.json'));
const Database = requireFromConsole('better-sqlite3');

import('../kasia-console/src/services/evm-transfer.js').then(async ({ transferUsdt }) => {
  const db = new Database('C:/kanet/kasia-console/data/console.db', { readonly: true });
  const J2_RELAY = 'c9c37c37-9a8c-484c-9893-20185d97ccf9';

  const wallet = db.prepare("SELECT privkey_encrypted, address FROM agent_wallets WHERE relay_node_id = ? AND chain = 'bnb' AND is_default = 1").get(J2_RELAY);
  console.log('J2 BSC sender:', wallet?.address);
  console.log('--- 真 transfer 0.225010 USDT → 0xaD12544E7020e16D1279c65Cc5810c8D8a3efcEe ---');

  const r = await transferUsdt('bnb', wallet.privkey_encrypted, '0xaD12544E7020e16D1279c65Cc5810c8D8a3efcEe', 0.225012, 'USDT');
  console.log('result:', JSON.stringify(r));
}).catch(e => { console.error('err:', e.message); process.exit(1); });
