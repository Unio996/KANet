// proto-tx-assembly-settlement-golden.test.mjs — buildMarketSealTxJson 的黄金回归 + NWT批3独立验证
// N1/N2 补丁的测试(J2 2026-09-19, Bettor转达NWT verdict PASS-with-notes)。
// Run: cd kasia-console && node src/lib/proto-tx-assembly-settlement-golden.test.mjs
//
// 黄金夹具 test-fixtures/proto-batch3-market-seal-onchain.json 的期望字节取自 simnet 节点上批3
// (30d7e951) 那笔真实上链 market_seal 交易——读自 getBlocks, 不是本仓 builder 自己的输出(自检两侧
// 不能都是自己写的实现): 修改 buildMarketSealTxJson 后对同一形状必须逐字节复现链上真实字节。

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_SETTLEMENT_GOLDEN_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_settlement_golden_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_SETTLEMENT_GOLDEN_BOOTSTRAPPED: '1' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);

const kaspa = await import('kaspa-wasm');
const { buildMarketSealTxJson, sealWitnessArgs, MARKET_SEAL_ROOTCLOSE_OUT_INDEX, MARKET_SEAL_TOKEN_OUT_INDEX } = await import('./proto-tx-assembly-settlement.mjs');
const { computeShardLeafRedeemScript, computeKttGenesisArtifact, loadProtocolConstants, loadFeeProfileCap } = await import('./proto-covenant-builder.mjs');
const { compileSilV100, ctorBytes32V100, ctorIntV100 } = await import('./pool-bshard-artifacts.mjs');
const { extractTemplateArtifactV100 } = await import('./pool-template-artifact.mjs');
const { encodeConvertToRootcloseAction } = await import('./proto-convert-to-rootclose-witness.mjs');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message + '\n' + e.stack); } };

const FX = JSON.parse(fs.readFileSync(new URL('../../test-fixtures/proto-batch3-market-seal-onchain.json', import.meta.url), 'utf8'));
const P = FX.params;
const localPath = (rel) => new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const { ps_tmpl_hash, token_tmpl_hash } = loadProtocolConstants();

const sldCtor = [
  ctorBytes32V100(P.marketId), ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(P.marketId),
  ctorIntV100(P.sealCount), ctorIntV100(P.minBet), ctorBytes32V100(P.rootCloseTmplHash), ctorBytes32V100('00'.repeat(32)),
  ctorBytes32V100(token_tmpl_hash), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0),
  ctorIntV100(P.shardLeafOwnRedeemLen),
];
const kttCtorForAbi = [{ kind: 'int', value: 1 }, { kind: 'bytes', value: [...Buffer.alloc(32)] }, { kind: 'byte', value: 4 }, { kind: 'byte', value: 0 }, { kind: 'bytes', value: [...Buffer.alloc(32)] }, { kind: 'bytes', value: [...Buffer.alloc(32)] }, { kind: 'int', value: 3 }, { kind: 'int', value: 3 }];
const kttCompiled = compileSilV100(localPath('./sil-v1/KanetTestToken.sil'), kttCtorForAbi, 'KanetTestToken');
const kttTemplate = extractTemplateArtifactV100(kttCompiled);
const tokPrefixHex = '0x' + Buffer.from(kttTemplate.templatePrefix).toString('hex');
const tokSuffixHex = '0x' + Buffer.from(kttTemplate.templateSuffix).toString('hex');
const sldCompiled = compileSilV100(localPath('./ShardLeaf_direct.sil'), sldCtor, 'ShardLeaf_direct');
const convertToRootcloseEntryAbi = sldCompiled._raw.contracts.ShardLeaf_direct.entries.convert_to_rootclose;

