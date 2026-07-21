// bshard-payout-family-coherence.test.mjs — regression guard for K-18 §3.1-§3.3 landing
// (docs/2026-07-21-p2-batch1-truth-source-layer-k18-landing-design.md, §4 DoD item 1): probeStructuralSignature/
// classifyPayoutShardFamily/assertPayoutShardCoherence/assertZkNativeImmutable.
//
// Environment honesty note (matches established precedent, bshard-consolidated-pool-rederive.test.mjs comment):
// compilePayoutShardRedeem/V2Redeem shell out to a pinned silverc binary (D:/silverscript/versioned-builds/)
// that is NOT present on this machine (J1tn's isolated :3300 node — confirmed via `ls`, same gap already
// documented for the K-18 backfill dry-run scripts). Tests that exercise probeStructuralSignature/
// assertPayoutShardCoherence's steps (a)(b)(d) (the zero-subprocess, high-frequency-tier path — arguably the
// MORE load-bearing path to verify, since it runs on every bet) use hand-crafted deterministic byte fixtures
// and need no silverc. Tests that would need real recompile (classifyPayoutShardFamily, tier='full' step (c)
// for v1_committee) detect silverc absence and SKIP with an explicit reason rather than faking a pass — when
// this file runs on a machine with silverc pinned (KANet-UI's, per DoD item 3 "装载后活代码复跑"), those
// blocks execute for real instead of skipping.
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
const { ensurePayoutShard, ensurePayoutShardV2 } = await import('./pool-shard-register.mjs');
const { randomUUID } = await import('node:crypto');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };
const skip = (label) => console.log(`  ⏭  SKIP ${label}`);
const sj = (v) => JSON.stringify(v, (k, val) => typeof val === 'bigint' ? val.toString() : val);

// ── fixture builders (V189 offset table, P2 §1 实测定稿) ──────────────────────────────────────
const PC = 'ab'.repeat(32);   // predicate_commit fixture
const PMR = 'cd'.repeat(32);  // pool_merkle_root fixture
const ROOT0 = '00'.repeat(32);

function buildFakeV1RedeemHex({ consolidatedPool = 1000n, closed = 0, payoutRoot = ROOT0, predicateCommit = PC, poolMerkleRoot = PMR, totalLen = 1040 } = {}) {
  const buf = Buffer.alloc(totalLen, 0x11);   // 0x11 filler (not 0x00) — catches "byte just happens to be zero" false positives
  buf[0] = 0x08;
  buf.writeBigInt64LE(BigInt(consolidatedPool), 2);
  buf.writeBigInt64LE(BigInt(closed), 11);
  Buffer.from(payoutRoot, 'hex').copy(buf, 20);
  Buffer.from(predicateCommit, 'hex').copy(buf, 518);
  Buffer.from(poolMerkleRoot, 'hex').copy(buf, 1002);
  return buf.toString('hex');
}
function buildFakeV2RedeemHex({ predicateCommit = PC, totalLen = 700 } = {}) {
  const buf = Buffer.alloc(totalLen, 0x22);
  buf[0] = 0x08;
  Buffer.from(predicateCommit, 'hex').copy(buf, 642);
  return buf.toString('hex');
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
  };
  sqlite.prepare(`INSERT INTO payout_shards (logical_market_id, payout_cov_id, payout_ps_addr, payout_ps_outpoint, payout_redeem_hex, pool_merkle_root, predicate_commit, created_at, covenant_family)
    VALUES (@logical_market_id,@payout_cov_id,@payout_ps_addr,@payout_ps_outpoint,@payout_redeem_hex,@pool_merkle_root,@predicate_commit,@created_at,@covenant_family)`).run(row);
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
  const v2RedeemBytes = buildFakeV2RedeemHex();   // 真实字节结构是 V2(predicateCommit@642), 不是 V1(@518)
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

console.log(`[test] assertPayoutShardCoherence(tier=full) — V1 declared 行(步骤(c) 需要 recompile, 依赖 silverc)${HAVE_SILVERC ? '' : ' — 本机无 silverc, SKIP(见文件头说明, 交 KANet-UI 机器复跑)'}:`);
if (HAVE_SILVERC) {
  const row = seedRow({ covenant_family: 'v1_committee' });
  const r = assertPayoutShardCoherence(row, { p2sh: fakeP2sh, tier: 'full' });
  // hand-crafted fixture 不是真实 silverc 编译产物 → recompile 必然 byte-不等 → 步骤(c) 应该 FAIL(不是 crash)
  ok(r.ok === false && r.failedStep === 'c', `hand-crafted fixture 非真实编译产物 → recompile byte-compare 正确识别不等, 拒于(c) (got ${sj(r)})`);
} else {
  skip('V1 full-tier recompile(silverc 不在本机, 见文件头环境说明)');
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
console.log(`[test] classifyPayoutShardFamily — V1 结构签名符但 hand-crafted fixture 不是真实编译产物, recompile byte-compare 应不等 → 'unknown'${HAVE_SILVERC ? '' : '(本机无 silverc, SKIP)'}:`);
if (HAVE_SILVERC) {
  const row = { payout_redeem_hex: buildFakeV1RedeemHex(), pool_merkle_root: PMR, predicate_commit: PC };
  const r = classifyPayoutShardFamily(row);
  ok(r.family === 'unknown', `hand-crafted 非真实产物 → recompile 不等 → unknown, 不误判 v1_committee (got ${sj(r)})`);
} else {
  skip('V1 recompile byte-compare(silverc 不在本机)');
}

// ── §3.1 写入点(ensurePayoutShard/V2 谁编译谁 declare covenant_family) ─────────────────────────
console.log(`\n[test] ensurePayoutShard/V2 genesis-mint 写入点 declare covenant_family(§3.1)${HAVE_SILVERC ? '' : ' — 本机无 silverc, SKIP(见文件头环境说明)'}:`);
if (HAVE_SILVERC) {
  const stubRc = async () => ({ payoutCovId: 'aa'.repeat(32), txId: 'bb'.repeat(32) });
  const stubTransfer = async () => 'cc'.repeat(32);
  const stubLanded = async () => true;

  const marketIdV1 = `psfam-genesis-v1-${randomUUID().slice(0, 8)}`;
  await ensurePayoutShard({ db: sqlite, rc: stubRc, transfer: stubTransfer, landed: stubLanded, p2sh: fakeP2sh, logicalMarketId: marketIdV1, poolMerkleRoot: PMR, predicateCommit: PC, relayAddr: 'kaspatest:relay' });
  const rowV1 = sqlite.prepare('SELECT covenant_family FROM payout_shards WHERE logical_market_id = ?').get(marketIdV1);
  ok(rowV1?.covenant_family === 'v1_committee', `ensurePayoutShard INSERT 声明 covenant_family='v1_committee' (got ${rowV1?.covenant_family})`);

  const marketIdV2 = `psfam-genesis-v2-${randomUUID().slice(0, 8)}`;
  await ensurePayoutShardV2({ db: sqlite, rc: stubRc, transfer: stubTransfer, landed: stubLanded, p2sh: fakeP2sh, logicalMarketId: marketIdV2, poolMerkleRoot: PMR, predicateCommit: PC, closeZkTmplAnchor: 'dd'.repeat(32), relayAddr: 'kaspatest:relay' });
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
