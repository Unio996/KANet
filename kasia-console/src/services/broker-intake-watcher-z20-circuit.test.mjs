// broker-intake-watcher-z20-circuit.test.mjs — Z20 熔断闸回归(2026-07-14, Bettor #k6qj5a 第五源续:
// Z20 sweep 对结构性无法退款的 offer 每 5min 重试一轮, 串行 relay IPC 默认 30s timeout × N 个卡住的
// offer ≈ 观测到的 250-260s 冻结签名, handled=0/10 现场实证)。纯函数单测, 不碰真 DB 业务表, 但
// recordZ20Failure 熔断触发时会写 events 审计行——必须走隔离临时库(同 pregate.test.mjs 自举模式),
// 首版忘了这层隔离, 误写过一条 fake 记录进真 console.db(已清), 这版补上自举, 不再犯。
// 2026-07-14 续(Bettor 语义裁定 #k7xxxx): 补 listZ20CircuitBroken()/clearZ20Circuit() 覆盖——
// "熔断=停调度重试≠放弃这笔钱"这条语义边界靠这两个函数落地(挂账清单可查 + 人工可复位)。
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
const { z20CircuitGate, recordZ20Failure, listZ20CircuitBroken, clearZ20Circuit } = await import('./broker-intake-watcher.js');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

console.log('[test] Z20 熔断闸(z20CircuitGate/recordZ20Failure), 隔离临时库:');
{
  const offerA = 'offer-a-' + Math.random().toString(36).slice(2, 8);
  ok(z20CircuitGate(offerA) === false, '未记录任何失败 → 不 gate(基线)');

  const r1 = recordZ20Failure(offerA, 'no retail_dex_orders link');
  ok(r1 === false, 'recordZ20Failure 返回值: 第1次失败(未跨阈值) → false');
  ok(z20CircuitGate(offerA) === false, '第1次失败 → 未达阈值(默认3), 不 gate');

  const r2 = recordZ20Failure(offerA, 'no retail_dex_orders link');
  ok(r2 === false, 'recordZ20Failure 返回值: 第2次失败(未跨阈值) → false');
  ok(z20CircuitGate(offerA) === false, '第2次同签名失败 → 仍未达阈值, 不 gate');

  const r3 = recordZ20Failure(offerA, 'no retail_dex_orders link');
  ok(r3 === true, 'recordZ20Failure 返回值: 第3次失败(刚跨阈值) → true(调用方用这个信号批量喊一条告警, 不 per-offer 刷屏)');
  ok(z20CircuitGate(offerA) === true, '第3次同签名失败(达阈值) → 熔断');

  const ev = sqlite.prepare(`SELECT COUNT(*) c FROM events WHERE event_type='z20_refund_circuit_broken' AND payload_json LIKE ?`).get(`%${offerA}%`).c;
  ok(ev === 1, `熔断触发写一条审计事件(计数=${ev}, 隔离库内验证, 不碰真库)`);

  const offerB = 'offer-b-' + Math.random().toString(36).slice(2, 8);
  recordZ20Failure(offerB, 'advanceToRefunded FAIL: relay not on this node');
  recordZ20Failure(offerB, 'race_lost');   // 换了不同签名
  ok(z20CircuitGate(offerB) === false, '换了不同失败签名 → streak 重置, 不误触发熔断(不跨签名累加噪音)');

  const offerC = 'offer-c-' + Math.random().toString(36).slice(2, 8);
  ok(z20CircuitGate(offerC) === false, '完全没记录过的独立 offer_id → 不受其他 offer 熔断状态影响(per-offer keyed)');

  // 2026-07-14 (Bettor 语义裁定 #k7xxxx): 挂账清单 listZ20CircuitBroken() + 人工复位 clearZ20Circuit()
  const listed = listZ20CircuitBroken();
  ok(Array.isArray(listed), 'listZ20CircuitBroken() 返回数组');
  const entryA = listed.find((x) => x.offerId === offerA);
  ok(!!entryA, `熔断的 offerA 出现在挂账清单里(count=${listed.length})`);
  ok(entryA?.sig === 'no retail_dex_orders link' && entryA?.streak === 3, `挂账清单条目携带 sig/streak(sig=${entryA?.sig}, streak=${entryA?.streak})`);
  ok(typeof entryA?.brokenAt === 'string' && entryA.brokenAt.length > 0, `挂账清单条目携带 brokenAt 时间戳(${entryA?.brokenAt})`);
  ok(entryA && entryA.giveAmount === null, 'offerA 在 exchange_offers 里不存在(测试构造 id) → enrich 字段优雅降级为 null, 不报错');
  const listedB = listed.find((x) => x.offerId === offerB);
  ok(!listedB, 'offerB 未达阈值(streak 被重置) → 不出现在挂账清单里');

  const clearNoop = clearZ20Circuit(offerC, '未熔断, 幂等测试');
  ok(clearNoop.ok === false && clearNoop.already === true, 'clearZ20Circuit 对未熔断 offer 幂等 no-op, 不误清');

  const clearReal = clearZ20Circuit(offerA, '测试: 确认已处置');
  ok(clearReal.ok === true, `clearZ20Circuit 对已熔断 offerA 成功复位`);
  ok(z20CircuitGate(offerA) === false, 'clearZ20Circuit 后 z20CircuitGate 立即恢复 false(下一轮 tick 会重试)');
  ok(!listZ20CircuitBroken().find((x) => x.offerId === offerA), 'clearZ20Circuit 后 offerA 从挂账清单里消失');
  const evCleared = sqlite.prepare(`SELECT COUNT(*) c FROM events WHERE event_type='z20_refund_circuit_cleared' AND payload_json LIKE ?`).get(`%${offerA}%`).c;
  ok(evCleared === 1, `复位也写一条审计事件(计数=${evCleared})`);
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — Z20 熔断闸: 阈值判定/同签名累加/异签名重置/per-offer隔离/审计行 全对(隔离库验证零污染真库)'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
