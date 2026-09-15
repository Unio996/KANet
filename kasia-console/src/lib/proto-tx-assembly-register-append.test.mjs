// proto-tx-assembly-register-append.test.mjs — buildRegisterAppendTxJson 真实端到端组装验证
// (账本1425/1434/1436, D-020账本1446/1448单笔交易改造)。真 kaspa-wasm + 真编译, relay 真代码交叉核验, 零mock。
// Run: cd kasia-console && node src/lib/proto-tx-assembly-register-append.test.mjs

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_TX_ASSEMBLY_REGAPPEND_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_regappend_e2e_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_TX_ASSEMBLY_REGAPPEND_TEST_BOOTSTRAPPED: '1' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);

const kaspa = await import('kaspa-wasm');
const { randomBytes } = await import('node:crypto');
const {
  buildMarketGenesisTxJson, buildRegisterAppendTxJson, scriptPublicKeyFromHex,
} = await import('./proto-tx-assembly.mjs');
const {
  computeMarketGenesisArtifacts, computeShardLeafRedeemScript, computeKttGenesisArtifact,
  loadProtocolConstants,
} = await import('./proto-covenant-builder.mjs');
const { compileSilV100 } = await import('./pool-bshard-artifacts.mjs');
const { extractTxShape, validateFixedValueOutputs, signOnlyDeclaredInputs, assertFinalTxid } = await import('../../../kasia-relay/src/lib/covenant-broadcast.mjs');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message + '\n' + e.stack); } };

const priv = new kaspa.PrivateKey(randomBytes(32).toString('hex'));
const relayAddr = priv.toPublicKey().toAddress('mainnet');
const relaySpk = kaspa.payToAddressScript(relayAddr);
const relaySpkHex = '0x' + relaySpk.script;

// ── ① 先真实构造一次 market_genesis, 拿到真实的 leafCovId + shardLeafDirect 脚本(与生产同一条链路) ──
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

function compileEntryAbi(silPath, ctor, contractName) {
  const compiled = compileSilV100(silPath, ctor, contractName);
  return compiled;
}

