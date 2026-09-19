// 多文件变异对照: 破坏 9-0 的登记面/白名单, 期望 console 测试变红。每次 finally 还原并核对 sha256。
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOT = process.argv[2]; // worktree 根(绝对路径)
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const F = {
  authorize: `${ROOT}/kasia-relay/src/lib/authorize.mjs`,
  commands: `${ROOT}/kasia-relay/src/lib/commands.mjs`,
  relay: `${ROOT}/kasia-relay/src/relay.mjs`,
  ipc: `${ROOT}/kasia-console/src/lib/proto-relay-ipc.mjs`,
};
const orig = Object.fromEntries(Object.entries(F).map(([k, p]) => [k, fs.readFileSync(p)]));
const origSha = Object.fromEntries(Object.entries(orig).map(([k, b]) => [k, sha(b)]));

const muts = [
  ['authorize 里删掉 get_past_median_time(READONLY_ALLOWLIST 漏登记)', 'authorize', `  'get_past_median_time',   // 批9`, `  // 'get_past_median_time',   // 批9`],
  ['commands 里删掉 FIELD_TYPES 一行', 'commands', `  [COMMAND_TYPES.GET_PAST_MEDIAN_TIME]: {},  // 批9 9-0 R2 — read-only, 无 typeof constraint`, ``],
  ['commands 里删掉 PAYLOAD_SCHEMA 一行', 'commands', `  [COMMAND_TYPES.GET_PAST_MEDIAN_TIME]: [],  // 批9 9-0 R2 — read-only, 无 required field`, ``],
  ['relay.mjs 里 case 改名(handler 缺失)', 'relay', `case 'get_past_median_time': {`, `case 'get_past_median_time_x': {`],
  ['console 白名单多夹带一条 read', 'ipc', `  get_past_median_time: 'read',\n});`, `  get_past_median_time: 'read',\n  get_something_else: 'read',\n});`],
  ['console 白名单把新命令标成 write(会被④与a同时抓)', 'ipc', `  get_past_median_time: 'read',`, `  get_past_median_time: 'write',`],
  ['console 白名单删掉新命令', 'ipc', `  get_past_median_time: 'read',\n`, ``],
];

let allRed = true;
try {
  for (const [name, key, find, repl] of muts) {
    const text = orig[key].toString('utf8');
    const cnt = text.split(find).length - 1;
    if (cnt !== 1) { console.log(`[ERR ] ${name}: 锚点命中 ${cnt} 次`); allRed = false; continue; }
    fs.writeFileSync(F[key], text.replace(find, repl));
    const r = spawnSync(process.execPath, ['src/lib/proto-relay-ipc.test.mjs'], { cwd: `${ROOT}/kasia-console`, encoding: 'utf8', timeout: 180000 });
    const fails = (r.stdout || '').split('\n').filter((l) => l.startsWith('[FAIL]')).map((l) => l.slice(7, 30).trim());
    const red = fails.length > 0 || r.status !== 0;
    if (!red) allRed = false;
    console.log(`${red ? '[RED ]' : '[GREEN⚠ 变异存活!]'} ${name}  →  ${fails.length} 条失败 ${fails.slice(0, 4).map((x) => '«' + x + '»').join(' ')}`);
    fs.writeFileSync(F[key], orig[key]);            // 每个变异后立即还原
  }
} finally {
  for (const [k, p] of Object.entries(F)) { fs.writeFileSync(p, orig[k]); }
  const bad = Object.entries(F).filter(([k, p]) => sha(fs.readFileSync(p)) !== origSha[k]).map(([k]) => k);
  console.log(bad.length ? `[!!! 还原失败: ${bad.join(',')} !!!]` : `[RESTORED] 四个文件均已还原, sha256 一致`);
}
console.log(allRed ? '\n全部变异均被抓到' : '\n⚠ 有变异存活');
process.exit(allRed ? 0 : 1);
