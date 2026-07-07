// P2SH contract utilities — compile, lock, unlock Silverscript contracts on Kaspa
//
// Usage:
//   import { compileEscrow, lockToP2SH, unlockP2SH } from './lib/p2sh.mjs';
//
//   const { redeemScript, p2shAddress } = compileEscrow(buyerPk32, sellerPk32, arbiterPk32, deadline);
//   const lockTxId = await lockToP2SH(wallet, p2shAddress, '5');
//   const unlockTxId = await unlockP2SH(wallet, p2shAddress, redeemScript, 0, toAddress);

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as kaspa from 'kaspa-wasm';

const {
  RpcClient, Encoding, Address,
  Transaction, TransactionOutput,
  ScriptBuilder, PaymentOutput, Generator,
  payToScriptHashScript, addressFromScriptPublicKey, payToAddressScript,
  createInputSignature, SighashType, kaspaToSompi,
  CovenantBinding, GenesisCovenantGroup, Hash,   // bshard (A) cov_id: genesis-mint + continuation CovenantBinding (covenant-enabled wasm bdbfa67b)
} = kaspa;

const Resolver = kaspa.Resolver || null;

const SILVERC = process.env.SILVERSCRIPT_COMPILER || 'D:/silverscript/target/release/silverc.exe';
const TMP_DIR = process.env.KANET_ROOT ? join(process.env.KANET_ROOT, 'tmp') : 'D:/kanet-tn12/tmp';

// ── OP_PUSHDATA encoder (Bettor r113 KI sweep + NWT iter sediment) ──
//
// kaspa-wasm 1.0.1 ScriptBuilder.addData() enforces pre-Toccata 520-byte cap (= default covenants_enabled=false).
// Post-Toccata kaspad v1.2.0 TN12 always-toccata accepts up to 1M element. Bypass via manual hex emit.
// 5 call sites: unlockP2SH / unlockP2SHMultiSig / unlockP2SHConsensual / pool spine settle / pool refund.
// Use this helper instead of ScriptBuilder.addData() for any data push > 75 bytes.
// Bettor r263 G6 批1.5 sweep: balance + dust invariant for ALL manual P2SH spend paths.
// Centralized so all 7 submit sites get the same defense. Called before rpc.submitTransaction.
// Bettor r239 G6 批2 红线 7 (qlfpv 实测 brick sediment): 加 mass-aware fee floor check.
// qlfpv 第三面 root cause: SS 焊死 fee = makerStake-ctor_minerFee_50_000, 但实际 mass=4420
// → mempool floor 442_000 sompi → mempool reject 'transaction is not standard'. Pre-submit
// 拦下来比等 mempool reject 干净 — 立刻报 mass mismatch 不浪费 RPC roundtrip + log noise.
const MIN_SOMPI_PER_MASS = 100n;  // Kaspa post-Toccata transient mass mempool floor 实测 qlfpv 442000/4420
function _assertTxInvariants(matchedUtxos, signedTx, siteLabel = 'unknown', networkId = null) {
  try {
    const sumIn = matchedUtxos.reduce((acc, u) => acc + BigInt(u.amount), 0n);
    const sumOut = signedTx.outputs.reduce((acc, o) => acc + BigInt(typeof o.value === 'bigint' ? o.value : (o.value || 0)), 0n);
    const fee = sumIn - sumOut;
    if (fee < 0n) throw new Error(`Σin=${sumIn} < Σout=${sumOut} (overspend ${-fee})`);
    if (fee === 0n) throw new Error(`Σin==Σout (0 miner fee)`);
    const MIN_OUTPUT_DUST_SOMPI = 1000n;  // J1 r245 conservative
    for (let i = 0; i < signedTx.outputs.length; i++) {
      const v = BigInt(typeof signedTx.outputs[i].value === 'bigint' ? signedTx.outputs[i].value : (signedTx.outputs[i].value || 0));
      if (v < MIN_OUTPUT_DUST_SOMPI) throw new Error(`output[${i}] value=${v} < dust ${MIN_OUTPUT_DUST_SOMPI}`);
    }
    // 红线 7: mass-aware fee floor (skip if networkId not passed, = legacy callers protect).
    if (networkId && typeof kaspa.calculateTransactionMass === 'function') {
      let mass;
      try { mass = kaspa.calculateTransactionMass(networkId, signedTx); } catch (massErr) {
        // mass calc 不可用 → log warn 不 fail (= 让 mempool 拦截作 fallback).
        console.warn(`[${siteLabel} invariant] mass calc skipped: ${massErr.message}`);
        console.log(`[${siteLabel} invariant] Σin=${sumIn} Σout=${sumOut} fee=${fee}, ${signedTx.outputs.length} outputs all >= dust (mass-check skipped)`);
        return;
      }
      const minFee = BigInt(mass) * MIN_SOMPI_PER_MASS;
      if (fee < minFee) {
        throw new Error(`fee ${fee} < mempool floor ${minFee} (mass=${mass} × ${MIN_SOMPI_PER_MASS} sompi/mass) — SS contract fee 焊死太低或 scriptSig 太大`);
      }
      console.log(`[${siteLabel} invariant] Σin=${sumIn} Σout=${sumOut} fee=${fee} (mass=${mass} minFee=${minFee} ✓), ${signedTx.outputs.length} outputs all >= dust`);
      return;
    }
    console.log(`[${siteLabel} invariant] Σin=${sumIn} Σout=${sumOut} fee=${fee}, ${signedTx.outputs.length} outputs all >= dust`);
  } catch (e) {
    throw new Error(`pre-submit invariant assert (${siteLabel}): ${e.message}`);
  }
}

function _encodePushDataHex(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const len = buf.length;
  if (len <= 75) {
    return len.toString(16).padStart(2, '0') + buf.toString('hex');
  } else if (len <= 255) {
    return '4c' + len.toString(16).padStart(2, '0') + buf.toString('hex');
  } else if (len <= 65535) {
    const lo = (len & 0xff).toString(16).padStart(2, '0');
    const hi = ((len >> 8) & 0xff).toString(16).padStart(2, '0');
    return '4d' + lo + hi + buf.toString('hex');
  } else {
    throw new Error(`push data too large: ${len} bytes (= max OP_PUSHDATA4 65535)`);
  }
}

// ── RPC connection (reuse pattern from transaction.mjs) ──

async function connectRpc(networkId) {
  const url = process.env.KASPA_RPC_URL;
  if (!url) throw new Error('KASPA_RPC_URL not set');
  const rpc = new RpcClient({ url, encoding: Encoding.Borsh, networkId });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('RPC timeout')), 30_000);
    rpc.connect({}).then(() => { clearTimeout(timer); resolve(); }, e => { clearTimeout(timer); reject(e); });
  });
  return rpc;
}

// ── 1. compileEscrow ──

/**
 * Compile an AgentEscrow contract with given public keys and deadline.
 *
 * @param {string} buyerPk32  - 32-byte x-only public key (hex, no 0x prefix)
 * @param {string} sellerPk32 - 32-byte x-only public key (hex)
 * @param {string} arbiterPk32 - 32-byte x-only public key (hex)
 * @param {number} deadline   - DAA score deadline for refund path
 * @param {string} networkId  - e.g. 'testnet-12'
 * @returns {{ redeemScript: Uint8Array, p2shAddress: string, scriptHex: string }}
 */
export function compileEscrow(buyerPk32, sellerPk32, arbiterPk32, deadline, networkId = 'testnet-12') {
  // Validate inputs
  for (const [name, pk] of [['buyer', buyerPk32], ['seller', sellerPk32], ['arbiter', arbiterPk32]]) {
    if (!pk || pk.length !== 64) throw new Error(`${name} public key must be 64 hex chars (32 bytes x-only), got ${pk?.length}`);
  }

  // Write contract source
  mkdirSync(TMP_DIR, { recursive: true });
  const silPath = join(TMP_DIR, 'escrow.sil');
  const argsPath = join(TMP_DIR, 'escrow-args.json');
  const outPath = join(TMP_DIR, 'escrow.json');

  writeFileSync(silPath, `pragma silverscript ^0.1.0;
contract AgentEscrow(byte[32] buyerPk, byte[32] sellerPk, byte[32] arbiterPk, int deadline) {
    entrypoint function release(sig buyerSig) {
        require(checkSig(buyerSig, pubkey(buyerPk)));
    }
    entrypoint function refund(sig buyerSig) {
        require(checkSig(buyerSig, pubkey(buyerPk)));
        require(tx.time >= deadline);
    }
    entrypoint function arbitrate(sig arbiterSig) {
        require(checkSig(arbiterSig, pubkey(arbiterPk)));
        byte[34] buyerLock = new ScriptPubKeyP2PK(pubkey(buyerPk));
        byte[34] sellerLock = new ScriptPubKeyP2PK(pubkey(sellerPk));
        require(tx.outputs[0].scriptPubKey == byte[](buyerLock) || tx.outputs[0].scriptPubKey == byte[](sellerLock));
    }
}
`);

  // Build constructor args JSON
  function hexToByteArray(hex) {
    const arr = [];
    for (let i = 0; i < hex.length; i += 2) arr.push({ kind: 'byte', data: parseInt(hex.substr(i, 2), 16) });
    return { kind: 'array', data: arr };
  }

  const args = [
    hexToByteArray(buyerPk32),
    hexToByteArray(sellerPk32),
    hexToByteArray(arbiterPk32),
    { kind: 'int', data: deadline },
  ];
  writeFileSync(argsPath, JSON.stringify(args));

  // Compile
  execSync(`"${SILVERC}" "${silPath}" --constructor-args "${argsPath}" -o "${outPath}"`, { stdio: 'pipe' });

  const compiled = JSON.parse(readFileSync(outPath, 'utf8'));
  const redeemScript = new Uint8Array(compiled.script);

  // Generate P2SH address
  const spk = payToScriptHashScript(redeemScript);
  const p2shAddress = addressFromScriptPublicKey(spk, networkId).toString();

  return {
    redeemScript,
    p2shAddress,
    scriptHex: Buffer.from(redeemScript).toString('hex'),
    abi: compiled.abi,
  };
}

// ── 2. lockToP2SH ──

/**
 * Lock funds into a P2SH address (standard transfer).
 *
 * @param {import('./wallet.mjs').KaspaWallet} wallet
 * @param {string} p2shAddress - P2SH address to lock funds into
 * @param {string} amountKas   - Amount in KAS (e.g. '5')
 * @returns {Promise<string>} txId
 */
export async function lockToP2SH(wallet, p2shAddress, amountKas) {
  const rpc = await connectRpc(wallet.getNetworkId());
  try {
    const senderAddress = wallet.getAddress();
    const { entries } = await rpc.getUtxosByAddresses([new Address(senderAddress)]);
    if (!entries?.length) throw new Error('No UTXOs available');

    const generator = new Generator({
      entries: entries.slice(0, 50),
      outputs: [new PaymentOutput(new Address(p2shAddress), kaspaToSompi(amountKas))],
      priorityFee: 0n,
      changeAddress: new Address(senderAddress),
      networkId: wallet.getGeneratorNetworkId(),
    });

    let txId = '';
    let pending;
    while ((pending = await generator.next())) {
      await pending.sign([wallet.getPrivateKey()]);
      txId = await pending.submit(rpc);
    }
    if (!txId) throw new Error('No transaction produced');
    return txId;
  } finally {
    try { await rpc.disconnect(); } catch {}
  }
}

// ── 3. unlockP2SH ──

/**
 * Unlock funds from a P2SH contract.
 *
 * @param {import('./wallet.mjs').KaspaWallet} wallet - Signer wallet (must hold the key matching the contract branch)
 * @param {string} p2shAddress   - The P2SH address holding the locked funds
 * @param {Uint8Array} redeemScript - The compiled contract bytecode
 * @param {number} branch        - Branch selector: 0=release, 1=refund, 2=arbitrate
 * @param {string} toAddress     - Destination address for the released funds
 * @returns {Promise<{ txId: string, amount: bigint }>}
 */
export async function unlockP2SH(wallet, p2shAddress, redeemScript, branch, toAddress, lockTime = 0n) {
  if (branch < 0 || branch > 2) throw new Error(`Invalid branch ${branch}. Must be 0 (release), 1 (refund), or 2 (arbitrate)`);

  const txLockTime = BigInt(lockTime);
  const rpc = await connectRpc(wallet.getNetworkId());
  try {
    // Find P2SH UTXOs
    const { entries } = await rpc.getUtxosByAddresses([p2shAddress]);
    if (!entries?.length) throw new Error(`No UTXOs at P2SH address ${p2shAddress}`);

    const utxo = entries[0];
    const lockedAmount = utxo.entry.amount;
    const fee = kaspaToSompi('0.001');
    const outValue = lockedAmount - fee;
    if (outValue <= 0n) throw new Error('Locked amount too small to cover fee');

    const toSpk = payToAddressScript(new Address(toAddress));

    // Build unsigned TX (input must carry utxo for sighash calculation)
    // lockTime must match in both unsigned and signed TX — sighash includes lockTime
    const unsignedTx = new Transaction({
      version: 0,
      inputs: [{
        previousOutpoint: { transactionId: utxo.outpoint.transactionId, index: utxo.outpoint.index },
        signatureScript: '',
        sequence: 0n,
        sigOpCount: 1,
        utxo,
      }],
      outputs: [new TransactionOutput(outValue, toSpk)],
      lockTime: txLockTime,
      gas: 0n,
      subnetworkId: '0000000000000000000000000000000000000000',
      payload: '',
    });

    // Sign — returns 66-byte hex [0x41][64sig][0x01], already push-encoded
    const sigHex = createInputSignature(unsignedTx, 0, wallet.getPrivateKey(), SighashType.All);

    // Build scriptSig: [sigPush] [OP_N branch] [redeemScriptPush]
    // encodePayToScriptHashSignatureScript returns [sigBytes][redeemScriptPush]
    const sb = ScriptBuilder.fromScript(redeemScript);
    const basicHex = sb.encodePayToScriptHashSignatureScript(sigHex);

    // Insert branch selector (OP_0..OP_2) after sig, before redeemScript
    const branchOpcode = branch === 0 ? '00' : branch === 1 ? '51' : '52'; // OP_0, OP_1, OP_2
    const scriptSigHex = basicHex.slice(0, sigHex.length) + branchOpcode + basicHex.slice(sigHex.length);

    // Rebuild TX with signed scriptSig
    const signedTx = new Transaction({
      version: 0,
      inputs: [{
        previousOutpoint: { transactionId: utxo.outpoint.transactionId, index: utxo.outpoint.index },
        signatureScript: scriptSigHex,
        sequence: 0n,
        sigOpCount: 1,
      }],
      outputs: [new TransactionOutput(outValue, toSpk)],
      lockTime: txLockTime,
      gas: 0n,
      subnetworkId: '0000000000000000000000000000000000000000',
      payload: '',
    });

    _assertTxInvariants([utxo], signedTx, 'unlockP2SH', wallet.getNetworkId());
    const result = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: result.transactionId, amount: outValue };
  } finally {
    try { await rpc.disconnect(); } catch {}
  }
}

// ── 4b. unlockP2SH_SingleEntry — for single-entry SS contracts (no selector byte) ──

/**
 * Unlock funds from a single-entry P2SH contract (= OracleStake_v1 timeout_unlock).
 *
 * silverc single-entry contracts do NOT push a selector byte in scriptSig (sediment
 * feedback-silverc-single-entry-no-selector 6/2). scriptSig = [sigPush] [redeemScriptPush] only.
 * Adding OP_0 selector would be parsed as int 0 ctor arg → require fail.
 *
 * @param {import('./wallet.mjs').KaspaWallet} wallet - Signer wallet
 * @param {string} p2shAddress - The P2SH address holding the locked funds
 * @param {Uint8Array} redeemScript - The compiled contract bytecode
 * @param {string} toAddress - Destination address for the released funds
 * @param {bigint} lockTime - TX lockTime (must >= SS-required time)
 * @returns {Promise<{ txId: string, amount: bigint }>}
 */
export async function unlockP2SH_SingleEntry(wallet, p2shAddress, redeemScript, toAddress, lockTime = 0n) {
  const txLockTime = BigInt(lockTime);
  const rpc = await connectRpc(wallet.getNetworkId());
  try {
    const { entries } = await rpc.getUtxosByAddresses([p2shAddress]);
    if (!entries?.length) throw new Error(`No UTXOs at P2SH address ${p2shAddress}`);

    const utxo = entries[0];
    const lockedAmount = utxo.entry.amount;
    const fee = kaspaToSompi('0.001');
    const outValue = lockedAmount - fee;
    if (outValue <= 0n) throw new Error('Locked amount too small to cover fee');

    const toSpk = payToAddressScript(new Address(toAddress));

    const unsignedTx = new Transaction({
      version: 0,
      inputs: [{
        previousOutpoint: { transactionId: utxo.outpoint.transactionId, index: utxo.outpoint.index },
        signatureScript: '',
        sequence: 0n,
        sigOpCount: 1,
        utxo,
      }],
      outputs: [new TransactionOutput(outValue, toSpk)],
      lockTime: txLockTime,
      gas: 0n,
      subnetworkId: '0000000000000000000000000000000000000000',
      payload: '',
    });

    const sigHex = createInputSignature(unsignedTx, 0, wallet.getPrivateKey(), SighashType.All);

    // scriptSig: [sigPush][redeemScriptPush] — NO selector byte (single-entry contract)
    const sb = ScriptBuilder.fromScript(redeemScript);
    const scriptSigHex = sb.encodePayToScriptHashSignatureScript(sigHex);

    const signedTx = new Transaction({
      version: 0,
      inputs: [{
        previousOutpoint: { transactionId: utxo.outpoint.transactionId, index: utxo.outpoint.index },
        signatureScript: scriptSigHex,
        sequence: 0n,
        sigOpCount: 1,
      }],
      outputs: [new TransactionOutput(outValue, toSpk)],
      lockTime: txLockTime,
      gas: 0n,
      subnetworkId: '0000000000000000000000000000000000000000',
      payload: '',
    });

    _assertTxInvariants([utxo], signedTx, 'unlockP2SH_SingleEntry', wallet.getNetworkId());
    const result = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: result.transactionId, amount: outValue };
  } finally {
    try { await rpc.disconnect(); } catch {}
  }
}

// ── 5. unlockP2SHMultiSig (Phase 4a Sub 8 NEW, Bettor r242 adapt) ──

/**
 * Unlock P2SH UTXOs with multi-sig settle (= PredictionEscrowUnanimous5 settle pattern).
 * 2 inputs (= maker_stake + taker_stake) + 2 outputs (= winner P2PK + broker P2PK).
 * Pre-collected ECDSA sigs (= 5 oracle sigs per input via Phase 2 DM round trip).
 *
 * sigData per input scriptSig: [sig1+0x01][sig2+0x01]...[sig5+0x01][winner_byte][selector OP_0][redeem]
 *   - winner_byte: OP_0 for YES (winner=0), OP_1 for NO (winner=1)
 *   - selector: OP_0 (= settle entrypoint, branch=0)
 *
 * @param {string} p2shAddress
 * @param {Uint8Array} redeemScript
 * @param {Array<{outpointTxid: string, outpointIndex: number}>} requiredInputOutpoints — 2 outpoints
 * @param {Array<{address: string, amountSompi: bigint|string}>} outputs — 2 outputs
 * @param {Array<Array<string>>} sigsByInput — sigsByInput[i] = 5 oracle sigs hex for input i (= 10 sigs total for 2 inputs)
 * @param {number} winner — 0 (maker won) | 1 (taker won)
 * @param {string} networkId — 'testnet-12'
 * @param {bigint} [lockTime=0]
 * @returns {Promise<{ txId: string }>}
 */
export async function unlockP2SHMultiSig(p2shAddress, redeemScript, requiredInputOutpoints, outputs, sigsByInput, winner, networkId, lockTime = 0n, txObjPreimage = null) {
  if (requiredInputOutpoints.length !== 2) throw new Error(`unlockP2SHMultiSig requires 2 outpoints, got ${requiredInputOutpoints.length}`);
  if (outputs.length !== 2) throw new Error(`unlockP2SHMultiSig requires 2 outputs, got ${outputs.length}`);
  if (sigsByInput.length !== 2) throw new Error(`sigsByInput must be 2 arrays (one per input), got ${sigsByInput.length}`);
  if (sigsByInput.some(arr => arr.length !== 5)) throw new Error(`each input requires 5 oracle sigs (= unanimous)`);
  if (winner !== 0 && winner !== 1) throw new Error(`winner must be 0 (maker) or 1 (taker), got ${winner}`);

  const txLockTime = BigInt(lockTime);
  const rpc = await connectRpc(networkId);
  try {
    const { entries } = await rpc.getUtxosByAddresses([p2shAddress]);
    if (!entries?.length) throw new Error(`No UTXOs at P2SH ${p2shAddress}`);

    // Match by txid only (= Phase 3 UAT bug 6: lock transfer output index non-deterministic).
    const matched = requiredInputOutpoints.map(req => {
      const hits = entries.filter(e => e.outpoint.transactionId === req.outpointTxid);
      if (hits.length === 0) throw new Error(`UTXO not found for lock tx: ${req.outpointTxid}`);
      if (hits.length > 1) throw new Error(`ambiguous: ${hits.length} UTXOs at P2SH from tx ${req.outpointTxid}`);
      const found = hits[0];
      return found;
    });

    const txOutputs = outputs.map(o => new TransactionOutput(
      typeof o.amountSompi === 'string' ? BigInt(o.amountSompi) : o.amountSompi,
      payToAddressScript(new Address(o.address))
    ));

    // sigData builder per input — selector OP_0 (= settle, branch=0), winner OP_0/1, 5 sigs
    //
    // Sub 8.1 fix (5/21 Owner directive): createInputSignature returns 66-byte hex
    // [0x41 OP_PUSHBYTES_65][64-byte Schnorr sig][0x01 SIGHASH_ALL] — ALREADY push-encoded.
    // Previous Sub 8 bug: code appended extra 0x01 sighash byte + used sb.addData() which adds
    // ANOTHER push prefix → double push + double sighash byte → kaspad "malformed signature".
    //
    // Reference: p2sh.mjs unlockP2SH single-sig branch line 202 doc + AgentEscrow .106 production.
    //
    // sigData layout for settle entrypoint:
    //   [sig1_push_encoded_66b] × 5
    //   + [winner_OP] (OP_0 maker / OP_1 taker)
    //   + [selector_OP_0] (entrypoint 0 = settle)
    //   + [redeem_script_push]
    const winnerOpHex = winner === 0 ? '00' : '51';  // OP_0 / OP_1
    const selectorOpHex = '00';  // OP_0 settle branch

    // 5/28 Bettor operator hat: same OP_PUSHDATA2 bypass as L416 (= unlockP2SHConsensual).
    // Settle TX redeem_script 1305 bytes > 520 ScriptBuilder.addData cap. Manual encode.
    // Sediment: same fix applied L416 by NWT but unlockP2SHMultiSig path missed. KI sweep gap.
    const redeemBytes_settle = typeof redeemScript === 'string'
      ? Buffer.from(redeemScript, 'hex')
      : Buffer.from(redeemScript);
    let redeemPushHex;
    if (redeemBytes_settle.length <= 75) {
      redeemPushHex = redeemBytes_settle.length.toString(16).padStart(2, '0') + redeemBytes_settle.toString('hex');
    } else if (redeemBytes_settle.length <= 255) {
      redeemPushHex = '4c' + redeemBytes_settle.length.toString(16).padStart(2, '0') + redeemBytes_settle.toString('hex');
    } else if (redeemBytes_settle.length <= 65535) {
      const lo = (redeemBytes_settle.length & 0xff).toString(16).padStart(2, '0');
      const hi = ((redeemBytes_settle.length >> 8) & 0xff).toString(16).padStart(2, '0');
      redeemPushHex = '4d' + lo + hi + redeemBytes_settle.toString('hex');
    } else {
      throw new Error(`redeem script too large: ${redeemBytes_settle.length} bytes (= max OP_PUSHDATA4 65535)`);
    }

    function assembleScriptSig(sigs5) {
      // sigs5 are already push-encoded hex from createInputSignature — concat directly
      const sigsConcat = sigs5.join('');
      return sigsConcat + winnerOpHex + selectorOpHex + redeemPushHex;
    }

    const scriptSigs = sigsByInput.map(sigs5 => assembleScriptSig(sigs5));

    // Sub 8.2 (Bug 14): reuse voter's exact tx_obj if provided (= byte-identical TX body → sighash match).
    // Else fallback to fresh Transaction build (= legacy path, may have field serialization drift).
    let signedTx;
    if (txObjPreimage) {
      // Reuse phase2_tx_obj that voters signed against. Inject scriptSigs into inputs.
      // Rehydrate BigInt fields lost in JSON roundtrip (= same logic as voter's sign_input_for_settle handler).
      const parsed = JSON.parse(JSON.stringify(txObjPreimage));
      parsed.lockTime = BigInt(parsed.lockTime || 0);
      parsed.gas = BigInt(parsed.gas || 0);
      if (Array.isArray(parsed.inputs)) {
        parsed.inputs = parsed.inputs.map((inp, i) => ({
          ...inp,
          signatureScript: scriptSigs[i],  // inject signed scriptSig
          sequence: BigInt(inp.sequence || 0),
          sigOpCount: Number(inp.sigOpCount || 0),
          utxo: inp.utxo ? {
            ...inp.utxo,
            amount: BigInt(inp.utxo.amount || 0),
            blockDaaScore: BigInt(inp.utxo.blockDaaScore || 0),
          } : undefined,
        }));
      }
      if (Array.isArray(parsed.outputs)) {
        parsed.outputs = parsed.outputs.map(o => ({
          ...o,
          value: BigInt(o.value || 0),
        }));
      }
      signedTx = new Transaction(parsed);
    } else {
      signedTx = new Transaction({
        version: 0,
        inputs: matched.map((utxo, i) => ({
          previousOutpoint: { transactionId: utxo.outpoint.transactionId, index: utxo.outpoint.index },
          signatureScript: scriptSigs[i],
          sequence: 0n,
          sigOpCount: 5,  // 5 oracle checkSig calls in settle entrypoint
        })),
        outputs: txOutputs,
        lockTime: txLockTime,
        gas: 0n,
        subnetworkId: '0000000000000000000000000000000000000000',
        payload: '',
      });
    }

    _assertTxInvariants(matched, signedTx, 'p2sh-submit', networkId);
    const result = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: result.transactionId };
  } finally {
    try { await rpc.disconnect(); } catch {}
  }
}

