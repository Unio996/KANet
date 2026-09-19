// proto-mass-ceiling.test.mjs — 构造期mass上限断言(2026-09-19按NWT红队审verdict D1-D5重写)。
// Run: cd kasia-console && node src/lib/proto-mass-ceiling.test.mjs
//
// 三类证据, 两侧不共用实现:
//   ① 节点权威值: NWT从simnet节点取回的批3四笔真实上链交易(test-fixtures/proto-mass/), 输入plurality/amount由
//      【父交易输出】现算(不是builder假设值), 精确storage/compute与节点值逐位相等(含market_genesis的relaxed路径)。
//   ② 独立移植对拍: NWT按consensus源码独立移植的calcStorageMass(不参照本仓实现)对随机形状对拍。
//   ③ 生产builder验收向量: register_append#1在85M/90M必拒、95M/100M必过, 且95M时断言给出的storage/compute信号
//      与节点值(457,504 / 33,927)逐位相等。

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_MASS_CEILING_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_mass_ceiling_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_MASS_CEILING_TEST_BOOTSTRAPPED: '1' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);

const kaspa = await import('kaspa-wasm');
const { randomBytes } = await import('node:crypto');
const M = await import('./proto-mass-ceiling.mjs');
const {
  assertMassWithinCeiling, calcStorageMassExact, calcComputeMassExact, utxoPlurality,
  MASS_CEILING_THRESHOLD, SIGNED_INPUT_SIGSCRIPT_BYTES,
} = M;
const NWT = await import('../../test-fixtures/proto-mass/nwt-port_mass.mjs');
const TXS = JSON.parse(fs.readFileSync(new URL('../../test-fixtures/proto-mass/onchain_txs_with_parents.simnet.json', import.meta.url), 'utf8'));

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message + '\n' + e.stack); } };
const throws = (fn, re) => { let e = null; try { fn(); } catch (x) { e = x; } if (!e) throw new Error('应该throw, 却成功返回了'); if (!re.test(e.message)) throw new Error(`throw了但报文不对: ${e.message}`); };

t('阈值不变: 500000×0.95=475000; 签名后sigScript留量=66字节', () => {
  if (MASS_CEILING_THRESHOLD !== 475_000) throw new Error(`MASS_CEILING_THRESHOLD=${MASS_CEILING_THRESHOLD}`);
  if (SIGNED_INPUT_SIGSCRIPT_BYTES !== 66) throw new Error('签名留量不是66');
});

t('utxoPlurality: 标准P2PK(33B)=1, 35字节P2SH=1, 带covenant的P2SH=2(=ceil((63+35+32)/100))', () => {
  if (utxoPlurality(33, false) !== 1n || utxoPlurality(35, false) !== 1n || utxoPlurality(35, true) !== 2n) throw new Error('plurality不对');
});

// ── ① 节点权威值: 批3四笔真实交易, 输入facts取自父输出 ──
const NAMES = {
  '8c119539e065d713558132cf4e518cb950af28313c2a071ef55611b35f3fb0f8': ['market_genesis', 'relaxed'],
  'aed39af62d9524e06a07569a11399b4395e0666d00187ddb5509fea2ee4a6f68': ['register_append#1', 'arithmetic'],
  'a5d664e46a8e2c617bf2b5d4e66601f1b7534284d4f94c550faa215dde34dbb6': ['register_append#2', 'arithmetic'],
  'e2c45b328b9a47bf315f09dc3d7873e4278beb4fe5f46ce3bd9d839baa6924c8': ['market_seal', 'arithmetic'],
};
const spkBytes = (spk) => (String(spk).length - 4) / 2; // 节点JSON的scriptPublicKey=4位version+script
for (const [id, [name, wantPath]] of Object.entries(NAMES)) {
  t(`①${name}: 精确storage与compute逐位等于节点值(输入facts取自父交易输出), 路径=${wantPath}`, () => {
    const tx = TXS[id];
    const ins = tx.inputs.map((i) => { const par = TXS[i.previousOutpoint.transactionId].outputs[i.previousOutpoint.index]; return { plurality: utxoPlurality(spkBytes(par.scriptPublicKey), !!par.covenant), amountSompi: BigInt(par.value) }; });
    const outs = tx.outputs.map((o) => ({ plurality: utxoPlurality(spkBytes(o.scriptPublicKey), !!o.covenant), amountSompi: BigInt(o.value) }));
    const s = calcStorageMassExact(ins, outs);
    if (String(s.mass) !== String(tx.storageMass)) throw new Error(`storage=${s.mass} != 节点${tx.storageMass}`);
    if (s.path !== wantPath) throw new Error(`路径=${s.path} != ${wantPath}`);
    const c = calcComputeMassExact({
      version: tx.version,
      inputs: tx.inputs.map((i) => ({ sigScriptBytes: i.signatureScript.length / 2, computeBudget: Number(i.computeBudget) })),
      outputs: tx.outputs.map((o) => ({ spkByteLen: spkBytes(o.scriptPublicKey), hasCovenant: !!o.covenant })),
      payloadBytes: String(tx.payload || '').replace(/^0x/, '').length / 2,
    });
    if (String(c.compute) !== String(tx.verboseData.computeMass)) throw new Error(`compute=${c.compute} != 节点${tx.verboseData.computeMass}`);
  });
}

