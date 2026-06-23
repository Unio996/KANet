// NWT 独立红队 (verify-value-source): 验 J1 D2 + C2 闭【真闭非 vacuous】(commit 86523223), verify-not-echo。
//   独立构造 (不复用 J1 test 的 splice mimic): D2 的 honest continuation 用【两条独立路】triangulate —
//     (A) silverc 重编 closed=1+payoutRoot ctor (= _j2_A_close_attest 口径)
//     (B) relay-faithful _serializePayoutStateHex + 全 state 区替换 (= p2sh.mjs _continuationAddress 口径)
//   两路 P2SH 必 byte-equal, 且 J1 的 verifyClosePayoutRootBinding (内部第三条 splice 路) 必接受 → 3-impl byte-match。
//   再跑命名攻击: 假根-标量(D2) / move-binding-decoy(D2) / version-0(D2 NWT新) / 子集-委员(C2) / DB-relay假root(C2)。
import { verifyClosePayoutRootBinding, reDeriveCommittee, extractOnChainPoolMerkleRoot } from '../src/lib/bshard-close-enforce.mjs';
import { buildPoolMerkleTree } from '../src/services/pool-merkle-v06.mjs';
import { compileSil, ctorBytes32, ctorInt } from '../src/lib/pool-bshard-artifacts.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const W = await import('file:///D:/rusty-kaspa/wasm/nodejs/kaspa/kaspa.js');
const { Transaction, TransactionOutput, Address, payToAddressScript, ScriptBuilder, addressFromScriptPublicKey, CovenantBinding, Hash } = W;
const NET = 'testnet-12';
const LIB = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib');
const SILVERC = 'D:/silverscript/target/release/silverc.exe';
const z32 = '00'.repeat(32);
const W17 = () => Array.from({ length: 17 }, () => ctorInt(0));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };
async function throws(fn, re, m) { try { await fn(); ok(false, `${m} — 应 throw 没 throw`); } catch (e) { ok(re.test(e.message), `${m}: ${e.message.slice(0, 90)}`); } }

const i64LE = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const push8 = (b) => Buffer.concat([Buffer.from([0x08]), b]);
const push32 = (b) => Buffer.concat([Buffer.from([0x20]), b]);
const p2shScriptHash = (redeemHex) => ScriptBuilder.fromScript(new Uint8Array(Buffer.from(redeemHex, 'hex'))).createPayToScriptHashScript();
const p2shAddr = (redeemHex) => addressFromScriptPublicKey(p2shScriptHash(redeemHex), NET).toString();

// ── setup: 真 committee + 真 PayoutShard redeem (genesis-烤 poolMerkleRoot) ──
const members = Array.from({ length: 6 }, (_, i) => ({ pk_hex: (0xb0 + i).toString(16).padStart(2, '0').repeat(32), stake_sompi: String(1_000_000 * (i + 1)) }));
const poolMerkleRoot = buildPoolMerkleTree(members.map(m => m.pk_hex)).root.toString('hex').toLowerCase();
const predicate_commit = 'ab'.repeat(32);
const POOL = 1_220_000_000;
const inputCtor = [ctorBytes32(poolMerkleRoot), ctorBytes32(predicate_commit), ctorInt(POOL), ctorInt(0), ctorBytes32(z32), ...W17()];
const inputRedeem = Buffer.from(compileSil(join(LIB, 'PayoutShard.sil'), inputCtor, SILVERC).script).toString('hex');

const goodRoot = '11'.repeat(32);
const badRoot = '22'.repeat(32);

