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

    // Bettor single-sig (= PoolSide_v07.sil L271 require(checkSig(bettorSig, pubkey(bettorPk)))).
    const bettorSigHex = createInputSignature(unsignedTx, 0, wallet.getPrivateKey(), SighashType.All);

    // scriptSig: [bettorSig push] + selector OP (= entry index) + [redeemScript push].
    // J2-tn r391: entryIndex param decides selector — OP_2='52' for v06/v07, OP_3='53' for legacy v0.5.
    const sideRedeemBytes = Buffer.from(sideRedeemScriptHex, 'hex');
    const sideRedeemPushHex = _encodePushDataHex(sideRedeemBytes);
    if (entryIndex < 1 || entryIndex > 16) throw new Error(`entryIndex must be 1-16 (OP_N), got ${entryIndex}`);
    const selectorOpHex = (0x50 + entryIndex).toString(16).padStart(2, '0');
    const scriptSigHex = bettorSigHex + selectorOpHex + sideRedeemPushHex;

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

    _assertTxInvariants(matched, signedTx, 'unlockPoolSideRefundCancelled', networkId);
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
 * @param {string} address - target address (P2SH or P2PK) the transfer paid to
 * @param {string} txid - the transfer TX id
 * @param {string} networkId
 * @returns {Promise<{ landed: boolean }>}
 */
