/**
 * External Handshake Test — simulates a brand-new user sending a handshake to an Agent.
 *
 * Steps:
 *   1. Generate a fresh Kaspa wallet (mnemonic + address)
 *   2. Martin transfers 1 KAS to the new wallet
 *   3. Wait for UTXO to appear
 *   4. New wallet sends a handshake to Sophie
 *   5. Verify: did Sophie's Relay send back a reply TX?
 *
 * Usage: node scripts/test-external-handshake.mjs
 */

import * as kaspa from '../kasia-relay/node_modules/kaspa-wasm/kaspa.js';

const { Mnemonic, XPrv, PrivateKey, RpcClient, Resolver, Encoding, Generator, Address, Fees } = kaspa;

const CONSOLE_URL = 'http://localhost:3100';
const SOMPI_PER_KAS = 100_000_000n;

// ── Sophie's address (target for handshake) ──
const SOPHIE_ADDRESS = 'kaspa:qpjjv2uhj22592mq76kqr3v6kjjyu23qugjmh2f7992nn0ykmje4cgx2ktetp';

// ── Helper: derive private key from mnemonic ──
function derivePrivateKey(phrase) {
  const mnemonic = new Mnemonic(phrase);
  const seed = mnemonic.toSeed();
  const xprv = new XPrv(seed);
  const derived = xprv
    .deriveChild(44, true)
    .deriveChild(111111, true)
    .deriveChild(0, true)
    .deriveChild(0, false)
    .deriveChild(0, false);
  return derived.toPrivateKey();
}

// ── Helper: connect to RPC ──
async function connectRpc() {
  // Try Console's configured RPC first
  let directUrl = null;
  try {
    const res = await fetch(`${CONSOLE_URL}/api/config/rpc-url`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const { url } = await res.json();
      if (url) directUrl = url;
    }
  } catch {}

  const opts = directUrl
    ? { url: directUrl, encoding: Encoding.Borsh, networkId: 'mainnet' }
    : { resolver: new Resolver(), encoding: Encoding.Borsh, networkId: 'mainnet' };
  const rpc = new RpcClient(opts);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('RPC timeout')), 30_000);
    rpc.connect({}).then(() => { clearTimeout(timer); resolve(); }, reject);
  });
  return rpc;
}

// ── Helper: wait for UTXOs ──
async function waitForUtxos(rpc, address, minSompi, maxWaitMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const { entries } = await rpc.getUtxosByAddresses([new Address(address)]);
    const total = (entries || []).reduce((s, e) => s + e.amount, 0n);
    if (total >= minSompi) return { entries, total };
    console.log(`  Waiting for UTXOs... (${((Date.now() - start) / 1000).toFixed(0)}s)`);
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error(`No UTXOs after ${maxWaitMs / 1000}s`);
}

// ── Helper: build handshake payload ──
async function buildHandshakePayload(senderPrivateKey, targetAddress) {
  // Import crypto and alias from relay libs
  const { encrypt } = await import('../kasia-relay/src/lib/crypto.mjs');
  const { deriveAliases } = await import('../kasia-relay/src/lib/alias.mjs');
  const { encodeHandshakePayload, payloadToTransactionHex } = await import('../kasia-relay/src/lib/protocol.mjs');

  const privateKeyHex = senderPrivateKey.toString();
  const { myAlias, theirAlias } = await deriveAliases(privateKeyHex, targetAddress);

  const handshake = {
    type: 'handshake',
    alias: myAlias,
    theirAlias,
    timestamp: Date.now(),
    version: 1,
    isResponse: false,
  };

  const encrypted = await encrypt(JSON.stringify(handshake), targetAddress);
  const payload = encodeHandshakePayload(encrypted.toString('hex'));
  return payloadToTransactionHex(payload);
}