// ── ② 与NWT独立移植随机对拍(exact=NWT的calcStorageMass, 两侧不共用实现) ──
t('②随机形状对拍: 30,000个随机形状, 本仓calcStorageMassExact与NWT独立移植逐位相等(mass与relaxed/arithmetic路径)', () => {
  let seed = 0x9e3779b9; const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 2 ** 32; };
  const rint = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const amt = () => BigInt(Math.floor(10 ** (3 + rnd() * 9.4))) + 1n; // 1e3 .. ~2.5e12 sompi
  let relaxedSeen = 0, arithSeen = 0;
  for (let n = 0; n < 30_000; n++) {
    const ins = Array.from({ length: rint(1, 4) }, () => ({ plurality: BigInt(rint(1, 3)), amountSompi: amt() }));
    const outs = Array.from({ length: rint(1, 5) }, () => ({ plurality: BigInt(rint(1, 3)), amountSompi: amt() }));
    const mine = calcStorageMassExact(ins, outs);
    const ref = NWT.calcStorageMass(ins.map((c) => ({ p: c.plurality, a: c.amountSompi })), outs.map((c) => ({ p: c.plurality, a: c.amountSompi })));
    const refPath = ref.path.startsWith('relaxed') ? 'relaxed' : 'arithmetic';
    if (mine.mass !== ref.mass || mine.path !== refPath) throw new Error(`形状#${n}不一致: 本仓=${mine.mass}/${mine.path} NWT=${ref.mass}/${refPath} ins=${JSON.stringify(ins, (k, v) => (typeof v === 'bigint' ? v.toString() : v))} outs=${JSON.stringify(outs, (k, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
    if (mine.path === 'relaxed') relaxedSeen++; else arithSeen++;
  }
  if (relaxedSeen < 1000 || arithSeen < 1000) throw new Error(`随机形状没有同时覆盖两条路径(relaxed=${relaxedSeen}, arithmetic=${arithSeen}), 对拍无意义`);
});

// ── ③ 生产builder验收向量: register_append#1(route A: min_bet=1, stake=1, 无held) ──
const { buildMarketGenesisTxJson, buildRegisterAppendTxJson } = await import('./proto-tx-assembly.mjs');
const { computeMarketGenesisArtifacts, computeShardLeafRedeemScript, computeKttGenesisArtifact, loadProtocolConstants, p2sh } = await import('./proto-covenant-builder.mjs');
const { compileSilV100, ctorBytes32V100, ctorIntV100 } = await import('./pool-bshard-artifacts.mjs');
const { extractTemplateArtifactV100 } = await import('./pool-template-artifact.mjs');

const priv = new kaspa.PrivateKey(randomBytes(32).toString('hex'));
const relaySpkHex = '0x' + kaspa.payToAddressScript(priv.toPublicKey().toAddress('mainnet')).script;
const MARKET_ID = 'ab'.repeat(32), MIN_BET = 1, DEADLINE_MS = Date.now() - 3600_000, SEAL_COUNT = 2, STAKE = 1;
const ga = await computeMarketGenesisArtifacts({ marketId: MARKET_ID, minBet: MIN_BET, deadlineMs: DEADLINE_MS });
const gb = buildMarketGenesisTxJson({ kaspa, network: 'mainnet', feeUtxo: { txid: 'ee'.repeat(32), vout: 0, value: 95_000_000n, scriptPublicKeyHex: relaySpkHex }, relayChangeScriptPublicKeyHex: relaySpkHex, shardLeafScriptPubKeyHex: ga.shardLeafDirect.scriptPubKeyHex, absFeeCapSompi: 80_000_000n });
const leafCovId = gb.shardLeafCovId, leafOutpoint = { txid: gb.expectedTxid, vout: 0 };
const { ps_tmpl_hash, token_tmpl_hash } = loadProtocolConstants();
const localPath = (rel) => new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const sldCtor = [ctorBytes32V100(MARKET_ID), ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(MARKET_ID), ctorIntV100(SEAL_COUNT), ctorIntV100(MIN_BET), ctorBytes32V100(ga.rootCloseTmplHash), ctorBytes32V100('00'.repeat(32)), ctorBytes32V100(token_tmpl_hash), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(ga.shardLeafOwnRedeemLen)];
const kttC = compileSilV100(localPath('./sil-v1/KanetTestToken.sil'), [{ kind: 'int', value: 1 }, { kind: 'bytes', value: [...Buffer.alloc(32)] }, { kind: 'byte', value: 4 }, { kind: 'byte', value: 0 }, { kind: 'bytes', value: [...Buffer.alloc(32)] }, { kind: 'bytes', value: [...Buffer.alloc(32)] }, { kind: 'int', value: 3 }, { kind: 'int', value: 3 }], 'KanetTestToken');
const tokPrefixHex = '0x' + Buffer.from(extractTemplateArtifactV100(kttC).templatePrefix).toString('hex');
const tokSuffixHex = '0x' + Buffer.from(extractTemplateArtifactV100(kttC).templateSuffix).toString('hex');
const currentState = { local_yes: 0, local_no: 0, count: 0, pool_value: 0 };
const newState = { local_yes: STAKE, local_no: 0, count: 1, pool_value: STAKE };
const leafRedeem = computeShardLeafRedeemScript({ marketId: MARKET_ID, minBet: MIN_BET, sealCount: SEAL_COUNT, rootcloseTmplHash: ga.rootCloseTmplHash, state: currentState, ownRedeemLen: ga.shardLeafOwnRedeemLen });
const registerAppendAbi = compileSilV100(localPath('./ShardLeaf_direct.sil'), sldCtor, 'ShardLeaf_direct')._raw.contracts.ShardLeaf_direct.entries.register_append;
const merged = computeKttGenesisArtifact({ amount: newState.pool_value, ownerCovIdHex: leafCovId });
const bettorPk = Buffer.alloc(32, 0x66).toString('hex');
const ticketC = compileSilV100(localPath('./sil-v1/PoolSideTicket.sil'), [{ kind: 'bytes', value: [...Buffer.from(bettorPk, 'hex')] }, { kind: 'int', value: 0 }, { kind: 'int', value: STAKE }, { kind: 'bytes', value: [...Buffer.from(MARKET_ID, 'hex')] }], 'PoolSideTicket');
const ticketTpl = extractTemplateArtifactV100(ticketC);
const buildBet1 = (feeValue) => buildRegisterAppendTxJson({
  kaspa, network: 'mainnet', leafRedeemScript: leafRedeem.script, leafStateLayout: leafRedeem.stateLayout, leafOutpoint, leafCovId,
  currentState, newState, heldInput: null,
  feeUtxo: { txid: 'dd'.repeat(32), vout: 0, value: feeValue, scriptPublicKeyHex: relaySpkHex }, relayChangeScriptPublicKeyHex: relaySpkHex,
  registerAppendEntryAbi: registerAppendAbi,
  registerAppendArgs: { side: 0, stake: STAKE, bettorPk, psPrefix: '0x' + Buffer.from(ticketTpl.templatePrefix).toString('hex'), psSuffix: '0x' + Buffer.from(ticketTpl.templateSuffix).toString('hex'), tokPrefix: tokPrefixHex, tokSuffix: tokSuffixHex },
  ticketScriptPubKeyHex: '0x' + p2sh(Buffer.from(ticketC.script)), mergedKttScript: merged.script, absFeeCapSompi: 100_000_000n,
});

for (const [fee, storage] of [[85_000_000n, 994327], [90_000_000n, 518872]]) {
  t(`③register_append#1 fee=${fee}: 必拒(精确storage=${storage} ≥ 475,000)`, () => {
    throws(() => buildBet1(fee), new RegExp(`storage=${storage}\\(arithmetic\\)`));
  });
}
let bet95 = null;
for (const [fee, storage] of [[95_000_000n, 457504], [100_000_000n, 435000]]) {
  t(`③register_append#1 fee=${fee}: 必过, 断言信号storage=${storage}`, () => {
    const b = buildBet1(fee);
    const tx = kaspa.Transaction.deserializeFromSafeJSON(b.txJson);
    const sig = assertMassWithinCeiling({ kaspa, network: 'mainnet', tx, inputHasCovenant: [true, false], feeUtxoValueSompi: fee, label: 'test' });
    if (sig.storageMass !== storage) throw new Error(`storage信号=${sig.storageMass} != ${storage}`);
    if (fee === 95_000_000n) bet95 = sig;
  });
}
t('③95M: 断言给出的信号与批3节点原始值逐位相等(storage 457,504 / compute 33,927), 且localMass诊断值>阈值却不门控', () => {
  const node = TXS['aed39af62d9524e06a07569a11399b4395e0666d00187ddb5509fea2ee4a6f68'];
  if (!bet95) throw new Error('前置: 95M未构造成功');
  if (String(bet95.storageMass) !== String(node.storageMass)) throw new Error(`storage ${bet95.storageMass} != 节点${node.storageMass}`);
  if (String(bet95.computeMass) !== String(node.verboseData.computeMass)) throw new Error(`compute ${bet95.computeMass} != 节点${node.verboseData.computeMass}(含未签名fee输入的66B留量)`);
  if (!(bet95.localMassDiagnostic >= MASS_CEILING_THRESHOLD)) throw new Error(`localMass诊断值=${bet95.localMassDiagnostic}不高于阈值, 本条无法证明"诊断项不门控"`);
});

