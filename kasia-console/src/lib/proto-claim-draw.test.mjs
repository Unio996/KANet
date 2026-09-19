// proto-claim-draw.test.mjs — buildClaimDrawTxJson(批6, RootClaim.claim_draw full 分支)离线端到端验证(J2 2026-09-19)。
// 真 kaspa-wasm + 真编译 + relay 真代码交叉核验, 零 mock; 链: genesis→bet1→bet2→market_seal→close_commit→convert_to_claim→claim_draw。
// 生产映射: v0 里 bettor_pk === 本市场委员公钥(proto.js:212-215), 所以本测试的两笔下注都用委员公钥作 bettorPk, 签名私钥来自 committee_privkey_enc。
// 🔴 ticket 签名用 NWT 独立移植的 sighash + schnorr 真验签(test-fixtures/proto-close-commit/sighash_port.mjs), 带"去 covenant 必须验假"反向臂——
//    只比 txid 测不出签名时序错误(B4-1 教训)。
// Run: cd kasia-console && node src/lib/proto-claim-draw.test.mjs
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_CLAIM_DRAW_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_claim_draw_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_CLAIM_DRAW_TEST_BOOTSTRAPPED: '1' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);

const kaspa = await import('kaspa-wasm');
const { withParents } = await import('./proto-chain-parents-fixtures.mjs'); // 9-1 E 笔: 四个 builder 的 chainParents 必填, 夹具见该文件头注
const { randomBytes } = await import('node:crypto');
const { buildMarketGenesisTxJson, buildRegisterAppendTxJson, assertKaspadInputVersionRule } = await import('./proto-tx-assembly.mjs');
const S = await import('./proto-tx-assembly-settlement.mjs');
const {
  buildMarketSealTxJson, buildCloseCommitTxJson, buildConvertToClaimTxJson, buildClaimDrawTxJson, claimDrawWitnessArgs, assertClaimDrawLayout,
  MARKET_SEAL_ROOTCLOSE_OUT_INDEX, MARKET_SEAL_TOKEN_OUT_INDEX, CLOSE_COMMIT_ROOTCLOSE_OUT_INDEX, CONVERT_TO_CLAIM_CLAIM_OUT_INDEX, CONVERT_TO_CLAIM_TOKEN_OUT_INDEX,
  CLAIM_DRAW_TICKET_IN_INDEX, CLAIM_DRAW_HELD_IN_INDEX, CLAIM_DRAW_CLAIM_OUT_INDEX, CLAIM_DRAW_TOKEN_OUT_INDEX,
} = S;
const {
  computeMarketGenesisArtifacts, computeShardLeafRedeemScript, computeKttGenesisArtifact, computeRootClaimGenesisArtifact,
  loadProtocolConstants, loadFeeProfileCap, p2sh,
} = await import('./proto-covenant-builder.mjs');
const { compileSilV100, ctorBytes32V100, ctorIntV100 } = await import('./pool-bshard-artifacts.mjs');
const { extractTemplateArtifactV100 } = await import('./pool-template-artifact.mjs');
const { payoutLeafHex } = await import('./proto-payout-leaf.mjs');
const { decryptCommitteePrivkey } = await import('./proto-committee-key.mjs');
const { extractTxShape, validateFixedValueOutputs, signOnlyDeclaredInputs, assertFinalTxid } = await import('../../../kasia-relay/src/lib/covenant-broadcast.mjs');
const { sighashAll, verify: schnorrVerify } = await import('../../test-fixtures/proto-close-commit/sighash_port.mjs');
const { blake2b } = (await import('node:module')).createRequire(import.meta.url)('../../node_modules/@noble/hashes/blake2b.js');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message + '\n' + e.stack); } };
const throws = (fn, re, secrets = []) => {
  let e = null; try { fn(); } catch (x) { e = x; }
  if (!e) throw new Error('应该throw, 却成功返回了');
  if (!re.test(e.message)) throw new Error(`throw了但报文不对: ${e.message}`);
  for (const s of secrets) if (s && e.message.includes(s)) throw new Error('错误信息泄露了私钥值');
};

const relayPriv = new kaspa.PrivateKey(randomBytes(32).toString('hex'));
const relaySpkHex = '0x' + kaspa.payToAddressScript(relayPriv.toPublicKey().toAddress('mainnet')).script;
const spkOf = (txJson, i) => '0x' + String(kaspa.Transaction.deserializeFromSafeJSON(txJson).outputs[i].scriptPublicKey.script);
const bigFee = (n) => ({ txid: String(n).padStart(2, '0').repeat(32), vout: 0, value: 10_000_000_000n, scriptPublicKeyHex: relaySpkHex });

// ── 链: 生产映射 bettorPk = 委员公钥 ──
const MARKET_ID = 'ab'.repeat(32), MIN_BET = 1, DEADLINE_MS = 1700000000000, SEAL_COUNT = 2;
const ga = await computeMarketGenesisArtifacts({ marketId: MARKET_ID, minBet: MIN_BET, deadlineMs: DEADLINE_MS });
const COMMITTEE_PK = ga.committeePubkeyHex;
const genesis = buildMarketGenesisTxJson({ kaspa, network: 'mainnet', feeUtxo: bigFee(1), relayChangeScriptPublicKeyHex: relaySpkHex, shardLeafScriptPubKeyHex: ga.shardLeafDirect.scriptPubKeyHex, absFeeCapSompi: 80_000_000n });
const leafCovId = genesis.shardLeafCovId;
const { ps_tmpl_hash, token_tmpl_hash } = loadProtocolConstants();
const libPath = (rel) => new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SLD_PATH = libPath('./ShardLeaf_direct.sil'), TICKET_PATH = libPath('./sil-v1/PoolSideTicket.sil'), KTT_PATH = libPath('./sil-v1/KanetTestToken.sil');
const sldCtor = () => [ctorBytes32V100(MARKET_ID), ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(MARKET_ID), ctorIntV100(SEAL_COUNT), ctorIntV100(MIN_BET), ctorBytes32V100(ga.rootCloseTmplHash), ctorBytes32V100('00'.repeat(32)), ctorBytes32V100(token_tmpl_hash), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(ga.shardLeafOwnRedeemLen)];
const kttCompiled = compileSilV100(KTT_PATH, [{ kind: 'int', value: 1 }, { kind: 'bytes', value: [...Buffer.alloc(32)] }, { kind: 'byte', value: 4 }, { kind: 'byte', value: 0 }, { kind: 'bytes', value: [...Buffer.alloc(32)] }, { kind: 'bytes', value: [...Buffer.alloc(32)] }, { kind: 'int', value: 3 }, { kind: 'int', value: 3 }], 'KanetTestToken');
const kttEntryAbi = kttCompiled._raw.contracts.KanetTestToken.entries.transfer, kttStateFieldCount = kttCompiled._raw.contracts.KanetTestToken.runtime_state.fields.length;
const tokPrefixHex = '0x' + Buffer.from(extractTemplateArtifactV100(kttCompiled).templatePrefix).toString('hex');
const tokSuffixHex = '0x' + Buffer.from(extractTemplateArtifactV100(kttCompiled).templateSuffix).toString('hex');

function doRegisterAppend({ side, stake, currentState, heldInput, leafOutpoint, feeN }) {
  const newState = { local_yes: currentState.local_yes + (side === 0 ? stake : 0), local_no: currentState.local_no + (side === 1 ? stake : 0), count: currentState.count + 1, pool_value: currentState.pool_value + stake };
  const leafRedeem = computeShardLeafRedeemScript({ marketId: MARKET_ID, minBet: MIN_BET, sealCount: SEAL_COUNT, rootcloseTmplHash: ga.rootCloseTmplHash, state: currentState, ownRedeemLen: ga.shardLeafOwnRedeemLen });
  const registerAppendEntryAbi = compileSilV100(SLD_PATH, sldCtor(), 'ShardLeaf_direct')._raw.contracts.ShardLeaf_direct.entries.register_append;
  const merged = computeKttGenesisArtifact({ amount: newState.pool_value, ownerCovIdHex: leafCovId });
  const ticketC = compileSilV100(TICKET_PATH, [ctorBytes32V100(COMMITTEE_PK), ctorIntV100(side), ctorIntV100(stake), ctorBytes32V100(MARKET_ID)], 'PoolSideTicket');
  const tA = extractTemplateArtifactV100(ticketC);
  const built = buildRegisterAppendTxJson({
    kaspa, network: 'mainnet', leafRedeemScript: leafRedeem.script, leafStateLayout: leafRedeem.stateLayout, leafOutpoint, leafCovId, currentState, newState, heldInput,
    feeUtxo: bigFee(feeN), relayChangeScriptPublicKeyHex: relaySpkHex,
    registerAppendEntryAbi, registerAppendArgs: { side, stake, bettorPk: COMMITTEE_PK, psPrefix: '0x' + Buffer.from(tA.templatePrefix).toString('hex'), psSuffix: '0x' + Buffer.from(tA.templateSuffix).toString('hex'), tokPrefix: tokPrefixHex, tokSuffix: tokSuffixHex },
    ticketScriptPubKeyHex: '0x' + p2sh(Buffer.from(ticketC.script)), mergedKttScript: merged.script, absFeeCapSompi: 100_000_000n,
  });
  return { built, newState, merged };
}
const leaf0 = { txid: genesis.expectedTxid, vout: 0 };
const bet1 = doRegisterAppend({ side: 0, stake: 1, currentState: { local_yes: 0, local_no: 0, count: 0, pool_value: 0 }, heldInput: null, leafOutpoint: leaf0, feeN: 2 });
const heldOf = (r) => ({ txid: r.built.expectedTxid, vout: 2, value: 20_000_000n, scriptPublicKeyHex: r.merged.scriptPubKeyHex, redeemScript: r.merged.script, entryAbi: kttEntryAbi, stateFieldCount: kttStateFieldCount });
const bet2 = doRegisterAppend({ side: 1, stake: 999, currentState: bet1.newState, heldInput: heldOf(bet1), leafOutpoint: { txid: bet1.built.expectedTxid, vout: 0 }, feeN: 3 });
const sealState = bet2.newState; // {1,999,2,1000}
const sldAtSeal = compileSilV100(SLD_PATH, sldCtor(), 'ShardLeaf_direct')._raw.contracts.ShardLeaf_direct.entries.convert_to_rootclose;
const sealArgs = (over = {}) => withParents('seal', {
  kaspa, network: 'mainnet', marketId: MARKET_ID, committeePubkeyHex: COMMITTEE_PK, deadlineMs: DEADLINE_MS, rootCloseTmplHash: ga.rootCloseTmplHash,
  leafRedeemScript: computeShardLeafRedeemScript({ marketId: MARKET_ID, minBet: MIN_BET, sealCount: SEAL_COUNT, rootcloseTmplHash: ga.rootCloseTmplHash, state: sealState, ownRedeemLen: ga.shardLeafOwnRedeemLen }).script,
  leafOutpoint: { txid: bet2.built.expectedTxid, vout: 0 }, leafCovId, heldInput: heldOf(bet2), currentState: sealState, feeUtxo: bigFee(4), relayChangeScriptPublicKeyHex: relaySpkHex,
  convertToRootcloseEntryAbi: sldAtSeal, tokPrefixHex, tokSuffixHex, absFeeCapSompi: loadFeeProfileCap('market_seal'), ...over,
});
const seal = buildMarketSealTxJson(sealArgs());
const WIN_SIDE = 1, PAYOUT_ROOT = payoutLeafHex(COMMITTEE_PK, 1000);
const closeCommitArgs = (over = {}) => withParents('close_commit', {
  kaspa, network: 'mainnet', marketId: MARKET_ID, committeePubkeyHex: COMMITTEE_PK, committeePrivkeyEnvelope: ga.committeePrivkeyEnvelope, deadlineMs: DEADLINE_MS, rootCloseTmplHash: ga.rootCloseTmplHash,
  rootCloseOutpoint: { txid: seal.expectedTxid, vout: MARKET_SEAL_ROOTCLOSE_OUT_INDEX }, rootCloseUtxoScriptPublicKeyHex: spkOf(seal.txJson, MARKET_SEAL_ROOTCLOSE_OUT_INDEX), rootCloseCovId: seal.rootCloseCovId, sealedState: sealState,
  newWinningSide: WIN_SIDE, newPayoutRootHex: PAYOUT_ROOT, tokPrefixHex, tokSuffixHex, feeUtxo: bigFee(5), relayChangeScriptPublicKeyHex: relaySpkHex, absFeeCapSompi: loadFeeProfileCap('close_commit'), ...over,
});
const closeCommit = buildCloseCommitTxJson(closeCommitArgs());
const closedState = { ...sealState, closed: 1, winningSide: WIN_SIDE, payoutRoot: PAYOUT_ROOT };
const convertArgs = (over = {}) => withParents('convert_to_claim', {
  kaspa, network: 'mainnet', marketId: MARKET_ID, committeePubkeyHex: COMMITTEE_PK, deadlineMs: DEADLINE_MS, rootCloseTmplHash: ga.rootCloseTmplHash,
  rootCloseOutpoint: { txid: closeCommit.expectedTxid, vout: CLOSE_COMMIT_ROOTCLOSE_OUT_INDEX }, rootCloseUtxoScriptPublicKeyHex: spkOf(closeCommit.txJson, CLOSE_COMMIT_ROOTCLOSE_OUT_INDEX),
  rootCloseCovId: seal.rootCloseCovId, closedState, heldTokenOutpoint: { txid: seal.expectedTxid, vout: MARKET_SEAL_TOKEN_OUT_INDEX },
  tokPrefixHex, tokSuffixHex, feeUtxo: bigFee(6), relayChangeScriptPublicKeyHex: relaySpkHex, absFeeCapSompi: loadFeeProfileCap('convert_to_claim'), ...over,
});
const convertToClaim = buildConvertToClaimTxJson(convertArgs());