// ── 5b. unlockP2SHConsensual (Oracle v0.3 sub 5d J2 r43 ship) ──
//
// PredictionEscrowUnanimous5.sil settle_consensual entry (= entrypoint 1, selector OP_1).
// 跟 unlockP2SHMultiSig 区分:
//   - 2 sigs per input (= makerSig + takerSig, not 5 oracle)
//   - selector OP_1 (= settle_consensual branch index), not OP_0 (= settle_dispute)
//   - sigOpCount = 2 per input (not 5)
//   - outputs.length 2 (= [winner P2PK, broker P2PK], 0 oracle output)
//
// scriptSig per input layout (= 跟 source order match silverc stack pop convention):
//   [maker_sig push] [taker_sig push] [winner_OP] [selector_OP_1] [redeem_script push]
//
// @param {string} p2shAddress
// @param {Uint8Array} redeemScript
// @param {Array<{outpointTxid, outpointIndex}>} requiredInputOutpoints — 2 outpoints
// @param {Array<{address, amountSompi}>} outputs — 2 outputs
// @param {Array<Array<string>>} sigsByInput — sigsByInput[i] = [maker_sig, taker_sig] per input
// @param {number} winner — 0 (maker won) | 1 (taker won)
// @param {string} networkId
// @param {bigint} [lockTime=0]
// @param {object} [txObjPreimage] — voter's exact tx_obj for byte-identical sighash (Sub 8.2 Bug 14 pattern)
// @returns {Promise<{txId}>}
export async function unlockP2SHConsensual(p2shAddress, redeemScript, requiredInputOutpoints, outputs, sigsByInput, winner, networkId, lockTime = 0n, txObjPreimage = null) {
  if (requiredInputOutpoints.length !== 2) throw new Error(`unlockP2SHConsensual requires 2 outpoints, got ${requiredInputOutpoints.length}`);
  if (outputs.length !== 2) throw new Error(`unlockP2SHConsensual requires 2 outputs, got ${outputs.length}`);
  if (sigsByInput.length !== 2) throw new Error(`sigsByInput must be 2 arrays (one per input), got ${sigsByInput.length}`);
  if (sigsByInput.some(arr => arr.length !== 2)) throw new Error(`each input requires 2 sigs (= maker + taker for settle_consensual)`);
  if (winner !== 0 && winner !== 1) throw new Error(`winner must be 0 (maker won) or 1 (taker won), got ${winner}`);

  const txLockTime = BigInt(lockTime);
  const rpc = await connectRpc(networkId);
  try {
    const { entries } = await rpc.getUtxosByAddresses([p2shAddress]);
    if (!entries?.length) throw new Error(`No UTXOs at P2SH ${p2shAddress}`);
    const matched = requiredInputOutpoints.map(req => {
      const hits = entries.filter(e => e.outpoint.transactionId === req.outpointTxid);
      if (hits.length === 0) throw new Error(`UTXO not found for lock tx: ${req.outpointTxid}`);
      if (hits.length > 1) throw new Error(`ambiguous: ${hits.length} UTXOs at P2SH from tx ${req.outpointTxid}`);
      return hits[0];
    });
    const txOutputs = outputs.map(o => new TransactionOutput(
      typeof o.amountSompi === 'string' ? BigInt(o.amountSompi) : o.amountSompi,
      payToAddressScript(new Address(o.address))
    ));

    const winnerOpHex = winner === 0 ? '00' : '51';
    const selectorOpHex = '51';  // OP_1 = settle_consensual entrypoint (= 2nd entry per .sil source order)
    // 5/27 post-Toccata bypass: ScriptBuilder.addData enforces pre-Toccata 520 cap (= kaspa-wasm 1.0.1 default
    // covenants_enabled=false). Manually encode OP_PUSHDATA2 for redeem >520 byte. kaspad v1.2.0-toc.2 TN12
    // always-toccata accepts up to 1M element. NWT r61 真因 sediment.
    const redeemBytes = typeof redeemScript === 'string'
      ? Buffer.from(redeemScript, 'hex')
      : Buffer.from(redeemScript);
    let redeemPushHex;
    if (redeemBytes.length <= 75) {
      redeemPushHex = redeemBytes.length.toString(16).padStart(2, '0') + redeemBytes.toString('hex');
    } else if (redeemBytes.length <= 255) {
      redeemPushHex = '4c' + redeemBytes.length.toString(16).padStart(2, '0') + redeemBytes.toString('hex');
    } else if (redeemBytes.length <= 65535) {
      const lo = (redeemBytes.length & 0xff).toString(16).padStart(2, '0');
      const hi = ((redeemBytes.length >> 8) & 0xff).toString(16).padStart(2, '0');
      redeemPushHex = '4d' + lo + hi + redeemBytes.toString('hex');
    } else {
      throw new Error(`redeem script too large: ${redeemBytes.length} bytes (= max OP_PUSHDATA4 65535)`);
    }

    function assembleScriptSig(sigs2) {
      const sigsConcat = sigs2.join('');
      return sigsConcat + winnerOpHex + selectorOpHex + redeemPushHex;
    }
    const scriptSigs = sigsByInput.map(sigs2 => assembleScriptSig(sigs2));

    let signedTx;
    if (txObjPreimage) {
      const parsed = JSON.parse(JSON.stringify(txObjPreimage));
      parsed.lockTime = BigInt(parsed.lockTime || 0);
      parsed.gas = BigInt(parsed.gas || 0);
      if (Array.isArray(parsed.inputs)) {
        parsed.inputs = parsed.inputs.map((inp, i) => ({
          ...inp,
          signatureScript: scriptSigs[i],
          sequence: BigInt(inp.sequence || 0),
          sigOpCount: Number(inp.sigOpCount || 0),
          utxo: inp.utxo ? {
            ...inp.utxo,
            amount: BigInt(inp.utxo.amount || 0),
            blockDaaScore: BigInt(inp.utxo.blockDaaScore || 0),
          } : undefined,
        }));
      }
      if (Array.isArray(parsed.outputs)) {
        parsed.outputs = parsed.outputs.map(o => ({ ...o, value: BigInt(o.value || 0) }));
      }
      signedTx = new Transaction(parsed);
    } else {
      signedTx = new Transaction({
        version: 0,
        inputs: matched.map((utxo, i) => ({
          previousOutpoint: { transactionId: utxo.outpoint.transactionId, index: utxo.outpoint.index },
          signatureScript: scriptSigs[i],
          sequence: 0n,
          sigOpCount: 2,  // 2 checkSig calls in settle_consensual (= maker + taker)
        })),
        outputs: txOutputs,
        lockTime: txLockTime,
        gas: 0n,
        subnetworkId: '0000000000000000000000000000000000000000',
        payload: '',
      });
    }

    _assertTxInvariants(matched, signedTx, 'p2sh-submit', networkId);
    const result = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: result.transactionId };
  } finally {
    try { await rpc.disconnect(); } catch {}
  }
}

// Helper: hex string → Uint8Array (small util, reuse if file lacks one)
function hexStrToBytes(hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

/**
 * Build unsigned settle TX for sighash computation (= Phase 2 dispatch DM payload).
 * Maker_relay calls this to construct candidate TX whose sighash 5 oracles must sign.
 *
 * Returns the Transaction OBJ (= IPC pass tx_obj to oracle voter via sign_input_for_settle).
 *
 * @returns {{ txObj: object, sighashInputs: Array<{inputIndex: number, sighashHint: string}> }}
 */
export async function buildSettleTxPreimage(p2shAddress, requiredInputOutpoints, outputs, networkId, lockTime = 0n, sigOpCounts = null) {
  // B2 v0.5 Sub 2d Phase 2a: accept p2shAddress as string OR array (= spine + N side p2sh for pool settle).
  // 1V1 path passes string; pool path passes array.
  //
  // sigOpCounts (B2 v0.5 Phase 3 bug 5 fix): optional per-input sigOpCount array.
  // CRITICAL: Kaspa sighash includes sig_op_counts_hash (all inputs' sigOpCount). The preimage
  // sigOpCount MUST equal the final settle TX sigOpCount or checkSig fails ("script ran,
  // verification failed"). Pool passes [3×spine, 0×side]; 1V1 omits → default 5 (unchanged).
  const p2shList = Array.isArray(p2shAddress) ? p2shAddress : [p2shAddress];
  const rpc = await connectRpc(networkId);
  try {
    const { entries } = await rpc.getUtxosByAddresses(p2shList);
    if (!entries?.length) throw new Error(`No UTXOs at P2SH(s) ${p2shList.join(',')}`);
    // Match by txid only — a lock transfer produces exactly 1 UTXO at the target P2SH;
    // the output INDEX is non-deterministic (Generator may order payment/change either way).
    // Phase 3 UAT bug 6: hardcoded index 0 was luck. Use the actual found UTXO's index.
    const matched = requiredInputOutpoints.map(req => {
      const hits = entries.filter(e => e.outpoint.transactionId === req.outpointTxid);
      if (hits.length === 0) throw new Error(`UTXO not found for lock tx: ${req.outpointTxid}`);
      if (hits.length > 1) throw new Error(`ambiguous: ${hits.length} UTXOs at P2SH from tx ${req.outpointTxid}`);
      return hits[0];
    });
    if (sigOpCounts && sigOpCounts.length !== matched.length) {
      throw new Error(`sigOpCounts length ${sigOpCounts.length} != input count ${matched.length}`);
    }
    const txOutputs = outputs.map(o => new TransactionOutput(
      typeof o.amountSompi === 'string' ? BigInt(o.amountSompi) : o.amountSompi,
      payToAddressScript(new Address(o.address))
    ));
    const txObj = {
      version: 0,
      inputs: matched.map((utxo, i) => ({
        previousOutpoint: { transactionId: utxo.outpoint.transactionId, index: utxo.outpoint.index },
        signatureScript: '',
        sequence: 0n,
        sigOpCount: sigOpCounts ? sigOpCounts[i] : 5,
        utxo,
      })),
      outputs: txOutputs,
      lockTime: BigInt(lockTime),
      gas: 0n,
      subnetworkId: '0000000000000000000000000000000000000000',
      payload: '',
    };
    return {
      txObj,
      inputCount: matched.length,
    };
  } finally {
    try { await rpc.disconnect(); } catch {}
  }
}

// ── 4. unlockP2SHDual (Phase 4a Sub 9 NEW, Bettor r240 adapt) ──

/**
 * Unlock P2SH UTXOs with 2 inputs → 2 outputs (= PredictionEscrowUnanimous5 refund_both pattern).
 * Single signer (= maker) signs both inputs. Each input has own scriptSig.
 *
 * @param {KaspaWallet} wallet — maker wallet, signs both inputs
 * @param {string} p2shAddress — SS P2SH escrow addr
 * @param {Uint8Array} redeemScript — compiled contract bytecode
 * @param {number} branch — entrypoint selector (= 1 for refund_both)
 * @param {Array<{outpointTxid: string, outpointIndex: number}>} requiredInputOutpoints — 2 specific outpoints (= maker escrow_lock_tx[0] + taker_escrow_lock_tx[0])
 * @param {Array<{address: string, amountSompi: bigint}>} outputs — 2 outputs (= maker_refund + taker_refund)
 * @param {bigint} [lockTime=0]
 * @returns {Promise<{ txId: string }>}
 */
export async function unlockP2SHDual(wallet, p2shAddress, redeemScript, branch, requiredInputOutpoints, outputs, lockTime = 0n) {
  if (branch < 0 || branch > 2) throw new Error(`Invalid branch ${branch}`);
  if (requiredInputOutpoints.length !== 2) throw new Error(`unlockP2SHDual requires exactly 2 input outpoints, got ${requiredInputOutpoints.length}`);
  if (outputs.length !== 2) throw new Error(`unlockP2SHDual requires exactly 2 outputs, got ${outputs.length}`);

  const txLockTime = BigInt(lockTime);
  const rpc = await connectRpc(wallet.getNetworkId());
  try {
    // Find P2SH UTXOs matching the required outpoints
    const { entries } = await rpc.getUtxosByAddresses([p2shAddress]);
    if (!entries?.length) throw new Error(`No UTXOs at P2SH ${p2shAddress}`);

    // Match by txid only (= Phase 3 UAT bug 6: lock transfer output index non-deterministic).
    const matched = requiredInputOutpoints.map(req => {
      const hits = entries.filter(e => e.outpoint.transactionId === req.outpointTxid);
      if (hits.length === 0) throw new Error(`UTXO not found for lock tx: ${req.outpointTxid}`);
      if (hits.length > 1) throw new Error(`ambiguous: ${hits.length} UTXOs at P2SH from tx ${req.outpointTxid}`);
      const found = hits[0];
      return found;
    });

    // Build outputs (= 2 P2PK locks)
    const txOutputs = outputs.map(o => new TransactionOutput(o.amountSompi, payToAddressScript(new Address(o.address))));

    // Build unsigned TX (= 2 inputs each carrying utxo for sighash)
    const buildInputs = (scriptSigs) => matched.map((utxo, i) => ({
      previousOutpoint: { transactionId: utxo.outpoint.transactionId, index: utxo.outpoint.index },
      signatureScript: scriptSigs[i] || '',
      sequence: 0n,
      sigOpCount: 1,
      utxo,
    }));
    const unsignedTx = new Transaction({
      version: 0,
      inputs: buildInputs(['', '']),
      outputs: txOutputs,
      lockTime: txLockTime,
      gas: 0n,
      subnetworkId: '0000000000000000000000000000000000000000',
      payload: '',
    });

    // Sign each input + build scriptSig (= branch selector + sig + redeem)
    const branchOpcode = branch === 0 ? '00' : branch === 1 ? '51' : '52';
    const scriptSigs = [];
    for (let i = 0; i < matched.length; i++) {
      const sigHex = createInputSignature(unsignedTx, i, wallet.getPrivateKey(), SighashType.All);
      const sb = ScriptBuilder.fromScript(redeemScript);
      const basicHex = sb.encodePayToScriptHashSignatureScript(sigHex);
      // Insert branch opcode between sig push and redeem push
      const scriptSigHex = basicHex.slice(0, sigHex.length) + branchOpcode + basicHex.slice(sigHex.length);
      scriptSigs.push(scriptSigHex);
    }

    // Rebuild TX with signed scriptSigs (= inputs no longer carry utxo, just outpoint+scriptSig)
    const signedTx = new Transaction({
      version: 0,
      inputs: matched.map((utxo, i) => ({
        previousOutpoint: { transactionId: utxo.outpoint.transactionId, index: utxo.outpoint.index },
        signatureScript: scriptSigs[i],
        sequence: 0n,
        sigOpCount: 1,
      })),
      outputs: txOutputs,
      lockTime: txLockTime,
      gas: 0n,
      subnetworkId: '0000000000000000000000000000000000000000',
      payload: '',
    });

    _assertTxInvariants(matched, signedTx, 'unlockP2SHDual', wallet.getNetworkId());
    const result = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: result.transactionId };
  } finally {
    try { await rpc.disconnect(); } catch {}
  }
}

// ── 6. unlockPoolSpineP2SH (B2 v0.5 Sub 2d Phase 2c step 2a) ──

/**
 * Pool spine + sides multi-input unlock for cooperative Path A spine settle TX.
 *
 * Per PoolSpine.sil entry 0 settle_unanimous: spine input needs 3 oracle sigs + winner + sidesMerkleRoot.
 * Per PoolSide.sil entry 0 settled_via_spine: side inputs need NO sigs.
 *
 * scriptSig layout:
 *   - spine input: [3 oracle sigs push-encoded 66B each] + winnerOP + sidesMerkleRoot push + selector_0 + spine_redeem push
 *   - side input: [selector_0] + [side_redeem push]
 *
 * Phase 2c step 2a first ship: unanimous (entry 0) only. forfeit_1 entry 1 deferred next step.
 */
