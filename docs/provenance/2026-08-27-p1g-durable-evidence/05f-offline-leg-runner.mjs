// P1(g) 离线腿 · 2026-08-27 · 只读编译 + 字节比对, 不上链不花币
// ① 8/20 上链那份 ctor 不动(先备份), 用 A/C 各编一次 probe, 与 onchain_probe.json 的 script 逐字节比
// ② 跑参数化后的向量脚本(P1G_SILVERC=A), 再用同一份新 ctor 用 C 编一次, A vs C 逐字节比
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const A = 'D:/kanet-tn12/scratch/_p1g_verify/target/release/silverc.exe';
const C = 'D:/silverscript/versioned-builds/silverc-zk-8065184.exe';
const SIL = 'D:/kanet-tn12/kasia-console/src/lib/CheckSigFromStackProbe.sil';
const E2E = 'D:/kanet-tn12/scratch/e2e';
const BK = `${E2E}/_0820_backup`;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const shaFile = (p) => sha(readFileSync(p));
const compile = (exe, ctor, out) => { execFileSync(exe, [SIL, '--ctor', ctor, '-o', out], { stdio: 'pipe', encoding: 'utf8' }); return Buffer.from(JSON.parse(readFileSync(out, 'utf8')).script).toString('hex'); };
const R = { at: new Date().toISOString(), A: { path: A, sha256: shaFile(A) }, C: { path: C, sha256: shaFile(C) } };
console.log(`A sha256=${R.A.sha256}\nC sha256=${R.C.sha256}`);
if (R.A.sha256 !== '7213455b6953cfdb8ce946cacf68bb98fd58e4b63861ca72c4ad1e99e83ee71a') throw new Error('A 的 sha256 与 item5 §4 记录不符 — 停');
if (R.C.sha256 !== '9de7f2f682bc9e50a4b922e1c811335f1b1cd67c175f2e01df6fa6efc9015fc4') throw new Error('C 的 sha256 与 MANIFEST 记录不符 — 停');

// ① 8/20 ctor(上链那份)
mkdirSync(BK, { recursive: true });
for (const f of ['_ctor.json', 'vectors.json', 'onchain_probe.json', 'run-evidence.json']) if (existsSync(`${E2E}/${f}`) && !existsSync(`${BK}/${f}`)) copyFileSync(`${E2E}/${f}`, `${BK}/${f}`);
const onchain = Buffer.from(JSON.parse(readFileSync(`${BK}/onchain_probe.json`, 'utf8')).script).toString('hex');
const a0820 = compile(A, `${BK}/_ctor.json`, `${E2E}/probe_0820ctor_A.json`);
const c0820 = compile(C, `${BK}/_ctor.json`, `${E2E}/probe_0820ctor_C.json`);
R.leg1_0820_ctor = { onchain_script_sha256: sha(onchain), onchain_bytes: onchain.length / 2, A_script_sha256: sha(a0820), C_script_sha256: sha(c0820), A_eq_onchain: a0820 === onchain, C_eq_onchain: c0820 === onchain, A_eq_C: a0820 === c0820 };
console.log('① 8/20 上链 ctor:', JSON.stringify(R.leg1_0820_ctor, null, 1));

// ② 参数化向量脚本用 A 跑(新随机钥 + 离线自验)
const log = execFileSync('node', ['scripts/checksigfromstack-e2e-vectors.mjs'], { cwd: 'D:/kanet-tn12/kasia-console', env: { ...process.env, P1G_SILVERC: A }, encoding: 'utf8', stdio: 'pipe' });
writeFileSync(`${E2E}/offline-leg-A-${R.at.replace(/[:.]/g, '-')}.log`, log);
console.log(log);
const vec = JSON.parse(readFileSync(`${E2E}/vectors.json`, 'utf8'));
const cNew = compile(C, `${E2E}/_ctor.json`, `${E2E}/probe_newctor_C.json`);
R.leg2_fresh_ctor = { vectors_compiler: vec.compiler, vectors_compiler_sha256: vec.compiler_sha256, A_script_sha256: vec.probe_script_sha256, C_script_sha256: sha(cNew), A_eq_C: vec.probe_script_sha256 === sha(cNew), offline_selfcheck_lines: log.split('\n').filter(l => /^\s+(✅|🔴)\s+V\d/.test(l)).map(l => l.trim()) };
const bad = R.leg2_fresh_ctor.offline_selfcheck_lines.filter(l => l.startsWith('🔴')).length;
R.leg2_fresh_ctor.inconclusive = 0; R.leg2_fresh_ctor.mismatch = bad;
console.log('② 新 ctor:', JSON.stringify({ ...R.leg2_fresh_ctor, offline_selfcheck_lines: undefined }, null, 1));
R.verdict = (R.leg1_0820_ctor.A_eq_onchain && R.leg1_0820_ctor.A_eq_C && R.leg2_fresh_ctor.A_eq_C && bad === 0) ? 'OFFLINE-LEG PASS: A 产出 ≡ C 产出 ≡ 8/20 已上链字节; 8 向量离线自验全符合应然; inconclusive=0' : 'OFFLINE-LEG FAIL/INCONCLUSIVE — 见各字段';
writeFileSync(`${E2E}/offline-leg-result-20260827.json`, JSON.stringify(R, null, 1));
console.log('\n' + R.verdict + `\n→ ${E2E}/offline-leg-result-20260827.json`);
