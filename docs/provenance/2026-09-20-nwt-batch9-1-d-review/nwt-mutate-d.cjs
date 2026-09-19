// NWT 批9-1 D 笔(de0e7862) 独立变异: 目标 src/lib/proto-settlement-pointers.mjs(+ inputs/leaf-state 各一), 在 kasia-console/ 下跑; 每个变异后还原并核 sha256。
const fs = require('fs'), cp = require('child_process'), crypto = require('crypto');
const P = 'src/lib/proto-settlement-pointers.mjs', I = 'src/lib/proto-settlement-inputs.mjs';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const orig = { [P]: fs.readFileSync(P, 'utf8'), [I]: fs.readFileSync(I, 'utf8') }; const sha0 = { [P]: sha(orig[P]), [I]: sha(orig[I]) };
const rep = (a, b) => s => { const n = s.split(a).length - 1; if (n !== 1) throw new Error(`pattern matched ${n}x (need 1): ${a.slice(0, 70)}`); return s.replace(a, b); };
const M = [
  [P, 'NWT-d1 finalize() removed (id kept from JSON)', rep("try { tx.finalize(); } catch (e) { throw P('pointer_tx_malformed', `${label}: finalize() 失败: ${e && e.message ? e.message : e}`, ctx); }", "")],
  [P, 'NWT-d2 id != submitted_txid check removed', rep("if (id !== sub) throw P(", "if (false) throw P(")],
  [P, 'NWT-d3 genesis recompute compare removed', rep("if (o.genesisId === null || o.genesisId !== o.covenantId) throw", "if (false) throw")],
  [P, 'NWT-d4 genesis recompute uses output index 0 not i', rep("[{ index: i, output: new kaspa.TransactionOutput(o.value, o.scriptPublicKey) }]", "[{ index: 0, output: new kaspa.TransactionOutput(o.value, o.scriptPublicKey) }]")],
  [P, 'NWT-d5 spends() compares txid only (index ignored)', rep("i.txid === want.transactionId && i.index === want.index", "i.txid === want.transactionId")],
  [P, 'NWT-d6 convert lineage: held input (seal token) not checked', rep("if (!spends(V, CONVERT_TO_CLAIM_ROOTCLOSE_IN_INDEX, cell4.outpoint) || !spends(V, CONVERT_TO_CLAIM_HELD_IN_INDEX, cell5.outpoint)) {", "if (!spends(V, CONVERT_TO_CLAIM_ROOTCLOSE_IN_INDEX, cell4.outpoint)) {")],
  [P, 'NWT-d7 seal lineage: held input not checked', rep("if (!spends(S, MARKET_SEAL_LEAF_IN_INDEX, leaf.outpoint) || !spends(S, MARKET_SEAL_HELD_IN_INDEX, held.outpoint)) {", "if (!spends(S, MARKET_SEAL_LEAF_IN_INDEX, leaf.outpoint)) {")],
  [P, 'NWT-d8 ticket spk recompute check removed', rep("if (tOut.spkHex !== wantSpk) throw bad(", "if (false) throw bad(")],
  [P, 'NWT-d9 ticket: proto_bets.ticket_txid cross-check removed', rep("if (!betRow || lc(betRow.ticket_txid) !== T.id) throw bad(", "if (false) throw bad(")],
  [P, 'NWT-d10 ticket: proto_bets.ticket_vout cross-check removed', rep("if (Number(betRow.ticket_vout) !== REGISTER_APPEND_TICKET_OUT_INDEX) throw bad(", "if (false) throw bad(")],
  [P, 'NWT-d11 ticket: covenant-free check removed', rep("if (tOut.covenantId !== null) throw bad(", "if (false) throw bad(")],
  [P, 'NWT-d12 pointer own latest-append ORDER BY loses rowid tiebreak', rep("ORDER BY pbi.landed_at DESC, pbi.rowid DESC LIMIT 1", "ORDER BY pbi.landed_at DESC LIMIT 1")],
  [P, 'NWT-d13 leaf covenant vs shardleaf_cov_id check removed', rep("if (lo.covenantId === null || lo.covenantId !== shardCovId) {", "if (false) {")],
  [P, 'NWT-d14 close_commit continuation covenant equality removed', rep("if (ccRc.covenantId === null || ccRc.covenantId !== cell3.expectedCovenantId) {", "if (false) {")],
  [P, 'NWT-d15 tx.free() never called (resource hygiene)', rep("try { tx.free(); } catch { /* 已释放 */ }", "")],
  [P, 'NWT-d16 append query drops status=landed filter', rep("WHERE pb.market_id = ? AND pbi.step = 'append' AND pbi.status = 'landed'", "WHERE pb.market_id = ? AND pbi.step = 'append'")],
  [P, 'NWT-d17 winner ticket taken from latest append (not winner bet)', rep("const tRow = landedAppendOfBet(db, bet.id);", "const tRow = latestLandedAppend(db, marketId);")],
  [P, 'NWT-d18 winner derive failure not mapped (raw error escapes)', rep("catch (e) { throw P('pointer_winner_ambiguous', e && e.message ? e.message : String(e), ctx('ticket')); }", "catch (e) { throw e; }")],
];
const TESTS = ['proto-settlement-pointers', 'proto-settlement-inputs'];
const out = [];
for (const [file, n, fn] of M) {
  let m; try { m = fn(orig[file]); } catch (e) { out.push('?? ' + n + ' :: ' + e.message); continue; }
  fs.writeFileSync(file, m);
  const res = TESTS.map((t) => { const r = cp.spawnSync('node', [`src/lib/${t}.test.mjs`], { encoding: 'utf8', timeout: 180000 }); const f = ((r.stdout || '').match(/\[FAIL\]/g) || []).length; return t.replace('proto-settlement-', '') + ':' + (r.status === 0 ? 'ok' : 'RED(f=' + f + ')'); });
  out.push((res.some((x) => x.includes('RED')) ? 'killed   ' : 'SURVIVED ') + n + '   ' + res.join(' '));
  fs.writeFileSync(file, orig[file]);
}
for (const f of Object.keys(orig)) fs.writeFileSync(f, orig[f]);
console.log(out.join('\n')); console.log('restored identical: ' + Object.keys(orig).every((f) => sha(fs.readFileSync(f, 'utf8')) === sha0[f]));
