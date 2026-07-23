// M0c-1 gate 实战 harness runner — persona 平替真人端到端(Owner 令·不走过场)
// 设计: docs/2026-07-23-m0c-1-app-provision-harness-design.md
// 跑法(cwd=D:/kanet-tn12): node kasia-console/test-framework/cases/m0c1-gate/harness.mjs
//
// 做什么: 隔离环境(fork 真 relay·armed=on·GRANT_ENVELOPE_IMPLEMENTED 临时 flip true·非 live)
// 对生产 authorizeCommand→verifyAppEnvelope→switch 全链实发六 persona 命令流, 逐命令记 gate 决策
// evidence, 断言 allow/deny, 落 evidence log。跑完复位 flag(sha256 自证 == 原始)+ stop relay。
// NWT 搭时核: (a)allow 条 evidence 显示 gate=allow 且进 switch(执行层错误); (b)伪签五字段全谱。

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');            // D:/kanet-tn12
const AUTHZ = path.join(ROOT, 'kasia-relay/src/lib/authorize.mjs');
const PROVISION = path.join(ROOT, 'kasia-console/scripts/m0c1-grant-provision.mjs');
const DB = path.join(ROOT, 'scratch/m0c1-gate-harness.db');
const LOG_DIR = path.join(ROOT, 'logs/test-runs');
const RELAY_ID = 'harness-relay-0001';
const NETWORK = 'testnet-12';

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const cmdBrief = (c) => {
  if (!c) return '(none)';
  const { envelope, __origin, type, requestId, ...rest } = c;
  return `type=${type} origin=${__origin || '(缺失)'} ${envelope ? 'env✓' : 'env✗'} ${JSON.stringify(rest).slice(0, 80)}`;
};

