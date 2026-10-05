// bshard-close-enforce-polymarket.test.mjs — 账本1855 A: 委员 enforce 的 Polymarket/UMA 判定分支。
// 真 makeCtfReader + 本地 JSON-RPC 桩(2~3 个"Polygon 节点", 可配 YES/NO/未 final/宕机/分歧), 真 _enforceCloseAttestCore(命门①通过后进入判定分支)。
// Run: cd kasia-console && node src/lib/bshard-close-enforce-polymarket.test.mjs
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { _enforceCloseAttestCore, judgePolymarketVerdict, _ENFORCE_PMR_SENTINEL, _ENFORCE_PC_SENTINEL } from './bshard-close-enforce.mjs';
import { deriveCommitteeCheckOffsets } from './committee-offset-derive.mjs';
import { makeCtfReader } from './uma-ctf-reader.mjs';
import { computeMarketCommitV2 } from './pool-shard-settle.mjs';
import { buildPredictionV1InterimRules } from './fee-split.mjs';

let fails = 0;
const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };
const word = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0');
const COND = '0x' + 'ab'.repeat(32);
// 一个假 Polygon 节点: mode ∈ yes|no|unresolved|tie|down
const startNode = (mode) => new Promise((resolve) => {
  const handle = (m) => {
    const ok_ = (result) => ({ jsonrpc: '2.0', id: m.id, result });
    if (m.method === 'eth_chainId') return ok_('0x89');
    if (m.method === 'net_version') return ok_('137');
    if (m.method === 'eth_blockNumber') return ok_('0x10');
    if (m.method !== 'eth_call') return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'nope' } };
    const data = String(m.params?.[0]?.data || '').toLowerCase(); const sel = data.slice(0, 10);
    if (sel === '0xdd34de67') return ok_(word(mode === 'unresolved' ? 0 : 1));
    if (sel === '0x0504c814') { const idx = Number(BigInt('0x' + data.slice(74, 138))); const yes = mode === 'yes'; return ok_(word(mode === 'tie' ? 1 : ((idx === 0) === yes ? 1 : 0))); }
    return { jsonrpc: '2.0', id: m.id, error: { code: -32000, message: 'sel' } };
  };
  const srv = http.createServer((req, res) => {
    if (mode === 'down') { req.destroy(); return; }
    let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { const j = JSON.parse(b); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(Array.isArray(j) ? j.map(handle) : handle(j))); });
  }).listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() }));
});
const readerFor = async (modes) => { const nodes = await Promise.all(modes.map(startNode)); return { reader: makeCtfReader({ rpcs: nodes.map((n) => n.url) }), close: () => nodes.forEach((n) => n.close()) }; };
const verdictOf = async (modes, cond = COND) => { const { reader, close } = await readerFor(modes); try { return await judgePolymarketVerdict({ outcomeConditionId: cond, ctfReader: reader }); } finally { close(); } };

console.log('[test] judgePolymarketVerdict(真 makeCtfReader + 本地 RPC 桩)');
{
  const y = await verdictOf(['yes', 'yes', 'yes']); ok(y.ok && y.winningDirection === 0 && y.verdict === 'YES', 'YES(3 源一致) ⇒ winningDirection 0');
  const n = await verdictOf(['no', 'no']); ok(n.ok && n.winningDirection === 1 && n.verdict === 'NO', 'NO(2 源一致) ⇒ winningDirection 1');
  const d = await verdictOf(['yes', 'no', 'yes']); ok(!d.ok && /ABSTAIN/.test(d.reason), `RPC 分歧(YES/NO/YES) ⇒ 拒(${d.reason?.slice(0, 40)})`);
  const u = await verdictOf(['unresolved', 'unresolved']); ok(!u.ok && /ABSTAIN/.test(u.reason), '未 final(payoutDenominator=0) ⇒ 拒');
  const u2 = await verdictOf(['yes', 'unresolved']); ok(!u2.ok, '一源 final 一源未 final ⇒ 拒(须全体同值)');
  const t = await verdictOf(['tie', 'tie']); ok(!t.ok && /ABSTAIN/.test(t.reason), '[1,1] 50/50 ⇒ 拒');
  const one = await verdictOf(['yes', 'down']); ok(!one.ok, '仅 1 个成功源(另一宕机) ⇒ 拒(<2 源不信)');
  const bad = await verdictOf(['yes', 'yes'], '0x1234'); ok(!bad.ok && /格式非法/.test(bad.reason), 'conditionId 格式非法 ⇒ 拒');
  const miss = await judgePolymarketVerdict({ ctfReader: { readResolution: async () => ({ final: 'YES' }) } }); ok(!miss.ok && /缺失/.test(miss.reason), '本地行无 conditionId ⇒ 拒(不会去读别处)');
  const thrown = await judgePolymarketVerdict({ outcomeConditionId: COND, ctfReader: { readResolution: async () => { throw new Error('boom'); } } }); ok(!thrown.ok && /读取异常/.test(thrown.reason), 'reader 抛错 ⇒ 拒(fail-closed)');
}

