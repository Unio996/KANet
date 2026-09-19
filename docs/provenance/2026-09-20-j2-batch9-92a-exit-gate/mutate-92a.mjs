// 批9 9-2a 出口分闸——变异对照(单文件测试逐个跑)。每个变异: 备份 → 改 → 跑 proto-relay-ipc.test.mjs → 必须红 → 还原并校验字节相同。
// 用法(从仓库根): node docs/provenance/2026-09-20-j2-batch9-92a-exit-gate/mutate-92a.mjs > mutation-raw.txt
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FILE = path.join(ROOT, 'kasia-console/src/lib/proto-relay-ipc.mjs');
const runT = () => {
  const r = spawnSync(process.execPath, ['src/lib/proto-relay-ipc.test.mjs'], { cwd: path.join(ROOT, 'kasia-console'), encoding: 'utf8', timeout: 300000, maxBuffer: 1 << 26 });
  const out = (r.stdout || '') + (r.stderr || '');
  return { status: r.status, fails: (out.match(/^\[FAIL\]/gm) || []).length, last: (out.match(/\d+ passed, \d+ failed/) || ['?'])[0] };
};
const sub = (find, repl, all = false) => (s) => {
  const n = s.split(find).length - 1;
  if (n < 1 || (!all && n !== 1)) throw new Error(`锚点命中 ${n} 次: ${find.slice(0, 50)}`);
  return all ? s.split(find).join(repl) : s.replace(find, () => repl);
};
const M = [];
const mut = (id, f, why) => M.push([id, f, why]);
mut('X1', sub("if (typeof key === 'string' && key.startsWith('settle:')) {", 'if (false) {'), '判据只读旧开关(settle: 分支整体失效)');
mut('X2', sub("process.env.PROTO_SETTLEMENT_DRIVER_ENABLED !== '1') {\n        throw new Error(`sendProtoCommand: proto_settlement_driver_disabled", "process.env.PROTO_DRIVER_ENABLED !== '1') {\n        throw new Error(`sendProtoCommand: proto_settlement_driver_disabled"), 'A 类读了旧开关(两个 env 名互换)');
mut('X3', sub("} else if (process.env.PROTO_DRIVER_ENABLED !== '1') {", "} else if (process.env.PROTO_SETTLEMENT_DRIVER_ENABLED !== '1') {"), 'C 类读了结算开关(两个 env 名互换)');
mut('X4', sub("key.startsWith('settle:')", "key.includes('settle')"), 'startsWith 改 includes');
mut('X5', sub("key.startsWith('settle:')", "key.toLowerCase().startsWith('settle:')"), '前缀忽略大小写');
mut('X6', sub('const key = out.intent_key;', 'const key = payload.intent_key;'), '拆掉快照(闸另读一次 payload.intent_key)');
mut('X7', sub("return _sendCommandAsyncForTest(PROTO_RELAY_ID, out, timeoutMs, 'internal');", "return _sendCommandAsyncForTest(PROTO_RELAY_ID, { ...payload, type }, timeoutMs, 'internal');"), '发送另做一份展开(闸与发送不同快照)');
mut('X8', sub('if (!isValidSettlementIntentKey(key)) {', 'if (false) {'), '去掉 S9 严格校验');
mut('X9', sub('if (!isValidSettlementIntentKey(key)) {', "if (!isValidSettlementIntentKey(key) && process.env.PROTO_DRIVER_ENABLED !== '1') {"), 'B 类在 PDE=1 时回落放行');
mut('X10', sub("process.env.PROTO_SETTLEMENT_DRIVER_ENABLED !== '1') {\n        throw new Error(`sendProtoCommand: proto_settlement_driver_disabled", "process.env.PROTO_SETTLEMENT_DRIVER_ENABLED !== '1' || process.env.PROTO_DRIVER_ENABLED !== '1') {\n        throw new Error(`sendProtoCommand: proto_settlement_driver_disabled"), 'A 类也要求 PDE(AND)');
mut('X11', sub("if (mode === 'write') {\n    const key", "if (true) {\n    const key"), 'read 命令也被闸');
mut('X12', sub('sendProtoCommand: proto_settlement_driver_disabled', 'sendProtoCommand: proto_driver_disabled'), 'A 类拒绝串换成旧串');
mut('X13', sub('return !!m && PROTO_SETTLEMENT_EXIT_STEP_SUBJECT[m[3]] === m[1];', 'return !!m;'), '去掉 step/subject 配对');
mut('X14', (s) => sub('(seal|resolve|convert_to_claim|claim_draw)(?:#', '(seal|resolve|convert_to_claim|claim_draw|withdraw)(?:#')(sub("claim_draw: 'claim' });", "claim_draw: 'claim', withdraw: 'claim' });")(s)), '放行 withdraw(正则 + 配对表)');
mut('X15', sub('([2-9]|[1-9][0-9]+)', '([1-9][0-9]*)'), '#1 放行');
mut('X16', sub('([2-9]|[1-9][0-9]+)', '([0-9]+)'), '#0 / #01 放行(前导零)');
mut('X17', sub('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'), '大写 UUID 放行');
mut('X18', sub("if (key !== undefined && typeof key !== 'string') {", 'if (false) {'), '去掉 S9-b');
mut('X19', sub("if (key !== undefined && typeof key !== 'string') {", "if (typeof key !== 'string') {"), 'S9-b 把缺失(undefined)也拒');
mut('X20', sub("claim_draw)(?:#([2-9]|[1-9][0-9]+))?$/;", "claim_draw)(?:#([2-9]|[1-9][0-9]+))?$/m;"), '正则加 m 标志(尾随换行放行)');

console.log('BASELINE'); const base = runT(); console.log(`  exit=${base.status} ${base.last}`);
if (base.status !== 0) { console.log('BASELINE 不绿, 中止'); process.exit(2); }
let survivors = 0;
for (const [id, f, why] of M) {
  const orig = fs.readFileSync(FILE, 'utf8');
  let mutated; try { mutated = f(orig); } catch (e) { console.log(`${id}: 变换失败(${e.message}) — 视为未执行 :: ${why}`); survivors++; continue; }
  if (mutated === orig) { console.log(`${id}: 变换未改变文件 :: ${why}`); survivors++; continue; }
  try {
    fs.writeFileSync(FILE, mutated);
    const r = runT(); const red = r.status !== 0; if (!red) survivors++;
    console.log(`${id}: ${red ? 'KILLED' : 'SURVIVED'} exit=${r.status} fail=${r.fails} :: ${why}`);
  } finally { fs.writeFileSync(FILE, orig); if (fs.readFileSync(FILE, 'utf8') !== orig) throw new Error('还原失败'); }
}
const after = runT(); console.log(`RESTORED exit=${after.status} ${after.last}`);
console.log(`SUMMARY mutants=${M.length} survivors=${survivors} restored_green=${after.status === 0}`);
process.exitCode = survivors || after.status !== 0 ? 1 : 0;
