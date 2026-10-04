// strict-zero-config.test.mjs — 账本1850 严格零方案: sink/DAA 配置 fail-closed + 模板哈希依赖 + 铸票守卫 + 一次一盘查询逻辑。
// Run: cd kasia-console && node src/lib/strict-zero-config.test.mjs
process.env.KASPA_NETWORK = 'simnet';
delete process.env.ZK_SYSTEM_SINK_PK; delete process.env.ZK_CLAIM_RETIRE_DAA; delete process.env.ZK_TICKET_SWEEP_DAA; delete process.env.KANET_NO_KAS_STAKE_MODE;
const { resolveSinkConfig, assertDeadlineWithinTicketAge, DEFAULT_RETIRE_DAA, DEFAULT_TICKET_SWEEP_DAA } = await import('./zk-sink-config.mjs');
const { assertTicketMintAllowed } = await import('./pool-shard-register.mjs');
const { findUnfinishedZkNativeMarket } = await import('./mainnet-no-kas-stake-gate.mjs');
const A = await import('./pool-bshard-artifacts.mjs');
let fails = 0; const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };
const throws = (f) => { try { f(); return null; } catch (e) { return String(e.message); } };
const SINK = 'ab'.repeat(32), SINK2 = 'cd'.repeat(32);

console.log('[test] resolveSinkConfig');
ok(/ZK_SYSTEM_SINK_PK/.test(throws(() => resolveSinkConfig({}, { KASPA_NETWORK: 'mainnet' })) || ''), '主网缺 sink ⇒ throw');
ok(/ZK_SYSTEM_SINK_PK/.test(throws(() => resolveSinkConfig({}, { KASPA_NETWORK: 'simnet' })) || ''), '非主网缺 sink 也 throw(无默认 sink)');
ok(/ZK_CLAIM_RETIRE_DAA/.test(throws(() => resolveSinkConfig({}, { KASPA_NETWORK: 'mainnet', ZK_SYSTEM_SINK_PK: SINK })) || ''), '主网缺 retire DAA ⇒ throw(无默认)');
ok(/ZK_CLAIM_RETIRE_DAA/.test(throws(() => resolveSinkConfig({}, { KASPA_NETWORK: 'simnet', KANET_NO_KAS_STAKE_MODE: '1', ZK_SYSTEM_SINK_PK: SINK })) || ''), '不收 KAS 模式缺 retire DAA ⇒ throw');
ok(/ZK_CLAIM_RETIRE_DAA/.test(throws(() => resolveSinkConfig({}, { ZK_SYSTEM_SINK_PK: SINK })) || ''), '网络未配/未知 ⇒ 按主网严格(fail-closed)');
{
  const c = resolveSinkConfig({}, { KASPA_NETWORK: 'simnet', ZK_SYSTEM_SINK_PK: SINK });
  ok(c.sinkPkHex === SINK && c.retireDaa === DEFAULT_RETIRE_DAA && c.sweepDaa === DEFAULT_TICKET_SWEEP_DAA && DEFAULT_RETIRE_DAA === 25_920_000 && DEFAULT_TICKET_SWEEP_DAA === 315_360_000, '非主网: retire 默认 25,920,000(30 天) / sweep 默认 315,360,000(365 天)');
}
{
  const c = resolveSinkConfig({}, { KASPA_NETWORK: 'mainnet', ZK_SYSTEM_SINK_PK: SINK, ZK_CLAIM_RETIRE_DAA: '30000000', ZK_TICKET_SWEEP_DAA: '400000000' });
  ok(c.retireDaa === 30000000 && c.sweepDaa === 400000000, '主网显式值被采纳(含票龄默认被覆盖)');
}
for (const bad of ['0', '-5', '1.5', 'abc', String(2 ** 32), '1e9']) ok(!!throws(() => resolveSinkConfig({}, { KASPA_NETWORK: 'mainnet', ZK_SYSTEM_SINK_PK: SINK, ZK_CLAIM_RETIRE_DAA: bad })), `retire DAA=${bad} ⇒ throw`);
for (const bad of ['', 'zz'.repeat(32), 'AB'.repeat(32), 'ab'.repeat(31), '00'.repeat(32)]) ok(!!throws(() => resolveSinkConfig({}, { KASPA_NETWORK: 'simnet', ZK_SYSTEM_SINK_PK: bad })), `非法 sink "${bad.slice(0, 6)}…" ⇒ throw`);