const relaySpkHex = '0x' + P.relaySpkScriptHex;
const leafRedeem = computeShardLeafRedeemScript({ marketId: P.marketId, minBet: P.minBet, sealCount: P.sealCount, rootcloseTmplHash: P.rootCloseTmplHash, state: P.stateAtSeal, ownRedeemLen: P.shardLeafOwnRedeemLen });
const heldArtifact = computeKttGenesisArtifact({ amount: P.stateAtSeal.pool_value, ownerCovIdHex: P.leafCovId });
const heldInput = {
  txid: P.heldOutpoint.txid, vout: P.heldOutpoint.vout, value: 20_000_000n, scriptPublicKeyHex: heldArtifact.scriptPubKeyHex,
  redeemScript: heldArtifact.script, entryAbi: heldArtifact.entryAbi, stateFieldCount: heldArtifact.stateFieldCount,
};
const feeUtxo = { txid: P.feeOutpoint.txid, vout: P.feeOutpoint.vout, value: BigInt(P.feeValueSompi), scriptPublicKeyHex: relaySpkHex };

const buildSeal = (overrides = {}) => buildMarketSealTxJson({
  kaspa, network: 'simnet',
  marketId: P.marketId, committeePubkeyHex: P.committeePubkeyHex, deadlineMs: P.deadlineMs, rootCloseTmplHash: P.rootCloseTmplHash,
  leafRedeemScript: leafRedeem.script, leafOutpoint: P.leafOutpoint, leafCovId: P.leafCovId, heldInput, currentState: P.stateAtSeal,
  feeUtxo, relayChangeScriptPublicKeyHex: relaySpkHex,
  convertToRootcloseEntryAbi, tokPrefixHex, tokSuffixHex, absFeeCapSompi: loadFeeProfileCap('market_seal'),
  ...overrides,
});

// ── ①黄金回归: 对批3那个形状, builder 产物必须与 simnet 上真实上链的字节逐字节相同 ──
let built = null;
t('①黄金回归: 用批3参数重建 market_seal 成功(与链上同一形状)', () => { built = buildSeal(); if (!built.txJson) throw new Error('无txJson'); });

t('①黄金回归: 无见证 txid 与链上真实交易 txid 相同(txid 不含 witness, 覆盖 outpoints/outputs/covenant 绑定/值/version)', () => {
  if (built.expectedTxid !== FX.expected.unsignedTxidNoWitness) throw new Error(`重建txid=${built.expectedTxid} != 链上=${FX.expected.unsignedTxidNoWitness}`);
});

t('①黄金回归: leaf(input0) 与 held(input1) 的签名脚本逐字节等于链上真实字节(见证编码器 + 新增 heldInput 守卫不改变合法路径)', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
  for (const idx of [0, 1]) {
    const got = String(tx.inputs[idx].signatureScript).replace(/^0x/, '');
    const want = FX.expected.inputs[idx].signatureScriptHex;
    if (got.length !== want.length) throw new Error(`input${idx} 签名脚本长度 ${got.length / 2}B != 链上 ${want.length / 2}B`);
    if (got !== want) { let i = 0; while (got[i] === want[i]) i++; throw new Error(`input${idx} 签名脚本在 hex 偏移 ${i} 处首个字节不同`); }
  }
});

t('①黄金回归: 三个输出的 value/spk/covenantId/authorizingInput 与链上一致', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
  FX.expected.outputs.forEach((want, i) => {
    const o = tx.outputs[i];
    if (String(o.value) !== String(want.value)) throw new Error(`output${i} value ${o.value} != ${want.value}`);
    if (String(o.scriptPublicKey.script) !== want.spkScriptHex) throw new Error(`output${i} spk 不一致`);
    if (want.covenantId) {
      if (String(o.covenant.covenantId).toLowerCase() !== want.covenantId) throw new Error(`output${i} covenantId ${o.covenant.covenantId} != ${want.covenantId}`);
      if (Number(o.covenant.authorizingInput) !== want.authorizingInput) throw new Error(`output${i} authorizingInput 不一致`);
    }
  });
});

// ── ②N2: heldInput 为 null 必须构造期 fail-closed(不能把 tokenInIdx=-1 编进见证) ──
t('②N2: heldInput=null 必须 fail-closed throw 且报文写明原因', () => {
  let threw = null;
  try { buildSeal({ heldInput: null }); } catch (e) { threw = e; }
  if (!threw) throw new Error('heldInput=null 应该 throw, 却成功返回了');
  if (!/fail-closed/.test(threw.message) || !/heldInput/.test(threw.message)) throw new Error(`throw 了但报文不对: ${threw.message}`);
});

