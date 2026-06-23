// bshard-e2e-run.mjs — KANet-UI :3200 operator config + runner for the bshard M3 e2e proof (2026-06-15).
//
// DIVISION (dev-coord-testnet): J2 = flow LOGIC (bshard-e2e-flow.mjs runHappyPath + builders + computeMarketGenesis).
// KANet-UI (:3200 operator) = OPERATOR specifics injected via `config`: sendCommand / checkLanded / computeP2SH /
// lockToP2SH / signCommittee + funding + relay-ids. J1 = relay handlers (unlockBshard*) + close sigOpCount=4 spec.
// NO TX NO STATE: every phase only advances after check_utxo_landed == true (driver sendAndLand enforces).
// MECHANISM FIRST LIVE RUN (Owner DoD: internal≠ready). Minimal = single shard, fold skip: genesis→register×N→
// close(committee 4-of-5)→claim serial→root_final==0. First-run bugs expected (forward/new_states/continuation).

import { runHappyPath } from './bshard-e2e-flow.mjs';
import { computeMarketGenesis } from '../src/lib/pool-bshard-market-setup.mjs';
import { serializePoolShardState } from '../src/lib/pool-shard-state-serialize.mjs';
import { blake2b } from '@noble/hashes/blake2b';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB = join(__dirname, '..', 'src', 'lib');
const CONSOLE_URL = process.env.BSHARD_E2E_CONSOLE_URL || 'http://127.0.0.1:3200';
// funding relay: tester-1 (eb5a5864) — clean low-fragmentation UTXO set. The NWT/treasury relay 4094a133 has 157k
// UTXOs (heavily fragmented) → tiny-change storage-mass failures on small (0.2 KAS ticket) transfers; tester-1 funds cleanly.
const TREASURY_RELAY = process.env.BSHARD_E2E_TREASURY_RELAY || 'eb5a5864-a8e0-4376-8f61-38108abb301f';
const NETWORK = process.env.BSHARD_E2E_NETWORK || 'testnet-12';
const SILVERC = process.env.SILVERC || 'D:/silverscript/target/release/silverc.exe';
const POOL_LEAF_SIL = process.env.BSHARD_E2E_LEAF_SIL ? join(LIB, process.env.BSHARD_E2E_LEAF_SIL) : join(LIB, 'PoolLeaf.sil');   // route-split: register+fold (4-field, 36B); probe-B overrides → PoolLeaf_nofold_probe.sil
const POOL_ROOT_SIL = join(LIB, 'PoolRoot.sil');   // route-split: close+claim+refund (7-field, 87B)
const POOL_SIDE_SIL = join(LIB, 'PoolSide_v08_shard.sil');
const ZERO32 = '00'.repeat(32);
const ROOT_STATE_LEN = 87; // PoolRoot 7-field state bytes (close continuation splice)
const b2 = (buf) => Buffer.from(blake2b(buf, { dkLen: 32 }));

