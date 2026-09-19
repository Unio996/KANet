// mutate-f3.mjs — 9-1 F3 笔(NWT D 笔审 D-1 free 计数 / D-2 import 图脱离 DB 客户端)的变异对照(J2 2026-09-20)。
// 由 D 笔的 mutate-d.mjs 演化而来: deriveWinnerBet 的本体搬到 proto-winner-bet.mjs, 相关旧变异已改目标文件/锚点; F3 新增 F-xx。分 --part=1|2 两批。
// 每个变异指明【目标文件】与【要跑的测试】(可多个); 破坏目标文件后跑这些测试, 期望至少一条 [FAIL](或进程异常退出)。
// 每个锚点必须在目标文件里恰好命中 1 次(否则 [ERR ]: 变异脚本与源码不同步); 每个目标文件在 finally 里还原并核对 sha256。
// 运行: node docs/provenance/2026-09-20-j2-batch9-1-d-pointers/mutate-d.mjs <worktree 根绝对路径>
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOT = process.argv[2];
const PART = (process.argv.find((a) => a.startsWith('--part=')) || '--part=0').slice(7);   // 0 = 全部
const LIB = `${ROOT}/kasia-console/src/lib`;
const FILES = { ptr: `${LIB}/proto-settlement-pointers.mjs`, inp: `${LIB}/proto-settlement-inputs.mjs`, leaf: `${LIB}/proto-leaf-state.mjs`, wb: `${LIB}/proto-winner-bet.mjs`, asm: `${LIB}/proto-tx-assembly.mjs` };
const TESTS = { ptr: 'proto-settlement-pointers.test.mjs', inp: 'proto-settlement-inputs.test.mjs', leaf: 'proto-leaf-state.test.mjs' };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const origs = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, fs.readFileSync(p)]));
const origShas = Object.fromEntries(Object.entries(origs).map(([k, b]) => [k, sha(b)]));
const texts = Object.fromEntries(Object.entries(origs).map(([k, b]) => [k, b.toString('utf8')]));
const runTest = (name) => spawnSync(process.execPath, [`src/lib/${name}`], { cwd: `${ROOT}/kasia-console`, encoding: 'utf8', timeout: 240000 });

