// bshard-payout-family-coherence.test.mjs — regression guard for K-18 §3.1-§3.3 landing
// (docs/2026-07-21-p2-batch1-truth-source-layer-k18-landing-design.md, §4 DoD item 1): probeStructuralSignature/
// classifyPayoutShardFamily/assertPayoutShardCoherence/assertZkNativeImmutable.
//
// 🔴 D-019 迁移(ledger 1224/1226/1233/1237/1239/1243/1246/1247)更正: 下面这段"环境诚实注记"原文描述的是
// D-019 之前的状态(SILVERC_LEGACY_PATH 本机不存在, probeStructuralSignature 因此用手搓小 buffer 摆在硬编码
// 小偏移(518/1002/642)上，不需要真编译)——D-019 迁移后 probeStructuralSignature 改走
// deriveCommitteeCheckOffsets(真实 v1.0.0 编译产物 dispatch_tag 定界，偏移落在 ~16000+ 而不是几百/几千)，
// 手搓小 buffer 在新偏移位置上根本没有数据(_hexAt 返回 null)——"零子进程/手搓即可"这个假设本身被 D-019
// 迁移证伪，不是本次测试改错了。已把 buildFakeV1RedeemHex/buildFakeV2RedeemHex 改成调用真实
// compilePayoutShardRedeem/V2Redeem(D-019 pin 二进制现在本机就有，不再是"本机没有 silverc"的环境)，产出
// 真实编译的 redeem，其内部 predicate_commit/poolMerkleRoot 位置天然落在 deriveCommitteeCheckOffsets 会
// 派生出的真实位置上——不再需要"往哪个固定偏移写字节"这个假设，两边(测试 fixture 与被测代码)现在共享
// 同一个真相来源(真实编译器)，不会再因为"谁的偏移假设先过期"而各说各话。
//
// Run: cd kasia-console && node src/lib/bshard-payout-family-coherence.test.mjs
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._PSFAM_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j1_psfam_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, DB_PATH: tmpDb, _PSFAM_TEST_BOOTSTRAPPED: '1' },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const {
  probeStructuralSignature, classifyPayoutShardFamily, assertPayoutShardCoherence, assertZkNativeImmutable,
} = await import('./bshard-payout-family-coherence.mjs');
const { ensurePayoutShard, ensurePayoutShardV2, compilePayoutShardRedeem, compilePayoutShardV2Redeem } = await import('./pool-shard-register.mjs');
const { randomUUID } = await import('node:crypto');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };
const skip = (label) => console.log(`  ⏭  SKIP ${label}`);
const sj = (v) => JSON.stringify(v, (k, val) => typeof val === 'bigint' ? val.toString() : val);

// ── fixture builders (V189 offset table, P2 §1 实测定稿) ──────────────────────────────────────
const PC = 'ab'.repeat(32);   // predicate_commit fixture
const PMR = 'cd'.repeat(32);  // pool_merkle_root fixture
// D-019 迁移(ledger 1225-1227): PayoutShard.sil/PayoutShardV2.sil 当前 ctor 新增三个 ctor-only 字面量,
// compilePayoutShardRedeem/V2Redeem 现在 fail-loud 要求真实值——测试 fixture 补齐, 值与 PC/PMR/genesis
// hash 系列互不相同(避免任何两个 marker 意外相等造成的假通过)。
const TTH = 'ee'.repeat(32);  // token_tmpl_hash fixture
const CTH = 'ff'.repeat(32);  // claim_tmpl_hash fixture
const MSH = '12'.repeat(32);  // market_suffix_hash fixture
const ROOT0 = '00'.repeat(32);

