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
const seal = buildMarketSealTxJson({
  kaspa, network: 'mainnet', marketId: MARKET_ID, committeePubkeyHex: COMMITTEE_PK, deadlineMs: DEADLINE_MS, rootCloseTmplHash: ga.rootCloseTmplHash,
  leafRedeemScript: computeShardLeafRedeemScript({ marketId: MARKET_ID, minBet: MIN_BET, sealCount: SEAL_COUNT, rootcloseTmplHash: ga.rootCloseTmplHash, state: sealState, ownRedeemLen: ga.shardLeafOwnRedeemLen }).script,
  leafOutpoint: { txid: bet2.built.expectedTxid, vout: 0 }, leafCovId, heldInput: heldOf(bet2), currentState: sealState, feeUtxo: bigFee(4), relayChangeScriptPublicKeyHex: relaySpkHex,
  convertToRootcloseEntryAbi: sldAtSeal, tokPrefixHex, tokSuffixHex, absFeeCapSompi: loadFeeProfileCap('market_seal'),
});
const WIN_SIDE = 1, PAYOUT_ROOT = payoutLeafHex(COMMITTEE_PK, 1000);
const closeCommit = buildCloseCommitTxJson({
  kaspa, network: 'mainnet', marketId: MARKET_ID, committeePubkeyHex: COMMITTEE_PK, committeePrivkeyEnvelope: ga.committeePrivkeyEnvelope, deadlineMs: DEADLINE_MS, rootCloseTmplHash: ga.rootCloseTmplHash,
  rootCloseOutpoint: { txid: seal.expectedTxid, vout: MARKET_SEAL_ROOTCLOSE_OUT_INDEX }, rootCloseUtxoScriptPublicKeyHex: spkOf(seal.txJson, MARKET_SEAL_ROOTCLOSE_OUT_INDEX), rootCloseCovId: seal.rootCloseCovId, sealedState: sealState,
  newWinningSide: WIN_SIDE, newPayoutRootHex: PAYOUT_ROOT, tokPrefixHex, tokSuffixHex, feeUtxo: bigFee(5), relayChangeScriptPublicKeyHex: relaySpkHex, absFeeCapSompi: loadFeeProfileCap('close_commit'),
});
const closedState = { ...sealState, closed: 1, winningSide: WIN_SIDE, payoutRoot: PAYOUT_ROOT };
const convertToClaim = buildConvertToClaimTxJson({
  kaspa, network: 'mainnet', marketId: MARKET_ID, committeePubkeyHex: COMMITTEE_PK, deadlineMs: DEADLINE_MS, rootCloseTmplHash: ga.rootCloseTmplHash,
  rootCloseOutpoint: { txid: closeCommit.expectedTxid, vout: CLOSE_COMMIT_ROOTCLOSE_OUT_INDEX }, rootCloseUtxoScriptPublicKeyHex: spkOf(closeCommit.txJson, CLOSE_COMMIT_ROOTCLOSE_OUT_INDEX),
  rootCloseCovId: seal.rootCloseCovId, closedState, heldTokenOutpoint: { txid: seal.expectedTxid, vout: MARKET_SEAL_TOKEN_OUT_INDEX },
  tokPrefixHex, tokSuffixHex, feeUtxo: bigFee(6), relayChangeScriptPublicKeyHex: relaySpkHex, absFeeCapSompi: loadFeeProfileCap('convert_to_claim'),
});

// ── claim_draw 入参 ──
const claimState = { ...closedState, claimed_bitmap: 0 };
const BET = { bettor_pk: COMMITTEE_PK, side: 1, stake: 999 };
const args = (over = {}) => ({
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
