// mkenv_mm.mjs — 账本1855 simnet 验收 env: 取上次严格零 e2e 的 env(同 sink/RD/模板 hash), 指到本 worktree + 新库副本 + 种子器/桩/上限。
// 用法: node mkenv_mm.mjs <tag>   (tag = pos | neg; 写 D:/kanet-tn12/scratch/_j2_mm/env.mm.<tag>.simnet 并从 console.sz.db 复制 console.mm.<tag>.db)
import { readFileSync, writeFileSync, copyFileSync, existsSync, unlinkSync } from 'node:fs';
const tag = process.argv[2] || 'pos';
const OUT = 'D:/kanet-tn12/scratch/_j2_mm';
let env = readFileSync('D:/kanet-tn12/scratch/_j2_sz/env.sz.simnet', 'utf8');
env = env.replace(/_j2_wt_sz/g, '_j2_wt_mm').replace(/D:\/kanet-tn12\/scratch\/_j2_sz\/console\.sz\.db/, `${OUT}/console.mm.${tag}.db`);
const relays = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_j2_tok_sim/relays.json', 'utf8'));
const set = (k, v) => { const re = new RegExp(`^${k}=.*$`, 'm'); env = re.test(env) ? env.replace(re, `${k}=${v}`) : env + `\n${k}=${v}`; };
set('POOL_SEEDER_ENABLED', '1'); set('DEMO_POOL_MARKET_SEEDER_OFF', '0');
set('POOL_SEEDER_MAKER_RELAY', relays.maker.id);          // 无 GATEWAY_RELAY_ID: 走"塌到 maker"回退(主网同形)
env = env.replace(/^GATEWAY_RELAY_ID=.*\n?/m, '');
set('POOL_SEED_TARGET', '3'); set('POOL_SEED_INTERVAL_MIN', '1'); set('POOL_SEED_MAX_PER_TICK', '1'); set('POOL_SEED_MIN_LEAD_MIN', '3');
set('POOL_SEED_GAMMA_URL', 'http://127.0.0.1:3399/gamma'); set('UMA_POLYGON_RPCS', 'http://127.0.0.1:3401,http://127.0.0.1:3402');
set('ZK_MAX_LIVE_MARKETS', '3');
if (tag === 'neg') set('ZK_FEE_PINS_DISABLED', '1');
writeFileSync(`${OUT}/env.mm.${tag}.simnet`, env);
const db = `${OUT}/console.mm.${tag}.db`;
for (const s of ['', '-wal', '-shm']) { try { unlinkSync(db + s); } catch {} }
// 取上次 e2e 后的库(含 WAL): 先在源上做 checkpoint 副本——源是 scratch 副本, 不是主网库
copyFileSync('D:/kanet-tn12/scratch/_j2_sz/console.sz.db', db);
for (const s of ['-wal']) if (existsSync(`D:/kanet-tn12/scratch/_j2_sz/console.sz.db${s}`)) copyFileSync(`D:/kanet-tn12/scratch/_j2_sz/console.sz.db${s}`, db + s);
console.log('env written', `${OUT}/env.mm.${tag}.simnet`, 'db', db, 'pins', tag === 'neg' ? 'DISABLED' : 'on');
