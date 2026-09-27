// 08_sdk_smoke_test.mjs — verify ktt-v2-sdk.mjs(production module) itself, not the scratch scripts,
// produces a valid real mint + transfer(this is what console/relay will actually call).
import { kaspa, getRpc, xOnlyPubkeyHex, FUND_PRIV_HEX, FUND_ADDR } from './common.mjs';
const { buildKttV2MintTx, buildKttV2TransferTx, toAbiSigHex } = await import('file:///D:/kanet-tn12/scratch/_j2_wt_ktt_panel/kasia-console/src/lib/kcc20-token/ktt-v2-sdk.mjs');

const davePriv = new kaspa.PrivateKey('12'.repeat(32));
const daveXOnly = xOnlyPubkeyHex(davePriv);
const evePriv = new kaspa.PrivateKey('34'.repeat(32));
const eveXOnly = xOnlyPubkeyHex(evePriv);

const rpc = await getRpc();
try {
  const fundPriv = new kaspa.PrivateKey(FUND_PRIV_HEX);
  const dag = await rpc.getBlockDagInfo();
  const matureCutoff = dag.virtualDaaScore - 1000n;
  const { entries } = await rpc.getUtxosByAddresses({ addresses: [FUND_ADDR] });
  const fundEntry = entries.find(e => BigInt(e.entry.amount) > 1_000_000_000n && BigInt(e.entry.blockDaaScore) < matureCutoff);

  // ── MINT via SDK ──
  const { unsignedTx, mkSigned, amountSompi, artifact } = buildKttV2MintTx(kaspa, fundEntry, 0, daveXOnly);
  const sigHex = kaspa.createInputSignature(unsignedTx, 0, fundPriv, kaspa.SighashType.All);
  const signedMint = mkSigned(sigHex);
  const mintResult = await rpc.submitTransaction({ transaction: signedMint, allowOrphan: false });
  console.log('SDK MINT txid:', mintResult.transactionId, 'amount:', amountSompi.toString());

  // mine to confirm
  for (let i = 0; i < 3; i++) { const tpl = await rpc.getBlockTemplate({ payAddress: FUND_ADDR, extraData: [] }); await rpc.submitBlock({ block: tpl.block, allowNonDAABlocks: true }); }

  const kttSpk = new kaspa.ScriptPublicKey(0, artifact.scriptPubKeyHex.slice(2));
  const kttAddr = kaspa.addressFromScriptPublicKey(kttSpk, 'simnet').toString();
  const { entries: kttEntries } = await rpc.getUtxosByAddresses({ addresses: [kttAddr] });
  if (!kttEntries.length) throw new Error('SDK mint did not land');
  const kttUtxo = kttEntries[0];
  console.log('SDK MINT landed, covenantId:', String(kttUtxo.entry.covenantId));

  // ── TRANSFER via SDK ──
  const { entries: feeEntries } = await rpc.getUtxosByAddresses({ addresses: [FUND_ADDR] });
  const feeUtxo = feeEntries.find(e => BigInt(e.entry.amount) > 1_000_000n && BigInt(e.entry.blockDaaScore) < matureCutoff);
  const { unsignedTx: unsignedXfer, mkSigned: mkSignedXfer, destArtifact } = buildKttV2TransferTx(
    kaspa, kttUtxo, Buffer.from(artifact.script).toString('hex'), eveXOnly, 0, feeUtxo, FUND_ADDR
  );
  const daveSigRaw = kaspa.createInputSignature(unsignedXfer, 0, davePriv, kaspa.SighashType.All);
  const feeSigHex = kaspa.createInputSignature(unsignedXfer, 1, fundPriv, kaspa.SighashType.All);
  const signedXfer = mkSignedXfer({ kttSigHex: toAbiSigHex(daveSigRaw), feeSigHex });
  const xferResult = await rpc.submitTransaction({ transaction: signedXfer, allowOrphan: false });
  console.log('SDK TRANSFER txid:', xferResult.transactionId);

  for (let i = 0; i < 3; i++) { const tpl = await rpc.getBlockTemplate({ payAddress: FUND_ADDR, extraData: [] }); await rpc.submitBlock({ block: tpl.block, allowNonDAABlocks: true }); }
  const eveSpk = new kaspa.ScriptPublicKey(0, destArtifact.scriptPubKeyHex.slice(2));
  const eveAddr = kaspa.addressFromScriptPublicKey(eveSpk, 'simnet').toString();
  const { entries: eveEntries } = await rpc.getUtxosByAddresses({ addresses: [eveAddr] });
  console.log('Eve UTXO count:', eveEntries.length, eveEntries[0] ? { covId: String(eveEntries[0].entry.covenantId), amount: eveEntries[0].entry.amount.toString() } : null);
  console.log(eveEntries.length === 1 && String(eveEntries[0].entry.covenantId) !== 'undefined' ? 'SDK SMOKE TEST: PASS' : 'SDK SMOKE TEST: FAIL');
} finally { await rpc.disconnect(); }
