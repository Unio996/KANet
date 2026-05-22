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
      networkId: wallet.getNetworkId(),
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

    // Submit
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

    // Compute redeem script push via ScriptBuilder (reuse Bettor pattern from unlockP2SH line 207-208)
    const redeemPushSb = new ScriptBuilder();
    redeemPushSb.addData(redeemScript);
    const redeemPushHex = redeemPushSb.toString();

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
    unanimous, networkId, lockTime = 0n, txObjPreimage = null,
  } = args;

  if (!unanimous) throw new Error('Phase 2c step 2a first ship supports unanimous only — forfeit_1 entry 1 deferred next step');
  if (winner !== 0 && winner !== 1) throw new Error(`winner must be 0 or 1, got ${winner}`);
  if (!Array.isArray(sideP2shAddresses) || !Array.isArray(sideRedeemScriptHexes)) throw new Error('sideP2shAddresses and sideRedeemScriptHexes required arrays');
  if (sideP2shAddresses.length !== sideRedeemScriptHexes.length) throw new Error(`side count mismatch: ${sideP2shAddresses.length} addresses vs ${sideRedeemScriptHexes.length} redeem scripts`);
  // Spine P2SH has spineInputCount UTXOs (= 1 maker stake + N oracle bonds).
  if (!Number.isInteger(spineInputCount) || spineInputCount < 1) throw new Error(`spineInputCount must be ≥1, got ${spineInputCount}`);
  if (!Array.isArray(spineSigsByInput) || spineSigsByInput.length !== spineInputCount) {
    throw new Error(`spineSigsByInput must be ${spineInputCount} arrays, got ${spineSigsByInput?.length}`);
  }
  if (spineSigsByInput.some(sigs => !Array.isArray(sigs) || sigs.length !== 3)) {
    throw new Error('each spine input requires 3 oracle sigs for unanimous');
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
    const selectorOpHex = '00';

    const rootBytes = new Uint8Array(Buffer.from(sidesMerkleRootHex.replace(/^0x/, ''), 'hex'));
    if (rootBytes.length !== 32) throw new Error(`sidesMerkleRoot must be 32 bytes, got ${rootBytes.length}`);
    const rootPushSb = new ScriptBuilder();
    rootPushSb.addData(rootBytes);
    const rootPushHex = rootPushSb.toString();

    const spineRedeemBytes = new Uint8Array(Buffer.from(spineRedeemScriptHex, 'hex'));
    const spineRedeemPushSb = new ScriptBuilder();
    spineRedeemPushSb.addData(spineRedeemBytes);
    const spineRedeemPushHex = spineRedeemPushSb.toString();

    // Each spine input gets its own scriptSig (= own 3 sigs over that input's sighash).
    const spineScriptSigs = spineSigsByInput.map(sigs =>
      sigs.join('') + winnerOpHex + rootPushHex + selectorOpHex + spineRedeemPushHex
    );

    const sideScriptSigs = sideRedeemScriptHexes.map(redeemHex => {
      const redeemBytes = new Uint8Array(Buffer.from(redeemHex, 'hex'));
      const sb = new ScriptBuilder();
      sb.addData(redeemBytes);
      return selectorOpHex + sb.toString();
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
      signedTx = new Transaction({
        version: 0,
        inputs: matched.map((utxo, i) => ({
          previousOutpoint: { transactionId: utxo.outpoint.transactionId, index: utxo.outpoint.index },
          signatureScript: allScriptSigs[i],
          sequence: 0n,
          sigOpCount: i < spineInputCount ? 3 : 0,
        })),
        outputs: txOutputs,
        lockTime: txLockTime,
        gas: 0n,
        subnetworkId: '0000000000000000000000000000000000000000',
        payload: '',
      });
    }

    const result = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    return { txId: result.transactionId };
  } finally {
    try { await rpc.disconnect(); } catch {}
  }
}