// [名称, 目标文件键, [[find, repl]…], [测试键…]]
const P = ['ptr'], PI = ['inp', 'ptr'], PL = ['ptr', 'leaf'];
const muts = [
  // ── 产出交易的装载与完整性 ──
  ['M-01 ▲ 去掉 finalize()(deserializeFromSafeJSON 沿用 JSON 自带 id, 篡改后 id 不变——txid 断言成空判据)', 'ptr', [['tx.finalize();', 'void 0;']], P],
  ['M-02 ▲ 不再比对 finalize 后的 id 与 submitted_txid', 'ptr', [['if (id !== sub) throw P(', 'if (false) throw P(']], P],
  ['M-03 prepared_tx_json 为空不再报 tx_missing', 'ptr', [["if (typeof row.prepared_tx_json !== 'string' || !row.prepared_tx_json.trim()) throw P('pointer_tx_missing'", "if (false) throw P('pointer_tx_missing'"]], P],
  ['M-04 反序列化失败的码串成 tx_missing', 'ptr', [["throw P('pointer_tx_malformed', `${label}: prepared_tx_json 反序列化失败", "throw P('pointer_tx_missing', `${label}: prepared_tx_json 反序列化失败"]], P],
  ['M-05 ▲ seal/resolve/convert_to_claim 意图的查询去掉 status=\'landed\' 过滤(submitted 的也被当成已落链)', 'ptr', [["WHERE subject_type = 'market' AND subject_id = ? AND step = ? AND status = 'landed'", "WHERE subject_type = 'market' AND subject_id = ? AND step = ?"]], P],
  ['M-05b ▲ 最新 append 的查询去掉 status=\'landed\' 过滤(未落链的 append 被当成最新)', 'ptr', [["WHERE pb.market_id = ? AND pbi.step = 'append' AND pbi.status = 'landed'", "WHERE pb.market_id = ? AND pbi.step = 'append'"]], P],
  ['M-05c ▲ 赢家那条下注的 append 查询去掉 status=\'landed\' 过滤', 'ptr', [["WHERE bet_id = ? AND step = 'append' AND status = 'landed'", "WHERE bet_id = ? AND step = 'append'"]], P],
  ['M-06 submitted_txid 缺失/非法不再拒', 'ptr', [["if (!HEX64.test(sub)) throw P('pointer_txid_mismatch'", "if (false) throw P('pointer_txid_mismatch'"]], P],
  ['M-07 前置意图行缺失时不抛 not_landed 而是读 undefined(去掉 !row 守卫)', 'ptr', [["if (!row) throw P('pointer_dependency_not_landed'", "if (false) throw P('pointer_dependency_not_landed'"]], P],
  // ── genesis 独立重算 / covenantId 一致 ──
  ['M-08 ▲ 不再比对 genesis 组输出的独立重算 covenantId(builder 派生 bug 无人发现)', 'ptr', [["if (o.genesisId === null || o.genesisId !== o.covenantId) throw P(", "if (false) throw P("]], P],
  ['M-09 ▲ close_commit 续约输出的 covenantId 不再与 seal 输出 0 比对', 'ptr', [["if (ccRc.covenantId === null || ccRc.covenantId !== cell3.expectedCovenantId) {", 'if (false) {']], P],
  ['M-10 ▲ append leaf 续约输出的 covenantId 不再与 proto_markets.shardleaf_cov_id 比对', 'ptr', [["if (lo.covenantId === null || lo.covenantId !== shardCovId) {", 'if (false) {']], P],
  // ── 谱系(只读 previousOutpoint) ──
  ['M-11 ▲ seal 的谱系只查 leaf 输入、不查 held 输入', 'ptr', [['if (!spends(S, MARKET_SEAL_LEAF_IN_INDEX, leaf.outpoint) || !spends(S, MARKET_SEAL_HELD_IN_INDEX, held.outpoint)) {', 'if (!spends(S, MARKET_SEAL_LEAF_IN_INDEX, leaf.outpoint)) {']], P],
  ['M-12 seal 的谱系只查 held 输入、不查 leaf 输入', 'ptr', [['if (!spends(S, MARKET_SEAL_LEAF_IN_INDEX, leaf.outpoint) || !spends(S, MARKET_SEAL_HELD_IN_INDEX, held.outpoint)) {', 'if (!spends(S, MARKET_SEAL_HELD_IN_INDEX, held.outpoint)) {']], P],
  ['M-13 ▲ 谱系比对只看 txid、不看 index(N-T1 同族)', 'ptr', [['return !!i && i.txid === want.transactionId && i.index === want.index;', 'return !!i && i.txid === want.transactionId;']], P],
  ['M-14 ▲ close_commit 的谱系检查整个拆掉', 'ptr', [['if (!spends(CC, CLOSE_COMMIT_ROOTCLOSE_IN_INDEX, cell3.outpoint)) {', 'if (false) {']], P],
  ['M-15 ▲ convert_to_claim 的谱系检查整个拆掉', 'ptr', [['if (!spends(V, CONVERT_TO_CLAIM_ROOTCLOSE_IN_INDEX, cell4.outpoint) || !spends(V, CONVERT_TO_CLAIM_HELD_IN_INDEX, cell5.outpoint)) {', 'if (false) {']], P],
  ['M-16 convert_to_claim 的谱系只查 rootClose 输入', 'ptr', [['if (!spends(V, CONVERT_TO_CLAIM_ROOTCLOSE_IN_INDEX, cell4.outpoint) || !spends(V, CONVERT_TO_CLAIM_HELD_IN_INDEX, cell5.outpoint)) {', 'if (!spends(V, CONVERT_TO_CLAIM_ROOTCLOSE_IN_INDEX, cell4.outpoint)) {']], P],
  // ── 输出下标 / 意图步骤名 ──
  ['M-17 ▲ 格 5(convert_to_claim·held)取了 seal 的输出 0 而不是输出 1', 'ptr', [["const sealTok = outAt(S, MARKET_SEAL_TOKEN_OUT_INDEX,", "const sealTok = outAt(S, MARKET_SEAL_ROOTCLOSE_OUT_INDEX,"]], P],
  ['M-18 格 7(claim_draw·held)取了 convert_to_claim 的输出 0 而不是输出 1', 'ptr', [["const vTok = outAt(V, CONVERT_TO_CLAIM_TOKEN_OUT_INDEX,", "const vTok = outAt(V, CONVERT_TO_CLAIM_CLAIM_OUT_INDEX,"]], P],
  ['M-19 close_commit 的意图步骤名写成 close_commit(库里是 resolve)', 'ptr', [["landedSettlement(db, marketId, 'resolve')", "landedSettlement(db, marketId, 'close_commit')"]], P],
  ['M-20 输出下标越界不再报 output_missing(读 undefined)', 'ptr', [["if (!o) throw P('pointer_output_missing'", "if (false) throw P('pointer_output_missing'"]], P],
  // ── 赢家票(格 8) ──
  ['M-21 ▲ 赢家票取"最新 landed 的 append"而不是"赢家那一条下注的 append"', 'ptr', [['const tRow = landedAppendOfBet(db, bet.id);', 'const tRow = latestLandedAppend(db, marketId);']], P],
  ['M-22 ▲ 赢家不是 1 条时 deriveWinnerBet 的原错误直接逃出(不映射成 pointer_winner_ambiguous)', 'ptr', [["catch (e) { throw P('pointer_winner_ambiguous', e && e.message ? e.message : String(e), ctx('ticket')); }", 'catch (e) { throw e; }']], P],
  ['M-23 ▲ 票交叉核对: 不再核 proto_bets.ticket_txid', 'ptr', [["if (!betRow || lc(betRow.ticket_txid) !== T.id) throw bad(", 'if (false) throw bad(']], P],
  ['M-24 ▲ 票交叉核对: 不再核 ticket_vout == 1', 'ptr', [['if (Number(betRow.ticket_vout) !== REGISTER_APPEND_TICKET_OUT_INDEX) throw bad(', 'if (false) throw bad(']], P],
  ['M-25 ▲ 票交叉核对: 不再核输出无 covenant', 'ptr', [['if (tOut.covenantId !== null) throw bad(', 'if (false) throw bad(']], P],
  ['M-26 ▲ 票交叉核对: 不再核输出 spk == 现算 ticket spk', 'ptr', [['if (tOut.spkHex !== wantSpk) throw bad(', 'if (false) throw bad(']], P],
  // ── tiebreak(指针模块自己的查询; leaf-state 两处另列) ──
  ['M-27 ▲ 指针模块的最新 append 查询去掉 rowid tiebreak', 'ptr', [['ORDER BY pbi.landed_at DESC, pbi.rowid DESC LIMIT 1`).get(marketId);', 'ORDER BY pbi.landed_at DESC LIMIT 1`).get(marketId);']], P],
  ['M-28 ▲ proto-leaf-state.deriveLeafOutpoint 去掉 rowid tiebreak', 'leaf', [["ORDER BY pbi.landed_at DESC, pbi.rowid DESC LIMIT 1\n  `).get(marketId);\n  if (row) return", "ORDER BY pbi.landed_at DESC LIMIT 1\n  `).get(marketId);\n  if (row) return"]], P],
  ['M-29 ▲ proto-leaf-state.deriveHeldKttOutpoint 去掉 rowid tiebreak', 'leaf', [["ORDER BY pbi.landed_at DESC, pbi.rowid DESC LIMIT 1\n  `).get(marketId);\n  if (!row) return null;", "ORDER BY pbi.landed_at DESC LIMIT 1\n  `).get(marketId);\n  if (!row) return null;"]], P],
  // ── 类型化错误 / 闭集 / 边界 ──
  ['M-30 闭集少一个码', 'ptr', [["'pointer_winner_ambiguous', 'pointer_ticket_inconsistent',\n  ]);", "'pointer_winner_ambiguous',\n  ]);"]], P],
  ['M-31 错误不再带 .role', 'ptr', [['    this.step = step;\n    this.role = role;', '    this.step = step;']], P],
  ['M-32 模块边界: 引入对 process.env 的读取', 'ptr', [["const HEX64 = /^[0-9a-f]{64}$/;", "const HEX64 = /^[0-9a-f]{64}$/; const _envProbe = process.env.HOME;"]], P],
  ['M-33 ▲ 读取范围: 额外读了不被 txid 覆盖的 signatureScript', 'ptr', [['const inputs = tx.inputs.map((i) => ({ txid:', 'const inputs = tx.inputs.map((i) => ({ _s: i.signatureScript, txid:']], P],
  ['M-34 调用方错误: marketId 大写也放行', 'ptr', [["if (typeof marketId !== 'string' || !HEX64.test(marketId)) throw new TypeError", "if (typeof marketId !== 'string') throw new TypeError"]], P],
  // ── deriveWinnerBet 抽取(Bettor 条件③: deriveCloseCommitInputs 自己重写而不调 deriveWinnerBet 必红) ──
  ['M-35 ▲ deriveCloseCommitInputs 不再调 deriveWinnerBet、自己重写一份(且漏掉"恰 1 条"检查)——两份逻辑分叉', 'inp', [['const { market, poolValue, winner } = deriveWinnerBetPure(marketId, { db, who });',
    "const market = db.prepare('SELECT id, status, winning_side, payout_root FROM proto_markets WHERE id = ?').get(marketId); const bets = db.prepare(`SELECT id, bettor_pk, side, stake FROM proto_bets WHERE market_id = ? AND status = 'confirmed'`).all(marketId); const poolValue = bets.reduce((s, b) => s + b.stake, 0); const winner = bets.filter((b) => b.side === market.winning_side)[0];"]], PI],
  ['M-36 ▲ deriveCloseCommitInputs 自己重写但保留全部检查, 只是 winnerBetId 取错(取第一条下注)——"选出的赢家"分叉', 'inp', [['winnerBetId: winner.id }', 'winnerBetId: deriveWinnerBetPure(marketId, { db }).bets[0].id }']], PI],
  ['M-37 ▲ deriveWinnerBet 胜方条数检查放宽(允许 2 条)', 'wb', [['if (winners.length !== 1) {\n    throw E(', 'if (winners.length < 1) {\n    throw E(']], PI],
  ['M-38 deriveWinnerBet 不再要求 winning_side 已写', 'wb', [["if (market.winning_side !== 0 && market.winning_side !== 1) {\n    throw E('winner_side_unset'", "if (false) {\n    throw E('winner_side_unset'"]], PI],
  ['M-39 ▲ status 闸漏进 deriveWinnerBet(claim_draw 时市场是 resolved, 会必抛)', 'wb', [["if (!market) throw E('winner_market_missing', '市场不存在');", "if (!market) throw E('winner_market_missing', '市场不存在'); if (market.status !== 'sealed') throw E('winner_status', '状态闸漏进来了');"]], PI],
  ['M-40 deriveWinnerBet 的错误不再带 .code', 'wb', [['Object.assign(new Error(`${who}: fail-closed — ${msg}`), { code })', 'new Error(`${who}: fail-closed — ${msg}`)']], PI],
  ['M-41 ▲ deriveCloseCommitInputs 的 sealed 状态闸被拆掉(Bettor 条件①: 非 sealed 仍须拒)', 'inp', [["if (market0.status !== 'sealed') throw new Error(", 'if (false) throw new Error(']], PI],
  ['M-42 deriveWinnerBet 不再只算 confirmed 的下注', 'wb', [["FROM proto_bets WHERE market_id = ? AND status = 'confirmed'`).all(marketId);\n  const poolValue = bets.reduce((s, b) => s + b.stake, 0);\n  if (!(poolValue > 0)) throw E(", "FROM proto_bets WHERE market_id = ?`).all(marketId);\n  const poolValue = bets.reduce((s, b) => s + b.stake, 0);\n  if (!(poolValue > 0)) throw E("]], PI],
  // ══ F3 新增 ══
  ['F-01 ▲ D-1 装载的 Transaction 从不 free', 'ptr', [['try { tx.free(); } catch { /* 已释放 */ }', 'void 0;']], P],
  ['F-02 ▲ D-1 genesis 重算用的 TransactionOutput 从不 free', 'ptr', [['finally { try { probe.free(); } catch { /* 已释放 */ } }', 'finally { void 0; }']], P],
  ['F-03 ▲ D-1 只在成功路径 free(错误路径泄漏)', 'ptr', [["    return { id, inputs, outputs, rowKey: row.intent_key };\n  } finally {\n    try { tx.free(); } catch { /* 已释放 */ }\n  }", "    tx.free();\n    return { id, inputs, outputs, rowKey: row.intent_key };\n  } finally {\n    void 0;\n  }"]], P],
  ['F-04 D-1 同一个 Transaction free 两次', 'ptr', [['try { tx.free(); } catch { /* 已释放 */ }', 'try { tx.free(); tx.free(); } catch { /* 已释放 */ }']], P],
  ['F-05 ▲ D-2 指针模块又经 proto-settlement-inputs 取 deriveWinnerBet(带 db/client.js)', 'ptr', [["import { deriveWinnerBet } from './proto-winner-bet.mjs';", "import { deriveWinnerBet } from './proto-settlement-inputs.mjs';"]], P],
  ['F-06 ▲ D-2 指针模块直接 import DB 客户端', 'ptr', [["import { computeTicketGenesisArtifact } from './proto-covenant-builder.mjs';", "import { computeTicketGenesisArtifact } from './proto-covenant-builder.mjs';\nimport { sqlite as _sqlite } from '../db/client.js';"]], P],
  ['F-07 ▲ D-2 tx-assembly 又从 proto-leaf-state 取 encodeLeafStateBytes(整条链重新被拖进 db/client.js)', 'asm', [["import { encodeLeafStateBytes } from './proto-leaf-state-encode.mjs';", "import { encodeLeafStateBytes } from './proto-leaf-state.mjs';"]], P],
  ['F-08 ▲ D-2 proto-leaf-state 不再 re-export encodeLeafStateBytes(既有 import 方断)', 'leaf', [['export { encodeLeafStateBytes };', 'void 0;']], PL],
  ['F-09 ▲ D-2 winner-bet 的 db 不再必填(无默认库的保证失效)', 'wb', [["if (!db || typeof db.prepare !== 'function') throw new TypeError(", 'if (false) throw new TypeError(']], PI],
  ['F-10 D-2 inputs 的委托丢了默认库(deriveWinnerBet(marketId) 无 db 即抛)', 'inp', [['export function deriveWinnerBet(marketId, { db = sqlite, who } = {}) {', 'export function deriveWinnerBet(marketId, { db, who } = {}) {']], PI],
  ['F-11 D-2 inputs 的委托不透传 who', 'inp', [['return deriveWinnerBetPure(marketId, { db, who });', 'return deriveWinnerBetPure(marketId, { db });']], PI],
  ['F-12 D-2 winner-bet 的默认报文前缀被改', 'wb', [['who = `deriveWinnerBet(${marketId})`', 'who = `winner(${marketId})`']], PI],
];

