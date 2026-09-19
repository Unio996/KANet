// proto-tx-assembly-settlement.test.mjs — buildMarketSealTxJson真实端到端组装验证(J2 2026-09-19,
// 实现计划v0.4 §2.1/§7批3)。真kaspa-wasm+真编译+relay真代码交叉核验, 零mock——同
// proto-tx-assembly-register-append.test.mjs手法, 延伸genesis→bet1→bet2→market_seal完整链路。
// Run: cd kasia-console && node src/lib/proto-tx-assembly-settlement.test.mjs

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_TX_ASSEMBLY_SETTLEMENT_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_settlement_e2e_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_TX_ASSEMBLY_SETTLEMENT_TEST_BOOTSTRAPPED: '1' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);

const kaspa = await import('kaspa-wasm');
const { randomBytes } = await import('node:crypto');
const {
  buildMarketGenesisTxJson, buildRegisterAppendTxJson, scriptPublicKeyFromHex, assertKaspadInputVersionRule,
} = await import('./proto-tx-assembly.mjs');
const {
  buildMarketSealTxJson, MARKET_SEAL_ROOTCLOSE_OUT_INDEX, MARKET_SEAL_TOKEN_OUT_INDEX,
  buildCloseCommitTxJson, CLOSE_COMMIT_ROOTCLOSE_OUT_INDEX,
} = await import('./proto-tx-assembly-settlement.mjs');
const {
  computeMarketGenesisArtifacts, computeShardLeafRedeemScript, computeKttGenesisArtifact,
  loadProtocolConstants, loadFeeProfileCap, p2sh,
} = await import('./proto-covenant-builder.mjs');
const { compileSilV100, ctorBytes32V100, ctorIntV100 } = await import('./pool-bshard-artifacts.mjs');
const { extractTemplateArtifactV100 } = await import('./pool-template-artifact.mjs');
const { extractTxShape, validateFixedValueOutputs, signOnlyDeclaredInputs, assertFinalTxid } = await import('../../../kasia-relay/src/lib/covenant-broadcast.mjs');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message + '\n' + e.stack); } };

const priv = new kaspa.PrivateKey(randomBytes(32).toString('hex'));
const relayAddr = priv.toPublicKey().toAddress('mainnet');
const relaySpk = kaspa.payToAddressScript(relayAddr);
const relaySpkHex = '0x' + relaySpk.script;

// ── ①先真实构造genesis, 拿到真实leafCovId + committeePubkeyHex(市场级事实, market_seal要用) ──
const MARKET_ID = 'ab'.repeat(32), MIN_BET = 5, DEADLINE_MS = 1700000000000, SEAL_COUNT = 2;
const genesisArtifacts = await computeMarketGenesisArtifacts({ marketId: MARKET_ID, minBet: MIN_BET, deadlineMs: DEADLINE_MS });
const genesisFeeUtxo = { txid: 'ee'.repeat(32), vout: 0, value: 10_000_000_000n, scriptPublicKeyHex: relaySpkHex };
const genesisBuilt = buildMarketGenesisTxJson({
  kaspa, network: 'mainnet', feeUtxo: genesisFeeUtxo, relayChangeScriptPublicKeyHex: relaySpkHex,
  shardLeafScriptPubKeyHex: genesisArtifacts.shardLeafDirect.scriptPubKeyHex, absFeeCapSompi: 80_000_000n,
});
const leafCovId = genesisBuilt.shardLeafCovId;
const leafOutpoint = { txid: genesisBuilt.expectedTxid, vout: 0 };

const { ps_tmpl_hash, token_tmpl_hash } = loadProtocolConstants();