// D-019 迁移: 两个函数名/参数形状保留(18 处既有调用点零改动)，内部改成真实编译(compilePayoutShardRedeem/
// V2Redeem，D-019 pin 二进制)而不是手搓字节——理由见上方文件头新状态注记。真实编译产物里 byte[1] 天然是
// state 区 PUSH8 marker(_PS_STATE_START=1，本 session 反复验证过的结构性事实，跟 ctor 值/字段数无关)，
// decodeV1State 对它的既有断言(buf[1]===0x08)不需要跟着改。
function buildFakeV1RedeemHex({ consolidatedPool = 1000n, closed = 0, payoutRoot = ROOT0, predicateCommit = PC, poolMerkleRoot = PMR } = {}) {
  return compilePayoutShardRedeem({
    poolMerkleRoot, predicateCommit, consolidatedPool: Number(consolidatedPool), closed, payoutRoot,
    tokenTmplHash: TTH, claimTmplHash: CTH, marketSuffixHash: MSH,
  });
}
function buildFakeV2RedeemHex({ predicateCommit = PC, poolMerkleRoot = PMR } = {}) {
  return compilePayoutShardV2Redeem({
    poolMerkleRoot, predicateCommit, closeZkTmplAnchor: '99'.repeat(32), consolidatedPool: 1000,
    tokenTmplHash: TTH, claimTmplHash: CTH, marketSuffixHash: MSH,
  });
}
// deterministic fake p2sh (no kaspa-wasm needed — assertPayoutShardCoherence just needs the SAME function to
// round-trip consistently between "stored payout_ps_addr" and "derived from stored redeem", not a real address).
function fakeP2sh(redeemHex) { return `kaspatest:fake-${redeemHex.slice(0, 24)}`; }

function seedRow(overrides = {}) {
  const marketId = overrides.logical_market_id || `psfam-${randomUUID().slice(0, 8)}`;
  const redeemHex = overrides.payout_redeem_hex ?? buildFakeV1RedeemHex();
  const row = {
    logical_market_id: marketId,
    payout_cov_id: 'covtest',
    payout_ps_addr: overrides.payout_ps_addr ?? fakeP2sh(redeemHex),
    payout_ps_outpoint: 'aa'.repeat(32) + ':0',
    payout_redeem_hex: redeemHex,
    pool_merkle_root: overrides.pool_merkle_root ?? PMR,
    predicate_commit: overrides.predicate_commit ?? PC,
    created_at: Math.floor(Date.now() / 1000),
    covenant_family: overrides.covenant_family ?? 'v1_committee',
    // D-019 迁移(ledger 1225-1227): 默认填合法 32B hex, 避免 assertPayoutShardCoherence 步骤(c) 的新增
    // 格式校验(缺列/缺值 FAIL)意外掩盖测试本来要验的"recompile byte-compare 不等"这条路径——两者都返回
    // failedStep='c', 不给真实值会让测试巧合通过但验的是错的东西(同本 session 全程的 flip-expect 纪律)。
    token_tmpl_hash: overrides.token_tmpl_hash ?? TTH,
    claim_tmpl_hash: overrides.claim_tmpl_hash ?? CTH,
    market_suffix_hash: overrides.market_suffix_hash ?? MSH,
  };
  sqlite.prepare(`INSERT INTO payout_shards (logical_market_id, payout_cov_id, payout_ps_addr, payout_ps_outpoint, payout_redeem_hex, pool_merkle_root, predicate_commit, created_at, covenant_family, token_tmpl_hash, claim_tmpl_hash, market_suffix_hash)
    VALUES (@logical_market_id,@payout_cov_id,@payout_ps_addr,@payout_ps_outpoint,@payout_redeem_hex,@pool_merkle_root,@predicate_commit,@created_at,@covenant_family,@token_tmpl_hash,@claim_tmpl_hash,@market_suffix_hash)`).run(row);
  return row;
}

const HAVE_SILVERC = fs.existsSync(process.env.SILVERC_LEGACY_PATH || 'D:/silverscript/versioned-builds/silverc-legacy-2c46231.exe');

console.log(`[test] silverc pinned build present on this machine: ${HAVE_SILVERC} (governs whether recompile-dependent blocks run for real or skip)\n`);

// ── probeStructuralSignature (零子进程, 高频路径核心) ────────────────────────────────────────
console.log('[test] probeStructuralSignature — V1 正常行(结构签名 offset 518/1002 均符):');
{
  const row = { payout_redeem_hex: buildFakeV1RedeemHex({ consolidatedPool: 42n, closed: 1 }), pool_merkle_root: PMR, predicate_commit: PC };
  const r = probeStructuralSignature(row, 'v1_committee');
  ok(r.ok === true, `V1 结构签名通过 (got ${sj(r)})`);
  ok(r.decoded?.consolidatedPool === 42n && r.decoded?.closed === 1, `解码值正确 consolidatedPool=42n closed=1 (got ${JSON.stringify(r.decoded, (k,v)=>typeof v==='bigint'?v.toString():v)})`);
}