// ── claim_draw 入参 ──
const claimState = { ...closedState, claimed_bitmap: 0 };
const BET = { bettor_pk: COMMITTEE_PK, side: 1, stake: 999 };
const args = (over = {}) => withParents('claim_draw', {
  kaspa, network: 'mainnet', marketId: MARKET_ID, claimState,
  rootClaimOutpoint: { txid: convertToClaim.expectedTxid, vout: CONVERT_TO_CLAIM_CLAIM_OUT_INDEX }, rootClaimUtxoScriptPublicKeyHex: spkOf(convertToClaim.txJson, CONVERT_TO_CLAIM_CLAIM_OUT_INDEX),
  rootClaimCovId: convertToClaim.claimCovId, heldTokenOutpoint: { txid: convertToClaim.expectedTxid, vout: CONVERT_TO_CLAIM_TOKEN_OUT_INDEX },
  ticketOutpoint: { txid: bet2.built.expectedTxid, vout: 1 }, ticketUtxoScriptPublicKeyHex: spkOf(bet2.built.txJson, 1),
  bet: BET, committeePrivkeyEnvelope: ga.committeePrivkeyEnvelope, payout: 1000,
  tokPrefixHex, tokSuffixHex, feeUtxo: bigFee(7), relayChangeScriptPublicKeyHex: relaySpkHex, absFeeCapSompi: 100_000_000n, ...over,
});

let built;
t('①claim_draw buildClaimDrawTxJson 真实构造成功([RootClaim,ticket,heldKTT,fee]四输入, 三输出)', () => {
  built = buildClaimDrawTxJson(args());
  if (JSON.stringify(built.signInputIndices) !== '[3]' || JSON.stringify(built.genesisOutputIndices) !== '[0,1]') throw new Error('签名/genesis 下标不对');
  if (kaspa.Transaction.deserializeFromSafeJSON(built.txJson).inputs.length !== 4) throw new Error('应为4输入');
});
t('②relay 真代码: 反序列化+extractTxShape+validateFixedValueOutputs 通过; relay 真签 fee 输入后 finalize, txid==expectedTxid', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
  const fv = validateFixedValueOutputs({ outputs: extractTxShape(tx).outputs, genesisOutputIndices: built.genesisOutputIndices, continuationOutputIndices: [] });
  if (!fv.ok) throw new Error(`relay真代码拒绝: ${fv.reason}`);
  signOnlyDeclaredInputs({ tx, signInputIndices: built.signInputIndices, privateKey: relayPriv, kaspa });
  tx.finalize();
  const r = assertFinalTxid(tx, built.expectedTxid); if (!r.ok) throw new Error(`签名后txid=${r.actualTxid} != ${built.expectedTxid}`);
  assertKaspadInputVersionRule(kaspa.Transaction.deserializeFromSafeJSON(built.txJson), 'claim_draw-e2e');
});
t('③独立复算 Σin−Σout 恰等于 netLoss; covenant_id 用 kaspa.covenantId 独立复算', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
  let sIn = 0n, sOut = 0n; for (const i of tx.inputs) sIn += BigInt(i.utxo.amount); for (const o of tx.outputs) sOut += BigInt(o.value);
  if (sIn - sOut !== built.netLoss) throw new Error(`隐含费 ${sIn - sOut} != netLoss ${built.netLoss}`);
  const feeOp = { transactionId: String(tx.inputs[3].previousOutpoint.transactionId), index: Number(tx.inputs[3].previousOutpoint.index) };
  const indep = String(kaspa.covenantId(feeOp, [{ index: 0, output: new kaspa.TransactionOutput(tx.outputs[0].value, tx.outputs[0].scriptPublicKey) }]));
  if (indep.toLowerCase() !== String(tx.outputs[0].covenant.covenantId).toLowerCase()) throw new Error('KanetTokenClaim covenant_id 与独立复算不一致');
});

// 🔴 ticket 签名真验签(独立移植 sighash + schnorr)
const parsePushes = (hex) => {
  const b = Buffer.from(hex, 'hex'); const out = []; let i = 0;
  while (i < b.length) {
    const op = b[i++];
    if (op === 0x00) out.push(Buffer.alloc(0));
    else if (op >= 0x01 && op <= 0x4b) { out.push(b.subarray(i, i + op)); i += op; }
    else if (op === 0x4c) { const n = b[i++]; out.push(b.subarray(i, i + n)); i += n; }
    else if (op === 0x4d) { const n = b.readUInt16LE(i); i += 2; out.push(b.subarray(i, i + n)); i += n; }
    else if (op === 0x4e) { const n = b.readUInt32LE(i); i += 4; out.push(b.subarray(i, i + n)); i += n; }
    else if (op === 0x4f) out.push(Buffer.from([0x81]));
    else if (op >= 0x51 && op <= 0x60) out.push(Buffer.from([op - 0x50]));
    else throw new Error('非push opcode 0x' + op.toString(16));
  }
  return out;
};
const decodeInt = (buf) => { if (buf.length === 0) return 0; if (buf.length === 1 && buf[0] === 0x81) return -1; let v = 0n; for (let k = buf.length - 1; k >= 0; k--) v = (v << 8n) | BigInt(buf[k]); return Number(v); };
const sighashInput = (tx) => ({
  version: Number(tx.version), lockTime: BigInt(tx.lockTime),
  inputs: tx.inputs.map((i) => ({ txid: String(i.previousOutpoint.transactionId), index: Number(i.previousOutpoint.index), sequence: BigInt(i.sequence), spkHex: String(i.utxo.scriptPublicKey.script), amount: BigInt(i.utxo.amount) })),
  outputs: tx.outputs.map((o) => ({ value: BigInt(o.value), spkHex: String(o.scriptPublicKey.script), covenant: o.covenant ? { auth: Number(o.covenant.authorizingInput), id: String(o.covenant.covenantId) } : null })),
});
const ticketSig = (tx) => { const p = parsePushes(String(tx.inputs[CLAIM_DRAW_TICKET_IN_INDEX].signatureScript).replace(/^0x/, '')); return p[0]; };
t('④a 【真验签】ticket 的 bettorSig 对【最终tx】的共识 sighash 有效(独立移植 sighash + schnorr; 私钥=委员私钥, 公钥=bettor_pk)', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
  const sig = ticketSig(tx);
  if (!sig || sig.length !== 65) throw new Error(`ticket 签名 push 长度=${sig?.length}`);
  if (!schnorrVerify(sig.subarray(0, 64).toString('hex'), sighashAll(sighashInput(tx), CLAIM_DRAW_TICKET_IN_INDEX), COMMITTEE_PK)) throw new Error('ticket 签名对最终tx验签失败');
});
t('④b 反向臂: 同一笔tx去掉 output0/1 的 covenant 后重算 sighash, ticket 签名必须验假(检查对 covenant 敏感 + 签名确实承诺了 covenant)', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
  const d = sighashInput(tx);
  const stripped = { ...d, outputs: d.outputs.map((o, k) => (k <= 1 ? { ...o, covenant: null } : o)) };
  if (schnorrVerify(ticketSig(tx).subarray(0, 64).toString('hex'), sighashAll(stripped, CLAIM_DRAW_TICKET_IN_INDEX), COMMITTEE_PK)) throw new Error('去掉 covenant 后签名仍验真——检查对 covenant 不敏感');
});
t('④c 换 fee 面值(不同找零候选)各自重签: 每个最终tx的 ticket 签名都验真', () => {
  let verified = 0;
  for (const value of [10_000_000_000n, 95_000_000n, 60_000_000n]) {
    let b; try { b = buildClaimDrawTxJson(args({ feeUtxo: { ...bigFee(7), value } })); } catch (e) { if (/mass超过|no_viable_change_shape|insufficient/.test(e.message)) continue; throw e; }
    const tx = kaspa.Transaction.deserializeFromSafeJSON(b.txJson);
    if (!schnorrVerify(ticketSig(tx).subarray(0, 64).toString('hex'), sighashAll(sighashInput(tx), CLAIM_DRAW_TICKET_IN_INDEX), COMMITTEE_PK)) throw new Error(`fee=${value} includeChange=${b.includeChange}: 验签失败`);
    verified++;
  }
  if (verified < 2) throw new Error(`只验了${verified}个面值`);
});

// 自检两侧独立: KanetTokenClaim 输出 spk 用"全0探针 + 手工 splice + 自算 P2SH"
t('⑤ KanetTokenClaim 输出 spk 与独立"探针+手工splice+自算P2SH"逐字节一致(state: market_cov_id/winner_pk/amount/token_tmpl_hash)', () => {
  const probe = compileSilV100(libPath('./KanetTokenClaim.sil'), [ctorBytes32V100('00'.repeat(32)), ctorBytes32V100('00'.repeat(32)), ctorIntV100(0), ctorBytes32V100(token_tmpl_hash)], 'KanetTokenClaim');
  const ps = Buffer.from(probe.script); const { start, len } = probe.state_layout;
  const fInt = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return Buffer.concat([Buffer.from([8]), b]); };
  const fB32 = (h) => Buffer.concat([Buffer.from([32]), Buffer.from(h, 'hex')]);
  const state = Buffer.concat([fB32(convertToClaim.claimCovId), fB32(COMMITTEE_PK), fInt(1000), fB32(token_tmpl_hash)]);
  if (state.length !== len) throw new Error(`手工 state 长度 ${state.length} != ${len}`);
  const spk = 'aa20' + Buffer.from(blake2b(Uint8Array.from(Buffer.concat([ps.subarray(0, start), state, ps.subarray(start + len)])), { dkLen: 32 })).toString('hex') + '87';
  if (String(kaspa.Transaction.deserializeFromSafeJSON(built.txJson).outputs[0].scriptPublicKey.script) !== spk) throw new Error('KanetTokenClaim spk 与独立构造不一致');
});

