// 握手开关笔二——变异对照(单文件测试逐个跑, 每个变异只跑与之相关的测试文件; 提交内存 80% 限制期间不跑大批量)。
// 每个变异: 备份 → 改一处 → 跑相关测试 → 必须【红】(至少一个测试文件退出码非 0)→ 无论如何还原并校验字节相同。
// 用法(从仓库根): node docs/provenance/2026-09-20-j2-handshake-switch/mutate-switch.mjs > mutation-raw.txt
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const P = (rel) => path.join(ROOT, rel);
const SW = 'kasia-relay/src/lib/handshake-switch.mjs';
const CH = 'kasia-relay/src/chain.mjs';
const HA = 'kasia-relay/src/lib/handshake-accept.mjs';
const RL = 'kasia-relay/src/rpc-listener.mjs';
const RM = 'kasia-relay/src/relay.mjs';
const IS = 'kasia-console/src/services/ingest-service.js';

const T = {
  sw: { cwd: 'kasia-relay', file: 'src/lib/handshake-switch.test.mjs' },
  scan: { cwd: 'kasia-relay', file: 'src/lib/handshake-switch-scan.test.mjs' },
  acc: { cwd: 'kasia-relay', file: 'src/lib/handshake-accept.test.mjs' },
  gate: { cwd: 'kasia-relay', file: 'src/rpc-handshake-gate.test.mjs' },
  choke: { cwd: 'kasia-relay', file: 'src/handshake-chokepoint.test.mjs' },
  pend: { cwd: 'kasia-console', file: 'src/services/ingest-handshake-pending.test.mjs' },
};
const runT = (k) => {
  const r = spawnSync(process.execPath, [T[k].file], { cwd: P(T[k].cwd), encoding: 'utf8', timeout: 300000, maxBuffer: 1 << 26 });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^\s*(\[FAIL\]|❌)/gm) || []).length;
  return { status: r.status, fails };
};

// 变异: [id, 文件, 变换(字符串 ⇒ 字符串), 相关测试, 说明]
const M = [];
const sub = (find, repl) => (s) => { const n = s.split(find).length - 1; if (n !== 1) throw new Error(`锚点命中 ${n} 次: ${find.slice(0, 50)}`); return s.replace(find, () => repl); };
const mut = (id, file, f, tests, why) => M.push([id, file, f, tests, why]);

