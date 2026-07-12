// broker-fee-emit-package-switch.test.mjs — B线深化件1 验收(J2 2026-07-12, 设计
// docs/2026-07-12-broker-fee-emit-package-live-switch-design.md v1.2, Bettor GO"折入即落码,完成报NWT diff审")。
// 真 migration 库(自举: 先建隔离临时库再以 DB_PATH 重生自身, 同 pregate.test.mjs 惯例) + 真
// brokerFeeLandedEmitTick(非复刻)。覆盖: §2.1 独立断言族(matched/mismatch) / §2.2 discover-then-trust 族
// byte-equal / zk_native 判据边界(NWT 核实结论) / 坏 fee_rules JSON 异常降级 / recordSunsetTracking 连胜/清零。
// Run: cd kasia-console && node src/services/broker-fee-emit-package-switch.test.mjs
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._BFEPS_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_bfeps_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, DB_PATH: tmpDb, _BFEPS_TEST_BOOTSTRAPPED: '1' },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const { brokerFeeLandedEmitTick, recordSunsetTracking, ensureBackfillSuppressed } = await import('./broker-fee-emit.mjs');
const { buildPredictionV1InterimRules } = await import('../lib/fee-split.mjs');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

sqlite.pragma('foreign_keys = OFF');   // fixture dummy 列不构造整图 FK(同 pregate.test.mjs 惯例)

// backfill-suppress 一次性消耗掉(空表上跑, 落 sentinel chain_event) — 否则本测试 seed 的 completed 市场
// 会被"首次运行标记现存已 emit"这层既有语义(见文件头注释)吞掉, 误判"零候选"。镜像 live 部署后【新】结算
// 才会被真实处理的语义(测试 fixture = "deploy 后新结算"场景, 非"现存历史盘")。
ensureBackfillSuppressed(sqlite);

// 真 schema INSERT: NOT NULL 无默认列动态补 dummy(phase2.test⑥/pregate.test 同款)
const info = sqlite.pragma('table_info(pool_markets)');
const required = info.filter(c => c.notnull === 1 && c.dflt_value == null && c.name !== 'id');
function seedMarket(id, over = {}) {
  const cols = ['id', ...required.map(c => c.name), 'protocol_version', 'protocol_status', 'broker_pk', 'settle_txid', 'spine_p2sh', 'resolution_rule_spec', 'metadata', 'fee_rules', 'maker_stake_amount'];
  const uniq = [...new Set(cols)];
  const defaults = {
    protocol_version: 'v0.7', protocol_status: 'completed', broker_pk: null, settle_txid: null,
    spine_p2sh: 'kaspatest:dummy', resolution_rule_spec: '{}', metadata: '{}', fee_rules: null,
    maker_stake_amount: 0, deadline_daa: 1000, deadline: 1000, pool_merkle_root: 'aa'.repeat(32), maker_pk: 'ff'.repeat(32),
  };
  const vals = uniq.map(c => (c === 'id' ? id : (over[c] !== undefined ? over[c] : (defaults[c] !== undefined ? defaults[c] : 'x'))));
  sqlite.prepare(`INSERT INTO pool_markets (${uniq.join(',')}) VALUES (${uniq.map(() => '?').join(',')})`).run(...vals);
}

// deriveBrokerAddress stub (DI, 见 broker-fee-emit.mjs 文件头注释): pk → 'addr:<pk前16位>'(不需真 kaspa-wasm)。
const deriveBrokerAddress = (pkHex) => `addr:${String(pkHex).toLowerCase().slice(0, 16)}`;
function insertTx(txid, outputs) {
  sqlite.prepare(`INSERT INTO kaspa_tx_log (tx_id, outputs_json, observed_at) VALUES (?, ?, CURRENT_TIMESTAMP)`).run(txid, JSON.stringify(outputs));
}
// 🔴 NWT 红队坐实(2026-07-12, "fixture 必复刻 production 结构"同族教训): seedMarket 默认 protocol_version=
//   'v0.7' → getMarketBets 走 bshard 分支, 只认 market_shards.shard_market_id 下的 pool_bettor_sides,
//   裸 market_id=logical_id 的 sides 查不到(R-SHARD-BLIND 同一坑, 这次撞在自己的测试 fixture 而非生产代码)。
//   本 helper 建一行 market_shards + 用它返回的 shardMarketId 插 sides, 复刻 real create-v07/register-v07
//   写出来的真实表结构(而非只插逻辑 market_id 图省事)。
function seedShard(logicalId) {
  const shardMarketId = `${logicalId}-s0`;
  sqlite.prepare(`INSERT INTO market_shards (logical_market_id, shard_index, shard_market_id, shard_p2sh, bettor_count, projected_settle_mass, status, created_at) VALUES (?, 0, ?, ?, 1, 0, 'open', ?)`)
    .run(logicalId, shardMarketId, 'kaspatest:shard-dummy', Math.floor(Date.now() / 1000));
  return shardMarketId;
}