// ── ③N1: tokenInIdx ≠ tokenOutIdx 的单元级向量——证明具名映射不会被换位 ──
// 真实封盘形状里两者恒为 1(共识看不出互换)。这里直接用真实编译产物的 entryAbi 与见证编码器, 给两者不同的
// 值(tokenInIdx=1, tokenOutIdx=3), 用独立的脚本 push 解析器(不复用编码器)按 ABI 声明顺序读回, 断言每个具名
// 参数落在它自己的位置; 再对照互换参数得到的字节必不同。
function parsePushes(hex) {
  const b = Buffer.from(hex, 'hex'); const out = []; let i = 0;
  while (i < b.length) {
    const op = b[i++];
    if (op === 0x00) out.push(Buffer.alloc(0));
    else if (op >= 0x01 && op <= 0x4b) { out.push(b.subarray(i, i + op)); i += op; }
    else if (op === 0x4c) { const n = b[i++]; out.push(b.subarray(i, i + n)); i += n; }
    else if (op === 0x4d) { const n = b.readUInt16LE(i); i += 2; out.push(b.subarray(i, i + n)); i += n; }
    else if (op === 0x4e) { const n = b.readUInt32LE(i); i += 4; out.push(b.subarray(i, i + n)); i += n; }
    else if (op === 0x4f) out.push(Buffer.from([0x81])); // OP_1NEGATE
    else if (op >= 0x51 && op <= 0x60) out.push(Buffer.from([op - 0x50])); // OP_1..OP_16
    else throw new Error(`parsePushes: 非 push opcode 0x${op.toString(16)}@${i - 1}`);
  }
  return out;
}
const decodeSmallInt = (buf) => (buf.length === 0 ? 0 : buf.length === 1 && buf[0] === 0x81 ? -1 : (() => { let v = 0n; for (let k = buf.length - 1; k >= 0; k--) v = (v << 8n) | BigInt(buf[k]); return Number(v); })());

const baseArgs = { rcOutIdx: 0, rc_prefix: '0xaa', rc_suffix: '0xbb', tok_prefix: '0xcc', tok_suffix: '0xdd' };
t('③N1: 编码器把 tokenInIdx/tokenOutIdx 各自放在 ABI 声明的位置(向量 tokenIn=1, tokenOut=3)', () => {
  const hex = encodeConvertToRootcloseAction(kaspa, convertToRootcloseEntryAbi, { ...baseArgs, tokenInIdx: 1, tokenOutIdx: 3 });
  const pushes = parsePushes(hex);
  const params = convertToRootcloseEntryAbi.params;
  if (pushes.length !== params.length + 1) throw new Error(`push 数 ${pushes.length} != params(${params.length})+dispatch_tag`);
  const at = (name) => { const i = params.findIndex((p) => p.name === name); if (i < 0) throw new Error(`ABI 里没有参数 ${name}`); return decodeSmallInt(pushes[i]); };
  if (at('tokenInIdx') !== 1) throw new Error(`tokenInIdx 位置读回 ${at('tokenInIdx')} != 1`);
  if (at('tokenOutIdx') !== 3) throw new Error(`tokenOutIdx 位置读回 ${at('tokenOutIdx')} != 3`);
  if (at('rcOutIdx') !== 0) throw new Error(`rcOutIdx 位置读回 ${at('rcOutIdx')} != 0`);
});
t('③N1: 互换 tokenIn/tokenOut 得到不同字节(证明测试向量能区分换位)', () => {
  const a = encodeConvertToRootcloseAction(kaspa, convertToRootcloseEntryAbi, { ...baseArgs, tokenInIdx: 1, tokenOutIdx: 3 });
  const b = encodeConvertToRootcloseAction(kaspa, convertToRootcloseEntryAbi, { ...baseArgs, tokenInIdx: 3, tokenOutIdx: 1 });
  if (a === b) throw new Error('互换后字节相同——该向量无法发现换位');
});