const SLD_PATH = new URL('./ShardLeaf_direct.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TICKET_PATH = new URL('./sil-v1/PoolSideTicket.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const KTT_PATH = new URL('./sil-v1/KanetTestToken.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// D-020(账本1446/1448): 唯一编一次 KTT(纯为了拿 entries.transfer 的 entryAbi + runtime_state 字段数,
// 结构性质不依赖 owner 值——不再需要 STAKE_CHIP_OWNER_UNBOUND 这个哨兵, 用任意占位 owner(ZERO32)即可),
// held 输入(唯一还会消费的 KTT 实例)复用同一份 entryAbi/stateFieldCount。
const kttCtorForAbi = [{ kind: 'int', value: 1 }, { kind: 'bytes', value: [...Buffer.alloc(32)] }, { kind: 'byte', value: 4 }, { kind: 'byte', value: 0 }, { kind: 'bytes', value: [...Buffer.alloc(32)] }, { kind: 'bytes', value: [...Buffer.alloc(32)] }, { kind: 'int', value: 3 }, { kind: 'int', value: 3 }];
const kttCompiled = compileEntryAbi(KTT_PATH, kttCtorForAbi, 'KanetTestToken');
const kttEntryAbi = kttCompiled._raw.contracts.KanetTestToken.entries.transfer;
const kttStateFieldCount = kttCompiled._raw.contracts.KanetTestToken.runtime_state.fields.length;

// ── ②第一笔下注(无 held 输入, currentState 全0, [leaf, fee] 两输入) ──
{
  const SIDE = 0, STAKE = 20;
  const bettorPk = Buffer.alloc(32, 0x66).toString('hex');
  const currentState = { local_yes: 0, local_no: 0, count: 0, pool_value: 0 };
  const newState = { local_yes: SIDE === 0 ? STAKE : 0, local_no: SIDE === 1 ? STAKE : 0, count: 1, pool_value: STAKE };

  const leafRedeem = computeShardLeafRedeemScript({ marketId: MARKET_ID, minBet: MIN_BET, sealCount: SEAL_COUNT, rootcloseTmplHash: genesisArtifacts.rootCloseTmplHash, state: currentState });

  // register_append 的真实 entryAbi(用当前 ctor 现编, 与 leafRedeem 同一份 ctor)——D-020: 10 参数, 无 stakeInIdx。
  const { ctorBytes32V100, ctorIntV100 } = await import('./pool-bshard-artifacts.mjs');
  const sldCtor = [
    ctorBytes32V100(MARKET_ID), ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(MARKET_ID),
    ctorIntV100(SEAL_COUNT), ctorIntV100(MIN_BET), ctorBytes32V100(genesisArtifacts.rootCloseTmplHash), ctorBytes32V100('00'.repeat(32)),
    ctorBytes32V100(token_tmpl_hash), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0),
  ];
  const sldCompiled = compileEntryAbi(SLD_PATH, sldCtor, 'ShardLeaf_direct');
  const registerAppendEntryAbi = sldCompiled._raw.contracts.ShardLeaf_direct.entries.register_append;

  // 合并 KTT genesis(owner=leafCovId, amount=pool_value+stake 纯witness值——不再从任何输入state读取)
  const mergedArtifact = computeKttGenesisArtifact({ amount: newState.pool_value, ownerCovIdHex: leafCovId });

  // ticket genesis
  const ticketCtor = [{ kind: 'bytes', value: [...Buffer.from(bettorPk, 'hex')] }, { kind: 'int', value: SIDE }, { kind: 'int', value: STAKE }, { kind: 'bytes', value: [...Buffer.from(MARKET_ID, 'hex')] }];
  const ticketCompiled = compileEntryAbi(TICKET_PATH, ticketCtor, 'PoolSideTicket');
  const { p2sh } = await import('./proto-covenant-builder.mjs');
  const { extractTemplateArtifactV100 } = await import('./pool-template-artifact.mjs');
  const ticketSpkHex = '0x' + p2sh(Buffer.from(ticketCompiled.script));
  const ticketTemplateArtifact = extractTemplateArtifactV100(ticketCompiled);
  const psPrefixHex = '0x' + Buffer.from(ticketTemplateArtifact.templatePrefix).toString('hex');
  const psSuffixHex = '0x' + Buffer.from(ticketTemplateArtifact.templateSuffix).toString('hex');
  const tokPrefixHex = '0x' + Buffer.from(extractTemplateArtifactV100(kttCompiled).templatePrefix).toString('hex');
  const tokSuffixHex = '0x' + Buffer.from(extractTemplateArtifactV100(kttCompiled).templateSuffix).toString('hex');

  const feeUtxo = { txid: 'dd'.repeat(32), vout: 0, value: 10_000_000_000n, scriptPublicKeyHex: relaySpkHex };

  let built;
  t('①first_bet buildRegisterAppendTxJson 真实构造成功([leaf,fee]两输入, 无held无stake)', () => {
    built = buildRegisterAppendTxJson({
      kaspa, network: 'mainnet',
      leafRedeemScript: leafRedeem.script, leafStateLayout: leafRedeem.stateLayout,
      leafOutpoint, leafCovId, currentState, newState,
      heldInput: null,
      feeUtxo, relayChangeScriptPublicKeyHex: relaySpkHex,
      registerAppendEntryAbi, registerAppendArgs: { side: SIDE, stake: STAKE, bettorPk, psPrefix: psPrefixHex, psSuffix: psSuffixHex, tokPrefix: tokPrefixHex, tokSuffix: tokSuffixHex },
      ticketScriptPubKeyHex: ticketSpkHex, mergedKttScript: mergedArtifact.script,
      absFeeCapSompi: 100_000_000n,
    });
    if (!built.txJson || !built.expectedTxid) throw new Error('返回形状不对');
    if (built.signInputIndices.length !== 1 || built.signInputIndices[0] !== 1) throw new Error(`两输入形状下 fee 应该在 index=1, 实际 signInputIndices=${JSON.stringify(built.signInputIndices)}`);
  });

  t('②relay真代码能反序列化+extractTxShape+validateFixedValueOutputs通过', () => {
    const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
    const shape = extractTxShape(tx);
    const fv = validateFixedValueOutputs({ outputs: shape.outputs, genesisOutputIndices: built.genesisOutputIndices, continuationOutputIndices: built.continuationOutputIndices });
    if (!fv.ok) throw new Error(`relay真代码拒绝: ${fv.reason}`);
  });

  t('③relay真签名(fee输入)后finalize, txid与expectedTxid一致', () => {
    const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
    signOnlyDeclaredInputs({ tx, signInputIndices: built.signInputIndices, privateKey: priv, kaspa });
    tx.finalize();
    const r = assertFinalTxid(tx, built.expectedTxid);
    if (!r.ok) throw new Error(`签名后txid=${r.actualTxid} != 预期${built.expectedTxid}`);
  });
}

// ── ④⑤⑥ 第二笔下注(有 held 输入, currentState.pool_value=第一笔下注后的值, [leaf,held,fee] 三输入) ──
{
  const SIDE = 1, STAKE = 30;
  const bettorPk = Buffer.alloc(32, 0x77).toString('hex');
  const currentState = { local_yes: 20, local_no: 0, count: 1, pool_value: 20 }; // 第一笔下注(side=0,stake=20)落链后的状态
  const newState = { local_yes: currentState.local_yes, local_no: currentState.local_no + STAKE, count: currentState.count + 1, pool_value: currentState.pool_value + STAKE };

  const leafRedeem = computeShardLeafRedeemScript({ marketId: MARKET_ID, minBet: MIN_BET, sealCount: SEAL_COUNT, rootcloseTmplHash: genesisArtifacts.rootCloseTmplHash, state: currentState });

  const { ctorBytes32V100, ctorIntV100 } = await import('./pool-bshard-artifacts.mjs');
  const sldCtor = [
    ctorBytes32V100(MARKET_ID), ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(MARKET_ID),
    ctorIntV100(SEAL_COUNT), ctorIntV100(MIN_BET), ctorBytes32V100(genesisArtifacts.rootCloseTmplHash), ctorBytes32V100('00'.repeat(32)),
    ctorBytes32V100(token_tmpl_hash), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0),
  ];
  const sldCompiled = compileEntryAbi(SLD_PATH, sldCtor, 'ShardLeaf_direct');
  const registerAppendEntryAbi = sldCompiled._raw.contracts.ShardLeaf_direct.entries.register_append;

  const heldArtifact = computeKttGenesisArtifact({ amount: currentState.pool_value, ownerCovIdHex: leafCovId }); // 上一笔 register_append 产出的合并池代币(held)
  const mergedArtifact = computeKttGenesisArtifact({ amount: newState.pool_value, ownerCovIdHex: leafCovId });

  const ticketCtor = [{ kind: 'bytes', value: [...Buffer.from(bettorPk, 'hex')] }, { kind: 'int', value: SIDE }, { kind: 'int', value: STAKE }, { kind: 'bytes', value: [...Buffer.from(MARKET_ID, 'hex')] }];
  const ticketCompiled = compileEntryAbi(TICKET_PATH, ticketCtor, 'PoolSideTicket');
  const { p2sh } = await import('./proto-covenant-builder.mjs');
  const { extractTemplateArtifactV100 } = await import('./pool-template-artifact.mjs');
  const ticketSpkHex = '0x' + p2sh(Buffer.from(ticketCompiled.script));
  const ticketTemplateArtifact = extractTemplateArtifactV100(ticketCompiled);
  const psPrefixHex = '0x' + Buffer.from(ticketTemplateArtifact.templatePrefix).toString('hex');
  const psSuffixHex = '0x' + Buffer.from(ticketTemplateArtifact.templateSuffix).toString('hex');
  const tokPrefixHex = '0x' + Buffer.from(extractTemplateArtifactV100(kttCompiled).templatePrefix).toString('hex');
  const tokSuffixHex = '0x' + Buffer.from(extractTemplateArtifactV100(kttCompiled).templateSuffix).toString('hex');

  const heldOutpoint = { txid: 'bb'.repeat(32), vout: 0 };
  const feeUtxo = { txid: 'dd'.repeat(32), vout: 0, value: 10_000_000_000n, scriptPublicKeyHex: relaySpkHex };

  let built;
  t('④second_bet buildRegisterAppendTxJson 真实构造成功([leaf,held,fee]三输入, 无stake)', () => {
    built = buildRegisterAppendTxJson({
      kaspa, network: 'mainnet',
      leafRedeemScript: leafRedeem.script, leafStateLayout: leafRedeem.stateLayout,
      leafOutpoint, leafCovId, currentState, newState,
      heldInput: { txid: heldOutpoint.txid, vout: heldOutpoint.vout, value: 20_000_000n, scriptPublicKeyHex: heldArtifact.scriptPubKeyHex, redeemScript: heldArtifact.script, entryAbi: kttEntryAbi, stateFieldCount: kttStateFieldCount },
      feeUtxo, relayChangeScriptPublicKeyHex: relaySpkHex,
      registerAppendEntryAbi, registerAppendArgs: { side: SIDE, stake: STAKE, bettorPk, psPrefix: psPrefixHex, psSuffix: psSuffixHex, tokPrefix: tokPrefixHex, tokSuffix: tokSuffixHex },
      ticketScriptPubKeyHex: ticketSpkHex, mergedKttScript: mergedArtifact.script,
      absFeeCapSompi: 100_000_000n,
    });
    if (!built.txJson || !built.expectedTxid) throw new Error('返回形状不对');
    if (built.signInputIndices.length !== 1 || built.signInputIndices[0] !== 2) throw new Error(`三输入形状下 fee 应该在 index=2, 实际 signInputIndices=${JSON.stringify(built.signInputIndices)}`);
  });

  t('⑤relay真代码能反序列化+extractTxShape+validateFixedValueOutputs通过(有held输入形状)', () => {
    const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
    const shape = extractTxShape(tx);
    const fv = validateFixedValueOutputs({ outputs: shape.outputs, genesisOutputIndices: built.genesisOutputIndices, continuationOutputIndices: built.continuationOutputIndices });
    if (!fv.ok) throw new Error(`relay真代码拒绝: ${fv.reason}`);
  });

  t('⑥relay真签名(fee输入)后finalize, txid与expectedTxid一致(有held输入形状)', () => {
    const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
    signOnlyDeclaredInputs({ tx, signInputIndices: built.signInputIndices, privateKey: priv, kaspa });
    tx.finalize();
    const r = assertFinalTxid(tx, built.expectedTxid);
    if (!r.ok) throw new Error(`签名后txid=${r.actualTxid} != 预期${built.expectedTxid}`);
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