console.log('[test] probeStructuralSignature — 回归守卫(NWT diff 审阻塞级抓漏): marker 检查必须是 buf[1], 不是 buf[0] — fixture 的 buf[0]=0x6b(明确非 0x08)依然要能通过, 证明不再错误依赖 offset 0:');
{
  const row = { payout_redeem_hex: buildFakeV1RedeemHex(), pool_merkle_root: PMR, predicate_commit: PC };
  const buf0 = Buffer.from(row.payout_redeem_hex, 'hex')[0];
  ok(buf0 === 0x6b, `fixture buf[0]=0x6b(sanity: 确认这条 fixture 真的没把 buf[0] 设成 0x08, got 0x${buf0.toString(16)})`);
  const r = probeStructuralSignature(row, 'v1_committee');
  ok(r.ok === true, `buf[0]!=0x08 但 buf[1]===0x08 → 依然通过(marker 检查位置已修正) (got ${sj(r)})`);
}
console.log('[test] probeStructuralSignature — marker 真的缺失(buf[1] 也不是 0x08) → FAIL, 证明检查不是形同虚设:');
{
  const buf = Buffer.from(buildFakeV1RedeemHex(), 'hex');
  buf[1] = 0xff;   // 破坏真正的 marker 位置
  const row = { payout_redeem_hex: buf.toString('hex'), pool_merkle_root: PMR, predicate_commit: PC };
  const r = probeStructuralSignature(row, 'v1_committee');
  ok(r.ok === false && /解码失败/.test(r.reason), `buf[1] marker 损坏 → FAIL, 不是摆设 (got ${sj(r)})`);
}

console.log('[test] probeStructuralSignature — V1 行但 predicate_commit 列跟 offset 518 实际字节不符(混族/损坏数据模拟) → FAIL:');
{
  const row = { payout_redeem_hex: buildFakeV1RedeemHex({ predicateCommit: PC }), pool_merkle_root: PMR, predicate_commit: 'ff'.repeat(32) };
  const r = probeStructuralSignature(row, 'v1_committee');
  ok(r.ok === false && /predicateCommit/.test(r.reason), `predicateCommit 不符 → FAIL, reason 指名 (got ${sj(r)})`);
}

console.log('[test] probeStructuralSignature — V1 行但 pool_merkle_root 列跟 offset 1002 实际字节不符 → FAIL:');
{
  const row = { payout_redeem_hex: buildFakeV1RedeemHex({ poolMerkleRoot: PMR }), pool_merkle_root: 'ee'.repeat(32), predicate_commit: PC };
  const r = probeStructuralSignature(row, 'v1_committee');
  ok(r.ok === false && /poolMerkleRoot/.test(r.reason), `poolMerkleRoot 不符 → FAIL, reason 指名 (got ${sj(r)})`);
}

console.log('[test] probeStructuralSignature — V2 正常行(结构签名 offset 642 符):');
{
  const row = { payout_redeem_hex: buildFakeV2RedeemHex(), pool_merkle_root: PMR, predicate_commit: PC };
  const r = probeStructuralSignature(row, 'v2_zk');
  ok(r.ok === true, `V2 结构签名通过 (got ${sj(r)})`);
}

console.log('[test] probeStructuralSignature — buffer 太短(state 区解码不出) → FAIL, 不猜:');
{
  const row = { payout_redeem_hex: '0800', pool_merkle_root: PMR, predicate_commit: PC };
  const r = probeStructuralSignature(row, 'v1_committee');
  ok(r.ok === false && /解码失败/.test(r.reason), `太短 → FAIL (got ${sj(r)})`);
}

console.log('[test] probeStructuralSignature — 未知 declaredFamily → FAIL, 不猜:');
{
  const row = { payout_redeem_hex: buildFakeV1RedeemHex(), pool_merkle_root: PMR, predicate_commit: PC };
  const r = probeStructuralSignature(row, 'unknown');
  ok(r.ok === false, `未知家族 → FAIL (got ${sj(r)})`);
}

// ── assertPayoutShardCoherence tier='cheap' (高频, 零子进程, 只跑 a/b/d — 断言过程零 silverc 依赖) ──
console.log('\n[test] assertPayoutShardCoherence(tier=cheap) — V1 正常行 → ok, 全程不需要 silverc:');
{
  const row = seedRow({ covenant_family: 'v1_committee' });
  const r = assertPayoutShardCoherence(row, { p2sh: fakeP2sh, tier: 'cheap' });
  ok(r.ok === true, `V1 cheap-tier 通过 (got ${sj(r)})`);
}