// ── fail-closed: inputHasCovenant ──
const oneInputTx = (sigScriptBytes = 0, amount = 100_000_000n, spkHex = null) => {
  const spk = spkHex ? new kaspa.ScriptPublicKey(0, spkHex) : kaspa.payToAddressScript(priv.toPublicKey().toAddress('mainnet'));
  const op = { transactionId: 'aa'.repeat(32), index: 0 };
  return new kaspa.Transaction({
    version: 1,
    inputs: [{ previousOutpoint: op, signatureScript: sigScriptBytes ? new Uint8Array(sigScriptBytes) : new Uint8Array(0), sequence: 0n, sigOpCount: 0, computeBudget: 70, utxo: { outpoint: op, amount, scriptPublicKey: spk, blockDaaScore: 0n } }],
    outputs: [new kaspa.TransactionOutput(amount - 1_000_000n, spk)],
    lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
  });
};
t('fail-closed: inputHasCovenant缺失/长度不符/非boolean 都必须拒绝', () => {
  const tx = oneInputTx();
  const call = (inputHasCovenant) => assertMassWithinCeiling({ kaspa, network: 'mainnet', tx, inputHasCovenant, feeUtxoValueSompi: 0n, label: 'fc' });
  throws(() => call(undefined), /fail-closed.*inputHasCovenant/);
  throws(() => call([]), /fail-closed.*inputHasCovenant/);
  throws(() => call([true, false]), /fail-closed.*inputHasCovenant/);
  throws(() => call([1]), /fail-closed.*inputHasCovenant/);
  call([false]); // 对照: 合法形状放行(证明上面的throw不是因为别的原因)
});
t('fail-closed: 声明带covenant但spk不是35字节P2SH → 拒绝(builder声明与spk形状交叉核对)', () => {
  throws(() => assertMassWithinCeiling({ kaspa, network: 'mainnet', tx: oneInputTx(), inputHasCovenant: [true], feeUtxoValueSompi: 0n, label: 'fc' }), /fail-closed.*P2SH/);
});

// ── compute维度是独立守卫: storage很小但compute超阈值必拒 ──
t('compute独立守卫: sigScript 480,000字节 → compute超475,000必拒(storage本身很小)', () => {
  const tx = oneInputTx(480_000);
  throws(() => assertMassWithinCeiling({ kaspa, network: 'mainnet', tx, inputHasCovenant: [false], feeUtxoValueSompi: 0n, label: 'compute' }), /compute=\d+/);
});
t('compute留量: 未签名输入(sigScript为空)按签名后66字节计, 与已含66字节的同一交易compute相等', () => {
  const unsigned = assertMassWithinCeiling({ kaspa, network: 'mainnet', tx: oneInputTx(0), inputHasCovenant: [false], feeUtxoValueSompi: 0n, label: 'u' });
  const signed = assertMassWithinCeiling({ kaspa, network: 'mainnet', tx: oneInputTx(66), inputHasCovenant: [false], feeUtxoValueSompi: 0n, label: 's' });
  if (unsigned.computeMass !== signed.computeMass) throw new Error(`未签名=${unsigned.computeMass} 已签名=${signed.computeMass}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