// 见证映射
const rcAbi = () => computeRootClaimGenesisArtifact({ marketId: MARKET_ID, state: claimState }).entries.claim_draw;
t('⑥ RootClaim input 见证里各索引/数值位置与交易真实结构一致(独立 push 解析器): claimOutIdx=0 tokenOutIdx=1 ticketInIdx=1 tokenInIdx=2 payout=1000 merkle_index=0 tree_depth=0 siblings 空', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
  const abi = rcAbi(); const pushes = parsePushes(String(tx.inputs[0].signatureScript).replace(/^0x/, ''));
  const at = (n) => pushes[abi.params.findIndex((p) => p.name === n)];
  const v = (n) => decodeInt(at(n));
  const op = (i) => `${tx.inputs[i].previousOutpoint.transactionId}:${tx.inputs[i].previousOutpoint.index}`;
  if (op(v('ticketInIdx')) !== `${bet2.built.expectedTxid}:1`) throw new Error('ticketInIdx 指向的输入不是 ticket outpoint');
  if (op(v('tokenInIdx')) !== `${convertToClaim.expectedTxid}:1`) throw new Error('tokenInIdx 指向的输入不是 held 代币 outpoint');
  if (v('claimOutIdx') !== 0 || v('tokenOutIdx') !== 1 || v('payout') !== 1000 || v('merkle_index') !== 0 || v('tree_depth') !== 0) throw new Error('索引/数值不对');
  if (at('siblings').length !== 0) throw new Error('depth-0 siblings 应为空 push');
  if (v('ticket_prefix_len') !== built.ticketPrefixLen || v('ticket_suffix_len') !== built.ticketSuffixLen) throw new Error('ticket 前后缀长度不对');
  if (CLAIM_DRAW_TICKET_IN_INDEX === CLAIM_DRAW_HELD_IN_INDEX) throw new Error('测试退化: ticket 与 held 输入下标相同, 无法发现互换');
});
// 🔴 哨兵: 所有索引参数两两不同(Bettor 采纳 NWT)——这是 builder 层映射被换位时的守卫
t('⑦哨兵 claimDrawWitnessArgs: 6 个索引参数在哨兵输入(0..5 两两不同)下各落在自己具名的字段, 且输出里两两不同', () => {
  const a = claimDrawWitnessArgs({ rootOutIdx: 0, claimOutIdx: 1, tokenInIdx: 2, tokenOutIdx: 3, remainTokenOutIdx: 4, ticketInIdx: 5, payout: 7, merkleIndex: 8, treeDepth: 9, siblings: [], ticketPrefixLen: 10, ticketSuffixLen: 11, tokPrefixHex: '0xcc', tokSuffixHex: '0xdd', claimPrefixHex: 'aa', claimSuffixHex: 'bb' });
  const idx = [a.rootOutIdx, a.claimOutIdx, a.tokenInIdx, a.tokenOutIdx, a.remainTokenOutIdx, a.ticketInIdx];
  if (JSON.stringify(idx) !== '[0,1,2,3,4,5]') throw new Error(`映射不对: ${JSON.stringify(idx)}`);
  if (new Set(idx).size !== idx.length) throw new Error('索引参数不是两两不同');
  if (a.merkle_index !== 8 || a.tree_depth !== 9 || a.ticket_prefix_len !== 10 || a.ticket_suffix_len !== 11 || a.payout !== 7 || a.claim_prefix !== '0xaa' || a.claim_suffix !== '0xbb') throw new Error('数值/前后缀映射不对');
});
t('⑧结构断言 assertClaimDrawLayout: 正确布局放行; ticket/held outpoint 互换、KanetTokenClaim/代币输出下标错 各自必拒', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
  const a = args();
  const ok = { tx, rootClaimOutpoint: a.rootClaimOutpoint, ticketOutpoint: a.ticketOutpoint, heldTokenOutpoint: a.heldTokenOutpoint, expectedKtcSpkHex: '0x' + tx.outputs[0].scriptPublicKey.script, expectedTokenOutSpkHex: '0x' + tx.outputs[1].scriptPublicKey.script };
  assertClaimDrawLayout(ok);
  throws(() => assertClaimDrawLayout({ ...ok, ticketOutpoint: a.heldTokenOutpoint, heldTokenOutpoint: a.ticketOutpoint }), /ticketInIdx/);
  throws(() => assertClaimDrawLayout({ ...ok, expectedKtcSpkHex: ok.expectedTokenOutSpkHex }), /claimOutIdx/);
  throws(() => assertClaimDrawLayout({ ...ok, expectedTokenOutSpkHex: ok.expectedKtcSpkHex }), /tokenOutIdx/);
});

// ── 🔴 MUST-PROVE 集成: 签名前断言 ──
const otherGa = await computeMarketGenesisArtifacts({ marketId: 'cd'.repeat(32), minBet: 1, deadlineMs: DEADLINE_MS });
t('⑨a Codex 反向①: 只有【别的市场的委员私钥】可用(bettorPk != 该私钥的公钥) ⇒ signing_key_mismatch, 在任何签名之前 fail-closed, 不静默顶替, 错误信息不含私钥', () => {
  const otherPriv = decryptCommitteePrivkey(otherGa.committeePrivkeyEnvelope);
  throws(() => buildClaimDrawTxJson(args({ committeePrivkeyEnvelope: otherGa.committeePrivkeyEnvelope })), /signing_key_mismatch.*fail-closed/, [otherPriv]);
});
t('⑨b Codex 正向②: 推导出的应签公钥与私钥的公钥逐字节相等才放行(①已证正向)——DB 里 bettor_pk 大写 hex 同一把公钥也放行', () => {
  buildClaimDrawTxJson(args({ bet: { ...BET, bettor_pk: COMMITTEE_PK.toUpperCase() } }));
});
t('⑨c DB 里 bettor_pk 被换成别人的公钥(与链上 ticket 不是同一张票) ⇒ ticket_pk_underivable', () => {
  throws(() => buildClaimDrawTxJson(args({ bet: { ...BET, bettor_pk: '11'.repeat(32) } })), /fail-closed|ticket_pk_underivable/);
});
t('⑨d 签名前断言在【任何 PrivateKey 用于签名之前】执行: 断言失败时 createInputSignature 一次都没被调用', () => {
  let signCalls = 0;
  const wrapped = { ...kaspa, createInputSignature: (...a) => { signCalls++; return kaspa.createInputSignature(...a); } };
  const otherPriv = decryptCommitteePrivkey(otherGa.committeePrivkeyEnvelope);
  throws(() => buildClaimDrawTxJson(args({ kaspa: wrapped, committeePrivkeyEnvelope: otherGa.committeePrivkeyEnvelope })), /signing_key_mismatch/, [otherPriv]);
  if (signCalls !== 0) throw new Error(`签名前断言失败后 createInputSignature 仍被调用了 ${signCalls} 次`);
});

// ── fail-closed ──
t('⑩ fail-closed: partial(payout != pool_value) / payout<1000 / 票方向!=winningSide / payoutRoot 对不上 / claimed_bitmap!=0 / closed!=1 / 链上 RootClaim spk 不符 / outpoint 缺失', () => {
  throws(() => buildClaimDrawTxJson(args({ payout: 999 })), /partial 分支/);
  throws(() => buildClaimDrawTxJson(args({ claimState: { ...claimState, pool_value: 999 }, payout: 999 })), /payout\(999\) < 1000/);
  throws(() => buildClaimDrawTxJson(args({ bet: { ...BET, side: 0 } })), /这张不是赢票|票面方向/);
  throws(() => buildClaimDrawTxJson(args({ claimState: { ...claimState, payoutRoot: 'cd'.repeat(32) } })), /payoutRoot/);
  throws(() => buildClaimDrawTxJson(args({ claimState: { ...claimState, claimed_bitmap: 1 } })), /claimed_bitmap/);
  throws(() => buildClaimDrawTxJson(args({ claimState: { ...claimState, closed: 0 } })), /closed/);
  throws(() => buildClaimDrawTxJson(args({ rootClaimUtxoScriptPublicKeyHex: '0xaa20' + '11'.repeat(32) + '87' })), /链上UTXO spk/);
  throws(() => buildClaimDrawTxJson(args({ rootClaimUtxoScriptPublicKeyHex: undefined })), /链上UTXO spk/);
  throws(() => buildClaimDrawTxJson(args({ heldTokenOutpoint: null })), /必填/);
});
t('⑪ 私钥不进返回值; 构造过程中 new 的 PrivateKey 全部 free(created == freed)', () => {
  const priv = decryptCommitteePrivkey(ga.committeePrivkeyEnvelope);
  if (JSON.stringify(built, (k, v) => (typeof v === 'bigint' ? v.toString() : v)).includes(priv)) throw new Error('明文私钥出现在返回值里');
  let created = 0, freed = 0;
  class Tracked extends kaspa.PrivateKey { constructor(...a) { super(...a); created++; } free() { freed++; return super.free(); } }
  buildClaimDrawTxJson(args({ kaspa: { ...kaspa, PrivateKey: Tracked } }));
  if (created < 1 || created !== freed) throw new Error(`PrivateKey created=${created} freed=${freed}`);
});

// ══════════ 9-1 E 笔: chainParents 与 builder 侧断言(设计 v0.3.4 §19.4 / §19.5 B 组) ══════════
// 四个 builder(seal / close_commit / convert_to_claim / claim_draw)新增【必填】chainParents = {[role]:{value:bigint, spkLen, hasCovenant}}, 生产里来自 C1 经断言的链上事实;
// 在 selectChangeShape / assertMassWithinCeiling【之前】与 builder 假设逐项对: 缺失 / hasCovenant / spkLen / value 任一不符 ⇒ ChainParentsError(.code='chain_parents_mismatch', 带角色名)。
const CHK = await import('./proto-settlement-chain-checks.mjs');
const { goodChainParents, withSwappedOutpoint } = await import('./proto-chain-parents-fixtures.mjs');
const B_STEPS = [
  { step: 'seal', mk: (o) => sealArgs(o), build: buildMarketSealTxJson, vec: 'MARKET_SEAL_INPUT_HAS_COVENANT' },
  { step: 'close_commit', mk: (o) => closeCommitArgs(o), build: buildCloseCommitTxJson, vec: 'CLOSE_COMMIT_INPUT_HAS_COVENANT' },
  { step: 'convert_to_claim', mk: (o) => convertArgs(o), build: buildConvertToClaimTxJson, vec: 'CONVERT_TO_CLAIM_INPUT_HAS_COVENANT' },
  { step: 'claim_draw', mk: (o) => args(o), build: buildClaimDrawTxJson, vec: 'CLAIM_DRAW_INPUT_HAS_COVENANT' },
];
const cpRoles = (step) => [...CHK.STEP_INPUT_ROLES[step], 'fee'];
const capture = (fn) => { let e = null; try { fn(); } catch (x) { e = x; } return e; };
const expectCP = (fn, role, label) => {
  const e = capture(fn);
  if (!e) throw new Error(`${label}: 应该抛 ChainParentsError, 却成功返回了`);
  if (!(e instanceof S.ChainParentsError)) throw new Error(`${label}: 不是 ChainParentsError: ${e.constructor && e.constructor.name}: ${e.message}`);
  if (e.code !== 'chain_parents_mismatch') throw new Error(`${label}: code=${e.code}`);
  if (e.role !== role) throw new Error(`${label}: role=${e.role}, 期望 ${role}`);
  if (role !== undefined && !e.message.includes(role)) throw new Error(`${label}: 消息里没有角色名: ${e.message}`);
  return e;
};