console.log('[test] assertDeadlineWithinTicketAge(票龄 365d, 余量 60d ⇒ 最晚 305d)');
{
  const now = 1_800_000_000, d = 86400;
  ok(assertDeadlineWithinTicketAge({ deadlineSec: now + 305 * d, nowSec: now, sweepDaa: DEFAULT_TICKET_SWEEP_DAA }) === null, '恰 305 天 ⇒ 过');
  ok(!!assertDeadlineWithinTicketAge({ deadlineSec: now + 305 * d + 1, nowSec: now, sweepDaa: DEFAULT_TICKET_SWEEP_DAA }), '305 天 + 1 秒 ⇒ 拒');
  ok(!!assertDeadlineWithinTicketAge({ deadlineSec: now + 1, nowSec: now, sweepDaa: 864000 }), '票龄 1 天(< 余量) ⇒ 任何 deadline 拒');
  ok(!!assertDeadlineWithinTicketAge({ deadlineSec: NaN, nowSec: now, sweepDaa: DEFAULT_TICKET_SWEEP_DAA }), 'deadline 非数 ⇒ 拒(fail-closed)');
  ok(assertDeadlineWithinTicketAge({ deadlineSec: now + 20 * d, nowSec: now, sweepDaa: 7_200_000, daaPerSecond: 1 }) === null && !!assertDeadlineWithinTicketAge({ deadlineSec: now + 20 * d, nowSec: now, sweepDaa: 7_200_000 }), 'daaPerSecond 可覆盖(simnet 彩排), 默认 10 BPS');
}

console.log('[test] 铸票守卫 assertTicketMintAllowed(账本1850 条件1)');
ok(throws(() => assertTicketMintAllowed({ zkNative: true, spineP2sh: null, logicalMarketId: 'm' })) === null, 'zkNative===true 且 spine=null ⇒ 许铸');
ok(throws(() => assertTicketMintAllowed({ zkNative: true, spineP2sh: '', logicalMarketId: 'm' })) === null, "spine='' ⇒ 许铸");
ok(/非 ZK 原生/.test(throws(() => assertTicketMintAllowed({ zkNative: false, spineP2sh: null, logicalMarketId: 'm' })) || ''), 'zkNative=false ⇒ 拒(legacy RootClaim/RefundClaim 会搁浅)');
ok(/非 ZK 原生/.test(throws(() => assertTicketMintAllowed({ spineP2sh: null, logicalMarketId: 'm' })) || ''), 'zkNative 缺省 ⇒ 拒');
ok(/带 spine/.test(throws(() => assertTicketMintAllowed({ zkNative: true, spineP2sh: 'kaspa:qq', logicalMarketId: 'm' })) || ''), '带 spine ⇒ 拒');
ok(/未声明 spineP2sh/.test(throws(() => assertTicketMintAllowed({ zkNative: true, logicalMarketId: 'm' })) || ''), 'spineP2sh 未传(undefined) ⇒ 拒(调用方必须显式传 null)');
ok(/非 ZK 原生/.test(throws(() => assertTicketMintAllowed({ zkNative: 1, spineP2sh: null, logicalMarketId: 'm' })) || ''), "zkNative 必须严格 === true(1/'true' 不算)");

