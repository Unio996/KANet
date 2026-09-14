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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
