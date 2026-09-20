// proto.test.mjs — 原型v0端点骨架回归(J2 2026-09-14, 路由/字段已与KANet-UI已推前端df9ffab9/52a35de0
// 对齐)。真migration隔离库+真Fastify+app.inject()(同feedback.test.mjs/t-loopback-authz-funds-hotfix
// .test.mjs既有手法)。覆盖:①代币定义真实CRUD ②market_genesis/bet_mint(register_append)已真实落码
// (账本1425/1438, D-020账本1446/1448)——driver关闭时校验通过后一律409 proto_driver_disabled(硬条件①:
// pending行必须先于任何IPC存在, driver关闭只是不发IPC, 不是不写行); market_resolve/claim/withdraw
// 仍是§6/§9未定案的501占位, 不写任何DB状态 ③输入校验先于业务逻辑触发(400/404/409/409占位顺序不乱)
// ④claim候选数量必须恰好1条,0条/>1条一律fail-loud(Bettor 1354裁定,不允许任意挑一条) ⑤
// CONSOLE_ENCRYPTION_KEY非法时create fail-closed(不写任何proto_markets行)。
// 🔴 2026-09-15(J2, Bettor派单·NWT合并后复核抓到): 原来这里断言market create/bet"合法请求但§6/§9
// 未定案→501"已经过期——market_genesis/bet_mint在D-020前后都已经是真实实现, 不再是占位, 断言已按
// 新契约更新, 不是新写的逻辑, 是补上落后于代码的测试。
// Run: cd kasia-console && node src/api/proto.test.mjs

import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._PROTO_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_proto_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, DB_PATH: tmpDb, _PROTO_TEST_BOOTSTRAPPED: '1' },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

// 🔴 测试专用值(只在这个测试进程里生效, 不是真实密钥)——market_genesis 真实实现要加密委员会私钥,
// 没有这个环境变量 computeMarketGenesisArtifacts 会 fail-closed 抛错(这本身也是⑩要测的行为)。
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);

import Fastify from 'fastify';
const { sqlite } = await import('../db/client.js');
const { registerProtoRoutes } = await import('./proto.js');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

const app = Fastify();
await registerProtoRoutes(app);
await app.ready();

let tokenDefId;
console.log('[test] ① 代币定义真实CRUD(纯DB,不上链):');
{
  const res = await app.inject({ method: 'POST', url: '/api/tokens/create', payload: { name: 'Test Token', ticker: 'TST', description: 'demo', faceValue: 8 } });
  const body = JSON.parse(res.body);
  ok(res.statusCode === 200 && body.ok === true, `创建成功: ${res.statusCode} ${res.body.slice(0, 100)}`);
  tokenDefId = body.id;
  const listRes = await app.inject({ method: 'GET', url: '/api/tokens' });
  const listBody = JSON.parse(listRes.body);
  ok(listBody.tokens.length === 1 && listBody.tokens[0].id === tokenDefId, '列表能读回刚创建的定义');

  const missingName = await app.inject({ method: 'POST', url: '/api/tokens/create', payload: { ticker: 'X' } });
  ok(missingName.statusCode === 400, `缺name → 400(实际 ${missingName.statusCode})`);
}

console.log('[test] ②a GET /api/proto-markets 在空表时行为正确(🔴 必须在任何 market 真实写入之前跑——②b 起会真的写 proto_markets 行, 不再是空表):');
{
  const listRes = await app.inject({ method: 'GET', url: '/api/proto-markets' });
  const listBody = JSON.parse(listRes.body);
  ok(listRes.statusCode === 200 && Array.isArray(listBody.markets) && listBody.markets.length === 0, '空市场列表返回200+空数组,不是报错');
}