const SLD_PATH = new URL('./ShardLeaf_direct.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TICKET_PATH = new URL('./sil-v1/PoolSideTicket.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const KTT_PATH = new URL('./sil-v1/KanetTestToken.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ROOT_CLOSE_PATH = new URL('./RootClose.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function sldCtorFor() {
  return [
    ctorBytes32V100(MARKET_ID), ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(MARKET_ID),
    ctorIntV100(SEAL_COUNT), ctorIntV100(MIN_BET), ctorBytes32V100(genesisArtifacts.rootCloseTmplHash), ctorBytes32V100('00'.repeat(32)),
    ctorBytes32V100(token_tmpl_hash), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0),
    ctorIntV100(genesisArtifacts.shardLeafOwnRedeemLen),
  ];
}
const kttCtorForAbi = [{ kind: 'int', value: 1 }, { kind: 'bytes', value: [...Buffer.alloc(32)] }, { kind: 'byte', value: 4 }, { kind: 'byte', value: 0 }, { kind: 'bytes', value: [...Buffer.alloc(32)] }, { kind: 'bytes', value: [...Buffer.alloc(32)] }, { kind: 'int', value: 3 }, { kind: 'int', value: 3 }];
const kttCompiled = compileSilV100(KTT_PATH, kttCtorForAbi, 'KanetTestToken');
const kttEntryAbi = kttCompiled._raw.contracts.KanetTestToken.entries.transfer;
const kttStateFieldCount = kttCompiled._raw.contracts.KanetTestToken.runtime_state.fields.length;
const tokPrefixHex = '0x' + Buffer.from(extractTemplateArtifactV100(kttCompiled).templatePrefix).toString('hex');
const tokSuffixHex = '0x' + Buffer.from(extractTemplateArtifactV100(kttCompiled).templateSuffix).toString('hex');

function doRegisterAppend({ side, stake, currentState, heldInput, bettorPkByte }) {
  const bettorPk = Buffer.alloc(32, bettorPkByte).toString('hex');
  const newState = { local_yes: currentState.local_yes + (side === 0 ? stake : 0), local_no: currentState.local_no + (side === 1 ? stake : 0), count: currentState.count + 1, pool_value: currentState.pool_value + stake };
  const leafRedeem = computeShardLeafRedeemScript({ marketId: MARKET_ID, minBet: MIN_BET, sealCount: SEAL_COUNT, rootcloseTmplHash: genesisArtifacts.rootCloseTmplHash, state: currentState, ownRedeemLen: genesisArtifacts.shardLeafOwnRedeemLen });
  const sldCompiled = compileSilV100(SLD_PATH, sldCtorFor(), 'ShardLeaf_direct');
  const registerAppendEntryAbi = sldCompiled._raw.contracts.ShardLeaf_direct.entries.register_append;
  const mergedArtifact = computeKttGenesisArtifact({ amount: newState.pool_value, ownerCovIdHex: leafCovId });
  const ticketCtor = [{ kind: 'bytes', value: [...Buffer.from(bettorPk, 'hex')] }, { kind: 'int', value: side }, { kind: 'int', value: stake }, { kind: 'bytes', value: [...Buffer.from(MARKET_ID, 'hex')] }];
  const ticketCompiled = compileSilV100(TICKET_PATH, ticketCtor, 'PoolSideTicket');
  const ticketSpkHex = '0x' + p2sh(Buffer.from(ticketCompiled.script));
  const ticketTemplateArtifact = extractTemplateArtifactV100(ticketCompiled);
  const psPrefixHex = '0x' + Buffer.from(ticketTemplateArtifact.templatePrefix).toString('hex');
  const psSuffixHex = '0x' + Buffer.from(ticketTemplateArtifact.templateSuffix).toString('hex');
  const feeUtxo = { txid: 'dd'.repeat(32), vout: 0, value: 10_000_000_000n, scriptPublicKeyHex: relaySpkHex };
  const built = buildRegisterAppendTxJson({
    kaspa, network: 'mainnet',
    leafRedeemScript: leafRedeem.script, leafStateLayout: leafRedeem.stateLayout,
    leafOutpoint, leafCovId, currentState, newState, heldInput,
    feeUtxo, relayChangeScriptPublicKeyHex: relaySpkHex,
    registerAppendEntryAbi, registerAppendArgs: { side, stake, bettorPk, psPrefix: psPrefixHex, psSuffix: psSuffixHex, tokPrefix: tokPrefixHex, tokSuffix: tokSuffixHex },
    ticketScriptPubKeyHex: ticketSpkHex, mergedKttScript: mergedArtifact.script,
    absFeeCapSompi: 100_000_000n,
  });
  return { built, newState, mergedArtifact };
}

// bet1(无held), bet2(有held=bet1的合并KTT) —— 只需要真实构造出tx对象拿mergedKttScript/covId, 不需要
// 真实广播(same手法同register_append测试: 只测construct+sign+finalize, 不接simnet)。
const bet1 = doRegisterAppend({ side: 0, stake: 20, currentState: { local_yes: 0, local_no: 0, count: 0, pool_value: 0 }, heldInput: null, bettorPkByte: 0x66 });
const bet2 = doRegisterAppend({
  side: 1, stake: 30, currentState: bet1.newState,
  heldInput: { txid: bet1.built.expectedTxid, vout: 2, value: 20_000_000n, scriptPublicKeyHex: bet1.mergedArtifact.scriptPubKeyHex, redeemScript: bet1.mergedArtifact.script, entryAbi: kttEntryAbi, stateFieldCount: kttStateFieldCount },
  bettorPkByte: 0x77,
});

// ── ② market_seal: leaf state = bet2.newState(count=2=SEAL_COUNT), held = bet2产出的合并KTT ──
const currentState = bet2.newState;
t('前提检查: currentState.count(2) === SEAL_COUNT(2)', () => {
  if (currentState.count !== SEAL_COUNT) throw new Error(`count=${currentState.count} != SEAL_COUNT=${SEAL_COUNT}`);
});

const leafRedeemAtSeal = computeShardLeafRedeemScript({ marketId: MARKET_ID, minBet: MIN_BET, sealCount: SEAL_COUNT, rootcloseTmplHash: genesisArtifacts.rootCloseTmplHash, state: currentState, ownRedeemLen: genesisArtifacts.shardLeafOwnRedeemLen });
const sldCompiledAtSeal = compileSilV100(SLD_PATH, sldCtorFor(), 'ShardLeaf_direct');
const convertToRootcloseEntryAbi = sldCompiledAtSeal._raw.contracts.ShardLeaf_direct.entries.convert_to_rootclose;
const heldAtSeal = { txid: bet2.built.expectedTxid, vout: 2, value: 20_000_000n, scriptPublicKeyHex: bet2.mergedArtifact.scriptPubKeyHex, redeemScript: bet2.mergedArtifact.script, entryAbi: kttEntryAbi, stateFieldCount: kttStateFieldCount };
const sealFeeUtxo = { txid: 'ff'.repeat(32), vout: 0, value: 10_000_000_000n, scriptPublicKeyHex: relaySpkHex };
const marketSealCap = loadFeeProfileCap('market_seal');

let sealBuilt;
t('①market_seal buildMarketSealTxJson 真实构造成功([leaf,held,fee]三输入)', () => {
  sealBuilt = buildMarketSealTxJson({
    kaspa, network: 'mainnet',
    marketId: MARKET_ID, committeePubkeyHex: genesisArtifacts.committeePubkeyHex, deadlineMs: DEADLINE_MS, rootCloseTmplHash: genesisArtifacts.rootCloseTmplHash,
    leafRedeemScript: leafRedeemAtSeal.script, leafOutpoint, leafCovId, heldInput: heldAtSeal, currentState,
    feeUtxo: sealFeeUtxo, relayChangeScriptPublicKeyHex: relaySpkHex,
    convertToRootcloseEntryAbi, tokPrefixHex, tokSuffixHex, absFeeCapSompi: marketSealCap,
  });
  if (!sealBuilt.txJson || !sealBuilt.expectedTxid) throw new Error('返回形状不对');
  if (sealBuilt.signInputIndices.length !== 1 || sealBuilt.signInputIndices[0] !== 2) throw new Error(`三输入形状下fee应该在index=2, 实际signInputIndices=${JSON.stringify(sealBuilt.signInputIndices)}`);
  if (JSON.stringify(sealBuilt.genesisOutputIndices) !== JSON.stringify([MARKET_SEAL_ROOTCLOSE_OUT_INDEX, MARKET_SEAL_TOKEN_OUT_INDEX])) throw new Error(`genesisOutputIndices不对: ${JSON.stringify(sealBuilt.genesisOutputIndices)}`);
});

t('②relay真代码能反序列化+extractTxShape+validateFixedValueOutputs通过', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(sealBuilt.txJson);
  const shape = extractTxShape(tx);
  const fv = validateFixedValueOutputs({ outputs: shape.outputs, genesisOutputIndices: sealBuilt.genesisOutputIndices, continuationOutputIndices: [] });
  if (!fv.ok) throw new Error(`relay真代码拒绝: ${fv.reason}`);
});

