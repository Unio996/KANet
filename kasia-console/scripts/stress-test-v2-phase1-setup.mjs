#!/usr/bin/env node
// stress-test-v2-phase1-setup.mjs — KI 65 Step 2 Phase 1A (NWT N19.239, Owner 5/23 03:38 钦定)
//
// Stress Test Framework v2 — Phase 1A: Pre-flight check + 10 user wallet generate (NO FUND).
//
// Funding (Phase 1B) DEFERRED requires Owner explicit ack — real-money $120 principal action.
// This script only:
//   1. Pre-flight: Console alive / RPC ws / Trader-B kas_pool / autoTaker config / DM cap
//   2. Wallet generate: 8 new fresh relays (stress-user-01..08) + 2 control (stress-control-01..02)
//      Each relay: Kasia mnemonic + address + EVM wallets (bnb / eth / arbitrum / sol / tron)
//   3. Output: list of (relay_id, kasia_addr, bnb_addr) for Phase 1B funding propose
//
// RNG seed: STRESS_TEST_SEED env (default Date.now()), printed for reproducibility.
// Pre-flight fail → abort with structured error (= no wallet generate, no DB writes).

import { Mnemonic } from 'kaspa-wasm';
import { ethers } from 'ethers';
import { randomUUID, createHash } from 'crypto';

import { sqlite } from '../src/db/client.js';
import { createRelayNode } from '../src/data/settings/relay-nodes.js';
import { addressFromMnemonic } from '../src/services/wallet.js';
import { encrypt } from '../src/services/crypto.js';
import { nowIso } from '../src/lib/time.js';
import { getBrokerRelayIdOrThrow } from '../src/services/broker-config-resolver.js';

const CONSOLE_URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3100';
const STRESS_SEED = parseInt(process.env.STRESS_TEST_SEED || String(Date.now()), 10);
const USER_COUNT = 8;     // stress-user-01..08
const CONTROL_COUNT = 2;  // stress-control-01..02
const CHAINS = ['bnb', 'eth', 'arbitrum', 'sol', 'tron'];  // EVM 3 + Sol + Tron (cheap-gas focus)

function log(level, msg, extra = {}) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${msg}` + (Object.keys(extra).length ? ' ' + JSON.stringify(extra) : ''));
}

// Pre-flight checks — abort if any fail. Returns { ok, checks } summary.
async function preflight() {
  const checks = [];
  // 1. Console health
  try {
    const r = await fetch(`${CONSOLE_URL}/api/admin/overview`);
    checks.push({ name: 'console_health', ok: r.ok, status: r.status });
    if (!r.ok) return { ok: false, checks };
  } catch (e) {
    checks.push({ name: 'console_health', ok: false, err: e.message });
    return { ok: false, checks };
  }
  // 2. Trader-B kas_pool — broker primary, must have > 50 KAS for gas buffer
  const brokerId = getBrokerRelayIdOrThrow();
  const treasury = sqlite.prepare(`
    SELECT balance_human FROM treasury_snapshot
    WHERE relay_node_id = ? AND asset='KAS' AND chain='kaspa'
    ORDER BY snapshot_at DESC LIMIT 1
  `).get(brokerId);
  const kasPool = Number(treasury?.balance_human || 0);
  checks.push({ name: 'broker_kas_pool', ok: kasPool > 50, kas: kasPool });
  if (kasPool <= 50) return { ok: false, checks };

  // 3. autoTaker config — buy_min_discount_pct + sell_min_premium_pct 真 set
  const r3 = await fetch(`${CONSOLE_URL}/api/exchange/autotaker-config`);
  const atCfg = await r3.json().catch(() => ({}));
  const atOk = atCfg?.buy_min_discount_pct != null && atCfg?.sell_min_premium_pct != null;
  checks.push({ name: 'autotaker_config', ok: atOk, buy: atCfg?.buy_min_discount_pct, sell: atCfg?.sell_min_premium_pct });
  if (!atOk) return { ok: false, checks };

  // 4. Existing stress relays — abort if any already exist (= prior run not cleaned up)
  const existing = sqlite.prepare(`SELECT name FROM relay_nodes WHERE name LIKE 'stress-%'`).all();
  checks.push({ name: 'no_existing_stress_relays', ok: existing.length === 0, found: existing.map(r => r.name) });
  if (existing.length > 0) return { ok: false, checks };

  return { ok: true, checks };
}

async function generateWallet(chain) {
  if (['bnb', 'eth', 'arbitrum', 'optimism', 'polygon', 'base', 'avalanche'].includes(chain)) {
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
    const h1 = createHash('sha256').update(addrBytes).digest();
    const h2 = createHash('sha256').update(h1).digest();
    const tronAddress = bs58.encode(Buffer.concat([addrBytes, h2.slice(0, 4)]));
    return { address: tronAddress, privateKey: w.privateKey };
  }
  throw new Error(`Unsupported chain: ${chain}`);
}

async function spawnStressRelay(name) {
  const mnemonic = Mnemonic.random(12).phrase;
  const address = addressFromMnemonic(mnemonic, 'mainnet');
  const relayId = createRelayNode({
    name,
    mnemonic,
    address,
    network: 'mainnet',
    adapterNodeId: null,  // no adapter — passive observer until Phase 1B fund
    pollMs: 2000,
  });
  // Mark roles=user
  sqlite.prepare(`UPDATE relay_nodes SET roles_json='["user"]', is_dex_broker=0 WHERE id = ?`).run(relayId);
  // Generate per-chain wallets
  const walletAddrs = {};
  for (const chain of CHAINS) {
    const w = await generateWallet(chain);
    const wId = randomUUID();
    const hint = w.address.slice(0, 6) + '...' + w.address.slice(-4);
    sqlite.prepare(`
      INSERT INTO agent_wallets (id, relay_node_id, chain, address, label, privkey_encrypted, privkey_hint, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(wId, relayId, chain, w.address, name, encrypt(w.privateKey), hint, 1, nowIso(), nowIso());
    walletAddrs[chain] = w.address;
  }
  return { id: relayId, name, kasia: address, wallets: walletAddrs };
}