t('B1 ▲ 四个 builder × 每个输入角色(含 fee)× 变异: chainParents 缺失 / 条目为 null / hasCovenant 翻转 / spkLen ±1 / value ±1 / value 非 bigint / spkLen 非整数 ⇒ chain_parents_mismatch(带角色名)', () => {
  let n = 0;
  for (const { step, mk, build } of B_STEPS) {
    const base = mk();
    expectCP(() => build({ ...base, chainParents: undefined }), undefined, `${step}/入参缺失`); n++;
    for (const role of cpRoles(step)) {
      const mut = (f) => { const cp = goodChainParents(step, base); f(cp[role], cp); return { ...base, chainParents: cp }; };
      const cases = [
        ['缺条目', (p, cp) => { delete cp[role]; }],
        ['条目为 null', (p, cp) => { cp[role] = null; }],
        ['hasCovenant 翻转', (p) => { p.hasCovenant = !p.hasCovenant; }],
        ['spkLen+1', (p) => { p.spkLen += 1; }],
        ['spkLen-1', (p) => { p.spkLen -= 1; }],
        ['value+1', (p) => { p.value += 1n; }],
        ['value-1', (p) => { p.value -= 1n; }],
        ['value 非 bigint', (p) => { p.value = Number(p.value); }, true],
        ['spkLen 非整数', (p) => { p.spkLen = '35'; }, true],
        ['hasCovenant 非 boolean', (p) => { p.hasCovenant = 1; }, true],
        // F2(NWT E-1): chainParents 必须绑定到它证明的那个 outpoint
        ['outpoint 缺失', (p) => { delete p.outpoint; }, true],
        ['outpoint 不是对象', (p) => { p.outpoint = 'x'; }, true],
        ['outpoint.txid 大写(非小写 hex; 用确定含大写字母的值——夹具里有全数字 txid, toUpperCase 对它是空操作)', (p) => { p.outpoint.txid = 'AB'.repeat(32); }, true],
        ['outpoint.txid 太短', (p) => { p.outpoint.txid = p.outpoint.txid.slice(2); }, true],
        ['outpoint.index 为负', (p) => { p.outpoint.index = -1; }, true],
        ['outpoint.index 是字符串', (p) => { p.outpoint.index = String(p.outpoint.index); }, true],
        ['outpoint.txid 换成另一个', (p) => { p.outpoint.txid = 'dd'.repeat(32); }, false, /builder 实际要花的 outpoint/],
        ['outpoint.txid 只差最后一位', (p) => { p.outpoint.txid = p.outpoint.txid.slice(0, -1) + (p.outpoint.txid.endsWith('0') ? '1' : '0'); }, false, /builder 实际要花的 outpoint/],
        ['outpoint.index+1(同 txid 另一个输出——N-T1 同族)', (p) => { p.outpoint.index += 1; }, false, /builder 实际要花的 outpoint/],
      ];
      for (const [name, f, isShape, msgRe] of cases) {
        const e = expectCP(() => build(mut(f)), role, `${step}/${role}/${name}`); n++;
        if (msgRe && !msgRe.test(e.message)) throw new Error(`${step}/${role}/${name}: 报文应指明 outpoint 不符: ${e.message}`);
        // 形状畸形须报'形状不合法'(后面的严格相等比较碰巧也会拒, 但那是另一条报文——这里钉死形状校验本身在起作用)
        if (isShape && !e.message.includes('形状不合法')) throw new Error(`${step}/${role}/${name}: 报文不是形状校验: ${e.message}`);
      }
    }
    { const cp = goodChainParents(step, base); cp.bogus = { value: 1n, spkLen: 35, hasCovenant: false }; expectCP(() => build({ ...base, chainParents: cp }), 'bogus', `${step}/多余角色`); n++; }
  }
  if (n !== 236) throw new Error(`用例数 ${n} != 236(每步 1 + 角色数×19 + 1, 四步合计)`);
});
t('B1b ▲ seal 的 held: value 有两道独立的核对——(a)chainParents.held.value 与 builder 实际用的 heldInput.value 不等(期望常量相等)⇒拒; (b)两者相等但都不是期望常量 ⇒ 拒', () => {
  const base = sealArgs();
  expectCP(() => buildMarketSealTxJson({ ...base, heldInput: { ...base.heldInput, value: 30_000_000n } }), 'held', 'seal/held ④: chainParents=20M, heldInput=30M');
  const cp = goodChainParents('seal', base); cp.held.value = 30_000_000n;
  expectCP(() => buildMarketSealTxJson({ ...base, heldInput: { ...base.heldInput, value: 30_000_000n }, chainParents: cp }), 'held', 'seal/held ③: 两者都是 30M 但期望常量是 20M');
});
t('B1c ▲ 断言先于 mass/fee 与私钥: 用会让 selectChangeShape 抛"超过绝对费率上限"的 absFeeCapSompi=1n——坏 chainParents 仍是 chain_parents_mismatch(证明断言在前), 且 close_commit / claim_draw 没有 new 过任何 PrivateKey; 对照: 好 chainParents 在同一上限下抛的是别的错误', () => {
  for (const { step, mk, build } of B_STEPS) {
    let created = 0;
    class Tracked extends kaspa.PrivateKey { constructor(...a) { super(...a); created++; } }
    const base = { ...mk(), kaspa: { ...kaspa, PrivateKey: Tracked }, absFeeCapSompi: 1n };
    const bad = goodChainParents(step, base); const role = cpRoles(step)[0]; bad[role].hasCovenant = !bad[role].hasCovenant;
    expectCP(() => build({ ...base, chainParents: bad }), role, `${step}/坏 chainParents 应先于 mass/fee`);
    if (created !== 0) throw new Error(`${step}: 断言失败时已 new 了 ${created} 个 PrivateKey(私钥不该在断言前被解出)`);
    const ctl = capture(() => build(base));
    if (!ctl) throw new Error(`${step}: 对照失败——absFeeCapSompi=1n 本应让构造失败(否则本用例不证明顺序)`);
    if (ctl instanceof S.ChainParentsError) throw new Error(`${step}: 好 chainParents 不该抛 ChainParentsError: ${ctl.message}`);
  }
});
t('B1d ▲ NWT E-1 探针回归(chainParents 绑定 outpoint): 证据按 outpoint A 取、builder 实际被交给同面值同 spk 的 outpoint B ⇒ chain_parents_mismatch(带角色名, 报文指明 outpoint); 四个 builder × 每个输入角色(含 fee) × {换 txid, 同 txid 换 index}; 对照臂: chainParents 也按 B 重算 ⇒ 构造成功(证明拒绝的是"身份不符", 换 outpoint 本身合法)', () => {
  let n = 0;
  for (const { step, mk, build } of B_STEPS) {
    for (const role of cpRoles(step)) {
      const base = mk(); const orig = goodChainParents(step, base);
      const A = orig[role].outpoint;
      for (const [label, B] of [['换 txid', { txid: 'dd'.repeat(32), vout: A.index }], ['同 txid 换 index', { txid: A.txid, vout: A.index + 7 }]]) {
        const swapped = withSwappedOutpoint(step, base, role, B);
        const e = expectCP(() => build({ ...swapped, chainParents: orig }), role, `${step}/${role}/${label}: 证据 A、实花 B`);
        if (!/builder 实际要花的 outpoint/.test(e.message)) throw new Error(`${step}/${role}/${label}: 报文应指明 outpoint 不符: ${e.message}`);
        const ok2 = build({ ...swapped, chainParents: goodChainParents(step, swapped) });
        if (!ok2.txJson) throw new Error(`${step}/${role}/${label}: 对照臂应构造成功`);
        n++;
      }
    }
  }
  if (n !== 24) throw new Error(`用例数 ${n} != 24(12 个输入角色 × 2 种换法)`);
});
t('B1e 直接测导出的断言函数: chainParents 的 outpoint.txid(恒小写)与 used 的 txid 比较大小写不敏感、index 数值比较(used.vout 是数字); 大写写法的同一个 outpoint ⇒ 通过, 不同 outpoint ⇒ 拒。(经 builder 测不了: 既有的 assertWitnessIndexLayout 等布局校验对 txid 大小写敏感, builder 入参本就须小写)', () => {
  const T = 'ab'.repeat(32);
  const cp = () => ({ rootClose: { value: 20_000_000n, spkLen: 35, hasCovenant: true, outpoint: { txid: T, index: 3 } }, fee: { value: 5n, spkLen: 34, hasCovenant: false, outpoint: { txid: 'cd'.repeat(32), index: 0 } } });
  const used = (rcTxid, rcVout) => ({ rootClose: { value: 20_000_000n, spkHex: 'aa20' + '11'.repeat(32) + '87', outpoint: { txid: rcTxid, vout: rcVout } }, fee: { value: 5n, spkHex: '20' + 'cd'.repeat(32) + 'ac', outpoint: { txid: 'CD'.repeat(32), vout: 0 } } });
  const run = (u) => S.assertChainParentsMatchBuilder({ step: 'close_commit', label: 'unit', chainParents: cp(), inputHasCovenant: S.CLOSE_COMMIT_INPUT_HAS_COVENANT, used: u });
  run(used(T.toUpperCase(), 3));                                                                       // 大写写法(rootClose 与 fee 都是): 通过
  expectCP(() => run(used(T, 4)), 'rootClose', '同 txid 另一个 index');
  expectCP(() => run(used('ef'.repeat(32), 3)), 'rootClose', '另一个 txid');
  // 内部不变量: builder 忘了在 used[role] 里给 outpoint ⇒ 是 builder 自己的 bug, 抛普通 Error(带"内部错误"), 不是 ChainParentsError(不能被当成"调用方给的事实不符")
  { const u = used(T, 3); delete u.fee.outpoint; const e = capture(() => run(u));
    if (!e || e instanceof S.ChainParentsError || !/内部错误/.test(e.message)) throw new Error(`应抛普通内部错误, 实际: ${e && e.constructor.name}: ${e && e.message}`); }
});
t('B1f builder 层面的大小写对照(Bettor 提醒): builder 入参里 outpoint.txid 是大写写法(DB / 调用方不保证小写)⇒ chainParents 断言【绝不误拒】(若构造失败, 只能是既有布局校验的错、不能是 ChainParentsError); 至少 fee 角色(四个 builder)能完整构造成功; 对照: 换成别的 outpoint ⇒ 拒(见 B1d)', () => {
  let passed = 0; const preexisting = [];
  for (const { step, mk, build } of B_STEPS) {
    for (const role of cpRoles(step)) {
      const base = mk(); const orig = goodChainParents(step, base); const A = orig[role].outpoint;
      const upper = withSwappedOutpoint(step, base, role, { txid: A.txid.toUpperCase(), vout: A.index });
      let e = null; try { build({ ...upper, chainParents: orig }); passed++; } catch (x) { e = x; }
      if (e instanceof S.ChainParentsError) throw new Error(`${step}/${role}: 大写 txid 被 chainParents 断言误拒: ${e.message}`);
      if (e) preexisting.push(`${step}/${role}`);
      if (role === 'fee' && e) throw new Error(`${step}/fee: 大写 txid 的 fee 应能完整构造成功, 实际: ${e.message}`);
    }
  }
  if (passed < 4) throw new Error(`能完整构造成功的只有 ${passed} 个(至少 4 个 fee)`);
  console.log(`   B1f: 大写 txid 完整构造成功 ${passed}/12 个输入角色; 其余 ${preexisting.length} 个(${preexisting.join(', ')})被【既有】的大小写敏感布局校验拒绝(与本断言无关)`);
});
const SCAN = await import('../../../shared/test-fixtures/source-scan/scan-non-test-sources.mjs');
t('B6 ▲ (NWT E-4 / F2-1) 夹具文件只准被测试 import: 共享扫描器(test-fixtures/source-scan)扫整个仓库的非测试源码——含 kasia-console/src/data、kasia-console/scripts、根 scripts、ts/mts/tsx 等, 排除只按仓库根相对路径; 任何 import / require / 字面量动态 import 它都算违规(动态拼接是文本扫描的已知边界, 见扫描器头注)', () => {
  const bad = SCAN.findReferencesInNonTestSources(/proto-chain-parents-fixtures/, { exceptRel: ['kasia-console/src/lib/proto-chain-parents-fixtures.mjs'] });
  if (bad.length) throw new Error(`非测试源码引用了仅测试用的夹具: ${bad.join(', ')}`);
});
t('B2 输入 covenant 向量与 STEP_INPUT_ROLES 逐项一致(fee 槽恒 false), 且与夹具里独立写出的字面值一致', () => {
  for (const { step, vec, mk } of B_STEPS) {
    const v = S[vec]; const roles = cpRoles(step);
    if (!Object.isFrozen(v)) throw new Error(`${vec} 必须冻结`);
    if (v.length !== roles.length) throw new Error(`${vec} 长度 ${v.length} != 输入角色数 ${roles.length}`);
    if (v[v.length - 1] !== false) throw new Error(`${vec} 最后一格(fee)必须是 false`);
    const fx = goodChainParents(step, mk());
    roles.forEach((r, i) => { if (v[i] !== fx[r].hasCovenant) throw new Error(`${vec}[${i}](${r}) = ${v[i]} != 夹具 ${fx[r].hasCovenant}`); });
  }
});
t('B3 close_commit 返回 continuationOutputIndices:[0] 且过 relay 真代码 validateFixedValueOutputs(P6)', () => {
  if (JSON.stringify(closeCommit.continuationOutputIndices) !== JSON.stringify([CLOSE_COMMIT_ROOTCLOSE_OUT_INDEX])) throw new Error(`continuationOutputIndices=${JSON.stringify(closeCommit.continuationOutputIndices)}`);
  const shape = extractTxShape(kaspa.Transaction.deserializeFromSafeJSON(closeCommit.txJson));
  const fv = validateFixedValueOutputs({ outputs: shape.outputs, genesisOutputIndices: [], continuationOutputIndices: closeCommit.continuationOutputIndices });
  if (!fv.ok) throw new Error(`relay 真代码拒绝: ${fv.reason}`);
  if (JSON.stringify(closeCommit.signInputIndices) !== JSON.stringify([S.CLOSE_COMMIT_FEE_IN_INDEX])) throw new Error(`signInputIndices=${JSON.stringify(closeCommit.signInputIndices)}`);
});
t('B4 导出的输入下标常量与 builder 实际布局逐项对上: 产出交易的 inputs[常量下标].previousOutpoint 就是该角色的入参 outpoint; 且 STEP_INPUT_ROLES 的角色顺序 == 下标顺序', () => {
  const opOf = (tx, i) => `${tx.inputs[i].previousOutpoint.transactionId}:${Number(tx.inputs[i].previousOutpoint.index)}`;
  const k = (o) => `${o.txid}:${o.vout}`;
  const de = (b) => kaspa.Transaction.deserializeFromSafeJSON(b.txJson);
  { const a = sealArgs(); const tx = de(seal);
    const idx = { leaf: S.MARKET_SEAL_LEAF_IN_INDEX, held: S.MARKET_SEAL_HELD_IN_INDEX, fee: S.MARKET_SEAL_FEE_IN_INDEX };
    if (opOf(tx, idx.leaf) !== k(a.leafOutpoint) || opOf(tx, idx.held) !== k(a.heldInput) || opOf(tx, idx.fee) !== k(a.feeUtxo)) throw new Error('seal 输入布局与常量不符');
    if (JSON.stringify(cpRoles('seal').map((r) => idx[r])) !== JSON.stringify([0, 1, 2])) throw new Error('seal 角色顺序 != 下标顺序');
    if (tx.inputs.length !== 3 || JSON.stringify(seal.signInputIndices) !== JSON.stringify([idx.fee])) throw new Error('seal 输入数或 signInputIndices 不符'); }
  { const a = closeCommitArgs(); const tx = de(closeCommit);
    const idx = { rootClose: S.CLOSE_COMMIT_ROOTCLOSE_IN_INDEX, fee: S.CLOSE_COMMIT_FEE_IN_INDEX };
    if (opOf(tx, idx.rootClose) !== k(a.rootCloseOutpoint) || opOf(tx, idx.fee) !== k(a.feeUtxo)) throw new Error('close_commit 输入布局与常量不符');
    if (JSON.stringify(cpRoles('close_commit').map((r) => idx[r])) !== JSON.stringify([0, 1])) throw new Error('close_commit 角色顺序 != 下标顺序');
    if (tx.inputs.length !== 2) throw new Error('close_commit 输入数不符'); }
  { const a = convertArgs(); const tx = de(convertToClaim);
    const idx = { rootClose: S.CONVERT_TO_CLAIM_ROOTCLOSE_IN_INDEX, held: S.CONVERT_TO_CLAIM_HELD_IN_INDEX, fee: S.CONVERT_TO_CLAIM_FEE_IN_INDEX };
    if (opOf(tx, idx.rootClose) !== k(a.rootCloseOutpoint) || opOf(tx, idx.held) !== k(a.heldTokenOutpoint) || opOf(tx, idx.fee) !== k(a.feeUtxo)) throw new Error('convert_to_claim 输入布局与常量不符');
    if (JSON.stringify(cpRoles('convert_to_claim').map((r) => idx[r])) !== JSON.stringify([0, 1, 2])) throw new Error('convert_to_claim 角色顺序 != 下标顺序'); }
  { const a = args(); const tx = de(built);
    const idx = { rootClaim: S.CLAIM_DRAW_ROOTCLAIM_IN_INDEX, ticket: S.CLAIM_DRAW_TICKET_IN_INDEX, held: S.CLAIM_DRAW_HELD_IN_INDEX, fee: S.CLAIM_DRAW_FEE_IN_INDEX };
    if (opOf(tx, idx.rootClaim) !== k(a.rootClaimOutpoint) || opOf(tx, idx.ticket) !== k(a.ticketOutpoint) || opOf(tx, idx.held) !== k(a.heldTokenOutpoint) || opOf(tx, idx.fee) !== k(a.feeUtxo)) throw new Error('claim_draw 输入布局与常量不符');
    if (JSON.stringify(cpRoles('claim_draw').map((r) => idx[r])) !== JSON.stringify([0, 1, 2, 3])) throw new Error('claim_draw 角色顺序 != 下标顺序'); }
});
// ══════════ 批7 withdraw(KanetTokenClaim.spend, 路径 (ii)) ══════════
// 链: …→claim_draw(built)→withdraw。KanetTokenClaim UTXO = claim_draw 输出0(covenant), 持有的代币 = claim_draw 输出1(covenant); 赢家 = 委员公钥(v0 映射)。
const {
  buildWithdrawTxJson, withdrawWitnessArgs, assertWithdrawLayout, assertWithdrawDestinationAllowed, WITHDRAW_DESTINATION_ALLOWLIST_SPK_HEX,
  WITHDRAW_KTC_IN_INDEX, WITHDRAW_HELD_IN_INDEX, WITHDRAW_FEE_IN_INDEX, WITHDRAW_TOKEN_OUT_INDEX, WITHDRAW_DEST_OUT_INDEX,
} = S;
const { computeKanetTokenClaimGenesisArtifact } = await import('./proto-covenant-builder.mjs');
const NWTM = await import('../../test-fixtures/proto-mass/nwt-port_mass.mjs');
const { assertMassWithinCeiling } = await import('./proto-mass-ceiling.mjs');
const { STEP_INPUT_ROLES } = await import('./proto-settlement-chain-checks.mjs');
const WITHDRAW_KTC_OUTPOINT_VOUT = () => KTC_OP.vout, WITHDRAW_HELD_OUTPOINT_VOUT = () => HELD_OP.vout;
const KTC_OP = { txid: built.expectedTxid, vout: CLAIM_DRAW_CLAIM_OUT_INDEX }, HELD_OP = { txid: built.expectedTxid, vout: CLAIM_DRAW_TOKEN_OUT_INDEX };
const DEST_SPK = '0xaa20' + 'ee'.repeat(32) + '87'; // 测试用、不可再花(随手一个 32 字节脚本哈希, 无人持有对应脚本)
const wArgs = (over = {}) => ({
  kaspa, network: 'simnet', marketCovId: convertToClaim.claimCovId, claimCovId: built.claimCovId, winnerPkHex: COMMITTEE_PK, amount: 1000,
  ktcOutpoint: KTC_OP, ktcUtxoScriptPublicKeyHex: spkOf(built.txJson, CLAIM_DRAW_CLAIM_OUT_INDEX), heldTokenOutpoint: HELD_OP,
  committeePrivkeyEnvelope: ga.committeePrivkeyEnvelope, destinationScriptPublicKeyHex: DEST_SPK, allowUnlistedTestDestination: true,
  tokPrefixHex, tokSuffixHex, feeUtxo: bigFee(8), relayChangeScriptPublicKeyHex: relaySpkHex, absFeeCapSompi: loadFeeProfileCap('withdraw'), ...over,
});
let wd;
t('⑫withdraw buildWithdrawTxJson 真实构造成功([KanetTokenClaim,heldKTT,fee]三输入, 目的地 covenant 输出 + 代币输出 + 找零)', () => {
  wd = buildWithdrawTxJson(wArgs());
  const tx = kaspa.Transaction.deserializeFromSafeJSON(wd.txJson);
  if (JSON.stringify(wd.signInputIndices) !== '[2]' || JSON.stringify(wd.genesisOutputIndices) !== '[0,1]') throw new Error('签名/genesis 下标不对');
  if (tx.inputs.length !== 3 || tx.outputs.length < 2) throw new Error('输入/输出数不对');
  if (wd.destGate !== 'unlisted_test_destination') throw new Error(`destGate=${wd.destGate}`);
  if (!tx.outputs[WITHDRAW_TOKEN_OUT_INDEX].covenant || !tx.outputs[WITHDRAW_DEST_OUT_INDEX].covenant) throw new Error('代币输出/目的地输出必须带 covenant 绑定');
  if (BigInt(tx.outputs[WITHDRAW_DEST_OUT_INDEX].value) !== 20_000_000n) throw new Error('目的地输出应为 GENESIS 面值');
});
t('⑬relay 真代码: 反序列化+extractTxShape+validateFixedValueOutputs 通过; 真签 fee 输入后 finalize, txid==expectedTxid', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(wd.txJson);
  const fv = validateFixedValueOutputs({ outputs: extractTxShape(tx).outputs, genesisOutputIndices: wd.genesisOutputIndices, continuationOutputIndices: [] });
  if (!fv.ok) throw new Error(`relay真代码拒绝: ${fv.reason}`);
  signOnlyDeclaredInputs({ tx, signInputIndices: wd.signInputIndices, privateKey: relayPriv, kaspa });
  tx.finalize();
  const r = assertFinalTxid(tx, wd.expectedTxid); if (!r.ok) throw new Error(`签名后txid=${r.actualTxid} != ${wd.expectedTxid}`);
});
t('⑭独立复算: Σin−Σout==netLoss; 目的地/代币两个 covenant_id 各自用 kaspa.covenantId 独立复算; 代币输出 owner 随目的地 covenant_id 变(换 fee outpoint ⇒ 代币 spk 变)', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(wd.txJson);
  let sIn = 0n, sOut = 0n; for (const i of tx.inputs) sIn += BigInt(i.utxo.amount); for (const o of tx.outputs) sOut += BigInt(o.value);
  if (sIn - sOut !== wd.netLoss) throw new Error(`隐含费 ${sIn - sOut} != netLoss ${wd.netLoss}`);
  const feeOp = { transactionId: String(tx.inputs[WITHDRAW_FEE_IN_INDEX].previousOutpoint.transactionId), index: Number(tx.inputs[WITHDRAW_FEE_IN_INDEX].previousOutpoint.index) };
  for (const idx of [WITHDRAW_TOKEN_OUT_INDEX, WITHDRAW_DEST_OUT_INDEX]) {
    const indep = String(kaspa.covenantId(feeOp, [{ index: idx, output: new kaspa.TransactionOutput(tx.outputs[idx].value, tx.outputs[idx].scriptPublicKey) }]));
    if (indep.toLowerCase() !== String(tx.outputs[idx].covenant.covenantId).toLowerCase()) throw new Error(`output[${idx}] covenant_id 与独立复算不一致`);
  }
  const wd2 = buildWithdrawTxJson(wArgs({ feeUtxo: bigFee(9) }));
  if (spkOf(wd2.txJson, WITHDRAW_TOKEN_OUT_INDEX) === spkOf(wd.txJson, WITHDRAW_TOKEN_OUT_INDEX)) throw new Error('目的地 covenant_id 变了, 代币输出 spk(owner)却没变——owner 没绑定目的地');
  if (wd2.destCovId === wd.destCovId) throw new Error('不同 fee outpoint 应给出不同 covenant_id');
});