const PK_A = '11'.repeat(32);   // §2.2 discover-then-trust(无 fee_rules)
const PK_B = '22'.repeat(32);   // §2.1 独立断言(matched)
const PK_C = '33'.repeat(32);   // §2.1 独立断言(mismatch → fallback)
const PK_D = '44'.repeat(32);   // 坏 fee_rules JSON → 异常降级
const PK_E = '55'.repeat(32);   // zk_native 判据边界: fee_rules 非空但 zk_native=true → 仍走 discovered
const PK_F = '66'.repeat(32);   // threaded-claim fallback(fw9kk 实盘撞见): close_txid 无 broker output, 靠 settle_evidence.winner_details 找到独立 claim tx
const PK_G = '77'.repeat(32);   // threaded-claim fallback 负例: winner_details 里真的没有 broker(非架构问题)
// v83 trigger 强制 broker_* chain_events.txid = 64-hex(禁 placeholder) — 测试 txid 必真 hex 字符集。
const TX_A = 'aa'.repeat(32), TX_B = 'bb'.repeat(32), TX_C = 'cc'.repeat(32), TX_D = 'dd'.repeat(32), TX_E = 'ee'.repeat(32);
const TX_F_CLOSE = 'f0'.repeat(32), TX_F_CLAIM = 'f1'.repeat(32), TX_G_CLOSE = 'f2'.repeat(32);

console.log('[test] ① §2.2 discover-then-trust 族(无 fee_rules) — 1dv70 同款真实历史金额回放:');
{
  const EXPECT_FEE_SOMPI = 6080000;   // 镜像 fee-single-source.test.mjs 的真实 1dv70 claim2 落链值
  const brokerAddr = deriveBrokerAddress(PK_A);
  seedMarket('mkt-A', { broker_pk: PK_A, settle_txid: TX_A, fee_rules: null });
  insertTx(TX_A, [
    { address: 'addr:other-winner-out', amount_sompi: 313920000 },
    { address: brokerAddr, amount_sompi: EXPECT_FEE_SOMPI },
  ]);
  const res = brokerFeeLandedEmitTick(sqlite, deriveBrokerAddress, () => {});
  ok(res.emitted === 1 && res.packageFallback === 0, `emitted=${res.emitted} fallback=${res.packageFallback}(§2.2 结构性必 matched, 零 fallback)`);
  const ev = sqlite.prepare(`SELECT payload FROM chain_events WHERE event_type='broker_fee_landed' AND to_address=?`).get(brokerAddr);
  const p = JSON.parse(ev.payload);
  ok(p.fee_sompi === EXPECT_FEE_SOMPI, `fee_sompi=${p.fee_sompi} == 真实链上值 ${EXPECT_FEE_SOMPI}(byte-equal 于切换前直写路径)`);
  ok(p.broker_address === brokerAddr && p.output_index === 1 && p.settle_txid === TX_A, 'broker_address/output_index/settle_txid 三字段 byte-equal 于旧直写路径形状');
  ok(p.verification === 'discovered', `verification=${p.verification}(§2.2 诚实标注 vacuous-pass, Bettor 注1 MUST)`);
}

