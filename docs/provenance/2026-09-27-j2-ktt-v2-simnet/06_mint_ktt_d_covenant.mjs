// 06_mint_ktt_d_covenant.mjs — mint KTT-D: owner_scheme=0x04(covenant-id), owner=Carol's KTT
// covenant_id — spendable only in-presence of Carol's KTT input(same tx). Sets up the mixed-scheme
// same-tx demo(NWT adversarial #4).
import { readFileSync } from 'node:fs';
import { kaspa, computeKttV2TokenArtifact, getRpc, FUND_PRIV_HEX, FUND_ADDR } from './common.mjs';

const carol = JSON.parse(readFileSync('./carol_info.json', 'utf8'));
const rpc = await getRpc();
try {
  const fundPriv = new kaspa.PrivateKey(FUND_PRIV_HEX);
  const { entries } = await rpc.getUtxosByAddresses({ addresses: [FUND_ADDR] });
  const dag = await rpc.getBlockDagInfo();
  const matureCutoff = dag.virtualDaaScore - 1000n;
  const fundEntry = entries.find(e => BigInt(e.entry.amount) > 1_000_000_000n && BigInt(e.entry.blockDaaScore) < matureCutoff);
  const fundAmt = BigInt(fundEntry.entry.amount);
  const fee = 850_000n;
  const AMOUNT = fundAmt - fee;

  const artifact = computeKttV2TokenArtifact({ amount: Number(AMOUNT), ownerScheme: 4, ownerBytesHex: carol.covId });
  console.log('KTT-D scriptPubKeyHex:', artifact.scriptPubKeyHex);
  const outputs = [new kaspa.TransactionOutput(AMOUNT, new kaspa.ScriptPublicKey(0, artifact.scriptPubKeyHex.slice(2)))];
  const mk = (ss) => {
    const t = new kaspa.Transaction({
      version: 1,
      inputs: [{ previousOutpoint: fundEntry.outpoint, signatureScript: ss, sequence: 0n, sigOpCount: 0, computeBudget: 70, ...(ss === '' ? { utxo: fundEntry.entry } : {}) }],
      outputs, lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
    });
    t.populateGenesisCovenants([new kaspa.GenesisCovenantGroup(0, [0])]);
    return t;
  };
  const unsigned = mk('');
  const covId = String(unsigned.outputs[0].covenant.covenantId);
  const sigHex = kaspa.createInputSignature(unsigned, 0, fundPriv, kaspa.SighashType.All);
  const signedTx = mk(sigHex);
  const result = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
  console.log('KTT-D genesis txid:', result.transactionId);
  console.log(JSON.stringify({ scriptPubKeyHex: artifact.scriptPubKeyHex, redeemScriptHex: Buffer.from(artifact.script).toString('hex'), amount: AMOUNT.toString(), covId, ownerIsCarolCovId: carol.covId }));
} finally { await rpc.disconnect(); }