// 🔴 KanetTokenClaim 输入签名真验签(独立移植 sighash + schnorr; 私钥=委员私钥, 公钥=claim 的 winner_pk)
const ktcAbiSpend = () => computeKanetTokenClaimGenesisArtifact({ marketCovIdHex: convertToClaim.claimCovId, winnerPkHex: COMMITTEE_PK, amount: 1000 }).entries.spend;
const ktcSig = (tx) => parsePushes(String(tx.inputs[WITHDRAW_KTC_IN_INDEX].signatureScript).replace(/^0x/, ''))[ktcAbiSpend().params.findIndex((p) => p.name === 's')];
t('⑮a 【真验签】KanetTokenClaim 的 s 对【最终tx】的共识 sighash 有效(独立移植 sighash + schnorr; 公钥=winner_pk)', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(wd.txJson);
  const sig = ktcSig(tx);
  if (!sig || sig.length !== 65) throw new Error(`KTC 签名 push 长度=${sig?.length}`);
  if (!schnorrVerify(sig.subarray(0, 64).toString('hex'), sighashAll(sighashInput(tx), WITHDRAW_KTC_IN_INDEX), COMMITTEE_PK)) throw new Error('KTC 签名对最终tx验签失败');
});
t('⑮b 反向臂: 同一笔tx去掉 output0/1 的 covenant 后重算 sighash, KTC 签名必须验假(检查对 covenant 敏感 + 签名确实承诺了 covenant)', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(wd.txJson);
  const d = sighashInput(tx);
  const stripped = { ...d, outputs: d.outputs.map((o, k) => (k <= 1 ? { ...o, covenant: null } : o)) };
  if (schnorrVerify(ktcSig(tx).subarray(0, 64).toString('hex'), sighashAll(stripped, WITHDRAW_KTC_IN_INDEX), COMMITTEE_PK)) throw new Error('去掉 covenant 后签名仍验真——检查对 covenant 不敏感');
});
t('⑮c 换 fee 面值(不同找零候选)各自重签: 每个最终tx的 KTC 签名都验真', () => {
  let verified = 0;
  for (const value of [10_000_000_000n, 95_000_000n, 60_000_000n]) {
    let b; try { b = buildWithdrawTxJson(wArgs({ feeUtxo: { ...bigFee(8), value } })); } catch (e) { if (/mass超过|no_viable_change_shape|insufficient/.test(e.message)) continue; throw e; }
    const tx = kaspa.Transaction.deserializeFromSafeJSON(b.txJson);
    if (!schnorrVerify(ktcSig(tx).subarray(0, 64).toString('hex'), sighashAll(sighashInput(tx), WITHDRAW_KTC_IN_INDEX), COMMITTEE_PK)) throw new Error(`fee=${value} includeChange=${b.includeChange}: 验签失败`);
    verified++;
  }
  if (verified < 2) throw new Error(`只验了${verified}个面值`);
});

