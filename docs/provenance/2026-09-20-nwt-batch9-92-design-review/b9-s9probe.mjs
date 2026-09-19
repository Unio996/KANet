// (1) fork 默认序列化: String 对象经 IPC 变成原始字符串; (2) S9 设计的严格正则对【真实生产者输出】的判定(用真实 settlementIntentKeyFor + 真实市场 id 形状)
import { fork } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nwt-b9-'));
const child = path.join(tmp, 'child.mjs');
fs.writeFileSync(child, "process.on('message', (m) => { process.send({ typeofIntentKey: typeof m.intent_key, value: m.intent_key, typeofToJson: typeof m.k2 }); process.exit(0); });");
const got = await new Promise((res) => { const c = fork(child); c.on('message', res); c.send({ intent_key: new String('settle:market:x:seal'), k2: { toJSON() { return 'settle:market:x:seal'; } } }); });
console.log('E-S9b fork default serialization: String object arrives as', JSON.stringify(got), '(typeof at the gate for a String object would be "object")');
console.log('E-S9b gate view typeof(new String(..)) =', typeof new String('settle:market:x:seal'), '; typeof object-with-toJSON =', typeof { toJSON() { return 's'; } });
// (2) 真实生产者 + 设计里的 S9 正则
const CON = 'D:/kanet-nwt-cand/kasia-console';
process.env.DB_PATH = path.join(tmp, 'x.db'); process.env.CONSOLE_ENCRYPTION_KEY = '0'.repeat(64);
const { settlementIntentKeyFor } = await import(pathToFileURL(CON + '/src/lib/proto-settlement-intent.mjs').href);
const S9 = /^settle:(market|claim):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(seal|resolve|convert_to_claim|claim_draw)(#([2-9]|[1-9][0-9]+))?$/;   // 设计 19.1 的形状(小写 UUID)
const marketId = crypto.randomBytes(32).toString('hex');        // 与 api/proto.js:128 同一生成式 = 现存 3 个市场的形状
const claimUuid = crypto.randomUUID();
const cases = [['market', marketId, 'seal'], ['market', marketId, 'resolve'], ['claim', marketId, 'convert_to_claim'], ['claim', marketId, 'claim_draw'], ['market', claimUuid, 'seal']];
for (const [t, id, step] of cases) { const k = settlementIntentKeyFor(t, id, step); console.log(`producer key for ${t}/${id.length === 64 ? '64-hex id' : 'uuid id'}/${step}: S9(design) accepts=${S9.test(k)}`); }
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* sqlite handle still open on Windows; temp dir is mine */ }
process.exit(0);