console.log('[test] ②b POST /api/proto-markets/create: 校验先行, market_genesis真实实现(driver关闭时409, 硬条件①仍先写pending行):');
{
  const badTokenDef = await app.inject({ method: 'POST', url: '/api/proto-markets/create', payload: { tokenId: 'does-not-exist', title: 'Will it rain', deadline: '2099-01-01T00:00' } });
  ok(badTokenDef.statusCode === 404, `不存在的tokenId → 404(实际 ${badTokenDef.statusCode})`);

  const pastDeadline = await app.inject({ method: 'POST', url: '/api/proto-markets/create', payload: { tokenId: tokenDefId, title: 'x', deadline: '2000-01-01T00:00' } });
  ok(pastDeadline.statusCode === 400, `过去的deadline → 400(实际 ${pastDeadline.statusCode})`);

  const beforeCount = sqlite.prepare('SELECT COUNT(*) c FROM proto_markets').get().c;
  const valid = await app.inject({ method: 'POST', url: '/api/proto-markets/create', payload: { tokenId: tokenDefId, title: 'Will it rain', deadline: '2099-01-01T00:00', resolutionNote: 'weather.com' } });
  const body = JSON.parse(valid.body);
  // 🔴 测试环境不配置 PROTO_RELAY_ID(见 proto-relay-guard.mjs 冻结值)⇒ isProtoDriverEnabled()=false
  // ⇒ 硬条件①路径: pending 行已经真实写入(不是"什么都没发生"), 只是不发 IPC, 返回 409。
  ok(valid.statusCode === 409, `合法请求但driver关闭(缺PROTO_RELAY_ID) → 409(实际 ${valid.statusCode})`);
  ok(body.error === 'proto_driver_disabled', `错误码明确是 proto_driver_disabled(实际 ${body.error})`);
  ok(!!body.id && body.status === 'genesis_pending', `响应带id+status=genesis_pending(实际 id=${body.id} status=${body.status})`);
  const afterCount = sqlite.prepare('SELECT COUNT(*) c FROM proto_markets').get().c;
  ok(afterCount === beforeCount + 1, `硬条件①: 恰好写入1行pending记账(不是0行也不是多行, before=${beforeCount} after=${afterCount})`);
  const row = sqlite.prepare('SELECT status, shardleaf_txid, shardleaf_vout FROM proto_markets WHERE id = ?').get(body.id);
  ok(row?.status === 'genesis_pending' && row.shardleaf_txid === null, `写入的行确实是"待广播"态(status=genesis_pending, shardleaf_txid仍为空, 不是伪造的已落链状态): ${JSON.stringify(row)}`);
}

console.log('[test] ③ GET /api/proto-markets/:id 不存在时404:');
{
  const notFound = await app.inject({ method: 'GET', url: '/api/proto-markets/does-not-exist' });
  ok(notFound.statusCode === 404, `不存在的市场id → 404(实际 ${notFound.statusCode})`);
}

console.log('[test] ④ 下注/结算/claim/withdraw 四个端点: market不存在时404(校验先于501占位):');
{
  const bet = await app.inject({ method: 'POST', url: '/api/proto-markets/does-not-exist/bet', payload: { direction: 0, amount: 100 } });
  ok(bet.statusCode === 404, `bet: market不存在 → 404(实际 ${bet.statusCode})`);

  const resolve = await app.inject({ method: 'POST', url: '/api/proto-markets/does-not-exist/resolve', payload: { outcome: 0 } });
  ok(resolve.statusCode === 404, `resolve: market不存在 → 404(实际 ${resolve.statusCode})`);

  const claim = await app.inject({ method: 'POST', url: '/api/proto-markets/does-not-exist/claim' });
  ok(claim.statusCode === 404, `claim: market不存在 → 404(实际 ${claim.statusCode})`);

  const withdraw = await app.inject({ method: 'POST', url: '/api/proto-markets/does-not-exist/withdraw' });
  ok(withdraw.statusCode === 404, `withdraw: market不存在 → 404(实际 ${withdraw.statusCode})`);
}