console.log('[test] ② §2.1 独立断言族(fee_rules matched) — 独立链读 poolSompi(单源 getMarketBets, 与 computeSettlePlan 同基数):');
{
  const rules = buildPredictionV1InterimRules({ brokerPk: PK_B });   // provider=9840, broker=160bps
  // 🔴 NWT 红队 7pori 实盘撞见(#hm0tdn 追加): poolSompi = 仅 bettor_sides(getMarketBets 排 maker_stake),
  //   非 maker+bettor(V1 真实基数不含 maker——本测试 maker_stake_amount 故意设一个不相干的值, 断言基数
  //   确实只吃 bettor 侧, 不误把 maker 拉进来)。380000000 * 160/10000 = 6080000(同①真实值, 殊途同归)。
  const brokerAddr = deriveBrokerAddress(PK_B);
  seedMarket('mkt-B', { broker_pk: PK_B, settle_txid: TX_B, fee_rules: JSON.stringify(rules), maker_stake_amount: 999000000 });
  const shardB = seedShard('mkt-B');
  sqlite.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(shardB, 'bettor-b1', 0, 380000000, 'p2sh-dummy', 'sideB'.padEnd(64, '0'));
  insertTx(TX_B, [
    { address: 'addr:other-winner-out', amount_sompi: 380000000 - 6080000 },
    { address: brokerAddr, amount_sompi: 6080000 },
  ]);
  const res = brokerFeeLandedEmitTick(sqlite, deriveBrokerAddress, () => {});
  ok(res.emitted === 1 && res.packageFallback === 0, `emitted=${res.emitted} fallback=${res.packageFallback}(独立断言 matched, 零 fallback, maker 999000000 未被误算入基数)`);
  const ev = sqlite.prepare(`SELECT payload FROM chain_events WHERE event_type='broker_fee_landed' AND to_address=?`).get(brokerAddr);
  const p = JSON.parse(ev.payload);
  ok(p.fee_sompi === 6080000 && p.verification === 'independent', `fee_sompi=${p.fee_sompi} verification=${p.verification}(真 amount 断言过, Bettor 注1 MUST 标注强信任)`);
}

console.log('[test] ③ §2.1 独立断言族(mismatch) — 真实链上金额与 fee_rules 独立推导值不符 → 降级 fallback 不阻断通知:');
{
  const rules = buildPredictionV1InterimRules({ brokerPk: PK_C });
  const brokerAddr = deriveBrokerAddress(PK_C);
  const WRONG_REAL_FEE = 6000000;   // 真实 output 金额(蓄意跟期望值 6080000 不符, 模拟 bps 配置漂移/配置错误场景)
  seedMarket('mkt-C', { broker_pk: PK_C, settle_txid: TX_C, fee_rules: JSON.stringify(rules), maker_stake_amount: 200000000 });
  const shardC = seedShard('mkt-C');
  sqlite.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(shardC, 'bettor-c1', 0, 380000000, 'p2sh-dummy', 'sideC'.padEnd(64, '0'));
  insertTx(TX_C, [{ address: brokerAddr, amount_sompi: WRONG_REAL_FEE }]);
  const logs = [];
  const res = brokerFeeLandedEmitTick(sqlite, deriveBrokerAddress, (m) => logs.push(m));
  ok(res.emitted === 1 && res.packageFallback === 1, `emitted=${res.emitted} fallback=${res.packageFallback}(mismatch → 降级但仍通知, §4"不阻断到账通知"要求)`);
  ok(logs.some(l => l.includes('CRITICAL') && l.includes('mismatch')), '大声 CRITICAL log 记录完整性告警(非静默降级)');
  const ev = sqlite.prepare(`SELECT payload FROM chain_events WHERE event_type='broker_fee_landed' AND to_address=?`).get(brokerAddr);
  const p = JSON.parse(ev.payload);
  ok(p.fee_sompi === WRONG_REAL_FEE && p.verification === 'discovered', `fee_sompi=${p.fee_sompi}(真链上值, 非幻象期望值) verification=${p.verification}(降级诚实标注)`);
}

console.log('[test] ④ 坏 fee_rules JSON(结构性异常) → 异常捕获降级, 仍完成 emit 不阻断:');
{
  const brokerAddr = deriveBrokerAddress(PK_D);
  seedMarket('mkt-D', { broker_pk: PK_D, settle_txid: TX_D, fee_rules: 'not-json-garbage', maker_stake_amount: 100 });
  insertTx(TX_D, [{ address: brokerAddr, amount_sompi: 5000000 }]);
  const res = brokerFeeLandedEmitTick(sqlite, deriveBrokerAddress, () => {});
  ok(res.emitted === 1 && res.packageFallback === 1, `emitted=${res.emitted} fallback=${res.packageFallback}(坏 JSON → catch(e) 降级, 不崩不吞)`);
}

