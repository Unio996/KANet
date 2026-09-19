// NWT 批9-1 D 笔: 用【真实 builder 产出的整条链】(proto-claim-draw.test.mjs 里的 bet1/bet2 register_append → seal → close_commit → convert_to_claim)
// 写进临时库, 喂给真实 resolveStepPointers 跑四步, 并与 builder 自己给出的 outpoint / covenantId 对账。J2 的 P 组夹具是"按 builder 布局手造", 不是 builder 真实产物。
// 在 kasia-console/ 下跑; 需先 DB_PATH=<临时库> node scripts/run-migrations.mjs; 生成 src/lib/_nwt_d_probe.test.mjs(未跟踪, 用完删除)。
const fs = require('fs');
const src = fs.readFileSync('src/lib/proto-claim-draw.test.mjs', 'utf8');
const anchor = "const convertToClaim = buildConvertToClaimTxJson(convertArgs());";
if (src.split(anchor).length !== 2) throw new Error('anchor not unique');
const probe = `
{ // ═══ NWT-D probe: REAL builder chain -> temp DB -> REAL resolveStepPointers ═══
  const { sqlite } = await import('../db/client.js');
  const { resolveStepPointers, PointerError } = await import('./proto-settlement-pointers.mjs');
  const now0 = '2026-09-20T00:00:00.000Z', T0 = '2026-09-20T00:00:01.000Z', T1 = '2026-09-20T00:00:02.000Z';
  sqlite.prepare('INSERT INTO proto_token_defs (id,name,ticker,created_at) VALUES (?,?,?,?)').run('tokR', 'Real', 'RL', now0);
  sqlite.prepare('INSERT INTO proto_markets (id, token_def_id, question, deadline_ms, min_bet, seal_count, committee_pubkeys_json, committee_privkey_enc, rootclose_tmpl_hash, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(MARKET_ID, 'tokR', 'q?', Number(DEADLINE_MS), 1, 2, '[]', 'enc', 'aa'.repeat(32), now0, now0);
  sqlite.prepare('UPDATE proto_markets SET status = ?, winning_side = ?, shardleaf_txid = ?, shardleaf_vout = ?, shardleaf_cov_id = ? WHERE id = ?').run('resolved', WIN_SIDE, genesis.expectedTxid, 0, leafCovId, MARKET_ID);
  const insBet = (id, side, stake, tx, vout) => sqlite.prepare('INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, status, ticket_txid, ticket_vout, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, MARKET_ID, COMMITTEE_PK, side, stake, 'confirmed', tx, vout, now0);
  insBet('rb1', 0, 1, bet1.built.expectedTxid, 1); insBet('rb2', 1, 999, bet2.built.expectedTxid, 1);
  const insApp = (key, betId, b, at) => sqlite.prepare('INSERT INTO proto_bet_intents (intent_key, bet_id, step, status, prepared_txid, prepared_tx_json, submitted_txid, landed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(key, betId, 'append', 'landed', b.expectedTxid, b.txJson, b.expectedTxid, at, now0, now0);
  insApp('bet:rb1:append', 'rb1', bet1.built, T0); insApp('bet:rb2:append', 'rb2', bet2.built, T1);
  const insSet = (step, b) => sqlite.prepare('INSERT INTO proto_settlement_intents (intent_key, subject_type, subject_id, step, status, prepared_txid, prepared_tx_json, submitted_txid, landed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('settle:market:' + MARKET_ID + ':' + step, 'market', MARKET_ID, step, 'landed', b.expectedTxid, b.txJson, b.expectedTxid, T1, now0, now0);
  insSet('seal', seal); insSet('resolve', closeCommit); insSet('convert_to_claim', convertToClaim);
  const out = (s) => resolveStepPointers({ step: s, marketId: MARKET_ID, db: sqlite, kaspa });
  const show = (r) => Object.entries(r.roles).map(([k, v]) => k + '=' + v.outpoint.transactionId.slice(0, 8) + ':' + v.outpoint.index + '/cov=' + (v.expectedCovenantId ? v.expectedCovenantId.slice(0, 8) : 'null') + '/src=' + v.source).join('  ');
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  for (const step of ['seal', 'close_commit', 'convert_to_claim', 'claim_draw']) {
    t('NWT-D REAL-CHAIN ' + step + ': resolveStepPointers accepts real builder output', () => { let r; try { r = out(step); } catch (e) { throw new Error((e instanceof PointerError ? 'PointerError ' + e.code + ' role=' + e.role + ' :: ' + e.detail : e.stack || e.message)); } console.log('   REAL ' + step + ': ' + show(r)); });
  }
  t('NWT-D REAL-CHAIN cross-check vs the builders own outpoints / covenant ids', () => {
    const s = out('seal'), c = out('close_commit'), v = out('convert_to_claim'), d = out('claim_draw');
    const chk = (name, ok) => { console.log('   ' + (ok ? 'MATCH   ' : 'MISMATCH') + ' ' + name); if (!ok) throw new Error('mismatch: ' + name); };
    chk('seal.leaf outpoint == bet2 append out0', s.roles.leaf.outpoint.transactionId === bet2.built.expectedTxid && s.roles.leaf.outpoint.index === 0);
    chk('seal.held outpoint == bet2 append out2', s.roles.held.outpoint.transactionId === bet2.built.expectedTxid && s.roles.held.outpoint.index === 2);
    chk('close_commit.rootClose == seal out0, cov == seal.rootCloseCovId', c.roles.rootClose.outpoint.transactionId === seal.expectedTxid && c.roles.rootClose.outpoint.index === 0 && same(c.roles.rootClose.expectedCovenantId, seal.rootCloseCovId));
    chk('convert.rootClose == close_commit out0 (cov unchanged)', v.roles.rootClose.outpoint.transactionId === closeCommit.expectedTxid && same(v.roles.rootClose.expectedCovenantId, seal.rootCloseCovId));
    chk('convert.held == seal out1', v.roles.held.outpoint.transactionId === seal.expectedTxid && v.roles.held.outpoint.index === 1);
    chk('claim_draw.rootClaim == convert out0, cov == convertToClaim.claimCovId', d.roles.rootClaim.outpoint.transactionId === convertToClaim.expectedTxid && d.roles.rootClaim.outpoint.index === 0 && same(d.roles.rootClaim.expectedCovenantId, convertToClaim.claimCovId));
    chk('claim_draw.held == convert out1', d.roles.held.outpoint.transactionId === convertToClaim.expectedTxid && d.roles.held.outpoint.index === 1);
    chk('claim_draw.ticket == bet2 append out1 (winner bet), no covenant', d.roles.ticket.outpoint.transactionId === bet2.built.expectedTxid && d.roles.ticket.outpoint.index === 1 && d.roles.ticket.expectedCovenantId === null);
  });
}
`;
fs.writeFileSync('src/lib/_nwt_d_probe.test.mjs', src.replace(anchor, anchor + '\n' + probe));
console.log('probe file written');