async function main() {
  for (const f of [DB, DB + '-wal', DB + '-shm']) if (existsSync(f)) rmSync(f);
  mkdirSync(LOG_DIR, { recursive: true });

  const origAuthz = readFileSync(AUTHZ, 'utf8');
  const origSha = sha(origAuthz);

  // 🔴 信号处理: SIGTERM/SIGINT(timeout 杀/Ctrl-C)必复位 flag, 否则 finally 不跑=flag 留 true 污染。
  const restoreOnSignal = (sig) => {
    try {
      const cur = readFileSync(AUTHZ, 'utf8');
      if (cur.includes('const GRANT_ENVELOPE_IMPLEMENTED = true;')) {
        writeFileSync(AUTHZ, cur.replace('const GRANT_ENVELOPE_IMPLEMENTED = true;', 'const GRANT_ENVELOPE_IMPLEMENTED = false;'));
      }
    } catch {}
    console.error(`\n[harness] 收到 ${sig}, 已复位 flag, 退出`);
    process.exit(130);
  };
  process.on('SIGTERM', () => restoreOnSignal('SIGTERM'));
  process.on('SIGINT', () => restoreOnSignal('SIGINT'));
  const evidence = [];
  let pass = 0, fail = 0;
  const results = [];

  // ── flip flag(NWT 判据: armed=on 实开非 mock; sha256 记录跑的就是要装的)──
  const flipped = origAuthz.replace(
    'const GRANT_ENVELOPE_IMPLEMENTED = false;',
    'const GRANT_ENVELOPE_IMPLEMENTED = true;');
  if (flipped === origAuthz) throw new Error('flip 未命中 GRANT_ENVELOPE_IMPLEMENTED 行');
  const flippedSha = sha(flipped);
  writeFileSync(AUTHZ, flipped);

  let relay;
  try {
    // ── provision(真脚本·组件③实战): gen-key + issue ──
    const gen = execFileSync('node', [PROVISION, 'gen-key'], { encoding: 'utf8' });
    const appPriv = gen.match(/私钥[\s\S]*?\n\s+([0-9a-f]{64})/)[1];
    const appPub = gen.match(/公钥[\s\S]*?\n\s+([0-9a-f]{64})/)[1];
    const { PAYEE_ADDR, ALL_PERSONAS } = await import(pathToFileURL(path.join(ROOT, 'kasia-console/test-framework/personas/app_clients.mjs')).href);
    const issue = execFileSync('node', [PROVISION, 'issue',
      '--app-key-id', 'harness-app', '--app-pubkey', appPub,
      '--commands', 'transfer,send_message', '--relay', RELAY_ID, '--network', NETWORK,
      '--payee', PAYEE_ADDR, '--max-amount-kas', '3', '--valid-days', '7', '--db', DB], { encoding: 'utf8' });
    const grantId = issue.match(/grant_id=([0-9a-f-]{36})/)[1];

    const relayGen = execFileSync('node', [PROVISION, 'gen-key'], { encoding: 'utf8' });
    const relayPriv = relayGen.match(/私钥[\s\S]*?\n\s+([0-9a-f]{64})/)[1];

    // ── SDK + driver ──
    const sdk = await import(pathToFileURL(path.join(ROOT, 'kasia-console/test-framework/lib/app-envelope-sdk.mjs')).href);
    const { startArmedRelay } = await import(pathToFileURL(path.join(ROOT, 'kasia-console/test-framework/lib/relay-gate-driver.mjs')).href);

    relay = await startArmedRelay({ relayId: RELAY_ID, network: NETWORK, privkeyHex: relayPriv, grantDbPath: DB, armed: true });
    // NWT 判据 1: 模块加载没 throw(armed=on+flag=true→arm 前提满足, 不 throw)+ready = gate 实加载。
    evidence.push({ persona: '(bootstrap)', label: 'armed relay 起(模块未 throw=flag=true arm 前提满足)', ok: true, flippedSha });

    const base = { appKeyId: 'harness-app', grantId, relayId: RELAY_ID, network: NETWORK, privkeyHex: appPriv };

    for (const persona of ALL_PERSONAS) {
      const flow = persona.buildFlow({ sdk, base });
      for (const step of flow) {
        if (step.revoke) {
          execFileSync('node', [PROVISION, 'revoke', '--grant-id', grantId, '--db', DB], { encoding: 'utf8' });
          evidence.push({ persona: persona.id, label: step.label, action: 'operator revoke grant', ok: true });
          continue;
        }
        const cmd = step.build();
        let res, err = null;
        try { res = await relay.send(cmd, step.timeoutMs || 15000); }
        catch (e) { err = e.message; }

        const denied = res && res.denied === true;
        const gateDecision = denied ? 'deny' : (err ? 'timeout/err' : 'allow(进 switch)');
        let stepOk;
        if (step.expect === 'allow') {
          if (step.allowExec) {
            // NWT (a): allow 条必须进 switch(执行层错误=RpcClient not ready/No UTXO), 非只"不是 deny"。
            stepOk = res && res.denied !== true && /RpcClient not ready|No UTXO|not synced|not ready/.test(res.error || '');
          } else {
            stepOk = res && res.denied !== true && err === null; // readonly 快速返回
          }
        } else { // deny
          stepOk = denied && (!step.denyMatch || step.denyMatch.test(res.error || ''));
        }
        if (stepOk) pass++; else fail++;
        evidence.push({
          persona: persona.id, label: step.label, sent: cmdBrief(cmd),
          expect: step.expect, gateDecision,
          reason_or_error: (res && res.error) || err || (res && res.ok ? 'ok' : JSON.stringify(res)),
          ok: stepOk,
        });
        results.push(`  ${stepOk ? 'PASS' : 'FAIL'} [${persona.id}] ${step.label}`);
      }
    }
  } finally {
    if (relay) relay.stop();
    writeFileSync(AUTHZ, origAuthz);   // 复位 flag(NWT: 跑完 flag 复位 false + armed=off 不留污染)
  }

  const restoredSha = sha(readFileSync(AUTHZ, 'utf8'));
  const flipClean = restoredSha === origSha;

  // ── evidence log 落盘(Owner 'no log no pass' 纪律)──
  const logPath = path.join(LOG_DIR, 'm0c1-gate-harness-latest.json');
  writeFileSync(logPath, JSON.stringify({
    ran_at_note: 'timestamp omitted (harness-safe)',
    flip: { orig_sha256: origSha, flipped_sha256: flippedSha, restored_sha256: restoredSha, clean: flipClean },
    summary: { pass, fail },
    evidence,
  }, null, 2));

  console.log(results.join('\n'));
  console.log(`\nflip sha256: orig=${origSha.slice(0, 12)} flipped=${flippedSha.slice(0, 12)} restored=${restoredSha.slice(0, 12)} clean=${flipClean}`);
  console.log(`evidence log: ${logPath}`);
  console.log(`\n== M0c-1 gate harness: PASS ${pass} / FAIL ${fail} / flip-clean=${flipClean} ==`);
  process.exit(fail === 0 && flipClean ? 0 : 1);
}

main().catch((e) => {
  // 异常也要复位 flag(防污染)
  try {
    const cur = readFileSync(AUTHZ, 'utf8');
    if (cur.includes('const GRANT_ENVELOPE_IMPLEMENTED = true;')) {
      writeFileSync(AUTHZ, cur.replace('const GRANT_ENVELOPE_IMPLEMENTED = true;', 'const GRANT_ENVELOPE_IMPLEMENTED = false;'));
    }
  } catch {}
  console.error('harness 异常(已尝试复位 flag):', e.stack || e.message);
  process.exit(1);
});