// 路 A: silverc 重编 closed=1 + payoutRoot ctor (= claim driver 口径)
const recompileClosed = (rootHex) => {
  const ctor = [ctorBytes32(poolMerkleRoot), ctorBytes32(predicate_commit), ctorInt(POOL), ctorInt(1), ctorBytes32(rootHex), ...W17()];
  return Buffer.from(compileSil(join(LIB, 'PayoutShard.sil'), ctor, SILVERC).script).toString('hex');
};
// 路 B: relay-faithful 全 state 区替换 (_serializePayoutStateHex + splice @ state_start=1)
const relaySplice = (rootHex) => {
  const redeem = Buffer.from(inputRedeem, 'hex');
  const newState = Buffer.concat([push8(i64LE(POOL)), push8(i64LE(1)), push32(Buffer.from(rootHex, 'hex')), ...Array.from({ length: 17 }, () => push8(i64LE(0)))]);
  const STATE_LEN = 9 + 9 + 33 + 17 * 9;
  return Buffer.concat([redeem.slice(0, 1), newState, redeem.slice(1 + STATE_LEN)]).toString('hex');
};

// txSafeJson 构造: covenant continuation output(s) + change
function txSafeJson({ contRedeems, covId = 'cd'.repeat(32), version = 1, changeOnly = false, contNoCovenant = false }) {
  const change = new TransactionOutput(5_000_000n, payToAddressScript(new Address(p2shAddr('ff'.repeat(40)))));
  let outs;
  if (changeOnly) outs = [change];
  else outs = [...contRedeems.map(h => new TransactionOutput(BigInt(POOL), payToAddressScript(new Address(p2shAddr(h))), contNoCovenant ? undefined : new CovenantBinding(0, new Hash(covId)))), change];
  const un = new Transaction({ version, inputs: [{ previousOutpoint: { transactionId: 'ab'.repeat(32), index: 0 }, signatureScript: '', sequence: 0n, sigOpCount: 0, computeBudget: 70, utxo: { outpoint: { transactionId: 'ab'.repeat(32), index: 0 }, amount: BigInt(POOL), scriptPublicKey: payToAddressScript(new Address(p2shAddr('aa'.repeat(40)))), blockDaaScore: 0n } }], outputs: outs, lockTime: 0n, gas: 0n, subnetworkId: '0'.repeat(40), payload: '' });
  return un.serializeToSafeJSON();
}

