// start-console.mjs — 起隔离 simnet console(装 upstream-mock-d032, 从 kanet.simnet.env 读配置)。
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const ENVFILE = 'D:/kanet-tn12/scratch/_j2_d032_e2e/kanet.simnet.env';
const env = { ...process.env };
for (const line of fs.readFileSync(ENVFILE, 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2]; }
env.NODE_OPTIONS = `--import=${pathToFileURL('D:/kanet-tn12/scratch/_j2_d032_e2e/scripts/upstream-mock-d032.mjs').href}`;
env.E2E_SCENARIO_FILE = 'D:/kanet-tn12/scratch/_j2_d032_e2e/scenario.json';
const child = spawn(process.execPath, ['src/index.js'], { cwd: 'D:/kanet-tn12/scratch/_j2_wt_e2e/kasia-console', env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (d) => process.stdout.write(d));
child.stderr.on('data', (d) => process.stderr.write(d));
child.on('exit', (code) => { console.log(`[start-console] console exited code=${code}`); process.exit(code ?? 1); });
console.log(`[start-console] spawned console PID=${child.pid} PORT=${env.PORT}`);
