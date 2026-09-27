// 09_relay_handler_smoke_test.mjs — verify the PRODUCTION relay handlers(unlockKttV2Mint/
// unlockKttV2Transfer in kasia-relay/src/lib/p2sh.mjs) themselves work, not just my scratch scripts.
// console-side: compute artifacts via computeKttV2TokenArtifact(pool-bshard-artifacts.mjs).
import { kaspa, computeKttV2TokenArtifact, getRpc, xOnlyPubkeyHex, FUND_PRIV_HEX, FUND_ADDR } from './common.mjs';
const { unlockKttV2Mint, unlockKttV2Transfer } = await import('file:///D:/kanet-tn12/scratch/_j2_wt_ktt_panel/kasia-relay/src/lib/p2sh.mjs');

const fundPriv = new kaspa.PrivateKey(FUND_PRIV_HEX);
const wallet = { getPrivateKey: () => fundPriv, getNetworkId: () => 'simnet' }; // minimal mock matching relay's usage shape
const frankXOnly = xOnlyPubkeyHex(fundPriv); // "wallet's own" pubkey, per unlockKttV2Transfer's design premise

const rpc = await getRpc();
try {
  const dag = await rpc.getBlockDagInfo();
  const matureCutoff = dag.virtualDaaScore - 1000n;
  const { entries } = await rpc.getUtxosByAddresses({ addresses: [FUND_ADDR] });
  const fundEntry = entries.find(e => BigInt(e.entry.amount) > 1_000_000_000n && BigInt(e.entry.blockDaaScore) < matureCutoff);
  const fundAmt = BigInt(fundEntry.entry.amount);
  const seed = fundAmt - 1_200_000n; // relay 自己算 fee=_bshardFeeV1(1), 留够余量

  // console-side: compute the mint artifact for owner_scheme=0x00, owner=wallet's own pubkey.
  const mintArt = computeKttV2TokenArtifact({ amount: Number(seed), ownerScheme: 0, ownerBytesHex: frankXOnly });
  const mintCmd = { ktt: { redeem_hex: Buffer.from(mintArt.script).toString('hex'), seed_sompi: seed.toString() }, inputs: { funding: { address: FUND_ADDR, outpointTxid: fundEntry.outpoint.transactionId, index: fundEntry.outpoint.index } } };
  const mintResult = await unlockKttV2Mint({ wallet, cmd: mintCmd, networkId: 'simnet', lockTime: 0n });
  console.log('RELAY HANDLER mint result:', JSON.stringify(mintResult));

  for (let i = 0; i < 3; i++) { const tpl = await rpc.getBlockTemplate({ payAddress: FUND_ADDR, extraData: [] }); await rpc.submitBlock({ block: tpl.block, allowNonDAABlocks: true }); }

  const kttSpk = new kaspa.ScriptPublicKey(0, mintArt.scriptPubKeyHex.slice(2));
  const kttAddr = kaspa.addressFromScriptPublicKey(kttSpk, 'simnet').toString();
  const { entries: kttEntries } = await rpc.getUtxosByAddresses({ addresses: [kttAddr] });
  if (!kttEntries.length) throw new Error('relay handler mint did not land');
  console.log('relay-handler-minted UTXO covenantId:', String(kttEntries[0].entry.covenantId));

  // ── transfer via relay handler: transfer to Grace's pubkey ──
  const gracePriv = new kaspa.PrivateKey('56'.repeat(32));
  const graceXOnly = xOnlyPubkeyHex(gracePriv);
  const destArt = computeKttV2TokenArtifact({ amount: Number(seed), ownerScheme: 0, ownerBytesHex: graceXOnly });
  const { entries: feeEntries } = await rpc.getUtxosByAddresses({ addresses: [FUND_ADDR] });
  const feeUtxo = feeEntries.find(e => BigInt(e.entry.amount) > 1_000_000n && BigInt(e.entry.blockDaaScore) < matureCutoff);

  const xferCmd = {
    ktt: { source_redeem_hex: Buffer.from(mintArt.script).toString('hex'), dest_redeem_hex: Buffer.from(destArt.script).toString('hex'), dest_owner_hex: graceXOnly, dest_owner_scheme: 0 },
    inputs: { ktt: { address: kttAddr, outpointTxid: kttEntries[0].outpoint.transactionId, index: kttEntries[0].outpoint.index }, fee: { address: FUND_ADDR, outpointTxid: feeUtxo.outpoint.transactionId, index: feeUtxo.outpoint.index } },
    outputs: { fee_change_address: FUND_ADDR },
  };
  const xferResult = await unlockKttV2Transfer({ wallet, cmd: xferCmd, networkId: 'simnet', lockTime: 0n });
  console.log('RELAY HANDLER transfer result:', JSON.stringify(xferResult));

  for (let i = 0; i < 3; i++) { const tpl = await rpc.getBlockTemplate({ payAddress: FUND_ADDR, extraData: [] }); await rpc.submitBlock({ block: tpl.block, allowNonDAABlocks: true }); }
  const graceSpk = new kaspa.ScriptPublicKey(0, destArt.scriptPubKeyHex.slice(2));
  const graceAddr = kaspa.addressFromScriptPublicKey(graceSpk, 'simnet').toString();
  const { entries: graceEntries } = await rpc.getUtxosByAddresses({ addresses: [graceAddr] });
  const pass = graceEntries.length === 1 && String(graceEntries[0].entry.covenantId) !== 'undefined';
  console.log('Grace UTXO:', graceEntries.length, graceEntries[0] ? { covId: String(graceEntries[0].entry.covenantId), amount: graceEntries[0].entry.amount.toString() } : null);
  console.log(pass ? 'RELAY HANDLER SMOKE TEST: PASS' : 'RELAY HANDLER SMOKE TEST: FAIL');
} finally { await rpc.disconnect(); }
