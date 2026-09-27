// 01_mint_ktt_a.mjs — mint KTT-A: KanetTestTokenV2 genesis, owner_scheme=0x00(pubkey), owner=Alice.
import { kaspa, computeKttV2TokenArtifact, getRpc, xOnlyPubkeyHex, FUND_PRIV_HEX, FUND_ADDR } from './common.mjs';

const alicePriv = new kaspa.PrivateKey('aa'.repeat(32));
const aliceXOnly = xOnlyPubkeyHex(alicePriv);
console.log('alice xOnly pubkey:', aliceXOnly);

const rpc = await getRpc();
try {
  const fundPriv = new kaspa.PrivateKey(FUND_PRIV_HEX);
  const { entries } = await rpc.getUtxosByAddresses({ addresses: [FUND_ADDR] });
  const fundEntry = entries.find(e => BigInt(e.entry?.amount ?? e.amount ?? 0) > 1_000_000_000n);
  if (!fundEntry) throw new Error('no suitable funding UTXO found');
  const fundAmt = BigInt(fundEntry.entry?.amount ?? fundEntry.amount ?? 0);
  // 实测(上一次尝试): compute mass 7671 -> 需要 767,100 sompi(100 sompi/gram, 记忆: kaspa v2.0.1
  // min relay fee)。留余量到 850,000。
  const fee = 850_000n;
  // 🔴 实测发现(本次真实广播撞到, 非猜测): 第一次尝试用小面值(5,000,000 sompi, 悬殊 funding ~39 KAS
  // 780 倍)被拒 "transaction storage mass of 800000 is larger than max allowed size of 500000"——KIP-9
  // storage mass 对"大额输入拆成小额 covenant 输出+大额找零"这种形状按更高倍率计(记忆: covenant UTXO
  // plurality=p2 非 p1)。修法: KTT 面值 = funding 全额减手续费, 不留找零, 消除这种价值压缩形状。
  const AMOUNT = fundAmt - fee;

  const artifact = computeKttV2TokenArtifact({ amount: Number(AMOUNT), ownerScheme: 0, ownerBytesHex: aliceXOnly });
  console.log('KTT-A scriptPubKeyHex:', artifact.scriptPubKeyHex);
  console.log('KTT-A templateHashHex:', artifact.templateHashHex);

  // artifact.scriptPubKeyHex = '0x' + 'aa20'+hash+'87' (RAW script bytes, no 2-byte version prefix —
  // _kttP2sh in pool-bshard-artifacts.mjs builds it directly, same convention as existing v1 callers).
  const ktScriptOnly = artifact.scriptPubKeyHex.slice(2);
  const outputs = [new kaspa.TransactionOutput(AMOUNT, new kaspa.ScriptPublicKey(0, ktScriptOnly))];

  const mk = (ss) => {
    const t = new kaspa.Transaction({
      version: 1,
      inputs: [{ previousOutpoint: fundEntry.outpoint, signatureScript: ss, sequence: 0n, sigOpCount: 0, computeBudget: 70, ...(ss === '' ? { utxo: fundEntry.entry ?? fundEntry } : {}) }],
      outputs, lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
    });
    t.populateGenesisCovenants([new kaspa.GenesisCovenantGroup(0, [0])]);
    return t;
  };
  const unsigned = mk('');
  const covId = String(unsigned.outputs[0].covenant.covenantId);
  console.log('KTT-A covenant_id:', covId);
  const sigHex = kaspa.createInputSignature(unsigned, 0, fundPriv, kaspa.SighashType.All);
  const signedTx = mk(sigHex);
  const result = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
  console.log('KTT-A genesis txid:', result.transactionId);
  console.log(JSON.stringify({ aliceXOnly, alicePrivHex: alicePriv.toString(), amount: AMOUNT.toString(), covId, txid: result.transactionId, outpointIndex: 0, scriptPubKeyHex: artifact.scriptPubKeyHex, redeemScriptHex: Buffer.from(artifact.script).toString('hex'), entryAbi: artifact.entryAbi, stateFieldCount: artifact.stateFieldCount }, null, 2));
} finally { await rpc.disconnect(); }
