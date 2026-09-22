// proto-settlement-ops.test.mjs — 批9 9-2b(iii-2): 四步 builder 入参装配(ops)+ 整条驱动链的【离线端到端】。
// 真 kaspa-wasm + 真编译 + 真 builder(genesis → append×2 → seal → close_commit → convert_to_claim → claim_draw)+ 真 store / 真指针 / 真 C1 / 真意图状态机 + 真核心;
// 唯一的假件是"链"和 relay: 一个内存 UTXO 集(按交易 apply)+ 假 sendCmd(get_address_utxos facts / covenant_broadcast / check_utxo_landed / get_past_median_time)。
// 🟡 诚实边界: 这证明"ops 装出的入参能让四个真 builder 构造成功、C1 / 指针 / 记账 / 出口 S9 全程自洽"; 【不】证明节点共识接受这些交易(那是 9-4 simnet 端到端的事), 也不签名(relay 才签 fee 输入)。
// Run: cd kasia-console && node src/lib/proto-settlement-ops.test.mjs
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_OPS_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_settle_ops_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_OPS_TEST_BOOTSTRAPPED: '1', PROTO_RELAY_ID: 'ops-test-relay' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
const kaspa = await import('kaspa-wasm');
const { sqlite } = await import('../db/client.js');
const { buildMarketGenesisTxJson, buildRegisterAppendTxJson, scriptPublicKeyFromHex } = await import('./proto-tx-assembly.mjs');
const { computeMarketGenesisArtifacts, computeShardLeafRedeemScript, computeKttGenesisArtifact, computeTicketGenesisArtifact, computeRootCloseGenesisArtifact, loadProtocolConstants, p2sh } = await import('./proto-covenant-builder.mjs');
const { freezeMarket } = await import('./proto-settlement-freeze.mjs');
const { compileSilV100, ctorBytes32V100, ctorIntV100 } = await import('./pool-bshard-artifacts.mjs');
const { extractTemplateArtifactV100 } = await import('./pool-template-artifact.mjs');
const SI = await import('./proto-settlement-intent.mjs');
const OPS = await import('./proto-settlement-ops.mjs');
const { buildProductionDriver } = await import('../services/proto-settlement-driver.mjs');
const { isValidSettlementIntentKey } = await import('./proto-relay-ipc.mjs');
const { stripComments } = await import('../../../shared/test-fixtures/source-scan/scan-non-test-sources.mjs');

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + (e.stack || e.message).split('\n').slice(0, 4).join(' | ')); } };
const NETWORK = 'mainnet';
const T0 = '2026-09-20T00:00:00.000Z';

// ── 钱包 / relay ──
const relayPriv = new kaspa.PrivateKey(randomBytes(32).toString('hex'));
const relayAddr = relayPriv.toPublicKey().toAddress(NETWORK).toString();
const relaySpkHex = '0x' + kaspa.payToAddressScript(new kaspa.Address(relayAddr)).script;
const spkAddress = (hex) => kaspa.addressFromScriptPublicKey(new kaspa.ScriptPublicKey(0, String(hex).replace(/^0x/, '')), NETWORK).toString();