// handshake-switch.mjs
mut('S1', SW, sub("return env.RELAY_HANDSHAKE_AUTO_ACCEPT === '1';", "return ['1', 'on', 'true'].includes(env.RELAY_HANDSHAKE_AUTO_ACCEPT);"), ['sw'], '开关变宽松(on / true 也开)');
mut('S2', SW, sub("return env.RELAY_HANDSHAKE_AUTO_ACCEPT === '1';", "return env.RELAY_HANDSHAKE_AUTO_ACCEPT !== '1';"), ['sw', 'acc'], '开关写反');
mut('S3', SW, sub("export function handshakeAutoAcceptEnabled(env = process.env) {\n  return env.RELAY_HANDSHAKE_AUTO_ACCEPT === '1';\n}", "const _cached = process.env.RELAY_HANDSHAKE_AUTO_ACCEPT === '1';\nexport function handshakeAutoAcceptEnabled(env = process.env) {\n  return _cached;\n}"), ['sw'], '缓存成模块常量(不再每次调用读)');
mut('S4', SW, sub("raw=${v === undefined ? '<unset>' : JSON.stringify(v)}", "raw=${v}"), ['sw'], '启动行 raw 不再 JSON 化');
mut('S5', SW, sub('if (seen.size >= cap) {', 'if (seen.size > cap) {'), ['sw', 'acc'], '去重器上限差一');
mut('S6', SW, sub('if (seen.has(key)) return;\n', ''), ['sw', 'acc'], '去重器不去重');
mut('S7', SW, sub("if (!capped) { capped = true; log('suppressing further disabled-peer logs'); }", "log('suppressing further disabled-peer logs');"), ['sw', 'acc'], '抑制提示每次都打');
// chain.mjs
mut('K1', CH, sub("if (!handshakeAutoAcceptEnabled()) {\n    const peer = String(params?.address", "if (false) {\n    const peer = String(params?.address"), ['choke', 'scan'], '去掉 chokepoint');
mut('K2', CH, sub("    return null;\n  }\n  const wallet = getWallet();", "    return undefined;\n  }\n  const wallet = getWallet();"), ['choke', 'scan'], 'chokepoint 返回 undefined 而非 null');
mut('K3', CH, sub("const logChokepointOnce = createOncePerKeyLogger((...a) => console.log(new Date().toISOString(), '[chain]', ...a));", "const logChokepointOnce = (key, text) => console.log(new Date().toISOString(), '[chain]', text);"), ['choke'], 'chokepoint 日志不去重');
mut('K4', CH, sub("split('\\n')[3] || '';", "split('\\n')[2] || '';"), ['choke'], '调用者标识取错栈帧');
mut('K5', CH, sub("const peer = String(params?.address ?? '<no-address>');", "const peer = String(params.address);"), ['choke'], '缺参数时抛错(不容错)');
// handshake-accept.mjs
mut('A1', HA, sub('if (!handshakeAutoAcceptEnabled()) {\n      logDisabledOnce', 'if (false) {\n      logDisabledOnce'), ['acc', 'scan'], '落点 4 守卫删掉');
mut('A2', HA, sub('if (!handshakeAutoAcceptEnabled()) {\n      logDisabledOnce', 'if (handshakeAutoAcceptEnabled()) {\n      logDisabledOnce'), ['acc'], '落点 4 守卫写反');
mut('A3', HA, sub('logDisabledOnce(peer, `HANDSHAKE', 'log(`HANDSHAKE'), ['acc'], '落点 4 日志不去重(每 tick 一行)');
mut('A4', HA, sub("left pending for ${peer.slice(-12)}`);\n      return;\n    }", "left pending for ${peer.slice(-12)}`);\n    }"), ['acc'], '落点 4 守卫打了日志但不 return');
// rpc-listener.mjs
const RL_GUARD = "    if (!handshakeAutoAcceptEnabled()) {\n      log('HANDSHAKE auto-accept disabled — left pending for', senderAddress.slice(-12));\n      return;\n    }\n";
mut('R1', RL, sub(RL_GUARD, ''), ['gate', 'scan'], '落点 2 守卫删掉');
mut('R2', RL, (s) => { const x = sub(RL_GUARD, '')(s); return sub("    // Record the inbound handshake TX (observation only — no status advancement)\n", RL_GUARD + "    // Record the inbound handshake TX (observation only — no status advancement)\n")(x); }, ['gate', 'scan'], '落点 2 守卫挪到 step 4 之前(登记也没了)');
mut('R3', RL, sub("    if (!handshakeAutoAcceptEnabled()) {\n      log('HANDSHAKE auto-accept disabled", "    if (handshakeAutoAcceptEnabled()) {\n      log('HANDSHAKE auto-accept disabled"), ['gate'], '落点 2 守卫写反');
mut('R4', RL, sub("left pending for', senderAddress.slice(-12));\n      return;\n    }", "left pending for', senderAddress.slice(-12));\n    }"), ['gate'], '落点 2 守卫打了日志但不 return');
mut('R5', RL, sub("if (!handshakeAutoAcceptEnabled()) {\n    handshakesDisabled = true;", "if (false) {\n    handshakesDisabled = true;"), ['gate', 'scan'], '落点 3 守卫删掉');
mut('R6', RL, sub("${handshakesDisabled ? 'handshakes: DISABLED' : `${handshakeCount} handshakes accepted`}", '${handshakeCount} handshakes accepted'), ['gate'], '汇总行不写 DISABLED(打 0)');
mut('R7', RL, sub("  } else try {\n    const hsParams", "  }\n  try {\n    const hsParams"), ['gate'], '落点 3 只打日志、pending 查询与 claim 照跑');
mut('R8', RL, sub("    handshakesDisabled = true;\n", ''), ['gate'], '汇总行标志位不置(关闭态汇总行仍打 0)');
// relay.mjs
mut('M1', RM, sub('log(handshakeStartupLine(process.env, RELAY_MODE));\n', ''), ['scan'], '启动行删掉');
// console(V2b)
mut('C1', IS, sub('if (already) {\n            console.log(`[ingest] skip handshake_accept enqueue', 'if (false) {\n            console.log(`[ingest] skip handshake_accept enqueue'), ['pend'], 'console: 已 active 也入队');
mut('C2', IS, sub('} else if (!existing) {', '} else if (false) {'), ['pend'], 'console: 首次不入队');
mut('C3', IS, sub("existing && (existing.status === 'failed' || existing.status === 'expired')", "existing && existing.status === 'failed'"), ['pend'], 'console: expired 不重置');
mut('C4', IS, sub("} else if (!existing) {", "} else {"), ['pend'], 'console: 已有 pending 也再插一行(幂等键冲突/重复入队)');

// ── 基线 ────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log('BASELINE');
let baseOk = true;
for (const k of Object.keys(T)) { const r = runT(k); console.log(`  ${k}: exit=${r.status} fails=${r.fails}`); if (r.status !== 0) baseOk = false; }
if (!baseOk) { console.log('BASELINE 不绿, 中止'); process.exit(2); }

let survivors = 0;
for (const [id, file, f, tests, why] of M) {
  const abs = P(file);
  const orig = fs.readFileSync(abs, 'utf8');
  let mutated;
  try { mutated = f(orig); } catch (e) { console.log(`${id}: 变换失败(${e.message}) — 视为未执行 :: ${why}`); survivors++; continue; }
  if (mutated === orig) { console.log(`${id}: 变换未改变文件 — 视为未执行 :: ${why}`); survivors++; continue; }
  try {
    fs.writeFileSync(abs, mutated);
    const res = tests.map((k) => ({ k, ...runT(k) }));
    const red = res.some((r) => r.status !== 0);
    if (!red) survivors++;
    console.log(`${id}: ${red ? 'KILLED' : 'SURVIVED'} [${res.map((r) => `${r.k}:exit=${r.status}/fail=${r.fails}`).join(' ')}] :: ${why}`);
  } finally {
    fs.writeFileSync(abs, orig);
    if (fs.readFileSync(abs, 'utf8') !== orig) throw new Error('还原失败 ' + file);
  }
}
console.log('RESTORED BASELINE');
let after = true;
for (const k of Object.keys(T)) { const r = runT(k); console.log(`  ${k}: exit=${r.status} fails=${r.fails}`); if (r.status !== 0) after = false; }
console.log(`SUMMARY mutants=${M.length} survivors=${survivors} restored_baseline_green=${after}`);
process.exitCode = survivors || !after ? 1 : 0;
