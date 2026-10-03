// pool-zk-template-env.test.mjs — 账本 1813 A1/A2 单测。
//   A1: 下注注册入口缺 ZK_TOKEN/CLAIM/MARKET_SUFFIX 模板 env ⇒ 在任何转账之前给清晰 400(zk_template_env_missing),
//       而不是在 compilePayoutShardRedeem 深处 throw; 有值则不再是这个 400(请求往下走)。注册侧与结算侧共用
//       readZkTemplateHashes 单一读取点。
//   A2: 主网网络取值——configuredNetwork() 在 KASPA_NETWORK=mainnet 时返回 mainnet, 未设即 throw(不回退 testnet-12);
//       pool.js 的 kaspa-onchain 证据 URL 随网络(mainnet→api.kaspa.org)。
// 真 migration 库 + 真 fastify route(registerPoolRoutes + inject)。不碰链、不广播。
// Run: cd kasia-console && node src/api/pool-zk-template-env.test.mjs
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._ZKTMPLENV_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_zktmplenv_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, DB_PATH: tmpDb, _ZKTMPLENV_TEST_BOOTSTRAPPED: '1', KASPA_RPC_URL: process.env.KASPA_RPC_URL || 'ws://127.0.0.1:1', KASPA_NETWORK: 'mainnet' },
  });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
for (const n of ['ZK_TOKEN_TMPL_HASH', 'ZK_CLAIM_TMPL_HASH', 'ZK_MARKET_SUFFIX_HASH']) delete process.env[n];

const Fastify = (await import('fastify')).default;
const { sqlite } = await import('../db/client.js');
const { registerPoolRoutes, deriveCanonicalFromSourceKind } = await import('./pool.js');
const { readZkTemplateHashes } = await import('../lib/pool-shard-register.mjs');
const { configuredNetwork } = await import('../lib/kaspa-network.mjs');
const { randomUUID } = await import('node:crypto');

let fails = 0;
const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };
const H = (c) => c.repeat(64);

console.log('[test] A1 readZkTemplateHashes(单一读取点, 注入 env):');
{
  const none = readZkTemplateHashes({});
  ok(none.ok === false && none.missing.length === 3 && none.malformed.length === 0, '三个都缺 ⇒ ok:false, missing 三项');
  const part = readZkTemplateHashes({ ZK_TOKEN_TMPL_HASH: H('a'), ZK_CLAIM_TMPL_HASH: H('b') });
  ok(part.ok === false && part.missing.join() === 'ZK_MARKET_SUFFIX_HASH', '缺一个 ⇒ 只报缺的那个');
  const bad = readZkTemplateHashes({ ZK_TOKEN_TMPL_HASH: 'xyz', ZK_CLAIM_TMPL_HASH: H('b'), ZK_MARKET_SUFFIX_HASH: H('c') });
  ok(bad.ok === false && bad.malformed.join() === 'ZK_TOKEN_TMPL_HASH', '非 32B hex ⇒ malformed');
  const good = readZkTemplateHashes({ ZK_TOKEN_TMPL_HASH: H('A'), ZK_CLAIM_TMPL_HASH: H('b'), ZK_MARKET_SUFFIX_HASH: H('c') });
  ok(good.ok === true && good.tokenTmplHash === H('a') && good.claimTmplHash === H('b') && good.marketSuffixHash === H('c'), '三值齐 ⇒ ok:true, 归一小写');
}

console.log('[test] A1 路由: POST /api/pool/market/:id/bettor/register-v07 缺 env ⇒ 400, 有 env ⇒ 不再是该 400:');
{
  sqlite.pragma('foreign_keys = OFF');
  const app = Fastify({ logger: false });
  await registerPoolRoutes(app);
  await app.ready();
  const mid = randomUUID().slice(0, 12);
  sqlite.prepare(`
    INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_version, protocol_status, pool_merkle_root, created_at, updated_at, metadata)
    VALUES (?, 'test-relay', 'kaspa:testp2sh', 'testhash', 9999999999, 'v0.7', 'pending_bettors', ?, datetime('now'), datetime('now'), '{}')
  `).run(mid, H('d'));
  const body = { bettor_pk: H('e'), direction: 0, stake_kas: '1' };
  const r1 = await app.inject({ method: 'POST', url: `/api/pool/market/${mid}/bettor/register-v07`, payload: body });
  const j1 = JSON.parse(r1.body);
  ok(r1.statusCode === 400 && j1.error === 'zk_template_env_missing' && j1.missing.length === 3, `缺 env ⇒ 400 zk_template_env_missing (got ${r1.statusCode} ${j1.error})`);
  ok(/ZK_TOKEN_TMPL_HASH/.test(j1.message) && /ZK_CLAIM_TMPL_HASH/.test(j1.message) && /ZK_MARKET_SUFFIX_HASH/.test(j1.message), '错误信息点名三个 env');
  process.env.ZK_TOKEN_TMPL_HASH = H('a'); process.env.ZK_CLAIM_TMPL_HASH = H('b'); process.env.ZK_MARKET_SUFFIX_HASH = H('c');
  const r2 = await app.inject({ method: 'POST', url: `/api/pool/market/${mid}/bettor/register-v07`, payload: body });
  const j2 = JSON.parse(r2.body);
  ok(j2.error !== 'zk_template_env_missing', `env 齐 ⇒ 请求越过该闸继续往下(got ${r2.statusCode} ${String(j2.error).slice(0, 60)})`);
  // prep/confirm 共用 _v07PrepConfirmPrelude: 源码接线核对(闸在付款前, 且 zkTmpl 经 prelude 传给 confirm 的 registerBettorOnShard)
  const src = fs.readFileSync(new URL('./pool.js', import.meta.url), 'utf8');
  ok(/const zkTmpl = _zkTemplateHashesOrReject\(reply\);[\s\S]{0,200}if \(!zkTmpl\) return null;/.test(src), 'prelude(prep/confirm 共用)内有闸');
  ok((src.match(/\.\.\._zkTmpl,|\.\.\.zkTmpl,/g) || []).length === 2, '两个 registerBettorOnShard 调用点都展开了三个模板值');
}