// ── ③a: builder 的具名映射(sealWitnessArgs)用 heldIdx≠MARKET_SEAL_TOKEN_OUT_INDEX 的向量——若 builder
// 把 tokenInIdx/tokenOutIdx 换位, 这条会红(真实形状里两者同为 1, 换位不会被共识或黄金回归发现) ──
// 🔴 本条是 builder 层 tokenInIdx/tokenOutIdx 换位的【唯一】守卫(2026-09-19 负向对照实测: 在 builder 副本里
// 把两者互换, 黄金回归 4 条、编码器向量、③b 全部仍绿, 只有本条变红)。不要因为"看起来冗余"删掉它。
t('③a builder 映射 sealWitnessArgs: heldIdx=5(≠tokenOut=1) 时 tokenInIdx=5、tokenOutIdx=MARKET_SEAL_TOKEN_OUT_INDEX、rcOutIdx=MARKET_SEAL_ROOTCLOSE_OUT_INDEX', () => {
  const a = sealWitnessArgs({ heldIdx: 5, rcPrefixHex: 'aa', rcSuffixHex: 'bb', tokPrefixHex: '0xcc', tokSuffixHex: '0xdd' });
  if (5 === MARKET_SEAL_TOKEN_OUT_INDEX) throw new Error('测试向量退化: heldIdx 等于 token 输出下标, 无法区分换位');
  if (a.tokenInIdx !== 5) throw new Error(`tokenInIdx=${a.tokenInIdx} != 5(应取自 heldIdx)`);
  if (a.tokenOutIdx !== MARKET_SEAL_TOKEN_OUT_INDEX) throw new Error(`tokenOutIdx=${a.tokenOutIdx} != ${MARKET_SEAL_TOKEN_OUT_INDEX}`);
  if (a.rcOutIdx !== MARKET_SEAL_ROOTCLOSE_OUT_INDEX) throw new Error(`rcOutIdx=${a.rcOutIdx} != ${MARKET_SEAL_ROOTCLOSE_OUT_INDEX}`);
  if (a.rc_prefix !== '0xaa' || a.rc_suffix !== '0xbb' || a.tok_prefix !== '0xcc' || a.tok_suffix !== '0xdd') throw new Error('prefix/suffix 透传不对');
});

// ── ③b: 构造器层面——见证里的 tokenInIdx/tokenOutIdx 必须等于交易里 held 输入/token 输出的【真实位置】 ──
// (真实封盘形状里两者都是 1, 所以这条只证明"取自交易结构而非写死", 换位由上面的编码器向量负责)
t('③b builder 见证里 tokenInIdx == tx 中 held 输入的真实下标, tokenOutIdx == token 输出的真实下标', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
  const heldPos = tx.inputs.findIndex((i) => String(i.previousOutpoint.transactionId) === heldInput.txid && Number(i.previousOutpoint.index) === heldInput.vout);
  if (heldPos < 0) throw new Error('tx 里找不到 held 输入');
  const pushes = parsePushes(String(tx.inputs[0].signatureScript).replace(/^0x/, ''));
  const params = convertToRootcloseEntryAbi.params;
  const at = (name) => decodeSmallInt(pushes[params.findIndex((p) => p.name === name)]);
  if (at('tokenInIdx') !== heldPos) throw new Error(`见证 tokenInIdx=${at('tokenInIdx')} != held 真实下标 ${heldPos}`);
  if (at('tokenOutIdx') !== MARKET_SEAL_TOKEN_OUT_INDEX) throw new Error(`见证 tokenOutIdx=${at('tokenOutIdx')} != MARKET_SEAL_TOKEN_OUT_INDEX(${MARKET_SEAL_TOKEN_OUT_INDEX})`);
  if (at('rcOutIdx') !== MARKET_SEAL_ROOTCLOSE_OUT_INDEX) throw new Error(`见证 rcOutIdx=${at('rcOutIdx')} != MARKET_SEAL_ROOTCLOSE_OUT_INDEX`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