console.log('[test] ⑤ bet: direction/amount 校验(字段名已改, side/stake 旧名不再被接受); bet_mint(register_append)真实实现, driver关闭时409:');
{
  // 先手工插一个 betting 状态的市场(直接造行测校验, 不依赖①的真实create流程)。
  // 🔴 committee_pubkeys_json 不能是 '[]'——bet 真实实现要从这里派生 bettorPk(v0 单操作员复用委员会
  // pubkey 兼任, Bettor 1354 裁定), 空数组会在到达 driver-disabled 判断之前就先报 500(市场没有委员
  // pubkey 可用), 这不是本测试要覆盖的分支, 用一个占位 pubkey hex 满足这个前置条件。
  const marketId = 'm-test-5';
  const now = new Date().toISOString();
  sqlite.prepare(`INSERT INTO proto_markets (id,token_def_id,deadline_ms,min_bet,committee_pubkeys_json,committee_privkey_enc,rootclose_tmpl_hash,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(marketId, tokenDefId, Date.now() + 100000, 10, JSON.stringify(['cc'.repeat(32)]), 'enc', 'aa'.repeat(32), 'betting', now, now);

  const badDirection = await app.inject({ method: 'POST', url: `/api/proto-markets/${marketId}/bet`, payload: { direction: 2, amount: 100 } });
  ok(badDirection.statusCode === 400, `direction=2(非法) → 400(实际 ${badDirection.statusCode})`);

  const tooSmall = await app.inject({ method: 'POST', url: `/api/proto-markets/${marketId}/bet`, payload: { direction: 0, amount: 1 } });
  ok(tooSmall.statusCode === 400, `amount < min_bet → 400(实际 ${tooSmall.statusCode})`);

  const beforeCount = sqlite.prepare('SELECT COUNT(*) c FROM proto_bets WHERE market_id = ?').get(marketId).c;
  const valid = await app.inject({ method: 'POST', url: `/api/proto-markets/${marketId}/bet`, payload: { direction: 0, amount: 100 } });
  const body = JSON.parse(valid.body);
  ok(valid.statusCode === 409, `合法direction/amount但driver关闭(缺PROTO_RELAY_ID) → 409(实际 ${valid.statusCode})`);
  ok(body.error === 'proto_driver_disabled', `错误码明确是 proto_driver_disabled(实际 ${body.error})`);
  ok(!!body.id && body.status === 'pending', `响应带id+status=pending(实际 id=${body.id} status=${body.status})`);
  const afterCount = sqlite.prepare('SELECT COUNT(*) c FROM proto_bets WHERE market_id = ?').get(marketId).c;
  ok(afterCount === beforeCount + 1, `硬条件①: 恰好写入1行pending下注记账(before=${beforeCount} after=${afterCount})`);
}

console.log('[test] ⑥ resolve: outcome 字段名校验(旧名 winning_side 不再被接受):');
{
  const marketId = 'm-test-6';
  const now = new Date().toISOString();
  sqlite.prepare(`INSERT INTO proto_markets (id,token_def_id,deadline_ms,min_bet,committee_pubkeys_json,committee_privkey_enc,rootclose_tmpl_hash,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(marketId, tokenDefId, Date.now() + 100000, 10, '[]', 'enc', 'aa'.repeat(32), 'sealed', now, now);

  const missing = await app.inject({ method: 'POST', url: `/api/proto-markets/${marketId}/resolve`, payload: { winning_side: 0 } });
  ok(missing.statusCode === 400, `旧字段名winning_side不再被接受, outcome缺失 → 400(实际 ${missing.statusCode})`);

  const valid = await app.inject({ method: 'POST', url: `/api/proto-markets/${marketId}/resolve`, payload: { outcome: 0 } });
  ok(valid.statusCode === 501, `outcome=0且市场sealed → 501(实际 ${valid.statusCode})`);
}

console.log('[test] ⑦ claim: 候选数量必须恰好1条(Bettor 1354裁定, 无bettor_pk筛选参数):');
{
  const marketId = 'm-test-7-zero';
  const now = new Date().toISOString();
// v212 R1 触发器之后: winning_side 只能在 sealed 市场上带 source+set_at 写一次, 夹具不再能 INSERT 带值 / 在非 sealed 状态直写
  sqlite.prepare(`INSERT INTO proto_markets (id,token_def_id,deadline_ms,min_bet,committee_pubkeys_json,committee_privkey_enc,rootclose_tmpl_hash,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(marketId, tokenDefId, Date.now() + 100000, 10, '[]', 'enc', 'aa'.repeat(32), 'sealed', now, now);
  sqlite.prepare("UPDATE proto_markets SET winning_side = 0, winning_side_source = 'operator', winning_side_set_at = ? WHERE id = ?").run(now, marketId);
  sqlite.prepare("UPDATE proto_markets SET status = 'resolved' WHERE id = ?").run(marketId);

  const zeroCandidate = await app.inject({ method: 'POST', url: `/api/proto-markets/${marketId}/claim` });
  ok(zeroCandidate.statusCode === 404, `0条候选 → 404(实际 ${zeroCandidate.statusCode})`);

  sqlite.prepare(`INSERT INTO proto_bets (id,market_id,bettor_pk,side,stake,status,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run('bet-7-1', marketId, 'aa'.repeat(32), 0, 100, 'confirmed', now);
  const oneCandidate = await app.inject({ method: 'POST', url: `/api/proto-markets/${marketId}/claim` });
  ok(oneCandidate.statusCode === 501, `恰好1条候选 → 501(占位,走到了buildAndBroadcast; 实际 ${oneCandidate.statusCode})`);

  sqlite.prepare(`INSERT INTO proto_bets (id,market_id,bettor_pk,side,stake,status,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run('bet-7-2', marketId, 'bb'.repeat(32), 0, 100, 'confirmed', now);
  const twoCandidates = await app.inject({ method: 'POST', url: `/api/proto-markets/${marketId}/claim` });
  const twoBody = JSON.parse(twoCandidates.body);
  ok(twoCandidates.statusCode === 409, `2条候选 → 409 fail-loud(不允许任意挑一条, 实际 ${twoCandidates.statusCode})`);
  ok(/ambiguous/.test(twoBody.error), `错误信息说明是"ambiguous": ${twoBody.error}`);
}

console.log('[test] ⑧ 🔴 MUST(KANet-UI隔离联调发现·Bettor 1356升级): GET响应绝不含committee_privkey_enc(列名或密文内容都不能出现):');
{
  const marketId = 'm-test-8-privkey-leak';
  const now = new Date().toISOString();
  const SECRET_DUMMY_CIPHERTEXT = 'CIPHERTEXT_SHOULD_NEVER_LEAK_abc123def456';
  sqlite.prepare(`INSERT INTO proto_markets (id,token_def_id,deadline_ms,min_bet,committee_pubkeys_json,committee_privkey_enc,rootclose_tmpl_hash,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(marketId, tokenDefId, Date.now() + 100000, 10, '["pubkey-a"]', SECRET_DUMMY_CIPHERTEXT, 'aa'.repeat(32), 'betting', now, now);

  const listRes = await app.inject({ method: 'GET', url: '/api/proto-markets' });
  ok(!listRes.body.includes('committee_privkey_enc'), 'GET /api/proto-markets 响应体不含"committee_privkey_enc"列名');
  ok(!listRes.body.includes(SECRET_DUMMY_CIPHERTEXT), 'GET /api/proto-markets 响应体不含密文内容本身');

  const detailRes = await app.inject({ method: 'GET', url: `/api/proto-markets/${marketId}` });
  ok(!detailRes.body.includes('committee_privkey_enc'), 'GET /api/proto-markets/:id 响应体不含"committee_privkey_enc"列名');
  ok(!detailRes.body.includes(SECRET_DUMMY_CIPHERTEXT), 'GET /api/proto-markets/:id 响应体不含密文内容本身');

  // 正例(防止断言本身是空判定): committee_pubkeys_json 这种公开信息应该还在, 证明不是"整个字段都被清空"
  ok(detailRes.body.includes('pubkey-a'), '公开信息committee_pubkeys_json仍然存在(不是矫枉过正清空了整个market对象)');
}

console.log('[test] ⑨ 🔴 接线笔③三项纪律之一(设计 §9.2③): 所有链上端点请求体带 relay_id 字段一律 400 拒绝(不进入任何业务逻辑, 优先于其它校验):');
{
  const create = await app.inject({ method: 'POST', url: '/api/proto-markets/create', payload: { tokenId: 'x', title: 'y', deadline: '2099-01-01', relay_id: 'sneaky' } });
  ok(create.statusCode === 400 && JSON.parse(create.body).error.includes('relay_id'), `market create 带 relay_id → 400(实际 ${create.statusCode})`);

  const bet = await app.inject({ method: 'POST', url: '/api/proto-markets/does-not-exist/bet', payload: { direction: 0, amount: 5, relay_id: 'sneaky' } });
  ok(bet.statusCode === 400 && JSON.parse(bet.body).error.includes('relay_id'), `bet 带 relay_id → 400(优先于 market-not-found 的 404, 实际 ${bet.statusCode})`);

  const resolve = await app.inject({ method: 'POST', url: '/api/proto-markets/does-not-exist/resolve', payload: { outcome: 0, relay_id: 'sneaky' } });
  ok(resolve.statusCode === 400 && JSON.parse(resolve.body).error.includes('relay_id'), `resolve 带 relay_id → 400(实际 ${resolve.statusCode})`);

  const claim = await app.inject({ method: 'POST', url: '/api/proto-markets/does-not-exist/claim', payload: { relay_id: 'sneaky' } });
  ok(claim.statusCode === 400 && JSON.parse(claim.body).error.includes('relay_id'), `claim 带 relay_id → 400(实际 ${claim.statusCode})`);

  const withdraw = await app.inject({ method: 'POST', url: '/api/proto-markets/does-not-exist/withdraw', payload: { relay_id: 'sneaky' } });
  ok(withdraw.statusCode === 400 && JSON.parse(withdraw.body).error.includes('relay_id'), `withdraw 带 relay_id → 400(实际 ${withdraw.statusCode})`);

  // 对照: 不带 relay_id 时行为不变(仍然是既有的 404/501, 证明这条检查没有误伤正常请求——KANet-UI 前端从不传这个字段)
  const createNormal = await app.inject({ method: 'POST', url: '/api/proto-markets/create', payload: { tokenId: 'does-not-exist', title: 'y', deadline: '2099-01-01' } });
  ok(createNormal.statusCode === 404, `对照: 不带 relay_id 的 market create 行为不变, 仍是既有的 404(实际 ${createNormal.statusCode})`);
}

console.log('[test] ⑩ CONSOLE_ENCRYPTION_KEY 非法(缺失/格式错) → market create fail-closed(500, 明确错误信息), 不写入任何proto_markets行(不允许"半成功"的记录被后续流程当真推进):');
{
  const savedKey = process.env.CONSOLE_ENCRYPTION_KEY;
  const beforeCount = sqlite.prepare('SELECT COUNT(*) c FROM proto_markets').get().c;
  try {
    delete process.env.CONSOLE_ENCRYPTION_KEY;
    const missing = await app.inject({ method: 'POST', url: '/api/proto-markets/create', payload: { tokenId: tokenDefId, title: 'key missing', deadline: '2099-01-01T00:00' } });
    const missingBody = JSON.parse(missing.body);
    ok(missing.statusCode === 500, `CONSOLE_ENCRYPTION_KEY 缺失 → 500(实际 ${missing.statusCode})`);
    ok(/CONSOLE_ENCRYPTION_KEY/.test(missingBody.error), `错误信息明确点名 CONSOLE_ENCRYPTION_KEY(实际: ${missingBody.error})`);

    process.env.CONSOLE_ENCRYPTION_KEY = 'not-a-valid-64-hex-key';
    const malformed = await app.inject({ method: 'POST', url: '/api/proto-markets/create', payload: { tokenId: tokenDefId, title: 'key malformed', deadline: '2099-01-01T00:00' } });
    const malformedBody = JSON.parse(malformed.body);
    ok(malformed.statusCode === 500, `CONSOLE_ENCRYPTION_KEY 格式错(非64位hex) → 500(实际 ${malformed.statusCode})`);
    ok(/CONSOLE_ENCRYPTION_KEY/.test(malformedBody.error), `错误信息明确点名 CONSOLE_ENCRYPTION_KEY(实际: ${malformedBody.error})`);
  } finally {
    process.env.CONSOLE_ENCRYPTION_KEY = savedKey;
  }
  const afterCount = sqlite.prepare('SELECT COUNT(*) c FROM proto_markets').get().c;
  ok(afterCount === beforeCount, `fail-closed: 两次失败请求都不写入任何proto_markets行(NO-TX-NO-STATE——半成功的委员会 keypair 生成绝不能留下会被 driveMarketGenesis 推进的记录, before=${beforeCount} after=${afterCount})`);
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — 原型v0端点骨架(代币定义CRUD真实可用 + market_genesis/bet_mint真实实现driver关闭时409 + resolve/claim/withdraw仍501占位+零DB副作用 + claim候选数量硬闸 + CONSOLE_ENCRYPTION_KEY非法fail-closed) 全绿'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