console.log('[test] assertPayoutShardCoherence(tier=cheap) — V2 正常行 → ok:');
{
  const redeemHex = buildFakeV2RedeemHex();
  const row = seedRow({ covenant_family: 'v2_zk', payout_redeem_hex: redeemHex, payout_ps_addr: fakeP2sh(redeemHex) });
  const r = assertPayoutShardCoherence(row, { p2sh: fakeP2sh, tier: 'cheap' });
  ok(r.ok === true, `V2 cheap-tier 通过 (got ${sj(r)})`);
}

console.log('[test] assertPayoutShardCoherence — covenant_family=unknown → 步骤(a) 直接拒, 不猜:');
{
  const row = seedRow({ covenant_family: 'unknown' });
  const r = assertPayoutShardCoherence(row, { p2sh: fakeP2sh, tier: 'cheap' });
  ok(r.ok === false && r.failedStep === 'a', `unknown 行拒于步骤(a) (got ${sj(r)})`);
}

console.log('[test] assertPayoutShardCoherence — incoherent 行(实际是 V2 redeem 字节, declared covenant_family=v1_committee)→ 步骤(b) 结构签名拒, 不是 silent pass:');
{
  const v2RedeemBytes = buildFakeV2RedeemHex();   // 真实字节结构(30 参数 ctor)是 V2, 不是 V1(25 参数 ctor)——V1 分支 decodeV1State 对 V2 字节的 state 区解码会失败
  const row = seedRow({ covenant_family: 'v1_committee', payout_redeem_hex: v2RedeemBytes, payout_ps_addr: fakeP2sh(v2RedeemBytes) });
  const r = assertPayoutShardCoherence(row, { p2sh: fakeP2sh, tier: 'cheap' });
  ok(r.ok === false && r.failedStep === 'b', `family 错配(V2 字节 declared V1) → 拒于步骤(b) (got ${sj(r)})`);
}

console.log('[test] assertPayoutShardCoherence — p2sh(stored redeem) != payout_ps_addr → 步骤(d) 拒:');
{
  const row = seedRow({ covenant_family: 'v1_committee', payout_ps_addr: 'kaspatest:some-stale-or-wrong-address' });
  const r = assertPayoutShardCoherence(row, { p2sh: fakeP2sh, tier: 'cheap' });
  ok(r.ok === false && r.failedStep === 'd', `地址不符 → 拒于步骤(d) (got ${sj(r)})`);
}

console.log('[test] assertPayoutShardCoherence — p2sh 未传(必传依赖) → throw, 不是默默跳过步骤(d):');
{
  const row = seedRow({ covenant_family: 'v1_committee' });
  let threw = false;
  try { assertPayoutShardCoherence(row, { tier: 'cheap' }); } catch (e) { threw = /p2sh/.test(e.message); }
  ok(threw, 'p2sh 缺失 → throw, 不静默跳过(d)');
}

console.log('[test] assertPayoutShardCoherence(tier=full) — V2 declared 行(步骤(c) 对 v2_zk 不强制 recompile, 见 P2 §1 边界说明) → ok, 无需 silverc:');
{
  const redeemHex = buildFakeV2RedeemHex();
  const row = seedRow({ covenant_family: 'v2_zk', payout_redeem_hex: redeemHex, payout_ps_addr: fakeP2sh(redeemHex) });
  const r = assertPayoutShardCoherence(row, { p2sh: fakeP2sh, tier: 'full' });
  ok(r.ok === true, `V2 full-tier 通过, 不因缺 silverc 而 FAIL (got ${sj(r)})`);
}