console.log('[test] ⑤ zk_native 判据边界(NWT 核实吻合, 设计 v1.2 分族判据矩阵) — fee_rules 非空但 zk_native=true → 仍走 §2.2 discovered:');
{
  const rules = buildPredictionV1InterimRules({ brokerPk: PK_E });
  const brokerAddr = deriveBrokerAddress(PK_E);
  seedMarket('mkt-E', {
    broker_pk: PK_E, settle_txid: TX_E, fee_rules: JSON.stringify(rules),
    resolution_rule_spec: JSON.stringify({ zk_native: true }), maker_stake_amount: 200000000,
  });
  insertTx(TX_E, [{ address: brokerAddr, amount_sompi: 4242000 }]);
  const res = brokerFeeLandedEmitTick(sqlite, deriveBrokerAddress, () => {});
  ok(res.emitted === 1 && res.packageFallback === 0, `emitted=${res.emitted} fallback=${res.packageFallback}(zk_native 判据生效, 未误入 §2.1 独立断言导致虚假 mismatch)`);
  const ev = sqlite.prepare(`SELECT payload FROM chain_events WHERE event_type='broker_fee_landed' AND to_address=?`).get(brokerAddr);
  const p = JSON.parse(ev.payload);
  ok(p.verification === 'discovered' && p.fee_sompi === 4242000, `verification=${p.verification}(zk_native 市场 fee_rules 非空也不触发独立断言, 判据矩阵边界钉死)`);
}

console.log('[test] ⑥ recordSunsetTracking(Bettor 注2 MUST, 双路径日落条件) — 连胜累加/任一 fallback 清零:');
{
  sqlite.prepare(`DELETE FROM config_entries WHERE key = 'package_path_streak' AND category = 'broker_fee_emit'`).run();
  let s = recordSunsetTracking(sqlite, { fellBack: false });
  ok(s.consecutiveSuccess === 1 && !s.sunsetReady, `首次成功: consecutiveSuccess=${s.consecutiveSuccess} sunsetReady=${s.sunsetReady}`);
  s = recordSunsetTracking(sqlite, { fellBack: false });
  ok(s.consecutiveSuccess === 2, `连续成功累加: consecutiveSuccess=${s.consecutiveSuccess}`);
  s = recordSunsetTracking(sqlite, { fellBack: true });
  ok(s.consecutiveSuccess === 0 && s.fallbackCount === 1 && !s.sunsetReady, `任一 fallback 清零连胜(不允许凑数蒙混): consecutiveSuccess=${s.consecutiveSuccess} fallbackCount=${s.fallbackCount}`);
  for (let i = 0; i < 20; i++) s = recordSunsetTracking(sqlite, { fellBack: false });
  ok(s.consecutiveSuccess === 20 && s.sunsetReady === true, `连续20笔零fallback → sunsetReady=${s.sunsetReady}(日落触发器命中, 该提 follow-up 卡删 legacyDirectEmit)`);
}