// 见证映射(独立 push 解析器)
t('⑯KanetTokenClaim 见证里各索引/标志位置与交易真实结构一致: tok_in_idx→held outpoint, tok_out_idx→代币输出, dest_idx→目的地 covenant 输出, to_market_input=false, 前后缀=调用方给的代币模板', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(wd.txJson);
  const abi = ktcAbiSpend(); const pushes = parsePushes(String(tx.inputs[WITHDRAW_KTC_IN_INDEX].signatureScript).replace(/^0x/, ''));
  const at = (n) => pushes[abi.params.findIndex((p) => p.name === n)];
  const v = (n) => decodeInt(at(n));
  const opOf = (i) => `${tx.inputs[i].previousOutpoint.transactionId}:${tx.inputs[i].previousOutpoint.index}`;
  if (opOf(v('tok_in_idx')) !== `${HELD_OP.txid}:${HELD_OP.vout}`) throw new Error('tok_in_idx 指向的输入不是 held 代币 outpoint');
  if (v('tok_out_idx') !== WITHDRAW_TOKEN_OUT_INDEX || v('dest_idx') !== WITHDRAW_DEST_OUT_INDEX) throw new Error('tok_out_idx/dest_idx 不对');
  if (String(tx.outputs[v('dest_idx')].scriptPublicKey.script) !== DEST_SPK.slice(2)) throw new Error('dest_idx 指向的输出不是调用方指定的目的地');
  if (v('to_market_input') !== 0) throw new Error('to_market_input 必须为 false(路径 ii)');
  if (at('tok_prefix').toString('hex') !== tokPrefixHex.slice(2) || at('tok_suffix').toString('hex') !== tokSuffixHex.slice(2)) throw new Error('tok_prefix/tok_suffix 不是调用方给的代币模板字节');
});
t('⑰哨兵 withdrawWitnessArgs: tok_in_idx/tok_out_idx/dest_idx 在哨兵输入(5/6/7 两两不同)下各落在自己具名的字段; to_market_input 恒 false', () => {
  const a = withdrawWitnessArgs({ sig65Hex: 'ab'.repeat(65), tokInIdx: 5, tokOutIdx: 6, destIdx: 7, tokPrefixHex: '0xcc', tokSuffixHex: '0xdd' });
  if (a.tok_in_idx !== 5 || a.tok_out_idx !== 6 || a.dest_idx !== 7) throw new Error(`映射不对: ${JSON.stringify(a)}`);
  if (a.to_market_input !== false || a.s !== '0x' + 'ab'.repeat(65) || a.tok_prefix !== '0xcc' || a.tok_suffix !== '0xdd') throw new Error('标志/签名/前后缀映射不对');
  if (WITHDRAW_TOKEN_OUT_INDEX === WITHDRAW_DEST_OUT_INDEX) throw new Error('测试退化: 代币输出与目的地输出下标相同');
  // 注: 真实布局里 tok_in_idx(held=输入1) 与 dest_idx(输出1) 数值相同(输入/输出是两个下标空间), 共识与本 tx 都看不出这两个参数被互换——
  // 只有本哨兵测试守这条映射; 布局一变 assertWithdrawLayout 会大声失败。
});
t('⑱结构断言 assertWithdrawLayout: 正确布局放行; KTC/held outpoint 互换、代币输出/目的地输出 spk 错、目的地无 covenant 各自必拒', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(wd.txJson);
  const ok = { tx, ktcOutpoint: KTC_OP, heldTokenOutpoint: HELD_OP, expectedTokenOutSpkHex: '0x' + tx.outputs[0].scriptPublicKey.script, expectedDestSpkHex: DEST_SPK };
  assertWithdrawLayout(ok);
  throws(() => assertWithdrawLayout({ ...ok, ktcOutpoint: HELD_OP, heldTokenOutpoint: KTC_OP }), /inputs\[0\]/);
  throws(() => assertWithdrawLayout({ ...ok, heldTokenOutpoint: { ...HELD_OP, vout: 5 } }), /tok_in_idx/);
  throws(() => assertWithdrawLayout({ ...ok, expectedTokenOutSpkHex: DEST_SPK }), /tok_out_idx/);
  throws(() => assertWithdrawLayout({ ...ok, expectedDestSpkHex: ok.expectedTokenOutSpkHex }), /dest_idx/);
  const noCov = kaspa.Transaction.deserializeFromSafeJSON(wd.txJson);
  noCov.outputs = noCov.outputs.map((o, k) => (k === WITHDRAW_DEST_OUT_INDEX ? new kaspa.TransactionOutput(o.value, o.scriptPublicKey) : o));
  throws(() => assertWithdrawLayout({ ...ok, tx: noCov }), /没有 covenant 绑定/);
});

// ── mass 向量 pin(账本1497 C1 + NWT 要求逐 builder 钉死 inputHasCovenant) ──
t('⑲inputHasCovenant 钉死: withdraw 的输入0(KanetTokenClaim)/输入1(held KTT)在上一笔 claim_draw 里确是带 covenant 的输出, fee 输入无; 断言信号 == 独立 NWT 移植的 storage mass(按真实布局 [true,true,false]); 错向量 [true,false,false] 结果必不同', () => {
  const prev = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
  if (!prev.outputs[CLAIM_DRAW_CLAIM_OUT_INDEX].covenant || !prev.outputs[CLAIM_DRAW_TOKEN_OUT_INDEX].covenant) throw new Error('前置: claim_draw 输出0/1 应带 covenant');
  // 常量必须与"真实输入布局推导出的向量"逐项相等(输入0/1 来自 claim_draw 输出0/1 的 covenant 有无, 输入2 是 relay 普通 fee UTXO)
  const derived = [!!prev.outputs[WITHDRAW_KTC_OUTPOINT_VOUT()].covenant, !!prev.outputs[WITHDRAW_HELD_OUTPOINT_VOUT()].covenant, false];
  if (JSON.stringify(S.WITHDRAW_INPUT_HAS_COVENANT) !== JSON.stringify(derived)) throw new Error(`WITHDRAW_INPUT_HAS_COVENANT=${JSON.stringify(S.WITHDRAW_INPUT_HAS_COVENANT)} != 真实布局推导 ${JSON.stringify(derived)}`);
  if (!Object.isFrozen(S.WITHDRAW_INPUT_HAS_COVENANT)) throw new Error('向量常量必须冻结');
  // C1 角色表与输入下标一一对应(输入0=claim, 输入1=held, 其余为 fee 不在表内)
  if (STEP_INPUT_ROLES.withdraw[WITHDRAW_KTC_IN_INDEX] !== 'claim' || STEP_INPUT_ROLES.withdraw[WITHDRAW_HELD_IN_INDEX] !== 'held' || STEP_INPUT_ROLES.withdraw.length !== WITHDRAW_FEE_IN_INDEX) throw new Error(`C1 withdraw 角色表 ${JSON.stringify(STEP_INPUT_ROLES.withdraw)} 与输入布局不符`);
  const tx = kaspa.Transaction.deserializeFromSafeJSON(wd.txJson);
  const feeVal = 10_000_000_000n; // wArgs 默认 bigFee(8)
  const sig = wd.massSignal; // builder 自己用的向量算出的信号(变异 builder 的向量 ⇒ 此值变 ⇒ 下面与 NWT 独立移植对拍变红)
  if (!sig || sig.storageMass === undefined) throw new Error('builder 未返回 massSignal');
  const cell = (spkHex, amount, cov) => ({ p: NWTM.utxoPlurality(BigInt(String(spkHex).replace(/^0x/, '').length / 2), cov), a: BigInt(amount) });
  const ins = tx.inputs.map((i, k) => cell(i.utxo.scriptPublicKey.script, i.utxo.amount, k < 2));
  const outs = tx.outputs.map((o) => cell(o.scriptPublicKey.script, o.value, !!o.covenant));
  const nwt = NWTM.calcStorageMass(ins, outs);
  if (String(sig.storageMass) !== String(nwt.mass)) throw new Error(`断言信号 storage=${sig.storageMass} != NWT 独立移植 ${nwt.mass}`);
  const wrong = assertMassWithinCeiling({ kaspa, network: 'simnet', tx, inputHasCovenant: [true, false, false], feeUtxoValueSompi: feeVal, label: 'withdraw-wrong-vector' });
  if (wrong.storageMass === sig.storageMass) throw new Error('错向量给出了相同 storage mass——本测试无法证明向量被钉住');
  if (String(nwt.mass) === String(wrong.storageMass)) throw new Error('NWT 独立值与错向量相同——对拍失去区分力');
});

// ── 🔴 MUST-PROVE: 签名前断言(winner_pk) ──
t('⑳a 私钥不是 winner_pk 的那一把(别的市场的委员私钥) ⇒ signing_key_mismatch, 在任何签名之前 fail-closed, 错误信息不含私钥', () => {
  const otherPriv = decryptCommitteePrivkey(otherGa.committeePrivkeyEnvelope);
  throws(() => buildWithdrawTxJson(wArgs({ committeePrivkeyEnvelope: otherGa.committeePrivkeyEnvelope })), /signing_key_mismatch.*fail-closed/, [otherPriv]);
});
t('⑳b winner_pk 是别人(且给的链上 spk 与之自洽) 而手上是本委员私钥 ⇒ signing_key_mismatch(隔离出"公钥逐字节相等"这一层, 不被 spk 自洽检查抢先)', () => {
  const otherArt = computeKanetTokenClaimGenesisArtifact({ marketCovIdHex: convertToClaim.claimCovId, winnerPkHex: otherGa.committeePubkeyHex, amount: 1000 });
  throws(() => buildWithdrawTxJson(wArgs({ winnerPkHex: otherGa.committeePubkeyHex, ktcUtxoScriptPublicKeyHex: otherArt.scriptPubKeyHex })), /signing_key_mismatch.*fail-closed/);
});
t('⑳c 正向: winner_pk 用大写 hex(同一把)也放行; winner_pk/amount 与链上 KanetTokenClaim spk 不自洽 ⇒ fail-closed(现算 spk != 链上 spk)', () => {
  buildWithdrawTxJson(wArgs({ winnerPkHex: COMMITTEE_PK.toUpperCase() }));
  throws(() => buildWithdrawTxJson(wArgs({ winnerPkHex: '11'.repeat(32) })), /现算的 KanetTokenClaim spk.*链上 UTXO spk/);
  throws(() => buildWithdrawTxJson(wArgs({ amount: 999 })), /现算的 KanetTokenClaim spk.*链上 UTXO spk/);
});
t('⑳d 签名前断言在【任何 createInputSignature 之前】执行: 断言失败时一次都没被调用', () => {
  let signCalls = 0;
  const wrapped = { ...kaspa, createInputSignature: (...a) => { signCalls++; return kaspa.createInputSignature(...a); } };
  const otherPriv = decryptCommitteePrivkey(otherGa.committeePrivkeyEnvelope);
  throws(() => buildWithdrawTxJson(wArgs({ kaspa: wrapped, committeePrivkeyEnvelope: otherGa.committeePrivkeyEnvelope })), /signing_key_mismatch/, [otherPriv]);
  if (signCalls !== 0) throw new Error(`签名前断言失败后 createInputSignature 仍被调用了 ${signCalls} 次`);
});

