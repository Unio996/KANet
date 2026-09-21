// proto-refund-flip-store.test.mjs — R-a(驱动退款路, 设计 docs/2026-09-21-j2-driver-refund-path-design-v0.2.md §2.1 / §3.3 / §3.5): store 端口的 refund_flip 部分。
// 真迁移临时库(含 v214), 零链零 IPC。覆盖: M1 触发谓词不看 status / 主网形状夹具零动作; markLanded 事务性 + 前态谓词; M3 确定性 id + 守恒 + 缺 ticket 的 HOLD 路径; M5 观察到第三方翻牌的幂等记账 + 自动冻结。
// Run: cd kasia-console && node src/lib/proto-refund-flip-store.test.mjs
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_REFUND_FLIP_STORE_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_refund_flip_store_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_REFUND_FLIP_STORE_TEST_BOOTSTRAPPED: '1', KASPA_NETWORK: 'mainnet' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const { createSettlementStore, refundClaimIdFor, deriveRefundClaims } = await import('./proto-settlement-store.mjs');
const { freezeMarket } = await import('./proto-settlement-freeze.mjs');
const { ensureSettlementIntent, markSettlementIntent, getSettlementIntent, settlementIntentKeyFor } = await import('./proto-settlement-intent.mjs');
const { createHash } = await import('node:crypto');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}: ${JSON.stringify(cond)}`); fails++; } };
const quiet = { log: () => {}, warn: () => {}, error: () => {} };
const store = createSettlementStore({ db: sqlite, claimDrawClaimOutIndex: 1 });
const hex = (seed) => createHash('sha256').update(seed).digest('hex');
const now = new Date().toISOString();

function seedMarket(id, status = 'sealed') {
  sqlite.prepare(`INSERT OR IGNORE INTO proto_token_defs (id,name,ticker,created_at) VALUES ('t1','Test','TST',?)`).run(now);
  sqlite.prepare(`INSERT INTO proto_markets (id,token_def_id,deadline_ms,min_bet,committee_pubkeys_json,committee_privkey_enc,rootclose_tmpl_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, 't1', 1700000000000, 100, '[]', 'enc', 'aa'.repeat(32), now, now);
  if (status !== 'betting') sqlite.prepare('UPDATE proto_markets SET status = ? WHERE id = ?').run(status, id);
}
function seedBet(marketId, n, { stake = 100, pk = null, ticketTxid = 'auto', ticketVout = 2, status = 'confirmed' } = {}) {
  sqlite.prepare(`INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, ticket_txid, ticket_vout, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(`bet-${marketId.slice(0, 6)}-${n}`, marketId, pk || hex(`pk${n}`), n % 2, stake, ticketTxid === 'auto' ? hex(`ticket-${marketId}-${n}`) : ticketTxid, ticketVout, status, now);
}
const sealLanded = (marketId) => { ensureSettlementIntent({ subjectType: 'market', subjectId: marketId, step: 'seal' }); sqlite.prepare("UPDATE proto_settlement_intents SET status = 'landed', prepared_txid = ?, submitted_txid = ? WHERE intent_key = ?").run(hex('seal' + marketId), hex('seal' + marketId), settlementIntentKeyFor('market', marketId, 'seal')); };
const advances = () => store.listWork().advances.filter((a) => a.step === 'refund_flip').map((a) => a.subjectId);
const mid = (s) => hex('market-' + s);

console.log('[test] ① M1 触发谓词: 只对【冻结 ∧ sealed ∧ seal landed ∧ 无在途/落地 resolve】的市场; 主网形状夹具(手置 cancelled、无任何意图行、有 pending bet)⇒ 零动作:');
{
  const A = mid('frozen-ok'); seedMarket(A); seedBet(A, 0); seedBet(A, 1); sealLanded(A); freezeMarket({ db: sqlite, marketId: A, reason: 'inconsistent_verdicts', pmt: null, wallMs: Date.now(), log: quiet });
  const B = mid('unfrozen'); seedMarket(B); sealLanded(B);
  const C = mid('mainnet-cancelled'); seedMarket(C, 'cancelled'); seedBet(C, 0, { status: 'pending' });                               // 主网形状: 手工置 cancelled, 无意图行
  const Cf = mid('cancelled-frozen'); seedMarket(Cf, 'sealed'); sealLanded(Cf); freezeMarket({ db: sqlite, marketId: Cf, reason: 'x', pmt: null, wallMs: Date.now(), log: quiet }); sqlite.prepare("UPDATE proto_markets SET status = 'cancelled' WHERE id = ?").run(Cf);   // 冻结且 cancelled(遗留形状)
  const D = mid('resolve-landed'); seedMarket(D); sealLanded(D); freezeMarket({ db: sqlite, marketId: D, reason: 'x', pmt: null, wallMs: Date.now(), log: quiet }); ensureSettlementIntent({ subjectType: 'market', subjectId: D, step: 'resolve' }); sqlite.prepare("UPDATE proto_settlement_intents SET status = 'landed' WHERE intent_key = ?").run(settlementIntentKeyFor('market', D, 'resolve'));
  const E = mid('resolve-prepared-hold'); seedMarket(E); sealLanded(E); freezeMarket({ db: sqlite, marketId: E, reason: 'x', pmt: null, wallMs: Date.now(), log: quiet }); ensureSettlementIntent({ subjectType: 'market', subjectId: E, step: 'resolve' }); sqlite.prepare("UPDATE proto_settlement_intents SET status = 'prepared', prepared_txid = ?, prepared_tx_json = '[]' WHERE intent_key = ?").run(hex('close' + E), settlementIntentKeyFor('market', E, 'resolve'));
  const a = advances();
  ok(a.includes(A), '冻结 ∧ sealed ∧ seal landed ⇒ 被选');
  ok(!a.includes(B), '未冻结 ⇒ 不选(v1 只自动翻冻结市场)');
  ok(!a.includes(C) && !a.includes(Cf), '主网形状夹具(手置 cancelled, 含冻结的遗留形状)⇒ 不选(status 不是 sealed)');
  ok(!a.includes(D), '已有 landed 的 resolve ⇒ 不选(close 已落地, 不翻)');
  ok(a.includes(E), 'prepared 的 resolve(F1 HOLD 行)不阻止翻');
  ok(store.dependenciesLanded('refund_flip', { subjectId: B, marketId: B }).reason === 'market_not_frozen', 'dependenciesLanded: 未冻结 ⇒ market_not_frozen');
  ok(store.dependenciesLanded('refund_flip', { subjectId: C, marketId: C }).reason === 'market_not_sealed', 'dependenciesLanded: 主网形状 cancelled ⇒ market_not_sealed');
  ok(store.dependenciesLanded('refund_flip', { subjectId: D, marketId: D }).reason === 'resolve_in_flight_or_landed', 'dependenciesLanded: resolve 已落地 ⇒ 拒');
  ok(store.dependenciesLanded('refund_flip', { subjectId: A, marketId: A }).ok === true, 'dependenciesLanded: 冻结 ∧ sealed ∧ seal landed ⇒ ok');
  const before = sqlite.prepare('SELECT COUNT(*) AS n FROM proto_settlement_intents').get().n;
  const cRow = sqlite.prepare('SELECT status FROM proto_markets WHERE id = ?').get(C).status;
  store.listWork(); store.listWork();
  ok(sqlite.prepare('SELECT COUNT(*) AS n FROM proto_settlement_intents').get().n === before && sqlite.prepare('SELECT status FROM proto_markets WHERE id = ?').get(C).status === cRow, '主网形状夹具: 连跑 listWork 零写入(零动作)');
}

console.log('[test] ② M3 退款票身份 + 守恒: 确定性 id(hash 公式)、同 pk 两票各一条、缺 ticket / 重复 / Σ 不符 ⇒ 抛:');
{
  const M = mid('claims'); seedMarket(M); const pk = hex('same-pk');
  seedBet(M, 0, { pk, stake: 300 }); seedBet(M, 1, { pk, stake: 700 });
  const cs = deriveRefundClaims({ db: sqlite, marketId: M });
  ok(cs.length === 2 && cs[0].id !== cs[1].id, '同 pk 两张票 ⇒ 两个不同的 claim id');
  const t0 = hex(`ticket-${M}-0`);
  ok(cs[0].id === createHash('sha256').update(`${M}${t0}2refund`).digest('hex'), 'id = sha256(market ‖ ticket_txid ‖ ticket_vout ‖ "refund")(独立复算)');
  ok(cs[0].id === refundClaimIdFor({ marketId: M, ticketTxid: t0, ticketVout: 2 }), 'refundClaimIdFor 与派生一致');
  ok(cs.reduce((a, c) => a + c.amount, 0) === 1000, 'Σ amount == Σ confirmed stake');
  for (const bad of [{ ticketTxid: null }, { ticketTxid: 'zz' }, { ticketVout: null }, { ticketVout: -1 }]) {
    let e = null; try { refundClaimIdFor({ marketId: M, ticketTxid: t0, ticketVout: 2, ...bad }); } catch (x) { e = x; }
    ok(!!e, `refundClaimIdFor 缺/坏 ticket 字段 ${JSON.stringify(bad)} ⇒ 抛(不得空值入哈希)`);
  }
  const N = mid('no-ticket'); seedMarket(N); seedBet(N, 0, { ticketTxid: null, ticketVout: null });
  let e1 = null; try { deriveRefundClaims({ db: sqlite, marketId: N }); } catch (x) { e1 = x; }
  ok(!!e1, '有 confirmed 下注但缺 ticket outpoint ⇒ deriveRefundClaims 抛(HOLD 路径)');
  const Z = mid('zero'); seedMarket(Z); let e2 = null; try { deriveRefundClaims({ db: sqlite, marketId: Z }); } catch (x) { e2 = x; }
  ok(!!e2, '没有 confirmed 下注 ⇒ 抛');
  const P = mid('dup'); seedMarket(P); const same = hex('dup-ticket'); seedBet(P, 0, { ticketTxid: same, ticketVout: 1 }); seedBet(P, 1, { ticketTxid: same, ticketVout: 1 });
  let e3 = null; try { deriveRefundClaims({ db: sqlite, marketId: P }); } catch (x) { e3 = x; }
  ok(!!e3 && /重复/.test(e3.message), '两张票 outpoint 重复 ⇒ 抛');
}

console.log('[test] ③ markLanded(refund_flip): 事务性 / 幂等 / M1 前态谓词 / close 意图标 ambiguous:');
{
  const M = mid('ml'); seedMarket(M); seedBet(M, 0, { stake: 400 }); seedBet(M, 1, { stake: 600 }); sealLanded(M); freezeMarket({ db: sqlite, marketId: M, reason: 'x', pmt: null, wallMs: Date.now(), log: quiet });
  ensureSettlementIntent({ subjectType: 'market', subjectId: M, step: 'resolve' });
  sqlite.prepare("UPDATE proto_settlement_intents SET status = 'prepared', prepared_txid = ?, prepared_tx_json = '[]' WHERE intent_key = ?").run(hex('c' + M), settlementIntentKeyFor('market', M, 'resolve'));
  const fi = ensureSettlementIntent({ subjectType: 'market', subjectId: M, step: 'refund_flip' });
  markSettlementIntent(fi.intent_key, { status: 'submitted', submitted_txid: hex('flip' + M) }); markSettlementIntent(fi.intent_key, { status: 'landed' });
  ok(store.listWork().effectsPending.some((r) => r.subject_id === M && r.step === 'refund_flip'), 'landed ∧ 市场仍 sealed ⇒ 进 effectsPending');
  const r1 = store.markLanded('refund_flip', getSettlementIntent(fi.intent_key));
  ok(r1.cancelled === 1 && r1.claimsCreated === 2 && r1.closeMarked === 1, `首次: cancelled=1 claims=2 closeMarked=1(实际 ${JSON.stringify(r1)})`);
  const r2 = store.markLanded('refund_flip', getSettlementIntent(fi.intent_key));
  ok(r2.cancelled === 0 && r2.claimsCreated === 0 && r2.closeMarked === 0, `重跑幂等: 全 0(实际 ${JSON.stringify(r2)})`);
  ok(sqlite.prepare("SELECT COUNT(*) AS n FROM proto_claims WHERE market_id = ? AND side = 'refund'").get(M).n === 2, 'refund claim 恰 2 行(重跑不重复)');
  ok(sqlite.prepare("SELECT status, last_error FROM proto_settlement_intents WHERE intent_key = ?").get(settlementIntentKeyFor('market', M, 'resolve')).status === 'ambiguous', '未广播的 close(F1 prepared HOLD 行)被标 ambiguous(不重播不重建)');
  ok(!store.listWork().effectsPending.some((r) => r.subject_id === M && r.step === 'refund_flip'), '已 cancelled ⇒ 不再进 effectsPending');
  ok(!advances().includes(M), '已 cancelled ⇒ 不再被选为 refund_flip 工作');
  // 事务性: 缺 ticket ⇒ 整体回滚, 市场仍 sealed(HOLD)
  const H = mid('ml-hold'); seedMarket(H); seedBet(H, 0, { ticketTxid: null, ticketVout: null }); sealLanded(H); freezeMarket({ db: sqlite, marketId: H, reason: 'x', pmt: null, wallMs: Date.now(), log: quiet });
  const hi = ensureSettlementIntent({ subjectType: 'market', subjectId: H, step: 'refund_flip' }); markSettlementIntent(hi.intent_key, { status: 'submitted', submitted_txid: hex('flip' + H) }); markSettlementIntent(hi.intent_key, { status: 'landed' });
  let e = null; try { store.markLanded('refund_flip', getSettlementIntent(hi.intent_key)); } catch (x) { e = x; }
  ok(!!e && sqlite.prepare('SELECT status FROM proto_markets WHERE id = ?').get(H).status === 'sealed' && sqlite.prepare("SELECT COUNT(*) AS n FROM proto_claims WHERE market_id = ?").get(H).n === 0, '缺 ticket ⇒ markLanded 抛, 市场仍 sealed、零 claim(整体回滚)');
  ok(store.listWork().effectsPending.some((r) => r.subject_id === H && r.step === 'refund_flip'), '⇒ 后效每 tick 重跑(进 effectsPending, 由 core 报警) = HOLD');
  // M1: 已 cancelled 的遗留行(主网手置)不被写
  const L = mid('ml-legacy'); seedMarket(L, 'cancelled'); seedBet(L, 0);
  const li = ensureSettlementIntent({ subjectType: 'market', subjectId: L, step: 'refund_flip' }); markSettlementIntent(li.intent_key, { status: 'submitted', submitted_txid: hex('x') }); markSettlementIntent(li.intent_key, { status: 'landed' });
  const rl = store.markLanded('refund_flip', getSettlementIntent(li.intent_key));
  ok(rl.cancelled === 0 && rl.claimsCreated === 0 && sqlite.prepare("SELECT COUNT(*) AS n FROM proto_claims WHERE market_id = ?").get(L).n === 0, 'M1 前态谓词: 已 cancelled 的遗留市场 ⇒ 不写状态、不建 claim');
}

console.log('[test] ④ M5 recordObservedRefundFlip: 幂等记 landed(txid=探针读回)+ 自动冻结(refund_flip_observed, 单向); 已有 own 行 txid 不同⇒留痕:');
{
  const M = mid('obs'); seedMarket(M); seedBet(M, 0); sealLanded(M);
  const txid = hex('third-party-flip');
  let e = null; try { store.recordObservedRefundFlip({ marketId: M, probe: { flipped: false } }); } catch (x) { e = x; }
  ok(!!e, 'probe.flipped != true ⇒ 拒(不据未确认的读数动状态)');
  const r1 = store.recordObservedRefundFlip({ marketId: M, probe: { flipped: true, txid, depth: 7 }, log: quiet });
  const row = getSettlementIntent(settlementIntentKeyFor('market', M, 'refund_flip'));
  ok(r1.recorded === 1 && r1.frozenNow === true && row.status === 'landed' && row.submitted_txid === txid && row.landed_depth === 7, `记 landed(txid/深度)+ 冻结(实际 ${JSON.stringify(r1)} ${row.status} ${row.submitted_txid?.slice(0, 8)})`);
  const mk = sqlite.prepare('SELECT settlement_frozen_at, frozen_reason FROM proto_markets WHERE id = ?').get(M);
  ok(mk.settlement_frozen_at != null && /^refund_flip_observed\|clock=/.test(mk.frozen_reason), `自动冻结 reason=refund_flip_observed(实际 ${mk.frozen_reason})`);
  const r2 = store.recordObservedRefundFlip({ marketId: M, probe: { flipped: true, txid, depth: 9 }, log: quiet });
  ok(r2.recorded === 0 && r2.frozenNow === false, '重复调用幂等(不重记、不覆盖首次冻结)');
  ok(store.listWork().effectsPending.some((r) => r.subject_id === M && r.step === 'refund_flip'), '⇒ effectsPending 接手(markLanded 走同一条既有路径)');
  // own 行(prepared, 别的 txid)被别人先翻
  const O = mid('obs-own'); seedMarket(O); seedBet(O, 0); sealLanded(O);
  const oi = ensureSettlementIntent({ subjectType: 'market', subjectId: O, step: 'refund_flip' }); markSettlementIntent(oi.intent_key, { status: 'prepared', prepared_txid: hex('own-prepared') });
  store.recordObservedRefundFlip({ marketId: O, probe: { flipped: true, txid: hex('someone-else'), depth: 5 }, log: quiet });
  const ro = getSettlementIntent(oi.intent_key);
  ok(ro.status === 'landed' && ro.submitted_txid === hex('someone-else') && /other_txid/.test(ro.last_error), 'own prepared 行 + 别人先翻 ⇒ landed 记观察 txid, last_error 留痕 own 的 txid');
}

console.log(fails === 0 ? '\n✅✅ ALL PASS — refund_flip store(触发/依赖/markLanded/M3 身份守恒/M5 观察)' : `\n❌ ${fails} assertions failed`);
process.exitCode = fails === 0 ? 0 : 1;
