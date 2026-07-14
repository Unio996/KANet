// broker-intake-watcher-z20-circuit.test.mjs — Z20 熔断闸回归(2026-07-14, Bettor #k6qj5a 第五源续:
// Z20 sweep 对结构性无法退款的 offer 每 5min 重试一轮, 串行 relay IPC 默认 30s timeout × N 个卡住的
// offer ≈ 观测到的 250-260s 冻结签名, handled=0/10 现场实证)。纯函数单测, 不碰真 DB 业务表, 但
// recordZ20Failure 熔断触发时会写 events 审计行——必须走隔离临时库(同 pregate.test.mjs 自举模式),
// 首版忘了这层隔离, 误写过一条 fake 记录进真 console.db(已清), 这版补上自举, 不再犯。
// Run: cd kasia-console && node src/services/broker-intake-watcher-z20-circuit.test.mjs
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._Z20_CIRCUIT_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_z20circuit_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: {
      ...process.env, DB_PATH: tmpDb, _Z20_CIRCUIT_TEST_BOOTSTRAPPED: '1',
      BROKER_RELAY_ID: process.env.BROKER_RELAY_ID || '15593e10-fe63-4806-a7b5-cae062699de8',
      KASPA_RPC_URL: process.env.KASPA_RPC_URL || 'ws://127.0.0.1:17210',
      KASPA_NETWORK: process.env.KASPA_NETWORK || 'testnet-12',
    },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const { z20CircuitGate, recordZ20Failure } = await import('./broker-intake-watcher.js');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

console.log('[test] Z20 熔断闸(z20CircuitGate/recordZ20Failure), 隔离临时库:');
{
  const offerA = 'offer-a-' + Math.random().toString(36).slice(2, 8);
  ok(z20CircuitGate(offerA) === false, '未记录任何失败 → 不 gate(基线)');

  recordZ20Failure(offerA, 'no retail_dex_orders link');
  ok(z20CircuitGate(offerA) === false, '第1次失败 → 未达阈值(默认3), 不 gate');

  recordZ20Failure(offerA, 'no retail_dex_orders link');
  ok(z20CircuitGate(offerA) === false, '第2次同签名失败 → 仍未达阈值, 不 gate');

  recordZ20Failure(offerA, 'no retail_dex_orders link');
  ok(z20CircuitGate(offerA) === true, '第3次同签名失败(达阈值) → 熔断');

  const ev = sqlite.prepare(`SELECT COUNT(*) c FROM events WHERE event_type='z20_refund_circuit_broken' AND payload_json LIKE ?`).get(`%${offerA}%`).c;
  ok(ev === 1, `熔断触发写一条审计事件(计数=${ev}, 隔离库内验证, 不碰真库)`);

  const offerB = 'offer-b-' + Math.random().toString(36).slice(2, 8);
  recordZ20Failure(offerB, 'advanceToRefunded FAIL: relay not on this node');
  recordZ20Failure(offerB, 'race_lost');   // 换了不同签名
  ok(z20CircuitGate(offerB) === false, '换了不同失败签名 → streak 重置, 不误触发熔断(不跨签名累加噪音)');

  const offerC = 'offer-c-' + Math.random().toString(36).slice(2, 8);
  ok(z20CircuitGate(offerC) === false, '完全没记录过的独立 offer_id → 不受其他 offer 熔断状态影响(per-offer keyed)');
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — Z20 熔断闸: 阈值判定/同签名累加/异签名重置/per-offer隔离/审计行 全对(隔离库验证零污染真库)'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
