// voter_selection.mjs — 生产 selectCommittee(pool-committee-sampler.mjs) 在【真实 6 人池 + 真实 market 行】上的行为;
// excludePks 口径与 bshard-auto-settler.mjs:98/763 一致 = [maker_pk, broker_pk, ...bettorPks]。
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const SIM = 'D:/kanet-tn12/scratch/_j2_pm_e2e_sim';
process.env.DB_PATH = `${SIM}/console.simnet.db`; process.env.CONSOLE_ENCRYPTION_KEY ||= '1'.repeat(64); process.env.KASPA_NETWORK ||= 'simnet';
const { sqlite: db } = await import('file:///D:/kanet-tn12/scratch/_j2_wt_pm_e2e/kasia-console/src/db/client.js');   // 生产 client(M0a 门: 不裸 import better-sqlite3); 需 sim console 已停或仅读
const imp = (p) => import(pathToFileURL('D:/kanet-tn12/scratch/_j2_wt_pm_e2e/kasia-console/src/' + p).href);
const { selectCommittee, deriveCommitteeSeed } = await imp('services/pool-committee-sampler.mjs');
const m = JSON.parse(readFileSync(`${SIM}/market.json`, 'utf8'));
const relays = JSON.parse(readFileSync(`${SIM}/relays.json`, 'utf8'));
const row = db.prepare('select maker_pk, broker_pk, pool_merkle_root from pool_markets where id = ?').get(m.market_id);
const snap = db.prepare('select leaves_json from oracle_pool_chain_view where merkle_root = ? order by snapshot_daa desc limit 1').get(row.pool_merkle_root);
const members = JSON.parse(snap.leaves_json).map((l) => ({ pk_hex: l.pk_x.toLowerCase(), stake_sompi: l.stake_sompi }));
const bettors = db.prepare('select distinct bettor_pk from pool_bettor_sides where market_id like ?').all(m.market_id + '%').map((r) => r.bettor_pk.toLowerCase());
const nameOf = Object.fromEntries(Object.entries(relays).map(([n, r]) => [r.xonly, n]));
const seed = deriveCommitteeSeed(m.market_id, randomBytes(32).toString('hex'), row.pool_merkle_root);
const show = (label, ex) => {
  try { const s = selectCommittee(members, seed, { excludePks: ex }); console.log(`${label}: OK committee=${s.selected.map((c) => nameOf[c.pk_hex] || c.pk_hex.slice(0, 8)).join(',')}`); }
  catch (e) { console.log(`${label}: THROW ${e.message}`); }
};
const poolNames = members.map((x) => nameOf[x.pk_hex]);
console.log('pool(6):', poolNames.join(','), '| maker_pk in pool?', members.some((x) => x.pk_hex === row.maker_pk), '| bettors:', bettors.length);
show('A 真实盘(maker=broker, 2 注者均不在池): exclude=[maker,broker,...bettors]', [row.maker_pk, row.broker_pk, ...bettors]);
const o = members.map((x) => x.pk_hex);
show('B maker 恰在池内(1 个被排除 → 剩 5)', [o[0], o[0], ...bettors]);
show('C maker 与 broker 是池内两个不同委员(2 个被排除 → 剩 4)', [o[0], o[1], ...bettors]);
show('D maker 在池内 + 1 个注者也在池内(2 个被排除 → 剩 4)', [o[0], o[0], o[1]]);
// 公平性: 同一池 500 个随机 seed, 统计每个成员入选次数(排除 0 个)
const cnt = {}; for (let i = 0; i < 500; i++) { const s = selectCommittee(members, deriveCommitteeSeed('x' + i, randomBytes(32).toString('hex'), row.pool_merkle_root), { excludePks: [] }); for (const c of s.selected) cnt[nameOf[c.pk_hex]] = (cnt[nameOf[c.pk_hex]] || 0) + 1; }
console.log('500 次抽样每委员入选次数(排除 0):', JSON.stringify(cnt), '→ 6 选 5 ⇒ 每次必有 1 人落选, 期望入选率≈83%');
// is_oracle 与池的对应(vote 侧只会让 is_oracle=1 的本机 relay 签; 池成员不在本机 is_oracle=1 ⇒ 永远凑不齐签名)
const isOr = db.prepare('select name, is_oracle from relay_nodes where is_oracle = 1').all().map((r) => r.name);
console.log('本机 is_oracle=1 的 relay:', isOr.join(','), '| 池成员全部在本机 is_oracle 集合内?', poolNames.every((n) => isOr.includes('e2e-' + n)));
process.exit(0);