console.log('[test] 模板哈希依赖(真实 silverc v1.0.0 编译)');
{
  const H = (c) => c.repeat(32);
  const t = (o = {}) => A.computePoolSideTicketArtifact({ bettorPk: H('11'), direction: 0, stake: 5, shardPoolId: H('22'), sinkPkHex: SINK, sweepDaa: 1000, retireDaa: 1000, ...o }).templateHashHex;
  ok(t() === t({ bettorPk: H('99'), direction: 1, stake: 777, shardPoolId: H('88') }), '票模板 hash 不随 State(bettorPk/direction/stake/shardPoolId)变');
  ok(t() !== t({ sinkPkHex: SINK2 }) && t() !== t({ sweepDaa: 1001 }), '票模板 hash 随 sink / sweep_daa 变(常量在模板里)');
  ok(t() === t({ retireDaa: 5555 }), '票模板 hash 不随 claim 的 retire_daa 变(两个 DAA 参数分离)');
  const c = (o = {}) => A.computeKanetTokenClaimArtifact({ marketCovIdHex: H('11'), winnerPkHex: H('22'), amount: 5, tokenTmplHashHex: H('44'), sinkPkHex: SINK, retireDaa: 1000, ...o }).templateHashHex;
  ok(c() === c({ marketCovIdHex: H('77'), winnerPkHex: H('66'), amount: 999 }), 'claim 模板 hash 不随 State(market_cov_id/winner_pk/amount)变');
  ok(c() !== c({ sinkPkHex: SINK2 }) && c() !== c({ retireDaa: 1001 }), 'claim 模板 hash 随 sink / retire_daa 变');
  const ktt = A.computeKttTokenArtifact({ amount: 5, ownerCovIdHex: H('11') }).templateHashHex;
  ok(ktt === '225ebcdec51f5439326e6bc48e47c288ceacbd3bea07aea6771548eeed44d80e', 'TOKEN(KTT)模板 hash 仍 = 225ebcde…(账本1850: TOKEN 不变)');
  ok(!!throws(() => A.computePoolSideTicketArtifact({ bettorPk: H('11'), direction: 0, stake: 5, shardPoolId: H('22') })), '票: 缺 sink(且 env 无) ⇒ throw(simnet 下也不放行)');
  ok(!!throws(() => A.computeKanetTokenClaimArtifact({ marketCovIdHex: H('11'), winnerPkHex: H('22'), amount: 5, tokenTmplHashHex: H('44') })), 'claim: 缺 sink(且 env 无) ⇒ throw');
}

console.log('[test] findUnfinishedZkNativeMarket(伪库: 只验 JS 判定; SQL 对真库另有一次实库核对)');
{
  const mkDb = (rows) => ({ prepare: (sql) => ({ all: (...a) => { mkDb.lastSql = sql; mkDb.lastArgs = a; return rows; } }) });
  ok(findUnfinishedZkNativeMarket(mkDb([])) === null, '无行 ⇒ null');
  ok(findUnfinishedZkNativeMarket(mkDb([{ id: 'a', protocol_status: 'attested_v2', metadata: JSON.stringify({ zk_continuation: { exhausted: true } }) }])) === null, 'exhausted=true ⇒ 完结');
  ok(findUnfinishedZkNativeMarket(mkDb([{ id: 'a', protocol_status: 'attested_v2', metadata: JSON.stringify({ zk_continuation: { exhausted: false } }) }, { id: 'b', protocol_status: 'open', metadata: null }]))?.id === 'a', '第一个未完结盘被返回');
  ok(findUnfinishedZkNativeMarket(mkDb([{ id: 'a', protocol_status: 'verifying', metadata: 'not json' }]))?.id === 'a', '坏 metadata ⇒ 按未完结(fail-closed)');
  ok(findUnfinishedZkNativeMarket(mkDb([{ id: 'a', protocol_status: 'verifying', metadata: '{}' }]))?.id === 'a', '无 zk_continuation ⇒ 未完结');
  findUnfinishedZkNativeMarket(mkDb([]));
  ok(['completed', 'refunded', 'cancelled', 'expired', 'shard_internal'].every((s) => mkDb.lastArgs.includes(s)) && /json_valid\(resolution_rule_spec\)/.test(mkDb.lastSql), 'SQL 排除终态集 + 先 json_valid 再 json_extract(坏 spec 不抛)');
}

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
