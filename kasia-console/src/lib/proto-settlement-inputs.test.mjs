// proto-settlement-inputs.test.mjs — B4-4 驱动层 MUST 的先行测试(Bettor 前置②): newWinningSide / payoutRoot 由 DB 派生,
// Σ payouts == pool_value, 拟签值与派生值不符即拒绝。真 migration 临时库, 零链零 IPC。
// Run: cd kasia-console && node src/lib/proto-settlement-inputs.test.mjs
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_SETTLEMENT_INPUTS_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_settle_inputs_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_SETTLEMENT_INPUTS_TEST_BOOTSTRAPPED: '1' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}
const { sqlite } = await import('../db/client.js');
const { payoutLeafHex, deriveCloseCommitInputs, deriveWinnerBet, assertCloseCommitArgsFromDb, CLAIM_PAYOUT_MIN } = await import('./proto-settlement-inputs.mjs');
const { createRequire } = await import('node:module');
const { blake2b } = createRequire(import.meta.url)('../../node_modules/@noble/hashes/blake2b.js');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const throws = (fn, re) => { let e = null; try { fn(); } catch (x) { e = x; } if (!e) throw new Error('应该throw, 却成功返回了'); if (!re.test(e.message)) throw new Error(`throw了但报文不对: ${e.message}`); };