console.log('[test] _enforceCloseAttestCore: 判定分支的信任边界(命门①先通过)');
{
  const MY_PK = 'dd'.repeat(32), BROKER = 'a1'.repeat(32), META_HASH = 'c3'.repeat(32);
  const rules = buildPredictionV1InterimRules({ brokerPk: BROKER });
  const onChain = computeMarketCommitV2(rules, { marketMetadataHash: META_HASH });
  // 命门① 读 predicate commit 的偏移是从真合约编译派生的(非固定 518): 用同一个 deriveCommitteeCheckOffsets 求 V1 布局偏移, 把 commit 放到那里
  const off = deriveCommitteeCheckOffsets({ isV2: false, pmrSentinelHex: _ENFORCE_PMR_SENTINEL, pcSentinelHex: _ENFORCE_PC_SENTINEL }).predicateCommitOffset;
  const mk = (commit) => '00'.repeat(off) + commit + '00'.repeat(64);
  const redeem = mk(onChain);
  const calls = [];
  const spy = (final) => ({ readResolution: async (c) => { calls.push(c); return { final }; } });
  const base = { market_id: 'm-poly', predicate: null, psRedeemHex: redeem, committee_pk: MY_PK, broker_pk: BROKER, introducer_pk: null, fee_rules: JSON.stringify(rules) };
  const ctxBase = { myOracleKeys: [MY_PK], marketMetadataHash: META_HASH, resolutionRuleSpec: {}, outcomeMarketSource: 'polymarket', outcomeConditionId: COND };
  // (1) 请求里夹带的 conditionId / source / judge 字段一律被忽略: reader 只被本地行的 COND 调用
  const injected = { ...base, outcome_condition_id: '0x' + 'ee'.repeat(32), conditionId: '0x' + 'ff'.repeat(32), outcome_market_source: 'polymarket', data_source_canonical: 'https://evil.example/x', predicate_condition_id: '0x' + '99'.repeat(32) };
  calls.length = 0;
  const r1 = await _enforceCloseAttestCore(injected, { ...ctxBase, ctfReader: spy('YES') });
  ok(calls.length === 1 && calls[0] === COND, `委员只用本地行 conditionId 读(调用 ${JSON.stringify(calls.map((c) => c.slice(0, 8)))}), 请求夹带的 id 被忽略`);
  ok(!/polymarket|data_source_canonical|命门①/.test(r1.reason || ''), `判定通过后继续往下走(停在后续门, 非判定/commit 门): ${String(r1.reason).slice(0, 60)}`);
  // (2) 判定 ABSTAIN ⇒ 在判定分支拒签, 不进后续门
  calls.length = 0;
  const r2 = await _enforceCloseAttestCore(base, { ...ctxBase, ctfReader: spy('ABSTAIN') });
  ok(r2.pass === false && /polymarket: UMA\/CTF ABSTAIN/.test(r2.reason), `ABSTAIN ⇒ 拒签: ${r2.reason?.slice(0, 50)}`);
  // (3) 本地行来源不是 polymarket ⇒ 不走 UMA(reader 零调用); 也不能被请求"升级"成 polymarket
  calls.length = 0;
  const r3 = await _enforceCloseAttestCore({ ...base, outcome_market_source: 'polymarket' }, { ...ctxBase, outcomeMarketSource: 'kanet_v07', ctfReader: spy('YES') });
  ok(calls.length === 0 && r3.pass === false, `本地来源 kanet_v07 ⇒ reader 零调用(请求声称 polymarket 无效), 走原路径被拒: ${String(r3.reason).slice(0, 50)}`);
  calls.length = 0;
  const r4 = await _enforceCloseAttestCore(base, { ...ctxBase, outcomeMarketSource: null, ctfReader: spy('YES') });
  ok(calls.length === 0 && r4.pass === false, '本地来源缺失(行不存在/列空) ⇒ 不走 UMA, 拒(fail-closed)');
  // (4) 命门①仍在前: commit 对不上 ⇒ 在 UMA 之前就拒(reader 零调用)
  calls.length = 0;
  const r5 = await _enforceCloseAttestCore({ ...base, psRedeemHex: mk('ab'.repeat(32)) }, { ...ctxBase, ctfReader: spy('YES') });
  ok(calls.length === 0 && /hash-bind FAIL/.test(r5.reason), '命门① 先于判定分支(假 predicate ⇒ 不去读 UMA)');
}

console.log('[test] 赢向与提议不符 ⇒ 拒(V2 既有门 W2 new_attestedWinner != 委员自判, 判定分支只提供自判值)');
{
  const src = readFileSync(fileURLToPath(new URL('./bshard-close-enforce.mjs', import.meta.url)), 'utf8');
  ok(/attestedWinner !== winningDirection[\s\S]{0,200}假赢家/.test(src), 'enforceCloseAttestV2 仍含 attestedWinner !== winningDirection ⇒ 拒(假赢家)');
  ok(/winningDirection = pj\.winningDirection;/.test(src), '委员自判值 winningDirection 来自 judgePolymarketVerdict(同一变量进入该比对)');
}
console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