t('③relay真签名(fee输入)后finalize, txid与expectedTxid一致', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(sealBuilt.txJson);
  signOnlyDeclaredInputs({ tx, signInputIndices: sealBuilt.signInputIndices, privateKey: priv, kaspa });
  tx.finalize();
  const r = assertFinalTxid(tx, sealBuilt.expectedTxid);
  if (!r.ok) throw new Error(`签名后txid=${r.actualTxid} != 预期${sealBuilt.expectedTxid}`);
});

t('③b(账本1465节点规则镜像) 三输入交易每个input满足v2.0.1 RPC层sigOpCount/computeBudget一致性规则', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(sealBuilt.txJson);
  assertKaspadInputVersionRule(tx, 'market_seal-e2e');
});

t('④独立复算Σ真实inputs.utxo.amount − Σ真实outputs.value必须【恰好】等于built.netLoss(账本1455纪律)', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(sealBuilt.txJson);
  let sumIn = 0n; for (const inp of tx.inputs) sumIn += BigInt(inp.utxo.amount);
  let sumOut = 0n; for (const out of tx.outputs) sumOut += BigInt(out.value);
  const impliedFee = sumIn - sumOut;
  if (impliedFee !== sealBuilt.netLoss) throw new Error(`隐含手续费(Σin-Σout=${impliedFee})与built.netLoss(${sealBuilt.netLoss})不一致`);
});

t('⑤真实tx算出的output covenant_id与builder返回的rootCloseCovId/tokenCovId一致(不只信手算)', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(sealBuilt.txJson);
  const realRcCovId = String(tx.outputs[MARKET_SEAL_ROOTCLOSE_OUT_INDEX].covenant.covenantId);
  const realTokenCovId = String(tx.outputs[MARKET_SEAL_TOKEN_OUT_INDEX].covenant.covenantId);
  if (realRcCovId.toLowerCase() !== sealBuilt.rootCloseCovId.toLowerCase()) throw new Error(`RootClose covenant_id不一致: 真实=${realRcCovId} 返回=${sealBuilt.rootCloseCovId}`);
  if (realTokenCovId.toLowerCase() !== sealBuilt.tokenCovId.toLowerCase()) throw new Error(`token covenant_id不一致: 真实=${realTokenCovId} 返回=${sealBuilt.tokenCovId}`);
});