// ── 🔴 目的地闸(Bettor 1520 裁定②) ──
t('㉑目的地闸: 允许清单 v0 为空且冻结; 主网(即使 allowUnlistedTestDestination:true)一律拒; 非主网无显式声明拒; 非主网+显式声明放行; 清单命中放行; 形状不对拒', () => {
  if (WITHDRAW_DESTINATION_ALLOWLIST_SPK_HEX.length !== 0 || !Object.isFrozen(WITHDRAW_DESTINATION_ALLOWLIST_SPK_HEX)) throw new Error('v0 允许清单必须为空且冻结');
  throws(() => buildWithdrawTxJson(wArgs({ network: 'mainnet' })), /不在允许清单.*主网 withdraw 在最小钱包 covenant/);
  throws(() => buildWithdrawTxJson(wArgs({ allowUnlistedTestDestination: false })), /不在允许清单.*allowUnlistedTestDestination/);
  buildWithdrawTxJson(wArgs()); // simnet + 显式声明
  const listed = buildWithdrawTxJson(wArgs({ network: 'mainnet', destinationAllowlistSpkHex: [DEST_SPK.toUpperCase().replace('0X', '0x')], allowUnlistedTestDestination: false }));
  if (listed.destGate !== 'allowlisted') throw new Error(`destGate=${listed.destGate}`);
  throws(() => buildWithdrawTxJson(wArgs({ destinationScriptPublicKeyHex: undefined })), /35 字节 P2SH/);
  throws(() => buildWithdrawTxJson(wArgs({ destinationScriptPublicKeyHex: '0x76a914' + '00'.repeat(20) + '88ac' })), /35 字节 P2SH/);
  throws(() => assertWithdrawDestinationAllowed({ network: 'mainnet', destSpkHex: DEST_SPK, allowlistSpkHex: [], allowUnlistedTestDestination: true }), /不在允许清单/);
});
t('㉒目的地闸先于解密与签名: 私钥信封是垃圾、目的地被拒时, 报的是目的地错而不是解密错; createInputSignature 零调用', () => {
  let signCalls = 0;
  const wrapped = { ...kaspa, createInputSignature: (...a) => { signCalls++; return kaspa.createInputSignature(...a); } };
  throws(() => buildWithdrawTxJson(wArgs({ kaspa: wrapped, network: 'mainnet', committeePrivkeyEnvelope: 'not-an-envelope' })), /不在允许清单/);
  if (signCalls !== 0) throw new Error(`目的地被拒后 createInputSignature 仍被调用了 ${signCalls} 次`);
});

// ── fail-closed / 私钥卫生 ──
t('㉓ fail-closed: amount<=0 / outpoint 缺失 / 链上 KanetTokenClaim spk 不符 / spk 缺失', () => {
  throws(() => buildWithdrawTxJson(wArgs({ amount: 0 })), /amount 必须是正整数/);
  throws(() => buildWithdrawTxJson(wArgs({ heldTokenOutpoint: null })), /必填/);
  throws(() => buildWithdrawTxJson(wArgs({ ktcOutpoint: null })), /必填/);
  throws(() => buildWithdrawTxJson(wArgs({ ktcUtxoScriptPublicKeyHex: '0xaa20' + '11'.repeat(32) + '87' })), /链上 UTXO spk/);
  throws(() => buildWithdrawTxJson(wArgs({ ktcUtxoScriptPublicKeyHex: undefined })), /链上 UTXO spk/);
});
t('㉔ 私钥不进返回值; 构造过程中 new 的 PrivateKey 全部 free(created == freed)', () => {
  const priv = decryptCommitteePrivkey(ga.committeePrivkeyEnvelope);
  if (JSON.stringify(wd, (k, v) => (typeof v === 'bigint' ? v.toString() : v)).includes(priv)) throw new Error('明文私钥出现在返回值里');
  let created = 0, freed = 0;
  class Tracked extends kaspa.PrivateKey { constructor(...a) { super(...a); created++; } free() { freed++; return super.free(); } }
  buildWithdrawTxJson(wArgs({ kaspa: { ...kaspa, PrivateKey: Tracked } }));
  if (created < 1 || created !== freed) throw new Error(`PrivateKey created=${created} freed=${freed}`);
});

