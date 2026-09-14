// proto-tx-assembly.test.mjs — Bettor 1425 复核清单向量①③④(账本1425续)。
// ①②④ 纯 JS/真 DB, 零链零 IPC。②(CovenantBinding 遗漏→mass >10x)是独立的真 kaspa-wasm 构造实验,
// 见 docs/provenance/2026-09-15-j2-market-genesis-tx-assembly-vectors/vector2-covenant-binding-omission.mjs
// (真链构造成本高、依赖 kaspa-wasm 全量, 不适合塞进这个跑得快的离线测试文件)。
// Run: cd kasia-console && node src/lib/proto-tx-assembly.test.mjs

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_TX_ASSEMBLY_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_proto_tx_assembly_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_TX_ASSEMBLY_TEST_BOOTSTRAPPED: '1' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const {
  GENESIS_OUTPUT_SOMPI, CONTINUATION_OUTPUT_SOMPI, assertFixedOutputValue, assertKttOutpointRecorded,
  computeRequiredFeeSompiOrThrow, selectFeeUtxo, assertChangeShape,
} = await import('./proto-tx-assembly.mjs');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };

// ============ 向量① genesisOutputValue 用"seed 减法"算出非常量值 ⇒ 构造层拒绝 ============
t('①-1 精确等于协议常量 ⇒ 通过', () => {
  assertFixedOutputValue(20_000_000n, GENESIS_OUTPUT_SOMPI, 'genesis');
});
t('①-2 用"种子减法"算出的近似值(例如 seedValue - feeEstimate 凑出来的 19,999,999) ⇒ 拒绝', () => {
  const seedValue = 120_000_000n;
  const feeEstimateGuess = 100_000_001n; // 故意"减法凑数"而非直接用协议常量
  const computedBySubtraction = seedValue - feeEstimateGuess; // = 19_999_999n, 差 1 sompi
  let threw = null;
  try { assertFixedOutputValue(computedBySubtraction, GENESIS_OUTPUT_SOMPI, 'genesis'); } catch (e) { threw = e; }
  if (!threw) throw new Error('减法算出的非常量值应该被拒绝, 但没有抛错');
  if (!/!= 协议常量/.test(threw.message)) throw new Error(`错误信息不对: ${threw.message}`);
});
t('①-3 续约输出同理: 差 1 sompi 也必须拒绝(不是只查"大致相等")', () => {
  let threw = null;
  try { assertFixedOutputValue(CONTINUATION_OUTPUT_SOMPI + 1n, CONTINUATION_OUTPUT_SOMPI, 'continuation'); } catch (e) { threw = e; }
  if (!threw) throw new Error('多 1 sompi 也应该被拒绝');
});
t('①-4 非 bigint 类型直接拒绝(防止 Number 精度静默出错)', () => {
  let threw = null;
  try { assertFixedOutputValue(20000000, GENESIS_OUTPUT_SOMPI, 'genesis'); } catch (e) { threw = e; }
  if (!threw || !/must be bigint/.test(threw.message)) throw new Error('非 bigint 应该被拒绝并明确报错');
});

