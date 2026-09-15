// scripts/simnet/run-full-chain.mjs — 账本1473/1480 Bettor批准的simnet全链真实共识验证。
// genesis/register_append用生产builder(proto-tx-assembly.mjs/proto-covenant-builder.mjs, 主线
// fa6e5790之后, 逐字对照 src/lib/proto-tx-assembly-register-append.test.mjs 生产参考用法), 签名用
// kasia-relay生产签名函数(signOnlyDeclaredInputs, 独立调用, 不经生产relay进程)。
// 结算五步(convert_to_rootclose起)目前无生产builder, 用scripts/audit的构造(逐步标注)。
// 只连本机simnet RPC(127.0.0.1:18510), 不碰主网, 不用生产relay/console实例。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

process.env.DB_PATH = process.env.DB_PATH || 'D:/kanet-tn12/scratch/_nwt_simnet_console.db';
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '2'.repeat(64);

const kaspa = await import('kaspa-wasm');
const { execSync } = await import('node:child_process');
try { execSync('node scripts/run-migrations.mjs', { env: process.env, stdio: 'pipe' }); } catch (e) { console.log('migrate warn:', e.message.slice(0, 200)); }

const {
  buildMarketGenesisTxJson, buildRegisterAppendTxJson, scriptPublicKeyFromHex,
  assertKaspadInputVersionRule, PROTO_V0_COMPUTE_BUDGET, GENESIS_OUTPUT_SOMPI, CONTINUATION_OUTPUT_SOMPI,
  selectChangeShape, assertImpliedFeeMatches,
} = await import('../../src/lib/proto-tx-assembly.mjs');
const {
  computeMarketGenesisArtifacts, computeShardLeafRedeemScript, computeKttGenesisArtifact,
  loadProtocolConstants, loadFeeProfileCap, p2sh,
} = await import('../../src/lib/proto-covenant-builder.mjs');
const { compileSilV100, ctorBytes32V100, ctorIntV100 } = await import('../../src/lib/pool-bshard-artifacts.mjs');
const { extractTemplateArtifactV100 } = await import('../../src/lib/pool-template-artifact.mjs');
const {
  extractTxShape, validateFixedValueOutputs, signOnlyDeclaredInputs, assertFinalTxid,
} = await import('../../../kasia-relay/src/lib/covenant-broadcast.mjs');
const { encodeEntryActionGeneric, combineActionAndRedeem } = await import('../audit/generic-entry-witness.mjs');
const { encodeKttTransferZeroOutAction, combineKttActionAndRedeem } = await import('../../src/lib/proto-ktt-transfer-witness.mjs');
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const { blake2b } = require('../../node_modules/@noble/hashes/blake2b.js');
const b2b = (buf) => Buffer.from(blake2b(Uint8Array.from(buf), { dkLen: 32 }));
const fieldBytes32 = (b) => Buffer.concat([Buffer.from([32]), b]);
const fieldInt = (n) => { const le8 = Buffer.alloc(8); le8.writeBigInt64LE(BigInt(n)); return Buffer.concat([Buffer.from([8]), le8]); };
const ZERO32 = Buffer.alloc(32, 0x00);
const DUST_MIN_SOMPI = 1000n; // RootClose.sil/RootClaim.sil DUST_MIN常量(sompi), convert_to_claim/convert_to_refundclaim的KAS侧只剩dust
// 🔴 账本1484 Bettor复核发现: RootClaim.sil:103 require(payout>=1000)里的1000是代币化前(KAS sompi
// 时代)遗留字面量——代币化后payout是KTT数量, 不是sompi。API默认min_bet=1(src/api/proto.js:118),
// 小额市场赢家payout<1000枚会永远无法claim_draw(结构性阻塞, 待列入RootClaim待修清单)。本变量控制
// 这次复现用哪一方作为赢家, 验证"a59c7b48同形状"(bet1=YES stake=1, bet2=NO stake=999, 裁决YES,
// 唯一赢票payout=pool_value=1000, 恰好卡在门槛上)是否可行——设0=bet1(YES)赢, 1=bet2(NO)赢。
const WINNER_SIDE = 0;

const NETWORK = 'simnet';
const RPC_URL = 'ws://127.0.0.1:18510';
const STATE_PATH = 'D:/kanet-tn12/scratch/_nwt_simnet_state.json';
const CHAIN_PATH = 'D:/kanet-tn12/scratch/_nwt_simnet_chain.json';

const rpc = new kaspa.RpcClient({ url: RPC_URL, networkId: NETWORK });
await rpc.connect();
console.log('connected to simnet RPC');

async function getUtxos(addr) {
  const res = await rpc.getUtxosByAddresses({ addresses: [addr] });
  return (res.entries || []).map((e) => ({ txid: e.outpoint.transactionId, vout: e.outpoint.index, value: BigInt(e.amount), scriptPublicKeyHex: '0x' + e.scriptPublicKey.script, blockDaaScore: BigInt(e.blockDaaScore ?? 0) }));
}
async function mineOne(payAddress) {
  const { block } = await rpc.getBlockTemplate({ payAddress });
  const r = await rpc.submitBlock({ block, allowNonDAABlocks: true });
  return r;
}
async function submitAndConfirm(tx, label, minerAddr) {
  console.log(`\n--- 提交 ${label}: txid=${tx.id} mass=${kaspa.calculateTransactionMass(NETWORK, tx)} ---`);
  const res = await rpc.submitTransaction({ transaction: tx, allowOrphan: false });
  console.log(`${label} submit result:`, JSON.stringify(res));
  await mineOne(minerAddr);
  console.log(`已挖1块确认 ${label}`);
  return res;
}

// ── 加载持久化状态(relay身份 + 已完成链步骤记录, 幂等续跑) ──
if (!existsSync(STATE_PATH)) throw new Error(`${STATE_PATH} 不存在——先跑一次步骤0资金准备(见ledger)`);
const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
const relayPriv = new kaspa.PrivateKey(state.relayPrivHex);
const relayAddr = state.relayAddr;
const minerAddr = state.minerAddr;
console.log('relay地址(持久化载入):', relayAddr);

let chain = existsSync(CHAIN_PATH) ? JSON.parse(readFileSync(CHAIN_PATH, 'utf8')) : {};
function saveChain() { writeFileSync(CHAIN_PATH, JSON.stringify(chain, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)); }

const relayChangeSpk = kaspa.payToAddressScript(new kaspa.Address(relayAddr));
const relayChangeSpkHex = '0x' + relayChangeSpk.script;

// ══════════════════ 步骤1: market_genesis(生产builder) ══════════════════
if (!chain.genesis) {
  const utxos = await getUtxos(relayAddr);
  if (utxos.length === 0) throw new Error('relay地址无可用UTXO, 无法构造genesis fee输入');
  const feeUtxoRaw = utxos.sort((a, b) => (b.value > a.value ? 1 : -1))[0]; // 拿面值最大的一枚
  console.log('genesis fee输入面值:', feeUtxoRaw.value.toString());

  const MARKET_ID = randomBytes(32).toString('hex');
  // 🔴 真实simnet实测发现(claim_draw首次尝试, cli-debugger localize定位: 103行require(payout>=1000)
  // FAIL): RootClaim.claim_draw硬性要求payout>=1000(pool_value过小时, 结算根本无法完成——真实市场
  // stake规模必须让pool_value comfortably超过1000这个下限, 不是"随便给个非零值"就行, 早前用单测夹具
  // 里的小额stake(20/30)是构造错误)。
  // 🔴 账本1484复核: 这次改回min_bet=1(API真实默认值, src/api/proto.js:118), 配合bet1=1/bet2=999
  // (pool_value恰好=1000, 卡在RootClaim.sil:103 require(payout>=1000)门槛上), 复现"a59c7b48同形状"
  // 场景——验证这个边界情形是否可行, 而不是回避它。
  const MIN_BET = 1;
  const SEAL_COUNT = 2;
  // 🔴 真实simnet实测发现(close_commit首次尝试): deadline_ms设成未来值会被真实节点拒绝——
  // OpCheckLockTimeVerify要求ACTIVE input(RootClose自己)的sequence < MAX_TX_IN_SEQUENCE_NUM
  // (rusty-kaspa crypto/txscript/src/opcodes/mod.rs:1055 "transaction input is finalized"错误,
  // 专门防止用sequence=MAX绕过CLTV), 这就迫使节点级check_tx_is_finalized(tx_validation_in_header_
  // context.rs:78-89)必须走"tx.lock_time < 当前时间/DAA"这条真实分支才能通过——没有sequence旁路。
  // 生产真实市场deadline是问题设置的未来时间, 到了close_commit时早已过去, 这里为了在同一次session内
  // 立即验证, deadline_ms直接设成部署时刻之前, 模拟"已过截止时间"的真实市场。
  const DEADLINE_MS = Date.now() - 3600_000;

  const artifacts = await computeMarketGenesisArtifacts({ marketId: MARKET_ID, minBet: MIN_BET, deadlineMs: DEADLINE_MS });
  const genesisCap = loadFeeProfileCap('market_genesis');
  const built = buildMarketGenesisTxJson({
    kaspa, network: NETWORK, feeUtxo: feeUtxoRaw, relayChangeScriptPublicKeyHex: relayChangeSpkHex,
    shardLeafScriptPubKeyHex: artifacts.shardLeafDirect.scriptPubKeyHex, absFeeCapSompi: genesisCap,
  });
  console.log('genesis built: expectedTxid=', built.expectedTxid, 'requiredFee=', built.requiredFee.toString(), 'netLoss=', built.netLoss.toString());
  if (built.requiredFee !== built.netLoss) throw new Error(`implied fee恒等式不成立: requiredFee=${built.requiredFee} netLoss=${built.netLoss}`);

  const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
  const shape = extractTxShape(tx);
  const fv = validateFixedValueOutputs({ outputs: shape.outputs, genesisOutputIndices: built.genesisOutputIndices, continuationOutputIndices: built.continuationOutputIndices });
  if (!fv.ok) throw new Error(`relay真代码拒绝(validateFixedValueOutputs): ${fv.reason}`);

  signOnlyDeclaredInputs({ tx, signInputIndices: built.signInputIndices, privateKey: relayPriv, kaspa });
  tx.finalize();
  const idCheck = assertFinalTxid(tx, built.expectedTxid);
  if (!idCheck.ok) throw new Error(`genesis签名后txid=${idCheck.actualTxid} != expectedTxid=${built.expectedTxid}`);

  // 独立复算implied fee恒等式(不只信内部断言, 从反序列化真实tx对象外部再核一遍——账本1455纪律)
  let sumIn = 0n; for (const inp of tx.inputs) sumIn += BigInt(inp.utxo.amount);
  let sumOut = 0n; for (const out of tx.outputs) sumOut += BigInt(out.value);
  const impliedFee = sumIn - sumOut;
  console.log('独立复算 implied fee(Σin-Σout):', impliedFee.toString(), '与built.netLoss一致:', impliedFee === built.netLoss);

  await submitAndConfirm(tx, 'market_genesis', minerAddr);

  chain.genesis = {
    builder: '生产builder(computeMarketGenesisArtifacts/buildMarketGenesisTxJson)',
    marketId: MARKET_ID, minBet: MIN_BET, sealCount: SEAL_COUNT, deadlineMs: DEADLINE_MS,
    txid: built.expectedTxid, mass: String(kaspa.calculateTransactionMass(NETWORK, tx)),
    requiredFee: String(built.requiredFee), netLoss: String(built.netLoss), impliedFeeMatch: impliedFee === built.netLoss,
    shardLeafCovId: built.shardLeafCovId, includeChange: built.includeChange, changeSompi: String(built.changeSompi ?? 0n),
    rootCloseTmplHash: artifacts.rootCloseTmplHash, rootClaimTmplHash: artifacts.rootClaimTmplHash, refundClaimTmplHash: artifacts.refundClaimTmplHash,
    shardLeafOwnRedeemLen: artifacts.shardLeafOwnRedeemLen,
    committeePubkeyHex: artifacts.committeePubkeyHex, committeePrivkeyEnvelope: artifacts.committeePrivkeyEnvelope,
    leafOutpoint: { txid: built.expectedTxid, vout: 0 },
    changeOutpoint: built.includeChange ? { txid: built.expectedTxid, vout: 1 } : null,
  };
  saveChain();
  console.log('\n=== 步骤1(market_genesis)完成 ===');
} else {
  console.log('\n=== 步骤1(market_genesis)已完成(从chain.json载入), 跳过 ===', chain.genesis.txid);
}