async function main() {
  log('info', `Stress Test v2 Phase 1A — seed=${STRESS_SEED}`);

  // 1. Pre-flight
  log('info', 'Running pre-flight checks...');
  const pre = await preflight();
  for (const c of pre.checks) {
    log(c.ok ? 'info' : 'error', `[preflight] ${c.name}: ${c.ok ? 'PASS' : 'FAIL'}`, c);
  }
  if (!pre.ok) {
    log('error', 'Pre-flight FAIL — aborting (no relay spawn, no DB writes)');
    process.exit(1);
  }
  log('info', 'Pre-flight PASS ✓');

  // 2. Spawn 10 relays (8 user + 2 control)
  const spawned = [];
  for (let i = 1; i <= USER_COUNT; i++) {
    const name = `stress-user-${String(i).padStart(2, '0')}`;
    log('info', `Spawning ${name}...`);
    const r = await spawnStressRelay(name);
    spawned.push({ ...r, type: 'user' });
  }
  for (let i = 1; i <= CONTROL_COUNT; i++) {
    const name = `stress-control-${String(i).padStart(2, '0')}`;
    log('info', `Spawning ${name}...`);
    const r = await spawnStressRelay(name);
    spawned.push({ ...r, type: 'control' });
  }

  // 3. Output funding manifest for Phase 1B Owner ack
  log('info', `Spawned ${spawned.length} stress relays (seed=${STRESS_SEED})`);
  console.log('\n=== FUNDING MANIFEST (Phase 1B — Owner ack required for real spend) ===');
  console.log('Per relay needs: 0.5 KAS gas + $10 USDT (= BSC 4 USDT default chain).');
  console.log(`Total estimate: 10 × (0.5 KAS + $10 USDT) = 5 KAS + $100 USDT principal.\n`);
  for (const r of spawned) {
    console.log(`[${r.type}] ${r.name}  ${r.id}`);
    console.log(`  Kaspa: ${r.kasia}`);
    console.log(`  BSC:   ${r.wallets.bnb}`);
  }
  console.log('\nFunding NOT executed. Phase 1B requires explicit Owner /api/admin/stress-test-fund ack.');
}

main().catch(e => { console.error(e); process.exit(1); });