// ── Main ──
async function main() {
  console.log('═══ External Handshake Test ═══\n');

  // Step 1: Generate new wallet
  console.log('Step 1: Generate fresh wallet');
  const mnemonic = Mnemonic.random();
  const phrase = mnemonic.phrase;
  const privateKey = derivePrivateKey(phrase);
  const keypair = privateKey.toKeypair();
  const address = keypair.toAddress(kaspa.NetworkType.Mainnet).toString();
  console.log(`  Mnemonic: ${phrase.split(' ').slice(0, 3).join(' ')}... (${phrase.split(' ').length} words)`);
  console.log(`  Address: ${address}`);

  // Step 2: Martin transfers 1 KAS
  console.log('\nStep 2: Martin transfers 1 KAS to new wallet');

  // Find Martin's relay node ID
  const profileRes = await fetch(`${CONSOLE_URL}/api/agent/profile`);
  const agents = await profileRes.json();
  const martin = agents.find(a => a.name === 'Martin');
  if (!martin) throw new Error('Martin not found in agent profile');
  console.log(`  Martin relay: ${martin.id.slice(0, 8)}...`);

  // Transfer via Console API
  const transferRes = await fetch(`${CONSOLE_URL}/api/relay/${martin.id}/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: address, amount: '1' }),
  });
  const transferData = await transferRes.json();
  if (!transferData.ok) throw new Error(`Transfer failed: ${JSON.stringify(transferData)}`);
  console.log(`  Transfer initiated (IPC, fire-and-forget)`);

  // Step 3: Wait for UTXOs
  console.log('\nStep 3: Wait for UTXOs on new wallet');
  const rpc = await connectRpc();
  const { total } = await waitForUtxos(rpc, address, 50_000_000n); // 0.5 KAS min
  console.log(`  Balance: ${Number(total) / 1e8} KAS`);

  // Step 4: Send handshake to Sophie
  console.log('\nStep 4: Send handshake to Sophie');
  console.log(`  Target: ${SOPHIE_ADDRESS.slice(0, 30)}...`);

  const payloadHex = await buildHandshakePayload(privateKey, SOPHIE_ADDRESS);
  console.log(`  Payload built (${payloadHex.length / 2} bytes)`);

  // Build and send TX
  const { entries } = await rpc.getUtxosByAddresses([new Address(address)]);
  const amountSompi = 20_000_000n; // 0.2 KAS (KASIA_MIN_AMOUNT)

  function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    return bytes;
  }

  console.log(`  UTXOs: ${entries.length}, total: ${entries.reduce((s,e)=>s+e.amount,0n)} sompi`);
  let generator;
  try {
    generator = new Generator({
      entries,
      outputs: [{ address: SOPHIE_ADDRESS, amount: amountSompi }],
      changeAddress: address,
      networkId: 'mainnet',
      payload: hexToBytes(payloadHex),
      priorityFee: 0n,
    });
  } catch (genErr) {
    console.error(`  Generator creation error: ${genErr?.message || genErr}`);
    throw genErr;
  }

  let pending, txId = '';
  try {
    while ((pending = await generator.next())) {
      await pending.sign([privateKey]);
      txId = await pending.submit(rpc);
    }
    console.log(`  Handshake TX: ${txId}`);
  } catch (sendErr) {
    console.error(`  TX send error: ${sendErr?.message || sendErr}`);
    console.error(`  Stack: ${sendErr?.stack?.split('\n').slice(0,3).join('\n')}`);
    throw sendErr;
  }

  // Step 5: Wait and verify
  console.log('\nStep 5: Verify Sophie processes the handshake');
  console.log('  Waiting 30s for Relay to detect and process...');
  await new Promise(r => setTimeout(r, 30_000));

  // Check relation_states
  const checkRes = await fetch(`${CONSOLE_URL}/api/relation/status?local=${encodeURIComponent(SOPHIE_ADDRESS)}&peer=${encodeURIComponent(address)}`);
  const status = await checkRes.json();
  console.log(`  relation_states status: ${status.status || 'NULL'}`);

  // Check chain_events for Sophie's reply
  // If Sophie replied, there should be a second TX from Sophie to our address
  const { entries: newUtxos } = await rpc.getUtxosByAddresses([new Address(address)]);
  const newBalance = newUtxos.reduce((s, e) => s + e.amount, 0n);
  const balanceChange = Number(newBalance - total) / 1e8;
  console.log(`  New wallet balance: ${Number(newBalance) / 1e8} KAS (change: ${balanceChange > 0 ? '+' : ''}${balanceChange.toFixed(4)})`);

  if (newBalance > total - amountSompi) {
    console.log('  ✓ Received incoming TX — Sophie likely replied!');
  } else {
    console.log('  ✗ No incoming TX — Sophie did NOT reply (BUG CONFIRMED)');
  }

  // Final status
  console.log('\n═══ Results ═══');
  console.log(`  New wallet: ${address}`);
  console.log(`  Handshake TX (us→Sophie): ${txId}`);
  console.log(`  relation_states: ${status.status || 'NULL'}`);
  console.log(`  Sophie reply: ${newBalance > total - amountSompi ? 'YES' : 'NO'}`);

  await rpc.disconnect();
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
