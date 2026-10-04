// 阳性对照: 在【第二份副本】里造一行 v0.7 zk_native collecting_sigs 市场, 证明模拟用的选择器真能选中它(否则"0 候选"无信息)。
process.env.DB_PATH = 'D:/kanet-tn12/scratch/_j2_restart_sim/console.posctl.db'; process.env.IBD_TICK_GATE = '0';
process.env.CONSOLE_ENCRYPTION_KEY = '2'.repeat(64); process.env.KASPA_NETWORK = 'mainnet'; process.env.BSHARD_SETTLER_RELAY_ID = 'SIM-STUB';
const R = 'file:///D:/kanet-tn12/kasia-console/src/';
const { sqlite: db } = await import(R + 'db/client.js');
const cols = db.prepare('pragma table_info(pool_markets)').all();
const row = { id: 'posctl-1', maker_relay_id: 'x', spine_p2sh: 'x', spine_lock_tx: 'x', market_metadata_hash: 'x', oracle1_pk: 'x', oracle2_pk: 'x', oracle3_pk: 'x', broker_pk: 'x', deadline: 1, miner_fee: 0, broker_fee_pct: 0, oracle_bond_amount: 0, maker_stake_amount: 0, protocol_status: 'collecting_sigs', protocol_version: 'v0.7', deadline_daa: 1, resolution_rule_spec: JSON.stringify({ zk_native: true }), metadata: JSON.stringify({ bshard_close_request_v2: { txSafeJson: '{}', committee_pks: [], claimedPayoutRoot: 'x', closeInputs: {} } }) };
for (const c of cols) if (c.notnull && !(c.name in row) && c.dflt_value == null) row[c.name] = c.type.match(/INT|REAL/i) ? 0 : 'x';
db.prepare(`insert into pool_markets (${Object.keys(row).join(',')}) values (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
const V = await import(R + 'services/bshard-close-voter.js');
const calls = []; 
console.log('POSCTL submitV2:', JSON.stringify(await V.bshardCloseSubmitV2Tick().catch(e => ({ threw: e.message }))));
console.log('POSCTL voterV2 :', JSON.stringify(await V.bshardCloseVoterV2Tick().catch(e => ({ threw: e.message }))));
process.exit(0);