// ── 内存链 ──
const chain = new Map();                                    // "txid:index" → { amount, scriptHex, covenantId }
const landedTx = new Set();
function applyTx(txJson) {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(txJson); tx.finalize();
  try {
    const id = String(tx.id).toLowerCase();
    for (const i of tx.inputs) chain.delete(`${String(i.previousOutpoint.transactionId).toLowerCase()}:${Number(i.previousOutpoint.index)}`);
    tx.outputs.forEach((o, idx) => chain.set(`${id}:${idx}`, { amount: BigInt(o.value), scriptHex: String(o.scriptPublicKey.script).toLowerCase(), covenantId: o.covenant ? String(o.covenant.covenantId).toLowerCase() : null }));
    landedTx.add(id);
    return id;
  } finally { tx.free(); }
}
const item = (key, e) => { const [txid, idx] = key.split(':'); return { outpoint: { transactionId: txid, index: Number(idx) }, amount: e.amount.toString(), scriptPublicKey: { version: 0, scriptHex: e.scriptHex }, covenantId: e.covenantId }; };
const broadcasts = [];
let pmtOverride = null;
const fakeSendCmd = async (relayId, cmd) => {
  if (cmd.type === 'get_address_utxos') {
    assert.equal(cmd.facts, true);
    const atAddr = [...chain.entries()].filter(([, e]) => spkAddress(e.scriptHex) === cmd.address);
    if (cmd.outpoints) {
      const wanted = new Map(cmd.outpoints.map((o) => [`${o.transactionId}:${o.index}`, o]));
      const found = atAddr.filter(([k]) => wanted.has(k)).map(([k, e]) => item(k, e));
      const foundKeys = new Set(found.map((f) => `${f.outpoint.transactionId}:${f.outpoint.index}`));
      return { ok: true, facts: true, factsVersion: 1, form: 'outpoints', found, missing: [...wanted.values()].filter((o) => !foundKeys.has(`${o.transactionId}:${o.index}`)).map((o) => ({ transactionId: o.transactionId, index: o.index })) };
    }
    const min = BigInt(cmd.minAmount), max = BigInt(cmd.maxAmount);
    const utxos = atAddr.filter(([, e]) => e.amount >= min && e.amount <= max).sort((a, b) => (a[1].amount < b[1].amount ? 1 : -1)).map(([k, e]) => item(k, e));
    return { ok: true, facts: true, factsVersion: 1, form: 'list', utxos, truncated: false };
  }
  if (cmd.type === 'covenant_broadcast') {
    const tx = kaspa.Transaction.deserializeFromSafeJSON(cmd.tx_json); tx.finalize(); const id = String(tx.id).toLowerCase();
    const inputKeys = tx.inputs.map((i) => `${String(i.previousOutpoint.transactionId).toLowerCase()}:${Number(i.previousOutpoint.index)}`);
    tx.free();
    if (id !== cmd.expected_txid) return { ok: false, error: `expected_txid mismatch ${id} != ${cmd.expected_txid}`, code: 'txid_mismatch' };
    SI.recordSettlementIntentPhase({ intentKey: cmd.intent_key, phase: 'prepared', txid: id, txJson: JSON.stringify([cmd.tx_json]) });     // 真 relay 在广播前把 prepared 回执落 console(现有机制); 形状与 relay covenant-broadcast-relay.mjs ingestPhase 逐字一致: JSON.stringify([txJson])(9-4 simnet 实测: 此前这里存裸串, 与真写入方不一致 ⇒ 离线端到端没抓到 pointers 的形状 bug)
    // F4 真实争用测试(账本1622)需要的最小真实性: 任一输入 outpoint 已不在虚拟 UTXO 集里(已被另一笔更早
    // "落链"的交易花掉)⇒ 拒绝, 镜像真实 kaspad 的行为(missing/spent input, 不是"双花被节点接受")——这堵
    // 拒绝墙本身才是 NO TX NO STATE 最终不丢钱的保证; F4 的两层预留是"减少撞上这堵墙的次数", 不是唯一防线,
    // 此前这个假 relay 没有模拟这堵墙, 会让"两边都真实广播成功"这种在真节点上不可能发生的情形被静默放过。
    const missing = inputKeys.filter((k) => !chain.has(k));
    if (missing.length) return { ok: false, error: `missing/spent input(s): ${missing.join(',')}`, code: 'inputs_spent' };
    broadcasts.push({ intentKey: cmd.intent_key, txid: id, cmd });
    applyTx(cmd.tx_json);
    return { ok: true, txId: id };
  }
  if (cmd.type === 'check_utxo_landed') {   // 真 relay 的 check_utxo_landed: 该 txid 在【目标地址】上有一个未花费输出才算 landed(所以 prepare 的 targetAddress 算错会让这里永远 false)
    const at = [...chain.entries()].some(([k, e]) => k.startsWith(cmd.txid + ':') && spkAddress(e.scriptHex) === cmd.address);
    return landedTx.has(cmd.txid) && at ? { landed: true, depth: 30 } : { landed: false, depth: 0 };
  }
  if (cmd.type === 'get_past_median_time') return pmtOverride || { ok: true, pastMedianTimeMs: Date.now(), observedAtMs: Date.now() };
  throw new Error('fakeSendCmd: 未处理的命令 ' + cmd.type);
};