(async () => {
  console.log('========== D2 (verify-value-source) ==========');
  console.log('== triangulate: silverc-recompile == relay-splice == (J1 内部 splice accepts) ==');
  const cA = recompileClosed(goodRoot), cB = relaySplice(goodRoot);
  ok(p2shAddr(cA) === p2shAddr(cB), `路A(silverc) P2SH == 路B(relay-splice) P2SH (${p2shAddr(cA).slice(0, 24)})`);
  const tHonest = verifyClosePayoutRootBinding({ txSafeJson: txSafeJson({ contRedeems: [cB] }), psRedeemHex: inputRedeem, reDerivedRoot: goodRoot });
  ok(tHonest.ok === true, `J1 verifyClosePayoutRootBinding 接受 honest(路B 造)tx (= 3-impl byte-match; reason=${tHonest.reason || '-'})`);
  // 路A 造的 tx 也必被接受 (silverc 口径)
  const tHonestA = verifyClosePayoutRootBinding({ txSafeJson: txSafeJson({ contRedeems: [cA] }), psRedeemHex: inputRedeem, reDerivedRoot: goodRoot });
  ok(tHonestA.ok === true, `J1 也接受 honest(路A silverc-recompile 造)tx`);

  console.log('== 🦷 攻击1 假根-标量 (verdict D2 命名): tx continuation commit badRoot, scalar 给 goodRoot → REJECT ==');
  const a1 = verifyClosePayoutRootBinding({ txSafeJson: txSafeJson({ contRedeems: [relaySplice(badRoot)] }), psRedeemHex: inputRedeem, reDerivedRoot: goodRoot });
  ok(a1.ok === false && /D2 REJECT/.test(a1.reason), `rejected: ${a1.reason}`);

  console.log('== 🦷 攻击2 move-binding decoy: 真 continuation(covenant)=badRoot + decoy covenant=goodRoot → REJECT(全 cov-out 须对) ==');
  const a2 = verifyClosePayoutRootBinding({ txSafeJson: txSafeJson({ contRedeems: [relaySplice(badRoot), relaySplice(goodRoot)] }), psRedeemHex: inputRedeem, reDerivedRoot: goodRoot });
  ok(a2.ok === false && /D2 REJECT/.test(a2.reason), `rejected: ${a2.reason}`);

  console.log('== 🦷 攻击3 version-0 (NWT 新, covenant 不被 sighash 覆盖 → identification 可 malleate) → REJECT ==');
  const a3 = verifyClosePayoutRootBinding({ txSafeJson: txSafeJson({ contRedeems: [relaySplice(goodRoot)], version: 0 }), psRedeemHex: inputRedeem, reDerivedRoot: goodRoot });
  ok(a3.ok === false && /version/.test(a3.reason), `rejected: ${a3.reason}`);

  console.log('== 🦷 攻击4 continuation 无 covenant binding (settler 想让 enforce 漏看真 continuation) → REJECT(无 cov-out) ==');
  const a4 = verifyClosePayoutRootBinding({ txSafeJson: txSafeJson({ contRedeems: [relaySplice(badRoot)], contNoCovenant: true }), psRedeemHex: inputRedeem, reDerivedRoot: goodRoot });
  ok(a4.ok === false && /无 covenant continuation/.test(a4.reason), `rejected: ${a4.reason}`);

  console.log('== 🦷 攻击4b version NaN-旁路 (Bettor A4 / J1 79f722a4 修): version 缺失/字符串/小数 → REJECT(非 Number()<1 漏过) ==');
  // settler 全控 txSafeJson → 省略/篡改 version 字段试图绕 version>=1 gate (Number(undefined)=NaN, NaN<1=false 旧漏)。
  const honestJson = JSON.parse(txSafeJson({ contRedeems: [relaySplice(goodRoot)] }));
  for (const [label, mut] of [['version 缺失', (j) => { delete j.version; }], ['version="1"(字符串)', (j) => { j.version = '1'; }], ['version=1.5(小数)', (j) => { j.version = 1.5; }], ['version=null', (j) => { j.version = null; }]]) {
    const j = JSON.parse(JSON.stringify(honestJson)); mut(j);
    const r = verifyClosePayoutRootBinding({ txSafeJson: JSON.stringify(j), psRedeemHex: inputRedeem, reDerivedRoot: goodRoot });
    ok(r.ok === false && /version/.test(r.reason), `${label} → REJECT: ${String(r.reason).slice(0, 60)}`);
  }

  console.log('\n========== C2 (poolMerkleRoot 链锚) ==========');
  const ctx = (ov = {}) => ({ loadPoolSnapshot: async () => ({ pool_merkle_root: poolMerkleRoot, members, maker_pk: null, broker_pk: null, ...(ov.snap || {}) }), fetchEndBlockHashCanonical: async () => 'aa'.repeat(32), deadlineDaa: 1000, ...ov.ctx });

  console.log('== honest: DB root == 链锚(从真 inputRedeem 抽) → 5 委员 ==');
  ok(extractOnChainPoolMerkleRoot(inputRedeem) === poolMerkleRoot, `extractOnChainPoolMerkleRoot(真 redeem) == poolMerkleRoot`);
  const c0 = await reDeriveCommittee('mkt', ctx(), inputRedeem);
  ok(Array.isArray(c0) && c0.length === 5, `5 committee (${c0.length})`);

  console.log('== 🦷 攻击5 子集-委员 (verdict C2 命名): settler 供子集成员(漏诚实成员) → REJECT ==');
  await throws(() => reDeriveCommittee('mkt', ctx({ snap: { members: members.slice(0, 5) } }), inputRedeem), /C2: 成员集非完整/, 'rejected subset committee');

  console.log('== 🦷 攻击6 DB-relay 假 root: DB root != 链锚 → REJECT ==');
  await throws(() => reDeriveCommittee('mkt', ctx({ snap: { pool_merkle_root: badRoot } }), inputRedeem), /DB poolMerkleRoot.*!=.*链上/, 'rejected DB-relay fake root');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