export async function unlockPoolSpineP2SH(args) {
  const {
    spineP2shAddress, sideP2shAddresses, spineRedeemScriptHex, sideRedeemScriptHexes,
    requiredInputOutpoints, outputs, spineSigsByInput, spineInputCount, winner, sidesMerkleRootHex,
    unanimous, networkId, lockTime = 0n, txObjPreimage = null, settleEntrypoint = 0,
  } = args;
  // #31 ④a: PoolSpine_v08 settle_aggregate is entry 1 (multi-entry contract) — v0.5/0.6/0.7 settle was
  // entry 0. ONLY the spine input selector changes (OP_1); PoolSide "settled_via_spine" stays entry 0 (OP_0).
  // Witness param order is byte-identical to v0.7 entry0 (verified vs PoolSpine_v08_chunk.sil L253-273).
  if (settleEntrypoint !== 0 && settleEntrypoint !== 1) throw new Error(`settleEntrypoint must be 0 (v05/06/07 settle / v08 settle_chunk) or 1 (v08 settle_aggregate), got ${settleEntrypoint}`);

  // Bettor r287 layer-21 G2-A relay: v0.6 settle_aggregate has validSigs counter (4-of-5
  // threshold) → unanimous skip moot. v0.5 still requires unanimous (entry 0 only, entry 1
  // forfeit_1 deferred). Detect v0.6 via committee_data presence (= same as scriptSig branch).
  const isV06EarlyDetect = !!args.committee_data && Array.isArray(args.committee_data.committee_pks) && args.committee_data.committee_pks.length === 5;
  if (!unanimous && !isV06EarlyDetect) throw new Error('Phase 2c step 2a first ship supports unanimous only (v0.5) — forfeit_1 entry 1 deferred next step');
  if (winner !== 0 && winner !== 1) throw new Error(`winner must be 0 or 1, got ${winner}`);
  if (!Array.isArray(sideP2shAddresses) || !Array.isArray(sideRedeemScriptHexes)) throw new Error('sideP2shAddresses and sideRedeemScriptHexes required arrays');
  if (sideP2shAddresses.length !== sideRedeemScriptHexes.length) throw new Error(`side count mismatch: ${sideP2shAddresses.length} addresses vs ${sideRedeemScriptHexes.length} redeem scripts`);
  // Spine P2SH has spineInputCount UTXOs (= 1 maker stake + N oracle bonds).
  if (!Number.isInteger(spineInputCount) || spineInputCount < 1) throw new Error(`spineInputCount must be ≥1, got ${spineInputCount}`);
  if (!Array.isArray(spineSigsByInput) || spineSigsByInput.length !== spineInputCount) {
    throw new Error(`spineSigsByInput must be ${spineInputCount} arrays, got ${spineSigsByInput?.length}`);
  }
  // KANet-UI r389 / Bettor r213 Layer-11 KI 49: v0.5 hardcoded 3-sig check rejects v0.6 5-sig
  // unanimous. Accept any uniform count >= 3 (v0.5) or 5 (v0.6 path A settle_aggregate).
  // PoolSpine_v06.sil entry 0 expects 5 committee sigs + 5 PKs + merkle proofs — caller
  // (settler) responsible for assembling correct scriptSig per protocol_version. Here we
  // only enforce uniformity across spine inputs (= each input gets same number of sigs).
  const expectedSigCount = spineSigsByInput[0]?.length || 0;
  if (![3, 5].includes(expectedSigCount)) {
    throw new Error(`spine sigs/input must be 3 (v0.5) or 5 (v0.6 settle_aggregate), got ${expectedSigCount}`);
  }
  if (spineSigsByInput.some(sigs => !Array.isArray(sigs) || sigs.length !== expectedSigCount)) {
    throw new Error(`each spine input must have ${expectedSigCount} oracle sigs (uniform across inputs)`);
  }
  if (requiredInputOutpoints.length !== spineInputCount + sideP2shAddresses.length) {
    throw new Error(`input outpoint count ${requiredInputOutpoints.length} != ${spineInputCount} spine + ${sideP2shAddresses.length} sides`);
  }

  const txLockTime = BigInt(lockTime);
  const rpc = await connectRpc(networkId);
  try {
    const allP2shList = [spineP2shAddress, ...sideP2shAddresses];
    const { entries } = await rpc.getUtxosByAddresses(allP2shList);
    if (!entries?.length) throw new Error(`No UTXOs found at pool P2SH addresses`);

    // Match by txid only (= Phase 3 UAT bug 6: lock transfer output index non-deterministic).
    const matched = requiredInputOutpoints.map(req => {
      const hits = entries.filter(e => e.outpoint.transactionId === req.outpointTxid);
      if (hits.length === 0) throw new Error(`UTXO not found for lock tx: ${req.outpointTxid}`);
      if (hits.length > 1) throw new Error(`ambiguous: ${hits.length} UTXOs at P2SH from tx ${req.outpointTxid}`);
      const found = hits[0];
      return found;
    });

    const txOutputs = outputs.map(o => new TransactionOutput(
      typeof o.amountSompi === 'string' ? BigInt(o.amountSompi) : o.amountSompi,
      payToAddressScript(new Address(o.address))
    ));

    const winnerOpHex = winner === 0 ? '00' : '51';
    // #31 ④a: split spine vs side selector. spine: v08 settle_aggregate=entry1(OP_1='51'), else entry0(OP_0='00').
    // side: PoolSide settled_via_spine = entry0(OP_0) unchanged across all versions.
    const spineSelectorOpHex = settleEntrypoint === 1 ? '51' : '00';
    const sideSelectorOpHex = '00';

    const rootBytes = new Uint8Array(Buffer.from(sidesMerkleRootHex.replace(/^0x/, ''), 'hex'));
    if (rootBytes.length !== 32) throw new Error(`sidesMerkleRoot must be 32 bytes, got ${rootBytes.length}`);
    // 32-byte Merkle root < 75 → OP_DATA_32 encoding (= 0x20 + 32 bytes), no 520 cap risk but use bypass for consistency.
    const rootPushHex = _encodePushDataHex(Buffer.from(rootBytes));

    // 5/28 NWT c905e25 sweep follow-up (Bettor r113 KI catch): OP_PUSHDATA2 bypass for pool spine + sides redeem scripts.
    // Per memory feedback_grep_full_codebase_pattern_fix — pattern bug must sweep全 codebase.
    const spineRedeemBytes = Buffer.from(spineRedeemScriptHex, 'hex');
    const spineRedeemPushHex = _encodePushDataHex(spineRedeemBytes);

    // J1 r221 + Bettor r219 ③ Layer-12 Part B: v0.6 settle_aggregate path uses 58-arg scriptSig
    // (5 sigs + committeePkHash + winner + sidesMerkleRoot + 5 PKs + 5 indices + 5x8 siblings).
    // Detect v0.6 via args.committee_data presence — Console settler bakes it via dispatchPhase2.
    const isV06 = !!args.committee_data
      && Array.isArray(args.committee_data.committee_pks)
      && args.committee_data.committee_pks.length === 5;

    // Each spine input gets its own scriptSig (= own sigs over that input's sighash).
    const spineScriptSigs = spineSigsByInput.map(sigs => {
      if (!isV06) {
        // v0.5 legacy path: 3 sigs + winner + root + selector + redeem.
        return sigs.join('') + winnerOpHex + rootPushHex + spineSelectorOpHex + spineRedeemPushHex;
      }
      // v0.6 path A settle_aggregate. Push order per J1 r221 spec (= silverc LIFO, declaration
      // reversed): siblings[4] depth7..0 → ... → siblings[0] depth7..0 → indices c4..c0 → PKs
      // c4..c0 → sidesMerkleRoot → winner → committeePkHash → sigs c4..c0 → selector → redeem.
      const cd = args.committee_data;
      const proofs = cd.committee_merkle_proofs;  // 5 arrays of 8 hex strings (= sibling hashes)
      const indices = cd.committee_indices;  // 5 ints
      const pks = cd.committee_pks;  // 5 hex strings (32B x-only)
      const committeePkHash = cd.committee_pk_hash;  // hex 32B
      if (sigs.length !== 5) throw new Error(`v0.6 settle_aggregate needs 5 sigs per input, got ${sigs.length}`);
      const pushBytes = (hex) => _encodePushDataHex(Buffer.from(hex, 'hex'));
      const opNHex = (n) => {
        if (n === 0) return '00';
        if (n >= 1 && n <= 16) return (0x50 + n).toString(16).padStart(2, '0');
        // Push as little-endian minimal int bytes (= silverc int encoding).
        return _encodePushDataHex(Buffer.from([n & 0xff]));
      };
      // Bettor r353: Kaspa CScriptNum encoder for LARGE ints (globalYes/No = 1e10+ sompi exceed
      // opNHex's 0-255 byte range). Little-endian minimal + high-bit sign disambiguation (= same
      // CScriptNum convention as Bitcoin). Verified: 1e10 → '0500e40b5402' (matches the 1e10
      // ctor amount encoding observed in PoolSpine_v07 redeem script scriptSig dump).
      const encodeScriptNumPush = (val) => {
        let v = BigInt(val);
        if (v === 0n) return '00';  // int 0 = OP_0
        const neg = v < 0n;
        if (neg) v = -v;
        const bytes = [];
        while (v > 0n) { bytes.push(Number(v & 0xffn)); v >>= 8n; }
        if (bytes[bytes.length - 1] & 0x80) bytes.push(neg ? 0x80 : 0x00);
        else if (neg) bytes[bytes.length - 1] |= 0x80;
        return _encodePushDataHex(Buffer.from(bytes));
      };
      // Bettor r245 实证定案: v0.5 push = declaration order (silverc binds locals via
      // reverse-pop internally, declaration order == push order). v0.6 same convention.
      // Declaration order: sigs c0..c4, committeePkHash, winner, sidesMerkleRoot, PKs c0..c4,
      // indices c0..c4, siblings c0s0..c0s7 → c1s0..c1s7 → ... → c4s0..c4s7.
      let scriptSigHex = '';
      // Sigs c0..c4 (already push-encoded from createInputSignature, 132 hex / 66 bytes each)
      for (let ci = 0; ci < 5; ci++) scriptSigHex += sigs[ci];
      // committeePkHash, winner, sidesMerkleRoot
      scriptSigHex += pushBytes(committeePkHash);
      scriptSigHex += winnerOpHex;
      scriptSigHex += rootPushHex;
      // PKs c0..c4
      for (let ci = 0; ci < 5; ci++) scriptSigHex += pushBytes(pks[ci]);
      // Indices c0..c4
      for (let ci = 0; ci < 5; ci++) scriptSigHex += opNHex(indices[ci]);
      // Bettor r353: v0.7 settle_aggregate sharding globals — declaration order (PoolSpine_v07.sil
      // L103-105) is AFTER indices, BEFORE siblings: globalYesTotal_sompi, globalNoTotal_sompi,
      // global_commit_id(byte[32]). v0.6 SS has none → cd.global_yes_total_sompi undefined → skip
      // → v0.6 scriptSig byte-identical to 46f8a-proven path. Missing them was the qoyqv
      // 'pick at invalid location' (stack short 3 → all sibling picks off-by-3).
      const hasV07Globals = cd.global_yes_total_sompi !== undefined && cd.global_yes_total_sompi !== null;
      if (hasV07Globals) {
        scriptSigHex += encodeScriptNumPush(cd.global_yes_total_sompi);
        scriptSigHex += encodeScriptNumPush(cd.global_no_total_sompi);
        scriptSigHex += pushBytes(cd.global_commit_id);
      }
      // Siblings: committee 0..4 outer, depth 0..7 inner
      for (let ci = 0; ci < 5; ci++) {
        const sibs = proofs[ci];
        if (!Array.isArray(sibs) || sibs.length !== 8) {
          throw new Error(`v0.6 settle_aggregate committee[${ci}] needs 8 siblings, got ${sibs?.length}`);
        }
        for (let d = 0; d < 8; d++) scriptSigHex += pushBytes(sibs[d]);
      }
      // Selector (v0.6/0.7 settle_aggregate=entry0 OP_0; v08 settle_aggregate=entry1 OP_1) + redeem reveal
      scriptSigHex += spineSelectorOpHex;
      scriptSigHex += spineRedeemPushHex;
      // J1 r245 + Bettor diff request: dump FULL scriptSig hex for byte-level cross-verify
      // against Bettor's _diag_scriptsig_46f8a.cjs reconstruction.
      console.log(`[unlockPoolSpineP2SH v0.6 FULL] scriptSig ${scriptSigHex.length/2}B: ${scriptSigHex}`);
      return scriptSigHex;
    });

    const sideScriptSigs = sideRedeemScriptHexes.map(redeemHex => {
      const redeemBytes = Buffer.from(redeemHex, 'hex');
      return sideSelectorOpHex + _encodePushDataHex(redeemBytes);
    });

    const allScriptSigs = [...spineScriptSigs, ...sideScriptSigs];

    let signedTx;
    if (txObjPreimage) {
      const parsed = JSON.parse(JSON.stringify(txObjPreimage));
      parsed.lockTime = BigInt(parsed.lockTime || 0);
      parsed.gas = BigInt(parsed.gas || 0);
      if (Array.isArray(parsed.inputs)) {
        parsed.inputs = parsed.inputs.map((inp, i) => ({
          ...inp,
          signatureScript: allScriptSigs[i],
          sequence: BigInt(inp.sequence || 0),
          // CRITICAL (Phase 3 bug 5): keep preimage's sigOpCount — Kaspa sighash includes
          // sig_op_counts_hash. Override here ≠ preimage → sighash mismatch → checkSig fail.
          sigOpCount: Number(inp.sigOpCount || 0),
          utxo: inp.utxo ? {
            ...inp.utxo,
            amount: BigInt(inp.utxo.amount || 0),
            blockDaaScore: BigInt(inp.utxo.blockDaaScore || 0),
          } : undefined,
        }));
      }
      if (Array.isArray(parsed.outputs)) {
        parsed.outputs = parsed.outputs.map(o => ({ ...o, value: BigInt(o.value || 0) }));
      }
      signedTx = new Transaction(parsed);
    } else {
      // Bettor r271/r275 layer-16/18: 5 checkSig→budget=509999, used=510021. Bumped 8→809999 margin.
      const spineSigOpCountFinal = isV06 ? 8 : 3;
      signedTx = new Transaction({
        version: 0,
        inputs: matched.map((utxo, i) => ({
          previousOutpoint: { transactionId: utxo.outpoint.transactionId, index: utxo.outpoint.index },
          signatureScript: allScriptSigs[i],
          sequence: 0n,
          sigOpCount: i < spineInputCount ? spineSigOpCountFinal : 0,
        })),
        outputs: txOutputs,
        lockTime: txLockTime,
        gas: 0n,
        subnetworkId: '0000000000000000000000000000000000000000',
        payload: '',
      });
    }

    _assertTxInvariants(matched, signedTx, 'unlockPoolSpineP2SH', networkId);
    const result = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: result.transactionId };
  } finally {
    try { await rpc.disconnect(); } catch {}
  }
}

// ── 7. unlockPoolSpineRefundDisagreement (B2 v0.5 area-4 7c) ──

/**
 * Pool spine refund_disagreement unlock — area-4 Gap 1A/1B + Owner Gap 1B burn.
 *
 * Per PoolSpine.sil entry 4 refund_disagreement: each spine input needs 2 oracle sigs (=
 * per signingPair) + signingPair OP + silentOracleIndex OP + selector_4 + spine_redeem push.
 *
 * Spine-only TX: 4 inputs (= 1 maker stake + 3 oracle bond UTXOs, all baked at create), no
 * side inputs (bettors refund SEPARATELY via PoolSide.refund_market_cancelled per area-4
 * Gap 2). Each of the 4 inputs has its own sighash → its own 2 oracle sigs.
 *
 * scriptSig per spine input:
 *   [sigA push 66B][sigB push 66B][signingPair OP][silentOracleIndex OP][selector OP_4][spine_redeem push]
 *
 * OP encoding for ints:
 *   -1 → OP_1NEGATE (0x4f); 0 → OP_0 (0x00); 1 → OP_1 (0x51); 2 → OP_2 (0x52)
 *   selector entry 4 → OP_4 (0x54)
 */
export async function unlockPoolSpineRefundDisagreement(args) {
  const {
    spineP2shAddress, spineRedeemScriptHex,
    requiredInputOutpoints, outputs, spineSigsByInput,
    silentOracleIndex, signingPair,
    networkId, lockTime = 0n, txObjPreimage = null,
  } = args;

  if (silentOracleIndex !== -1 && (silentOracleIndex < 0 || silentOracleIndex > 2)) {
    throw new Error(`silentOracleIndex must be -1 or 0-2, got ${silentOracleIndex}`);
  }
  if (signingPair < 0 || signingPair > 2) throw new Error(`signingPair must be 0-2, got ${signingPair}`);
  // P6 constraint 2 cross-check (defense in depth — SS enforces but assert here too for fast-fail)
  if (silentOracleIndex !== -1 && signingPair !== (2 - silentOracleIndex)) {
    throw new Error(`signingPair ${signingPair} must equal 2-silentOracleIndex (${2 - silentOracleIndex}) for Gap 1B`);
  }
  const expectedOutputCount = silentOracleIndex === -1 ? 4 : 3;
  if (outputs.length !== expectedOutputCount) {
    throw new Error(`outputs.length ${outputs.length} != expected ${expectedOutputCount} (silentOracleIndex=${silentOracleIndex})`);
  }
  if (!Array.isArray(spineSigsByInput) || spineSigsByInput.length !== requiredInputOutpoints.length) {
    throw new Error(`spineSigsByInput must be ${requiredInputOutpoints.length} arrays`);
  }
  if (spineSigsByInput.some(sigs => !Array.isArray(sigs) || sigs.length !== 2)) {
    throw new Error('each spine input requires 2 oracle sigs for refund_disagreement');
  }

  const intToOpHex = (n) => {
    if (n === -1) return '4f';  // OP_1NEGATE
    if (n === 0) return '00';   // OP_0
    if (n === 1) return '51';   // OP_1
    if (n === 2) return '52';   // OP_2
    throw new Error(`unsupported int for OP encoding: ${n}`);
  };
  const signingPairOpHex = intToOpHex(signingPair);
  const silentOracleIndexOpHex = intToOpHex(silentOracleIndex);
  const selectorOpHex = '54';  // OP_4 = entry 4 (refund_disagreement)

  const txLockTime = BigInt(lockTime);
  const rpc = await connectRpc(networkId);
  try {
    const { entries } = await rpc.getUtxosByAddresses([spineP2shAddress]);
    if (!entries?.length) throw new Error(`No UTXOs found at spine P2SH ${spineP2shAddress}`);

    // Match by txid only (Phase 3 UAT bug 6 sediment).
    const matched = requiredInputOutpoints.map(req => {
      const hits = entries.filter(e => e.outpoint.transactionId === req.outpointTxid);
      if (hits.length === 0) throw new Error(`UTXO not found for lock tx: ${req.outpointTxid}`);
      if (hits.length > 1) throw new Error(`ambiguous: ${hits.length} UTXOs at spine from tx ${req.outpointTxid}`);
      return hits[0];
    });

    const txOutputs = outputs.map(o => new TransactionOutput(
      typeof o.amountSompi === 'string' ? BigInt(o.amountSompi) : o.amountSompi,
      payToAddressScript(new Address(o.address))
    ));

    // 5/28 NWT c905e25 sweep (Bettor r113 KI): OP_PUSHDATA2 bypass for pool refund spine redeem.
    const spineRedeemBytes = Buffer.from(spineRedeemScriptHex, 'hex');
    const spineRedeemPushHex = _encodePushDataHex(spineRedeemBytes);

    // Each spine input gets its own scriptSig (= own 2 sigs over its own sighash).
    const spineScriptSigs = spineSigsByInput.map(sigs =>
      sigs.join('') + signingPairOpHex + silentOracleIndexOpHex + selectorOpHex + spineRedeemPushHex
    );

    let signedTx;
    if (txObjPreimage) {
      const parsed = JSON.parse(JSON.stringify(txObjPreimage));
      parsed.lockTime = BigInt(parsed.lockTime || 0);
      parsed.gas = BigInt(parsed.gas || 0);
      if (Array.isArray(parsed.inputs)) {
        parsed.inputs = parsed.inputs.map((inp, i) => ({
          ...inp,
          signatureScript: spineScriptSigs[i],
          sequence: BigInt(inp.sequence || 0),
          // Phase 3 bug 5: keep preimage's sigOpCount (Kaspa sighash includes sig_op_counts_hash).
          sigOpCount: Number(inp.sigOpCount || 0),
          utxo: inp.utxo ? {
            ...inp.utxo,
            amount: BigInt(inp.utxo.amount || 0),
            blockDaaScore: BigInt(inp.utxo.blockDaaScore || 0),
          } : undefined,
        }));
      }
      if (Array.isArray(parsed.outputs)) {
        parsed.outputs = parsed.outputs.map(o => ({ ...o, value: BigInt(o.value || 0) }));
      }
      signedTx = new Transaction(parsed);
    } else {
      signedTx = new Transaction({
        version: 0,
        inputs: matched.map((utxo, i) => ({
          previousOutpoint: { transactionId: utxo.outpoint.transactionId, index: utxo.outpoint.index },
          signatureScript: spineScriptSigs[i],
          sequence: 0n,
          sigOpCount: 2,  // 2 oracle checkSig calls per spine input in refund_disagreement
        })),
        outputs: txOutputs,
        lockTime: txLockTime,
        gas: 0n,
        subnetworkId: '0000000000000000000000000000000000000000',
        payload: '',
      });
    }

    _assertTxInvariants(matched, signedTx, 'p2sh-submit', networkId);
    const result = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: result.transactionId };
  } finally {
    try { await rpc.disconnect(); } catch {}
  }
}

// ── 7c — unlockPoolSpineRefundMakerUnjoined (G2-B 二期, Bettor r263 钦点) ──
//
// PoolSpine_v06.sil entry 2 refund_maker_unjoined (= 0-bet auto-refund single-sig path).
// Spec L273-282:
//   - 1 input (= spine UTXO holding maker stake)
//   - 1 output (= P2PK to makerPk, value == makerStakeAmount - minerFee EXACT)
//   - require(checkSig(makerSig, pubkey(makerPk))) → maker single sig only
//   - require(tx.time >= deadline * 1000) → lockTime in ms (bug 10d Path A sediment)
//
// scriptSig: [makerSig push] + OP_2 (= selector entry 2) + [redeemScript push].
//
// Maker_relay 自家 wallet 签 (= makerPk privkey 在 maker_relay), inline 一步 sign+submit.
// No DM/chain collection needed (single-sig vs settle 5-of-5 committee).
export async function unlockPoolSpineRefundMakerUnjoined(args) {
  const {
    wallet, spineP2shAddress, spineRedeemScriptHex,
    requiredInputOutpoint, output,
    networkId, lockTime = 0n, txObjPreimage = null,
  } = args;
  if (!wallet) throw new Error('unlockPoolSpineRefundMakerUnjoined: wallet required (= maker_relay signer)');
  if (!requiredInputOutpoint?.outpointTxid) throw new Error('requiredInputOutpoint.outpointTxid required');
  if (!output?.address || (output.amountSompi == null)) throw new Error('output { address, amountSompi } required');

  const txLockTime = BigInt(lockTime);
  const rpc = await connectRpc(networkId);
  try {
    const { entries } = await rpc.getUtxosByAddresses([spineP2shAddress]);
    if (!entries?.length) throw new Error(`No UTXOs at spine P2SH ${spineP2shAddress}`);
    const hits = entries.filter(e => e.outpoint.transactionId === requiredInputOutpoint.outpointTxid);
    if (hits.length === 0) throw new Error(`UTXO not found for lock tx: ${requiredInputOutpoint.outpointTxid}`);
    if (hits.length > 1) throw new Error(`ambiguous: ${hits.length} UTXOs at spine from tx ${requiredInputOutpoint.outpointTxid}`);
    const matched = [hits[0]];

    const outAmount = typeof output.amountSompi === 'string' ? BigInt(output.amountSompi) : BigInt(output.amountSompi);
    const outSpk = payToAddressScript(new Address(output.address));

    // Rehydrate preimage if provided (= settler.dispatchRefund built via prediction_settle_build_preimage).
    // Preimage owns the exact output amount that matches SS L281 require(value == makerStakeAmount - minerFee).
    let unsignedTx;
    if (txObjPreimage) {
      const parsed = JSON.parse(JSON.stringify(txObjPreimage));
      // CRITICAL (qlfpv 实测 sighash mismatch bug): preimage 从 prediction_settle_build_preimage
      // 来 默认 lockTime=0 (= dispatchRefund 不传 lock_time). 但 SS L275 require(tx.time >=
      // deadline*1000) → final signedTx 必带 txLockTime. Kaspa sighash 含 lockTime →
      // unsignedTx.lockTime 必须等于 signedTx.lockTime 否则 sig 不匹 → "script ran, but
      // verification failed" reject. 用 caller 的 txLockTime override preimage.lockTime.
      parsed.lockTime = txLockTime;
      parsed.gas = BigInt(parsed.gas || 0);
      // CRITICAL (2nd sighash bug, qlfpv 实测 2nd round): buildSettleTxPreimage default
      // sigOpCount=5 (L596 default for 1V1 settle 5 sigs). PoolSpine_v06 entry 2 单 makerSig
      // → scriptSig 实际 1 sigOp. Kaspa sighash 含 sig_op_counts_hash → unsignedTx sigOpCount
      // 必须等于 signedTx sigOpCount (= 1 hardcoded below) 否则 sig 不匹 → script verify fail.
      // 强制覆盖为 1 (= entry 2 SS body 唯一 checkSig).
      parsed.inputs = parsed.inputs.map(inp => ({
        ...inp,
        signatureScript: '',  // strip for sighash compute
        sequence: BigInt(inp.sequence || 0),
        sigOpCount: 1,  // override preimage default (5) to match signedTx + SS entry 2 spec
        utxo: inp.utxo ? {
          ...inp.utxo,
          amount: BigInt(inp.utxo.amount || 0),
          blockDaaScore: BigInt(inp.utxo.blockDaaScore || 0),
        } : undefined,
      }));
      parsed.outputs = parsed.outputs.map(o => ({ ...o, value: BigInt(o.value || 0) }));
      unsignedTx = new Transaction(parsed);
    } else {
      unsignedTx = new Transaction({
        version: 0,
        inputs: [{
          previousOutpoint: { transactionId: matched[0].outpoint.transactionId, index: matched[0].outpoint.index },
          signatureScript: '',
          sequence: 0n,
          sigOpCount: 1,
          utxo: matched[0],
        }],
        outputs: [new TransactionOutput(outAmount, outSpk)],
        lockTime: txLockTime,
        gas: 0n,
        subnetworkId: '0000000000000000000000000000000000000000',
        payload: '',
      });
    }

    // Maker single-sig (= SS L274 require(checkSig(makerSig, pubkey(makerPk)))).
    // createInputSignature returns push-encoded hex [0x41][64sig][0x01] (= 66 bytes / 132 hex chars).
    const makerSigHex = createInputSignature(unsignedTx, 0, wallet.getPrivateKey(), SighashType.All);

    // scriptSig: [makerSig push] + OP_2 (selector entry 2 refund_maker_unjoined) + [redeemScript push]
    const spineRedeemBytes = Buffer.from(spineRedeemScriptHex, 'hex');
    const spineRedeemPushHex = _encodePushDataHex(spineRedeemBytes);
    const scriptSigHex = makerSigHex + '52' + spineRedeemPushHex;

    const signedTx = new Transaction({
      version: 0,
      inputs: [{
        previousOutpoint: { transactionId: matched[0].outpoint.transactionId, index: matched[0].outpoint.index },
        signatureScript: scriptSigHex,
        sequence: 0n,
        sigOpCount: 1,
      }],
      outputs: [new TransactionOutput(outAmount, outSpk)],
      lockTime: txLockTime,
      gas: 0n,
      subnetworkId: '0000000000000000000000000000000000000000',
      payload: '',
    });

    _assertTxInvariants(matched, signedTx, 'unlockPoolSpineRefundMakerUnjoined', networkId);
    const result = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: result.transactionId };
  } finally {
    try { await rpc.disconnect(); } catch {}
  }
}