async function relayCmd(relayId, cmd, timeoutMs = 60000) {
  const res = await fetch(`${CONSOLE_URL}/api/relay/${relayId}/send-command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd), signal: AbortSignal.timeout(timeoutMs),
  });
  const j = await res.json();
  if (!res.ok || j.ok === false) throw new Error(`relay ${cmd.type} -> ${JSON.stringify(j)}`);
  return j;
}

async function main() {
  const kaspa = await import('kaspa-wasm');
  const { Keypair, Transaction, Address, payToAddressScript, createInputSignature, SighashType, ScriptBuilder, addressFromScriptPublicKey } = kaspa;
  const log = (m) => console.log(`[bshard-e2e ${new Date().toISOString().slice(11, 19)}] ${m}`);

  const computeP2SH = (redeemHex) => {
    const builder = ScriptBuilder.fromScript(new Uint8Array(Buffer.from(redeemHex, 'hex')));
    const addr = addressFromScriptPublicKey(builder.createPayToScriptHashScript(), NETWORK);
    if (!addr) throw new Error('computeP2SH: addressFromScriptPublicKey undefined');
    return addr.toString();
  };
  const xonly = (kp) => { const x = kp.xOnlyPublicKey ?? kp.toXOnlyPublicKey?.(); return (typeof x === 'string' ? x : x.toString()); };

  // ── keypairs: 5 committee (ctor c0-c4Pk + sign) + 2 bettor (genesis + 1 register) ──
  const committee = Array.from({ length: 5 }, () => Keypair.random());
  const committeePks = committee.map(xonly);
  const bettorKps = [Keypair.random(), Keypair.random()];
  const bettorPks = bettorKps.map(xonly);
  const bettorAddrs = {}; bettorKps.forEach((kp, i) => { bettorAddrs[bettorPks[i]] = kp.toAddress(NETWORK).toString(); });
  log(`committee pks: ${committeePks.map(p => p.slice(0, 8)).join(',')}`);
  log(`bettor pks: ${bettorPks.map(p => p.slice(0, 8)).join(',')}  (b0=genesis, b1=register)`);

  // ── market genesis (J2 helper): shardCount=2 (=bettor count, single shard no fold), sealCount=2 ──
  const marketId = b2(Buffer.from(`mkt-${committeePks[0]}`)).toString('hex');
  const shardPoolId = b2(Buffer.from(`spool-${committeePks[1]}`)).toString('hex');
  const STAKE = 100_000_000n; // 1 KAS each
  const deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 3600; // +7d (seconds)
  const gen = computeMarketGenesis({
    poolLeafSilPath: POOL_LEAF_SIL, poolRootSilPath: POOL_ROOT_SIL, poolSideSilPath: POOL_SIDE_SIL, marketId, shardPoolId,
    committeePks, deadline, minBet: Number(STAKE), shardCount: 2, sealCount: 2, maxFanIn: 4,
    firstBet: { bettorPk: bettorPks[0], side: 0, stakeSompi: STAKE }, silvercPath: SILVERC,
  });
  gen.genesisState.shardPoolId = shardPoolId; // driver claim reads m.genesisState.shardPoolId (4-field serializer ignores extra)
  const genesisAddr = computeP2SH(gen.redeemHexForGenesisState);
  log(`genesis P2SH (scriptHash ${gen.scriptHashHex.slice(0, 12)}): ${genesisAddr}`);

  const txidToAddr = new Map();
  async function checkLanded(txId, addrHint) {
    const address = addrHint || txidToAddr.get(txId);
    if (!address) throw new Error(`checkLanded ${txId}: no address recorded`);
    const j = await relayCmd(TREASURY_RELAY, { type: 'check_utxo_landed', address, txid: txId }, 20000);
    return !!(j.landed || j.confirmed || j.found);
  }
  async function lockToP2SH(addr, sompi, fromRelayId) {
    const amountKas = Number(BigInt(sompi)) / 1e8; // transfer cmd takes amount in KAS (sendKaspa({to:target, amount}))
    const j = await relayCmd(fromRelayId || TREASURY_RELAY, { type: 'transfer', target: addr, amount: amountKas });
    const txId = j.txId || j.txid || j.transactionId;
    if (!txId) throw new Error(`lockToP2SH ${addr}: no txId ${JSON.stringify(j)}`);
    txidToAddr.set(txId, addr);
    for (let i = 0; i < 30; i++) { if (await checkLanded(txId, addr)) return { txId, outpointTxid: txId }; await new Promise(r => setTimeout(r, 2000)); }
    throw new Error(`lockToP2SH ${addr}: tx ${txId} did not land in 60s`);
  }
  async function sendCommand(relayId, cmd) {
    const j = await relayCmd(relayId, cmd);
    const txId = j.txId || j.txid || j.transactionId;
    if (!txId) throw new Error(`sendCommand ${cmd.type}: no txId ${JSON.stringify(j)}`);
    const addr = cmd?.outputs?.leaf_continuation?.address || cmd?.outputs?.root_continuation?.address || cmd?.outputs?.payout?.address;
    if (addr) txidToAddr.set(txId, addr);
    return { txId };
  }

  // ── signCommittee: build close TX (root sigOpCount=4, fee=1) + 5 committee Schnorr sigs (root input idx 0) ──
  async function signCommittee({ rootOutpointTxid, rootRedeemHex, closeState, rootValueSompi, feeOutpoint, changeAddress }) {
    const rootRedeem = Buffer.from(rootRedeemHex, 'hex');
    // PoolRoot close continuation: splice closeState (7-field 87B) into the redeem at the template state offset
    // (= rootArtifact prefix length, NOT a fixed offset — PoolRoot template prefix differs from the unified contract).
    const prefixLen = gen.rootArtifact.templatePrefix.length;
    const spliced = Buffer.concat([rootRedeem.slice(0, prefixLen), serializePoolShardState(closeState), rootRedeem.slice(prefixLen + ROOT_STATE_LEN)]);
    const contAddr = computeP2SH(spliced.toString('hex'));
    const rootSpk = payToAddressScript(new Address(computeP2SH(rootRedeemHex))); // root input is at the sealed PoolRoot P2SH
    const feeSpk = payToAddressScript(new Address(feeOutpoint.address));
    const inputs = [
      { previousOutpoint: { transactionId: rootOutpointTxid, index: 0 }, signatureScript: '', sequence: 0n, sigOpCount: 4, utxo: { amount: BigInt(rootValueSompi), scriptPublicKey: rootSpk, blockDaaScore: 0n } },
      { previousOutpoint: { transactionId: feeOutpoint.txid, index: feeOutpoint.index ?? 0 }, signatureScript: '', sequence: 0n, sigOpCount: 1, utxo: { amount: BigInt(feeOutpoint.amountSompi), scriptPublicKey: feeSpk, blockDaaScore: 0n } },
    ];
    const FEE = 10000n;
    const outputs = [
      { value: BigInt(rootValueSompi), scriptPublicKey: payToAddressScript(new Address(contAddr)) },
      { value: BigInt(feeOutpoint.amountSompi) - FEE, scriptPublicKey: payToAddressScript(new Address(changeAddress)) },
    ];
    const un = new Transaction({ version: 0, inputs, outputs, lockTime: 0n, gas: 0n, subnetworkId: '0'.repeat(40), payload: '' });
    const sigsHex = committee.slice(0, 4).map((kp) => createInputSignature(un, 0, kp.privateKey ?? kp.toPrivateKey?.(), SighashType.All));
    sigsHex.push(''); // 5th slot empty (4-of-5)
    const txObjPreimage = { version: 0, inputs: inputs.map(i => ({ previousOutpoint: i.previousOutpoint, signatureScript: '', sequence: '0', sigOpCount: i.sigOpCount, utxo: { amount: i.utxo.amount.toString(), scriptPublicKey: i.utxo.scriptPublicKey, blockDaaScore: '0' } })), outputs: outputs.map(o => ({ value: o.value.toString(), scriptPublicKey: o.scriptPublicKey })), lockTime: '0', gas: '0', subnetworkId: '0'.repeat(40), payload: '' };
    return { sigsHex, txObjPreimage };
  }

  // ── treasury funding: fee P2PK outpoint + register bettor[1] funding outpoint ──
  // FUNDING FIX (Bettor 2026-06-19, same lesson as ShardLeaf clean-LAND): funding/fee inputs are SIGNED BY THE RELAY's
  // key (p2sh.mjs createInputSignature wallet.getPrivateKey()), so the funding UTXOs MUST sit at the RELAY's own address —
  // NOT random feeKp/bettorKp addrs (relay can't sign those → invalid P2PK sig → false-stack on funding input, masking the
  // real seal SIZE probe). bettorPk stays the identity in the register witness/ticket; only the KAS source moves to relay addr.
  const changeAddr = (await relayCmd(TREASURY_RELAY, { type: 'get_pubkey' })).address;
  if (!changeAddr) throw new Error('could not get relay address for funding');
  const RELAY_ADDR = changeAddr; // tester-1 wallet addr (signs funding inputs)
  log(`funding fee outpoint (treasury → RELAY addr ${RELAY_ADDR.slice(0,24)}, so relay signs)...`);
  const feeLock = await lockToP2SH(RELAY_ADDR, 50_000_000n, TREASURY_RELAY); // 0.5 KAS fee budget
  const feeOutpoint = { txid: feeLock.txId, outpointTxid: feeLock.txId, index: 0, address: RELAY_ADDR, amountSompi: 50_000_000n };
  log(`fee outpoint: ${feeOutpoint.txid.slice(0, 12)} @ relay`);

  log('funding register bettor[1] (treasury → RELAY addr, so relay signs)...');
  const b1Lock = await lockToP2SH(RELAY_ADDR, STAKE + 60_000_000n, TREASURY_RELAY); // stake + 0.6 KAS (ticket 0.2 + fee + change margin; register Σin must exceed leaf_cont+ticket+fee)

  // ── config + run ──
  const config = {
    log, sendCommand, checkLanded, computeP2SH, lockToP2SH, signCommittee,
    feeOutpoint, changeAddress: changeAddr, winningSide: 0,
    market: { redeemHexForGenesisState: gen.redeemHexForGenesisState, genesisState: gen.genesisState, marketId, shardPoolId, shardCount: 2, sealCount: 2, committeePks, initPayoutRoot: ZERO32, psArtifact: gen.psArtifact, firstTicketState: gen.firstTicketState, rootArtifact: gen.rootArtifact, rootInitPayoutRoot: gen.rootInitPayoutRoot },
    ticketDustSompi: 20_000_000n, // 0.2 KAS — NOT true dust: Kaspa storage mass ∝ 1/output_value forbids <~0.1 KAS (1000 sompi → mass 1e9 > max). ticket is a real recoverable UTXO (spent at claim/refund).
    bettors: [
      { bettorPk: bettorPks[0], side: 0, stakeSompi: STAKE.toString(), changeAddress: changeAddr },
      { bettorPk: bettorPks[1], side: 0, stakeSompi: STAKE.toString(), fundingOutpoint: { txid: b1Lock.txId, address: RELAY_ADDR }, changeAddress: changeAddr },
    ],
    tickets: {}, bettorAddrs,
    relays: { bettorRelayId: TREASURY_RELAY, committeeRelayIds: [TREASURY_RELAY] },
  };

  log('=== RUN runHappyPath (genesis→register→close→claim) ===');
  const out = await runHappyPath(config);
  log(`=== DONE ===\n${JSON.stringify(out, null, 2)}`);
}

main().catch((e) => { console.error('[bshard-e2e] FAIL:', e.stack || e.message); process.exit(1); });