const partOf = (i) => (PART === '0' ? true : (PART === '1' ? i % 2 === 0 : i % 2 === 1));
const selected = muts.filter((_, i) => partOf(i));
let allRed = true;
const restoreAll = () => { for (const [k, p] of Object.entries(FILES)) fs.writeFileSync(p, origs[k]); };
try {
  const t0 = Date.now();
  for (const k of ['ptr', 'inp', 'leaf']) {
    const r = runTest(TESTS[k]);
    console.log(`基线(未变异) ${TESTS[k]}:`, (r.stdout || '').split('\n').filter((l) => /passed, \d+ failed/.test(l)).pop(), `exit=${r.status}`, k === 'ptr' ? `(${Math.round((Date.now() - t0) / 1000)}s/次)` : '');
    if (r.status !== 0) allRed = false;
  }
  for (const [name, fk, edits, tks] of selected) {
    let cur = texts[fk], bad = false;
    for (const [find, repl] of edits) {
      const c = cur.split(find).length - 1;
      if (c !== 1) { console.log(`[ERR ] ${name}: 变异锚点在 ${fk} 里命中 ${c} 次(需要恰 1 次): ${find.slice(0, 70).replace(/\n/g, '\\n')}`); bad = true; break; }
      cur = cur.replace(find, () => repl);
    }
    if (bad) { allRed = false; continue; }
    fs.writeFileSync(FILES[fk], cur);
    let failedAll = [], crashed = false;
    for (const tk of tks) {
      const r = runTest(TESTS[tk]);
      const out = `${r.stdout || ''}${r.stderr || ''}`;
      failedAll.push(...out.split('\n').filter((l) => l.startsWith('[FAIL]')).map((l) => `${TESTS[tk].replace('proto-settlement-', '').replace('.test.mjs', '')}:${l.replace(/^\[FAIL\]\s*/, '').split(/[ ⇒:]/)[0]}`));
      if (r.status !== 0 && !out.split('\n').some((l) => l.startsWith('[FAIL]'))) crashed = true;
    }
    const red = failedAll.length > 0 || crashed;
    if (!red) allRed = false;
    console.log(`${red ? '[RED ]' : '[GREEN⚠ 变异存活!]'} ${name}  →  ${failedAll.length} 条 FAIL${failedAll.length ? `(首条: ${failedAll[0]})` : ''}${crashed ? '(有测试进程异常退出)' : ''}`);
    fs.writeFileSync(FILES[fk], origs[fk]);
  }
} finally {
  restoreAll();
  for (const [k, p] of Object.entries(FILES)) console.log(sha(fs.readFileSync(p)) === origShas[k] ? `[RESTORED] ${p.split('/').pop()} sha256 ${origShas[k].slice(0, 16)}… 一致` : `[!!! ${p.split('/').pop()} 还原失败 !!!]`);
}
console.log(allRed ? '\n全部变异均被测试抓到' : '\n⚠ 有变异存活或锚点失配, 见上');
process.exit(allRed ? 0 : 1);