// ── 7d — unlockPoolSideRefundCancelled (DoD C 退款自取, Bettor r261 钦点) ──
//
// PoolSide_v06/v07 entry 2 refund_market_cancelled (= bettor 自取 stake 走 cancel 退款路).
// Spec PoolSide_v07 L268-281:
//   - 1 input (= side UTXO holding bettor stake)
//   - 1 output (= P2PK to bettorPk, value 在 fee 范围)
//   - require(checkSig(bettorSig, pubkey(bettorPk))) → bettor 自签
//   - require(tx.time >= deadline * 1000) → lockTime in ms (= 跟 spine refund 同款 grace 雷,
//     待 J1 r261 v0.8 SS 改 (deadline + refundGraceSeconds)*1000 防 front-run)
//
// scriptSig: [bettorSig push] + OP_2 (= selector entry 2) + [redeemScript push].
//
// Bettor_relay 自家 wallet 签 (= bettorPk privkey 在 bettor_relay), inline 一步 sign+submit.
// 同 unlockPoolSpineRefundMakerUnjoined 模式 (qlfpv 实证), 复用 byte-size mass-aware fee.
export async function unlockPoolSideRefundCancelled(args) {
  const {
    wallet, sideP2shAddress, sideRedeemScriptHex,
    requiredInputOutpoint, output,
    networkId, lockTime = 0n, txObjPreimage = null,
    // J2-tn r391 (#28 Bettor ③ APPROVE v2 05:26): entryIndex 参数化 — legacy v0.5 PoolSide 4 entrypoint
    // refund_market_cancelled=idx 3 (OP_3='53'); v06/v07 PoolSide 3 entrypoint refund=idx 2 (OP_2='52').
    // 默认 2 (= v06/v07 backward-compat 现 caller 全 v06/v07). 调时显式传 3 for ver=null/v0.5.
    entryIndex = 2,
    // v0.5 hardcodes output == stake - 1000 (1000 sompi in-script constant), so 1000 sompi TX fee
    // won't cover actual mempool fee → must add a relay wallet UTXO as fee-input, no-change.
    addFeeInput = false,
  } = args;
  if (!wallet) throw new Error('unlockPoolSideRefundCancelled: wallet required (= bettor_relay signer)');
  if (!requiredInputOutpoint?.outpointTxid) throw new Error('requiredInputOutpoint.outpointTxid required');
  if (!output?.address || (output.amountSompi == null)) throw new Error('output { address, amountSompi } required');

  const txLockTime = BigInt(lockTime);
  const rpc = await connectRpc(networkId);
  try {
    const { entries } = await rpc.getUtxosByAddresses([sideP2shAddress]);
    if (!entries?.length) throw new Error(`No UTXOs at side P2SH ${sideP2shAddress}`);
    const hits = entries.filter(e => e.outpoint.transactionId === requiredInputOutpoint.outpointTxid);
    if (hits.length === 0) throw new Error(`UTXO not found for side lock tx: ${requiredInputOutpoint.outpointTxid}`);
    if (hits.length > 1) throw new Error(`ambiguous: ${hits.length} UTXOs at side from tx ${requiredInputOutpoint.outpointTxid}`);
    const matched = [hits[0]];

    const outAmount = typeof output.amountSompi === 'string' ? BigInt(output.amountSompi) : BigInt(output.amountSompi);
    const outSpk = payToAddressScript(new Address(output.address));

    // Fee-input: fetch relay's own UTXO to cover actual TX fee (needed for v0.5 legacy whose
    // in-script output == stake - 1000 leaves only 1000 sompi for miner, far below mempool floor).
    let feeEntry = null;
    if (addFeeInput) {
      const relayAddress = wallet.getAddress();
      const { entries: relayEntries } = await rpc.getUtxosByAddresses([relayAddress]);
      if (!relayEntries?.length) throw new Error(`unlockPoolSideRefundCancelled: no UTXOs at relay wallet ${relayAddress} for fee-input`);
      // Pick smallest UTXO to minimise overpay (no-change design: entire UTXO amount is fee).
      feeEntry = relayEntries.reduce((a, b) => BigInt(a.amount) <= BigInt(b.amount) ? a : b);
    }

    // Same sighash field discipline as unlockPoolSpineRefundMakerUnjoined (qlfpv 4-bug sediment):
    //   parsed.lockTime = txLockTime (= match signedTx, not preimage default 0)
    //   parsed.inputs[i].sigOpCount = 1 (= match SS entry 2 single checkSig, not preimage default 5)
    //   signatureScript stripped for sighash compute, scriptSig set on signedTx only.
    let unsignedTx;
    if (txObjPreimage) {
      const parsed = JSON.parse(JSON.stringify(txObjPreimage));
      parsed.lockTime = txLockTime;
      parsed.gas = BigInt(parsed.gas || 0);
      parsed.inputs = parsed.inputs.map(inp => ({
        ...inp,
        signatureScript: '',
        sequence: BigInt(inp.sequence || 0),
        sigOpCount: 1,
        utxo: inp.utxo ? {
          ...inp.utxo,
          amount: BigInt(inp.utxo.amount || 0),
          blockDaaScore: BigInt(inp.utxo.blockDaaScore || 0),
        } : undefined,
      }));
      parsed.outputs = parsed.outputs.map(o => ({ ...o, value: BigInt(o.value || 0) }));
      unsignedTx = new Transaction(parsed);
    } else {
      const inputs = [{
        previousOutpoint: { transactionId: matched[0].outpoint.transactionId, index: matched[0].outpoint.index },
        signatureScript: '',
        sequence: 0n,
        sigOpCount: 1,
        utxo: matched[0],
      }];
      if (feeEntry) {
        inputs.push({
          previousOutpoint: { transactionId: feeEntry.outpoint.transactionId, index: feeEntry.outpoint.index },
          signatureScript: '',
          sequence: 0n,
          sigOpCount: 1,
          utxo: feeEntry,
        });
      }
      unsignedTx = new Transaction({
        version: 0,
        inputs,
        outputs: [new TransactionOutput(outAmount, outSpk)],
        lockTime: txLockTime,
        gas: 0n,
        subnetworkId: '0000000000000000000000000000000000000000',
        payload: '',
      });
    }

    // Bettor single-sig (= PoolSide_v07.sil L271 require(checkSig(bettorSig, pubkey(bettorPk)))).
    const bettorSigHex = createInputSignature(unsignedTx, 0, wallet.getPrivateKey(), SighashType.All);

    // scriptSig: [bettorSig push] + selector OP (= entry index) + [redeemScript push].
    // J2-tn r391: entryIndex param decides selector — OP_2='52' for v06/v07, OP_3='53' for legacy v0.5.
    const sideRedeemBytes = Buffer.from(sideRedeemScriptHex, 'hex');
    const sideRedeemPushHex = _encodePushDataHex(sideRedeemBytes);
    if (entryIndex < 1 || entryIndex > 16) throw new Error(`entryIndex must be 1-16 (OP_N), got ${entryIndex}`);
    const selectorOpHex = (0x50 + entryIndex).toString(16).padStart(2, '0');
    const scriptSigHex = bettorSigHex + selectorOpHex + sideRedeemPushHex;

    const signedInputs = [{
      previousOutpoint: { transactionId: matched[0].outpoint.transactionId, index: matched[0].outpoint.index },
      signatureScript: scriptSigHex,
      sequence: 0n,
      sigOpCount: 1,
    }];
    if (feeEntry) {
      // P2PK fee-input: scriptSig = <sig push> only (no selector, no redeem).
      const feeSigHex = createInputSignature(unsignedTx, 1, wallet.getPrivateKey(), SighashType.All);
      signedInputs.push({
        previousOutpoint: { transactionId: feeEntry.outpoint.transactionId, index: feeEntry.outpoint.index },
        signatureScript: feeSigHex,
        sequence: 0n,
        sigOpCount: 1,
      });
    }

    const signedTx = new Transaction({
      version: 0,
      inputs: signedInputs,
      outputs: [new TransactionOutput(outAmount, outSpk)],
      lockTime: txLockTime,
      gas: 0n,
      subnetworkId: '0000000000000000000000000000000000000000',
      payload: '',
    });

    const assertUtxos = feeEntry ? [...matched, feeEntry] : matched;
    _assertTxInvariants(assertUtxos, signedTx, 'unlockPoolSideRefundCancelled', networkId);
    const result = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: result.transactionId };
  } finally {
    try { await rpc.disconnect(); } catch {}
  }
}

// ── 8. checkUtxoLanded (B2 v0.5 Phase 3 bug 7 fix) ──

/**
 * Check whether a transfer's UTXO actually landed at the target address in the accepted UTXO set.
 *
 * Bug 7: a TX can be mempool-accepted (submitTransaction returns a txId) yet lose a
 * double-spend race → is_accepted=false → no UTXO. Callers that record success on the
 * returned txId alone violate "NO TX NO STATE CHANGE". This confirms the UTXO is real.
 *
 * ★ reorg-safe confirmation depth (J1, 2026-06-30 phantom-leaf 根治): first-seen UTXO can be
 *   shallow (depth-0/1) then removed by a reorg → caller (register_append land-gate) records a
 *   phantom leaf outpoint → later settle "consolidate UTXO not found" (hcxu3/clycz 2 实例). TN12
 *   实测 (Bettor): reorg ~26% 恒常但 always depth=1. Gate: require DAA-depth
 *   = virtualDaaScore − utxoEntry.blockDaaScore ≥ minDepth (默认 20 = 20× 实测 max·~2.5s@8BPS).
 *   minDepth=0 → legacy first-seen (backward-compat·其余 caller 不传则不变). fail-closed: blockDaaScore
 *   缺失/depth<minDepth → landed:false (浅确认不放行·NO-TX-NO-STATE·不记 phantom).
 *
 * @param {string} address - target address (P2SH or P2PK) the transfer paid to
 * @param {string} txid - the transfer TX id
 * @param {string} networkId
 * @param {number} [minDepth=0] - min DAA-depth (virtualDaaScore − blockDaaScore) to count as landed
 * @returns {Promise<{ landed: boolean, depth?: number|null }>}
 */
export async function checkUtxoLanded(address, txid, networkId, minDepth = 0) {
  const rpc = await connectRpc(networkId);
  try {
    const { entries } = await rpc.getUtxosByAddresses([address]);
    const entry = (entries || []).find(e => e.outpoint?.transactionId === txid);
    if (!entry) return { landed: false };
    if (!(Number(minDepth) > 0)) return { landed: true };           // legacy first-seen (minDepth 0/未传)
    // ⚠ 字段路径(Bettor BLOCKING 抓·我活对象实测纠 + 用既有生产惯用法 trade-protocol-filter.js L1097 的 4 级 fallback·
    //   别自创单路径赌 wasm 序列化形态: kaspa-wasm UTXO entry 上 utxoEntry getter 不存在(=undefined)·blockDaaScore
    //   在顶层 e.blockDaaScore·实测 BigInt; 原 e.utxoEntry?.blockDaaScore=undefined→fail-closed→全 register 崩):
    const bds = entry.blockDaaScore ?? entry.utxoEntry?.blockDaaScore ?? entry.entry?.blockDaaScore ?? entry.entry?.utxoEntry?.blockDaaScore;
    if (bds == null) return { landed: false, depth: null };         // fail-closed: 无 blockDaaScore 无法验深度
    const dag = await rpc.getBlockDagInfo();
    const depth = Number(dag.virtualDaaScore) - Number(bds);
    // 浅确认 (depth < minDepth) = 可能被 reorg 退 → 尚未 landed (caller poll loop 继续等深确认)
    return depth >= Number(minDepth) ? { landed: true, depth } : { landed: false, depth };
  } finally {
    try { await rpc.disconnect(); } catch {}
  }
}

// ── 9. bshard M3 fold-carries-KAS relay handlers (J1, 2026-06-15) ──
//
// e2e-blocker 补齐: builders 产 command(action=bshard_register_bet/claim_winner/refund_cancelled), 本组 unlock 函数
//   在 relay build+sign+broadcast。承重正确性:
//   • selector(ABI 实查, 4-vantage): register_append=OP_0 / claim_draw=OP_4 / refund_draw=OP_5
//     (covenant fold 占 __leader_fold[1]/__delegate_fold[2] 2 ABI 槽 → close/claim/refund 挤到 3/4/5).
//   • witness scriptSig push 序 = SS entrypoint 声明序 forward + selector + redeem reveal.
//   • witness int = CScriptNum 最小(OP_N ≤16 / minimal LE 大); State 区(splice 用)= 固定 PUSH8(0x08)+i64-LE 8B.
//   • 续约地址 PER-STATE: relay splice input redeem[start : start+len]→new-state → payToScriptHash.
//     validateOutputState 绑此 per-state P2SH(TUTORIAL L1000 + WithTemplate 类比)→ 续约不可重定向(算错=SS 拒, 不丢钱).
//
// ── route-split (2026-06-15): unified PoolShard_fold 拆 PoolLeaf + PoolRoot (script-unit 9999 限, 见 PoolLeaf.sil 头注) ──
//   • PoolLeaf (4-field state {local_yes,local_no,count,pool_value}, state_layout{start:1,len:36}):
//       register_append=OP_0 / __leader_fold=OP_1 / __delegate_fold=OP_2 / seal_to_root=OP_3.
//   • PoolRoot (7-field state, state_layout{start:1,len:87}): close_commit=OP_0 / claim_draw=OP_1 / refund_draw=OP_2.
//   • leaf→root 经 seal_to_root foreign-template 桥 (root addr = payToScriptHash(root_prefix‖serialize(7-field sealed)‖root_suffix)).
//   ⚠ 选择子变化 vs unified: close/claim/refund OP_3/4/5 → OP_0/1/2 (root 无 covenant fold 槽). silverc artifact.abi 实查.

const _POOL_STATE_START = 1;       // state_layout.start (leaf+root 同)
const _LEAF_STATE_LEN = 36;        // PoolLeaf state_layout.len = 4×(PUSH8+8)
const _ROOT_STATE_LEN = 87;        // PoolRoot state_layout.len = 6×(PUSH8+8) + (PUSH32+32)
const _ROOTCLAIM_STATE_LEN = 96;   // RootClaim 8-field (R7 nullifier): _ROOT_STATE_LEN 87 + claimed_bitmap (PUSH8+8) (KANet-UI 2026-06-20)
const _PAYOUTSHARD_STATE_LEN = 204; // (A) depth-10 PayoutShard: consolidated_pool+closed (2×9) + payoutRoot (PUSH32+32=33) + w0..w16 (17×9=153) = 204 (J2 2026-06-21 depth-10 sync; 旧 depth-8=96 已 superseded)
// W2 (J2 2026-07-07): PayoutShardV2 state = _PAYOUTSHARD_STATE_LEN(204) + attestedWinner(9) + attestedAtMs(9) + betsRootBaked(33) + refundRootBaked(33) = 288.
//   声明序(PayoutShardV2.sil): consolidated_pool, closed, payoutRoot, w0..w16, attestedWinner, attestedAtMs, betsRootBaked, refundRootBaked.
//   跟 console 侧 bshard-close-enforce.mjs _splicePayoutV2CloseRedeem 同一套字节偏移(NWT 2026-07-07 review 独立核实过·D2 铁律 byte-exact)。
const _PAYOUTSHARDV2_STATE_LEN = 288;

// ⚠ landmine 修正(NWT 2026-07-07 实测坐实+紧急抓漏): 真 silverc/rusty-kaspa byte[](int,size) 对负数用
// sign-magnitude(同 pool-payout-root.mjs serializeI64, self-test 7/7 验证 -1→0100000000000080), 不是两补数。
// PayoutShardV2 absorb 透传 attestedWinner(genesis 占位符 -1, 未 attest 前恒负) 是真实调用点——"负数直接 throw"这个
// 防御反而会让 absorb 崩溃, 必须真支持负数(固定 8B, magnitude 直填 + sign bit 落 byte[7], 同 console 侧实现)。
function _i64LE(v) {               // BigInt/number → 8-byte LE Buffer (固定 i64, 非最小; sign-magnitude)
  const n = BigInt(v);
  const neg = n < 0n;
  let mag = neg ? -n : n;
  const MAX_MAG = 1n << 63n;
  if (mag >= MAX_MAG) throw new Error(`_i64LE: magnitude(${mag}) 超出 sign-magnitude 8B 可表示范围(需 < 2^63)`);
  const b = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) { b[i] = Number(mag & 0xffn); mag >>= 8n; }
  if (neg) b[7] |= 0x80;
  return b;
}

// CScriptNum 最小编码 (witness int args). 0→OP_0('00'); 1-16→OP_N(0x50+n); else minimal LE + sign byte → push.
function _encodeScriptNumPush(val) {
  let v = BigInt(val);
  if (v === 0n) return '00';
  const neg = v < 0n; if (neg) v = -v;
  const bytes = [];
  while (v > 0n) { bytes.push(Number(v & 0xffn)); v >>= 8n; }
  if (bytes[bytes.length - 1] & 0x80) bytes.push(neg ? 0x80 : 0x00);
  else if (neg) bytes[bytes.length - 1] |= 0x80;
  return _encodePushDataHex(Buffer.from(bytes));
}
function _pushInt(n) {
  const v = BigInt(n);
  if (v === 0n) return '00';
  if (v >= 1n && v <= 16n) return (0x50 + Number(v)).toString(16).padStart(2, '0');  // OP_1..OP_16
  return _encodeScriptNumPush(v);
}
function _pushBytes(hexOrBuf) {
  const buf = Buffer.isBuffer(hexOrBuf) ? hexOrBuf : Buffer.from(hexOrBuf, 'hex');
  return _encodePushDataHex(buf);
}

// 序列化 PoolLeaf 4-field State → 36B hex (固定 PUSH8, State 声明序 {local_yes,local_no,count,pool_value}).
function _serializeLeafStateHex(s) {
  return _encodePushDataHex(_i64LE(s.local_yes))
    + _encodePushDataHex(_i64LE(s.local_no))
    + _encodePushDataHex(_i64LE(s.count))
    + _encodePushDataHex(_i64LE(s.pool_value));
}

// 序列化 PoolRoot 7-field State → 87B hex (固定 PUSH8/PUSH32, State 声明序). NWT 2-impl byte-match 此格式.
function _serializeRootStateHex(s) {
  let out = _encodePushDataHex(_i64LE(s.local_yes))
    + _encodePushDataHex(_i64LE(s.local_no))
    + _encodePushDataHex(_i64LE(s.count))
    + _encodePushDataHex(_i64LE(s.pool_value))
    + _encodePushDataHex(_i64LE(s.closed))
    + _encodePushDataHex(_i64LE(s.winningSide))
    + _encodePushDataHex(Buffer.from(s.payoutRoot.replace(/^0x/, ''), 'hex'));   // PUSH32 + 32B
  // 8-field RootClaim (R7 nullifier claimed_bitmap, State 声明序末位): convert_to_claim 目标. 7-field RootClose/PoolRoot 无 (backward-compat). (KANet-UI 2026-06-20)
  if (s.claimed_bitmap !== undefined && s.claimed_bitmap !== null) out += _encodePushDataHex(_i64LE(s.claimed_bitmap));
  return out;
}

// PayoutShard (A) 8-field state serializer (声明序: consolidated_pool, closed, payoutRoot, w0..w4). continuation 续约地址 splice 用。
// absorb/close_attest/claim 的 validateOutputState 续锁此布局; genesis init_consolidated_pool==seed value(state==UTXO value 不变量)。
const _NULLIFIER_WORDS = 17;   // depth-10 PayoutShard: 17-word nullifier (w0..w16, 17×63=1071 ≥ 1024 winner). depth-8 旧版=5-word(已 superseded)。
// 从 state 拷贝 17 个 nullifier word(缺省 0)→ newState 构造复用, 防漏 word(NWT 全字段必列警告)。
function _nw17(s) { const o = {}; for (let i = 0; i < _NULLIFIER_WORDS; i++) o['w' + i] = (s && s['w' + i] != null) ? s['w' + i] : 0; return o; }
function _serializePayoutStateHex(s) {
  let h = _encodePushDataHex(_i64LE(s.consolidated_pool))
    + _encodePushDataHex(_i64LE(s.closed))
    + _encodePushDataHex(Buffer.from(String(s.payoutRoot).replace(/^0x/, ''), 'hex'));   // PUSH32 + 32B
  for (let i = 0; i < _NULLIFIER_WORDS; i++) h += _encodePushDataHex(_i64LE(s['w' + i] ?? 0));   // w0..w16
  return h;
}

// W2: PayoutShardV2 state serializer (8 字段, 声明序见上方 _PAYOUTSHARDV2_STATE_LEN 注释)。V1 _serializePayoutStateHex
//   本体不动(single-author V1/V2 分离哲学, 同 PayoutShard.sil/PayoutShardV2.sil 全拷贝手法) — 独立函数, 不共用/不改共享代码。
// test-only export (byte-exact cross-check vs console 侧 bshard-close-enforce.mjs _splicePayoutV2CloseRedeem)。
export function _serializePayoutV2StateHex(s) {
  let h = _encodePushDataHex(_i64LE(s.consolidated_pool))
    + _encodePushDataHex(_i64LE(s.closed))
    + _encodePushDataHex(Buffer.from(String(s.payoutRoot).replace(/^0x/, ''), 'hex'));
  for (let i = 0; i < _NULLIFIER_WORDS; i++) h += _encodePushDataHex(_i64LE(s['w' + i] ?? 0));
  h += _encodePushDataHex(_i64LE(s.attestedWinner))
    + _encodePushDataHex(_i64LE(s.attestedAtMs))
    + _encodePushDataHex(Buffer.from(String(s.betsRootBaked).replace(/^0x/, ''), 'hex'))
    + _encodePushDataHex(Buffer.from(String(s.refundRootBaked).replace(/^0x/, ''), 'hex'));
  return h;
}

// W2: PayoutShardV2 续约地址 — 镜像 _continuationAddress splice 逻辑, 独立函数(专认 _PAYOUTSHARDV2_STATE_LEN, 不碰
//   V1 allowlist/共享函数体, 避免任何跨版本回归风险)。
export function _continuationAddressV2(inputRedeemHex, newStateHex, networkId, stateStart = _POOL_STATE_START) {
  const redeem = Buffer.from(inputRedeemHex, 'hex');
  const stateBytes = Buffer.from(newStateHex, 'hex');
  if (stateBytes.length !== _PAYOUTSHARDV2_STATE_LEN) {
    throw new Error(`PayoutShardV2 state ser ${stateBytes.length}B != 期望 ${_PAYOUTSHARDV2_STATE_LEN}B`);
  }
  const len = stateBytes.length;
  const spliced = Buffer.concat([redeem.slice(0, stateStart), stateBytes, redeem.slice(stateStart + len)]);
  const spk = payToScriptHashScript(new Uint8Array(spliced));
  return addressFromScriptPublicKey(spk, networkId).toString();
}