{
  const { computeRootCloseGenesisArtifact } = await import('./proto-covenant-builder.mjs');
  t('⑥fail-closed: 错误的rootCloseTmplHash必须被拒绝', () => {
    let threw = null;
    try {
      computeRootCloseGenesisArtifact({
        marketId: MARKET_ID, committeePubkeyHex: genesisArtifacts.committeePubkeyHex, deadlineMs: DEADLINE_MS,
        rootCloseTmplHash: 'ff'.repeat(32), // 故意错的
        state: { local_yes: 0, local_no: 0, count: 0, pool_value: 0, closed: 0, winningSide: 0, payoutRoot: '00'.repeat(32) },
      });
    } catch (e) { threw = e; }
    if (!threw) throw new Error('应该fail-closed throw, 却成功返回了');
    if (!/fail-closed/.test(threw.message)) throw new Error(`throw了但不是fail-closed错误: ${threw.message}`);
  });
}

// ── ③ close_commit: RootClose当前UTXO=market_seal产出的genesis输出, sealedState=bet2.newState ──
{
  const rootCloseOutpoint = { txid: sealBuilt.expectedTxid, vout: MARKET_SEAL_ROOTCLOSE_OUT_INDEX };
  const NEW_WINNING_SIDE = 0; // YES赢(测试用值, D-021合规: 非真实市场结果)
  const NEW_PAYOUT_ROOT_HEX = 'ab'.repeat(32); // 测试夹具占位值, 非真实off-chain算出的merkle root
  const closeCommitCap = loadFeeProfileCap('close_commit');
  const closeCommitFeeUtxo = { txid: 'ee'.repeat(32), vout: 1, value: 10_000_000_000n, scriptPublicKeyHex: relaySpkHex };

  let closeCommitBuilt;
  t('①close_commit buildCloseCommitTxJson 真实构造成功([rootClose,fee]两输入, 委员5槽同签)', () => {
    closeCommitBuilt = buildCloseCommitTxJson({
      kaspa, network: 'mainnet',
      marketId: MARKET_ID, committeePubkeyHex: genesisArtifacts.committeePubkeyHex,
      committeePrivkeyEnvelope: genesisArtifacts.committeePrivkeyEnvelope,
      deadlineMs: DEADLINE_MS, rootCloseTmplHash: genesisArtifacts.rootCloseTmplHash,
      rootCloseOutpoint, rootCloseCovId: sealBuilt.rootCloseCovId, sealedState: currentState,
      newWinningSide: NEW_WINNING_SIDE, newPayoutRootHex: NEW_PAYOUT_ROOT_HEX,
      tokPrefixHex, tokSuffixHex, feeUtxo: closeCommitFeeUtxo, relayChangeScriptPublicKeyHex: relaySpkHex,
      absFeeCapSompi: closeCommitCap,
    });
    if (!closeCommitBuilt.txJson || !closeCommitBuilt.expectedTxid) throw new Error('返回形状不对');
    if (closeCommitBuilt.signInputIndices.length !== 1 || closeCommitBuilt.signInputIndices[0] !== 1) throw new Error(`两输入形状下fee应该在index=1, 实际signInputIndices=${JSON.stringify(closeCommitBuilt.signInputIndices)}`);
  });

  t('②relay真代码能反序列化+extractTxShape+validateFixedValueOutputs通过(续约非genesis)', () => {
    const tx = kaspa.Transaction.deserializeFromSafeJSON(closeCommitBuilt.txJson);
    const shape = extractTxShape(tx);
    const fv = validateFixedValueOutputs({ outputs: shape.outputs, genesisOutputIndices: [], continuationOutputIndices: [CLOSE_COMMIT_ROOTCLOSE_OUT_INDEX] });
    if (!fv.ok) throw new Error(`relay真代码拒绝: ${fv.reason}`);
  });

  t('③relay真签名(fee输入)后finalize, txid与expectedTxid一致', () => {
    const tx = kaspa.Transaction.deserializeFromSafeJSON(closeCommitBuilt.txJson);
    signOnlyDeclaredInputs({ tx, signInputIndices: closeCommitBuilt.signInputIndices, privateKey: priv, kaspa });
    tx.finalize();
    const r = assertFinalTxid(tx, closeCommitBuilt.expectedTxid);
    if (!r.ok) throw new Error(`签名后txid=${r.actualTxid} != 预期${closeCommitBuilt.expectedTxid}`);
  });

  t('③b(账本1465节点规则镜像) 两输入交易每个input满足v2.0.1 RPC层sigOpCount/computeBudget一致性规则', () => {
    const tx = kaspa.Transaction.deserializeFromSafeJSON(closeCommitBuilt.txJson);
    assertKaspadInputVersionRule(tx, 'close_commit-e2e');
  });

  t('④独立复算Σ真实inputs.utxo.amount − Σ真实outputs.value必须【恰好】等于built.netLoss(账本1455纪律)', () => {
    const tx = kaspa.Transaction.deserializeFromSafeJSON(closeCommitBuilt.txJson);
    let sumIn = 0n; for (const inp of tx.inputs) sumIn += BigInt(inp.utxo.amount);
    let sumOut = 0n; for (const out of tx.outputs) sumOut += BigInt(out.value);
    const impliedFee = sumIn - sumOut;
    if (impliedFee !== closeCommitBuilt.netLoss) throw new Error(`隐含手续费(Σin-Σout=${impliedFee})与built.netLoss(${closeCommitBuilt.netLoss})不一致`);
  });

  t('⑤真实tx算出的output covenant_id(RootClose续约)与builder返回的rootCloseContinuationCovId一致且等于sealBuilt.rootCloseCovId(covenant_id不变)', () => {
    const tx = kaspa.Transaction.deserializeFromSafeJSON(closeCommitBuilt.txJson);
    const realCovId = String(tx.outputs[CLOSE_COMMIT_ROOTCLOSE_OUT_INDEX].covenant.covenantId);
    if (realCovId.toLowerCase() !== closeCommitBuilt.rootCloseContinuationCovId.toLowerCase()) throw new Error(`covenant_id不一致: 真实=${realCovId} 返回=${closeCommitBuilt.rootCloseContinuationCovId}`);
    if (realCovId.toLowerCase() !== sealBuilt.rootCloseCovId.toLowerCase()) throw new Error(`close_commit不应该改变RootClose自己的covenant_id: 续约后=${realCovId} market_seal时=${sealBuilt.rootCloseCovId}`);
  });

  t('⑥fail-closed: deadline_ms尚未过去(未来时间戳)必须被构造时拒绝, 不留prepared残留', () => {
    let threw = null;
    try {
      buildCloseCommitTxJson({
        kaspa, network: 'mainnet',
        marketId: MARKET_ID, committeePubkeyHex: genesisArtifacts.committeePubkeyHex,
        committeePrivkeyEnvelope: genesisArtifacts.committeePrivkeyEnvelope,
        deadlineMs: Date.now() + 3600_000, // 故意未来时间戳
        rootCloseTmplHash: genesisArtifacts.rootCloseTmplHash,
        rootCloseOutpoint, rootCloseCovId: sealBuilt.rootCloseCovId, sealedState: currentState,
        newWinningSide: NEW_WINNING_SIDE, newPayoutRootHex: NEW_PAYOUT_ROOT_HEX,
        tokPrefixHex, tokSuffixHex, feeUtxo: closeCommitFeeUtxo, relayChangeScriptPublicKeyHex: relaySpkHex,
        absFeeCapSompi: closeCommitCap,
      });
    } catch (e) { threw = e; }
    if (!threw) throw new Error('deadline未过去时应该fail-closed throw, 却成功返回了');
    if (!/fail-closed/.test(threw.message)) throw new Error(`throw了但不是fail-closed错误: ${threw.message}`);
  });

  const { decryptCommitteePrivkey } = await import('./proto-committee-key.mjs');
  t('⑦委员私钥不进返回值(检查closeCommitBuilt的每个字段都不含明文私钥子串)', () => {
    const privHex = decryptCommitteePrivkey(genesisArtifacts.committeePrivkeyEnvelope);
    const serialized = JSON.stringify(closeCommitBuilt, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    if (serialized.includes(privHex)) throw new Error('committeePrivkeyEnvelope解密后的明文私钥出现在了builder返回值里');
  });

  // ══════════ ④ convert_to_claim(批5): RootClose=close_commit产出的续约输出(closed:1), held=market_seal产出的代币输出 ══════════
  const { buildConvertToClaimTxJson, convertToClaimWitnessArgs, CONVERT_TO_CLAIM_CLAIM_OUT_INDEX, CONVERT_TO_CLAIM_TOKEN_OUT_INDEX, CONVERT_TO_CLAIM_HELD_IN_INDEX } = await import('./proto-tx-assembly-settlement.mjs');
  const { computeRootClaimGenesisArtifact } = await import('./proto-covenant-builder.mjs');
  const { encodeConvertToClaimAction } = await import('./proto-convert-to-claim-witness.mjs');
  const { blake2b } = (await import('node:module')).createRequire(import.meta.url)('../../node_modules/@noble/hashes/blake2b.js'); // 同proto-covenant-builder.mjs:27(package exports不放行子路径)
  const closedState = { ...currentState, closed: 1, winningSide: NEW_WINNING_SIDE, payoutRoot: NEW_PAYOUT_ROOT_HEX };
  const c2cRootCloseOutpoint = { txid: closeCommitBuilt.expectedTxid, vout: CLOSE_COMMIT_ROOTCLOSE_OUT_INDEX };
  const c2cHeldOutpoint = { txid: sealBuilt.expectedTxid, vout: MARKET_SEAL_TOKEN_OUT_INDEX };
  const c2cCap = loadFeeProfileCap('convert_to_claim');
  const c2cFeeUtxo = { txid: 'ee'.repeat(32), vout: 2, value: 10_000_000_000n, scriptPublicKeyHex: relaySpkHex };
  const c2cArgs = (over = {}) => ({
    kaspa, network: 'mainnet',
    marketId: MARKET_ID, committeePubkeyHex: genesisArtifacts.committeePubkeyHex, deadlineMs: DEADLINE_MS, rootCloseTmplHash: genesisArtifacts.rootCloseTmplHash,
    rootCloseOutpoint: c2cRootCloseOutpoint, rootCloseCovId: sealBuilt.rootCloseCovId, closedState, heldTokenOutpoint: c2cHeldOutpoint,
    tokPrefixHex, tokSuffixHex, feeUtxo: c2cFeeUtxo, relayChangeScriptPublicKeyHex: relaySpkHex, absFeeCapSompi: c2cCap,
    ...over,
  });


  const { computeRootCloseGenesisArtifact } = await import('./proto-covenant-builder.mjs');
  const compiledRootCloseAbi = () => computeRootCloseGenesisArtifact({ marketId: MARKET_ID, committeePubkeyHex: genesisArtifacts.committeePubkeyHex, deadlineMs: DEADLINE_MS, rootCloseTmplHash: genesisArtifacts.rootCloseTmplHash, state: closedState }).entries.convert_to_claim;
  // 独立的push解析器(不复用编码器), 按ABI声明顺序读回具名参数
  const parsePushesLocal = (hex) => {
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
      else throw new Error('parsePushesLocal: 非push opcode 0x' + op.toString(16));
    }
    return out;
  };
  const decodeSmallIntLocal = (buf) => { if (buf.length === 0) return 0; if (buf.length === 1 && buf[0] === 0x81) return -1; let v = 0n; for (let k = buf.length - 1; k >= 0; k--) v = (v << 8n) | BigInt(buf[k]); return Number(v); };

  let c2cBuilt;
  t('①convert_to_claim buildConvertToClaimTxJson 真实构造成功([rootClose,held,fee]三输入, 三输出)', () => {
    c2cBuilt = buildConvertToClaimTxJson(c2cArgs());
    if (!c2cBuilt.txJson || !c2cBuilt.expectedTxid) throw new Error('返回形状不对');
    if (JSON.stringify(c2cBuilt.signInputIndices) !== '[2]') throw new Error(`fee应该在index=2, 实际${JSON.stringify(c2cBuilt.signInputIndices)}`);
    if (JSON.stringify(c2cBuilt.genesisOutputIndices) !== '[0,1]') throw new Error(`genesisOutputIndices不对: ${JSON.stringify(c2cBuilt.genesisOutputIndices)}`);
  });

  t('②relay真代码能反序列化+extractTxShape+validateFixedValueOutputs通过(两个genesis输出)', () => {
    const tx = kaspa.Transaction.deserializeFromSafeJSON(c2cBuilt.txJson);
    const shape = extractTxShape(tx);
    const fv = validateFixedValueOutputs({ outputs: shape.outputs, genesisOutputIndices: c2cBuilt.genesisOutputIndices, continuationOutputIndices: [] });
    if (!fv.ok) throw new Error(`relay真代码拒绝: ${fv.reason}`);
  });

  t('③relay真签名(fee输入)后finalize, txid与expectedTxid一致', () => {
    const tx = kaspa.Transaction.deserializeFromSafeJSON(c2cBuilt.txJson);
    signOnlyDeclaredInputs({ tx, signInputIndices: c2cBuilt.signInputIndices, privateKey: priv, kaspa });
    tx.finalize();
    const r = assertFinalTxid(tx, c2cBuilt.expectedTxid);
    if (!r.ok) throw new Error(`签名后txid=${r.actualTxid} != 预期${c2cBuilt.expectedTxid}`);
  });

  t('③b(账本1465节点规则镜像) 三输入交易每个input满足v2.0.1 RPC层sigOpCount/computeBudget一致性规则', () => {
    assertKaspadInputVersionRule(kaspa.Transaction.deserializeFromSafeJSON(c2cBuilt.txJson), 'convert_to_claim-e2e');
  });

  t('④独立复算Σ真实inputs.utxo.amount − Σ真实outputs.value必须【恰好】等于built.netLoss(账本1455纪律)', () => {
    const tx = kaspa.Transaction.deserializeFromSafeJSON(c2cBuilt.txJson);
    let sumIn = 0n; for (const inp of tx.inputs) sumIn += BigInt(inp.utxo.amount);
    let sumOut = 0n; for (const out of tx.outputs) sumOut += BigInt(out.value);
    if (sumIn - sumOut !== c2cBuilt.netLoss) throw new Error(`隐含手续费(${sumIn - sumOut})与built.netLoss(${c2cBuilt.netLoss})不一致`);
  });

  t('⑤covenant_id独立复算: claim的covenant_id=kaspa.covenantId(fee outpoint,[claim输出]); 新代币输出spk=以【真实claim covid】为owner现算的KTT', () => {
    const tx = kaspa.Transaction.deserializeFromSafeJSON(c2cBuilt.txJson);
    const feeOutpointObj = { transactionId: c2cFeeUtxo.txid, index: c2cFeeUtxo.vout };
    const indep = String(kaspa.covenantId(feeOutpointObj, [{ index: CONVERT_TO_CLAIM_CLAIM_OUT_INDEX, output: new kaspa.TransactionOutput(tx.outputs[CONVERT_TO_CLAIM_CLAIM_OUT_INDEX].value, tx.outputs[CONVERT_TO_CLAIM_CLAIM_OUT_INDEX].scriptPublicKey) }]));
    const realClaim = String(tx.outputs[CONVERT_TO_CLAIM_CLAIM_OUT_INDEX].covenant.covenantId);
    if (indep.toLowerCase() !== realClaim.toLowerCase()) throw new Error(`claim covid: 独立复算=${indep} 真实tx=${realClaim}`);
    if (realClaim.toLowerCase() !== c2cBuilt.claimCovId.toLowerCase()) throw new Error('返回的claimCovId与真实tx不一致');
    const expectTok = computeKttGenesisArtifact({ amount: closedState.pool_value, ownerCovIdHex: realClaim.toLowerCase() });
    if ('0x' + String(tx.outputs[CONVERT_TO_CLAIM_TOKEN_OUT_INDEX].scriptPublicKey.script) !== expectTok.scriptPubKeyHex) throw new Error('新代币输出的spk不是以真实claim covid为owner的KTT');
    if (String(tx.outputs[CONVERT_TO_CLAIM_TOKEN_OUT_INDEX].covenant.covenantId).toLowerCase() !== c2cBuilt.tokenCovId.toLowerCase()) throw new Error('返回的tokenCovId与真实tx不一致');
  });

  // RootClaim genesis输出的独立构造(不共用computeRootClaimGenesisArtifact): 用state全0的探针编译拿prefix/suffix布局,
  // 手工把8字段state(每字段=长度字节+小端/原始字节, 同NWT审计构造的fieldInt/fieldBytes32)拼进去, 再自己算P2SH。
  t('⑥RootClaim输出spk与独立"探针+手工splice+自算P2SH"构造逐字节一致(自检两侧不共用实现)', () => {
    const { ps_tmpl_hash, token_tmpl_hash, claim_tmpl_hash } = loadProtocolConstants();
    const probeCtor = [
      ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(MARKET_ID),
      ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorBytes32V100('00'.repeat(32)), ctorIntV100(0),
      ctorBytes32V100(token_tmpl_hash), ctorBytes32V100(claim_tmpl_hash),
    ];
    const probe = compileSilV100(new URL('./RootClaim.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), probeCtor, 'RootClaim');
    const probeScript = Buffer.from(probe.script);
    const { start, len } = probe.state_layout;
    const fieldInt = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return Buffer.concat([Buffer.from([8]), b]); };
    const fieldB32 = (b) => Buffer.concat([Buffer.from([32]), b]);
    const stateBytes = Buffer.concat([
      fieldInt(closedState.local_yes), fieldInt(closedState.local_no), fieldInt(closedState.count), fieldInt(closedState.pool_value),
      fieldInt(closedState.closed), fieldInt(closedState.winningSide), fieldB32(Buffer.from(closedState.payoutRoot, 'hex')), fieldInt(0),
    ]);
    if (stateBytes.length !== len) throw new Error(`手工state字节长度${stateBytes.length} != 探针state_layout.len(${len})`);
    const redeem = Buffer.concat([probeScript.subarray(0, start), stateBytes, probeScript.subarray(start + len)]);
    const spkHex = 'aa20' + Buffer.from(blake2b(Uint8Array.from(redeem), { dkLen: 32 })).toString('hex') + '87';
    const tx = kaspa.Transaction.deserializeFromSafeJSON(c2cBuilt.txJson);
    const got = String(tx.outputs[CONVERT_TO_CLAIM_CLAIM_OUT_INDEX].scriptPublicKey.script);
    if (got !== spkHex) throw new Error(`RootClaim输出spk不一致: builder=${got} 独立构造=${spkHex}`);
    if (c2cBuilt.claimPrefixHex !== probeScript.subarray(0, start).toString('hex')) throw new Error('claimPrefix与探针不一致');
    if (c2cBuilt.claimSuffixHex !== probeScript.subarray(start + len).toString('hex')) throw new Error('claimSuffix与探针不一致');
  });

  t('⑦RootClose input见证里 claimOutIdx/tokenInIdx/tokenOutIdx 位置与交易真实结构一致(独立push解析器)', () => {
    const tx = kaspa.Transaction.deserializeFromSafeJSON(c2cBuilt.txJson);
    const rcAbi = compiledRootCloseAbi();
    const pushes = parsePushesLocal(String(tx.inputs[0].signatureScript).replace(/^0x/, ''));
    const at = (name) => decodeSmallIntLocal(pushes[rcAbi.params.findIndex((p) => p.name === name)]);
    const heldPos = tx.inputs.findIndex((i) => String(i.previousOutpoint.transactionId) === c2cHeldOutpoint.txid && Number(i.previousOutpoint.index) === c2cHeldOutpoint.vout);
    if (heldPos !== CONVERT_TO_CLAIM_HELD_IN_INDEX) throw new Error(`held输入真实下标${heldPos} != ${CONVERT_TO_CLAIM_HELD_IN_INDEX}`);
    if (at('claimOutIdx') !== CONVERT_TO_CLAIM_CLAIM_OUT_INDEX) throw new Error(`claimOutIdx读回${at('claimOutIdx')}`);
    if (at('tokenInIdx') !== heldPos) throw new Error(`tokenInIdx读回${at('tokenInIdx')} != held真实下标${heldPos}`);
    if (at('tokenOutIdx') !== CONVERT_TO_CLAIM_TOKEN_OUT_INDEX) throw new Error(`tokenOutIdx读回${at('tokenOutIdx')}`);
  });

  // 🔴 本条是tokenInIdx/tokenOutIdx换位的【唯一】守卫: 真实形状里held输入下标与token输出下标同为1, 共识/链上黄金
  // 回归/上面⑦都看不出两者互换(批3 market_seal已负向对照证实同一件事)。不要因为"看起来冗余"删掉它。
  t('⑧convertToClaimWitnessArgs映射: heldIdx=7(≠tokenOut=1)时 tokenInIdx=7、tokenOutIdx=CONVERT_TO_CLAIM_TOKEN_OUT_INDEX、claimOutIdx=CONVERT_TO_CLAIM_CLAIM_OUT_INDEX', () => {
    if (7 === CONVERT_TO_CLAIM_TOKEN_OUT_INDEX) throw new Error('测试向量退化');
    const a = convertToClaimWitnessArgs({ heldIdx: 7, claimPrefixHex: 'aa', claimSuffixHex: 'bb', tokPrefixHex: '0xcc', tokSuffixHex: '0xdd' });
    if (a.tokenInIdx !== 7) throw new Error(`tokenInIdx=${a.tokenInIdx} != 7`);
    if (a.tokenOutIdx !== CONVERT_TO_CLAIM_TOKEN_OUT_INDEX) throw new Error(`tokenOutIdx=${a.tokenOutIdx}`);
    if (a.claimOutIdx !== CONVERT_TO_CLAIM_CLAIM_OUT_INDEX) throw new Error(`claimOutIdx=${a.claimOutIdx}`);
    if (a.claim_prefix !== '0xaa' || a.claim_suffix !== '0xbb' || a.tok_prefix !== '0xcc' || a.tok_suffix !== '0xdd') throw new Error('prefix/suffix透传不对');
    // 哨兵(Bettor采纳NWT): 所有索引参数在哨兵输入下两两不同
    const idx = [a.claimOutIdx, a.tokenInIdx, a.tokenOutIdx];
    if (new Set(idx).size !== idx.length) throw new Error(`索引参数在哨兵输入下不是两两不同: ${JSON.stringify(idx)}`);
  });
  t('⑧b编码器: tokenIn=1/tokenOut=3 与 互换 得到不同字节', () => {
    const abi = compiledRootCloseAbi();
    const base = { claimOutIdx: 0, claim_prefix: '0xaa', claim_suffix: '0xbb', tok_prefix: '0xcc', tok_suffix: '0xdd' };
    if (encodeConvertToClaimAction(kaspa, abi, { ...base, tokenInIdx: 1, tokenOutIdx: 3 }) === encodeConvertToClaimAction(kaspa, abi, { ...base, tokenInIdx: 3, tokenOutIdx: 1 })) throw new Error('互换后字节相同');
  });

  const expectFailClosed = (label, fn, pattern) => t(label, () => {
    let threw = null; try { fn(); } catch (e) { threw = e; }
    if (!threw) throw new Error('应该throw, 却成功返回了');
    if (!pattern.test(threw.message)) throw new Error(`throw了但报文不对: ${threw.message}`);
  });
  expectFailClosed('⑨fail-closed: closedState.closed=0(尚未close_commit)', () => buildConvertToClaimTxJson(c2cArgs({ closedState: { ...closedState, closed: 0 } })), /fail-closed.*closed/);
  expectFailClosed('⑨fail-closed: heldTokenOutpoint为空(没有持有代币输入)', () => buildConvertToClaimTxJson(c2cArgs({ heldTokenOutpoint: null })), /fail-closed.*heldTokenOutpoint/);
  expectFailClosed('⑨fail-closed: 错误的rootCloseTmplHash', () => buildConvertToClaimTxJson(c2cArgs({ rootCloseTmplHash: 'ff'.repeat(32) })), /fail-closed/);

  t('⑩不含私钥/委员私钥信封解密值: builder返回值序列化后不含明文私钥', () => {
    const privHex = decryptCommitteePrivkey(genesisArtifacts.committeePrivkeyEnvelope);
    if (JSON.stringify(c2cBuilt, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)).includes(privHex)) throw new Error('明文私钥出现在了convert_to_claim返回值里');
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