const now = new Date().toISOString();
sqlite.prepare(`INSERT INTO proto_token_defs (id,name,ticker,created_at) VALUES (?,?,?,?)`).run('tok1', 'Test', 'TST', now);
function mkMarket(id, { status = 'sealed', winning_side = null, payout_root = null } = {}) {
  sqlite.prepare(`INSERT INTO proto_markets (id, token_def_id, question, deadline_ms, min_bet, seal_count, committee_pubkeys_json, committee_privkey_enc, rootclose_tmpl_hash, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, 'tok1', 'q?', 1700000000000, 1, 2, '[]', 'enc', 'aa'.repeat(32), now, now);
  sqlite.prepare('UPDATE proto_markets SET status = ?, winning_side = ?, payout_root = ? WHERE id = ?').run(status, winning_side, payout_root, id);
}
let betSeq = 0;
function mkBet({ marketId, pk, side, stake, status = 'confirmed' }) {
  sqlite.prepare(`INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, status, created_at) VALUES (?,?,?,?,?,?,?)`).run(`b${++betSeq}`, marketId, pk, side, stake, status, now);
}
const PK_YES = '11'.repeat(32), PK_NO = '22'.repeat(32);

// ── payoutLeaf: 独立复算(另一条组合路径 + 标准已知答案向量) ──
t('blake2b-256 标准已知答案向量(空串)= 0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8(先证明库本身对)', () => {
  const h = Buffer.from(blake2b(new Uint8Array(0), { dkLen: 32 })).toString('hex');
  if (h !== '0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8') throw new Error(h);
});
t('payoutLeafHex 与独立组合(用 writeUInt32LE 拆高低位, 不走 writeBigUInt64LE)逐位相等: payout=1000 与 payout=2^32+5', () => {
  for (const payout of [1000, 2 ** 32 + 5]) {
    const le8 = Buffer.alloc(8); le8.writeUInt32LE(payout % 2 ** 32, 0); le8.writeUInt32LE(Math.floor(payout / 2 ** 32), 4);
    const want = Buffer.from(blake2b(Uint8Array.from(Buffer.concat([Buffer.from(PK_NO, 'hex'), le8])), { dkLen: 32 })).toString('hex');
    if (payoutLeafHex(PK_NO, payout) !== want) throw new Error(`payout=${payout} 不一致`);
  }
  if (payoutLeafHex(PK_NO, 1000) === payoutLeafHex(PK_YES, 1000)) throw new Error('不同 pk 必须给出不同 leaf');
  if (payoutLeafHex(PK_NO, 1000) === payoutLeafHex(PK_NO, 1001)) throw new Error('不同 payout 必须给出不同 leaf');
});

// ── route A 市场: YES=1, NO=999(池 1000 = CLAIM_PAYOUT_MIN 边界), NO 赢 ──
mkMarket('m_ok', { winning_side: 1 });
mkBet({ marketId: 'm_ok', pk: PK_YES, side: 0, stake: 1 });
mkBet({ marketId: 'm_ok', pk: PK_NO, side: 1, stake: 999 });
let derived;
t('正向: DB 派生 newWinningSide=1, payouts=[{NO 的 pk, 1000}], Σpayouts==pool_value(1000), payoutRoot==leaf(NO 的 pk, 1000)', () => {
  derived = deriveCloseCommitInputs('m_ok');
  if (derived.newWinningSide !== 1 || derived.poolValue !== 1000) throw new Error(JSON.stringify(derived));
  if (derived.payouts.length !== 1 || derived.payouts[0].payout !== 1000 || derived.payouts[0].bettorPk !== PK_NO) throw new Error(JSON.stringify(derived.payouts));
  if (derived.newPayoutRootHex !== payoutLeafHex(PK_NO, 1000)) throw new Error('payoutRoot != leaf');
  if (derived.payouts.reduce((s, p) => s + p.payout, 0) !== derived.poolValue) throw new Error('Σ payouts != pool_value');
});
t('正向: assertCloseCommitArgsFromDb 对与派生值相同的拟签值放行', () => {
  assertCloseCommitArgsFromDb('m_ok', { newWinningSide: derived.newWinningSide, newPayoutRootHex: derived.newPayoutRootHex, expectedPoolValue: derived.poolValue });
  assertCloseCommitArgsFromDb('m_ok', { newWinningSide: 1, newPayoutRootHex: '0x' + derived.newPayoutRootHex.toUpperCase(), expectedPoolValue: 1000 }); // 0x/大小写按字节相等
});
t('反向1: 拟签胜方与 DB 派生不符(签成 YES 赢) ⇒ close_commit_args_not_from_db(签名预言机被喂了别的结果)', () => {
  throws(() => assertCloseCommitArgsFromDb('m_ok', { newWinningSide: 0, newPayoutRootHex: derived.newPayoutRootHex, expectedPoolValue: 1000 }), /close_commit_args_not_from_db.*newWinningSide/);
});
t('反向2: 拟签 payoutRoot 与现算不符(占位值/别人的 pk 的 leaf/金额差 1) ⇒ close_commit_args_not_from_db', () => {
  throws(() => assertCloseCommitArgsFromDb('m_ok', { newWinningSide: 1, newPayoutRootHex: 'cd'.repeat(32), expectedPoolValue: 1000 }), /close_commit_args_not_from_db.*newPayoutRootHex/);
  throws(() => assertCloseCommitArgsFromDb('m_ok', { newWinningSide: 1, newPayoutRootHex: payoutLeafHex(PK_YES, 1000), expectedPoolValue: 1000 }), /close_commit_args_not_from_db/);
  throws(() => assertCloseCommitArgsFromDb('m_ok', { newWinningSide: 1, newPayoutRootHex: payoutLeafHex(PK_NO, 999), expectedPoolValue: 1000 }), /close_commit_args_not_from_db/);
  throws(() => assertCloseCommitArgsFromDb('m_ok', { newWinningSide: 1, newPayoutRootHex: undefined, expectedPoolValue: 1000 }), /close_commit_args_not_from_db/);
});

t('C2 反向: expectedPoolValue 缺失 / 非整数 / 与 DB 派生的 pool_value 不等(spk 按别的池子证明) ⇒ close_commit_args_not_from_db', () => {
  const ok = { newWinningSide: 1, newPayoutRootHex: derived.newPayoutRootHex };
  throws(() => assertCloseCommitArgsFromDb('m_ok', ok), /expectedPoolValue.*缺失或非法/);
  throws(() => assertCloseCommitArgsFromDb('m_ok', { ...ok, expectedPoolValue: '1000' }), /缺失或非法/);
  throws(() => assertCloseCommitArgsFromDb('m_ok', { ...ok, expectedPoolValue: 999 }), /pool_value\(999\) != .*\(1000\)/);
  throws(() => assertCloseCommitArgsFromDb('m_ok', { ...ok, expectedPoolValue: 1001 }), /pool_value\(1001\)/);
  assertCloseCommitArgsFromDb('m_ok', { ...ok, expectedPoolValue: 1000 }); // 对照: 相等放行
});

// ── 各类 fail-closed ──
mkMarket('m_nowin', { winning_side: null });
mkBet({ marketId: 'm_nowin', pk: PK_YES, side: 0, stake: 500 }); mkBet({ marketId: 'm_nowin', pk: PK_NO, side: 1, stake: 500 });
t('反向3: winning_side 未写入 DB(操作员还没裁决) ⇒ fail-closed(不接受调用方临时传入胜方)', () => { throws(() => deriveCloseCommitInputs('m_nowin'), /winning_side/); });

mkMarket('m_betting', { status: 'betting', winning_side: 1 });
mkBet({ marketId: 'm_betting', pk: PK_YES, side: 0, stake: 500 }); mkBet({ marketId: 'm_betting', pk: PK_NO, side: 1, stake: 500 });
t('反向4: 市场状态不是 sealed(market_seal 未落链) ⇒ fail-closed', () => { throws(() => deriveCloseCommitInputs('m_betting'), /sealed/); throws(() => deriveCloseCommitInputs('m_不存在'), /市场不存在/); });

mkMarket('m_twowin', { winning_side: 1 });
mkBet({ marketId: 'm_twowin', pk: PK_YES, side: 0, stake: 500 }); mkBet({ marketId: 'm_twowin', pk: PK_NO, side: 1, stake: 300 }); mkBet({ marketId: 'm_twowin', pk: '33'.repeat(32), side: 1, stake: 200 });
t('反向5: 胜方有 2 条已确认下注((A) 路线要求恰好 1 条) ⇒ fail-closed, 不自动挑一个', () => { throws(() => deriveCloseCommitInputs('m_twowin'), /恰好 1 条/); });

mkMarket('m_nowinner', { winning_side: 1 });
mkBet({ marketId: 'm_nowinner', pk: PK_YES, side: 0, stake: 1000 });
t('反向6: 胜方没有任何已确认下注 ⇒ fail-closed', () => { throws(() => deriveCloseCommitInputs('m_nowinner'), /有 0 条/); });

mkMarket('m_pending', { winning_side: 1 });
mkBet({ marketId: 'm_pending', pk: PK_YES, side: 0, stake: 600 }); mkBet({ marketId: 'm_pending', pk: PK_NO, side: 1, stake: 400 }); mkBet({ marketId: 'm_pending', pk: '44'.repeat(32), side: 1, stake: 9999, status: 'pending' });
t('正向: pending/未落链的下注不计入(只信 confirmed): 池=1000, 胜方仍恰好 1 条', () => { const d = deriveCloseCommitInputs('m_pending'); if (d.poolValue !== 1000 || d.payouts[0].bettorPk !== PK_NO) throw new Error(JSON.stringify(d)); });

mkMarket('m_small', { winning_side: 1 });
mkBet({ marketId: 'm_small', pk: PK_YES, side: 0, stake: 1 }); mkBet({ marketId: 'm_small', pk: PK_NO, side: 1, stake: 998 });
t(`反向7: payout(999) < ${CLAIM_PAYOUT_MIN}(RootClaim.sil:103 require(payout>=1000) 永远无法满足) ⇒ fail-closed, 不签会把池子锁死的 close_commit`, () => { throws(() => deriveCloseCommitInputs('m_small'), /永远无法满足/); });

mkMarket('m_drift', { winning_side: 1, payout_root: 'ee'.repeat(32) });
mkBet({ marketId: 'm_drift', pk: PK_YES, side: 0, stake: 1 }); mkBet({ marketId: 'm_drift', pk: PK_NO, side: 1, stake: 999 });
t('反向8: proto_markets.payout_root 已落库但与现算不一致 ⇒ db_payout_root_drift(库里记一个值、要签另一个值的分裂)', () => { throws(() => deriveCloseCommitInputs('m_drift'), /db_payout_root_drift/); });
mkMarket('m_dbok', { winning_side: 1, payout_root: payoutLeafHex(PK_NO, 1000) });
mkBet({ marketId: 'm_dbok', pk: PK_YES, side: 0, stake: 1 }); mkBet({ marketId: 'm_dbok', pk: PK_NO, side: 1, stake: 999 });
t('正向: payout_root 已落库且与现算一致 ⇒ 通过(对照上一条, 证明 drift 拒绝不是别的原因)', () => { deriveCloseCommitInputs('m_dbok'); });

// ══ 9-1 D 笔: deriveWinnerBet(从 deriveCloseCommitInputs 抽出的"胜方恰 1 条已确认下注", 与 proto-settlement-pointers.mjs 的 claim_draw 取赢家票共用) ══
// 既有 15 条用例一字未改(它们是"抽出后 deriveCloseCommitInputs 的行为与报文不变"的证据); 以下是新增用例。
const errOf = (fn) => { let e = null; try { fn(); } catch (x) { e = x; } if (!e) throw new Error('应该throw, 却成功返回了'); return e; };
const bodyOf = (e) => e.message.replace(/^[^:]+: /, '');            // 去掉 "who: " 前缀, 比较报文正文
const seqBefore = () => betSeq;
mkMarket('w_ok', { status: 'resolved', winning_side: 1 });          // resolved: claim_draw 取赢家票指针时市场已不是 sealed
mkBet({ marketId: 'w_ok', pk: PK_YES, side: 0, stake: 1 }); mkBet({ marketId: 'w_ok', pk: PK_NO, side: 1, stake: 999 });
const w_ok_winnerId = `b${betSeq}`;
t('deriveWinnerBet 胜方恰 1 条 ⇒ 返回赢家那一行 + pool_value + market; 【不带 status 闸】(resolved 市场也可取)', () => {
  const r = deriveWinnerBet('w_ok');
  if (r.winner.id !== w_ok_winnerId || r.winner.side !== 1 || r.winner.stake !== 999 || r.winner.bettor_pk !== PK_NO) throw new Error(JSON.stringify(r.winner));
  if (r.poolValue !== 1000 || r.bets.length !== 2 || r.market.status !== 'resolved' || r.market.winning_side !== 1) throw new Error(JSON.stringify({ p: r.poolValue, n: r.bets.length, m: r.market }));
});
t('status 闸留在 close_commit 一侧: 同一个 resolved 市场, deriveCloseCommitInputs 仍拒(报文含 sealed), deriveWinnerBet 不拒', () => {
  throws(() => deriveCloseCommitInputs('w_ok'), /close_commit 只允许在 sealed/);
  deriveWinnerBet('w_ok');
});
mkMarket('w_sealed', { status: 'sealed', winning_side: 1 });
mkBet({ marketId: 'w_sealed', pk: PK_YES, side: 0, stake: 1 }); mkBet({ marketId: 'w_sealed', pk: PK_NO, side: 1, stake: 999 });
t('deriveCloseCommitInputs 的 winnerBetId 就是 deriveWinnerBet 的 winner.id(同一份逻辑, 不是两份各自算)', () => {
  if (deriveCloseCommitInputs('w_sealed').winnerBetId !== deriveWinnerBet('w_sealed').winner.id) throw new Error('两处选出的赢家不一致');
});
mkMarket('w_zero', { status: 'sealed', winning_side: 1 });
mkBet({ marketId: 'w_zero', pk: PK_YES, side: 0, stake: 1 }); mkBet({ marketId: 'w_zero', pk: PK_YES, side: 0, stake: 5 });
mkMarket('w_two', { status: 'sealed', winning_side: 1 });
mkBet({ marketId: 'w_two', pk: PK_NO, side: 1, stake: 3 }); mkBet({ marketId: 'w_two', pk: PK_NO, side: 1, stake: 4 });
t('胜方 0 条 / 2 条 ⇒ 同样的 fail-closed(.code=winner_count), 报文正文与 deriveCloseCommitInputs 的逐字一致', () => {
  for (const id of ['w_zero', 'w_two']) {
    const a = errOf(() => deriveWinnerBet(id)), b = errOf(() => deriveCloseCommitInputs(id));
    if (a.code !== 'winner_count') throw new Error(`${id}: code=${a.code}`);
    if (!/恰好 1 条/.test(a.message) || !/refusing to auto-pick one/.test(a.message)) throw new Error(a.message);
    if (bodyOf(a) !== bodyOf(b)) throw new Error(`${id}: 报文正文不一致:\n  ${bodyOf(a)}\n  ${bodyOf(b)}`);
  }
  if (!/有 0 条/.test(errOf(() => deriveWinnerBet('w_zero')).message) || !/有 2 条/.test(errOf(() => deriveWinnerBet('w_two')).message)) throw new Error('条数应写进报文');
});
mkMarket('w_noside', { status: 'sealed', winning_side: null });
mkBet({ marketId: 'w_noside', pk: PK_NO, side: 1, stake: 9 });
mkMarket('w_nopool', { status: 'sealed', winning_side: 1 });
t('其余 fail-closed 各带 .code: winning_side 未写 ⇒ winner_side_unset; 没有已确认下注 ⇒ winner_pool_empty; 市场不存在 ⇒ winner_market_missing; 默认报文前缀 deriveWinnerBet(<id>), deriveCloseCommitInputs 传自己的前缀', () => {
  const cases = [['w_noside', 'winner_side_unset'], ['w_nopool', 'winner_pool_empty'], ['w_不存在', 'winner_market_missing']];
  for (const [id, code] of cases) {
    const e = errOf(() => deriveWinnerBet(id));
    if (e.code !== code) throw new Error(`${id}: code=${e.code}`);
    if (!e.message.startsWith(`deriveWinnerBet(${id}): fail-closed — `)) throw new Error(e.message);
  }
  if (!errOf(() => deriveCloseCommitInputs('w_noside')).message.startsWith('deriveCloseCommitInputs(w_noside): fail-closed — ')) throw new Error('deriveCloseCommitInputs 的报文前缀变了');
});
t('pending / orphaned 等非 confirmed 的下注不计入(只信已确认): 胜方那条是 pending ⇒ 0 条 ⇒ winner_count', () => {
  mkMarket('w_pend', { status: 'sealed', winning_side: 1 });
  mkBet({ marketId: 'w_pend', pk: PK_YES, side: 0, stake: 1 }); mkBet({ marketId: 'w_pend', pk: PK_NO, side: 1, stake: 999, status: 'pending' });
  if (errOf(() => deriveWinnerBet('w_pend')).code !== 'winner_count') throw new Error('应为 winner_count');
});
void seqBefore;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