// ── 真实建链: genesis → append×2(bettor_pk = 委员公钥: v0 规则, claim_draw 用委员私钥签 ticket)──
const MARKET_ID = 'cd'.repeat(32), MIN_BET = 5, DEADLINE_MS = Date.now() - 200_000, SEAL_COUNT = 2;   // deadline 刚过 200 s: pmt 领先约 200 s ∈ [30 s, 1 h) ⇒ 放行且不触发 SLA 报警
const genesis = await computeMarketGenesisArtifacts({ marketId: MARKET_ID, minBet: MIN_BET, deadlineMs: DEADLINE_MS });
const COMMITTEE_PK = genesis.committeePubkeyHex;
const consts = loadProtocolConstants();
const genesisFee = { txid: 'ee'.repeat(32), vout: 0, value: 10_000_000_000n, scriptPublicKeyHex: relaySpkHex };
const genesisBuilt = buildMarketGenesisTxJson({ kaspa, network: NETWORK, feeUtxo: genesisFee, relayChangeScriptPublicKeyHex: relaySpkHex, shardLeafScriptPubKeyHex: genesis.shardLeafDirect.scriptPubKeyHex, absFeeCapSompi: 80_000_000n });
const leafCovId = genesisBuilt.shardLeafCovId;
const SLD_PATH = new URL('./ShardLeaf_direct.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TICKET_PATH = new URL('./sil-v1/PoolSideTicket.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const KTT_PATH = new URL('./sil-v1/KanetTestToken.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const sldCtorFor = (s) => [ctorBytes32V100(MARKET_ID), ctorBytes32V100(consts.ps_tmpl_hash), ctorBytes32V100(MARKET_ID), ctorIntV100(SEAL_COUNT), ctorIntV100(MIN_BET), ctorBytes32V100(genesis.rootCloseTmplHash), ctorBytes32V100('00'.repeat(32)), ctorBytes32V100(consts.token_tmpl_hash), ctorIntV100(s.local_yes), ctorIntV100(s.local_no), ctorIntV100(s.count), ctorIntV100(s.pool_value), ctorIntV100(genesis.shardLeafOwnRedeemLen)];
const kttCtorForAbi = [{ kind: 'int', value: 1 }, { kind: 'bytes', value: [...Buffer.alloc(32)] }, { kind: 'byte', value: 4 }, { kind: 'byte', value: 0 }, { kind: 'bytes', value: [...Buffer.alloc(32)] }, { kind: 'bytes', value: [...Buffer.alloc(32)] }, { kind: 'int', value: 3 }, { kind: 'int', value: 3 }];
const kttCompiled = compileSilV100(KTT_PATH, kttCtorForAbi, 'KanetTestToken');
const kttEntryAbi = kttCompiled._raw.contracts.KanetTestToken.entries.transfer;
const kttStateFieldCount = kttCompiled._raw.contracts.KanetTestToken.runtime_state.fields.length;
const tokPrefixHex = '0x' + Buffer.from(extractTemplateArtifactV100(kttCompiled).templatePrefix).toString('hex');
const tokSuffixHex = '0x' + Buffer.from(extractTemplateArtifactV100(kttCompiled).templateSuffix).toString('hex');

function doRegisterAppend({ side, stake, currentState, heldInput, leafOutpoint, feeTxid }) {
  const newState = { local_yes: currentState.local_yes + (side === 0 ? stake : 0), local_no: currentState.local_no + (side === 1 ? stake : 0), count: currentState.count + 1, pool_value: currentState.pool_value + stake };
  const leafRedeem = computeShardLeafRedeemScript({ marketId: MARKET_ID, minBet: MIN_BET, sealCount: SEAL_COUNT, rootcloseTmplHash: genesis.rootCloseTmplHash, state: currentState, ownRedeemLen: genesis.shardLeafOwnRedeemLen });
  const registerAppendEntryAbi = compileSilV100(SLD_PATH, sldCtorFor(currentState), 'ShardLeaf_direct')._raw.contracts.ShardLeaf_direct.entries.register_append;
  const merged = computeKttGenesisArtifact({ amount: newState.pool_value, ownerCovIdHex: leafCovId });
  const ticket = compileSilV100(TICKET_PATH, [{ kind: 'bytes', value: [...Buffer.from(COMMITTEE_PK, 'hex')] }, { kind: 'int', value: side }, { kind: 'int', value: stake }, { kind: 'bytes', value: [...Buffer.from(MARKET_ID, 'hex')] }], 'PoolSideTicket');
  const tt = extractTemplateArtifactV100(ticket);
  const built = buildRegisterAppendTxJson({
    kaspa, network: NETWORK, leafRedeemScript: leafRedeem.script, leafStateLayout: leafRedeem.stateLayout, leafOutpoint, leafCovId, currentState, newState, heldInput,
    feeUtxo: { txid: feeTxid, vout: 0, value: 10_000_000_000n, scriptPublicKeyHex: relaySpkHex }, relayChangeScriptPublicKeyHex: relaySpkHex,
    registerAppendEntryAbi, registerAppendArgs: { side, stake, bettorPk: COMMITTEE_PK, psPrefix: '0x' + Buffer.from(tt.templatePrefix).toString('hex'), psSuffix: '0x' + Buffer.from(tt.templateSuffix).toString('hex'), tokPrefix: tokPrefixHex, tokSuffix: tokSuffixHex },
    ticketScriptPubKeyHex: '0x' + p2sh(Buffer.from(ticket.script)), mergedKttScript: merged.script, absFeeCapSompi: 100_000_000n,
  });
  return { built, newState, merged };
}
const bet1 = doRegisterAppend({ side: 0, stake: 600, currentState: { local_yes: 0, local_no: 0, count: 0, pool_value: 0 }, heldInput: null, leafOutpoint: { txid: genesisBuilt.expectedTxid, vout: 0 }, feeTxid: 'd1'.repeat(32) });
const bet2 = doRegisterAppend({
  side: 1, stake: 700, currentState: bet1.newState, leafOutpoint: { txid: bet1.built.expectedTxid, vout: 0 }, feeTxid: 'd2'.repeat(32),
  heldInput: { txid: bet1.built.expectedTxid, vout: 2, value: 20_000_000n, scriptPublicKeyHex: bet1.merged.scriptPubKeyHex, redeemScript: bet1.merged.script, entryAbi: kttEntryAbi, stateFieldCount: kttStateFieldCount },
});

// ── 种 DB + 链 ──
sqlite.prepare('INSERT INTO proto_token_defs (id,name,ticker,created_at) VALUES (?,?,?,?)').run('tok1', 'Test', 'TST', T0);
sqlite.prepare(`INSERT INTO proto_markets (id, token_def_id, question, deadline_ms, min_bet, seal_count, committee_pubkeys_json, committee_privkey_enc, rootclose_tmpl_hash, shardleaf_txid, shardleaf_vout, status, created_at, updated_at)
  VALUES (?, 'tok1', 'q', ?, ?, ?, ?, ?, ?, ?, 0, 'betting', ?, ?)`).run(MARKET_ID, DEADLINE_MS, MIN_BET, SEAL_COUNT, JSON.stringify([COMMITTEE_PK, '11'.repeat(32), '22'.repeat(32), '33'.repeat(32), '44'.repeat(32)]), genesis.committeePrivkeyEnvelope, genesis.rootCloseTmplHash, genesisBuilt.expectedTxid, T0, T0);
sqlite.prepare('UPDATE proto_markets SET shardleaf_cov_id = ?, shardleaf_own_redeem_len = ? WHERE id = ?').run(leafCovId, genesis.shardLeafOwnRedeemLen, MARKET_ID);
for (const [b, side, stake, n] of [[bet1, 0, 600, 1], [bet2, 1, 700, 2]]) {
  const betId = randomBytes(32).toString('hex');
  sqlite.prepare("INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, ticket_txid, ticket_vout, status, created_at, confirmed_at) VALUES (?,?,?,?,?,?,?, 'confirmed', ?, ?)").run(betId, MARKET_ID, COMMITTEE_PK, side, stake, b.built.expectedTxid, 1, T0, `2026-09-20T00:00:0${n}.000Z`);
  sqlite.prepare("INSERT INTO proto_bet_intents (intent_key, bet_id, step, status, prepared_txid, prepared_tx_json, submitted_txid, landed_at, created_at, updated_at) VALUES (?,?,'append','landed',?,?,?,?,?,?)")
    .run(`proto-bet:${betId}:append`, betId, b.built.expectedTxid, JSON.stringify([b.built.txJson]), b.built.expectedTxid, `2026-09-20T00:00:0${n}.000Z`, T0, T0);
}
for (const tx of [genesisBuilt.txJson, bet1.built.txJson, bet2.built.txJson]) applyTx(tx);
chain.set(`${'f1'.repeat(32)}:0`, { amount: 90_000_000n, scriptHex: relaySpkHex.slice(2).toLowerCase(), covenantId: null });     // relay 的 fee UTXO(≤ 1 KAS 签名输入上限, ≥ 各步 fee 上限)
chain.set(`${'f2'.repeat(32)}:0`, { amount: 95_000_000n, scriptHex: relaySpkHex.slice(2).toLowerCase(), covenantId: null });
chain.set(`${'f3'.repeat(32)}:0`, { amount: 99_000_000n, scriptHex: relaySpkHex.slice(2).toLowerCase(), covenantId: null });
chain.set(`${'f4'.repeat(32)}:0`, { amount: 99_500_000n, scriptHex: relaySpkHex.slice(2).toLowerCase(), covenantId: null });

const driver = await buildProductionDriver({ health: { address: relayAddr }, network: NETWORK, ops: OPS, kaspa, sendCmd: fakeSendCmd, relayId: 'ops-test-relay', tickIntervalMs: 60_000 });
const state = () => sqlite.prepare('SELECT status, winning_side FROM proto_markets WHERE id = ?').get(MARKET_ID);
const intentStatus = (st, id, step) => (sqlite.prepare('SELECT status FROM proto_settlement_intents WHERE subject_type = ? AND subject_id = ? AND step = ?').get(st, id, step) || {}).status;
const errEvents = () => sqlite.prepare("SELECT event_type, summary FROM events WHERE source = 'proto-settlement-intent' AND level = 'error'").all();

// ── prepare 单元 ──
await t('prepare(seal): 预期 spk(leaf / held)与链上 UTXO 一致; targetAddress 是 seal 输出0 的 RootClose(closed:0)地址; feeMinAmount = fee profile cap; 只读(不写任何表)', async () => {
  const before = sqlite.prepare('SELECT COUNT(*) c FROM proto_settlement_intents').get().c;
  const p = await OPS.prepare('seal', { phase: 'inputs', marketId: MARKET_ID, subjectId: MARKET_ID, kaspa, network: NETWORK, pointers: { roles: {} }, relaySpkHex });
  assert.ok(p.targetAddress.startsWith('kaspa:')); assert.equal(typeof p.feeMinAmount, 'bigint'); assert.deepEqual(p.inflightOutpoints, []); assert.equal(p.deadlineMs, DEADLINE_MS);
  const leafUtxo = chain.get(`${bet2.built.expectedTxid}:0`), heldUtxo = chain.get(`${bet2.built.expectedTxid}:2`);
  assert.equal(p.expectedSpks.leaf.replace(/^0x/, ''), leafUtxo.scriptHex); assert.equal(p.expectedSpks.held.replace(/^0x/, ''), heldUtxo.scriptHex);
  assert.equal(sqlite.prepare('SELECT COUNT(*) c FROM proto_settlement_intents').get().c, before);
  const t2 = await OPS.prepare('seal', { phase: 'target', marketId: MARKET_ID, subjectId: MARKET_ID, kaspa, network: NETWORK }); assert.equal(t2.targetAddress, p.targetAddress); assert.equal(t2.feeMinAmount, undefined);
  await assert.rejects(() => OPS.prepare('withdraw', { phase: 'target', subjectId: MARKET_ID, kaspa, network: NETWORK }), /未知步骤/);
});

// ── 整条驱动链(真核心 + 真 store + 真 ops + 真 builder + 假链)──
const seen = [];
async function tickUntil(cond, max = 6) { for (let i = 0; i < max; i++) { const o = await driver.runTick({ cap: 5 }); seen.push(o); if (cond()) return o; } throw new Error('未在 ' + max + ' 个 tick 内到达: ' + JSON.stringify(seen.slice(-2).map((x) => x.results))); }
await t('E2E-1 seal: 一个 tick 真构造 + 广播(intent_key 过出口 S9); 下一 tick 对账 landed ⇒ 市场 betting → sealed; 无 error 报警', async () => {
  await tickUntil(() => broadcasts.length === 1, 2);
  assert.equal(broadcasts[0].intentKey, `settle:market:${MARKET_ID}:seal`); assert.ok(isValidSettlementIntentKey(broadcasts[0].intentKey));
  assert.deepEqual(broadcasts[0].cmd.genesis_output_indices, [0, 1]); assert.deepEqual(broadcasts[0].cmd.sign_input_indices, [2]);
  await tickUntil(() => state().status === 'sealed', 3);
  assert.equal(intentStatus('market', MARKET_ID, 'seal'), 'landed'); assert.deepEqual(errEvents(), [], JSON.stringify(errEvents()));
});
await t('E2E-2 close_commit: 操作员未写 winning_side ⇒ 不触发; 写入后 ⇒ pmt 门放行(读 relay 的 pmt)、真构造、广播; 对账后 sealed → resolved + win claim 行(64 位 hex, 过出口)+ convert_to_claim 意图', async () => {
  const idle = await driver.runTick({ cap: 5 }); assert.equal(idle.actioned, 0, '无 winning_side 不触发任何动作');
  sqlite.prepare("UPDATE proto_markets SET winning_side = 0, winning_side_source = 'operator', winning_side_set_at = ? WHERE id = ? AND winning_side IS NULL").run(new Date().toISOString(), MARKET_ID);   // v212 R1: 受控写必须带 source + set_at
  await tickUntil(() => broadcasts.some((b) => b.intentKey === `settle:market:${MARKET_ID}:resolve`), 2);
  const cc = broadcasts.find((b) => b.intentKey === `settle:market:${MARKET_ID}:resolve`); assert.deepEqual(cc.cmd.continuation_output_indices, [0]); assert.ok(isValidSettlementIntentKey(cc.intentKey));
  await tickUntil(() => state().status === 'resolved', 3);
  const claim = sqlite.prepare("SELECT * FROM proto_claims WHERE market_id = ?").all(MARKET_ID); assert.equal(claim.length, 1); assert.match(claim[0].id, /^[0-9a-f]{64}$/); assert.equal(claim[0].amount, 1300); assert.equal(claim[0].bettor_pk, COMMITTEE_PK);
  for (const step of ['convert_to_claim', 'claim_draw']) assert.ok(isValidSettlementIntentKey(SI.settlementIntentKeyFor('claim', claim[0].id, step)), step);
  assert.equal(intentStatus('claim', claim[0].id, 'convert_to_claim') !== undefined, true); assert.deepEqual(errEvents(), [], JSON.stringify(errEvents()));
});
await t('E2E-3 convert_to_claim → claim_draw: 真构造(ticket 由委员私钥信封签, 驱动层不碰私钥)、广播、对账; 终态: claim 行记 claim_txid / vout / claimed_at; 四步意图全 landed; 全程无 error 报警', async () => {
  const claimId = sqlite.prepare('SELECT id FROM proto_claims WHERE market_id = ?').get(MARKET_ID).id;
  await tickUntil(() => sqlite.prepare('SELECT claim_txid FROM proto_claims WHERE id = ?').get(claimId).claim_txid !== null, 8);
  const claim = sqlite.prepare('SELECT * FROM proto_claims WHERE id = ?').get(claimId);
  const drawBroadcast = broadcasts.find((b) => b.intentKey === `settle:claim:${claimId}:claim_draw`); assert.ok(drawBroadcast);
  assert.equal(claim.claim_txid, drawBroadcast.txid); assert.equal(claim.claim_vout, 0); assert.ok(claim.claimed_at);
  assert.equal(intentStatus('market', MARKET_ID, 'seal'), 'landed'); assert.equal(intentStatus('market', MARKET_ID, 'resolve'), 'landed'); assert.equal(intentStatus('claim', claimId, 'convert_to_claim'), 'landed'); assert.equal(intentStatus('claim', claimId, 'claim_draw'), 'landed');
  assert.deepEqual(broadcasts.map((b) => b.intentKey.split(':')[3]), ['seal', 'resolve', 'convert_to_claim', 'claim_draw']);
  for (const b of broadcasts) assert.ok(isValidSettlementIntentKey(b.intentKey), b.intentKey);
  assert.deepEqual(errEvents(), [], JSON.stringify(errEvents()));
  const idle = await driver.runTick({ cap: 5 }); assert.equal(idle.actioned, 0, '终态后无任何后续动作(不重复广播)'); assert.equal(broadcasts.length, 4);
});

// ══════════════ F4 真实争用: refund_flip 与创世/结算跨入口争同一最佳 fee UTXO(Bettor 裁定, 账本1622 追问) ══════════════
// 不是单元测试用假 selectFeeUtxoByConstruction 模拟——三个真实生产函数(driver.advanceStep 跑真 ops.build,
// buildMarketGenesisAndBroadcast 是创世的真实生产函数)用 Promise.all 真并发, 在同一个进程里共享
// proto-fee-reservation.mjs 的模块级预留状态(两层都是单例, 不是每次注入新实例)。下注(register_append)与
// 创世共用同一份 fetchFeeCandidates + selectAndReserveFeeUtxo 代码(proto-broadcast-ops.mjs 两个调用点结构
// 相同, 已在 proto-broadcast-ops.test.mjs F3b-1/F3b-4 分别验证过), 本测试不重复起第四个下注场景, 用创世代表
// 这一族(genesis/bet 在 F4 里是同一段代码, 不是两套独立实现)。
{
  const { buildMarketGenesisAndBroadcast } = await import('./proto-broadcast-ops.mjs');
  const { ensureMarketPending } = await import('./proto-market-intent.mjs');
  const NOW = Date.now();
  const RF_GRACE_MS = 7_200_000 + 30_000;   // REFUND_FLIP_GRACE_MS(2h, proto-close-commit-gate.mjs)+ CLOSE_COMMIT_PMT_MARGIN_MS(30s)

  // 通用: 真实建一个"创世+两笔下注都已落链"的市场(与文件顶部 MARKET_ID 的建法同构, 参数化), 复用模块级
  // 的 KTT 模板产物(kttEntryAbi/kttStateFieldCount/tokPrefixHex/tokSuffixHex 与 marketId 无关)。
  async function freshMarketWithAppends({ deadlineMs, stakes = [600, 700] }) {
    const marketId = randomBytes(32).toString('hex');
    const art = await computeMarketGenesisArtifacts({ marketId, minBet: MIN_BET, deadlineMs });
    const gBuilt = buildMarketGenesisTxJson({ kaspa, network: NETWORK, feeUtxo: { txid: randomBytes(32).toString('hex'), vout: 0, value: 10_000_000_000n, scriptPublicKeyHex: relaySpkHex }, relayChangeScriptPublicKeyHex: relaySpkHex, shardLeafScriptPubKeyHex: art.shardLeafDirect.scriptPubKeyHex, absFeeCapSompi: 80_000_000n });
    const covId = gBuilt.shardLeafCovId;
    const sldCtor = (s) => [ctorBytes32V100(marketId), ctorBytes32V100(consts.ps_tmpl_hash), ctorBytes32V100(marketId), ctorIntV100(SEAL_COUNT), ctorIntV100(MIN_BET), ctorBytes32V100(art.rootCloseTmplHash), ctorBytes32V100('00'.repeat(32)), ctorBytes32V100(consts.token_tmpl_hash), ctorIntV100(s.local_yes), ctorIntV100(s.local_no), ctorIntV100(s.count), ctorIntV100(s.pool_value), ctorIntV100(art.shardLeafOwnRedeemLen)];
    function doAppend({ side, stake, currentState, heldInput, leafOutpoint }) {
      const newState = { local_yes: currentState.local_yes + (side === 0 ? stake : 0), local_no: currentState.local_no + (side === 1 ? stake : 0), count: currentState.count + 1, pool_value: currentState.pool_value + stake };
      const leafRedeem = computeShardLeafRedeemScript({ marketId, minBet: MIN_BET, sealCount: SEAL_COUNT, rootcloseTmplHash: art.rootCloseTmplHash, state: currentState, ownRedeemLen: art.shardLeafOwnRedeemLen });
      const registerAppendEntryAbi = compileSilV100(SLD_PATH, sldCtor(currentState), 'ShardLeaf_direct')._raw.contracts.ShardLeaf_direct.entries.register_append;
      const merged = computeKttGenesisArtifact({ amount: newState.pool_value, ownerCovIdHex: covId });
      const ticket = compileSilV100(TICKET_PATH, [{ kind: 'bytes', value: [...Buffer.from(art.committeePubkeyHex, 'hex')] }, { kind: 'int', value: side }, { kind: 'int', value: stake }, { kind: 'bytes', value: [...Buffer.from(marketId, 'hex')] }], 'PoolSideTicket');
      const tt = extractTemplateArtifactV100(ticket);
      const built = buildRegisterAppendTxJson({
        kaspa, network: NETWORK, leafRedeemScript: leafRedeem.script, leafStateLayout: leafRedeem.stateLayout, leafOutpoint, leafCovId: covId, currentState, newState, heldInput,
        feeUtxo: { txid: randomBytes(32).toString('hex'), vout: 0, value: 10_000_000_000n, scriptPublicKeyHex: relaySpkHex }, relayChangeScriptPublicKeyHex: relaySpkHex,
        registerAppendEntryAbi, registerAppendArgs: { side, stake, bettorPk: art.committeePubkeyHex, psPrefix: '0x' + Buffer.from(tt.templatePrefix).toString('hex'), psSuffix: '0x' + Buffer.from(tt.templateSuffix).toString('hex'), tokPrefix: tokPrefixHex, tokSuffix: tokSuffixHex },
        ticketScriptPubKeyHex: '0x' + p2sh(Buffer.from(ticket.script)), mergedKttScript: merged.script, absFeeCapSompi: 100_000_000n,
      });
      return { built, newState, merged };
    }
    const a1 = doAppend({ side: 0, stake: stakes[0], currentState: { local_yes: 0, local_no: 0, count: 0, pool_value: 0 }, heldInput: null, leafOutpoint: { txid: gBuilt.expectedTxid, vout: 0 } });
    const a2 = doAppend({ side: 1, stake: stakes[1], currentState: a1.newState, leafOutpoint: { txid: a1.built.expectedTxid, vout: 0 },
      heldInput: { txid: a1.built.expectedTxid, vout: 2, value: 20_000_000n, scriptPublicKeyHex: a1.merged.scriptPubKeyHex, redeemScript: a1.merged.script, entryAbi: kttEntryAbi, stateFieldCount: kttStateFieldCount } });
    for (const tx of [gBuilt.txJson, a1.built.txJson, a2.built.txJson]) applyTx(tx);
    sqlite.prepare(`INSERT INTO proto_markets (id, token_def_id, question, deadline_ms, min_bet, seal_count, committee_pubkeys_json, committee_privkey_enc, rootclose_tmpl_hash, shardleaf_txid, shardleaf_vout, shardleaf_cov_id, shardleaf_own_redeem_len, status, created_at, updated_at)
      VALUES (?, 'tok1', 'q', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'betting', ?, ?)`).run(marketId, deadlineMs, MIN_BET, SEAL_COUNT, JSON.stringify([art.committeePubkeyHex]), art.committeePrivkeyEnvelope, art.rootCloseTmplHash, gBuilt.expectedTxid, covId, art.shardLeafOwnRedeemLen, T0, T0);
    let n = 0;
    for (const [b, side, stake] of [[a1, 0, stakes[0]], [a2, 1, stakes[1]]]) {
      n++; const betId = randomBytes(32).toString('hex');
      sqlite.prepare("INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, ticket_txid, ticket_vout, status, created_at, confirmed_at) VALUES (?,?,?,?,?,?,?, 'confirmed', ?, ?)").run(betId, marketId, art.committeePubkeyHex, side, stake, b.built.expectedTxid, 1, T0, `2026-09-22T00:00:0${n}.000Z`);
      sqlite.prepare("INSERT INTO proto_bet_intents (intent_key, bet_id, step, status, prepared_txid, prepared_tx_json, submitted_txid, landed_at, created_at, updated_at) VALUES (?,?,'append','landed',?,?,?,?,?,?)")
        .run(`proto-bet:${betId}:append`, betId, b.built.expectedTxid, JSON.stringify([b.built.txJson]), b.built.expectedTxid, `2026-09-22T00:00:0${n}.000Z`, T0, T0);
    }
    return marketId;
  }

  const X = await freshMarketWithAppends({ deadlineMs: NOW - 200_000 });          // 供 'seal'
  const Y = await freshMarketWithAppends({ deadlineMs: NOW - RF_GRACE_MS - 60_000 }); // 供 'refund_flip'(已超 2h+30s grace)

  await t('F4 前置: Y 真实推进到 sealed 并冻结(refund_flip 的两个前置条件: seal 意图 landed + 已冻结)', async () => {
    await tickUntil(() => sqlite.prepare('SELECT status FROM proto_markets WHERE id=?').get(Y).status === 'sealed', 3);
    freezeMarket({ db: sqlite, marketId: Y, reason: 'inconsistent_verdicts', pmt: null, wallMs: Date.now(), log: { log() {}, warn() {}, error() {} } });
    assert.equal(intentStatus('market', Y, 'seal'), 'landed');
  });

  await t('F4 真实争用①(结算跨入口): X 的 seal 与 Y 的 refund_flip 用 Promise.all 真并发(driver.advanceStep, 真 ops.build, 真 selectAndReserveFeeUtxo), 候选池只留一枚"最佳"候选 ⇒ 它最多被一笔真实广播的交易花掉(绝不双花); 断言只钉这一个不变量, 不钉"哪一方赢"或"总共几笔广播成功"——构造成功一方若产生找零输出, 会给另一方腾出一枚全新候选, 双方都成功是合法结局, 唯一不合法的是同一个 outpoint 被两笔不同交易同时声称花掉', async () => {
    for (const k of [...chain.keys()]) { const e = chain.get(k); if (e.scriptHex === relaySpkHex.slice(2).toLowerCase() && e.covenantId === null) chain.delete(k); }   // 清空其余 relay UTXO, 只留下面这一枚
    const sharedTxid = randomBytes(32).toString('hex');
    chain.set(`${sharedTxid}:0`, { amount: 97_000_000n, scriptHex: relaySpkHex.slice(2).toLowerCase(), covenantId: null });
    const beforeCount = broadcasts.length;
    const [rSeal, rRf] = await Promise.all([
      driver.advanceStep({ step: 'seal', subjectId: X, marketId: X }),
      driver.advanceStep({ step: 'refund_flip', subjectId: Y, marketId: Y }),
    ]);
    const newBroadcasts = broadcasts.slice(beforeCount);
    // 核心不变量: 每笔真实广播的交易互不重叠花费同一个 outpoint(不止对 sharedTxid, 对全部 outpoint 都成立——
    // 这正是 covenant_broadcast 的"missing/spent input"拒绝墙在赋能测试用假 relay 里也生效之后该有的样子)。
    const allSpent = newBroadcasts.flatMap((b) => JSON.parse(b.cmd.tx_json).inputs.map((i) => i.transactionId));
    const dup = allSpent.filter((v, i) => allSpent.indexOf(v) !== i);
    assert.deepEqual(dup, [], `不该有任何 outpoint 被两笔广播同时花掉, 实际重复: ${JSON.stringify(dup)}; 全部广播=${JSON.stringify(newBroadcasts.map((b) => b.intentKey))}`);
    const sharedSpentCount = allSpent.filter((t2) => t2 === sharedTxid).length;
    assert.ok(sharedSpentCount <= 1, `共享候选(${sharedTxid.slice(0, 12)}…)最多只能被一笔真实交易花掉, 实际出现 ${sharedSpentCount} 次`);
    assert.ok([rSeal.outcome, rRf.outcome].includes('submitted'), `至少一方成功(否则整个测试没测到任何真实构造), 实际 ${JSON.stringify([rSeal.outcome, rRf.outcome])}`);
  });

  const Z = randomBytes(32).toString('hex');
  const zArt = await computeMarketGenesisArtifacts({ marketId: Z, minBet: MIN_BET, deadlineMs: NOW - 200_000 });
  ensureMarketPending({ id: Z, token_def_id: 'tok1', question: 'q-Z', deadline_ms: NOW - 200_000, min_bet: MIN_BET, seal_count: SEAL_COUNT, committee_pubkeys_json: JSON.stringify([zArt.committeePubkeyHex]), committee_privkey_enc: zArt.committeePrivkeyEnvelope, rootclose_tmpl_hash: zArt.rootCloseTmplHash, shardleaf_own_redeem_len: zArt.shardLeafOwnRedeemLen });
  const Y2 = await freshMarketWithAppends({ deadlineMs: NOW - RF_GRACE_MS - 60_000 });
  await t('F4 前置②: Y2 同 Y 走到 sealed 并冻结(第二个 refund_flip 场景, 供创世争用测试用, 与①相互独立)', async () => {
    await tickUntil(() => sqlite.prepare('SELECT status FROM proto_markets WHERE id=?').get(Y2).status === 'sealed', 3);
    freezeMarket({ db: sqlite, marketId: Y2, reason: 'inconsistent_verdicts', pmt: null, wallMs: Date.now(), log: { log() {}, warn() {}, error() {} } });
  });

  await t('F4 真实争用②(创世跨入口——下注与创世在 F4 里是同一段代码 fetchFeeCandidates+selectAndReserveFeeUtxo, proto-broadcast-ops.test.mjs F3b-4 已单独验证下注侧, 这里不重复起第四个并发臂): Z 的创世(buildMarketGenesisAndBroadcast, 真实生产函数)与 Y2 的 refund_flip 用 Promise.all 真并发, 候选池只留一枚"最佳"候选 ⇒ 它最多被一笔真实广播花掉(同①, 不钉总成功数)', async () => {
    for (const k of [...chain.keys()]) { const e = chain.get(k); if (e.scriptHex === relaySpkHex.slice(2).toLowerCase() && e.covenantId === null) chain.delete(k); }
    const sharedTxid2 = randomBytes(32).toString('hex');
    chain.set(`${sharedTxid2}:0`, { amount: 97_500_000n, scriptHex: relaySpkHex.slice(2).toLowerCase(), covenantId: null });
    const beforeCount = broadcasts.length;   // genesis 的 covenant_broadcast 与 refund_flip 的 covenant_broadcast 走同一个 fakeSendCmd, 都记进同一个 broadcasts 数组——不需要另外拼装
    const [rGenesis, rRf2] = await Promise.all([
      buildMarketGenesisAndBroadcast({ kaspa, network: NETWORK, market: sqlite.prepare('SELECT * FROM proto_markets WHERE id=?').get(Z), sendCmd: fakeSendCmd, relayId: 'ops-test-relay', relayAddress: relayAddr }),
      driver.advanceStep({ step: 'refund_flip', subjectId: Y2, marketId: Y2 }),
    ]);
    const newBroadcasts = broadcasts.slice(beforeCount);
    const allSpent2 = newBroadcasts.flatMap((b) => JSON.parse(b.cmd.tx_json).inputs.map((i) => i.transactionId));
    const dup2 = allSpent2.filter((v, i) => allSpent2.indexOf(v) !== i);
    assert.deepEqual(dup2, [], `不该有任何 outpoint 被两笔广播同时花掉, 实际重复: ${JSON.stringify(dup2)}`);
    const sharedSpentCount2 = allSpent2.filter((t2) => t2 === sharedTxid2).length;
    assert.ok(sharedSpentCount2 <= 1, `共享候选(${sharedTxid2.slice(0, 12)}…)最多只能被一笔真实交易花掉, 实际出现 ${sharedSpentCount2} 次`);
    assert.ok(!!rGenesis.txId || rRf2.outcome === 'submitted', `至少一方成功, 实际 genesis=${JSON.stringify(rGenesis)} refund_flip=${JSON.stringify(rRf2)}`);
  });
}
await t('私钥卫生: 全部广播命令 / 事件 / 意图列里不含委员私钥信封明文之外的密钥材料——扫描 broadcasts、events、intents 全文不含 relay 私钥与委员信封原文', () => {
  const secrets = [relayPriv.toString(), sqlite.prepare('SELECT committee_privkey_enc AS e FROM proto_markets WHERE id = ?').get(MARKET_ID).e];
  const blob = JSON.stringify(broadcasts.map((b) => b.cmd)) + JSON.stringify(sqlite.prepare('SELECT * FROM events').all()) + JSON.stringify(sqlite.prepare('SELECT * FROM proto_settlement_intents').all());
  for (const s of secrets) assert.ok(!blob.includes(s), '不应出现 ' + s.slice(0, 6) + '…');
});
await t('结构: ops 不 bare-import relay-manager; 不含 withdraw / reclaim / allowUnlistedTestDestination / 私钥解密; 不写任何表(无 INSERT / UPDATE / DELETE)', () => {
  const code = stripComments(fs.readFileSync(new URL('./proto-settlement-ops.mjs', import.meta.url), 'utf8'));
  for (const bad of [/relay-manager/, /\bwithdraw\b/i, /\breclaim\b/i, /allowUnlistedTestDestination/, /decrypt/i, /\b(INSERT|UPDATE|DELETE)\b/, /process\.env/]) assert.ok(!bad.test(code), '不应出现 ' + bad);
  assert.ok(!/SELECT \*/.test(code), '不 SELECT *(私钥信封列只在需要签名的两步单独取)');
});

console.log(`\nproto-settlement-ops.test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