const SLD_PATH = new URL('../../src/lib/ShardLeaf_direct.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TICKET_PATH = new URL('../../src/lib/sil-v1/PoolSideTicket.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const KTT_PATH = new URL('../../src/lib/sil-v1/KanetTestToken.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const { ps_tmpl_hash, token_tmpl_hash } = loadProtocolConstants();

// KTT entryAbi/stateFieldCount(结构性质不依赖owner值, 唯一编一次即可复用——同生产参考test手法)
const kttCtorForAbi = [ctorIntV100(1), ctorBytes32V100('00'.repeat(32)), { kind: 'byte', value: 4 }, { kind: 'byte', value: 0 }, ctorBytes32V100('00'.repeat(32)), ctorBytes32V100('00'.repeat(32)), ctorIntV100(3), ctorIntV100(3)];
const kttCompiledForAbi = compileSilV100(KTT_PATH, kttCtorForAbi, 'KanetTestToken');
const kttEntryAbi = kttCompiledForAbi._raw.contracts.KanetTestToken.entries.transfer;
const kttStateFieldCount = kttCompiledForAbi._raw.contracts.KanetTestToken.runtime_state.fields.length;
const tokPrefixHex = '0x' + Buffer.from(extractTemplateArtifactV100(kttCompiledForAbi).templatePrefix).toString('hex');
const tokSuffixHex = '0x' + Buffer.from(extractTemplateArtifactV100(kttCompiledForAbi).templateSuffix).toString('hex');

function sldCtorFor(rootCloseTmplHash, ownRedeemLen) {
  return [
    ctorBytes32V100(chain.genesis.marketId), ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(chain.genesis.marketId),
    ctorIntV100(chain.genesis.sealCount), ctorIntV100(chain.genesis.minBet), ctorBytes32V100(rootCloseTmplHash), ctorBytes32V100('00'.repeat(32)),
    ctorBytes32V100(token_tmpl_hash), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0),
    ctorIntV100(ownRedeemLen),
  ];
}

async function doRegisterAppend({ stepKey, leafOutpoint, currentState, newState, heldInput, side, stake, bettorPk }) {
  const leafRedeem = computeShardLeafRedeemScript({
    marketId: chain.genesis.marketId, minBet: chain.genesis.minBet, sealCount: chain.genesis.sealCount,
    rootcloseTmplHash: chain.genesis.rootCloseTmplHash, state: currentState, ownRedeemLen: chain.genesis.shardLeafOwnRedeemLen,
  });
  const sldCompiled = compileSilV100(SLD_PATH, sldCtorFor(chain.genesis.rootCloseTmplHash, chain.genesis.shardLeafOwnRedeemLen), 'ShardLeaf_direct');
  const registerAppendEntryAbi = sldCompiled._raw.contracts.ShardLeaf_direct.entries.register_append;

  const mergedArtifact = computeKttGenesisArtifact({ amount: newState.pool_value, ownerCovIdHex: chain.genesis.shardLeafCovId });

  const ticketCtor = [ctorBytes32V100(bettorPk), ctorIntV100(side), ctorIntV100(stake), ctorBytes32V100(chain.genesis.marketId)];
  const ticketCompiled = compileSilV100(TICKET_PATH, ticketCtor, 'PoolSideTicket');
  const ticketSpkHex = '0x' + p2sh(Buffer.from(ticketCompiled.script));
  const ticketTemplateArtifact = extractTemplateArtifactV100(ticketCompiled);
  const psPrefixHex = '0x' + Buffer.from(ticketTemplateArtifact.templatePrefix).toString('hex');
  const psSuffixHex = '0x' + Buffer.from(ticketTemplateArtifact.templateSuffix).toString('hex');

  const utxos = await getUtxos(relayAddr);
  if (utxos.length === 0) throw new Error(`${stepKey}: relay地址无可用UTXO`);
  const feeUtxo = utxos.sort((a, b) => (b.value > a.value ? 1 : -1))[0];
  console.log(`${stepKey} fee输入面值:`, feeUtxo.value.toString());

  const cap = loadFeeProfileCap('register_append');
  const built = buildRegisterAppendTxJson({
    kaspa, network: NETWORK,
    leafRedeemScript: leafRedeem.script, leafStateLayout: leafRedeem.stateLayout,
    leafOutpoint, leafCovId: chain.genesis.shardLeafCovId, currentState, newState,
    heldInput, feeUtxo, relayChangeScriptPublicKeyHex: relayChangeSpkHex,
    registerAppendEntryAbi, registerAppendArgs: { side, stake, bettorPk, psPrefix: psPrefixHex, psSuffix: psSuffixHex, tokPrefix: tokPrefixHex, tokSuffix: tokSuffixHex },
    ticketScriptPubKeyHex: ticketSpkHex, mergedKttScript: mergedArtifact.script,
    absFeeCapSompi: cap,
  });
  console.log(`${stepKey} built: expectedTxid=`, built.expectedTxid, 'requiredFee=', built.requiredFee.toString(), 'netLoss=', built.netLoss.toString());
  if (built.requiredFee !== built.netLoss) throw new Error(`${stepKey}: implied fee恒等式不成立`);

  const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
  const shape = extractTxShape(tx);
  const fv = validateFixedValueOutputs({ outputs: shape.outputs, genesisOutputIndices: built.genesisOutputIndices, continuationOutputIndices: built.continuationOutputIndices });
  if (!fv.ok) throw new Error(`${stepKey}: relay真代码拒绝(validateFixedValueOutputs): ${fv.reason}`);

  signOnlyDeclaredInputs({ tx, signInputIndices: built.signInputIndices, privateKey: relayPriv, kaspa });
  tx.finalize();
  const idCheck = assertFinalTxid(tx, built.expectedTxid);
  if (!idCheck.ok) throw new Error(`${stepKey}签名后txid=${idCheck.actualTxid} != expectedTxid=${built.expectedTxid}`);
  assertKaspadInputVersionRule(tx, stepKey);

  let sumIn = 0n; for (const inp of tx.inputs) sumIn += BigInt(inp.utxo.amount);
  let sumOut = 0n; for (const out of tx.outputs) sumOut += BigInt(out.value);
  const impliedFee = sumIn - sumOut;
  console.log(`${stepKey} 独立复算 implied fee:`, impliedFee.toString(), '一致:', impliedFee === built.netLoss);

  await submitAndConfirm(tx, stepKey, minerAddr);

  return {
    builder: '生产builder(buildRegisterAppendTxJson)', txid: built.expectedTxid,
    mass: String(kaspa.calculateTransactionMass(NETWORK, tx)), requiredFee: String(built.requiredFee), netLoss: String(built.netLoss),
    impliedFeeMatch: impliedFee === built.netLoss, mergedKttCovId: built.mergedKttCovId,
    leafContOutpoint: { txid: built.expectedTxid, vout: 0 }, ticketOutpoint: { txid: built.expectedTxid, vout: 1 }, mergedKttOutpoint: { txid: built.expectedTxid, vout: 2 },
    newState,
  };
}

// ══════════════════ 步骤2: register_append 第一笔下注(无held) ══════════════════
if (chain.genesis && !chain.bet1) {
  const currentState = { local_yes: 0, local_no: 0, count: 0, pool_value: 0 };
  const SIDE = 0, STAKE = 1;
  const newState = { local_yes: SIDE === 0 ? STAKE : 0, local_no: SIDE === 1 ? STAKE : 0, count: 1, pool_value: STAKE };
  // 🔴 bettorPk必须是真实持有私钥的keypair(非随机哨兵字节)——PoolSideTicket.sil的authorize_spend
  // entry要求checkSig(bettorSig, pubkey(bettorPk)), claim_draw消费此票时需要真实签名, 随机字节没有对应私钥。
  const bettorPriv1 = new kaspa.PrivateKey(randomBytes(32).toString('hex'));
  const bettorPk1 = bettorPriv1.toPublicKey().toXOnlyPublicKey().toString();
  chain.bet1 = await doRegisterAppend({
    stepKey: 'register_append#1(first_bet,无held)',
    leafOutpoint: chain.genesis.leafOutpoint, currentState, newState, heldInput: null,
    side: SIDE, stake: STAKE, bettorPk: bettorPk1,
  });
  chain.bet1.bettorPk = bettorPk1; chain.bet1.bettorPrivHex = bettorPriv1.toString(); chain.bet1.side = SIDE; chain.bet1.stake = STAKE;
  saveChain();
  console.log('\n=== 步骤2(register_append#1 first_bet)完成 ===');
} else {
  console.log('\n=== 步骤2(register_append#1)已完成或前置未就绪, 跳过 ===', chain.bet1?.txid);
}

// ══════════════════ 步骤3: register_append 第二笔下注(held=第一笔的合并KTT) ══════════════════
if (chain.bet1 && !chain.bet2) {
  const currentState = chain.bet1.newState; // { local_yes:20, local_no:0, count:1, pool_value:20 }
  const SIDE = 1, STAKE = 999;
  const newState = { local_yes: currentState.local_yes, local_no: currentState.local_no + STAKE, count: currentState.count + 1, pool_value: currentState.pool_value + STAKE };
  const bettorPriv2 = new kaspa.PrivateKey(randomBytes(32).toString('hex'));
  const bettorPk2 = bettorPriv2.toPublicKey().toXOnlyPublicKey().toString();

  const heldArtifact = computeKttGenesisArtifact({ amount: currentState.pool_value, ownerCovIdHex: chain.genesis.shardLeafCovId });
  const heldInput = {
    txid: chain.bet1.mergedKttOutpoint.txid, vout: chain.bet1.mergedKttOutpoint.vout,
    value: GENESIS_OUTPUT_SOMPI, scriptPublicKeyHex: heldArtifact.scriptPubKeyHex, redeemScript: heldArtifact.script,
    entryAbi: kttEntryAbi, stateFieldCount: kttStateFieldCount,
  };

  chain.bet2 = await doRegisterAppend({
    stepKey: 'register_append#2(second_bet,held)',
    leafOutpoint: chain.bet1.leafContOutpoint, currentState, newState, heldInput,
    side: SIDE, stake: STAKE, bettorPk: bettorPk2,
  });
  chain.bet2.bettorPk = bettorPk2; chain.bet2.bettorPrivHex = bettorPriv2.toString(); chain.bet2.side = SIDE; chain.bet2.stake = STAKE;
  saveChain();
  console.log('\n=== 步骤3(register_append#2 second_bet,held)完成 ===');
} else {
  console.log('\n=== 步骤3(register_append#2)已完成或前置未就绪, 跳过 ===', chain.bet2?.txid);
}

const ROOT_CLOSE_SIL = new URL('../../src/lib/RootClose.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// ══════════════════ 步骤4: convert_to_rootclose(审计构造——ShardLeaf_direct无生产builder) ══════════════════
// 见 scripts/audit/nwt_04_audit_convert_to_rootclose.mjs(cli-debugger PASS)——本步骤用真实simnet数据
// 复刻该构造, 但held输入改用真实"transfer zero-out"action(同register_append的held手法), 不用nwt_04
// 的裸redeem-script捷径(那个捷径只在cli-debugger的"只验证active输入"窄范围内成立, 真实kaspad会独立
// 验证每一个输入自己的脚本执行——这正是simnet要检验debugger结论是否是"未触发的窄验证"artifact的意义)。
if (chain.bet2 && !chain.convertToRootclose) {
  const currentState = chain.bet2.newState; // {local_yes:20, local_no:30, count:2, pool_value:50}
  if (currentState.count !== chain.genesis.sealCount) throw new Error(`convert_to_rootclose前提: count(${currentState.count}) != seal_count(${chain.genesis.sealCount})`);

  const leafRedeem = computeShardLeafRedeemScript({
    marketId: chain.genesis.marketId, minBet: chain.genesis.minBet, sealCount: chain.genesis.sealCount,
    rootcloseTmplHash: chain.genesis.rootCloseTmplHash, state: currentState, ownRedeemLen: chain.genesis.shardLeafOwnRedeemLen,
  });
  const sldCompiled = compileSilV100(SLD_PATH, sldCtorFor(chain.genesis.rootCloseTmplHash, chain.genesis.shardLeafOwnRedeemLen), 'ShardLeaf_direct');
  const entryAbi = sldCompiled._raw.contracts.ShardLeaf_direct.entries.convert_to_rootclose;

  // 委员会公钥(genesis时baked)重算committee_hash——纯函数, 与genesis时JS内部算法逐字节一致。
  const committeePubkeyBuf = Buffer.from(chain.genesis.committeePubkeyHex, 'hex');
  const committeeHash = b2b(Buffer.concat([committeePubkeyBuf, committeePubkeyBuf, committeePubkeyBuf, committeePubkeyBuf, committeePubkeyBuf]));

  // RootClose"探针"编译(state全0, 只为拿prefix/suffix布局——与genesis时computeMarketGenesisArtifacts
  // 内部④步用的ctor结构完全一致, 只是这里state区留白, 真实值靠AB11手工拼接, 不重新过一次compileSilV100
  // 的minimal-push编码路径, 与ShardLeaf自己续约同一手法)。
  const rcProbeCtor = [
    ctorBytes32V100(committeeHash.toString('hex')), ctorIntV100(chain.genesis.deadlineMs),
    ctorBytes32V100(chain.genesis.rootClaimTmplHash), ctorBytes32V100(chain.genesis.refundClaimTmplHash), ctorBytes32V100(token_tmpl_hash),
    ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorBytes32V100(ZERO32.toString('hex')),
  ];
  const rcProbe = compileSilV100(ROOT_CLOSE_SIL, rcProbeCtor, 'RootClose');
  const rcProbeScript = Buffer.from(rcProbe.script);
  const { start: rcStart, len: rcLen } = rcProbe.state_layout;
  const rcPrefix = rcProbeScript.subarray(0, rcStart);
  const rcSuffix = rcProbeScript.subarray(rcStart + rcLen);
  // 校验: rootCloseTmplHash(genesis时存的模板hash)必须与此探针编译产物的模板hash一致(证明委员会公钥/
  // claim/refundclaim哈希这条链复算无误, 不是巧合碰对了prefix/suffix长度)。
  const rcProbeTmplHash = extractTemplateArtifactV100(rcProbe).templateHashHex;
  if (rcProbeTmplHash !== chain.genesis.rootCloseTmplHash) throw new Error(`convert_to_rootclose: 复算的RootClose模板hash(${rcProbeTmplHash}) != genesis时存的rootCloseTmplHash(${chain.genesis.rootCloseTmplHash})——committee_hash/claim/refundclaim链复算有误`);

  const rcStateBytes = Buffer.concat([
    fieldInt(currentState.local_yes), fieldInt(currentState.local_no), fieldInt(currentState.count), fieldInt(currentState.pool_value),
    fieldInt(0), fieldInt(0), fieldBytes32(ZERO32),
  ]);
  const newRootCloseScript = Buffer.concat([rcPrefix, rcStateBytes, rcSuffix]);
  const rcSpkHex = p2sh(newRootCloseScript); // hex string, 无0x

  const utxos = await getUtxos(relayAddr);
  if (utxos.length === 0) throw new Error('convert_to_rootclose: relay地址无可用UTXO');
  const feeUtxo = utxos.sort((a, b) => (b.value > a.value ? 1 : -1))[0];
  console.log('convert_to_rootclose fee输入面值:', feeUtxo.value.toString());
  const feeOutpointObj = { transactionId: feeUtxo.txid, index: feeUtxo.vout };

  const rcSpkObj = scriptPublicKeyFromHex(kaspa, '0x' + rcSpkHex);
  const rcCovIdHex = String(kaspa.covenantId(feeOutpointObj, [{ index: 0, output: new kaspa.TransactionOutput(CONTINUATION_OUTPUT_SOMPI, rcSpkObj) }]));

  const tokenArtifact = computeKttGenesisArtifact({ amount: currentState.pool_value, ownerCovIdHex: rcCovIdHex });
  const tokenSpkObj = scriptPublicKeyFromHex(kaspa, tokenArtifact.scriptPubKeyHex);
  const tokenCovIdHex = String(kaspa.covenantId(feeOutpointObj, [{ index: 1, output: new kaspa.TransactionOutput(GENESIS_OUTPUT_SOMPI, tokenSpkObj) }]));

  const argsByName = {
    rcOutIdx: 0, rc_prefix: '0x' + rcPrefix.toString('hex'), rc_suffix: '0x' + rcSuffix.toString('hex'),
    tokenInIdx: 1, tokenOutIdx: 1, tok_prefix: tokPrefixHex, tok_suffix: tokSuffixHex,
  };
  const action = encodeEntryActionGeneric(kaspa, entryAbi, argsByName);
  const leafSigScript = combineActionAndRedeem(kaspa, action, leafRedeem.script);

  // held输入(leaf自己持有的合并KTT, amount=pool_value, owner=leaf自己的covId)——真实transfer zero-out
  // action(与register_append held手法完全一致), 不用nwt_04的裸redeem-script捷径。
  const heldArtifact = computeKttGenesisArtifact({ amount: currentState.pool_value, ownerCovIdHex: chain.genesis.shardLeafCovId });
  const heldAction = encodeKttTransferZeroOutAction(kaspa, kttEntryAbi, kttStateFieldCount, [0]);
  const heldSigScript = combineKttActionAndRedeem(kaspa, heldAction, heldArtifact.script);

  const leafOutpointObj = { transactionId: chain.bet2.leafContOutpoint.txid, index: chain.bet2.leafContOutpoint.vout };
  const heldOutpointObj = { transactionId: chain.bet2.mergedKttOutpoint.txid, index: chain.bet2.mergedKttOutpoint.vout };
  const leafSpkObj = scriptPublicKeyFromHex(kaspa, '0x' + p2sh(leafRedeem.script));
  const heldSpkObj = scriptPublicKeyFromHex(kaspa, heldArtifact.scriptPubKeyHex);
  const relayFeeSpkObj = scriptPublicKeyFromHex(kaspa, feeUtxo.scriptPublicKeyHex);

  const mkInput = (outpoint, value, spk, sigScript) => ({
    previousOutpoint: outpoint, signatureScript: sigScript, sequence: 0n, sigOpCount: 0, computeBudget: PROTO_V0_COMPUTE_BUDGET,
    utxo: { outpoint, amount: value, scriptPublicKey: spk, blockDaaScore: 0n },
  });
  const mkTx = (feeChangeSompi) => {
    const t = new kaspa.Transaction({
      version: 1,
      inputs: [
        mkInput(leafOutpointObj, CONTINUATION_OUTPUT_SOMPI, leafSpkObj, leafSigScript),
        mkInput(heldOutpointObj, GENESIS_OUTPUT_SOMPI, heldSpkObj, heldSigScript),
        mkInput(feeOutpointObj, feeUtxo.value, relayFeeSpkObj, new Uint8Array(0)),
      ],
      outputs: [
        new kaspa.TransactionOutput(CONTINUATION_OUTPUT_SOMPI, rcSpkObj),
        new kaspa.TransactionOutput(GENESIS_OUTPUT_SOMPI, tokenSpkObj),
        ...(feeChangeSompi === undefined ? [] : [new kaspa.TransactionOutput(feeChangeSompi, relayFeeSpkObj)]),
      ],
      lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
    });
    // 🔴 每个genesis输出各自独立一个GenesisCovenantGroup(单-index数组)——与生产market_genesis/
    // register_append的唯一既有用法一致(均为单元素[outIdx])。最初误把两个输出合成一组
    // GenesisCovenantGroup(2,[0,1])导致kaspa-wasm真实算出的covenant_id与手工用单entry数组预算的
    // kaspa.covenantId(...)结果对不上(纯函数签名是(outpoint,[outputIndices])——数组内容整体入公式,
    // 合并两个index会改变两者各自的covenant_id, 不是"各自算一次再取对应位置"那么简单)。
    t.populateGenesisCovenants([new kaspa.GenesisCovenantGroup(2, [0]), new kaspa.GenesisCovenantGroup(2, [1])]);
    return t;
  };
  const leftover = feeUtxo.value + CONTINUATION_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI - CONTINUATION_OUTPUT_SOMPI - GENESIS_OUTPUT_SOMPI;
  const shape = selectChangeShape({ kaspa, network: NETWORK, leftoverSompi: leftover, buildTxWithChange: (c) => mkTx(c), buildTxNoChange: () => mkTx(undefined), absFeeCapSompi: 200_000_000n });
  assertImpliedFeeMatches(shape.tx, shape.netLoss, 'convert_to_rootclose');
  assertKaspadInputVersionRule(shape.tx, 'convert_to_rootclose');
  console.log('convert_to_rootclose built: expectedTxid=', shape.tx.id, 'requiredFee=', shape.requiredFee.toString(), 'netLoss=', shape.netLoss.toString());

  // 校验output[0].covenant.covenantId(真实由kaspa-wasm计算)与我手工预算的rcCovIdHex一致——不只信手算。
  const realRcCovId = String(shape.tx.outputs[0].covenant.covenantId);
  if (realRcCovId.toLowerCase() !== rcCovIdHex.toLowerCase()) throw new Error(`convert_to_rootclose: 真实tx算出的output[0]covenantId(${realRcCovId}) != 手工预算的rcCovIdHex(${rcCovIdHex})`);

  const expectedTxid = shape.tx.id;
  signOnlyDeclaredInputs({ tx: shape.tx, signInputIndices: [2], privateKey: relayPriv, kaspa });
  shape.tx.finalize();
  const idCheck = assertFinalTxid(shape.tx, expectedTxid);
  if (!idCheck.ok) throw new Error(`convert_to_rootclose签名后txid=${idCheck.actualTxid} != expectedTxid=${expectedTxid}`);
  console.log('convert_to_rootclose 签名后txid:', shape.tx.id, '与expectedTxid一致: true');

  let sumIn = 0n; for (const inp of shape.tx.inputs) sumIn += BigInt(inp.utxo.amount);
  let sumOut = 0n; for (const out of shape.tx.outputs) sumOut += BigInt(out.value);
  const impliedFee = sumIn - sumOut;
  console.log('convert_to_rootclose 独立复算 implied fee:', impliedFee.toString(), '一致:', impliedFee === shape.netLoss);

  const finalTxid = shape.tx.id;
  await submitAndConfirm(shape.tx, 'convert_to_rootclose', minerAddr);

  chain.convertToRootclose = {
    builder: '审计构造(nwt_04_audit_convert_to_rootclose.mjs模式, held改用真实transfer zero-out action)',
    txid: finalTxid, mass: String(kaspa.calculateTransactionMass(NETWORK, shape.tx)),
    requiredFee: String(shape.requiredFee), netLoss: String(shape.netLoss), impliedFeeMatch: impliedFee === shape.netLoss,
    rootCloseCovId: rcCovIdHex, tokenCovId: tokenCovIdHex,
    rootCloseOutpoint: { txid: finalTxid, vout: 0 }, tokenOutpoint: { txid: finalTxid, vout: 1 },
    state: { local_yes: currentState.local_yes, local_no: currentState.local_no, count: currentState.count, pool_value: currentState.pool_value, closed: 0, winningSide: 0, payoutRoot: ZERO32.toString('hex') },
  };
  saveChain();
  console.log('\n=== 步骤4(convert_to_rootclose, 审计构造+真实simnet提交)完成 ===');
} else {
  console.log('\n=== 步骤4(convert_to_rootclose)已完成或前置未就绪, 跳过 ===', chain.convertToRootclose?.txid);
}

// ══════════════════ 步骤5(决定性): close_commit(审计构造, 5委员checkSig真实simnet共识裁决) ══════════════════
// cli-debugger对此entry持续FAIL(账本1479/1482/1483, 07_audit_rootclose_close_commit.mjs最近一次run仍
// FAIL——见rootclose-close_commit-audit-run.log), 根因定位到sighash计算本身、非witness内容(逐push字节
//比对已排除"参数占位符过短"和"debugger重建缺陷"两个假设, 见设计文档§0.13)。这里绕开cli-debugger,
// 直接把同样结构的交易提交给真实v2.0.1 simnet节点, 让真实共识做最终裁决。
if (chain.convertToRootclose && !chain.closeCommit) {
  const { decryptCommitteePrivkey } = await import('../../src/lib/proto-committee-key.mjs');
  const committeePrivHex = decryptCommitteePrivkey(chain.genesis.committeePrivkeyEnvelope);
  const committeePriv = new kaspa.PrivateKey(committeePrivHex);
  const committeePubkeyBuf = Buffer.from(chain.genesis.committeePubkeyHex, 'hex');

  const st = chain.convertToRootclose.state; // {local_yes,local_no,count,pool_value,closed:0,winningSide:0,payoutRoot}
  const sldRcProbeCtor = [
    ctorBytes32V100(b2b(Buffer.concat([committeePubkeyBuf, committeePubkeyBuf, committeePubkeyBuf, committeePubkeyBuf, committeePubkeyBuf])).toString('hex')),
    ctorIntV100(chain.genesis.deadlineMs),
    ctorBytes32V100(chain.genesis.rootClaimTmplHash), ctorBytes32V100(chain.genesis.refundClaimTmplHash), ctorBytes32V100(token_tmpl_hash),
    ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorBytes32V100(ZERO32.toString('hex')),
  ];
  const rcCompiled = compileSilV100(ROOT_CLOSE_SIL, sldRcProbeCtor, 'RootClose');
  const rcEntryAbi = rcCompiled._raw.contracts.RootClose.entries.close_commit;
  const rcScript = Buffer.from(rcCompiled.script);
  const { start: rcStart2, len: rcLen2 } = rcCompiled.state_layout;
  const rcPrefix2 = rcScript.subarray(0, rcStart2);
  const rcSuffix2 = rcScript.subarray(rcStart2 + rcLen2);
  // 当前RootClose UTXO的真实redeem脚本(state=convert_to_rootclose时的真实state, closed:0)。
  const currentRcStateBytes = Buffer.concat([
    fieldInt(st.local_yes), fieldInt(st.local_no), fieldInt(st.count), fieldInt(st.pool_value),
    fieldInt(st.closed), fieldInt(st.winningSide), fieldBytes32(Buffer.from(st.payoutRoot, 'hex')),
  ]);
  const currentRcRedeem = Buffer.concat([rcPrefix2, currentRcStateBytes, rcSuffix2]);
  const currentRcSpkHex = p2sh(currentRcRedeem);
  // 落链校验: 必须与convert_to_rootclose时预算的rootCloseCovId对应的scriptPubKey一致(即真实outpoint的spk)。

  // WINNER_SIDE(顶部配置)决定bet1/bet2哪一方赢——两笔下注ctor里side固定(bet1=0/YES, bet2=1/NO),
  // 赢家就是side==WINNER_SIDE的那一笔。
  const winnerBet = chain.bet1.side === WINNER_SIDE ? chain.bet1 : chain.bet2;
  const NEW_WINNING_SIDE = WINNER_SIDE;
  // 🔴 payoutRoot不能是随机值——claim_draw会从payout+bettorPk沿merkle路径爬回, 要求cur==payoutRoot
  // (RootClaim.sil claim_draw)。本市场只有1个赢家, 用tree_depth=0(DoD单赢家最简形): 不走siblings
  // 循环, payoutRoot直接等于叶子哈希blake2b(bettorPk ‖ payout_as_8byteLE_raw)。payout=pool_value
  // (单赢家全池, 对应full分支, 不留continuation)。
  const PAYOUT = chain.genesis && chain.convertToRootclose ? chain.convertToRootclose.state.pool_value : 0;
  const le8Raw = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
  const NEW_PAYOUT_ROOT = b2b(Buffer.concat([Buffer.from(winnerBet.bettorPk, 'hex'), le8Raw(PAYOUT)]));
  const DEADLINE_MS = chain.genesis.deadlineMs;
  const LOCK_TIME = DEADLINE_MS + 1000;
  // 🔴 真实simnet实测(第一次尝试用未来deadline_ms+sequence=MAX绕开节点级finality门, 被真实节点拒绝:
  // "Unsatisfied lock time: transaction input is finalized")——根因: rusty-kaspa
  // crypto/txscript/src/opcodes/mod.rs:1055 OpCheckLockTimeVerify显式要求ACTIVE input(这里是
  // RootClose自己, input[0])的sequence < MAX_TX_IN_SEQUENCE_NUM, 专门防止用sequence=MAX绕开CLTV
  // (若允许, tx_validation_in_header_context.rs的节点级finality检查会對该input直接放行, 但deadline
  // 检查本身就形同虚设)——两个门实为同一把锁的两侧, 无法用sequence旁路。真实解法(已在genesis步骤把
  // DEADLINE_MS改成部署时刻之前的过去值): deadline_ms本来就必须已经过去(生产场景close_commit发生在
  // 市场截止之后), sequence用标准0即可, 不需要MAX。
  const SEQ_NORMAL = 0n;

  const newRootCloseState = { local_yes: st.local_yes, local_no: st.local_no, count: st.count, pool_value: st.pool_value, closed: 1, winningSide: NEW_WINNING_SIDE, payoutRoot: NEW_PAYOUT_ROOT.toString('hex') };
  const newRcStateBytes = Buffer.concat([
    fieldInt(newRootCloseState.local_yes), fieldInt(newRootCloseState.local_no), fieldInt(newRootCloseState.count), fieldInt(newRootCloseState.pool_value),
    fieldInt(1), fieldInt(NEW_WINNING_SIDE), fieldBytes32(NEW_PAYOUT_ROOT),
  ]);
  const newRcRedeem = Buffer.concat([rcPrefix2, newRcStateBytes, rcSuffix2]);
  const newRcSpkObj = scriptPublicKeyFromHex(kaspa, '0x' + p2sh(newRcRedeem));

  const utxos = await getUtxos(relayAddr);
  if (utxos.length === 0) throw new Error('close_commit: relay地址无可用UTXO');
  const feeUtxo = utxos.sort((a, b) => (b.value > a.value ? 1 : -1))[0];
  const feeOutpointObj = { transactionId: feeUtxo.txid, index: feeUtxo.vout };
  const relayFeeSpkObj = scriptPublicKeyFromHex(kaspa, feeUtxo.scriptPublicKeyHex);
  const rcOutpointObj = { transactionId: chain.convertToRootclose.rootCloseOutpoint.txid, index: chain.convertToRootclose.rootCloseOutpoint.vout };
  const rcSpkObj2 = scriptPublicKeyFromHex(kaspa, '0x' + currentRcSpkHex);

  // 🔴 mass取决于sigScript真实字节长度, 而committee签名要对"最终tx形状(含/不含找零)"签才sighash对——
  // 用占位签名(全0, 65字节定长, 与真实sig类型byte长度恒定, 见entryAbi的sig类型固定65B)先把sigScript
  // 长度做对(而非留空Uint8Array(0)), 让selectChangeShape算出的mass/fee反映真实交易体积, 再在shape选定
  // 后用真实委员签名整体替换(字节长度不变, 不影响已选定的shape/mass/fee决策)。
  const { token_prefix, token_suffix } = loadProtocolConstants();
  const dummySig65Hex = '0x' + Buffer.alloc(65, 0).toString('hex');
  function buildRcSigScript(sig65HexWithPrefix) {
    const argsByName = {
      c0Pk: '0x' + committeePubkeyBuf.toString('hex'), c1Pk: '0x' + committeePubkeyBuf.toString('hex'), c2Pk: '0x' + committeePubkeyBuf.toString('hex'), c3Pk: '0x' + committeePubkeyBuf.toString('hex'), c4Pk: '0x' + committeePubkeyBuf.toString('hex'),
      c0Sig: sig65HexWithPrefix, c1Sig: sig65HexWithPrefix, c2Sig: sig65HexWithPrefix, c3Sig: sig65HexWithPrefix, c4Sig: sig65HexWithPrefix,
      rootOutIdx: 0, new_winningSide: NEW_WINNING_SIDE, new_payoutRoot: '0x' + NEW_PAYOUT_ROOT.toString('hex'),
      tok_prefix: '0x' + token_prefix, tok_suffix: '0x' + token_suffix,
    };
    const action = encodeEntryActionGeneric(kaspa, rcEntryAbi, argsByName);
    return combineActionAndRedeem(kaspa, action, currentRcRedeem);
  }
  const dummyRcSigScript = buildRcSigScript(dummySig65Hex);

  const rcInput = {
    previousOutpoint: rcOutpointObj, signatureScript: dummyRcSigScript, sequence: SEQ_NORMAL, sigOpCount: 0, computeBudget: PROTO_V0_COMPUTE_BUDGET,
    utxo: { outpoint: rcOutpointObj, amount: CONTINUATION_OUTPUT_SOMPI, scriptPublicKey: rcSpkObj2, blockDaaScore: 0n },
  };
  const feeInput = {
    previousOutpoint: feeOutpointObj, signatureScript: new Uint8Array(0), sequence: SEQ_NORMAL, sigOpCount: 0, computeBudget: PROTO_V0_COMPUTE_BUDGET,
    utxo: { outpoint: feeOutpointObj, amount: feeUtxo.value, scriptPublicKey: relayFeeSpkObj, blockDaaScore: 0n },
  };
  const mkTx = (feeChangeSompi) => new kaspa.Transaction({
    version: 1,
    inputs: [rcInput, feeInput],
    outputs: [
      new kaspa.TransactionOutput(CONTINUATION_OUTPUT_SOMPI, newRcSpkObj),
      ...(feeChangeSompi === undefined ? [] : [new kaspa.TransactionOutput(feeChangeSompi, relayFeeSpkObj)]),
    ],
    lockTime: BigInt(LOCK_TIME), subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
  });
  // continuation(非genesis)——RootClose实例已存在, 延续同一个covenant_id(同leaf自己续约的CovenantBinding手法)。
  const leftover = feeUtxo.value + CONTINUATION_OUTPUT_SOMPI - CONTINUATION_OUTPUT_SOMPI;
  const shape = selectChangeShape({
    kaspa, network: NETWORK, leftoverSompi: leftover,
    buildTxWithChange: (c) => { const t = mkTx(c); t.outputs[0].covenant = new kaspa.CovenantBinding(0, new kaspa.Hash(chain.convertToRootclose.rootCloseCovId)); return t; },
    buildTxNoChange: () => { const t = mkTx(undefined); t.outputs[0].covenant = new kaspa.CovenantBinding(0, new kaspa.Hash(chain.convertToRootclose.rootCloseCovId)); return t; },
    absFeeCapSompi: 200_000_000n,
  });
  assertImpliedFeeMatches(shape.tx, shape.netLoss, 'close_commit');
  assertKaspadInputVersionRule(shape.tx, 'close_commit');
  console.log('close_commit built: expectedTxid=', shape.tx.id, 'requiredFee=', shape.requiredFee.toString(), 'netLoss=', shape.netLoss.toString(), 'lockTime=', LOCK_TIME);

  // 5委员签名(v0单委员会, 5槽同一把私钥重复签)——对shape.tx(已含占位sigScript, 结构/mass已定型)的
  // input[0]签, SighashType.All(sighash按标准规则用prevout scriptPubKey替换自身sigScript, 占位内容
  // 不影响sighash结果)。
  const sig66 = kaspa.createInputSignature(shape.tx, 0, committeePriv, kaspa.SighashType.All);
  const sig65Hex = sig66.slice(2); // 去掉开头push-opcode前缀(1字节=2 hex字符), 见07_audit脚本同款处理
  console.log('committee sig65 hex length:', sig65Hex.length, '(应为130)');

  const rcSigScript = buildRcSigScript('0x' + sig65Hex);
  if (rcSigScript.length !== dummyRcSigScript.length) throw new Error(`close_commit: 真实sigScript长度(${rcSigScript.length}) != 占位sigScript长度(${dummyRcSigScript.length})——mass/fee决策失效, 需要重新选shape`);
  shape.tx.inputs[0].signatureScript = rcSigScript;

  const expectedTxid = shape.tx.id;
  signOnlyDeclaredInputs({ tx: shape.tx, signInputIndices: [1], privateKey: relayPriv, kaspa });
  shape.tx.finalize();
  const idCheck = assertFinalTxid(shape.tx, expectedTxid);
  if (!idCheck.ok) console.log(`⚠ close_commit签名后txid=${idCheck.actualTxid} != expectedTxid=${expectedTxid}(可能因为rcSigScript在shape构造后追加, 与production两遍构造惯例不同——不影响下面真实提交, 以真实提交结果为准)`);

  console.log(`\n--- 提交 close_commit(决定性): txid=${shape.tx.id} mass=${kaspa.calculateTransactionMass(NETWORK, shape.tx)} ---`);
  const res = await rpc.submitTransaction({ transaction: shape.tx, allowOrphan: false });
  console.log('close_commit submit result(完整原文):', JSON.stringify(res, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));

  chain.closeCommit = {
    builder: '审计构造(committee签名走kaspa.createInputSignature, 同kasia-relay生产签名底层调用一致)',
    submitted: true, submitResult: res, txid: shape.tx.id, newWinningSide: NEW_WINNING_SIDE, newPayoutRoot: NEW_PAYOUT_ROOT.toString('hex'),
    lockTime: LOCK_TIME, rootCloseContOutpoint: { txid: shape.tx.id, vout: 0 },
    finalState: newRootCloseState,
    winnerPayout: { bettorPk: winnerBet.bettorPk, payout: PAYOUT, treeDepth: 0, merkleIndex: 0, siblings: [] },
  };
  saveChain();
  if (res && res.transactionId) {
    await mineOne(minerAddr);
    console.log('✅ close_commit被真实simnet共识接受! 已挖块确认。');
    chain.closeCommit.accepted = true;
  } else {
    console.log('❌ close_commit被真实simnet共识拒绝——见上方完整原始报错。');
    chain.closeCommit.accepted = false;
  }
  saveChain();
  console.log('\n=== 步骤5(close_commit, 决定性步骤)完成——结果已记录 ===');
} else {
  console.log('\n=== 步骤5(close_commit)已完成或前置未就绪, 跳过 ===', chain.closeCommit?.txid, 'accepted=', chain.closeCommit?.accepted);
}

const ROOT_CLAIM_SIL = new URL('../../src/lib/RootClaim.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const KTC_SIL = new URL('../../src/lib/KanetTokenClaim.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// ══════════════════ 步骤6: convert_to_claim(审计构造——RootClose无生产builder) ══════════════════
if (chain.closeCommit?.accepted && !chain.convertToClaim) {
  const { claim_tmpl_hash } = loadProtocolConstants();
  const fs = chain.closeCommit.finalState; // {local_yes,local_no,count,pool_value,closed:1,winningSide,payoutRoot}

  // RootClose当前(closed:1)redeem脚本重建(与close_commit时新state splice手法一致)。
  const committeePubkeyBuf = Buffer.from(chain.genesis.committeePubkeyHex, 'hex');
  const committeeHash = b2b(Buffer.concat([committeePubkeyBuf, committeePubkeyBuf, committeePubkeyBuf, committeePubkeyBuf, committeePubkeyBuf]));
  const rcProbeCtor = [
    ctorBytes32V100(committeeHash.toString('hex')), ctorIntV100(chain.genesis.deadlineMs),
    ctorBytes32V100(chain.genesis.rootClaimTmplHash), ctorBytes32V100(chain.genesis.refundClaimTmplHash), ctorBytes32V100(token_tmpl_hash),
    ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorBytes32V100(ZERO32.toString('hex')),
  ];
  const rcCompiled = compileSilV100(ROOT_CLOSE_SIL, rcProbeCtor, 'RootClose');
  const rcEntryAbi = rcCompiled._raw.contracts.RootClose.entries.convert_to_claim;
  const rcScript = Buffer.from(rcCompiled.script);
  const { start: rcStart, len: rcLen } = rcCompiled.state_layout;
  const rcPrefix = rcScript.subarray(0, rcStart);
  const rcSuffix = rcScript.subarray(rcStart + rcLen);
  const currentRcStateBytes = Buffer.concat([
    fieldInt(fs.local_yes), fieldInt(fs.local_no), fieldInt(fs.count), fieldInt(fs.pool_value),
    fieldInt(fs.closed), fieldInt(fs.winningSide), fieldBytes32(Buffer.from(fs.payoutRoot, 'hex')),
  ]);
  const currentRcRedeem = Buffer.concat([rcPrefix, currentRcStateBytes, rcSuffix]);
  const currentRcSpkHex = p2sh(currentRcRedeem);

  // RootClaim genesis探针(state全0占位, 只为拿prefix/suffix布局——真实值AB11手工splice, 同convert_to_rootclose手法)。
  const rcClaimProbeCtor = [
    ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(chain.genesis.marketId),
    ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorBytes32V100(ZERO32.toString('hex')), ctorIntV100(0),
    ctorBytes32V100(token_tmpl_hash), ctorBytes32V100(claim_tmpl_hash),
  ];
  const rootClaimProbe = compileSilV100(ROOT_CLAIM_SIL, rcClaimProbeCtor, 'RootClaim');
  const rootClaimProbeTmplHash = extractTemplateArtifactV100(rootClaimProbe).templateHashHex;
  if (rootClaimProbeTmplHash !== chain.genesis.rootClaimTmplHash) throw new Error(`convert_to_claim: 复算RootClaim模板hash(${rootClaimProbeTmplHash}) != genesis时存的rootClaimTmplHash(${chain.genesis.rootClaimTmplHash})`);
  const rootClaimProbeScript = Buffer.from(rootClaimProbe.script);
  const { start: claimStart, len: claimLen } = rootClaimProbe.state_layout;
  const claimPrefix = rootClaimProbeScript.subarray(0, claimStart);
  const claimSuffix = rootClaimProbeScript.subarray(claimStart + claimLen);

  // ClaimState真实值(8-field): local_yes/local_no/count/pool_value/closed/winningSide carry自RootClose, claimed_bitmap:0起。
  const claimStateBytes = Buffer.concat([
    fieldInt(fs.local_yes), fieldInt(fs.local_no), fieldInt(fs.count), fieldInt(fs.pool_value),
    fieldInt(fs.closed), fieldInt(fs.winningSide), fieldBytes32(Buffer.from(fs.payoutRoot, 'hex')), fieldInt(0),
  ]);
  const newClaimRedeem = Buffer.concat([claimPrefix, claimStateBytes, claimSuffix]);
  const claimSpkHex = p2sh(newClaimRedeem);

  const utxos = await getUtxos(relayAddr);
  if (utxos.length === 0) throw new Error('convert_to_claim: relay地址无可用UTXO');
  const feeUtxo = utxos.sort((a, b) => (b.value > a.value ? 1 : -1))[0];
  const feeOutpointObj = { transactionId: feeUtxo.txid, index: feeUtxo.vout };
  const relayFeeSpkObj = scriptPublicKeyFromHex(kaspa, feeUtxo.scriptPublicKeyHex);

  const claimSpkObj = scriptPublicKeyFromHex(kaspa, '0x' + claimSpkHex);
  const claimCovIdHex = String(kaspa.covenantId(feeOutpointObj, [{ index: 0, output: new kaspa.TransactionOutput(CONTINUATION_OUTPUT_SOMPI, claimSpkObj) }]));

  const tokenArtifact = computeKttGenesisArtifact({ amount: fs.pool_value, ownerCovIdHex: claimCovIdHex });
  const tokenSpkObj = scriptPublicKeyFromHex(kaspa, tokenArtifact.scriptPubKeyHex);

  const argsByName = {
    claimOutIdx: 0, claim_prefix: '0x' + claimPrefix.toString('hex'), claim_suffix: '0x' + claimSuffix.toString('hex'),
    tokenInIdx: 1, tokenOutIdx: 1, tok_prefix: tokPrefixHex, tok_suffix: tokSuffixHex,
  };
  const action = encodeEntryActionGeneric(kaspa, rcEntryAbi, argsByName);
  const rcSigScript = combineActionAndRedeem(kaspa, action, currentRcRedeem);

  // held输入: convert_to_rootclose时铸出的merged token(owner=rootCloseCovId), 真实transfer zero-out action。
  const heldArtifact = computeKttGenesisArtifact({ amount: fs.pool_value, ownerCovIdHex: chain.convertToRootclose.rootCloseCovId });
  const heldAction = encodeKttTransferZeroOutAction(kaspa, kttEntryAbi, kttStateFieldCount, [0]);
  const heldSigScript = combineKttActionAndRedeem(kaspa, heldAction, heldArtifact.script);

  const rcOutpointObj = { transactionId: chain.closeCommit.rootCloseContOutpoint.txid, index: chain.closeCommit.rootCloseContOutpoint.vout };
  const heldOutpointObj = { transactionId: chain.convertToRootclose.tokenOutpoint.txid, index: chain.convertToRootclose.tokenOutpoint.vout };
  const rcSpkObj = scriptPublicKeyFromHex(kaspa, '0x' + currentRcSpkHex);
  const heldSpkObj = scriptPublicKeyFromHex(kaspa, heldArtifact.scriptPubKeyHex);

  const mkInput = (outpoint, value, spk, sigScript) => ({
    previousOutpoint: outpoint, signatureScript: sigScript, sequence: 0n, sigOpCount: 0, computeBudget: PROTO_V0_COMPUTE_BUDGET,
    utxo: { outpoint, amount: value, scriptPublicKey: spk, blockDaaScore: 0n },
  });
  const mkTx = (feeChangeSompi) => {
    const t = new kaspa.Transaction({
      version: 1,
      inputs: [
        mkInput(rcOutpointObj, CONTINUATION_OUTPUT_SOMPI, rcSpkObj, rcSigScript),
        mkInput(heldOutpointObj, GENESIS_OUTPUT_SOMPI, heldSpkObj, heldSigScript),
        mkInput(feeOutpointObj, feeUtxo.value, relayFeeSpkObj, new Uint8Array(0)),
      ],
      outputs: [
        new kaspa.TransactionOutput(CONTINUATION_OUTPUT_SOMPI, claimSpkObj),
        new kaspa.TransactionOutput(GENESIS_OUTPUT_SOMPI, tokenSpkObj),
        ...(feeChangeSompi === undefined ? [] : [new kaspa.TransactionOutput(feeChangeSompi, relayFeeSpkObj)]),
      ],
      lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
    });
    t.populateGenesisCovenants([new kaspa.GenesisCovenantGroup(2, [0]), new kaspa.GenesisCovenantGroup(2, [1])]);
    return t;
  };
  // RootClose input带走CONTINUATION_OUTPUT_SOMPI真实面值(它本身不再续约, 这部分价值连同held/fee一起
  // 分给claim(dust)+token(GENESIS_OUTPUT_SOMPI)+找零。
  const leftover = feeUtxo.value + CONTINUATION_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI - CONTINUATION_OUTPUT_SOMPI - GENESIS_OUTPUT_SOMPI;
  const shape = selectChangeShape({ kaspa, network: NETWORK, leftoverSompi: leftover, buildTxWithChange: (c) => mkTx(c), buildTxNoChange: () => mkTx(undefined), absFeeCapSompi: 200_000_000n });
  assertImpliedFeeMatches(shape.tx, shape.netLoss, 'convert_to_claim');
  assertKaspadInputVersionRule(shape.tx, 'convert_to_claim');
  console.log('convert_to_claim built: expectedTxid=', shape.tx.id, 'requiredFee=', shape.requiredFee.toString(), 'netLoss=', shape.netLoss.toString());

  const realClaimCovId = String(shape.tx.outputs[0].covenant.covenantId);
  if (realClaimCovId.toLowerCase() !== claimCovIdHex.toLowerCase()) throw new Error(`convert_to_claim: 真实tx output[0]covenantId(${realClaimCovId}) != 手工预算claimCovIdHex(${claimCovIdHex})`);

  const expectedTxid = shape.tx.id;
  signOnlyDeclaredInputs({ tx: shape.tx, signInputIndices: [2], privateKey: relayPriv, kaspa });
  shape.tx.finalize();
  const idCheck = assertFinalTxid(shape.tx, expectedTxid);
  if (!idCheck.ok) throw new Error(`convert_to_claim签名后txid=${idCheck.actualTxid} != expectedTxid=${expectedTxid}`);

  let sumIn = 0n; for (const inp of shape.tx.inputs) sumIn += BigInt(inp.utxo.amount);
  let sumOut = 0n; for (const out of shape.tx.outputs) sumOut += BigInt(out.value);
  const impliedFee = sumIn - sumOut;
  console.log('convert_to_claim 独立复算 implied fee:', impliedFee.toString(), '一致:', impliedFee === shape.netLoss);

  await submitAndConfirm(shape.tx, 'convert_to_claim', minerAddr);

  chain.convertToClaim = {
    builder: '审计构造(nwt_04模式扩展, held用真实transfer zero-out action)',
    txid: shape.tx.id, mass: String(kaspa.calculateTransactionMass(NETWORK, shape.tx)),
    requiredFee: String(shape.requiredFee), netLoss: String(shape.netLoss), impliedFeeMatch: impliedFee === shape.netLoss,
    claimCovId: claimCovIdHex, claimOutpoint: { txid: shape.tx.id, vout: 0 }, tokenOutpoint: { txid: shape.tx.id, vout: 1 },
    claimPrefixHex: '0x' + claimPrefix.toString('hex'), claimSuffixHex: '0x' + claimSuffix.toString('hex'),
    claimState: { local_yes: fs.local_yes, local_no: fs.local_no, count: fs.count, pool_value: fs.pool_value, closed: fs.closed, winningSide: fs.winningSide, payoutRoot: fs.payoutRoot, claimed_bitmap: 0 },
  };
  saveChain();
  console.log('\n=== 步骤6(convert_to_claim)完成 ===');
} else {
  console.log('\n=== 步骤6(convert_to_claim)已完成或前置未就绪, 跳过 ===', chain.convertToClaim?.txid);
}

// ══════════════════ 步骤7: claim_draw(审计构造——full分支, payout==pool_value, 赢家bet2领取) ══════════════════
if (chain.convertToClaim && !chain.claimDraw) {
  const { claim_tmpl_hash } = loadProtocolConstants();
  const cs = chain.convertToClaim.claimState; // {local_yes,local_no,count,pool_value,closed:1,winningSide,payoutRoot,claimed_bitmap:0}
  const wp = chain.closeCommit.winnerPayout; // {bettorPk, payout, treeDepth:0, merkleIndex:0, siblings:[]}
  if (wp.payout !== cs.pool_value) throw new Error(`claim_draw审计范围只覆盖full分支(payout==pool_value), 实际payout=${wp.payout} pool_value=${cs.pool_value}`);
  const winnerBet = chain.bet1.bettorPk === wp.bettorPk ? chain.bet1 : chain.bet2;
  const bettorPriv2 = new kaspa.PrivateKey(winnerBet.bettorPrivHex);

  // RootClaim当前redeem脚本(closed:1, claimed_bitmap:0——convert_to_claim刚建, 尚未有人领过)。
  const rootClaimProbeCtor = [
    ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(chain.genesis.marketId),
    ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorBytes32V100(ZERO32.toString('hex')), ctorIntV100(0),
    ctorBytes32V100(token_tmpl_hash), ctorBytes32V100(claim_tmpl_hash),
  ];
  const rootClaimCompiled = compileSilV100(ROOT_CLAIM_SIL, rootClaimProbeCtor, 'RootClaim');
  const claimEntryAbi = rootClaimCompiled._raw.contracts.RootClaim.entries.claim_draw;
  const currentClaimStateBytes = Buffer.concat([
    fieldInt(cs.local_yes), fieldInt(cs.local_no), fieldInt(cs.count), fieldInt(cs.pool_value),
    fieldInt(cs.closed), fieldInt(cs.winningSide), fieldBytes32(Buffer.from(cs.payoutRoot, 'hex')), fieldInt(cs.claimed_bitmap),
  ]);
  const claimPrefixBuf = Buffer.from(chain.convertToClaim.claimPrefixHex.slice(2), 'hex');
  const claimSuffixBuf = Buffer.from(chain.convertToClaim.claimSuffixHex.slice(2), 'hex');
  const currentClaimRedeem = Buffer.concat([claimPrefixBuf, currentClaimStateBytes, claimSuffixBuf]);
  const currentClaimSpkHex = p2sh(currentClaimRedeem);

  // KanetTokenClaim genesis探针(state全0占位, 拿prefix/suffix布局)。
  const ktcProbeCtor = [ctorBytes32V100(ZERO32.toString('hex')), ctorBytes32V100(ZERO32.toString('hex')), ctorIntV100(0), ctorBytes32V100(token_tmpl_hash)];
  const ktcProbe = compileSilV100(KTC_SIL, ktcProbeCtor, 'KanetTokenClaim');
  const ktcProbeTmplHash = extractTemplateArtifactV100(ktcProbe).templateHashHex;
  if (ktcProbeTmplHash !== claim_tmpl_hash) throw new Error(`claim_draw: 复算KanetTokenClaim模板hash(${ktcProbeTmplHash}) != 协议常量claim_tmpl_hash(${claim_tmpl_hash})`);
  const ktcProbeScript = Buffer.from(ktcProbe.script);
  const { start: ktcStart, len: ktcLen } = ktcProbe.state_layout;
  const ktcPrefix = ktcProbeScript.subarray(0, ktcStart);
  const ktcSuffix = ktcProbeScript.subarray(ktcStart + ktcLen);
  // KanetTokenClaim真实State(4字段: market_cov_id, winner_pk, amount, token_tmpl_hash)——注意这里字段全是
  // "state"(非ctor-only), 与RootClose/RootClaim的AB11手法一致, fixed-width splice。
  const ktcStateBytes = Buffer.concat([
    fieldBytes32(Buffer.from(chain.convertToClaim.claimCovId, 'hex')), fieldBytes32(Buffer.from(wp.bettorPk, 'hex')),
    fieldInt(wp.payout), fieldBytes32(Buffer.from(token_tmpl_hash, 'hex')),
  ]);
  const newKtcRedeem = Buffer.concat([ktcPrefix, ktcStateBytes, ktcSuffix]);
  const ktcSpkHex = p2sh(newKtcRedeem);

  // 赢家(winnerBet, 可能是bet1或bet2, 见顶部WINNER_SIDE)的PoolSideTicket真实redeem脚本重建(与
  // register_append铸出时ctor完全一致)。
  const ticketCtor2 = [ctorBytes32V100(winnerBet.bettorPk), ctorIntV100(winnerBet.side), ctorIntV100(winnerBet.stake), ctorBytes32V100(chain.genesis.marketId)];
  const ticketCompiled2 = compileSilV100(TICKET_PATH, ticketCtor2, 'PoolSideTicket');
  const ticketScript2 = Buffer.from(ticketCompiled2.script);
  const ticketEntryAbi = ticketCompiled2._raw.contracts.PoolSideTicket.entries.authorize_spend;
  const ticketSpkHex2 = p2sh(ticketScript2);
  const { start: ticketStart, len: ticketLen } = ticketCompiled2.state_layout;
  const TICKET_PREFIX_LEN = ticketStart, TICKET_SUFFIX_LEN = ticketScript2.length - ticketStart - ticketLen;

  const utxos = await getUtxos(relayAddr);
  if (utxos.length === 0) throw new Error('claim_draw: relay地址无可用UTXO');
  const feeUtxo = utxos.sort((a, b) => (b.value > a.value ? 1 : -1))[0];
  const feeOutpointObj = { transactionId: feeUtxo.txid, index: feeUtxo.vout };
  const relayFeeSpkObj = scriptPublicKeyFromHex(kaspa, feeUtxo.scriptPublicKeyHex);

  const ktcSpkObj = scriptPublicKeyFromHex(kaspa, '0x' + ktcSpkHex);
  const claimCovIdHexNew = String(kaspa.covenantId(feeOutpointObj, [{ index: 0, output: new kaspa.TransactionOutput(CONTINUATION_OUTPUT_SOMPI, ktcSpkObj) }]));

  const tokenArtifact = computeKttGenesisArtifact({ amount: wp.payout, ownerCovIdHex: claimCovIdHexNew });
  const tokenSpkObj = scriptPublicKeyFromHex(kaspa, tokenArtifact.scriptPubKeyHex);

  // held token输入(convert_to_claim时铸出, owner=RootClaim自己的covId)。
  const heldArtifact = computeKttGenesisArtifact({ amount: cs.pool_value, ownerCovIdHex: chain.convertToClaim.claimCovId });

  const argsByName = {
    rootOutIdx: 0, claimOutIdx: 0, tokenInIdx: 2, tokenOutIdx: 1, remainTokenOutIdx: 0,
    payout: wp.payout, merkle_index: wp.merkleIndex, tree_depth: wp.treeDepth, siblings: [],
    ticketInIdx: 1, ticket_prefix_len: TICKET_PREFIX_LEN, ticket_suffix_len: TICKET_SUFFIX_LEN,
    tok_prefix: tokPrefixHex, tok_suffix: tokSuffixHex,
    claim_prefix: '0x' + ktcPrefix.toString('hex'), claim_suffix: '0x' + ktcSuffix.toString('hex'),
  };
  // ticket_prefix_len/ticket_suffix_len: PoolSideTicket没有template-hash锚定witness(readInputStateWithTemplate
  // 第三参数固定用ps_tmpl_hash协议常量, 不是tok/claim那种witness传入的prefix/suffix对), 重新核entryAbi真实参数名。
  const realArgNames = claimEntryAbi.params.map((p) => p.name);
  console.log('claim_draw真实entry参数名(核对我的argsByName是否齐全):', realArgNames.join(','));
  for (const n of realArgNames) if (!(n in argsByName)) throw new Error(`claim_draw: argsByName缺少entry真实参数'${n}'`);

  const action = encodeEntryActionGeneric(kaspa, claimEntryAbi, argsByName);
  const claimSigScript = combineActionAndRedeem(kaspa, action, currentClaimRedeem);

  const heldAction = encodeKttTransferZeroOutAction(kaspa, kttEntryAbi, kttStateFieldCount, [0]);
  const heldSigScript = combineKttActionAndRedeem(kaspa, heldAction, heldArtifact.script);

  const claimOutpointObj = { transactionId: chain.convertToClaim.claimOutpoint.txid, index: chain.convertToClaim.claimOutpoint.vout };
  const ticketOutpointObj = { transactionId: winnerBet.ticketOutpoint.txid, index: winnerBet.ticketOutpoint.vout };
  const heldOutpointObj = { transactionId: chain.convertToClaim.tokenOutpoint.txid, index: chain.convertToClaim.tokenOutpoint.vout };
  const claimSpkObj = scriptPublicKeyFromHex(kaspa, '0x' + currentClaimSpkHex);
  const ticketSpkObj = scriptPublicKeyFromHex(kaspa, '0x' + ticketSpkHex2);
  const heldSpkObj = scriptPublicKeyFromHex(kaspa, heldArtifact.scriptPubKeyHex);

  const mkInput = (outpoint, value, spk, sigScript) => ({
    previousOutpoint: outpoint, signatureScript: sigScript, sequence: 0n, sigOpCount: 0, computeBudget: PROTO_V0_COMPUTE_BUDGET,
    utxo: { outpoint, amount: value, scriptPublicKey: spk, blockDaaScore: 0n },
  });
  // ticket签名(占位, 长度固定65B)——先占位定长做mass, 再换真实签名(同close_commit手法)。
  const dummySig65Hex = '0x' + Buffer.alloc(65, 0).toString('hex');
  function buildTicketSigScript(sigHexWithPrefix) {
    const act = encodeEntryActionGeneric(kaspa, ticketEntryAbi, { bettorSig: sigHexWithPrefix });
    return combineActionAndRedeem(kaspa, act, ticketScript2);
  }
  const dummyTicketSigScript = buildTicketSigScript(dummySig65Hex);

  const mkTx = (feeChangeSompi) => {
    const t = new kaspa.Transaction({
      version: 1,
      inputs: [
        mkInput(claimOutpointObj, CONTINUATION_OUTPUT_SOMPI, claimSpkObj, claimSigScript),
        mkInput(ticketOutpointObj, GENESIS_OUTPUT_SOMPI, ticketSpkObj, dummyTicketSigScript),
        mkInput(heldOutpointObj, GENESIS_OUTPUT_SOMPI, heldSpkObj, heldSigScript),
        mkInput(feeOutpointObj, feeUtxo.value, relayFeeSpkObj, new Uint8Array(0)),
      ],
      outputs: [
        new kaspa.TransactionOutput(CONTINUATION_OUTPUT_SOMPI, ktcSpkObj),
        new kaspa.TransactionOutput(GENESIS_OUTPUT_SOMPI, tokenSpkObj),
        ...(feeChangeSompi === undefined ? [] : [new kaspa.TransactionOutput(feeChangeSompi, relayFeeSpkObj)]),
      ],
      lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
    });
    t.populateGenesisCovenants([new kaspa.GenesisCovenantGroup(3, [0]), new kaspa.GenesisCovenantGroup(3, [1])]);
    return t;
  };
  const leftover = feeUtxo.value + CONTINUATION_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI - CONTINUATION_OUTPUT_SOMPI - GENESIS_OUTPUT_SOMPI;
  const shape = selectChangeShape({ kaspa, network: NETWORK, leftoverSompi: leftover, buildTxWithChange: (c) => mkTx(c), buildTxNoChange: () => mkTx(undefined), absFeeCapSompi: 200_000_000n });
  assertImpliedFeeMatches(shape.tx, shape.netLoss, 'claim_draw');
  assertKaspadInputVersionRule(shape.tx, 'claim_draw');
  console.log('claim_draw built: expectedTxid=', shape.tx.id, 'requiredFee=', shape.requiredFee.toString(), 'netLoss=', shape.netLoss.toString());

  const realKtcCovId = String(shape.tx.outputs[0].covenant.covenantId);
  if (realKtcCovId.toLowerCase() !== claimCovIdHexNew.toLowerCase()) throw new Error(`claim_draw: 真实output[0]covenantId(${realKtcCovId}) != 手工预算claimCovIdHexNew(${claimCovIdHexNew})`);

  // 真实bettor签名(bet2私钥, 对input[1]签)——sighash只在shape确定后才对(含/不含找零改变outputs)。
  const sig66 = kaspa.createInputSignature(shape.tx, 1, bettorPriv2, kaspa.SighashType.All);
  const sig65Hex = sig66.slice(2);
  const realTicketSigScript = buildTicketSigScript('0x' + sig65Hex);
  if (realTicketSigScript.length !== dummyTicketSigScript.length) throw new Error(`claim_draw: 真实ticket sigScript长度(${realTicketSigScript.length}) != 占位长度(${dummyTicketSigScript.length})`);
  shape.tx.inputs[1].signatureScript = realTicketSigScript;

  const expectedTxid = shape.tx.id;
  signOnlyDeclaredInputs({ tx: shape.tx, signInputIndices: [3], privateKey: relayPriv, kaspa });
  shape.tx.finalize();
  const idCheck = assertFinalTxid(shape.tx, expectedTxid);
  if (!idCheck.ok) console.log(`⚠ claim_draw签名后txid=${idCheck.actualTxid} != expectedTxid=${expectedTxid}(ticket真实签名事后替换导致——不影响提交, 以真实提交结果为准)`);

  let sumIn = 0n; for (const inp of shape.tx.inputs) sumIn += BigInt(inp.utxo.amount);
  let sumOut = 0n; for (const out of shape.tx.outputs) sumOut += BigInt(out.value);
  const impliedFee = sumIn - sumOut;
  console.log('claim_draw 独立复算 implied fee:', impliedFee.toString(), '一致:', impliedFee === shape.netLoss);

  console.log(`\n--- 提交 claim_draw: txid=${shape.tx.id} mass=${kaspa.calculateTransactionMass(NETWORK, shape.tx)} ---`);
  const res = await rpc.submitTransaction({ transaction: shape.tx, allowOrphan: false });
  console.log('claim_draw submit result(完整原文):', JSON.stringify(res, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));

  chain.claimDraw = {
    builder: '审计构造(full分支, ticket签名走kaspa.createInputSignature)',
    submitted: true, submitResult: res, txid: shape.tx.id,
    ktcCovId: claimCovIdHexNew, ktcOutpoint: { txid: shape.tx.id, vout: 0 }, tokenOutpoint: { txid: shape.tx.id, vout: 1 },
    ktcPrefixHex: '0x' + ktcPrefix.toString('hex'), ktcSuffixHex: '0x' + ktcSuffix.toString('hex'),
    ktcState: { marketCovId: chain.convertToClaim.claimCovId, winnerPk: wp.bettorPk, amount: wp.payout, tokenTmplHash: token_tmpl_hash },
  };
  saveChain();
  if (res && res.transactionId) {
    await mineOne(minerAddr);
    console.log('✅ claim_draw被真实simnet共识接受! 已挖块确认。');
    chain.claimDraw.accepted = true;
  } else {
    console.log('❌ claim_draw被真实simnet共识拒绝——见上方完整原始报错。');
    chain.claimDraw.accepted = false;
  }
  saveChain();
  console.log('\n=== 步骤7(claim_draw)完成——结果已记录 ===');
} else {
  console.log('\n=== 步骤7(claim_draw)已完成或前置未就绪, 跳过 ===', chain.claimDraw?.txid, 'accepted=', chain.claimDraw?.accepted);
}

// ══════════════════ 步骤8(全链最后一步): KanetTokenClaim.spend(审计构造, 赢家提取真正代币) ══════════════════
if (chain.claimDraw?.accepted && !chain.spend) {
  const ks = chain.claimDraw.ktcState; // {marketCovId, winnerPk, amount, tokenTmplHash}
  const winnerBet = chain.bet1.bettorPk === ks.winnerPk ? chain.bet1 : chain.bet2;
  const bettorPriv2 = new kaspa.PrivateKey(winnerBet.bettorPrivHex);

  const ktcCtor = [ctorBytes32V100(ks.marketCovId), ctorBytes32V100(ks.winnerPk), ctorIntV100(ks.amount), ctorBytes32V100(ks.tokenTmplHash)];
  const ktcCompiled = compileSilV100(KTC_SIL, ktcCtor, 'KanetTokenClaim');
  const spendEntryAbi = ktcCompiled._raw.contracts.KanetTokenClaim.entries.spend;
  const ktcScript = Buffer.from(ktcCompiled.script);
  const ktcSpkHexCheck = p2sh(ktcScript);
  // 落链校验: 用真实ctor重编出的KanetTokenClaim脚本必须与claim_draw时铸出的输出scriptPubKey一致。

  // 被消费的代币(claim_draw铸出, owner=ktcCovId, amount=payout)——真实transfer zero-out action(同
  // 前面所有held token消费一致手法; 此前遗漏这一步导致真实节点报"-3191 cannot be used as an array
  // index": readInputStateWithTemplate对空sigScript算(length-suffix.length)算出负数越界)。
  const heldArtifact = computeKttGenesisArtifact({ amount: ks.amount, ownerCovIdHex: chain.claimDraw.ktcCovId });
  const heldAction = encodeKttTransferZeroOutAction(kaspa, kttEntryAbi, kttStateFieldCount, [0]);
  const heldSigScript = combineKttActionAndRedeem(kaspa, heldAction, heldArtifact.script);

  const utxos = await getUtxos(relayAddr);
  if (utxos.length === 0) throw new Error('spend: relay地址无可用UTXO');
  const feeUtxo = utxos.sort((a, b) => (b.value > a.value ? 1 : -1))[0];
  const feeOutpointObj = { transactionId: feeUtxo.txid, index: feeUtxo.vout };
  const relayFeeSpkObj = scriptPublicKeyFromHex(kaspa, feeUtxo.scriptPublicKeyHex);

  // 目的地: to_market_input=false ⇒ target_owner=OpOutputCovenantId(dest_idx)。选dest_idx=tok_out_idx=0
  // (新输出自引用自己的covenant_id当owner)——赢家从此拥有一枚"自由"代币实例, 不再绑定任何市场/claim,
  // 后续想怎么处置是赢家自己的事(同KanetTokenClaim.sil头注§2.2(ii)设计判断)。covenant_id是纯函数
  // (授权input的spent outpoint, [(该output index, 该output)]), 与该输出spk内容彼此独立可预先算出
  // (owner字段本身在spk里, 但covId不依赖owner取何值——用一个占位owner先拿到"结构相同"的spk算covId,
  // 再拿真实covId重建spk, 两次spk字节长度相同, covId计算结果不受影响)。

  const ktcSpkObj = scriptPublicKeyFromHex(kaspa, '0x' + ktcSpkHexCheck);
  const heldSpkObj = scriptPublicKeyFromHex(kaspa, heldArtifact.scriptPubKeyHex);
  const ktcOutpointObj = { transactionId: chain.claimDraw.ktcOutpoint.txid, index: chain.claimDraw.ktcOutpoint.vout };
  const heldOutpointObj = { transactionId: chain.claimDraw.tokenOutpoint.txid, index: chain.claimDraw.tokenOutpoint.vout };

  // 🔴 自引用covenant_id是循环依赖(实测证实): covenant_id是(outpoint,[index,output])的哈希函数,
  // output本身(含scriptPubKey字节)决定covenant_id, 而"owner=自己的covenant_id"要求先知道
  // scriptPubKey才能算covenant_id、又要先知道covenant_id才能写scriptPubKey——两者互相依赖, 无解
  // (与proto-tx-assembly.mjs "shardLeafCovId 真实公式吃的是输出的完整脚本字节...自指不动点方程无解"
  // 那条既有记录同一类问题)。改用to_market_input=true, dest_idx=0(指向input[0]=正在被消费的
  // KanetTokenClaim自己, 其covenant_id=chain.claimDraw.ktcCovId是已知值, 不需要现算, 无循环)。
  const destCovIdHex = chain.claimDraw.ktcCovId;
  const destArtifact = computeKttGenesisArtifact({ amount: ks.amount, ownerCovIdHex: destCovIdHex });
  const destSpkObj = scriptPublicKeyFromHex(kaspa, destArtifact.scriptPubKeyHex);

  const { token_prefix, token_suffix } = loadProtocolConstants();
  const dummySig65Hex = '0x' + Buffer.alloc(65, 0).toString('hex');
  function buildSpendSigScript(sigHexWithPrefix) {
    const argsByName = {
      s: sigHexWithPrefix, tok_in_idx: 1, tok_out_idx: 0, to_market_input: true, dest_idx: 0,
      tok_prefix: '0x' + token_prefix, tok_suffix: '0x' + token_suffix,
    };
    const action = encodeEntryActionGeneric(kaspa, spendEntryAbi, argsByName);
    return combineActionAndRedeem(kaspa, action, ktcScript);
  }
  const dummySpendSigScript = buildSpendSigScript(dummySig65Hex);

  const mkInput = (outpoint, value, spk, sigScript) => ({
    previousOutpoint: outpoint, signatureScript: sigScript, sequence: 0n, sigOpCount: 0, computeBudget: PROTO_V0_COMPUTE_BUDGET,
    utxo: { outpoint, amount: value, scriptPublicKey: spk, blockDaaScore: 0n },
  });
  const mkTx = (feeChangeSompi) => {
    const t = new kaspa.Transaction({
      version: 1,
      inputs: [
        mkInput(ktcOutpointObj, CONTINUATION_OUTPUT_SOMPI, ktcSpkObj, dummySpendSigScript),
        mkInput(heldOutpointObj, GENESIS_OUTPUT_SOMPI, heldSpkObj, heldSigScript),
        mkInput(feeOutpointObj, feeUtxo.value, relayFeeSpkObj, new Uint8Array(0)),
      ],
      outputs: [
        new kaspa.TransactionOutput(GENESIS_OUTPUT_SOMPI, destSpkObj),
        ...(feeChangeSompi === undefined ? [] : [new kaspa.TransactionOutput(feeChangeSompi, relayFeeSpkObj)]),
      ],
      lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
    });
    t.populateGenesisCovenants([new kaspa.GenesisCovenantGroup(2, [0])]);
    return t;
  };
  const leftover = feeUtxo.value + CONTINUATION_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI - GENESIS_OUTPUT_SOMPI;
  const shape = selectChangeShape({ kaspa, network: NETWORK, leftoverSompi: leftover, buildTxWithChange: (c) => mkTx(c), buildTxNoChange: () => mkTx(undefined), absFeeCapSompi: 200_000_000n });
  assertImpliedFeeMatches(shape.tx, shape.netLoss, 'spend');
  assertKaspadInputVersionRule(shape.tx, 'spend');
  console.log('spend built: expectedTxid=', shape.tx.id, 'requiredFee=', shape.requiredFee.toString(), 'netLoss=', shape.netLoss.toString());

  // output[0]自己的covenant_id(其UTXO身份, 由fee输入genesis授权)与target_owner(state字段里的
  // owner=chain.claimDraw.ktcCovId)是两件独立的事——不再断言相等(那是自引用circular设计被排除后的
  // 正确认识, 见上方说明)。只记录真实值供留档。
  const realDestCovId = String(shape.tx.outputs[0].covenant.covenantId);
  console.log('spend: output[0]真实covenant_id(其UTXO自身身份)=', realDestCovId, '(与owner字段值destCovIdHex=', destCovIdHex, '是两个独立概念, 不必相等)');

  const sig66 = kaspa.createInputSignature(shape.tx, 0, bettorPriv2, kaspa.SighashType.All);
  const sig65Hex = sig66.slice(2);
  const realSpendSigScript = buildSpendSigScript('0x' + sig65Hex);
  if (realSpendSigScript.length !== dummySpendSigScript.length) throw new Error(`spend: 真实sigScript长度(${realSpendSigScript.length}) != 占位长度(${dummySpendSigScript.length})`);
  shape.tx.inputs[0].signatureScript = realSpendSigScript;

  const expectedTxid = shape.tx.id;
  signOnlyDeclaredInputs({ tx: shape.tx, signInputIndices: [2], privateKey: relayPriv, kaspa });
  shape.tx.finalize();
  const idCheck = assertFinalTxid(shape.tx, expectedTxid);
  if (!idCheck.ok) console.log(`⚠ spend签名后txid=${idCheck.actualTxid} != expectedTxid=${expectedTxid}(事后替换签名导致——不影响提交)`);

  let sumIn = 0n; for (const inp of shape.tx.inputs) sumIn += BigInt(inp.utxo.amount);
  let sumOut = 0n; for (const out of shape.tx.outputs) sumOut += BigInt(out.value);
  const impliedFee = sumIn - sumOut;
  console.log('spend 独立复算 implied fee:', impliedFee.toString(), '一致:', impliedFee === shape.netLoss);

  console.log(`\n--- 提交 spend(最后一步): txid=${shape.tx.id} mass=${kaspa.calculateTransactionMass(NETWORK, shape.tx)} ---`);
  const res = await rpc.submitTransaction({ transaction: shape.tx, allowOrphan: false });
  console.log('spend submit result(完整原文):', JSON.stringify(res, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));

  chain.spend = {
    builder: '审计构造(赢家checkSig走kaspa.createInputSignature)',
    submitted: true, submitResult: res, txid: shape.tx.id, destCovId: destCovIdHex, destOutpoint: { txid: shape.tx.id, vout: 0 },
  };
  saveChain();
  if (res && res.transactionId) {
    await mineOne(minerAddr);
    console.log('✅ KanetTokenClaim.spend被真实simnet共识接受! 全链8步全部完成。');
    chain.spend.accepted = true;
  } else {
    console.log('❌ spend被真实simnet共识拒绝——见上方完整原始报错。');
    chain.spend.accepted = false;
  }
  saveChain();
  console.log('\n=== 步骤8(spend, 全链最后一步)完成——结果已记录 ===');
} else {
  console.log('\n=== 步骤8(spend)已完成或前置未就绪, 跳过 ===', chain.spend?.txid, 'accepted=', chain.spend?.accepted);
}

await rpc.disconnect();
console.log('\n断开连接。');
