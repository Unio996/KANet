#!/usr/bin/env node
// scripts/test-cron.mjs — 定时跑 test-framework, 失败 broadcast dev-coord
//
// 设计 (Owner 钦定 4 台阶 #4):
// - 定时跑 (默认 6h, 可配 KANET_TEST_CRON_INTERVAL_MS)
// - 跑所有 domain 全 case (--all 不带 --tag 过滤)
// - PASS 静默, FAIL 喧闹 (broadcast dev-coord)
// - 启动时立即跑一次 (boot 即验), 之后周期跑
// - SIGTERM/SIGINT graceful shutdown
//
// 使用:
//   node scripts/test-cron.mjs                  # 默认 6h, 立即跑一次
//   KANET_TEST_CRON_INTERVAL_MS=3600000 node scripts/test-cron.mjs   # 1h
//   KANET_TEST_CRON_NO_BOOT_RUN=1 node scripts/test-cron.mjs         # 启动不立即跑
//
// 失败 broadcast 用 NWT relay (5b236c08) 发到 dev-coord.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KASIA_ROOT = path.dirname(__dirname);
const NWT_RELAY_ID = '5b236c08-03d0-456c-953d-e10001610938';
const CONSOLE_URL = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3100';

const INTERVAL_MS = Number(process.env.KANET_TEST_CRON_INTERVAL_MS) || 6 * 60 * 60 * 1000;
const NO_BOOT_RUN = process.env.KANET_TEST_CRON_NO_BOOT_RUN === '1';

let isRunning = false;
let stopped = false;

function ts() { return new Date().toISOString().slice(11, 19); }
function log(...args) { console.log(`[test-cron ${ts()}]`, ...args); }

async function broadcastFailure(summary, failCases) {
  const message = `🚨 [test-cron] 周期跑发现 regression — ${ts()}

${summary}

失败 case:
${failCases.map(c => `- ${c}`).join('\n')}

(commit 没改, 是 '环境漂移' 类问题: 模型升级 / RPC 抽风 / 外部依赖坏 等)
查 logs/test-cron.log 看完整 trace.`;

  try {
    const res = await fetch(`${CONSOLE_URL}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        relayId: NWT_RELAY_ID,
        channel: 'dev-coord',
        message,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      log(`broadcast ok, tx=${data.txId?.slice(0, 10)}`);
    } else {
      log(`broadcast HTTP ${res.status}`);
    }
  } catch (err) {
    log(`broadcast err: ${err.message}`);
  }
}

async function runOnce() {
  if (isRunning) {
    log('skip — previous run still in progress');
    return;
  }
  isRunning = true;
  const t0 = Date.now();

  // Pre-check: console alive?
  try {
    const ping = await fetch(`${CONSOLE_URL}/api/chat/channels`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!ping.ok) throw new Error(`HTTP ${ping.status}`);
  } catch (err) {
    log(`console down (${err.message}), skip this cycle`);
    isRunning = false;
    return;
  }

  log('running --all (broker domain)...');
  const child = spawn('node', ['scripts/test.mjs', '--all', '--quiet'], {
    cwd: KASIA_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '', stderr = '';
  child.stdout.on('data', d => { stdout += d.toString(); });
  child.stderr.on('data', d => { stderr += d.toString(); });

  await new Promise(resolve => child.on('exit', resolve));
  const exitCode = child.exitCode;
  const dur = Math.round((Date.now() - t0) / 1000);

  // Parse summary line
  const summaryMatch = stdout.match(/Summary: (\d+) PASS \/ (\d+) FAIL \/ (\d+) run/);
  const failLines = stdout.split('\n').filter(l => l.startsWith('  FAIL '));

  if (exitCode === 0) {
    log(`PASS in ${dur}s — ${summaryMatch?.[0] || stdout.slice(-200)}`);
  } else {
    const failCases = failLines.length > 0
      ? failLines.map(l => l.replace(/^\s+FAIL\s+/, '').trim())
      : ['(详见 logs/test-cron.log)'];
    log(`FAIL in ${dur}s — ${summaryMatch?.[0] || ''}`);
    log(`fail cases: ${failCases.join(', ')}`);
    await broadcastFailure(summaryMatch?.[0] || `Summary unknown (exit ${exitCode})`, failCases);
  }

  isRunning = false;
}

async function main() {
  log(`starting — interval ${INTERVAL_MS / 1000}s (${(INTERVAL_MS / 3600000).toFixed(1)}h)`);

  // Graceful shutdown
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      log(`got ${sig}, shutting down`);
      stopped = true;
      process.exit(0);
    });
  }

  if (!NO_BOOT_RUN) {
    log('boot run');
    await runOnce();
  }

  // setInterval recursion (avoid setInterval drift / overlap)
  while (!stopped) {
    await new Promise(r => setTimeout(r, INTERVAL_MS));
    if (stopped) break;
    await runOnce();
  }
}

main().catch(err => {
  console.error('test-cron fatal:', err);
  process.exit(2);
});