// per-state 续约 P2SH 地址: splice input redeem 的 state 区[start : start+len] → new state → payToScriptHash.
//   len = newStateHex 字节数 (leaf 36 / root 87 自适应; new state 与 baked genesis state 同布局=同长).
// stateStart: state 区在 redeem 的起始 offset. 多-entry(PoolLeaf/PoolRoot/RootClose)有 selector dispatch 前导 → state_layout.start=1(_POOL_STATE_START 默认);
//   单-entry no-selector(RootClaim/RefundClaim)无前导 → start=0. caller 经 cmd 传合约 state_layout.start, 别硬编 (KANet-UI 2026-06-20, J2/J1/NWT 三方诊断 continuation offset bug).
function _continuationAddress(inputRedeemHex, newStateHex, networkId, stateStart = _POOL_STATE_START) {
  const redeem = Buffer.from(inputRedeemHex, 'hex');
  const stateBytes = Buffer.from(newStateHex, 'hex');
  if (![_LEAF_STATE_LEN, _ROOT_STATE_LEN, _ROOTCLAIM_STATE_LEN, _PAYOUTSHARD_STATE_LEN].includes(stateBytes.length)) {
    throw new Error(`pool state ser ${stateBytes.length}B != leaf ${_LEAF_STATE_LEN} / root ${_ROOT_STATE_LEN} / rootclaim ${_ROOTCLAIM_STATE_LEN} / payoutshard ${_PAYOUTSHARD_STATE_LEN}`);
  }
  const len = stateBytes.length;
  const spliced = Buffer.concat([redeem.slice(0, stateStart), stateBytes, redeem.slice(stateStart + len)]);
  const spk = payToScriptHashScript(new Uint8Array(spliced));
  return addressFromScriptPublicKey(spk, networkId).toString();
}

// foreign-template 地址 (seal_to_root 产 PoolRoot): root_prefix ‖ serialize(7-field sealed state) ‖ root_suffix → payToScriptHash.
//   = SS seal_to_root 内 validateOutputStateWithTemplate 的 P2SH 派生口径 (blake2b(prefix‖state‖suffix)).
function _foreignTemplateAddress(prefixHex, rootStateHex, suffixHex, networkId) {
  const redeem = Buffer.concat([
    Buffer.from(prefixHex, 'hex'), Buffer.from(rootStateHex, 'hex'), Buffer.from(suffixHex, 'hex'),
  ]);
  const spk = payToScriptHashScript(new Uint8Array(redeem));
  return addressFromScriptPublicKey(spk, networkId).toString();
}

// dust PoolSide-ticket 地址: ps_prefix ‖ serialize(ticketState 4-field) ‖ ps_suffix → payToScriptHash.
//   ticket State = {bettorPk(32), direction(int), stake(int), shardPoolId(32)} → PUSH32+PUSH8+PUSH8+PUSH32.
function _ticketAddress(psPrefixHex, psSuffixHex, ticket, networkId) {
  const stateHex = _pushBytes(ticket.bettorPk) + _encodePushDataHex(_i64LE(ticket.direction))
    + _encodePushDataHex(_i64LE(ticket.stake)) + _pushBytes(ticket.shardPoolId);
  const redeem = Buffer.concat([Buffer.from(psPrefixHex, 'hex'), Buffer.from(stateHex, 'hex'), Buffer.from(psSuffixHex, 'hex')]);
  const spk = payToScriptHashScript(new Uint8Array(redeem));
  return addressFromScriptPublicKey(spk, networkId).toString();
}

// P2SH input 地址 = payToScriptHash(完整 redeem_hex)(redeem 含当前 state, 是 ground-truth; 无需 current_state/.address).
function _addressFromRedeem(redeemHex, networkId) {
  const spk = payToScriptHashScript(new Uint8Array(Buffer.from(redeemHex, 'hex')));
  return addressFromScriptPublicKey(spk, networkId).toString();
}

const _BSHARD_MINER_FEE = 10000n;   // 0.0001 KAS, within SS fee 范围 [1000, 1e8] (legacy v0 path)
// ── SIZE re-frame (2026-06-20, 链上裁实 aa4d1c10): 9999 script-units = FREE-tier 非硬墙. ──
// v1 (TX_VERSION_TOCCATA) tx 每 input 声明 compute_budget(u16)买 script-units: allowed = budget×10000 + 9999.
// bshard 重 blake2b 合约(register ~13738u / convert ~11242u / PayoutShard(A) ~11765u / P2PK checksig=100000u)
// 全 < flat budget=50 (allowed 509999, 在 ~500k mass cap 内). 详 [[feedback-spend-units-must-be-probed-not-modeled]].
const _BSHARD_COMPUTE_BUDGET = 70;    // flat (Bettor 批: 简单+headroom). 70=allowed 709999 units (mass 7000 grams/input << ~500k mass cap). close_attest(5 checkSig+40 merkle blake2b+validateOutputState 4448B+10 pairwise !=)=510026u > budget=50(509999)→bump 70. (后续 per-contract 精算省 mass)
// budget-aware fee: aa4d1c10 实测 budget=60/1-input/fee 0.01KAS LAND → ~0.01KAS(1e6 sompi)/input headroom.
// _assertTxInvariants mass-aware floor 兜底(fee 不足 pre-submit 拒, 非链上失败).
const _BSHARD_FEE_PER_INPUT = 1_000_000n;   // 0.01 KAS/input, 覆盖 budget=50 的 compute mass floor
function _bshardFeeV1(numInputs) { const f = BigInt(numInputs) * _BSHARD_FEE_PER_INPUT; return f > _BSHARD_MINER_FEE ? f : _BSHARD_MINER_FEE; }
// v1 bshard tx: version=1, 所有 input sigOpCount=0(ComputeCommit 用 compute_budget 非 SigopCount), 每 input computeBudget=_BSHARD_COMPUTE_BUDGET.
function _utxoValue(u) { return BigInt(u.amount ?? u.utxoEntry?.amount ?? u.entry?.amount ?? 0); }
// relay 算 change(Bettor 裁: relay fetch UTXO 后才知真 Σinput+fee): change = Σin − Σ业务out − minerFee.
function _appendChange(orderedOut, matched, changeAddress, fee = _BSHARD_MINER_FEE) {
  const sumIn = matched.reduce((a, u) => a + _utxoValue(u), 0n);
  const sumOut = orderedOut.reduce((a, o) => a + BigInt(o.value), 0n);
  const change = sumIn - sumOut - fee;
  if (change < 0n) throw new Error(`bshard insufficient input: Σin ${sumIn} < Σout ${sumOut} + fee ${fee}`);
  if (change >= 1000n && changeAddress) orderedOut.push(new TransactionOutput(change, payToAddressScript(new Address(changeAddress))));
  return orderedOut;
}

// ── bshard (A) cov_id provenance: PayoutShard covenant lifecycle (genesis-mint + continuation) ──
// 读 PayoutShard input UTXO 的 cov_id(consensus metadata; UtxoEntry.covenantId)。continuation handler 用它设 output CovenantBinding。
function _psInputCovId(psUtxo) {
  const c = psUtxo.entry?.covenantId ?? psUtxo.covenant?.covenantId ?? psUtxo.covenantId;
  if (c == null) throw new Error('PayoutShard input 无 cov_id(非 covenant UTXO?genesis-mint 漏 CovenantBinding)');
  return String(c);
}

/**
 * unlockBshardGenesisMintPayout — market 创建铸【空 PayoutShard covenant 实例】(cov_id≠0, A-path consolidation provenance 锚)。
 * 输入: 普通 funding UTXO(relay wallet P2PK)。输出[0]: PayoutShard genesis P2SH(空 state: consolidated_pool=0/closed=0/payoutRoot=0/w=0)
 *   带 CovenantBinding(genesis case, populateGenesisCovenants)→ consensus 重算赋 cov_id = covenant_id(funding.outpoint,[psOut])。
 * 返回 payoutCovId 供 ShardLeaf ctor bake(destination provenance-bind)。机制链上验: d7c0bacc(genesis)+ bf389372(continuation 保持)。
 * v1 tx(TX_VERSION_TOCCATA, covenant output 必需)+ compute_budget(P2PK checksig 100000u 覆盖)。
 * ⚠ CROSS-LAYER 命门(J1 钉, 否则第1个 consolidate BUST): caller 必【编 PayoutShard redeem 时 init_consolidated_pool == seedSompi】(state==UTXO value 不变量从 genesis 成立)。
 *   因 consolidate weld out==in[ps].value+pool_value 同时 absorb weld out==consolidated_pool+pool_value ⟺ in[ps].value==consolidated_pool。seed D 成池里一颗 dust 种子。
 */
export async function unlockBshardGenesisMintPayout(args) {
  const { wallet, cmd, networkId, lockTime = 0n } = args;
  const rpc = await connectRpc(networkId);
  try {
    const f = cmd.inputs.funding;
    const fundUtxo = await _matchUtxo(rpc, f.address, f.outpointTxid, f.index);
    const psAddr = _addressFromRedeem(cmd.payoutshard.redeem_hex, networkId);   // PayoutShard genesis P2SH = hash(redeem)
    const psSeed = BigInt(cmd.payoutshard.seedSompi);                            // genesis PS UTXO 种子 value(dust 之上; absorb 累加真池钱)
    const fee = _bshardFeeV1(1);
    if (_utxoValue(fundUtxo) - psSeed - fee < 0n) throw new Error(`genesis-mint insufficient: Σin ${_utxoValue(fundUtxo)} < seed ${psSeed} + fee ${fee}`);
    const change = _utxoValue(fundUtxo) - psSeed - fee;
    const outputs = [new TransactionOutput(psSeed, payToAddressScript(new Address(psAddr)))];
    if (change >= 1000n && cmd.outputs?.change_address) outputs.push(new TransactionOutput(change, payToAddressScript(new Address(cmd.outputs.change_address))));
    // populateGenesisCovenants: PS output[0] 由 funding input[0] 授权创世 → consensus 重算验 cov_id。先于签名(v1 sighash 含 covenant)。
    const mk = (ss) => {
      const t = new Transaction({
        version: 1,
        inputs: [{ previousOutpoint: { transactionId: fundUtxo.outpoint.transactionId, index: fundUtxo.outpoint.index }, signatureScript: ss, sequence: 0n, sigOpCount: 0, computeBudget: _BSHARD_COMPUTE_BUDGET, ...(ss === '' ? { utxo: fundUtxo } : {}) }],
        outputs, lockTime: BigInt(lockTime), gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
      });
      t.populateGenesisCovenants([new GenesisCovenantGroup(0, [0])]);
      return t;
    };
    const payoutCovId = String(mk('').outputs[0].covenant.covenantId);
    const sigHex = createInputSignature(mk(''), 0, wallet.getPrivateKey(), SighashType.All);
    const signedTx = mk(sigHex);
    _assertTxInvariants([fundUtxo], signedTx, 'unlockBshardGenesisMintPayout', networkId);
    const r = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: r.transactionId, payoutCovId, psAddress: psAddr, psSeedSompi: psSeed.toString() };
  } finally { try { await rpc.disconnect(); } catch {} }
}

/**
 * unlockBshardConsolidate — 关池后单片全额归集进真 PayoutShard covenant (cov_id provenance destination-bind)。
 * tx: in=[PS@0(absorb OP_0), SL@1(consolidate_to_payout OP_1), fee@2] → out=[PS_continuation@0(cov_id 续), change]。
 *   • PS@0 absorb(selfOutIdx=0, shardInIdx=1): credit SL UTXO 真 value(register-welded pool_value)+ validateOutputState 续 cov_id。
 *   • SL@1 consolidate_to_payout(psInIdx=0, psOutIdx=0): OpInputCovenantId(0)==payout_cov_id + OpCovOutputCount>=1 + OpOutputCovenantId(0)==payout_cov_id + out==in+pool_value 全额。
 *   • relay 设 out[0] CovenantBinding(authInput=0, covId=PS@0 cov_id)→ continuation 续 cov_id(链上验 bf389372)。
 * ⚠ fee 必独立 input(PS+SL value 全 weld 进 continuation, 无余付 miner fee)。state==value 不变量(genesis init_consolidated_pool==seed)维持。
 * ⚠ ≥2 consolidate 连续测 lifecycle 断点(relay 漏续 CovenantBinding 在第2片 BUST = NWT e2e 硬条件)。
 */
