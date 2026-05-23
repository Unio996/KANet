#!/usr/bin/env node
// Phase 3g Sub 9.11 — ops: ensureCtfApprovedForV2 for host's polymarket wallet.
// 5/15 flip 前必跑. Polymarket V2 cutover 2026-04-28 后 CTF setApprovalForAll
// 必 set 才能 SELL / CLOSE / REDUCE position (BUY 走 pUSD allowance 不 affected).
//
// 用法: node scripts/_ensure-v2-approve-host.mjs
// env: BETTOR_RELAY_NODE_ID (优先 kanet.env config) OR fallback a83c4b07 (Sophie)

import { createRequire } from 'node:module';
const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';
const kasiaRequire = createRequire(`${KANET_ROOT}/kasia-console/`);
const Database = kasiaRequire('better-sqlite3');

const DB_PATH = `${KANET_ROOT}/kasia-console/data/console.db`;
const RELAY_NODE_ID = process.env.BETTOR_RELAY_NODE_ID || 'a83c4b07-eaf7-4d21-972a-1265e0cdcfcf';

console.log(`[Sub 9.11] target relay_node_id=${RELAY_NODE_ID}`);

const db = new Database(DB_PATH, { readonly: true });
const wallet = db.prepare(`SELECT privkey_encrypted, address, label FROM agent_wallets WHERE relay_node_id = ? AND chain = 'polygon' AND is_default = 1`).get(RELAY_NODE_ID);
db.close();

if (!wallet) {
  console.error(`No polygon wallet found for relay_node_id=${RELAY_NODE_ID}`);
  process.exit(1);
}
console.log(`wallet address: ${wallet.address}`);
console.log(`wallet label: ${wallet.label}`);

// Decrypt privkey via Console internal crypto service (跟 polymarket.js 同款 path)
const { decrypt } = await import(`file:///${KANET_ROOT}/kasia-console/src/services/crypto.js`);
const privateKey = await decrypt(wallet.privkey_encrypted);

const { ensureCtfApprovedForV2 } = await import(`file:///${KANET_ROOT}/kasia-console/src/services/polymarket.js`);
console.log('\nrunning ensureCtfApprovedForV2 (V2 CTF setApprovalForAll for 3 spenders)...');
const result = await ensureCtfApprovedForV2(privateKey);
console.log('\nresult:', JSON.stringify(result, null, 2));

if (result.ok) {
  console.log(`\n✓ Phase 3g Sub 9.11 complete: ${result.newlyApproved} new approvals, ${Object.keys(result.skipped).length} skipped (already approved)`);
  console.log(`\nNext: SELL / CLOSE / REDUCE paths unblocked. Owner explicit flip enabled=1 fully ready.`);
} else {
  console.error('\n✗ ensureCtfApprovedForV2 failed:', result.error);
  process.exit(1);
}