console.log(`[test] assertPayoutShardCoherence(tier=full) — V1 declared 行, DB 列跟真实编译产物一致(步骤(c) recompile byte-compare 应该 PASS)${HAVE_SILVERC ? '' : ' — 本机无 silverc, SKIP(见文件头说明, 交 KANet-UI 机器复跑)'}:`);
if (HAVE_SILVERC) {
  // D-019 迁移后 fixture 本身就是真实编译产物(见文件头新状态注记), seedRow 默认 DB 列(PC/PMR/TTH/CTH/MSH)
  // 与 buildFakeV1RedeemHex 默认 ctor 输入完全一致 → recompile 出的字节理应跟 payout_redeem_hex 逐字节相等。
  // 这条从"hand-crafted 必然不等"翻转成"真实一致必然相等"(flip-expect, 同本 session 全程纪律), 覆盖 step(c)
  // 的 happy path(以前从未被真正验证过, 因为 fixture 从来没是过真实编译产物)。
  const row = seedRow({ covenant_family: 'v1_committee' });
  const r = assertPayoutShardCoherence(row, { p2sh: fakeP2sh, tier: 'full' });
  ok(r.ok === true, `DB 列与真实编译产物一致 → step(c) recompile byte-compare 通过 (got ${sj(r)})`);
} else {
  skip('V1 full-tier recompile(silverc 不在本机, 见文件头环境说明)');
}

console.log(`[test] assertPayoutShardCoherence(tier=full) — V1 declared 行, token_tmpl_hash 列被改成跟 redeem 里实际烤入值不同的另一个合法 32B hex(step(b) 结构签名只查 predicate_commit/pool_merkle_root, 查不到这个漂移; 只有 step(c) 的 recompile 字节比对能抓到) → 应该 FAIL, 拒于(c)${HAVE_SILVERC ? '' : ' — 本机无 silverc, SKIP'}:`);
if (HAVE_SILVERC) {
  const row = seedRow({ covenant_family: 'v1_committee', token_tmpl_hash: '5a'.repeat(32) });
  const r = assertPayoutShardCoherence(row, { p2sh: fakeP2sh, tier: 'full' });
  ok(r.ok === false && r.failedStep === 'c', `token_tmpl_hash 列跟真实编译产物不一致(step(b) 查不到) → recompile byte-compare 正确识别不等, 拒于(c) (got ${sj(r)})`);
} else {
  skip('V1 full-tier recompile mismatch on ctor-only literal(silverc 不在本机)');
}