export async function unlockBshardConsolidate(args) {
  const { wallet, cmd, networkId, lockTime = 0n } = args;
  const rpc = await connectRpc(networkId);
  try {
    const psUtxo = await _matchUtxo(rpc, _addressFromRedeem(cmd.inputs.payoutshard.redeem_hex, networkId), cmd.inputs.payoutshard.outpointTxid, cmd.inputs.payoutshard.index);
    const slUtxo = await _matchUtxo(rpc, _addressFromRedeem(cmd.inputs.shardleaf.redeem_hex, networkId), cmd.inputs.shardleaf.outpointTxid);
    if (!cmd.inputs.fee) throw new Error('consolidate: fee input 必需 (PS+SL value 全 weld 进 continuation 无余付 fee)');
    const feeUtxo = await _matchUtxo(rpc, cmd.inputs.fee.address, cmd.inputs.fee.outpointTxid, cmd.inputs.fee.index);
    const matched = [psUtxo, slUtxo, feeUtxo];
    const psCovId = _psInputCovId(psUtxo);

    const poolValue = BigInt(cmd.inputs.shardleaf.pool_value);          // SL register-welded pool_value (== slUtxo value)
    const ps = cmd.inputs.payoutshard.state;                           // 当前 PS state {consolidated_pool, closed, payoutRoot, w0..4}
    const newConsolidated = BigInt(ps.consolidated_pool) + poolValue;
    const newState = { consolidated_pool: newConsolidated.toString(), closed: ps.closed, payoutRoot: ps.payoutRoot, ..._nw17(ps) };   // 17-word nullifier 透传(consolidate 不动 nullifier)
    const psContAddr = _continuationAddress(cmd.inputs.payoutshard.redeem_hex, _serializePayoutStateHex(newState), networkId, cmd.inputs.payoutshard.state_start ?? _POOL_STATE_START);
    let psOutValue = _utxoValue(psUtxo) + poolValue;                   // 双 weld: absorb(out==consolidated_pool+pool_value) ∧ consolidate(out==in[ps].value+pool_value); 不变量 in[ps].value==consolidated_pool 使两式一致
    // 🔬 forge② skim-teeth(cmd.forge_skim 仅测; off by default, driver 控): 故意少付 skim 量到 PS 续约 → 合约 ShardLeaf require(out==in+pool_value)/PS absorb 守恒应 BUST(测守恒 weld 的 skim-BUST 方向)。
    if (cmd.forge_skim) { const skim = BigInt(cmd.forge_skim); psOutValue = psOutValue - skim; console.error(`[FORGE_SKIM] psOutValue 少付 ${skim} → 期望合约守恒 BUST`); }

    // out[0] = PS continuation (cov_id 续约, relay 设 CovenantBinding); 然后 change (来自 fee input)
    const outputs = [new TransactionOutput(psOutValue, payToAddressScript(new Address(psContAddr)), new CovenantBinding(0, new Hash(psCovId)))];
    _appendChange(outputs, matched, cmd.outputs?.change_address, _bshardFeeV1(matched.length));

    // no-sig scriptSig: PS@0 absorb [selfOutIdx=0, shardInIdx=1] OP_0; SL@1 consolidate [psInIdx=0, psOutIdx=0] OP_1
    const psSig = _pushInt(0) + _pushInt(1) + '00' + _encodePushDataHex(Buffer.from(cmd.inputs.payoutshard.redeem_hex, 'hex'));
    const slSig = _pushInt(0) + _pushInt(0) + '51' + _encodePushDataHex(Buffer.from(cmd.inputs.shardleaf.redeem_hex, 'hex'));

    const baseIn = (ss) => matched.map((u, i) => ({ previousOutpoint: { transactionId: u.outpoint.transactionId, index: u.outpoint.index }, signatureScript: ss[i], sequence: 0n, sigOpCount: 0, computeBudget: _BSHARD_COMPUTE_BUDGET, ...(ss[i] === '' ? { utxo: u } : {}) }));
    const unsigned = new Transaction({ version: 1, inputs: matched.map(u => ({ previousOutpoint: { transactionId: u.outpoint.transactionId, index: u.outpoint.index }, signatureScript: '', sequence: 0n, sigOpCount: 0, computeBudget: _BSHARD_COMPUTE_BUDGET, utxo: u })), outputs, lockTime: BigInt(lockTime), gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
    const sigs = [psSig, slSig, createInputSignature(unsigned, 2, wallet.getPrivateKey(), SighashType.All)];
    const signedTx = new Transaction({ version: 1, inputs: baseIn(sigs), outputs, lockTime: BigInt(lockTime), gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
    _assertTxInvariants(matched, signedTx, 'unlockBshardConsolidate', networkId);
    const r = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: r.transactionId, psContAddress: psContAddr, newConsolidatedPool: newConsolidated.toString(), psSeedCovId: psCovId };
  } finally { try { await rpc.disconnect(); } catch {} }
}

/**
 * unlockBshardConsolidateV2 — PayoutShardV2(ZK-native) absorb OP_0 + SL consolidate_to_payout OP_1 (W2, J2 2026-07-07)。
 * ★ 镜像 unlockBshardConsolidate byte-identical 结构(PayoutShardV2.sil 头注释②: "absorb 逻辑一字不动, 仅
 *   validateOutputState 补齐新增4字段透传")——差异仅 state 用 _serializePayoutV2StateHex/_continuationAddressV2。
 *   ShardLeaf.sil 侧完全不碰(redeem hex 原样读取, 零 recompile, 跟 V1 一样的读法, D-005 隔离铁律遵守)。
 * ⚠ 不改 unlockBshardConsolidate 一字(single-author 分离, 同 close_attest V2 拆分哲学)。
 */
export async function unlockBshardConsolidateV2(args) {
  const { wallet, cmd, networkId, lockTime = 0n } = args;
  const rpc = await connectRpc(networkId);
  try {
    const psUtxo = await _matchUtxo(rpc, _addressFromRedeem(cmd.inputs.payoutshard.redeem_hex, networkId), cmd.inputs.payoutshard.outpointTxid, cmd.inputs.payoutshard.index);
    const slUtxo = await _matchUtxo(rpc, _addressFromRedeem(cmd.inputs.shardleaf.redeem_hex, networkId), cmd.inputs.shardleaf.outpointTxid);
    if (!cmd.inputs.fee) throw new Error('consolidate_v2: fee input 必需 (PS+SL value 全 weld 进 continuation 无余付 fee)');
    const feeUtxo = await _matchUtxo(rpc, cmd.inputs.fee.address, cmd.inputs.fee.outpointTxid, cmd.inputs.fee.index);
    const matched = [psUtxo, slUtxo, feeUtxo];
    const psCovId = _psInputCovId(psUtxo);

    const poolValue = BigInt(cmd.inputs.shardleaf.pool_value);
    const ps = cmd.inputs.payoutshard.state;   // {consolidated_pool, closed, payoutRoot, w0..w16, attestedWinner, attestedAtMs, betsRootBaked, refundRootBaked}
    const newConsolidated = BigInt(ps.consolidated_pool) + poolValue;
    // absorb 逻辑一字不动: closed/payoutRoot/w0-w16/attestedWinner/attestedAtMs/betsRootBaked/refundRootBaked 全透传不变,
    // 只有 consolidated_pool 变(+poolValue)。
    const newState = {
      consolidated_pool: newConsolidated.toString(), closed: ps.closed, payoutRoot: ps.payoutRoot, ..._nw17(ps),
      attestedWinner: ps.attestedWinner, attestedAtMs: ps.attestedAtMs, betsRootBaked: ps.betsRootBaked, refundRootBaked: ps.refundRootBaked,
    };
    const psContAddr = _continuationAddressV2(cmd.inputs.payoutshard.redeem_hex, _serializePayoutV2StateHex(newState), networkId, cmd.inputs.payoutshard.state_start ?? _POOL_STATE_START);
    let psOutValue = _utxoValue(psUtxo) + poolValue;
    if (cmd.forge_skim) { const skim = BigInt(cmd.forge_skim); psOutValue = psOutValue - skim; console.error(`[FORGE_SKIM] psOutValue 少付 ${skim} → 期望合约守恒 BUST`); }

    const outputs = [new TransactionOutput(psOutValue, payToAddressScript(new Address(psContAddr)), new CovenantBinding(0, new Hash(psCovId)))];
    _appendChange(outputs, matched, cmd.outputs?.change_address, _bshardFeeV1(matched.length));

    // no-sig scriptSig — 同 V1: PS@0 absorb [selfOutIdx=0, shardInIdx=1] OP_0; SL@1 consolidate [psInIdx=0, psOutIdx=0] OP_1
    //   (PayoutShardV2.sil absorb 形参跟 V1 一字不差: absorb(int selfOutIdx, int shardInIdx), ShardLeaf.sil 侧零改动)。
    const psSig = _pushInt(0) + _pushInt(1) + '00' + _encodePushDataHex(Buffer.from(cmd.inputs.payoutshard.redeem_hex, 'hex'));
    const slSig = _pushInt(0) + _pushInt(0) + '51' + _encodePushDataHex(Buffer.from(cmd.inputs.shardleaf.redeem_hex, 'hex'));

    const baseIn = (ss) => matched.map((u, i) => ({ previousOutpoint: { transactionId: u.outpoint.transactionId, index: u.outpoint.index }, signatureScript: ss[i], sequence: 0n, sigOpCount: 0, computeBudget: _BSHARD_COMPUTE_BUDGET, ...(ss[i] === '' ? { utxo: u } : {}) }));
    const unsigned = new Transaction({ version: 1, inputs: matched.map(u => ({ previousOutpoint: { transactionId: u.outpoint.transactionId, index: u.outpoint.index }, signatureScript: '', sequence: 0n, sigOpCount: 0, computeBudget: _BSHARD_COMPUTE_BUDGET, utxo: u })), outputs, lockTime: BigInt(lockTime), gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
    const sigs = [psSig, slSig, createInputSignature(unsigned, 2, wallet.getPrivateKey(), SighashType.All)];
    const signedTx = new Transaction({ version: 1, inputs: baseIn(sigs), outputs, lockTime: BigInt(lockTime), gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
    _assertTxInvariants(matched, signedTx, 'unlockBshardConsolidateV2', networkId);
    const r = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: r.transactionId, psContAddress: psContAddr, newConsolidatedPool: newConsolidated.toString(), psSeedCovId: psCovId };
  } finally { try { await rpc.disconnect(); } catch {} }
}

/**
 * unlockBshardPayoutClaim — winner 从 PayoutShard 派彩 (store-payout, claim OP_2)。
 * tx: in=[PS@0(claim OP_2), fee@1] → out=[payout→bettor P2PK@payout_out_idx, PS_continuation@self_out_idx(cov_id 续), change]。
 *   witness 声明序: [selfOutIdx, payoutOutIdx, bettorPk, payout, merkle_index, s0..s7(8 individual byte[32])] + OP_2 + redeem (no-sig)。
 *   🛡 proven-path 🅱(J1, 2026-06-20): siblings 改 8 个 individual byte[32] s0..s7 + 合约 manual unroll(删 byte[32][] array + 删 tree_depth)。
 *     根因: silverc byte[32][8] 固定数组 witness-ABI 把某 sibling 读成 int(Number-too-big), array-read 约定不可靠; close_attest 的 individual byte[32] c0s0..c4s7 同款已 LANDED 证 work。
 *   recipient-bind(合约 require): out[payoutOutIdx]=P2PK(bettorPk) value=payout(caller 供 payout_address=bettorPk 的地址)。
 *   nullifier: w[merkle_index/63] 置 bit(merkle_index%63)。守恒: out[self]==consolidated_pool-payout(不变量 value==consolidated_pool)。
 */
export async function unlockBshardPayoutClaim(args) {
  const { wallet, cmd, networkId, lockTime = 0n } = args;
  const w = cmd.witness;
  const rpc = await connectRpc(networkId);
  try {
    const psUtxo = await _matchUtxo(rpc, _addressFromRedeem(cmd.inputs.payoutshard.redeem_hex, networkId), cmd.inputs.payoutshard.outpointTxid, cmd.inputs.payoutshard.index);
    if (!cmd.inputs.fee) throw new Error('claim: fee input 必需 (PS value weld 进 continuation+payout)');
    const feeUtxo = await _matchUtxo(rpc, cmd.inputs.fee.address, cmd.inputs.fee.outpointTxid, cmd.inputs.fee.index);
    const matched = [psUtxo, feeUtxo];
    const psCovId = _psInputCovId(psUtxo);

    const payout = BigInt(w.payout);
    const ps = cmd.inputs.payoutshard.state;                          // {consolidated_pool, closed, payoutRoot, w0..16}
    // nullifier 置位: word_idx = merkle_index/63, bit_in = merkle_index%63, mask = 2^bit_in (匹配合约展开上界 63; 17-word w0..16 cap 1071≥1024)
    const idx = Number(w.merkle_index), wordIdx = Math.floor(idx / 63), bitIn = idx % 63;
    const nw = []; for (let i = 0; i < _NULLIFIER_WORDS; i++) nw.push(BigInt(ps['w' + i] ?? 0));
    // guard: merkle_index ≥ 1024(wordIdx ≥ 17 越界)时跳过 nullifier 更新 → tx 仍构造(merkle_index 进 witness)→ 提交 → 合约 require(merkle_index<1024) 链上 BUST(F4 aliasing 防护落在合约层非 handler 崩)。
    if (wordIdx < _NULLIFIER_WORDS) nw[wordIdx] = nw[wordIdx] + (1n << BigInt(bitIn));
    const newState = { consolidated_pool: (BigInt(ps.consolidated_pool) - payout).toString(), closed: ps.closed, payoutRoot: ps.payoutRoot, ..._nw17(ps) };
    for (let i = 0; i < _NULLIFIER_WORDS; i++) newState['w' + i] = nw[i].toString();
    const psContAddr = _continuationAddress(cmd.inputs.payoutshard.redeem_hex, _serializePayoutStateHex(newState), networkId, cmd.inputs.payoutshard.state_start ?? _POOL_STATE_START);
    const psOutValue = _utxoValue(psUtxo) - payout;                  // 守恒 weld: out[self]==consolidated_pool-payout (不变量 in[ps].value==consolidated_pool)

    const outputs = [];
    outputs[w.payout_out_idx] = new TransactionOutput(payout, payToAddressScript(new Address(cmd.outputs.payout.address)));   // recipient P2PK(bettorPk); caller 供 bettorPk 派生地址
    outputs[w.self_out_idx] = new TransactionOutput(psOutValue, payToAddressScript(new Address(psContAddr)), new CovenantBinding(0, new Hash(psCovId)));   // cov_id 续
    const orderedOut = outputs.filter(o => o !== undefined);
    _appendChange(orderedOut, matched, cmd.outputs?.change_address, _bshardFeeV1(matched.length));

    // PS@0 claim scriptSig (声明序) + OP_2 + redeem (no-sig)
    // 🛡 proven-path 🅱: s0..s7 = 8 个 individual byte[32] push(同 close_attest 委员 sibs, 已 LANDED 证 work), 删 tree_depth(合约 manual unroll 恒 8 步)。driver 必 pad siblings_hex 到 8。
    let sibPush = '';
    for (const s of w.siblings_hex) sibPush += _pushBytes(s);         // s0..s7 forward 序(individual byte[32], 非 array)
    const psSig = _pushInt(w.self_out_idx) + _pushInt(w.payout_out_idx) + _pushBytes(w.bettor_pk)
      + _pushInt(w.payout) + _pushInt(w.merkle_index) + sibPush
      + '52' + _encodePushDataHex(Buffer.from(cmd.inputs.payoutshard.redeem_hex, 'hex'));   // claim=OP_2='52'

    const unsigned = new Transaction({ version: 1, inputs: matched.map(u => ({ previousOutpoint: { transactionId: u.outpoint.transactionId, index: u.outpoint.index }, signatureScript: '', sequence: 0n, sigOpCount: 0, computeBudget: _BSHARD_COMPUTE_BUDGET, utxo: u })), outputs: orderedOut, lockTime: BigInt(lockTime), gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
    const feeSig = createInputSignature(unsigned, 1, wallet.getPrivateKey(), SighashType.All);
    const signedTx = new Transaction({ version: 1, inputs: [
      { previousOutpoint: { transactionId: psUtxo.outpoint.transactionId, index: psUtxo.outpoint.index }, signatureScript: psSig, sequence: 0n, sigOpCount: 0, computeBudget: _BSHARD_COMPUTE_BUDGET },
      { previousOutpoint: { transactionId: feeUtxo.outpoint.transactionId, index: feeUtxo.outpoint.index }, signatureScript: feeSig, sequence: 0n, sigOpCount: 0, computeBudget: _BSHARD_COMPUTE_BUDGET },
    ], outputs: orderedOut, lockTime: BigInt(lockTime), gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
    _assertTxInvariants(matched, signedTx, 'unlockBshardPayoutClaim', networkId);
    const r = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: r.transactionId, psContAddress: psContAddr, payoutSompi: payout.toString() };
  } finally { try { await rpc.disconnect(); } catch {} }
}

/**
 * unlockBshardCloseAttest — 委员 4-of-5 在 PayoutShard 内背书 payoutRoot (close_attest OP_1, closed 0→1 write-once)。
 * tx: in=[PS@0(close_attest OP_1), fee@1] → out=[PS_continuation@selfOutIdx(closed=1, payoutRoot=new, cov_id 续), change]。
 *   witness 声明序: [selfOutIdx, new_payoutRoot, c0Sig..c4Sig, committeePkHash, c0Pk..c4Pk, c0Idx..c4Idx, c0s0..c4s7(40 siblings)] + OP_1 + redeem。
 *   🛡 委员门 robust fix(b0e35141): 合约 require(c0Pk<c1Pk<...<c4Pk) 严格升序 → handler 必【按 pubkey 字节升序 sort 5 委员(pk+sig+idx+8 siblings 一起)】。
 *     pubkey-sort 纯 witness 组装(不改 tx sighash; 委员签 tx preimage 与排序无关)。委员 sig 由 driver 用 committee key 对 tx_obj_preimage 签。
 *   cov_id 续: out[selfOutIdx] CovenantBinding(authInput=0, covId=PS cov_id)。close_attest 不动 value(out==in[ps].value=consolidated_pool 不变)。
 */
export async function unlockBshardCloseAttest(args) {
  const { wallet, cmd, networkId, lockTime = 0n } = args;
  const w = cmd.witness;
  const rpc = await connectRpc(networkId);
  try {
    const psUtxo = await _matchUtxo(rpc, _addressFromRedeem(cmd.inputs.payoutshard.redeem_hex, networkId), cmd.inputs.payoutshard.outpointTxid, cmd.inputs.payoutshard.index);
    if (!cmd.inputs.fee) throw new Error('close_attest: fee input 必需');
    const feeUtxo = await _matchUtxo(rpc, cmd.inputs.fee.address, cmd.inputs.fee.outpointTxid, cmd.inputs.fee.index);
    const matched = [psUtxo, feeUtxo];
    const psCovId = _psInputCovId(psUtxo);

    // ★ pubkey 字节升序 sort 5 委员(pk+sig+idx+8 siblings 同步排)→ 满足合约 require(c0Pk<c1Pk<...) (b0e35141 robust fix)。
    //   build-preimage 模式 w.committee 空(driver 还没签)→ members=[] (psSig 不用, 走 preimage 返回)。
    const members = (w.committee || []).map((m) => ({ pk: m.pk_hex, sig: m.sig_hex, idx: m.idx, sibs: m.siblings_hex }));
    // J1/Bettor/NWT 2026-06-23 PINPOINT (ozzeu close LAND): 【不】sort committee slot (close_attest/refund_attest) — c0..c4 必按
    //   SELECTION 序(pool_committee stored)对齐 committeePkHash=blake2b(witness c0..c4) + sig[i]↔pk[i] 配对 + checkSig 逐 slot。
    //   .sil = require(ciPk != cjPk) DISTINCTNESS(!=)非 ordering(<)→不要求 sorted (silverc byte[32] 不能 `<` 只能 `!=`, b0e35141)。
    //   1756 旧 'c0<c1<..' comment 过时。merkle idx/siblings 是 per-pk pool 树位置(committeeMeta 已算)与 slot 序正交不需在此 sort。
    //   sort 了 → committeePkHash 变(70d9cdbe≠stored 66678d94) + sig↔pk 错位 → ③/checkSig fail。(members 保持传入 selection 序)

    const ps = cmd.inputs.payoutshard.state;
    const newState = { consolidated_pool: ps.consolidated_pool, closed: 1, payoutRoot: w.new_payout_root, ..._nw17(ps) };   // closed 0→1 + payoutRoot 写入; 17-word nullifier 透传
    const psContAddr = _continuationAddress(cmd.inputs.payoutshard.redeem_hex, _serializePayoutStateHex(newState), networkId, cmd.inputs.payoutshard.state_start ?? _POOL_STATE_START);
    const psOutValue = _utxoValue(psUtxo);   // close 不动 value(consolidated_pool 不变)

    const outputs = [];
    outputs[w.self_out_idx] = new TransactionOutput(psOutValue, payToAddressScript(new Address(psContAddr)), new CovenantBinding(0, new Hash(psCovId)));
    const orderedOut = outputs.filter(o => o !== undefined);
    _appendChange(orderedOut, matched, cmd.outputs?.change_address, _bshardFeeV1(matched.length));

    // close_attest scriptSig(pubkey-sorted 委员)+ OP_1 + redeem (no-sig; 委员 sig 在 witness data 非 input sig)
    let sigPush = '', pkPush = '', idxPush = '', sibPush = '';
    // ⚠ committee sig 已 push-encoded(createInputSignature 输出 66B [0x41][64][0x01])→ 直接 concat, 别 _pushBytes(double-push=malformed, 同 unlockBshardClose/PoolSpine sediment)。pk/idx/sib 是 raw data 需 push。
    for (const m of members) { sigPush += m.sig; pkPush += _pushBytes(m.pk); idxPush += _pushInt(m.idx); for (const s of m.sibs) sibPush += _pushBytes(s); }
    const psSig = _pushInt(w.self_out_idx) + _pushBytes(w.new_payout_root) + sigPush + _pushBytes(w.committee_pk_hash) + pkPush + idxPush + sibPush
      + '51' + _encodePushDataHex(Buffer.from(cmd.inputs.payoutshard.redeem_hex, 'hex'));   // close_attest=OP_1='51'

    // (b) 单一 tx 源: handler 确定性 build canonical un(committee 签此 input 0, fee relay 签). 两阶段:
    //   ① build-preimage(无 committee sigs)→ 返 canonical preimage(地址-based)供 driver/跨节点委员 createInputSignature(un,0)。
    //   ② submit(committee sigs 在)→ 注入同一 canonical un + fee 签 + 广播。委员签的 == 最终 tx → sighash 必一致(无复制 fragility)。
    const psAddrIn = _addressFromRedeem(cmd.inputs.payoutshard.redeem_hex, networkId);
    const un = new Transaction({ version: 1, inputs: matched.map(u => ({ previousOutpoint: { transactionId: u.outpoint.transactionId, index: u.outpoint.index }, signatureScript: '', sequence: 0n, sigOpCount: 0, computeBudget: _BSHARD_COMPUTE_BUDGET, utxo: u })), outputs: orderedOut, lockTime: BigInt(lockTime), gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
    if (!w.committee || w.committee.length === 0) {
      // build-preimage 模式: 返回 canonical un 结构(地址-based, 含 PS output 的 cov_id covenant)供 committee 签 input 0。
      //   + unSafeJson = un.serializeToSafeJSON() (round-trips covenant+utxo+outpoint) → 跨节点 committee 直接
      //   sign_input_for_settle{safe_json:true} byte-exact 签同一 un (== submit 重构 un, 无复制 fragility)。
      //   J1 settler-daemon prereq(2026-06-29): 没它 :3200 canonical build 只返地址-based preimage, daemon 跨节点收 sig 死锁。
      return { ok: true, mode: 'preimage', psContAddress: psContAddr, psInputIdx: 0, payoutCovId: psCovId,
        unSafeJson: un.serializeToSafeJSON(),
        preimage: {
          version: 1,
          inputs: [{ previousOutpoint: { transactionId: psUtxo.outpoint.transactionId, index: Number(psUtxo.outpoint.index) }, address: psAddrIn, amountSompi: _utxoValue(psUtxo).toString() },
                   { previousOutpoint: { transactionId: feeUtxo.outpoint.transactionId, index: Number(feeUtxo.outpoint.index) }, address: cmd.inputs.fee.address, amountSompi: _utxoValue(feeUtxo).toString() }],
          outputs: orderedOut.map((o, i) => ({ value: o.value.toString(), address: (i === w.self_out_idx ? psContAddr : cmd.outputs?.change_address), covenantId: (i === w.self_out_idx ? psCovId : null) })),
        } };
    }
    // submit 模式: 委员 sig 注入同一 canonical un + fee 签 + 广播。
    const feeSig = createInputSignature(un, 1, wallet.getPrivateKey(), SighashType.All);
    const signedTx = new Transaction({ version: 1, inputs: [
      { previousOutpoint: { transactionId: psUtxo.outpoint.transactionId, index: psUtxo.outpoint.index }, signatureScript: psSig, sequence: 0n, sigOpCount: 0, computeBudget: _BSHARD_COMPUTE_BUDGET },
      { previousOutpoint: { transactionId: feeUtxo.outpoint.transactionId, index: feeUtxo.outpoint.index }, signatureScript: feeSig, sequence: 0n, sigOpCount: 0, computeBudget: _BSHARD_COMPUTE_BUDGET },
    ], outputs: orderedOut, lockTime: BigInt(lockTime), gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
    _assertTxInvariants(matched, signedTx, 'unlockBshardCloseAttest', networkId);
    const r = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: r.transactionId, psContAddress: psContAddr, sortedCommitteePks: members.map(m => m.pk.slice(0, 8)) };
  } finally { try { await rpc.disconnect(); } catch {} }
}

/**
 * unlockBshardCloseAttestV2 — PayoutShardV2(ZK-native) close_attest OP_1 (W2, J2 2026-07-07).
 * ★ 镜像 unlockBshardCloseAttest byte-identical 结构(two-phase preimage/submit, committee pubkey-distinctness 门,
 *   canonical un 单一源 sighash 一致性)——差异仅: (a) witness 多 4 个新字段(new_attested_winner/new_bets_root/
 *   new_refund_root/new_attested_at_ms), 按 PayoutShardV2.sil close_attest 形参声明序插在 new_payout_root 之后、
 *   committee 签名段之前; (b) state 用 _serializePayoutV2StateHex/_continuationAddressV2(独立函数, 见上)。
 * ⚠ 不改 unlockBshardCloseAttest 一字(single-author 分离, 同 PayoutShard.sil/PayoutShardV2.sil 全拷贝哲学)。
 * @param {object} args.cmd.witness { self_out_idx, new_payout_root, new_attested_winner, new_bets_root,
 *   new_refund_root, new_attested_at_ms, committee:[{pk_hex,sig_hex,idx,siblings_hex}](空=preimage模式), committee_pk_hash }
 */
export async function unlockBshardCloseAttestV2(args) {
  const { wallet, cmd, networkId, lockTime = 0n } = args;
  const w = cmd.witness;
  const rpc = await connectRpc(networkId);
  try {
    const psUtxo = await _matchUtxo(rpc, _addressFromRedeem(cmd.inputs.payoutshard.redeem_hex, networkId), cmd.inputs.payoutshard.outpointTxid, cmd.inputs.payoutshard.index);
    if (!cmd.inputs.fee) throw new Error('close_attest_v2: fee input 必需');
    const feeUtxo = await _matchUtxo(rpc, cmd.inputs.fee.address, cmd.inputs.fee.outpointTxid, cmd.inputs.fee.index);
    const matched = [psUtxo, feeUtxo];
    const psCovId = _psInputCovId(psUtxo);

    // committee slot 序 = SELECTION 序(同 V1 unlockBshardCloseAttest, 不 sort — committeePkHash/sig↔pk 配对/checkSig 逐 slot 依赖原序)。
    const members = (w.committee || []).map((m) => ({ pk: m.pk_hex, sig: m.sig_hex, idx: m.idx, sibs: m.siblings_hex }));

    const ps = cmd.inputs.payoutshard.state;
    const newState = {
      consolidated_pool: ps.consolidated_pool, closed: 1, payoutRoot: w.new_payout_root, ..._nw17(ps),
      attestedWinner: w.new_attested_winner, attestedAtMs: w.new_attested_at_ms,
      betsRootBaked: w.new_bets_root, refundRootBaked: w.new_refund_root,
    };
    const psContAddr = _continuationAddressV2(cmd.inputs.payoutshard.redeem_hex, _serializePayoutV2StateHex(newState), networkId, cmd.inputs.payoutshard.state_start ?? _POOL_STATE_START);
    const psOutValue = _utxoValue(psUtxo);   // close 不动 value(consolidated_pool 不变, 同 V1)

    const outputs = [];
    outputs[w.self_out_idx] = new TransactionOutput(psOutValue, payToAddressScript(new Address(psContAddr)), new CovenantBinding(0, new Hash(psCovId)));
    const orderedOut = outputs.filter(o => o !== undefined);
    _appendChange(orderedOut, matched, cmd.outputs?.change_address, _bshardFeeV1(matched.length));

    // close_attest scriptSig — witness push 序必与 PayoutShardV2.sil close_attest 形参声明序一致:
    //   selfOutIdx, new_payoutRoot, new_attestedWinner, new_betsRoot, new_refundRoot, new_attestedAtMs,
    //   c0..c4Sig, committeePkHash, c0..c4Pk, c0..c4Idx, c0..c4 siblings(40) + OP_1 + redeem。
    let sigPush = '', pkPush = '', idxPush = '', sibPush = '';
    for (const m of members) { sigPush += m.sig; pkPush += _pushBytes(m.pk); idxPush += _pushInt(m.idx); for (const s of m.sibs) sibPush += _pushBytes(s); }
    const psSig = _pushInt(w.self_out_idx) + _pushBytes(w.new_payout_root)
      + _pushInt(w.new_attested_winner) + _pushBytes(w.new_bets_root) + _pushBytes(w.new_refund_root) + _pushInt(w.new_attested_at_ms)
      + sigPush + _pushBytes(w.committee_pk_hash) + pkPush + idxPush + sibPush
      + '51' + _encodePushDataHex(Buffer.from(cmd.inputs.payoutshard.redeem_hex, 'hex'));   // close_attest=OP_1='51'(同 PayoutShardV2.sil entry 1)

    const psAddrIn = _addressFromRedeem(cmd.inputs.payoutshard.redeem_hex, networkId);
    const un = new Transaction({ version: 1, inputs: matched.map(u => ({ previousOutpoint: { transactionId: u.outpoint.transactionId, index: u.outpoint.index }, signatureScript: '', sequence: 0n, sigOpCount: 0, computeBudget: _BSHARD_COMPUTE_BUDGET, utxo: u })), outputs: orderedOut, lockTime: BigInt(lockTime), gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
    if (!w.committee || w.committee.length === 0) {
      // build-preimage 模式(同 V1): 返回 canonical un + unSafeJson 供 committee 各自 sign_input_for_settle{safe_json:true}。
      return { ok: true, mode: 'preimage', psContAddress: psContAddr, psInputIdx: 0, payoutCovId: psCovId,
        unSafeJson: un.serializeToSafeJSON(),
        preimage: {
          version: 1,
          inputs: [{ previousOutpoint: { transactionId: psUtxo.outpoint.transactionId, index: Number(psUtxo.outpoint.index) }, address: psAddrIn, amountSompi: _utxoValue(psUtxo).toString() },
                   { previousOutpoint: { transactionId: feeUtxo.outpoint.transactionId, index: Number(feeUtxo.outpoint.index) }, address: cmd.inputs.fee.address, amountSompi: _utxoValue(feeUtxo).toString() }],
          outputs: orderedOut.map((o, i) => ({ value: o.value.toString(), address: (i === w.self_out_idx ? psContAddr : cmd.outputs?.change_address), covenantId: (i === w.self_out_idx ? psCovId : null) })),
        } };
    }
    // submit 模式(同 V1): 委员 sig 注入同一 canonical un + fee 签 + 广播。
    const feeSig = createInputSignature(un, 1, wallet.getPrivateKey(), SighashType.All);
    const signedTx = new Transaction({ version: 1, inputs: [
      { previousOutpoint: { transactionId: psUtxo.outpoint.transactionId, index: psUtxo.outpoint.index }, signatureScript: psSig, sequence: 0n, sigOpCount: 0, computeBudget: _BSHARD_COMPUTE_BUDGET },
      { previousOutpoint: { transactionId: feeUtxo.outpoint.transactionId, index: feeUtxo.outpoint.index }, signatureScript: feeSig, sequence: 0n, sigOpCount: 0, computeBudget: _BSHARD_COMPUTE_BUDGET },
    ], outputs: orderedOut, lockTime: BigInt(lockTime), gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
    _assertTxInvariants(matched, signedTx, 'unlockBshardCloseAttestV2', networkId);
    const r = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: r.transactionId, psContAddress: psContAddr, sortedCommitteePks: members.map(m => m.pk.slice(0, 8)) };
  } finally { try { await rpc.disconnect(); } catch {} }
}

/**
 * unlockBshardCancelAttest — 委员 4-of-5 在 PayoutShard 内背书 refundRoot (cancel_attest OP_3, closed 0→2 write-once)。
 *   ★ 镜像 unlockBshardCloseAttest byte-identical(委员门同款 pubkey-sort + preimage/submit 双模)→ 仅: closed 0→2(非 0→1) + new_refundRoot 进 payoutRoot 槽(复用) + 选择子 OP_3='53'。
 *   contract cancel_attest(58 形参)= close_attest 形参序仅 pos2 new_payoutRoot→new_refundRoot. closed 0→2 与 close 0→1 互斥 latch(require(closed==0))。
 *   witness 声明序: [selfOutIdx, new_refundRoot, c0Sig..c4Sig, committeePkHash, c0Pk..c4Pk, c0Idx..c4Idx, c0s0..c4s7(40 siblings)] + OP_3 + redeem。
 *   cov_id 续: out[selfOutIdx] CovenantBinding(authInput=0, covId=PS cov_id)。cancel 不动 value(out==in[ps].value=consolidated_pool 不变, refund_claim 阶段才花)。
 */
export async function unlockBshardCancelAttest(args) {
  const { wallet, cmd, networkId, lockTime = 0n } = args;
  const w = cmd.witness;
  const rpc = await connectRpc(networkId);
  try {
    const psUtxo = await _matchUtxo(rpc, _addressFromRedeem(cmd.inputs.payoutshard.redeem_hex, networkId), cmd.inputs.payoutshard.outpointTxid, cmd.inputs.payoutshard.index);
    if (!cmd.inputs.fee) throw new Error('cancel_attest: fee input 必需');
    const feeUtxo = await _matchUtxo(rpc, cmd.inputs.fee.address, cmd.inputs.fee.outpointTxid, cmd.inputs.fee.index);
    const matched = [psUtxo, feeUtxo];
    const psCovId = _psInputCovId(psUtxo);

    // ★ pubkey 字节升序 sort 5 委员(同 close_attest, b0e35141 robust fix)。
    const members = (w.committee || []).map((m) => ({ pk: m.pk_hex, sig: m.sig_hex, idx: m.idx, sibs: m.siblings_hex }));
    // J1/Bettor/NWT 2026-06-23 PINPOINT (ozzeu close LAND): 【不】sort committee slot (close_attest/refund_attest) — c0..c4 必按
    //   SELECTION 序(pool_committee stored)对齐 committeePkHash=blake2b(witness c0..c4) + sig[i]↔pk[i] 配对 + checkSig 逐 slot。
    //   .sil = require(ciPk != cjPk) DISTINCTNESS(!=)非 ordering(<)→不要求 sorted (silverc byte[32] 不能 `<` 只能 `!=`, b0e35141)。
    //   1756 旧 'c0<c1<..' comment 过时。merkle idx/siblings 是 per-pk pool 树位置(committeeMeta 已算)与 slot 序正交不需在此 sort。
    //   sort 了 → committeePkHash 变(70d9cdbe≠stored 66678d94) + sig↔pk 错位 → ③/checkSig fail。(members 保持传入 selection 序)

    const ps = cmd.inputs.payoutshard.state;
    const newState = { consolidated_pool: ps.consolidated_pool, closed: 2, payoutRoot: w.new_refund_root, ..._nw17(ps) };   // closed 0→2 + refundRoot 进 payoutRoot 槽(复用); 17-word nullifier 透传
    const psContAddr = _continuationAddress(cmd.inputs.payoutshard.redeem_hex, _serializePayoutStateHex(newState), networkId, cmd.inputs.payoutshard.state_start ?? _POOL_STATE_START);
    const psOutValue = _utxoValue(psUtxo);   // cancel 不动 value(consolidated_pool 不变)

    const outputs = [];
    outputs[w.self_out_idx] = new TransactionOutput(psOutValue, payToAddressScript(new Address(psContAddr)), new CovenantBinding(0, new Hash(psCovId)));
    const orderedOut = outputs.filter(o => o !== undefined);
    _appendChange(orderedOut, matched, cmd.outputs?.change_address, _bshardFeeV1(matched.length));

    // cancel_attest scriptSig(pubkey-sorted 委员)+ OP_3 + redeem (no-sig; 委员 sig 在 witness data 非 input sig)
    let sigPush = '', pkPush = '', idxPush = '', sibPush = '';
    for (const m of members) { sigPush += m.sig; pkPush += _pushBytes(m.pk); idxPush += _pushInt(m.idx); for (const s of m.sibs) sibPush += _pushBytes(s); }
    const psSig = _pushInt(w.self_out_idx) + _pushBytes(w.new_refund_root) + sigPush + _pushBytes(w.committee_pk_hash) + pkPush + idxPush + sibPush
      + '53' + _encodePushDataHex(Buffer.from(cmd.inputs.payoutshard.redeem_hex, 'hex'));   // cancel_attest=OP_3='53'

    const psAddrIn = _addressFromRedeem(cmd.inputs.payoutshard.redeem_hex, networkId);
    const un = new Transaction({ version: 1, inputs: matched.map(u => ({ previousOutpoint: { transactionId: u.outpoint.transactionId, index: u.outpoint.index }, signatureScript: '', sequence: 0n, sigOpCount: 0, computeBudget: _BSHARD_COMPUTE_BUDGET, utxo: u })), outputs: orderedOut, lockTime: BigInt(lockTime), gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
    if (!w.committee || w.committee.length === 0) {
      // build-preimage 模式: 返回 canonical un 供 committee 签 input 0(同 close_attest)。
      //   + unSafeJson = un.serializeToSafeJSON() (镜像 close_attest·跨节点 committee byte-exact 签·daemon prereq)。
      return { ok: true, mode: 'preimage', psContAddress: psContAddr, psInputIdx: 0, payoutCovId: psCovId,
        unSafeJson: un.serializeToSafeJSON(),
        preimage: {
          version: 1,
          inputs: [{ previousOutpoint: { transactionId: psUtxo.outpoint.transactionId, index: Number(psUtxo.outpoint.index) }, address: psAddrIn, amountSompi: _utxoValue(psUtxo).toString() },
                   { previousOutpoint: { transactionId: feeUtxo.outpoint.transactionId, index: Number(feeUtxo.outpoint.index) }, address: cmd.inputs.fee.address, amountSompi: _utxoValue(feeUtxo).toString() }],
          outputs: orderedOut.map((o, i) => ({ value: o.value.toString(), address: (i === w.self_out_idx ? psContAddr : cmd.outputs?.change_address), covenantId: (i === w.self_out_idx ? psCovId : null) })),
        } };
    }
    const feeSig = createInputSignature(un, 1, wallet.getPrivateKey(), SighashType.All);
    const signedTx = new Transaction({ version: 1, inputs: [
      { previousOutpoint: { transactionId: psUtxo.outpoint.transactionId, index: psUtxo.outpoint.index }, signatureScript: psSig, sequence: 0n, sigOpCount: 0, computeBudget: _BSHARD_COMPUTE_BUDGET },
      { previousOutpoint: { transactionId: feeUtxo.outpoint.transactionId, index: feeUtxo.outpoint.index }, signatureScript: feeSig, sequence: 0n, sigOpCount: 0, computeBudget: _BSHARD_COMPUTE_BUDGET },
    ], outputs: orderedOut, lockTime: BigInt(lockTime), gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
    _assertTxInvariants(matched, signedTx, 'unlockBshardCancelAttest', networkId);
    const r = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: r.transactionId, psContAddress: psContAddr, sortedCommitteePks: members.map(m => m.pk.slice(0, 8)) };
  } finally { try { await rpc.disconnect(); } catch {} }
}

/**
 * unlockBshardRefundClaim — bettor 从 cancelled PayoutShard 退款 (refund_claim OP_4, closed==2)。
 *   ★ 镜像 unlockBshardPayoutClaim byte-identical(store-refund + nullifier + recipient-bind)→ 仅: closed==2(合约门, 非 closed==1) + leaf=blake2b(pk‖refund) + 选择子 OP_4='54'。
 *   contract refund_claim(15 形参)= claim 形参序仅 pos2 payoutOutIdx→refundOutIdx, pos4 payout→refund. payoutRoot 槽此时是 refundRoot, leaf=blake2b(pk‖ser(stake,8))。
 *   witness 声明序: [selfOutIdx, refundOutIdx, bettorPk, refund, merkle_index, s0..s9(10 individual byte[32])] + OP_4 + redeem (no-sig)。
 *   nullifier: w[merkle_index/63] 置 bit(merkle_index%63)。守恒: out[self]==consolidated_pool-refund(不变量 value==consolidated_pool)。
 */
export async function unlockBshardRefundClaim(args) {
  const { wallet, cmd, networkId, lockTime = 0n } = args;
  const w = cmd.witness;
  const rpc = await connectRpc(networkId);
  try {
    const psUtxo = await _matchUtxo(rpc, _addressFromRedeem(cmd.inputs.payoutshard.redeem_hex, networkId), cmd.inputs.payoutshard.outpointTxid, cmd.inputs.payoutshard.index);
    if (!cmd.inputs.fee) throw new Error('refund_claim: fee input 必需 (PS value weld 进 continuation+refund)');
    const feeUtxo = await _matchUtxo(rpc, cmd.inputs.fee.address, cmd.inputs.fee.outpointTxid, cmd.inputs.fee.index);
    const matched = [psUtxo, feeUtxo];
    const psCovId = _psInputCovId(psUtxo);

    const refund = BigInt(w.refund);
    const ps = cmd.inputs.payoutshard.state;                          // {consolidated_pool, closed:2, payoutRoot(=refundRoot), w0..16}
    // nullifier 置位(同 claim): word_idx = merkle_index/63, bit_in = merkle_index%63
    const idx = Number(w.merkle_index), wordIdx = Math.floor(idx / 63), bitIn = idx % 63;
    const nw = []; for (let i = 0; i < _NULLIFIER_WORDS; i++) nw.push(BigInt(ps['w' + i] ?? 0));
    if (wordIdx < _NULLIFIER_WORDS) nw[wordIdx] = nw[wordIdx] + (1n << BigInt(bitIn));   // F4 aliasing: 越界跳过 → 合约 require(merkle_index<1024) 链上 BUST
    const newState = { consolidated_pool: (BigInt(ps.consolidated_pool) - refund).toString(), closed: ps.closed, payoutRoot: ps.payoutRoot, ..._nw17(ps) };   // closed 续 2, refundRoot 续
    for (let i = 0; i < _NULLIFIER_WORDS; i++) newState['w' + i] = nw[i].toString();
    const psContAddr = _continuationAddress(cmd.inputs.payoutshard.redeem_hex, _serializePayoutStateHex(newState), networkId, cmd.inputs.payoutshard.state_start ?? _POOL_STATE_START);
    const psOutValue = _utxoValue(psUtxo) - refund;                  // 守恒 weld

    const outputs = [];
    outputs[w.refund_out_idx] = new TransactionOutput(refund, payToAddressScript(new Address(cmd.outputs.refund.address)));   // recipient P2PK(bettorPk); caller 供 bettorPk 派生地址
    outputs[w.self_out_idx] = new TransactionOutput(psOutValue, payToAddressScript(new Address(psContAddr)), new CovenantBinding(0, new Hash(psCovId)));   // cov_id 续
    const orderedOut = outputs.filter(o => o !== undefined);
    _appendChange(orderedOut, matched, cmd.outputs?.change_address, _bshardFeeV1(matched.length));

    // PS@0 refund_claim scriptSig (声明序: selfOutIdx, refundOutIdx, bettorPk, refund, merkle_index, s0..s9) + OP_4 + redeem (no-sig)
    let sibPush = '';
    for (const s of w.siblings_hex) sibPush += _pushBytes(s);         // s0..s9 forward 序(individual byte[32], driver 必 pad 到 10)
    const psSig = _pushInt(w.self_out_idx) + _pushInt(w.refund_out_idx) + _pushBytes(w.bettor_pk)
      + _pushInt(w.refund) + _pushInt(w.merkle_index) + sibPush
      + '54' + _encodePushDataHex(Buffer.from(cmd.inputs.payoutshard.redeem_hex, 'hex'));   // refund_claim=OP_4='54'

    const unsigned = new Transaction({ version: 1, inputs: matched.map(u => ({ previousOutpoint: { transactionId: u.outpoint.transactionId, index: u.outpoint.index }, signatureScript: '', sequence: 0n, sigOpCount: 0, computeBudget: _BSHARD_COMPUTE_BUDGET, utxo: u })), outputs: orderedOut, lockTime: BigInt(lockTime), gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
    const feeSig = createInputSignature(unsigned, 1, wallet.getPrivateKey(), SighashType.All);
    const signedTx = new Transaction({ version: 1, inputs: [
      { previousOutpoint: { transactionId: psUtxo.outpoint.transactionId, index: psUtxo.outpoint.index }, signatureScript: psSig, sequence: 0n, sigOpCount: 0, computeBudget: _BSHARD_COMPUTE_BUDGET },
      { previousOutpoint: { transactionId: feeUtxo.outpoint.transactionId, index: feeUtxo.outpoint.index }, signatureScript: feeSig, sequence: 0n, sigOpCount: 0, computeBudget: _BSHARD_COMPUTE_BUDGET },
    ], outputs: orderedOut, lockTime: BigInt(lockTime), gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
    _assertTxInvariants(matched, signedTx, 'unlockBshardRefundClaim', networkId);
    const r = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: r.transactionId, psContAddress: psContAddr, refundSompi: refund.toString() };
  } finally { try { await rpc.disconnect(); } catch {} }
}

// 取 UTXO by outpoint at a P2SH/address. outpointIndex 可选: 同 txid 同 addr 可有多 UTXO
// (relay 给自己 addr transfer = target+change 2 个) → 用 outpoint index 消歧 (KANet-UI 2026-06-19, seal/register funding 管道).
// backward-compat: 不传 index (P2SH 唯一 addr 调用点) → 仅按 txid, 行为不变; 旧 funding 命令无 index (undefined != null = false) 亦不变.
async function _matchUtxo(rpc, address, outpointTxid, outpointIndex = null) {
  const { entries } = await rpc.getUtxosByAddresses([address]);
  let hits = (entries || []).filter(e => e.outpoint.transactionId === outpointTxid);
  if (outpointIndex != null) hits = hits.filter(e => Number(e.outpoint.index) === Number(outpointIndex));
  if (hits.length === 0) throw new Error(`UTXO not found at ${address} for tx ${outpointTxid}${outpointIndex != null ? `:${outpointIndex}` : ''}`);
  if (hits.length > 1) throw new Error(`ambiguous ${hits.length} UTXOs at ${address} from ${outpointTxid} (pass outpoint index to disambiguate)`);
  return hits[0];
}

/**
 * unlockBshardRegister — bshard_register_bet (register_append entry OP_0).
 * Inputs: [0] leaf (P2SH register_append, no sig) + funding P2PK (wallet-signed).
 * Outputs: [leaf_out_idx] new leaf (per-state addr, value+=stake) + [ps_out_idx] dust ticket + change.
 */
export async function unlockBshardRegister(args) {
  const { wallet, cmd, networkId, lockTime = 0n } = args;
  const w = cmd.witness;
  const rpc = await connectRpc(networkId);
  try {
    const leafUtxo = await _matchUtxo(rpc, _addressFromRedeem(cmd.inputs.leaf.redeem_hex, networkId), cmd.inputs.leaf.outpointTxid);   // P2SH 地址 = hash(redeem)
    const fundUtxos = [];
    for (const f of (cmd.inputs.funding || [])) fundUtxos.push(await _matchUtxo(rpc, f.address, f.outpointTxid, f.index));

    // 输出地址 relay 自算 per-state (忽略 cmd.address)
    const newLeafAddr = _continuationAddress(cmd.inputs.leaf.redeem_hex, _serializeLeafStateHex(cmd.outputs.leaf_continuation.state), networkId);
    const ticketAddr = _ticketAddress(w.ps_prefix_hex, w.ps_suffix_hex, cmd.outputs.poolSide_ticket.state, networkId);

    // leaf scriptSig: register_append witness(声明序) + selector OP_0 + redeem reveal. (无 sig: covenant-accumulate)
    const leafSig = _pushInt(w.side) + _pushInt(w.stake) + _pushInt(w.leaf_out_idx) + _pushInt(w.ps_out_idx)
      + _pushBytes(w.bettor_pk) + _pushBytes(w.ps_prefix_hex) + _pushBytes(w.ps_suffix_hex)
      + '00' + _encodePushDataHex(Buffer.from(cmd.inputs.leaf.redeem_hex, 'hex'));

    const outputs = [];
    outputs[w.leaf_out_idx] = new TransactionOutput(BigInt(cmd.outputs.leaf_continuation.amountSompi), payToAddressScript(new Address(newLeafAddr)));
    outputs[w.ps_out_idx] = new TransactionOutput(BigInt(cmd.outputs.poolSide_ticket.amountSompi), payToAddressScript(new Address(ticketAddr)));
    const orderedOut = outputs.filter(o => o !== undefined);
    const matched = [leafUtxo, ...fundUtxos];
    _appendChange(orderedOut, matched, cmd.outputs.change_address, _bshardFeeV1(matched.length));   // v1 budget-aware fee
    // unsigned (funding inputs 留空待签; leaf 无 sig 直接置 scriptSig). v1: sigOpCount=0 + computeBudget(ComputeCommit).
    const unsigned = new Transaction({
      version: 1,
      inputs: matched.map((u) => ({
        previousOutpoint: { transactionId: u.outpoint.transactionId, index: u.outpoint.index },
        signatureScript: '', sequence: 0n, sigOpCount: 0, computeBudget: _BSHARD_COMPUTE_BUDGET, utxo: u,
      })),
      outputs: orderedOut, lockTime: BigInt(lockTime), gas: 0n,
      subnetworkId: '0000000000000000000000000000000000000000', payload: '',
    });
    const sigScripts = [leafSig];
    for (let i = 1; i < matched.length; i++) {
      sigScripts.push(createInputSignature(unsigned, i, wallet.getPrivateKey(), SighashType.All));
    }
    const signedTx = new Transaction({
      version: 1,
      inputs: matched.map((u, i) => ({
        previousOutpoint: { transactionId: u.outpoint.transactionId, index: u.outpoint.index },
        signatureScript: sigScripts[i], sequence: 0n, sigOpCount: 0, computeBudget: _BSHARD_COMPUTE_BUDGET,
      })),
      outputs: orderedOut, lockTime: BigInt(lockTime), gas: 0n,
      subnetworkId: '0000000000000000000000000000000000000000', payload: '',
    });
    _assertTxInvariants(matched, signedTx, 'unlockBshardRegister', networkId);
    const r = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: r.transactionId };
  } finally { try { await rpc.disconnect(); } catch {} }
}

/**
 * unlockBshardClaim — bshard_claim_winner (PoolRoot claim_draw entry OP_1).
 * Inputs: [0] root (P2SH claim_draw, no sig) + ticket (P2SH authorize_spend, bettorSig) + fee P2PK (wallet-signed).
 * Outputs: [payout_out_idx] payout→bettor P2PK + [root_out_idx] recreated root(value-=payout, closed=1) + change.
 */
export async function unlockBshardClaim(args) {
  const { wallet, cmd, networkId, lockTime = 0n } = args;
  const w = cmd.witness;
  const rpc = await connectRpc(networkId);
  try {
    const rootUtxo = await _matchUtxo(rpc, _addressFromRedeem(cmd.inputs.root.redeem_hex, networkId), cmd.inputs.root.outpointTxid);   // P2SH 地址 = hash(redeem)
    const ticketUtxo = await _matchUtxo(rpc, _addressFromRedeem(cmd.inputs.ticket.redeem_hex, networkId), cmd.inputs.ticket.outpointTxid);
    const feeUtxo = cmd.inputs.fee ? await _matchUtxo(rpc, cmd.inputs.fee.address, cmd.inputs.fee.outpointTxid, cmd.inputs.fee.index) : null;   // fee.index 消歧 (KANet-UI 2026-06-20 sweep; undefined→null=backward-compat)
    const matched = [rootUtxo, ticketUtxo, ...(feeUtxo ? [feeUtxo] : [])];

    // RootClaim 单-entry state_layout.start=0 (无 selector dispatch 前导); PoolRoot 多-entry=1. caller 经 cmd.inputs.root.state_start 传 (J2 builder 供; 默认 _POOL_STATE_START=1 向后兼容).
    const newRootAddr = _continuationAddress(cmd.inputs.root.redeem_hex, _serializeRootStateHex(cmd.outputs.root_continuation.state), networkId, cmd.inputs.root.state_start ?? _POOL_STATE_START);
    const bettorLockSpk = payToAddressScript(new Address(cmd.outputs.payout.address));

    const outputs = [];
    outputs[w.payout_out_idx] = new TransactionOutput(BigInt(cmd.outputs.payout.amountSompi), bettorLockSpk);
    outputs[w.root_out_idx] = new TransactionOutput(BigInt(cmd.outputs.root_continuation.amountSompi), payToAddressScript(new Address(newRootAddr)));
    const orderedOut = outputs.filter(o => o !== undefined);
    _appendChange(orderedOut, matched, cmd.outputs.change_address);   // relay 算 change=Σin−Σout−fee

    // root scriptSig: claim_draw witness(声明序: rootOutIdx,payoutOutIdx,payout,merkle_index,tree_depth,siblings[],ticketInIdx,prefix/suffix_len)+ OP_4 + redeem.
    let sibPush = '';
    for (const s of w.siblings_hex) sibPush += _pushBytes(s);     // byte[32][] = depth 个 push, forward 序
    // selector 参数化 (KANet-UI 2026-06-20): RootClaim 单-entry (without_selector) → 无 selector ('' 空); PoolRoot 多-entry claim_draw=OP_1='51'.
    //   单-entry 合约加 selector 会被当 ctor-arg → require fail (single-entry gotcha). caller 经 cmd.inputs.root.claim_selector_hex 控 (RootClaim 传 '').
    const claimSelector = cmd.inputs.root.claim_selector_hex !== undefined ? cmd.inputs.root.claim_selector_hex : '51';
    const rootSig = _pushInt(w.root_out_idx) + _pushInt(w.payout_out_idx) + _pushInt(w.payout)
      + _pushInt(w.merkle_index) + _pushInt(w.tree_depth) + sibPush
      + _pushInt(w.ticket_in_idx) + _pushInt(w.ticket_prefix_len) + _pushInt(w.ticket_suffix_len)
      + claimSelector + _encodePushDataHex(Buffer.from(cmd.inputs.root.redeem_hex, 'hex'));

    // ticket scriptSig: authorize_spend(bettorSig)+ OP_0 + redeem. bettorSig = relay 用 bettor key 签 ticket input.
    // (root input 无 sig; fee input wallet-签). 先建 unsigned(待签 input scriptSig=''), 算 sighash.
    const unsigned = new Transaction({
      version: 0,
      inputs: matched.map((u, i) => ({
        previousOutpoint: { transactionId: u.outpoint.transactionId, index: u.outpoint.index },
        signatureScript: '', sequence: 0n, sigOpCount: i === 0 ? 0 : 1, utxo: u,    // root(0)=0; ticket(1)=1; fee(2)=1
      })),
      outputs: orderedOut, lockTime: BigInt(lockTime), gas: 0n,
      subnetworkId: '0000000000000000000000000000000000000000', payload: '',
    });
    const ticketSigHex = createInputSignature(unsigned, 1, wallet.getPrivateKey(), SighashType.All);
    // PoolSide ticket authorize_spend selector 参数化 (KANet-UI 2026-06-20 单-entry sweep, 同 claim_selector/offset 同根=单-entry 无 selector 前导字节):
    //   PoolSide_v08_shard without_selector=true → 单-entry 无 selector → cmd.inputs.ticket.spend_selector_hex='' (空); 旧多-entry ticket=OP_0='00'(default).
    const ticketSelector = cmd.inputs.ticket.spend_selector_hex !== undefined ? cmd.inputs.ticket.spend_selector_hex : '00';
    const ticketSig = ticketSigHex + ticketSelector + _encodePushDataHex(Buffer.from(cmd.inputs.ticket.redeem_hex, 'hex'));
    const sigScripts = [rootSig, ticketSig];
    if (feeUtxo) sigScripts.push(createInputSignature(unsigned, 2, wallet.getPrivateKey(), SighashType.All));

    const signedTx = new Transaction({
      version: 0,
      inputs: matched.map((u, i) => ({
        previousOutpoint: { transactionId: u.outpoint.transactionId, index: u.outpoint.index },
        signatureScript: sigScripts[i], sequence: 0n, sigOpCount: i === 0 ? 0 : 1,
      })),
      outputs: orderedOut, lockTime: BigInt(lockTime), gas: 0n,
      subnetworkId: '0000000000000000000000000000000000000000', payload: '',
    });
    _assertTxInvariants(matched, signedTx, 'unlockBshardClaim', networkId);
    const r = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: r.transactionId };
  } finally { try { await rpc.disconnect(); } catch {} }
}

/**
 * unlockBshardRefund — bshard_refund_cancelled (PoolRoot refund_draw entry OP_2).
 * Inputs: [0] pool (P2SH refund_draw, no sig) + ticket (P2SH authorize_spend, bettorSig).
 * Outputs: [payout_out_idx] refund→bettor P2PK=stake + [pool_out_idx] recreated pool(value-=stake, closed=2) + change.
 */
export async function unlockBshardRefund(args) {
  const { wallet, cmd, networkId, lockTime = 0n } = args;
  const w = cmd.witness;
  const rpc = await connectRpc(networkId);
  try {
    const poolUtxo = await _matchUtxo(rpc, _addressFromRedeem(cmd.inputs.pool.redeem_hex, networkId), cmd.inputs.pool.outpointTxid);   // P2SH 地址 = hash(redeem)
    const ticketUtxo = await _matchUtxo(rpc, _addressFromRedeem(cmd.inputs.ticket.redeem_hex, networkId), cmd.inputs.ticket.outpointTxid);
    const matched = [poolUtxo, ticketUtxo];

    const newPoolAddr = _continuationAddress(cmd.inputs.pool.redeem_hex, _serializeRootStateHex(cmd.outputs.pool_continuation.state), networkId);
    const outputs = [];
    outputs[w.payout_out_idx] = new TransactionOutput(BigInt(cmd.outputs.payout.amountSompi), payToAddressScript(new Address(cmd.outputs.payout.address)));
    outputs[w.pool_out_idx] = new TransactionOutput(BigInt(cmd.outputs.pool_continuation.amountSompi), payToAddressScript(new Address(newPoolAddr)));
    const orderedOut = outputs.filter(o => o !== undefined);
    _appendChange(orderedOut, matched, cmd.outputs.change_address);   // relay 算 change=Σin−Σout−fee

    // pool scriptSig: refund_draw witness(声明序: poolOutIdx,payoutOutIdx,ticketInIdx,prefix/suffix_len)+ OP_5 + redeem.
    const poolSig = _pushInt(w.pool_out_idx) + _pushInt(w.payout_out_idx) + _pushInt(w.ticket_in_idx)
      + _pushInt(w.ticket_prefix_len) + _pushInt(w.ticket_suffix_len)
      + '52' + _encodePushDataHex(Buffer.from(cmd.inputs.pool.redeem_hex, 'hex'));    // refund_draw=OP_2='52' (PoolRoot; was unified OP_5)

    const unsigned = new Transaction({
      version: 0,
      inputs: matched.map((u, i) => ({
        previousOutpoint: { transactionId: u.outpoint.transactionId, index: u.outpoint.index },
        signatureScript: '', sequence: 0n, sigOpCount: i === 0 ? 0 : 1, utxo: u,
      })),
      outputs: orderedOut, lockTime: BigInt(lockTime), gas: 0n,
      subnetworkId: '0000000000000000000000000000000000000000', payload: '',
    });
    const ticketSigHex = createInputSignature(unsigned, 1, wallet.getPrivateKey(), SighashType.All);
    const ticketSig = ticketSigHex + '00' + _encodePushDataHex(Buffer.from(cmd.inputs.ticket.redeem_hex, 'hex'));
    const sigScripts = [poolSig, ticketSig];

    const signedTx = new Transaction({
      version: 0,
      inputs: matched.map((u, i) => ({
        previousOutpoint: { transactionId: u.outpoint.transactionId, index: u.outpoint.index },
        signatureScript: sigScripts[i], sequence: 0n, sigOpCount: i === 0 ? 0 : 1,
      })),
      outputs: orderedOut, lockTime: BigInt(lockTime), gas: 0n,
      subnetworkId: '0000000000000000000000000000000000000000', payload: '',
    });
    _assertTxInvariants(matched, signedTx, 'unlockBshardRefund', networkId);
    const r = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: r.transactionId };
  } finally { try { await rpc.disconnect(); } catch {} }
}

/**
 * unlockBshardClose — bshard_close_commit (PoolRoot close_commit entry OP_0, committee 4-of-5).
 * Inputs: [0] root (P2SH close_commit) + fee P2PK (wallet-signed). 委员 sig 从 cmd(driver 用 committee key 签 preimage).
 * Outputs: [root_out_idx] recreated root(closed=1, winningSide/payoutRoot 写入, value 不变) + change.
 * witness 声明序(close_commit): c0Sig,c1Sig,c2Sig,c3Sig,c4Sig, rootOutIdx, new_winningSide, new_payoutRoot.
 */
export async function unlockBshardClose(args) {
  const { wallet, cmd, networkId, lockTime = 0n } = args;
  const w = cmd.witness;
  const rpc = await connectRpc(networkId);
  try {
    const rootUtxo = await _matchUtxo(rpc, _addressFromRedeem(cmd.inputs.root.redeem_hex, networkId), cmd.inputs.root.outpointTxid);
    const feeUtxo = cmd.inputs.fee ? await _matchUtxo(rpc, cmd.inputs.fee.address, cmd.inputs.fee.outpointTxid, cmd.inputs.fee.index) : null;   // fee.index: P2PK fee 消歧 (KANet-UI 2026-06-20 STEP3: 同 addr+txid 2 UTXO ambiguous; 同 register/seal funding f.index)
    const matched = [rootUtxo, ...(feeUtxo ? [feeUtxo] : [])];

    const newRootAddr = _continuationAddress(cmd.inputs.root.redeem_hex, _serializeRootStateHex(cmd.outputs.root_continuation.state), networkId);
    const outputs = [];
    outputs[w.root_out_idx] = new TransactionOutput(BigInt(cmd.outputs.root_continuation.amountSompi), payToAddressScript(new Address(newRootAddr)));
    const orderedOut = outputs.filter(o => o !== undefined);
    _appendChange(orderedOut, matched, cmd.outputs.change_address);

    // root scriptSig: close_commit witness(声明序: c0-c4Sig + rootOutIdx + new_winningSide + new_payoutRoot)+ OP_0 + redeem.
    //   委员 5 sig 从 cmd.witness.sigs_hex(driver 用 baked committee key 对本 TX preimage 签; 4-of-5 → 至少 4 真签, 缺的占位).
    // committee_hash RootClose (KANet-UI 2026-06-20 集成): close_commit witness 声明序 = 5 pubkey(R8 hash-match)+ 5 sig + rootOutIdx + winningSide + payoutRoot.
    //   committee_pks 供则 push 5 pubkey 在 sig 前(RootClose); 不供则旧 PoolRoot 路(仅 sig, backward-compat).
    let pkPush = '';
    if (w.committee_pks) for (const pk of w.committee_pks) pkPush += _pushBytes(pk);   // 5×32B pubkey (hash-anchored, 不可 forge; J1 builder emit witness.committee_pks)
    let sigPush = '';
    for (const s of w.sigs_hex) sigPush += s;                 // 5 sig 直接 concat(createInputSignature 输出已 push-encoded 66B, 同 unlockPoolSpineP2SH L462/L944; _pushBytes 会 double-push=bug)
    // selector 参数化(同 seal_selector 教训, 别假设 ABI entry): RootClose close_commit ABI slot 由 caller 供; 默认 '00'(PoolRoot OP_0).
    const closeSelector = w.close_selector || cmd.inputs.root.close_selector_hex || '00';
    const rootSig = pkPush + sigPush + _pushInt(w.root_out_idx) + _pushInt(w.new_winning_side) + _pushBytes(w.new_payout_root)
      + closeSelector + _encodePushDataHex(Buffer.from(cmd.inputs.root.redeem_hex, 'hex'));

    // sighash 一致(committee sig 须对此 TX): txObjPreimage 由 driver 供(同 unlockPoolSpineP2SH); root sigOpCount=4(4-of-5 checkSig).
    let signedTx;
    if (cmd.tx_obj_preimage) {
      const parsed = JSON.parse(JSON.stringify(cmd.tx_obj_preimage));
      parsed.lockTime = BigInt(parsed.lockTime || lockTime); parsed.gas = BigInt(parsed.gas || 0);
      const feeSig = feeUtxo ? (() => {
        const un = new Transaction({ version:0, inputs: matched.map((u,i)=>({previousOutpoint:{transactionId:u.outpoint.transactionId,index:u.outpoint.index},signatureScript:'',sequence:0n,sigOpCount:i===0?4:1,utxo:u})), outputs:orderedOut, lockTime:BigInt(lockTime), gas:0n, subnetworkId:'0'.repeat(40), payload:'' });
        return createInputSignature(un, 1, wallet.getPrivateKey(), SighashType.All);
      })() : null;
      const sigScripts = feeUtxo ? [rootSig, feeSig] : [rootSig];
      parsed.inputs = parsed.inputs.map((inp,i)=>({ ...inp, signatureScript: sigScripts[i], sequence: BigInt(inp.sequence||0), sigOpCount: i===0?4:1, utxo: inp.utxo?{...inp.utxo, amount:BigInt(inp.utxo.amount||0), blockDaaScore:BigInt(inp.utxo.blockDaaScore||0)}:undefined }));
      parsed.outputs = parsed.outputs.map(o=>({ ...o, value: BigInt(o.value||0) }));
      signedTx = new Transaction(parsed);
    } else {
      throw new Error('unlockBshardClose: tx_obj_preimage required (committee sig sighash consistency)');
    }
    _assertTxInvariants(matched, signedTx, 'unlockBshardClose', networkId);
    const r = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: r.transactionId };
  } finally { try { await rpc.disconnect(); } catch {} }
}

/**
 * unlockBshardConvert — bshard_convert_to_foldnode (ShardLeaf convert_to_foldnode entry OP_1, leaf→FoldNode
 * foreign-template 桥; convert-split J1 2026-06-19, cherry-pick 进 canonical KANet-UI 2026-06-20 for full-chain stitch).
 * Sealed ShardLeaf (count==seal_count) → FoldNode genesis (4-field carry, NO outcome). 同构 unlockBshardSeal;
 * 差: selector OP_1('51'), 输出 4-field FoldNode state (_serializeLeafStateHex 非 root 的 7-field), witness {fnOutIdx, fn_prefix, fn_suffix}.
 */
export async function unlockBshardConvert(args) {
  const { wallet, cmd, networkId, lockTime = 0n } = args;
  const w = cmd.witness;
  const rpc = await connectRpc(networkId);
  try {
    const leafUtxo = await _matchUtxo(rpc, _addressFromRedeem(cmd.inputs.leaf.redeem_hex, networkId), cmd.inputs.leaf.outpointTxid);   // P2SH 地址 = hash(redeem)
    const fundUtxos = [];
    for (const f of (cmd.inputs.funding || [])) fundUtxos.push(await _matchUtxo(rpc, f.address, f.outpointTxid, f.index));   // f.index: funding 消歧 (KANet-UI fix, 同 register/seal)
    const matched = [leafUtxo, ...fundUtxos];

    // FoldNode 输出地址 relay 自算 (foreign-template; fn_prefix‖serialize4(state)‖fn_suffix). 4-field carry (no outcome).
    const fnAddr = _foreignTemplateAddress(w.fn_prefix_hex, _serializeLeafStateHex(cmd.outputs.foldnode.state), w.fn_suffix_hex, networkId);

    // leaf scriptSig: convert_to_foldnode witness(声明序: fnOutIdx, fn_prefix, fn_suffix) + selector OP_1 + redeem reveal. (无 sig: output 约束到 canonical FoldNode)
    const leafSig = _pushInt(w.fn_out_idx) + _pushBytes(w.fn_prefix_hex) + _pushBytes(w.fn_suffix_hex)
      + '51' + _encodePushDataHex(Buffer.from(cmd.inputs.leaf.redeem_hex, 'hex'));     // convert_to_foldnode=OP_1='51'

    const outputs = [];
    outputs[w.fn_out_idx] = new TransactionOutput(BigInt(cmd.outputs.foldnode.amountSompi), payToAddressScript(new Address(fnAddr)));
    const orderedOut = outputs.filter(o => o !== undefined);
    _appendChange(orderedOut, matched, cmd.outputs.change_address);   // relay 算 change=Σin−Σout−fee

    const unsigned = new Transaction({
      version: 0,
      inputs: matched.map((u, i) => ({
        previousOutpoint: { transactionId: u.outpoint.transactionId, index: u.outpoint.index },
        signatureScript: '', sequence: 0n, sigOpCount: i === 0 ? 0 : 1, utxo: u,   // leaf(0)=0 无 sig; funding=1
      })),
      outputs: orderedOut, lockTime: BigInt(lockTime), gas: 0n,
      subnetworkId: '0000000000000000000000000000000000000000', payload: '',
    });
    const sigScripts = [leafSig];
    for (let i = 1; i < matched.length; i++) {
      sigScripts.push(createInputSignature(unsigned, i, wallet.getPrivateKey(), SighashType.All));
    }
    const signedTx = new Transaction({
      version: 0,
      inputs: matched.map((u, i) => ({
        previousOutpoint: { transactionId: u.outpoint.transactionId, index: u.outpoint.index },
        signatureScript: sigScripts[i], sequence: 0n, sigOpCount: i === 0 ? 0 : 1,
      })),
      outputs: orderedOut, lockTime: BigInt(lockTime), gas: 0n,
      subnetworkId: '0000000000000000000000000000000000000000', payload: '',
    });
    _assertTxInvariants(matched, signedTx, 'unlockBshardConvert', networkId);
    const r = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: r.transactionId };
  } finally { try { await rpc.disconnect(); } catch {} }
}

/**
 * unlockBshardFold — bshard_fold (covenant __leader_fold OP_1 / __delegate_fold OP_2, k children → 1 parent).
 * 代码库首个 covenant relay handler. DECL: verification-mode cov leader 暴露 new_states(State[]); prev_states 自动从
 *   cov-inputs readInputState(不押). fold 无 extra arg → leader scriptSig = push(new_states=parent_state) + OP_1 + redeem.
 *   delegate(其余 children) scriptSig = OP_2 + redeem(无 witness, __delegate_f 不跑 policy 只 delegation 不变量).
 * Inputs: children[0]=leader + children[1..]=delegate + fee. Outputs: parent_continuation(per-state addr, value=Σchild) + change.
 * ⚠ e2e-定: new_states(State[1]) 押栈是否需 count 前缀未定(siblings[] 无 count→length 从 param; fold to=1 fixed→押 4-field leaf state 无 count
 *   是首选猜测). 首 fold TX 落=对; 拒→第一查 new_states count/格式。fold=leaf→leaf(PoolLeaf 4-field).
 */
export async function unlockBshardFold(args) {
  const { wallet, cmd, networkId, lockTime = 0n } = args;
  const w = cmd.witness;
  const rpc = await connectRpc(networkId);
  try {
    const children = cmd.inputs.children;
    const childUtxos = [];
    for (const c of children) childUtxos.push(await _matchUtxo(rpc, _addressFromRedeem(c.redeem_hex, networkId), c.outpointTxid));
    const feeUtxo = cmd.inputs.fee ? await _matchUtxo(rpc, cmd.inputs.fee.address, cmd.inputs.fee.outpointTxid, cmd.inputs.fee.index) : null;   // fee.index 消歧 (KANet-UI 2026-06-20 sweep; undefined→null=backward-compat)
    const matched = [...childUtxos, ...(feeUtxo ? [feeUtxo] : [])];

    // parent 续约地址: 任一 child redeem(同 PoolLeaf 模板)splice parent_state(4-field) → per-state P2SH. fold=leaf→leaf.
    const parentAddr = _continuationAddress(children[0].redeem_hex, _serializeLeafStateHex(w.parent_state), networkId);
    const outputs = [];
    outputs[w.parent_out_idx] = new TransactionOutput(BigInt(cmd.outputs.parent_continuation.amountSompi), payToAddressScript(new Address(parentAddr)));
    const orderedOut = outputs.filter(o => o !== undefined);
    _appendChange(orderedOut, matched, cmd.outputs.change_address);

    // children[0]=leader: push new_states(parent_state 7-field) + OP_1 + redeem; children[1..]=delegate: OP_2 + redeem.
    const sigScripts = [];
    for (let i = 0; i < children.length; i++) {
      const redeemPush = _encodePushDataHex(Buffer.from(children[i].redeem_hex, 'hex'));
      if (i === 0) sigScripts.push(_serializeLeafStateHex(w.parent_state) + '51' + redeemPush);   // leader __leader_fold=OP_1, push new_states(4-field parent)
      else sigScripts.push('52' + redeemPush);                                                    // delegate __delegate_fold=OP_2
    }

    const unsigned = new Transaction({
      version: 0,
      inputs: matched.map((u, i) => ({
        previousOutpoint: { transactionId: u.outpoint.transactionId, index: u.outpoint.index },
        signatureScript: '', sequence: 0n, sigOpCount: i < children.length ? 0 : 1, utxo: u,    // children 无 sig; fee=1
      })),
      outputs: orderedOut, lockTime: BigInt(lockTime), gas: 0n,
      subnetworkId: '0000000000000000000000000000000000000000', payload: '',
    });
    if (feeUtxo) sigScripts.push(createInputSignature(unsigned, children.length, wallet.getPrivateKey(), SighashType.All));

    const signedTx = new Transaction({
      version: 0,
      inputs: matched.map((u, i) => ({
        previousOutpoint: { transactionId: u.outpoint.transactionId, index: u.outpoint.index },
        signatureScript: sigScripts[i], sequence: 0n, sigOpCount: i < children.length ? 0 : 1,
      })),
      outputs: orderedOut, lockTime: BigInt(lockTime), gas: 0n,
      subnetworkId: '0000000000000000000000000000000000000000', payload: '',
    });
    _assertTxInvariants(matched, signedTx, 'unlockBshardFold', networkId);
    const r = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: r.transactionId };
  } finally { try { await rpc.disconnect(); } catch {} }
}

/**
 * unlockBshardSeal — bshard_seal_to_root (PoolLeaf seal_to_root entry OP_3, leaf→root foreign-template 桥).
 * route-split 引入: 全片折满的单 leaf(count==shard_count) → 创建 PoolRoot(携全池 KAS, canonical genesis outcome)。
 * Inputs: [0] leaf (P2SH seal_to_root, NO sig — permissionless, output 约束到 canonical root) + funding P2PK (wallet-签, 付 miner fee).
 * Outputs: [root_out_idx] PoolRoot UTXO (value == leaf.pool_value 全池) + change.
 *   root addr = payToScriptHash(root_prefix ‖ serialize(7-field sealed state) ‖ root_suffix) = SS validateOutputStateWithTemplate P2SH 派生口径.
 * witness 声明序(seal_to_root): rootOutIdx, root_prefix, root_suffix.
 * ⚠ seal 是 route-split 命门 entry: 跨模板 2× blake2b(~整 root) ~8982 units 估算, live TX 是 <9999 唯一 ground truth (本地无 metering).
 */
export async function unlockBshardSeal(args) {
  const { wallet, cmd, networkId, lockTime = 0n } = args;
  const w = cmd.witness;
  const rpc = await connectRpc(networkId);
  try {
    const leafUtxo = await _matchUtxo(rpc, _addressFromRedeem(cmd.inputs.leaf.redeem_hex, networkId), cmd.inputs.leaf.outpointTxid);   // P2SH 地址 = hash(redeem)
    const fundUtxos = [];
    for (const f of (cmd.inputs.funding || [])) fundUtxos.push(await _matchUtxo(rpc, f.address, f.outpointTxid, f.index));
    const matched = [leafUtxo, ...fundUtxos];

    // root 输出地址 relay 自算 (foreign-template; 忽略 cmd.address). sealed state = builder 供 7-field {carry account + closed:0/winningSide:0/payoutRoot:init}.
    const rootAddr = _foreignTemplateAddress(w.root_prefix_hex, _serializeRootStateHex(cmd.outputs.root.state), w.root_suffix_hex, networkId);

    // leaf scriptSig: seal_to_root witness(声明序: rootOutIdx, root_prefix, root_suffix) + selector + redeem reveal. (无 sig: output 约束到 canonical root)
    // selector = seal_to_root 在【本合约】的 ABI entry index (covenant fold 也占槽):
    //   PoolLeaf: register=OP_0/__leader_fold=OP_1/__delegate_fold=OP_2/seal_to_root=entry3=OP_3='53' (default).
    //   FoldNode: fold=entry0/seal_to_root=entry1=OP_1='51' (FoldNode.sil L52/L82, J2 实查 + UI 核 entrypoint 序).
    // 错 selector → dispatch no-match → OpFalse OpVerify → VerifyError(seal body 不执行).
    // 字段双读 reconcile (KANet-UI 2026-06-20 集成 catch): J1 production buildSealToRootCommand emit witness.seal_selector;
    //   早期 probe harness 用 cmd.inputs.leaf.seal_selector_hex. 两个都接, witness 主(生产 builder 路) → 默认 '53'(PoolLeaf).
    //   FoldNode seal=OP_2('52'); convert_to_claim=OP_2('52'); convert_to_refundclaim=OP_3('53'); PoolLeaf seal=OP_3('53').
    const sealSelector = w.seal_selector || cmd.inputs.leaf.seal_selector_hex || '53';
    const leafSig = _pushInt(w.root_out_idx) + _pushBytes(w.root_prefix_hex) + _pushBytes(w.root_suffix_hex)
      + sealSelector + _encodePushDataHex(Buffer.from(cmd.inputs.leaf.redeem_hex, 'hex'));

    const outputs = [];
    outputs[w.root_out_idx] = new TransactionOutput(BigInt(cmd.outputs.root.amountSompi), payToAddressScript(new Address(rootAddr)));
    const orderedOut = outputs.filter(o => o !== undefined);
    _appendChange(orderedOut, matched, cmd.outputs.change_address);   // relay 算 change=Σin−Σout−fee (leaf 全池→root, fee 来自 funding)

    const unsigned = new Transaction({
      version: 0,
      inputs: matched.map((u, i) => ({
        previousOutpoint: { transactionId: u.outpoint.transactionId, index: u.outpoint.index },
        signatureScript: '', sequence: 0n, sigOpCount: i === 0 ? 0 : 1, utxo: u,   // leaf(0)=0 无 sig; funding=1
      })),
      outputs: orderedOut, lockTime: BigInt(lockTime), gas: 0n,
      subnetworkId: '0000000000000000000000000000000000000000', payload: '',
    });
    const sigScripts = [leafSig];
    for (let i = 1; i < matched.length; i++) {
      sigScripts.push(createInputSignature(unsigned, i, wallet.getPrivateKey(), SighashType.All));
    }
    const signedTx = new Transaction({
      version: 0,
      inputs: matched.map((u, i) => ({
        previousOutpoint: { transactionId: u.outpoint.transactionId, index: u.outpoint.index },
        signatureScript: sigScripts[i], sequence: 0n, sigOpCount: i === 0 ? 0 : 1,
      })),
      outputs: orderedOut, lockTime: BigInt(lockTime), gas: 0n,
      subnetworkId: '0000000000000000000000000000000000000000', payload: '',
    });
    _assertTxInvariants(matched, signedTx, 'unlockBshardSeal', networkId);
    const r = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: r.transactionId };
  } finally { try { await rpc.disconnect(); } catch {} }
}
