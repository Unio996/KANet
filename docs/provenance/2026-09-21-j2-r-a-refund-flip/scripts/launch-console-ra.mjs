// launch-console-ra.mjs — R-a 准入: 用【R-a worktree 的代码】启动隔离 simnet console(同 launch-console.mjs, 只改 KANET_ROOT 与 cwd; 日志追加到 console-ra-*.log)。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const RUN = 'D:/kanet-tn12/scratch/_j2_e2e_run';
const WT = 'D:/kanet-tn12/scratch/_j2_wt_ra';
const env = { ...process.env };
for (const line of fs.readFileSync(`${RUN}/kanet.simnet.env`, 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2]; }
env.KANET_ROOT = WT;
if (env.KASPA_NETWORK !== 'simnet' || !/^ws:\/\/127\.0\.0\.1:28510$/.test(env.KASPA_RPC_URL) || env.PORT !== '3298' || !env.DB_PATH.includes('_j2_e2e_run')) { console.error('REFUSE: env 不是预期的隔离 simnet 配置'); process.exit(2); }
if (env.PROTO_ORACLE_VALUELESS_TOKEN_IDS !== 'e2e-valueless-token') { console.error('REFUSE: 白名单不是本轮测试代币'); process.exit(2); }
const mock = pathToFileURL('D:/kanet-tn12/scratch/_j2_e2e/upstream-mock.mjs').href;
const out = fs.openSync(`${RUN}/logs/console-ra-stdout.log`, 'a'), err = fs.openSync(`${RUN}/logs/console-ra-stderr.log`, 'a');
const child = spawn(process.execPath, ['--import', mock, 'src/index.js'], { cwd: `${WT}/kasia-console`, env, detached: true, stdio: ['ignore', out, err], windowsHide: true });
child.unref(); fs.writeFileSync(`${RUN}/console.pid`, String(child.pid));
console.log(`console(R-a) pid=${child.pid} port=${env.PORT} network=${env.KASPA_NETWORK} KANET_ROOT=${env.KANET_ROOT}`);
process.exit(0);