console.log('[test] A1 创世落库: ensurePayoutShard(V1)/ensurePayoutShardV2 把三值写入 payout_shards(zk_handoff 一致性门 / K-18 coherence 步骤(c) 的读取对象):');
{
  const { ensurePayoutShard, ensurePayoutShardV2 } = await import('../lib/pool-shard-register.mjs');
  const { assertZkHandoffTmplCoherent } = await import('../lib/bshard-close-transport.mjs');
  const T = { tokenTmplHash: H('a'), claimTmplHash: H('b'), marketSuffixHash: H('c') };
  const stubs = { db: sqlite, rc: async () => ({ payoutCovId: H('7'), txId: H('8') }), transfer: async () => H('9'), landed: async () => true, p2sh: () => 'kaspa:stub', poolMerkleRoot: H('1'), predicateCommit: H('2'), relayAddr: 'kaspa:stub' };
  await ensurePayoutShard({ ...stubs, logicalMarketId: 'mk-v1', ...T });
  const r1 = sqlite.prepare('SELECT covenant_family, token_tmpl_hash, claim_tmpl_hash, market_suffix_hash FROM payout_shards WHERE logical_market_id = ?').get('mk-v1');
  ok(r1.covenant_family === 'v1_committee' && r1.token_tmpl_hash === H('a') && r1.claim_tmpl_hash === H('b') && r1.market_suffix_hash === H('c'), 'V1: 三列都写入');
  await ensurePayoutShardV2({ ...stubs, logicalMarketId: 'mk-v2', closeZkTmplAnchor: H('5'), ...T });
  const r2 = sqlite.prepare('SELECT covenant_family, token_tmpl_hash, claim_tmpl_hash, market_suffix_hash FROM payout_shards WHERE logical_market_id = ?').get('mk-v2');
  ok(r2.covenant_family === 'v2_zk' && r2.token_tmpl_hash === H('a') && r2.claim_tmpl_hash === H('b') && r2.market_suffix_hash === H('c'), 'V2: 三列都写入(此前 NULL)');
  let thrown = null; try { assertZkHandoffTmplCoherent(r2, 'mk-v2', T); } catch (e) { thrown = e; }
  ok(!thrown, 'V2 行经 assertZkHandoffTmplCoherent(与生产读取点同值)通过, 不再因 NULL 拒 handoff');
}

console.log('[test] A2 主网网络取值:');
{
  ok(configuredNetwork() === 'mainnet', 'KASPA_NETWORK=mainnet ⇒ configuredNetwork()==="mainnet"');
  const url = deriveCanonicalFromSourceKind('kaspa-onchain', { tx_hash: 'ab'.repeat(32) });
  ok(JSON.stringify(url).includes('https://api.kaspa.org/transactions/') && !JSON.stringify(url).includes('tn12'), `kaspa-onchain 证据 URL 主网指向 api.kaspa.org (got ${JSON.stringify(url).slice(0, 90)})`);
  const saved = process.env.KASPA_NETWORK; delete process.env.KASPA_NETWORK;
  let threw = false; try { configuredNetwork(); } catch { threw = true; }
  ok(threw, 'KASPA_NETWORK 未设 ⇒ throw(不回退 testnet-12)');
  process.env.KASPA_NETWORK = 'simnet';
  ok(configuredNetwork() === 'simnet', 'simnet 验路: configuredNetwork() 返回 simnet(bshard-close-transport 门不再误当 testnet-12)');
  process.env.KASPA_NETWORK = saved;
}

console.log(fails ? `\n❌ ${fails} assertions failed` : '\n✅✅ ALL PASS');
process.exit(fails ? 1 : 0);