// ── P2 批2 §1: ensurePayoutShard/V2 早返回分支 non-blocking gate 接线(零 silverc 依赖, tier=cheap
// 从不调 recompile——这条覆盖的正是"每笔下注必经"的高频路径, 不受本机无 silverc 限制) ──────────
console.log(`\n[test] ensurePayoutShard 早返回分支 — coherent 行 → 不写 ps_coherence_gate_fail 事件, 返回值不变(向后兼容):`);
{
  const row = seedRow({ covenant_family: 'v1_committee' });
  const before = sqlite.prepare(`SELECT COUNT(*) AS n FROM events WHERE event_type='ps_coherence_gate_fail'`).get().n;
  const r = await ensurePayoutShard({ db: sqlite, rc: async () => ({}), transfer: async () => 'x', landed: async () => true, p2sh: fakeP2sh, logicalMarketId: row.logical_market_id, poolMerkleRoot: PMR, predicateCommit: PC, relayAddr: 'kaspatest:relay' });
  const after = sqlite.prepare(`SELECT COUNT(*) AS n FROM events WHERE event_type='ps_coherence_gate_fail'`).get().n;
  ok(after === before, `coherent existing row → 早返回时零新增 ps_coherence_gate_fail 事件 (before=${before} after=${after})`);
  ok(r.payoutCovId === row.payout_cov_id && r.psAddr === row.payout_ps_addr, `返回值仍是 existing 缓存值, 未被 gate 篡改 (got ${sj(r)})`);
}
console.log(`[test] ensurePayoutShard 早返回分支 — incoherent 行(p2sh 不符, 模拟误标/字节漂移)→ non-blocking: 写 ps_coherence_gate_fail 事件 但仍正常返回缓存值(不 throw, 不拦下注):`);
{
  const row = seedRow({ covenant_family: 'v1_committee', payout_ps_addr: 'kaspatest:stale-mismatched-address' });
  const before = sqlite.prepare(`SELECT COUNT(*) AS n FROM events WHERE event_type='ps_coherence_gate_fail'`).get().n;
  const r = await ensurePayoutShard({ db: sqlite, rc: async () => ({}), transfer: async () => 'x', landed: async () => true, p2sh: fakeP2sh, logicalMarketId: row.logical_market_id, poolMerkleRoot: PMR, predicateCommit: PC, relayAddr: 'kaspatest:relay' });
  const after = sqlite.prepare(`SELECT COUNT(*) AS n FROM events WHERE event_type='ps_coherence_gate_fail'`).get().n;
  ok(after === before + 1, `incoherent existing row → 早返回时写入 1 条 ps_coherence_gate_fail 事件 (before=${before} after=${after})`);
  ok(r.psAddr === row.payout_ps_addr, `【关键】non-blocking: 即便 gate FAIL, 仍返回 existing 缓存值(不 throw, 不拦这个市场的下注) (got psAddr=${r.psAddr})`);
  const evt = sqlite.prepare(`SELECT summary FROM events WHERE event_type='ps_coherence_gate_fail' ORDER BY created_at DESC LIMIT 1`).get();
  ok(/failedStep|step=d/.test(evt.summary) || /步骤.*d|failedStep.*d/.test(evt.summary), `事件 summary 含可追溯的 failedStep 信息 (got: ${evt.summary})`);
}
console.log(`[test] ensurePayoutShardV2 早返回分支 — 同款 non-blocking 行为(coherent → 无事件, incoherent → 有事件+仍返回):`);
{
  const redeemHex = buildFakeV2RedeemHex();
  const rowOk = seedRow({ covenant_family: 'v2_zk', payout_redeem_hex: redeemHex, payout_ps_addr: fakeP2sh(redeemHex) });
  const beforeOk = sqlite.prepare(`SELECT COUNT(*) AS n FROM events WHERE event_type='ps_coherence_gate_fail'`).get().n;
  await ensurePayoutShardV2({ db: sqlite, rc: async () => ({}), transfer: async () => 'x', landed: async () => true, p2sh: fakeP2sh, logicalMarketId: rowOk.logical_market_id, poolMerkleRoot: PMR, predicateCommit: PC, closeZkTmplAnchor: 'dd'.repeat(32), relayAddr: 'kaspatest:relay' });
  const afterOk = sqlite.prepare(`SELECT COUNT(*) AS n FROM events WHERE event_type='ps_coherence_gate_fail'`).get().n;
  ok(afterOk === beforeOk, `V2 coherent existing row → 零新增事件 (before=${beforeOk} after=${afterOk})`);

  const rowBad = seedRow({ covenant_family: 'v2_zk', payout_redeem_hex: redeemHex, payout_ps_addr: 'kaspatest:another-stale-addr' });
  const beforeBad = sqlite.prepare(`SELECT COUNT(*) AS n FROM events WHERE event_type='ps_coherence_gate_fail'`).get().n;
  const rBad = await ensurePayoutShardV2({ db: sqlite, rc: async () => ({}), transfer: async () => 'x', landed: async () => true, p2sh: fakeP2sh, logicalMarketId: rowBad.logical_market_id, poolMerkleRoot: PMR, predicateCommit: PC, closeZkTmplAnchor: 'dd'.repeat(32), relayAddr: 'kaspatest:relay' });
  const afterBad = sqlite.prepare(`SELECT COUNT(*) AS n FROM events WHERE event_type='ps_coherence_gate_fail'`).get().n;
  ok(afterBad === beforeBad + 1, `V2 incoherent existing row → 1 条新事件 (before=${beforeBad} after=${afterBad})`);
  ok(rBad.psAddr === rowBad.payout_ps_addr, `V2 non-blocking: 仍返回缓存值, 不 throw (got ${rBad.psAddr})`);
}
console.log(`[test] ensurePayoutShard 早返回分支 — p2sh 未传(参数缺失, 契约错误)→ non-blocking 自身也不能崩高频读路径, 早返回值照常拿到:`);
{
  const row = seedRow({ covenant_family: 'v1_committee' });
  const r = await ensurePayoutShard({ db: sqlite, rc: async () => ({}), transfer: async () => 'x', landed: async () => true, p2sh: undefined, logicalMarketId: row.logical_market_id, poolMerkleRoot: PMR, predicateCommit: PC, relayAddr: 'kaspatest:relay' });
  ok(r.psAddr === row.payout_ps_addr, `p2sh 缺失时(assertPayoutShardCoherence 内部 throw)_checkCoherenceNonBlocking 捕获异常, 早返回路径本身不受影响 (got ${sj(r)})`);
}