// ══════════ 批8 ticket_reclaim v2(输家 ticket 自我回收, PoolSideTicket.authorize_spend; Bettor 1524 裁定②: 带 relay fee 输入, 不改 relay) ══════════
// 输家票 = bet1(side 0, stake 1, bettorPk=委员公钥, register_append#1 输出1); 市场已结算 closed=1, winningSide=1(NO 赢)。
const {
  buildTicketReclaimTxJson, assertTicketReclaimable, assertTicketReclaimLayout, TICKET_RECLAIM_INPUT_HAS_COVENANT, TICKET_RECLAIM_TICKET_IN_INDEX, TICKET_RECLAIM_FEE_IN_INDEX, TICKET_RECLAIM_OUT_INDEX,
} = S;
const { computeRequiredFeeSompiOrThrow } = await import('./proto-tx-assembly.mjs');
const RB = await import('../../../kasia-relay/src/lib/covenant-broadcast.mjs');
const LOSER_BET = { bettor_pk: COMMITTEE_PK, side: 0, stake: 1 };
const LOSER_OP = { txid: bet1.built.expectedTxid, vout: 1 };
const MARKET_STATE = { closed: 1, winningSide: 1 };
const DEST_P2PK = '0x20' + 'ab'.repeat(32) + 'ac'; // bettor 自己指定的收款脚本(测试夹具, 非 relay 地址)
const rArgs = (over = {}) => ({
  kaspa, network: 'mainnet', marketId: MARKET_ID, bet: LOSER_BET, marketState: MARKET_STATE, ticketOutpoint: LOSER_OP, ticketUtxoScriptPublicKeyHex: spkOf(bet1.built.txJson, 1),
  committeePrivkeyEnvelope: ga.committeePrivkeyEnvelope, destinationScriptPublicKeyHex: DEST_P2PK, feeUtxo: { ...bigFee(9), value: 95_000_000n }, relayChangeScriptPublicKeyHex: relaySpkHex,
  absFeeCapSompi: loadFeeProfileCap('ticket_reclaim'), ...over,
});
let rc;
t('㉕ticket_reclaim buildTicketReclaimTxJson 真实构造成功: [ticket, fee]→[P2PK 全额 20,000,000, 找零]; ticket 由 builder 现签, fee 输入留给 relay 签(signInputIndices=[1])', () => {
  rc = buildTicketReclaimTxJson(rArgs());
  const tx = kaspa.Transaction.deserializeFromSafeJSON(rc.txJson);
  if (tx.inputs.length !== 2 || tx.outputs.length !== 2) throw new Error('应为 2 入 2 出');
  if (JSON.stringify(rc.signInputIndices) !== '[1]' || JSON.stringify(rc.genesisOutputIndices) !== '[]') throw new Error('签名/genesis 下标不对');
  if (BigInt(tx.outputs[TICKET_RECLAIM_OUT_INDEX].value) !== 20_000_000n) throw new Error('输出0 必须是 ticket 全额 20,000,000');
  const feeSs = tx.inputs[TICKET_RECLAIM_FEE_IN_INDEX].signatureScript; // 空 sigScript 反序列化为 undefined
  if (feeSs !== undefined && String(feeSs).replace(/^0x/, '') !== '') throw new Error('fee 输入应留空待 relay 签');
  let sIn = 0n, sOut = 0n; for (const i of tx.inputs) sIn += BigInt(i.utxo.amount); for (const o of tx.outputs) sOut += BigInt(o.value);
  if (sIn - sOut !== rc.netLoss) throw new Error(`隐含费 ${sIn - sOut} != netLoss ${rc.netLoss}`);
  if (tx.outputs.some((o) => o.covenant)) throw new Error('回收/找零输出都不应带 covenant');
});
t('㉖【relay 现状表征——批9 阻塞项 #2】relay 真代码全流程: fixed_value / signed_input_ceiling / 签 fee 输入 / txid 均放行, 但 validateNetLoss 与 validateImpliedMinerFee 必拒: relay 本地 wasm 估算费远低于节点精确最低费 ⇒ 其天花板(2×估算)低于节点要求, 任何 fee 都无法同时满足两边; 仅当 requiredFee 换成精确值时才放行(证明唯一原因是 relay 的 fee 估算器)。relay 修复后本条会变红, 提醒同步清单', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(rc.txJson);
  const shape = RB.extractTxShape(tx);
  const fv = RB.validateFixedValueOutputs({ outputs: shape.outputs, genesisOutputIndices: [], continuationOutputIndices: [] }); if (!fv.ok) throw new Error(`fixed_value: ${fv.reason}`);
  const sic = RB.validateSignedInputCeiling({ inputs: shape.inputs, signInputIndices: rc.signInputIndices }); if (!sic.ok) throw new Error(`signed_input_ceiling: ${sic.reason}`);
  RB.signOnlyDeclaredInputs({ tx, signInputIndices: rc.signInputIndices, privateKey: relayPriv, kaspa });
  tx.finalize();
  const r = RB.assertFinalTxid(tx, rc.expectedTxid); if (!r.ok) throw new Error(`签名后txid=${r.actualTxid} != ${rc.expectedTxid}`);
  const relayRequired = RB.computeRequiredFeeSompi({ kaspa, networkId: 'mainnet', signedTx: tx });
  const relaySpk = kaspa.payToAddressScript(relayPriv.toPublicKey().toAddress('mainnet'));
  const exactNeed = 100n * BigInt(Math.max(rc.massSignal.storageMass, rc.massSignal.computeMass, rc.massSignal.transientMass)); // 节点最低费(不含余量)
  const nlRelay = RB.validateNetLoss({ inputs: shape.inputs, outputs: shape.outputs, signInputIndices: rc.signInputIndices, relayScriptPubKey: relaySpk, requiredFeeSompi: relayRequired, absFeeCapSompi: RB.GLOBAL_ABS_FEE_CAP_SOMPI });
  const imfRelay = RB.validateImpliedMinerFee({ inputs: shape.inputs, outputs: shape.outputs, requiredFeeSompi: relayRequired });
  console.log(`   [info] relay 本地 wasm requiredFee=${relayRequired} ⇒ 天花板=${relayRequired * 2n}; 节点精确最低费=${exactNeed}; builder 实付=${rc.netLoss}`);
  if (nlRelay.ok || imfRelay.ok) throw new Error('relay 现在放行了这笔交易——阻塞项已解除? 请核实并同步批9 清单/计划/provenance, 再更新本条');
  if (!(relayRequired * 2n < exactNeed)) throw new Error(`relay 天花板 ${relayRequired * 2n} 不低于节点最低费 ${exactNeed}, 拒绝原因与"估算器低估"不符, 需重新诊断`);
  // 对照臂: 只把 requiredFee 换成精确值, 同一笔交易同一批 relay 校验即放行 ⇒ 唯一原因是 relay 的 fee 估算器(本地 wasm)
  const nlExact = RB.validateNetLoss({ inputs: shape.inputs, outputs: shape.outputs, signInputIndices: rc.signInputIndices, relayScriptPubKey: relaySpk, requiredFeeSompi: exactNeed, absFeeCapSompi: RB.GLOBAL_ABS_FEE_CAP_SOMPI });
  const imfExact = RB.validateImpliedMinerFee({ inputs: shape.inputs, outputs: shape.outputs, requiredFeeSompi: exactNeed });
  if (!nlExact.ok || !imfExact.ok) throw new Error(`对照臂: 换成精确 requiredFee 后 relay 校验仍拒: ${nlExact.reason ?? imfExact.reason}`);
  if (nlRelay.netLossSompi !== rc.netLoss && nlExact.netLossSompi !== rc.netLoss) throw new Error(`relay 算的净损失与 builder netLoss ${rc.netLoss} 不一致`);
});
const ticketSigOf = (tx) => parsePushes(String(tx.inputs[TICKET_RECLAIM_TICKET_IN_INDEX].signatureScript).replace(/^0x/, ''))[0];
t('㉗a 【真验签】ticket 的 bettorSig 对【relay 签完的最终tx】共识 sighash 有效(独立移植 sighash+schnorr; 公钥=bettor_pk)——ticket 签名不受 fee 输入后签的影响', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(rc.txJson);
  RB.signOnlyDeclaredInputs({ tx, signInputIndices: rc.signInputIndices, privateKey: relayPriv, kaspa }); tx.finalize();
  const sig = ticketSigOf(tx);
  if (!sig || sig.length !== 65) throw new Error(`签名 push 长度=${sig?.length}`);
  if (!schnorrVerify(sig.subarray(0, 64).toString('hex'), sighashAll(sighashInput(tx), TICKET_RECLAIM_TICKET_IN_INDEX), COMMITTEE_PK)) throw new Error('验签失败');
});
t('㉗b 反向臂: 改找零值 1 sompi / 改收款脚本后重算 sighash, 签名必须验假(签名承诺全部输出); 换 fee 面值(不同找零候选)各自重签仍验真', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(rc.txJson);
  const d = sighashInput(tx); const sigHex = ticketSigOf(tx).subarray(0, 64).toString('hex');
  const chg = { ...d, outputs: d.outputs.map((o, k) => (k === 1 ? { ...o, value: o.value - 1n } : o)) };
  if (schnorrVerify(sigHex, sighashAll(chg, 0), COMMITTEE_PK)) throw new Error('改找零值后签名仍验真——签名不承诺找零输出?');
  const dst = { ...d, outputs: d.outputs.map((o, k) => (k === 0 ? { ...o, spkHex: '20' + 'cd'.repeat(32) + 'ac' } : o)) };
  if (schnorrVerify(sigHex, sighashAll(dst, 0), COMMITTEE_PK)) throw new Error('改收款脚本后签名仍验真');
  let verified = 0;
  for (const value of [10_000_000_000n, 95_000_000n, 60_000_000n]) {
    let b; try { b = buildTicketReclaimTxJson(rArgs({ feeUtxo: { ...bigFee(9), value } })); } catch (e) { if (/no_viable_change_shape|insufficient|mass超过/.test(e.message)) continue; throw e; }
    const t2 = kaspa.Transaction.deserializeFromSafeJSON(b.txJson);
    if (!schnorrVerify(ticketSigOf(t2).subarray(0, 64).toString('hex'), sighashAll(sighashInput(t2), 0), COMMITTEE_PK)) throw new Error(`fee=${value} includeChange=${b.includeChange}: 验签失败`);
    verified++;
  }
  if (verified < 2) throw new Error(`只验了${verified}个面值`);
});
t('㉘ fee 陷阱对拍: builder 的 massSignal 与 NWT 独立移植的 storage/compute 逐位相等; 净损失 ≥ 100×max(compute,storage)(节点最低费); 若复用 computeRequiredFeeSompiOrThrow 会少付(本地 wasm 估算 < 精确需求)', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(rc.txJson);
  RB.signOnlyDeclaredInputs({ tx, signInputIndices: rc.signInputIndices, privateKey: relayPriv, kaspa }); tx.finalize();
  const nodeShaped = { version: Number(tx.version), payload: '', inputs: tx.inputs.map((i) => ({ signatureScript: String(i.signatureScript).replace(/^0x/, ''), computeBudget: Number(i.computeBudget) })), outputs: tx.outputs.map((o) => ({ scriptPublicKey: { script: String(o.scriptPublicKey.script) }, covenant: null })) };
  const nwtCompute = NWTM.computeMass(nodeShaped).compute;
  const cell = (spkHex, amount) => ({ p: NWTM.utxoPlurality(BigInt(String(spkHex).length / 2), false), a: BigInt(amount) });
  const nwtStorage = NWTM.calcStorageMass(tx.inputs.map((i) => cell(i.utxo.scriptPublicKey.script, i.utxo.amount)), tx.outputs.map((o) => cell(o.scriptPublicKey.script, o.value))).mass;
  if (String(rc.massSignal.computeMass) !== String(nwtCompute)) throw new Error(`compute 信号 ${rc.massSignal.computeMass} != NWT 独立移植 ${nwtCompute}`);
  if (String(rc.massSignal.storageMass) !== String(nwtStorage)) throw new Error(`storage 信号 ${rc.massSignal.storageMass} != NWT 独立移植 ${nwtStorage}`);
  const need = 100n * (nwtCompute > nwtStorage ? nwtCompute : nwtStorage);
  if (rc.netLoss < need) throw new Error(`fee ${rc.netLoss} < 100×max(compute,storage)=${need}`);
  const localFee = computeRequiredFeeSompiOrThrow(kaspa, 'mainnet', tx);
  console.log(`   [info] 本地 wasm 估算费=${localFee} 精确最低费=${need} builder 实付=${rc.netLoss}`);
  if (!(localFee < need)) throw new Error(`本地 wasm 估算费 ${localFee} 不低于精确需求 ${need}——陷阱在本 wasm 版本/本形状不成立? 需重新核实, 不能默认假设`);
});
t('㉙inputHasCovenant 钉死 [false,false]: 常量冻结; ticket 输入=register_append#1 输出1 真实【无 covenant】, fee 输入=普通; builder 的 massSignal 与错向量 [true,false] 的结果必不同; C1 角色表 ticket_reclaim 与输入下标对应', () => {
  const ra = kaspa.Transaction.deserializeFromSafeJSON(bet1.built.txJson);
  const derived = [!!ra.outputs[LOSER_OP.vout].covenant, false];
  if (JSON.stringify(TICKET_RECLAIM_INPUT_HAS_COVENANT) !== JSON.stringify(derived) || !Object.isFrozen(TICKET_RECLAIM_INPUT_HAS_COVENANT)) throw new Error(`常量 ${JSON.stringify(TICKET_RECLAIM_INPUT_HAS_COVENANT)} != 真实布局推导 ${JSON.stringify(derived)}`);
  if (STEP_INPUT_ROLES.ticket_reclaim.length !== TICKET_RECLAIM_FEE_IN_INDEX || STEP_INPUT_ROLES.ticket_reclaim[TICKET_RECLAIM_TICKET_IN_INDEX] !== 'ticket') throw new Error(`C1 角色表 ${JSON.stringify(STEP_INPUT_ROLES.ticket_reclaim)} 与输入布局不符(输入0=ticket, 输入1=fee 不在表内)`);
  const tx = kaspa.Transaction.deserializeFromSafeJSON(rc.txJson);
  const wrong = assertMassWithinCeiling({ kaspa, network: 'mainnet', tx, inputHasCovenant: [true, false], feeUtxoValueSompi: 0n, label: 'wrong' });
  if (wrong.storageMass === rc.massSignal.storageMass) throw new Error('错向量给出相同 storage——无法证明向量被钉住');
});
t('㉚可回收闸: 赢票(side==winningSide) / 市场未结算(closed=0) / 已取消(closed=2) / marketState 缺失 各自必拒; 输家票+closed=1 放行', () => {
  assertTicketReclaimable({ marketState: MARKET_STATE, bet: LOSER_BET });
  throws(() => buildTicketReclaimTxJson(rArgs({ bet: BET, ticketOutpoint: { txid: bet2.built.expectedTxid, vout: 1 }, ticketUtxoScriptPublicKeyHex: spkOf(bet2.built.txJson, 1) })), /赢票.*claim_draw/);
  throws(() => buildTicketReclaimTxJson(rArgs({ marketState: { closed: 0, winningSide: 1 } })), /尚未结算/);
  throws(() => buildTicketReclaimTxJson(rArgs({ marketState: { closed: 2, winningSide: 1 } })), /已取消/);
  throws(() => buildTicketReclaimTxJson(rArgs({ marketState: undefined })), /marketState/);
  throws(() => buildTicketReclaimTxJson(rArgs({ marketState: { closed: 1, winningSide: '1' } })), /marketState/);
});
t('㉛可回收闸/目的地闸先于解密与签名: 私钥信封是垃圾时, 报的是闸的错而不是解密错; createInputSignature 零调用', () => {
  let signCalls = 0;
  const wrapped = { ...kaspa, createInputSignature: (...a) => { signCalls++; return kaspa.createInputSignature(...a); } };
  throws(() => buildTicketReclaimTxJson(rArgs({ kaspa: wrapped, marketState: { closed: 0, winningSide: 1 }, committeePrivkeyEnvelope: 'not-an-envelope' })), /尚未结算/);
  throws(() => buildTicketReclaimTxJson(rArgs({ kaspa: wrapped, destinationScriptPublicKeyHex: undefined, committeePrivkeyEnvelope: 'not-an-envelope' })), /34 字节 P2PK/);
  if (signCalls !== 0) throw new Error(`闸拒绝后 createInputSignature 仍被调用了 ${signCalls} 次`);
});
t('㉜MUST-PROVE: 别的市场的委员私钥 ⇒ signing_key_mismatch(签名前, 零签名调用, 不含私钥); DB bettor_pk 被换 ⇒ ticket_pk_underivable; 大写 bettor_pk 同一把放行', () => {
  let signCalls = 0;
  const wrapped = { ...kaspa, createInputSignature: (...a) => { signCalls++; return kaspa.createInputSignature(...a); } };
  const otherPriv = decryptCommitteePrivkey(otherGa.committeePrivkeyEnvelope);
  throws(() => buildTicketReclaimTxJson(rArgs({ kaspa: wrapped, committeePrivkeyEnvelope: otherGa.committeePrivkeyEnvelope })), /signing_key_mismatch.*fail-closed/, [otherPriv]);
  if (signCalls !== 0) throw new Error(`签名前断言失败后 createInputSignature 仍被调用了 ${signCalls} 次`);
  throws(() => buildTicketReclaimTxJson(rArgs({ bet: { ...LOSER_BET, bettor_pk: '11'.repeat(32) } })), /ticket_pk_underivable|fail-closed/);
  buildTicketReclaimTxJson(rArgs({ bet: { ...LOSER_BET, bettor_pk: COMMITTEE_PK.toUpperCase() } }));
});
t('㉝收款脚本闸: 缺失 / P2SH / P2PKH / 长度不对 各自必拒(只接受 34 字节 P2PK)', () => {
  for (const bad of [undefined, '0xaa20' + 'ee'.repeat(32) + '87', '0x76a914' + '00'.repeat(20) + '88ac', '0x20' + 'ab'.repeat(31) + 'ac']) throws(() => buildTicketReclaimTxJson(rArgs({ destinationScriptPublicKeyHex: bad })), /34 字节 P2PK/);
});
t('㉞fee 界与输入闸: cap 过小 ⇒ no_viable_change_shape; ticketOutpoint 缺失 ⇒ fail-closed; fee 输入面值不足以付费 ⇒ fail-closed', () => {
  throws(() => buildTicketReclaimTxJson(rArgs({ absFeeCapSompi: 100_000n })), /no_viable_change_shape/);
  throws(() => buildTicketReclaimTxJson(rArgs({ ticketOutpoint: null })), /ticketOutpoint 必填/);
  throws(() => buildTicketReclaimTxJson(rArgs({ feeUtxo: { ...bigFee(9), value: 100_000n } })), /no_viable_change_shape|insufficient/);
});
t('㉟结构断言 assertTicketReclaimLayout: 正确放行; ticket/fee 输入互换、收款脚本错、收款面值不是 20,000,000、回收输出带 covenant、找零脚本错 各自必拒', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(rc.txJson);
  const feeOutpoint = { txid: bigFee(9).txid, vout: 0 };
  const ok = { tx, ticketOutpoint: LOSER_OP, feeOutpoint, expectedDestSpkHex: DEST_P2PK, expectedChangeSpkHex: relaySpkHex };
  assertTicketReclaimLayout(ok);
  throws(() => assertTicketReclaimLayout({ ...ok, ticketOutpoint: feeOutpoint, feeOutpoint: LOSER_OP }), /inputs\[0\] 不是 ticket/);
  throws(() => assertTicketReclaimLayout({ ...ok, feeOutpoint: { ...feeOutpoint, vout: 3 } }), /inputs\[1\] 不是 fee/);
  throws(() => assertTicketReclaimLayout({ ...ok, expectedDestSpkHex: '0x20' + 'cd'.repeat(32) + 'ac' }), /outputs\[0\] 不是 bettor 指定/);
  throws(() => assertTicketReclaimLayout({ ...ok, expectedChangeSpkHex: '0x20' + 'cd'.repeat(32) + 'ac' }), /outputs\[1\] 不是回 relay 的找零/);
  throws(() => assertTicketReclaimLayout({ ...ok, expectedChangeSpkHex: null }), /应为 1 个输出/);
  const lowVal = { inputs: tx.inputs, outputs: [{ value: 19_999_999n, scriptPublicKey: tx.outputs[0].scriptPublicKey, covenant: null }, tx.outputs[1]] };
  throws(() => assertTicketReclaimLayout({ ...ok, tx: lowVal }), /面值.*ticket 全额/);
  const withCov = { inputs: tx.inputs, outputs: [{ value: tx.outputs[0].value, scriptPublicKey: tx.outputs[0].scriptPublicKey, covenant: { covenantId: 'aa' } }, tx.outputs[1]] };
  throws(() => assertTicketReclaimLayout({ ...ok, tx: withCov }), /不应带 covenant/);
});
t('㊱ 私钥不进返回值; 构造过程中 new 的 PrivateKey 全部 free(created == freed)', () => {
  const priv = decryptCommitteePrivkey(ga.committeePrivkeyEnvelope);
  if (JSON.stringify(rc, (k, v) => (typeof v === 'bigint' ? v.toString() : v)).includes(priv)) throw new Error('明文私钥出现在返回值里');
  let created = 0, freed = 0;
  class Tracked extends kaspa.PrivateKey { constructor(...a) { super(...a); created++; } free() { freed++; return super.free(); } }
  buildTicketReclaimTxJson(rArgs({ kaspa: { ...kaspa, PrivateKey: Tracked } }));
  if (created < 1 || created !== freed) throw new Error(`PrivateKey created=${created} freed=${freed}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