export async function checkUtxoLanded(address, txid, networkId) {
  const rpc = await connectRpc(networkId);
  try {
    const { entries } = await rpc.getUtxosByAddresses([address]);
    const landed = (entries || []).some(e => e.outpoint?.transactionId === txid);
    return { landed };
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

function _i64LE(v) {               // BigInt/number → 8-byte LE Buffer (固定 i64, 非最小)
  const b = Buffer.alloc(8);
  let n = BigInt(v);
  if (n < 0n) n = (1n << 64n) + n;   // two's complement (State 值非负, 防御)
  for (let i = 0; i < 8; i++) { b[i] = Number(n & 0xffn); n >>= 8n; }
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
  return _encodePushDataHex(_i64LE(s.local_yes))
    + _encodePushDataHex(_i64LE(s.local_no))
    + _encodePushDataHex(_i64LE(s.count))
    + _encodePushDataHex(_i64LE(s.pool_value))
    + _encodePushDataHex(_i64LE(s.closed))
    + _encodePushDataHex(_i64LE(s.winningSide))
    + _encodePushDataHex(Buffer.from(s.payoutRoot.replace(/^0x/, ''), 'hex'));   // PUSH32 + 32B
}

// per-state 续约 P2SH 地址: splice input redeem 的 state 区[start : start+len] → new state → payToScriptHash.
//   len = newStateHex 字节数 (leaf 36 / root 87 自适应; new state 与 baked genesis state 同布局=同长).
function _continuationAddress(inputRedeemHex, newStateHex, networkId) {
  const redeem = Buffer.from(inputRedeemHex, 'hex');
  const stateBytes = Buffer.from(newStateHex, 'hex');
  if (stateBytes.length !== _LEAF_STATE_LEN && stateBytes.length !== _ROOT_STATE_LEN) {
    throw new Error(`pool state ser ${stateBytes.length}B != leaf ${_LEAF_STATE_LEN} / root ${_ROOT_STATE_LEN}`);
  }
  const len = stateBytes.length;
  const spliced = Buffer.concat([redeem.slice(0, _POOL_STATE_START), stateBytes, redeem.slice(_POOL_STATE_START + len)]);
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

const _BSHARD_MINER_FEE = 10000n;   // 0.0001 KAS, within SS fee 范围 [1000, 1e8]
function _utxoValue(u) { return BigInt(u.amount ?? u.utxoEntry?.amount ?? u.entry?.amount ?? 0); }
// relay 算 change(Bettor 裁: relay fetch UTXO 后才知真 Σinput+fee): change = Σin − Σ业务out − minerFee.
function _appendChange(orderedOut, matched, changeAddress) {
  const sumIn = matched.reduce((a, u) => a + _utxoValue(u), 0n);
  const sumOut = orderedOut.reduce((a, o) => a + BigInt(o.value), 0n);
  const change = sumIn - sumOut - _BSHARD_MINER_FEE;
  if (change < 0n) throw new Error(`bshard insufficient input: Σin ${sumIn} < Σout ${sumOut} + fee ${_BSHARD_MINER_FEE}`);
  if (change >= 1000n && changeAddress) orderedOut.push(new TransactionOutput(change, payToAddressScript(new Address(changeAddress))));
  return orderedOut;
}

// 取 UTXO by outpoint txid at a P2SH/address (单一匹配).
async function _matchUtxo(rpc, address, outpointTxid) {
  const { entries } = await rpc.getUtxosByAddresses([address]);
  const hits = (entries || []).filter(e => e.outpoint.transactionId === outpointTxid);
  if (hits.length === 0) throw new Error(`UTXO not found at ${address} for tx ${outpointTxid}`);
  if (hits.length > 1) throw new Error(`ambiguous ${hits.length} UTXOs at ${address} from ${outpointTxid}`);
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
    for (const f of (cmd.inputs.funding || [])) fundUtxos.push(await _matchUtxo(rpc, f.address, f.outpointTxid));

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
    _appendChange(orderedOut, matched, cmd.outputs.change_address);   // relay 算 change=Σin−Σout−fee
    // unsigned (funding inputs 留空待签; leaf 无 sig 直接置 scriptSig)
    const unsigned = new Transaction({
      version: 0,
      inputs: matched.map((u, i) => ({
        previousOutpoint: { transactionId: u.outpoint.transactionId, index: u.outpoint.index },
        signatureScript: '', sequence: 0n, sigOpCount: i === 0 ? 0 : 1, utxo: u,
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
    const feeUtxo = cmd.inputs.fee ? await _matchUtxo(rpc, cmd.inputs.fee.address, cmd.inputs.fee.outpointTxid) : null;
    const matched = [rootUtxo, ticketUtxo, ...(feeUtxo ? [feeUtxo] : [])];

    const newRootAddr = _continuationAddress(cmd.inputs.root.redeem_hex, _serializeRootStateHex(cmd.outputs.root_continuation.state), networkId);
    const bettorLockSpk = payToAddressScript(new Address(cmd.outputs.payout.address));

    const outputs = [];
    outputs[w.payout_out_idx] = new TransactionOutput(BigInt(cmd.outputs.payout.amountSompi), bettorLockSpk);
    outputs[w.root_out_idx] = new TransactionOutput(BigInt(cmd.outputs.root_continuation.amountSompi), payToAddressScript(new Address(newRootAddr)));
    const orderedOut = outputs.filter(o => o !== undefined);
    _appendChange(orderedOut, matched, cmd.outputs.change_address);   // relay 算 change=Σin−Σout−fee

    // root scriptSig: claim_draw witness(声明序: rootOutIdx,payoutOutIdx,payout,merkle_index,tree_depth,siblings[],ticketInIdx,prefix/suffix_len)+ OP_4 + redeem.
    let sibPush = '';
    for (const s of w.siblings_hex) sibPush += _pushBytes(s);     // byte[32][] = depth 个 push, forward 序
    const rootSig = _pushInt(w.root_out_idx) + _pushInt(w.payout_out_idx) + _pushInt(w.payout)
      + _pushInt(w.merkle_index) + _pushInt(w.tree_depth) + sibPush
      + _pushInt(w.ticket_in_idx) + _pushInt(w.ticket_prefix_len) + _pushInt(w.ticket_suffix_len)
      + '51' + _encodePushDataHex(Buffer.from(cmd.inputs.root.redeem_hex, 'hex'));     // claim_draw=OP_1='51' (PoolRoot; was unified OP_4)

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
    const ticketSig = ticketSigHex + '00' + _encodePushDataHex(Buffer.from(cmd.inputs.ticket.redeem_hex, 'hex'));   // OP_0 selector
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
    const feeUtxo = cmd.inputs.fee ? await _matchUtxo(rpc, cmd.inputs.fee.address, cmd.inputs.fee.outpointTxid) : null;
    const matched = [rootUtxo, ...(feeUtxo ? [feeUtxo] : [])];

    const newRootAddr = _continuationAddress(cmd.inputs.root.redeem_hex, _serializeRootStateHex(cmd.outputs.root_continuation.state), networkId);
    const outputs = [];
    outputs[w.root_out_idx] = new TransactionOutput(BigInt(cmd.outputs.root_continuation.amountSompi), payToAddressScript(new Address(newRootAddr)));
    const orderedOut = outputs.filter(o => o !== undefined);
    _appendChange(orderedOut, matched, cmd.outputs.change_address);

    // root scriptSig: close_commit witness(声明序: c0-c4Sig + rootOutIdx + new_winningSide + new_payoutRoot)+ OP_0 + redeem.
    //   委员 5 sig 从 cmd.witness.sigs_hex(driver 用 baked committee key 对本 TX preimage 签; 4-of-5 → 至少 4 真签, 缺的占位).
    let sigPush = '';
    for (const s of w.sigs_hex) sigPush += s;                 // 5 sig 直接 concat(createInputSignature 输出已 push-encoded 66B, 同 unlockPoolSpineP2SH L462/L944; _pushBytes 会 double-push=bug)
    const rootSig = sigPush + _pushInt(w.root_out_idx) + _pushInt(w.new_winning_side) + _pushBytes(w.new_payout_root)
      + '00' + _encodePushDataHex(Buffer.from(cmd.inputs.root.redeem_hex, 'hex'));     // close_commit=OP_0='00' (PoolRoot; was unified OP_3)

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
    const feeUtxo = cmd.inputs.fee ? await _matchUtxo(rpc, cmd.inputs.fee.address, cmd.inputs.fee.outpointTxid) : null;
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
    for (const f of (cmd.inputs.funding || [])) fundUtxos.push(await _matchUtxo(rpc, f.address, f.outpointTxid));
    const matched = [leafUtxo, ...fundUtxos];

    // root 输出地址 relay 自算 (foreign-template; 忽略 cmd.address). sealed state = builder 供 7-field {carry account + closed:0/winningSide:0/payoutRoot:init}.
    const rootAddr = _foreignTemplateAddress(w.root_prefix_hex, _serializeRootStateHex(cmd.outputs.root.state), w.root_suffix_hex, networkId);

    // leaf scriptSig: seal_to_root witness(声明序: rootOutIdx, root_prefix, root_suffix) + selector OP_3 + redeem reveal. (无 sig: output 约束到 canonical root)
    const leafSig = _pushInt(w.root_out_idx) + _pushBytes(w.root_prefix_hex) + _pushBytes(w.root_suffix_hex)
      + '53' + _encodePushDataHex(Buffer.from(cmd.inputs.leaf.redeem_hex, 'hex'));     // seal_to_root=OP_3='53'

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