// ── classifyPayoutShardFamily (backfill-only, 允许 recompile 子进程成本) ──────────────────────
console.log(`\n[test] classifyPayoutShardFamily — 结构签名都对不上的行 → 'unknown', 不猜(两次(V1/V2)都不过是设计内允许的结果, P2 §5 风险②已预期):`);
{
  const row = { payout_redeem_hex: buildFakeV1RedeemHex({ predicateCommit: 'ff'.repeat(32) }), pool_merkle_root: PMR, predicate_commit: PC };
  const r = classifyPayoutShardFamily(row);
  ok(r.family === 'unknown', `结构签名核对不过 → unknown (got ${sj(r)})`);
}
console.log(`[test] classifyPayoutShardFamily — V2 结构签名符 → 'v2_zk'(backfill 阶段不强制 v2 recompile, 见设计边界说明):`);
{
  const row = { payout_redeem_hex: buildFakeV2RedeemHex(), pool_merkle_root: PMR, predicate_commit: PC };
  const r = classifyPayoutShardFamily(row);
  ok(r.family === 'v2_zk', `V2 结构签名 → v2_zk (got ${sj(r)})`);
}
console.log(`[test] classifyPayoutShardFamily(P2 批2 §3 拆分后) — V1 结构签名符, 即便不是真实 silverc 编译产物(recompile 会不等)也判 'v1_committee' — 家族身份不再要求 recompile byte-equal, 零 silverc 依赖(不再 SKIP):`);
{
  const row = { payout_redeem_hex: buildFakeV1RedeemHex(), pool_merkle_root: PMR, predicate_commit: PC };
  const r = classifyPayoutShardFamily(row);
  ok(r.family === 'v1_committee', `结构签名符 → v1_committee, 不要求 recompile 佐证(拆分后设计) (got ${sj(r)})`);
}
console.log(`[test] classifyPayoutShardFamily — 回归守卫(batch1 backfill 报告实证案例): 结构签名符但状态已偏离 genesis 快照(模拟 63 条 refunded 组: closed/consolidatedPool 已变化, recompile 若跑一定不等)→ 拆分前会误判 unknown, 拆分后正确判 v1_committee:`);
{
  const row = { payout_redeem_hex: buildFakeV1RedeemHex({ consolidatedPool: 999999n, closed: 1 }), pool_merkle_root: PMR, predicate_commit: PC };
  const r = classifyPayoutShardFamily(row);
  ok(r.family === 'v1_committee', `非 genesis 状态(closed=1, consolidatedPool 已变)结构签名仍符 → v1_committee, 不再被 recompile 拖累成 unknown (got ${sj(r)})`);
}

// ── §3.1 写入点(ensurePayoutShard/V2 谁编译谁 declare covenant_family) ─────────────────────────
console.log(`\n[test] ensurePayoutShard/V2 genesis-mint 写入点 declare covenant_family(§3.1)${HAVE_SILVERC ? '' : ' — 本机无 silverc, SKIP(见文件头环境说明)'}:`);
if (HAVE_SILVERC) {
  const stubRc = async () => ({ payoutCovId: 'aa'.repeat(32), txId: 'bb'.repeat(32) });
  const stubTransfer = async () => 'cc'.repeat(32);
  const stubLanded = async () => true;

  const marketIdV1 = `psfam-genesis-v1-${randomUUID().slice(0, 8)}`;
  await ensurePayoutShard({ db: sqlite, rc: stubRc, transfer: stubTransfer, landed: stubLanded, p2sh: fakeP2sh, logicalMarketId: marketIdV1, poolMerkleRoot: PMR, predicateCommit: PC, tokenTmplHash: TTH, claimTmplHash: CTH, marketSuffixHash: MSH, relayAddr: 'kaspatest:relay' });
  const rowV1 = sqlite.prepare('SELECT covenant_family FROM payout_shards WHERE logical_market_id = ?').get(marketIdV1);
  ok(rowV1?.covenant_family === 'v1_committee', `ensurePayoutShard INSERT 声明 covenant_family='v1_committee' (got ${rowV1?.covenant_family})`);

  const marketIdV2 = `psfam-genesis-v2-${randomUUID().slice(0, 8)}`;
  await ensurePayoutShardV2({ db: sqlite, rc: stubRc, transfer: stubTransfer, landed: stubLanded, p2sh: fakeP2sh, logicalMarketId: marketIdV2, poolMerkleRoot: PMR, predicateCommit: PC, closeZkTmplAnchor: 'dd'.repeat(32), tokenTmplHash: TTH, claimTmplHash: CTH, marketSuffixHash: MSH, relayAddr: 'kaspatest:relay' });
  const rowV2 = sqlite.prepare('SELECT covenant_family FROM payout_shards WHERE logical_market_id = ?').get(marketIdV2);
  ok(rowV2?.covenant_family === 'v2_zk', `ensurePayoutShardV2 INSERT 声明 covenant_family='v2_zk' (got ${rowV2?.covenant_family})`);
} else {
  skip('ensurePayoutShard/V2 写入点(依赖 compilePayoutShardRedeem/V2Redeem, silverc 不在本机)');
}

