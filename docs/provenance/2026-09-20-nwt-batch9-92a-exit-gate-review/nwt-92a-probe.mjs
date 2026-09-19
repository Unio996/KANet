// NWT 批9 9-2a 审: 对 9d9433cd 的真实 proto-relay-ipc.mjs 做探针(真导出函数, 注入桩替换真发送; 不连 relay、不碰钱包)
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const CON = 'D:/kanet-nwt-cand/kasia-console';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nwt-92a-'));
process.env.PROTO_RELAY_ID = 'nwt-probe-relay-id';   // 出口在模块加载时读它; 只用于桩发送, 不连任何 relay
process.env.DB_PATH = path.join(tmp, 'x.db'); process.env.CONSOLE_ENCRYPTION_KEY = '0'.repeat(64);
const ipc = await import(pathToFileURL(CON + '/src/lib/proto-relay-ipc.mjs').href);
const { settlementIntentKeyFor } = await import(pathToFileURL(CON + '/src/lib/proto-settlement-intent.mjs').href);
const out = [];
const sent = [];
const stub = async (relayId, cmd) => { sent.push(cmd); return { ok: true }; };
async function run(payload, env) {
  const saved = { a: process.env.PROTO_DRIVER_ENABLED, b: process.env.PROTO_SETTLEMENT_DRIVER_ENABLED };
  if (env.pde === undefined) delete process.env.PROTO_DRIVER_ENABLED; else process.env.PROTO_DRIVER_ENABLED = env.pde;
  if (env.psde === undefined) delete process.env.PROTO_SETTLEMENT_DRIVER_ENABLED; else process.env.PROTO_SETTLEMENT_DRIVER_ENABLED = env.psde;
  sent.length = 0;
  try { await ipc.sendProtoCommand('covenant_broadcast', payload, { _sendCommandAsyncForTest: stub }); return { ok: true, sent: sent.length }; }
  catch (e) { return { ok: false, err: (String(e.message).match(/proto_[a-z_]+/) || [String(e.message).slice(0,90)])[0] }; }
  finally { if (saved.a === undefined) delete process.env.PROTO_DRIVER_ENABLED; else process.env.PROTO_DRIVER_ENABLED = saved.a; if (saved.b === undefined) delete process.env.PROTO_SETTLEMENT_DRIVER_ENABLED; else process.env.PROTO_SETTLEMENT_DRIVER_ENABLED = saved.b; }
}
// 1) 真实生成式的 id -> 真实生产者 -> 出口的校验函数 / 出口本身(PSDE=1)
const marketId = crypto.randomBytes(32).toString('hex');     // api/proto.js:128 同式 = 现存 3 个市场的形状
const uuid = crypto.randomUUID();
for (const [t, id, step] of [['market', marketId, 'seal'], ['market', marketId, 'resolve'], ['claim', marketId, 'convert_to_claim'], ['claim', marketId, 'claim_draw']]) {
  const k = settlementIntentKeyFor(t, id, step);
  const r = await run({ intent_key: k }, { psde: '1', pde: undefined });
  out.push(`REAL-ID producer key ${t}/64-hex/${step}: isValidSettlementIntentKey=${ipc.isValidSettlementIntentKey(k)}  exit(PSDE=1)=${r.ok ? 'PASS' : 'REJECT ' + r.err}`);
}
const ku = settlementIntentKeyFor('market', uuid, 'seal');
out.push(`uuid-id control  market/uuid/seal: isValid=${ipc.isValidSettlementIntentKey(ku)}  exit(PSDE=1)=${(await run({ intent_key: ku }, { psde: '1' })).ok ? 'PASS' : 'REJECT'}`);
// 2) 矩阵(用 UUID 形状的 A 类键, 这样矩阵本身能被测): 3 类 x 4 格
const A = settlementIntentKeyFor('market', marketId, 'seal'), B = 'settle:market:' + uuid.toUpperCase() + ':seal', C = 'genesis:' + marketId;
const cell = async (p, pde, psde) => { const r = await run(p, { pde, psde }); return r.ok ? 'pass' : r.err.replace('proto_', '').replace('_disabled', '_dis'); };
for (const [name, p] of [['A settle(valid,uuid)', { intent_key: A }], ['B settle(invalid)', { intent_key: B }], ['C genesis:', { intent_key: C }], ['C absent', {}]]) {
  out.push(`MATRIX ${name.padEnd(22)} PDE0/PSDE0=${await cell(p, undefined, undefined)}  PDE1/PSDE0=${await cell(p, '1', undefined)}  PDE0/PSDE1=${await cell(p, undefined, '1')}  PDE1/PSDE1=${await cell(p, '1', '1')}`);
}
// 3) S9-b 与快照
const both = { pde: '1', psde: '1' };
out.push('S9b String object       => ' + JSON.stringify(await run({ intent_key: new String(A) }, both)));
out.push('S9b object with toJSON  => ' + JSON.stringify(await run({ intent_key: { toJSON() { return A; } } }, both)));
out.push('S9b number / array / null => ' + JSON.stringify([await run({ intent_key: 5 }, both), await run({ intent_key: [A] }, both), await run({ intent_key: null }, both)].map((r) => r.ok ? 'pass' : r.err)));
const r0 = await run({ intent_key: undefined, x: 1 }, { pde: '1' });
out.push(`undefined-valued own key  => ${JSON.stringify(r0)} ; wire JSON of the sent snapshot has intent_key? ${JSON.stringify(sent[0] || {}).includes('intent_key')}`);
let reads = 0; const getter = { get intent_key() { reads++; return reads === 1 ? 'genesis:' + marketId : A; } };
const rg = await run(getter, { pde: '1', psde: undefined });
out.push(`getter changing value per read (1st=genesis, later=settle): result=${JSON.stringify(rg)}  reads=${reads}  sent intent_key prefix=${String((sent[0] || {}).intent_key).slice(0, 8)}`);
const proxy = new Proxy({}, { get(_, k) { if (k === 'intent_key') { reads++; return reads % 2 ? 'genesis:' + marketId : A; } return undefined; }, ownKeys() { return ['intent_key']; }, getOwnPropertyDescriptor(_, k) { return k === 'intent_key' ? { enumerable: true, configurable: true, value: undefined } : undefined; } });
reads = 0; const rp = await run(proxy, { pde: '1', psde: undefined });
out.push(`Proxy changing value per read: result=${JSON.stringify(rp)} sent prefix=${String((sent[0] || {}).intent_key).slice(0, 8)} (gate and wire agree? ${(rp.ok ? 'C-class passed and sent value is ' + String((sent[0] || {}).intent_key).slice(0, 7) : 'rejected')})`);
for (const rt of ['get_address_utxos', 'get_mempool_entry', 'check_utxo_landed', 'get_past_median_time']) {
  delete process.env.PROTO_DRIVER_ENABLED; delete process.env.PROTO_SETTLEMENT_DRIVER_ENABLED;
  let r; try { await ipc.sendProtoCommand(rt, { intent_key: 5 }, { _sendCommandAsyncForTest: stub }); r = 'pass'; } catch (e) { r = 'REJECT ' + String(e.message).slice(0, 60); }
  out.push(`READ ${rt} (both switches off, even with a non-string intent_key field) => ${r}`);
}
console.log(out.join('\n'));
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
process.exit(0);