console.log('[test] ⑦ threaded-claim fallback(fw9kk 实盘撞见, Owner 直令修复) — close_txid 无 broker output, 靠 settle_evidence.winner_details 找到独立 claim tx:');
{
  const rules = buildPredictionV1InterimRules({ brokerPk: PK_F });
  const brokerAddr = deriveBrokerAddress(PK_F);
  const CLAIM_AMOUNT = 160000000;   // 同 fw9kk 真实值(160,000,000 sompi)
  const settleEvidence = {
    settled_by: 'bshard-settle-daemon', close_txid: TX_F_CLOSE, complete: true,
    winner_details: [
      { pk: 'aa'.repeat(32), amount: '9820000000', txId: 'e1'.repeat(32) },   // 别的 winner leaf, 混进去验证不误配
      // lint-allow-chain-amount-precision: sompi 整数(fixture 测试值非 KAS 小数, 非直发 wallet API 字段)
      { pk: PK_F, amount: String(CLAIM_AMOUNT), txId: TX_F_CLAIM },            // broker 自己的 claim tx(独立于 close_txid)
    ],
  };
  seedMarket('mkt-F', {
    broker_pk: PK_F, settle_txid: TX_F_CLOSE, fee_rules: JSON.stringify(rules), maker_stake_amount: 500000000,
    metadata: JSON.stringify({ settle_evidence: settleEvidence }),
  });
  const shardF = seedShard('mkt-F');
  sqlite.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(shardF, 'bettor-f1', 0, 10000000000, 'p2sh-dummy', 'sideF'.padEnd(64, '0'));
  // close_txid(TX_F_CLOSE) 镜像真实 bshard 架构: closed-PS output + maker 找零, 【零 broker output】。
  insertTx(TX_F_CLOSE, [
    { address: 'addr:closed-ps-dummy', amount_sompi: 9843960000 },
    { address: 'addr:maker-change-dummy', amount_sompi: 28000000 },
  ]);
  // broker 的独立 claim tx(threaded-claim, 与 close_txid 分开广播)。
  insertTx(TX_F_CLAIM, [{ address: brokerAddr, amount_sompi: CLAIM_AMOUNT }]);
  const logs = [];
  const res = brokerFeeLandedEmitTick(sqlite, deriveBrokerAddress, (m) => logs.push(m));
  ok(res.emitted === 1 && res.packageFallback === 0, `emitted=${res.emitted} fallback=${res.packageFallback}(threaded-claim fallback 找到真 output, 独立断言 matched, 零 package fallback)`);
  ok(logs.some(l => l.includes('threaded-claim 架构')), '大声记录走了 threaded-claim fallback 分支(非静默)');
  const ev = sqlite.prepare(`SELECT payload FROM chain_events WHERE event_type='broker_fee_landed' AND to_address=?`).get(brokerAddr);
  const p = JSON.parse(ev.payload);
  ok(p.fee_sompi === CLAIM_AMOUNT && p.settle_txid === TX_F_CLAIM && p.verification === 'independent',
    `fee_sompi=${p.fee_sompi} settle_txid=${p.settle_txid.slice(0, 8)}(独立 claim tx, 非 close_txid) verification=${p.verification}`);
}

console.log('[test] ⑧ threaded-claim fallback 负例: winner_details 里没有 broker 条目(真的没收到钱, 非架构问题) → 仍走既有 no_broker_output 跳过路径, 不误报:');
{
  const rules = buildPredictionV1InterimRules({ brokerPk: PK_G });
  const brokerAddr = deriveBrokerAddress(PK_G);
  const settleEvidence = { settled_by: 'bshard-settle-daemon', close_txid: TX_G_CLOSE, complete: true, winner_details: [{ pk: 'bb'.repeat(32), amount: '9999999999', txId: 'e2'.repeat(32) }] };
  seedMarket('mkt-G', {
    broker_pk: PK_G, settle_txid: TX_G_CLOSE, fee_rules: JSON.stringify(rules), maker_stake_amount: 500000000,
    metadata: JSON.stringify({ settle_evidence: settleEvidence }),
  });
  const shardG = seedShard('mkt-G');
  sqlite.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(shardG, 'bettor-g1', 0, 10000000000, 'p2sh-dummy', 'sideG'.padEnd(64, '0'));
  insertTx(TX_G_CLOSE, [{ address: 'addr:closed-ps-dummy', amount_sompi: 9971960000 }, { address: 'addr:maker-change-dummy', amount_sompi: 28000000 }]);
  const res = brokerFeeLandedEmitTick(sqlite, deriveBrokerAddress, () => {});
  ok(res.noBrokerOutput === 1 && res.emitted === 0, `noBrokerOutput=${res.noBrokerOutput} emitted=${res.emitted}(winner_details 里真的没有 broker → 老实标记跳过, 不幻造通知)`);
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — broker-fee-emit package live 切换: §2.1/§2.2 分族矩阵/byte-equal/mismatch降级/坏JSON降级/zk_native边界/日落追踪/threaded-claim fallback+负例 全绿'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
