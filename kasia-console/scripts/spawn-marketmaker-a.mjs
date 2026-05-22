#!/usr/bin/env node
// spawn-marketmaker-a.mjs — KI 65 Block A.5.1 (NWT N19.216 Owner钦定 mining pool 模型)
//
// Spawn MarketMaker-A relay on mainnet:
//   1. Generate 12-word mnemonic (kaspa-wasm) + derive Kaspa address
//   2. createRelayNode (reuse existing helper from data/settings/relay-nodes.js)
//   3. Mark roles_json=['marketmaker'], is_dex_broker=0
//   4. Generate 9-chain wallets (EVM 7 + Solana + Tron) into agent_wallets
//   5. Verify getMarketMakerRelayIdOrThrow() returns new id (not Trader-B fallback)
//
// Idempotent: aborts if MarketMaker-A already exists.
// KAS gas 10 transfer = manual follow-up (Owner钦定 source: NWT relay OR Trader-B pool).

import { Mnemonic } from 'kaspa-wasm';
import { ethers } from 'ethers';
import { randomUUID, createHash } from 'crypto';

import { sqlite } from '../src/db/client.js';
import { createRelayNode } from '../src/data/settings/relay-nodes.js';
import { addressFromMnemonic } from '../src/services/wallet.js';
import { encrypt } from '../src/services/crypto.js';
import { nowIso } from '../src/lib/time.js';
import { getMarketMakerRelayIdOrThrow } from '../src/services/broker-config-resolver.js';

const RELAY_NAME = 'MarketMaker-A';
const EVM_CHAINS = ['bnb', 'eth', 'arbitrum', 'optimism', 'polygon', 'base', 'avalanche'];
const ALL_CHAINS = [...EVM_CHAINS, 'sol', 'tron'];

async function generateWallet(chain) {
  if (EVM_CHAINS.includes(chain)) {
    const w = ethers.Wallet.createRandom();
    return { address: w.address, privateKey: w.privateKey };
  }
  if (chain === 'sol') {
    const { Keypair } = await import('@solana/web3.js');
    const kp = Keypair.generate();
    const bs58 = (await import('bs58')).default;
    return { address: kp.publicKey.toBase58(), privateKey: bs58.encode(kp.secretKey) };
  }
  if (chain === 'tron') {
    const w = ethers.Wallet.createRandom();
    const bs58 = (await import('bs58')).default;
    const addressHex = '41' + w.address.slice(2);
    const addrBytes = Buffer.from(addressHex, 'hex');
    const hash1 = createHash('sha256').update(addrBytes).digest();
    const hash2 = createHash('sha256').update(hash1).digest();
    const tronAddress = bs58.encode(Buffer.concat([addrBytes, hash2.slice(0, 4)]));
    return { address: tronAddress, privateKey: w.privateKey };
  }
  throw new Error(`Unsupported chain: ${chain}`);
}

async function main() {
  const existing = sqlite.prepare('SELECT id, name FROM relay_nodes WHERE name = ?').get(RELAY_NAME);
  if (existing) {
    console.log(`[spawn] MarketMaker-A already exists: ${existing.id} (idempotent abort)`);
    process.exit(0);
  }

  const mnemonic = Mnemonic.random(12).phrase;
  const address = addressFromMnemonic(mnemonic, 'mainnet');
  console.log(`[spawn] mnemonic generated (12 words), Kaspa address: ${address}`);

  const newId = createRelayNode({
    name: RELAY_NAME,
    mnemonic,
    address,
    network: 'mainnet',
    adapterNodeId: null,
    pollMs: 2000,
  });
  console.log(`[spawn] relay_nodes row created: ${newId}`);

  sqlite.prepare(`
    UPDATE relay_nodes SET roles_json = '["marketmaker"]', is_dex_broker = 0
    WHERE id = ?
  `).run(newId);
  console.log(`[spawn] roles_json=["marketmaker"], is_dex_broker=0`);

  for (const chain of ALL_CHAINS) {
    const wallet = await generateWallet(chain);
    const id = randomUUID();
    const now = nowIso();
    const hint = wallet.address.slice(0, 6) + '...' + wallet.address.slice(-4);
    sqlite.prepare(`
      INSERT INTO agent_wallets (id, relay_node_id, chain, address, label, privkey_encrypted, privkey_hint, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, newId, chain, wallet.address, 'MarketMaker-A',
           encrypt(wallet.privateKey), hint, 1, now, now);
    console.log(`[spawn] ${chain.padEnd(10)} ${wallet.address}`);
  }

  const resolvedId = getMarketMakerRelayIdOrThrow();
  if (resolvedId !== newId) {
    console.error(`[spawn] FAIL: getMarketMakerRelayIdOrThrow returned ${resolvedId}, expected ${newId}`);
    process.exit(1);
  }
  console.log(`[spawn] verified: getMarketMakerRelayIdOrThrow() = ${newId} (no broker fallback)`);

  console.log(`
=== MarketMaker-A spawned ===
id:             ${newId}
Kaspa address:  ${address}
9 chains:       ${ALL_CHAINS.join(', ')}
roles_json:     ["marketmaker"]
is_dex_broker:  0

NEXT — manual KAS gas transfer (Owner钦定 source):
  - Option A: NWT relay (5b236c08-03d0-456c-953d-e10001610938) → transfer 10 KAS to ${address}
  - Option B: Trader-B Kaspa pool (0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0) → transfer 10 KAS to ${address}
`);
}

main().catch(e => { console.error(e); process.exit(1); });