// ============ 向量③ KTT 输入 outpoint 不在 proto_bets 记录里 ⇒ 拒绝 ============
const now = new Date().toISOString();
sqlite.prepare(`INSERT INTO proto_token_defs (id,name,ticker,created_at) VALUES (?,?,?,?)`).run('tok1', 'Test', 'TST', now);
sqlite.prepare(`INSERT INTO proto_markets (id, token_def_id, question, deadline_ms, min_bet, seal_count, committee_pubkeys_json, committee_privkey_enc, rootclose_tmpl_hash, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
  .run('mkt1', 'tok1', 'q?', 1700000000000, 100, 2, '[]', 'enc', 'aa'.repeat(32), now, now);
sqlite.prepare(`INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, mint_txid, mint_vout, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
  .run('bet1', 'mkt1', 'bb'.repeat(32), 0, 100, 'real'.repeat(16), 0, 'chip_minted_pending_stake', now);
sqlite.prepare(`INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, status, created_at) VALUES (?,?,?,?,?,?,?)`)
  .run('bet2_no_mint_yet', 'mkt1', 'bb'.repeat(32), 0, 100, 'pending', now);

t('③-1 outpoint 与 proto_bets.mint_txid/mint_vout 完全一致 ⇒ 通过', () => {
  const r = assertKttOutpointRecorded({ betId: 'bet1', txid: 'real'.repeat(16), vout: 0 });
  if (r.txid !== 'real'.repeat(16) || r.vout !== 0) throw new Error('返回值不对');
});
t('③-2 outpoint 是"按 owner 扫链扫到的另一个 UTXO"(vout 不同) ⇒ 拒绝', () => {
  let threw = null;
  try { assertKttOutpointRecorded({ betId: 'bet1', txid: 'real'.repeat(16), vout: 1 }); } catch (e) { threw = e; }
  if (!threw || !/不一致/.test(threw.message)) throw new Error('应该拒绝且报"不一致"');
});
t('③-3 outpoint 是完全不相干的另一笔 txid ⇒ 拒绝', () => {
  let threw = null;
  try { assertKttOutpointRecorded({ betId: 'bet1', txid: 'ff'.repeat(32), vout: 0 }); } catch (e) { threw = e; }
  if (!threw) throw new Error('应该拒绝');
});
t('③-4 bet 存在但步骤 A 还没落地(mint_txid 为空) ⇒ 拒绝, 不是把 null 当"随便什么都行"', () => {
  let threw = null;
  try { assertKttOutpointRecorded({ betId: 'bet2_no_mint_yet', txid: 'aa'.repeat(32), vout: 0 }); } catch (e) { threw = e; }
  if (!threw || !/尚未记录/.test(threw.message)) throw new Error('应该拒绝且报"尚未记录"');
});
t('③-5 bet_id 根本不存在 ⇒ 拒绝', () => {
  let threw = null;
  try { assertKttOutpointRecorded({ betId: 'no_such_bet', txid: 'aa'.repeat(32), vout: 0 }); } catch (e) { threw = e; }
  if (!threw || !/找不到/.test(threw.message)) throw new Error('应该拒绝且报"找不到"');
});

// ============ 向量④ console 侧调用 calculateTransactionMass 不可用 ⇒ fail-loud ============
t('④-1 kaspa 对象完全没有 calculateTransactionMass 方法 ⇒ 立即 throw, 不回退估算值', () => {
  let threw = null;
  try { computeRequiredFeeSompiOrThrow({}, 'mainnet', {}); } catch (e) { threw = e; }
  if (!threw || !/不可用/.test(threw.message)) throw new Error('应该 throw 且提示不可用');
});
t('④-2 calculateTransactionMass 抛错(例如 v1 covenant tx panic) ⇒ 原样冒泡, 不吞掉不估算', () => {
  const fakeKaspa = { calculateTransactionMass: () => { throw new Error('wasm unreachable'); } };
  let threw = null;
  try { computeRequiredFeeSompiOrThrow(fakeKaspa, 'mainnet', {}); } catch (e) { threw = e; }
  if (!threw || !/wasm unreachable/.test(threw.message)) throw new Error('原始错误信息应该冒泡出来');
});
t('④-3 calculateTransactionMass 返回 null ⇒ 视为不可用, 不当 0 处理', () => {
  const fakeKaspa = { calculateTransactionMass: () => null };
  let threw = null;
  try { computeRequiredFeeSompiOrThrow(fakeKaspa, 'mainnet', {}); } catch (e) { threw = e; }
  if (!threw || !/返回空值/.test(threw.message)) throw new Error('应该拒绝空返回值');
});
t('④-4 calculateTransactionMass 正常返回 ⇒ fee = mass * 100(SOMPI_PER_MASS)', () => {
  const fakeKaspa = { calculateTransactionMass: () => 3000n };
  const fee = computeRequiredFeeSompiOrThrow(fakeKaspa, 'mainnet', {});
  if (fee !== 300000n) throw new Error(`fee 应该是 300000, 实际 ${fee}`);
});

// ============ §9.5 fee-UTXO 选择器附带向量(non-required, 但同一批交付, 一并验证) ============
t('fee-UTXO: 有单个够用的 UTXO ⇒ 选中它', () => {
  const u = selectFeeUtxo([{ txid: 'a', vout: 0, value: 500_000_000n }, { txid: 'b', vout: 0, value: 5_000_000_000n }], 100_000_000n);
  if (u.txid !== 'a') throw new Error('应该选最小的够用 UTXO');
});
t('fee-UTXO: 没有任何单个 UTXO 够用 ⇒ no_suitable_fee_utxo, 不自动拆分', () => {
  let threw = null;
  try { selectFeeUtxo([{ txid: 'a', vout: 0, value: 1_000n }], 100_000_000n); } catch (e) { threw = e; }
  if (!threw || !/no_suitable_fee_utxo/.test(threw.message)) throw new Error('应该 fail-loud 报 no_suitable_fee_utxo');
});
t('找零形状: 0 或 >= CONTINUATION_OUTPUT_SOMPI 通过, 中间的 dust 值拒绝', () => {
  assertChangeShape(0n);
  assertChangeShape(CONTINUATION_OUTPUT_SOMPI);
  let threw = null;
  try { assertChangeShape(1_000n); } catch (e) { threw = e; }
  if (!threw) throw new Error('dust 找零应该被拒绝');
});
t('找零形状: (0, CONTINUATION_OUTPUT_SOMPI) 中间地带(Bettor 1427 复核点名的边界)一律 throw, 不并入手续费, 不静默放行(例如 15,000,000——恰好是 15M 那个已接受例外的数量级, 但那条例外用在别的固定种子面值场景, 不是这里的找零下限, 这里没有"折算进 fee"的隐藏分支)', () => {
  let threw = null;
  try { assertChangeShape(15_000_000n); } catch (e) { threw = e; }
  if (!threw) throw new Error('15,000,000(严格在 0 和 CONTINUATION_OUTPUT_SOMPI 之间)应该被拒绝, 不能因为接近某个已接受的例外数量级就放行');
  let threw2 = null;
  try { assertChangeShape(CONTINUATION_OUTPUT_SOMPI - 1n); } catch (e) { threw2 = e; }
  if (!threw2) throw new Error('差 1 sompi 也要拒绝, 不是"差不多就行"');
});

// ============ market_genesis tx_json 真实端到端组装(真 kaspa-wasm + 真编译 ShardLeaf_direct) ============
// 目的: 证明 buildMarketGenesisTxJson 产出的 tx_json 不只是"格式对", 而是 relay 侧真代码
// (Transaction.deserializeFromSafeJSON → extractTxShape → validateFixedValueOutputs → 签名 →
// assertFinalTxid)能够真的吃下去、真的通过、txid 真的对得上——这是"两边分开写的代码是否真的接得上"
// 这一层, 光测 proto-tx-assembly.mjs 自己内部逻辑测不出这种问题。
// relay 侧函数只在测试里做只读交叉核验(不是生产依赖——"Console 传导不碰链"角色分工不变, 生产代码
// 从不 import kasia-relay)。
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
{
  const kaspa = await import('kaspa-wasm');
  const { buildMarketGenesisTxJson, GENESIS_OUTPUT_SOMPI: GOS } = await import('./proto-tx-assembly.mjs');
  const { computeMarketGenesisArtifacts } = await import('./proto-covenant-builder.mjs');
  const { extractTxShape, validateFixedValueOutputs, signOnlyDeclaredInputs, assertFinalTxid } = await import('../../../kasia-relay/src/lib/covenant-broadcast.mjs');
  const { randomBytes } = await import('node:crypto');

  const artifacts = await computeMarketGenesisArtifacts({ marketId: 'ab'.repeat(32), minBet: 100, deadlineMs: 1700000000000 });

  const priv = new kaspa.PrivateKey(randomBytes(32).toString('hex'));
  const relayAddr = priv.toPublicKey().toAddress('mainnet');
  const relaySpk = kaspa.payToAddressScript(relayAddr);
  const feeUtxo = { txid: 'ee'.repeat(32), vout: 0, value: 10_000_000_000n, scriptPublicKeyHex: '0x' + relaySpk.script };

  let built;
  t('genesis-e2e-1 buildMarketGenesisTxJson 真实构造成功(真 mass 计算, 找零非负, 返回 shardLeafCovId)', () => {
    built = buildMarketGenesisTxJson({ kaspa, network: 'mainnet', feeUtxo, relayChangeScriptPublicKeyHex: '0x' + relaySpk.script, shardLeafScriptPubKeyHex: artifacts.shardLeafDirect.scriptPubKeyHex });
    if (!built.txJson || built.signInputIndices.length !== 1 || built.genesisOutputIndices.length !== 1) throw new Error('返回形状不对');
    if (!built.shardLeafCovId || built.shardLeafCovId === '0'.repeat(64)) throw new Error(`shardLeafCovId 应该是非零派生值, 实际 ${built.shardLeafCovId}`);
  });

  t('genesis-e2e-2 relay 侧真代码能反序列化 + extractTxShape + validateFixedValueOutputs 通过(未签名阶段), covenant_id 在序列化往返后不变(populateGenesisCovenants 声明真的被序列化保留, 不是本地对象独有的临时状态)', () => {
    const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
    const shape = extractTxShape(tx);
    const fv = validateFixedValueOutputs({ outputs: shape.outputs, genesisOutputIndices: built.genesisOutputIndices, continuationOutputIndices: built.continuationOutputIndices });
    if (!fv.ok) throw new Error(`relay 真代码拒绝了 console 构造出的 tx: ${fv.reason}`);
    if (shape.outputs[0].valueSompi !== GOS) throw new Error(`genesis 输出值不是协议常量: ${shape.outputs[0].valueSompi}`);
    const covIdAfterRoundtrip = String(tx.outputs[0].covenant?.covenantId ?? '');
    if (covIdAfterRoundtrip !== built.shardLeafCovId) throw new Error(`反序列化后 covenant_id=${covIdAfterRoundtrip} != 构造时算出的 ${built.shardLeafCovId}(populateGenesisCovenants 声明在序列化往返中丢失/改变了)`);
  });

  t('genesis-e2e-3 relay 真签名(signOnlyDeclaredInputs)后 finalize, txid 与 console 预期的 expectedTxid 一致(txid 不含 witness)', () => {
    const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
    signOnlyDeclaredInputs({ tx, signInputIndices: built.signInputIndices, privateKey: priv, kaspa });
    tx.finalize();
    const r = assertFinalTxid(tx, built.expectedTxid);
    if (!r.ok) throw new Error(`签名后 txid=${r.actualTxid} != console 预期的 expectedTxid=${built.expectedTxid}(说明 txid 计算不是真的不受 witness 影响, 或者构造有 bug)`);
  });

  t('genesis-e2e-4 篡改 genesis 输出值后(模拟构造层被绕过), relay 真代码 validateFixedValueOutputs 必须拦下', () => {
    // 用一个更小/不同的输出值重建交易, 模拟"如果某处绕过了构造层的常量写死"这个反例。
    const feeSpk2 = kaspa.payToAddressScript(relayAddr);
    const genesisSpk2 = new kaspa.ScriptPublicKey(0, artifacts.shardLeafDirect.scriptPubKeyHex.slice(2));
    const tamperedTx = new kaspa.Transaction({
      version: 1,
      inputs: [{ previousOutpoint: { transactionId: feeUtxo.txid, index: feeUtxo.vout }, signatureScript: new Uint8Array(0), sequence: 0n, sigOpCount: 1, computeBudget: 0, utxo: { outpoint: { transactionId: feeUtxo.txid, index: feeUtxo.vout }, amount: feeUtxo.value, scriptPublicKey: feeSpk2, blockDaaScore: 0n } }],
      outputs: [
        new kaspa.TransactionOutput(GOS - 1n, genesisSpk2),
        new kaspa.TransactionOutput(feeUtxo.value - GOS - 100000n, feeSpk2),
      ],
      lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
    });
    const shape = extractTxShape(tamperedTx);
    const fv = validateFixedValueOutputs({ outputs: shape.outputs, genesisOutputIndices: [0], continuationOutputIndices: [] });
    if (fv.ok) throw new Error('relay 真代码本该拒绝差 1 sompi 的 genesis 输出, 却放行了');
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
// 🔴 用 process.exitCode(不强制终止, 让事件循环自然收尾)而不是 process.exit(): 实测
// kaspa.createInputSignature() 之后立即 process.exit() 会在 kaspa-wasm 的 wasm 异步句柄清理未完成时
// 被强行掐断, 触发 Windows 下 libuv 断言崩溃(`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`,
// src\win\async.c:76) —— 退出码变成 127, 会被外层 spawnSync 误判成"测试失败", 但其实全部断言已经真的
// 跑完并且是真的 pass。不是 kaspa-wasm 用错了, 是"签名后立刻强制退出"这个动作本身撞了 wasm 的异步
// 清理时序——用 process.exitCode 交给事件循环自然收尾就不会崩(已用 scratch/_bisect2~5 四步二分定位到
// 触发点确切是 createInputSignature 之后的 process.exit(), 不是 deserialize/finalize/tx 构造)。
process.exitCode = fail === 0 ? 0 : 1;
