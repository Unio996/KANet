// NWT 9-2b(iii-2) 审: 与 J2 的 10 个不同的 ops 变异, 专挑钱相关参数。每个只改 proto-settlement-ops.mjs, 跑 ops 测试(含整链离线端到端), 还原后核 sha256。
const fs = require('fs'), cp = require('child_process'), crypto = require('crypto');
const CON = 'D:/kanet-nwt-cand/kasia-console';
const F = CON + '/src/lib/proto-settlement-ops.mjs';
const orig = fs.readFileSync(F, 'utf8'); const sha0 = crypto.createHash('sha256').update(orig).digest('hex');
const R = (a, b, all) => s => { const n = s.split(a).length - 1; if (!all && n !== 1) throw new Error('anchor matched ' + n + 'x: ' + a.slice(0, 60).replace(/\n/g, '\\n')); if (n === 0) throw new Error('anchor 0x: ' + a.slice(0, 60)); return all ? s.split(a).join(b) : s.replace(a, () => b); };
const M = [
  ['o1 [钱] fee 上限放宽 100 倍(absFeeCapSompi)', R('absFeeCapSompi: cap,', 'absFeeCapSompi: (typeof cap === "bigint" ? cap * 100n : cap * 100),')],
  ['o2 [钱] 找零脚本换成错误脚本(relayChangeScriptPublicKeyHex)', R('relayChangeScriptPublicKeyHex: relaySpkHex,', 'relayChangeScriptPublicKeyHex: "0x" + "00".repeat(34),')],
  ['o3 [钱] fee 面值下限降到 1(feeMinAmount)', R('const feeMin = (step) => loadFeeProfileCap(FEE_PROFILE_KIND[step]);', 'const feeMin = (step) => 1;')],
  ['o4 [钱] close_commit pmt 门用的 deadline 推迟 1 小时(prepare.deadlineMs)', R('deadlineMs: Number(m.deadline_ms) };', 'deadlineMs: Number(m.deadline_ms) + 3600000 };')],
  ['o5 [钱] close_commit 的 newWinningSide 取反', R('newWinningSide: m.winning_side,', 'newWinningSide: 1 - m.winning_side,')],
  ['o6 [钱] claim_draw 的 ticket direction 取反(两处)', R('direction: Number(winner.side)', 'direction: 1 - Number(winner.side)', true)],
  ['o7 [钱] claim_draw 的 payout 用下注额而不是奖池', R('payout: closed.pool_value,', 'payout: Number(winner.stake),')],
  ['o8 [钱] claim_draw 的 KanetTokenClaim 目标地址金额用下注额(landed 检查目标)', R('winnerPkHex: lc(winner.bettor_pk), amount: closed.pool_value })', 'winnerPkHex: lc(winner.bettor_pk), amount: Number(winner.stake) })')],
  ['o9 [钱] 找每个 fee 候选时不补 fee 父项(常量 chainParents)', R('make(u, withFeeParent(chainParents, u))', 'make(u, chainParents)')],
  ['o10 seal 的封盘下注数检查去掉', R('if (s.count !== m.seal_count) throw', 'if (false) throw')],
  ['o11 [钱] 委员私钥信封取自 subject 而不是 market(claim 步骤用 claim id 查)', R("SELECT committee_privkey_enc AS env FROM proto_markets WHERE id = ?').get(marketId)", "SELECT committee_privkey_enc AS env FROM proto_markets WHERE id = ?').get(marketId + 'x')")],
];
const out = [];
for (const [n, fn] of M) {
  let m; try { m = fn(orig); } catch (e) { out.push('?? ' + n + ' :: ' + e.message); continue; }
  try {
    fs.writeFileSync(F, m);
    const r = cp.spawnSync(process.execPath, ['src/lib/proto-settlement-ops.test.mjs'], { cwd: CON, encoding: 'utf8', timeout: 280000, env: { ...process.env, CONSOLE_ENCRYPTION_KEY: '0'.repeat(64), PROTO_RELAY_ID: 'x' } });
    const so = (r.stdout || '');
    const failed = (so.match(/\[FAIL\]/g) || []).length; const last = (so.match(/proto-settlement-ops\.test: .*/) || [''])[0];
    out.push((r.status === 0 ? 'SURVIVED ' : 'killed   ') + n + (r.status === 0 ? '' : `   (${failed} FAIL${failed ? '' : '; exit ' + r.status + ' ' + (r.stderr || '').slice(0, 60).replace(/\n/g, ' ')})`));
  } finally { fs.writeFileSync(F, orig); }
}
console.log(out.join('\n'));
console.log('restored identical: ' + (sha0 === crypto.createHash('sha256').update(fs.readFileSync(F)).digest('hex')));
