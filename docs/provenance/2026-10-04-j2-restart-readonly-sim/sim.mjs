// 重启前只读模拟: 对【mainnet DB 副本】跑生产 tick 函数(真 SQL 选择器), ctx 的一切副作用(relay/广播/转账)全部 stub 成"记录并抛错"。
process.env.DB_PATH = 'D:/kanet-tn12/scratch/_j2_restart_sim/console.mainnet.copy.db';
process.env.IBD_TICK_GATE = '0'; // 模拟里无活节点 RPC, 门会 fail-closed 全 skip 而掩盖选择器; 关门让真 SQL 选择器跑起来
process.env.CONSOLE_ENCRYPTION_KEY = '2'.repeat(64); process.env.KASPA_NETWORK = 'mainnet';
process.env.BSHARD_SETTLER_RELAY_ID = 'SIM-STUB-RELAY'; process.env.SETTLE_DAEMON_FEE_RELAY_ID = 'SIM-STUB-RELAY';
const R = 'file:///D:/kanet-tn12/kasia-console/src/';
const calls = []; const trap = (n) => async (...a) => { calls.push(n); throw new Error('SIM: side-effect blocked ' + n); };
const ctx = new Proxy({}, { get: (_, k) => (k === 'settlerRelayId' ? 'SIM-STUB-RELAY' : trap(String(k))) });
const { sqlite: db } = await import(R + 'db/client.js');
const T = await import(R + 'lib/zk-autonomy-ticks.mjs');
const V = await import(R + 'services/bshard-close-voter.js');
const W = await import(R + 'services/zk-prove-worker.mjs');
const out = {};
const run = async (name, fn) => { const c0 = calls.length; try { out[name] = { result: await fn(), sideEffectAttempts: calls.slice(c0) }; } catch (e) { out[name] = { threw: e.message, sideEffectAttempts: calls.slice(c0) }; } };
await run('1 ZK_JUDGE_PROPOSE (zkJudgeProposeAutonomousTick)', () => T.zkJudgeProposeAutonomousTick({ settlerRelayId: 'SIM-STUB-RELAY', judgeWinDir: trap('judgeWinDir'), endBlockHash: trap('endBlockHash'), getCurrentDaaScore: async () => 9e12, buildProposeCloseRequestV2: trap('buildProposeCloseRequestV2') }));
await run('2 VOTER_V2 (bshardCloseVoterV2Tick)', () => V.bshardCloseVoterV2Tick());
await run('3 SUBMIT_V2 (bshardCloseSubmitV2Tick)', () => V.bshardCloseSubmitV2Tick());
await run('4 HANDOFF (zkHandoffAutonomousTick)', () => T.zkHandoffAutonomousTick({ settlerRelayId: 'SIM-STUB-RELAY', buildZkHandoffRequestV2: trap('buildZkHandoffRequestV2'), checkLanded: trap('checkLanded') }));
await run('5 PROVE_WORKER (zkProveWorkerTick)', () => W.zkProveWorkerTick());
await run('6 CLOSE_TICK_V2 (zkCloseTickV2)', () => T.zkCloseTickV2({ dispatchUnlockZkClose: trap('dispatchUnlockZkClose'), checkLanded: trap('checkLanded') }));
await run('7 CLAIM (claimAutonomousTick)', () => T.claimAutonomousTick({ relayCall: trap('relayCall'), checkLanded: trap('checkLanded'), mintFeeUtxo: trap('mintFeeUtxo'), p2shAddr: trap('p2shAddr'), p2pkAddr: trap('p2pkAddr') }));
const q = (s) => db.prepare(s).all();
out.rowsThatAnyTickWouldPick = {
  pool_markets_total: q('select count(*) c from pool_markets')[0].c,
  payout_shards_total: q('select count(*) c from payout_shards')[0].c,
  zk_prove_jobs_total: q('select count(*) c from zk_prove_jobs')[0].c,
  collecting_sigs_markets: q("select id from pool_markets where protocol_status='collecting_sigs'").length,
  is_oracle_relays: q('select count(*) c from relay_nodes where is_oracle=1')[0].c,
  events_written_by_sim: q("select event_type,count(*) n from events where julianday(created_at) > julianday('now','-5 minutes') group by 1"),
};
console.log('\n=====SIM-RESULT=====\n' + JSON.stringify(out, null, 1));
process.exit(0);