// ── assertZkNativeImmutable (K-18 §3.2) ────────────────────────────────────────────────────────
console.log('\n[test] assertZkNativeImmutable — 市场未铸(无 payout_shards 行) → 放行, 不管传什么值:');
{
  const marketId = `psfam-unminted-${randomUUID().slice(0, 8)}`;
  let threw = false;
  try { assertZkNativeImmutable(sqlite, marketId, true); assertZkNativeImmutable(sqlite, marketId, false); } catch { threw = true; }
  ok(!threw, '未铸市场 zk_native 自由设置, 不拦');
}
console.log('[test] assertZkNativeImmutable — 已铸 v1_committee, newZkNative=false(不变) → 放行:');
{
  const row = seedRow({ covenant_family: 'v1_committee' });
  let threw = false;
  try { assertZkNativeImmutable(sqlite, row.logical_market_id, false); } catch { threw = true; }
  ok(!threw, 'v1_committee + zk_native:false(一致) → 不拦');
}
console.log('[test] assertZkNativeImmutable — 已铸 v1_committee, newZkNative=true(翻转) → 拒(throw):');
{
  const row = seedRow({ covenant_family: 'v1_committee' });
  let threw = false, msg = '';
  try { assertZkNativeImmutable(sqlite, row.logical_market_id, true); } catch (e) { threw = true; msg = e.message; }
  ok(threw && /不可变|不可把/.test(msg), `v1_committee → zk_native:true 翻转 → throw (got threw=${threw}, msg=${msg})`);
}
console.log('[test] assertZkNativeImmutable — 已铸 v2_zk, newZkNative=true(不变) → 放行:');
{
  const redeemHex = buildFakeV2RedeemHex();
  const row = seedRow({ covenant_family: 'v2_zk', payout_redeem_hex: redeemHex, payout_ps_addr: fakeP2sh(redeemHex) });
  let threw = false;
  try { assertZkNativeImmutable(sqlite, row.logical_market_id, true); } catch { threw = true; }
  ok(!threw, 'v2_zk + zk_native:true(一致) → 不拦');
}
console.log('[test] assertZkNativeImmutable — 已铸 v2_zk, newZkNative=false(翻转) → 拒(throw):');
{
  const redeemHex = buildFakeV2RedeemHex();
  const row = seedRow({ covenant_family: 'v2_zk', payout_redeem_hex: redeemHex, payout_ps_addr: fakeP2sh(redeemHex) });
  let threw = false;
  try { assertZkNativeImmutable(sqlite, row.logical_market_id, false); } catch { threw = true; }
  ok(threw, 'v2_zk → zk_native:false 翻转 → throw');
}
console.log('[test] assertZkNativeImmutable — covenant_family=unknown(backfill 判不出) → fail-closed 拒(不确定时宁可误拦, 不放过真违规):');
{
  const row = seedRow({ covenant_family: 'unknown' });
  let threw = false;
  try { assertZkNativeImmutable(sqlite, row.logical_market_id, true); } catch { threw = true; }
  ok(threw, 'unknown family → fail-closed 拒(true 值也拦)');
  threw = false;
  try { assertZkNativeImmutable(sqlite, row.logical_market_id, false); } catch { threw = true; }
  ok(threw, 'unknown family → fail-closed 拒(false 值也拦)');
}

console.log(fails === 0
  ? `\n✅ all checks passed${HAVE_SILVERC ? '' : ` (silverc-dependent recompile blocks SKIPPED on this machine — need KANet-UI's machine for full (c)-step coverage, per DoD item 3)`}`
  : `\n❌ ${fails} check(s) failed`);
process.exit(fails === 0 ? 0 : 1);
