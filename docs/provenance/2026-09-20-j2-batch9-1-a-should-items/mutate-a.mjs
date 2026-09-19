// mutate-a.mjs — 9-1 首批 A 笔(NWT 三条 SHOULD)的变异对照与原始输出(J2 2026-09-20)。
//   S1: 对 anchors JSON 的六个 cap 逐个改动 / 删 _source / 让 cap 超过全局硬顶 ⇒ proto-fee-profile-caps.test.mjs 必须红
//   S3: 对 drain-finality-safe-blocks 与 broadcaster-utxo 两个测试, 各跑三种情形并原样贴输出:
//        ① 缺前提 + 有前提检查   ⇒ 期望: 明确的中文说明(缺什么、怎么跑) + exit 1
//        ② 缺前提 + 去掉检查(变异) ⇒ 期望: 退回泛泛/裸异常——证明"明确说明"确实是检查产生的, 不是靠原有的裸异常
//        ③ 前提满足              ⇒ 期望: 正常通过
// 每次 finally 还原被变异文件并核对 sha256, 防止把变异留在工作树里。
// 运行: node docs/provenance/2026-09-20-j2-batch9-1-a-should-items/mutate-a.mjs <worktree 根绝对路径>
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOT = process.argv[2];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const redact = (s) => s.split('C:\\Users\\ADMIN\\AppData\\Local\\Temp').join('%TEMP%');
const run = (cwd, args, envPatch = {}, dropEnv = []) => {
  const env = { ...process.env, ...envPatch }; for (const k of dropEnv) delete env[k];
  const r = spawnSync(process.execPath, args, { cwd: `${ROOT}/${cwd}`, env, encoding: 'utf8', timeout: 180000 });
  return { status: r.status, out: redact(`${r.stdout || ''}${r.stderr || ''}`) };
};
const head = (s, n = 9) => s.split('\n').filter((l) => l.trim()).slice(0, n).map((l) => '    | ' + l.slice(0, 230)).join('\n');
let allOk = true;
const verdict = (ok, msg) => { if (!ok) allOk = false; console.log(`  ${ok ? '✅' : '❌'} ${msg}`); };

// ═══════════════ S1 ═══════════════
const ANCHORS = `${ROOT}/kasia-console/scripts/proto-v0-template-anchors.json`;
const anchorsOrig = fs.readFileSync(ANCHORS), anchorsSha = sha(anchorsOrig);
const KINDS = ['market_seal', 'close_commit', 'convert_to_claim', 'claim_draw', 'withdraw', 'ticket_reclaim'];
console.log('══ S1: proto-fee-profile-caps.test.mjs 对 anchors JSON 的变异 ══');
try {
  const base = run('kasia-console', ['src/lib/proto-fee-profile-caps.test.mjs']);
  console.log(`基线(未变异): exit=${base.status}  ${base.out.split('\n').filter((l) => /passed, \d+ failed/.test(l)).pop()}`);
  verdict(base.status === 0, '基线通过');
  const muts = [
    ...KINDS.map((k) => [`${k}.cap +1 sompi`, (j) => { j.feeProfile[k].cap = String(BigInt(j.feeProfile[k].cap) + 1n); }]),
    ...KINDS.map((k) => [`${k}.cap -1 sompi`, (j) => { j.feeProfile[k].cap = String(BigInt(j.feeProfile[k].cap) - 1n); }]),
    ['withdraw.cap 超过全局硬顶(200,000,000)', (j) => { j.feeProfile.withdraw.cap = '200000000'; }],
    ['删掉 close_commit 的 _source', (j) => { delete j.feeProfile.close_commit._source; }],
    ['删掉 claim_draw 整个 feeProfile 条目', (j) => { delete j.feeProfile.claim_draw; }],
  ];
  for (const [name, fn] of muts) {
    const j = JSON.parse(anchorsOrig.toString('utf8')); fn(j);
    fs.writeFileSync(ANCHORS, JSON.stringify(j, null, 2));
    const r = run('kasia-console', ['src/lib/proto-fee-profile-caps.test.mjs']);
    const fails = r.out.split('\n').filter((l) => l.startsWith('[FAIL]')).length;
    verdict(r.status !== 0 && fails > 0, `变异「${name}」⇒ ${fails} 条 FAIL (exit ${r.status})`);
    fs.writeFileSync(ANCHORS, anchorsOrig);
  }
} finally {
  fs.writeFileSync(ANCHORS, anchorsOrig);
  console.log(sha(fs.readFileSync(ANCHORS)) === anchorsSha ? `[RESTORED] anchors JSON 已还原, sha256 ${anchorsSha.slice(0, 16)}… 一致` : '[!!! anchors JSON 还原失败 !!!]');
}

// ═══════════════ S3 ═══════════════
const cases = [
  { name: 'drain-finality-safe-blocks.test.mjs', file: `${ROOT}/kasia-relay/src/drain-finality-safe-blocks.test.mjs`, cwd: 'kasia-relay',
    missing: { args: ['src/drain-finality-safe-blocks.test.mjs'], drop: ['KASPA_NETWORK'] },
    ok: { args: ['src/drain-finality-safe-blocks.test.mjs'], env: { KASPA_NETWORK: 'simnet' } },
    clear: /前提不满足.*KASPA_NETWORK/, bare: /KASPA_NETWORK not set or unknown/ },
  { name: 'broadcaster-utxo.test.mjs', file: `${ROOT}/kasia-console/src/lib/broadcaster-utxo.test.mjs`, cwd: 'kasia-console',
    missing: { args: ['src/lib/broadcaster-utxo.test.mjs'] },                         // 不带 --experimental-test-module-mocks
    ok: { args: ['--experimental-test-module-mocks', '--test', 'src/lib/broadcaster-utxo.test.mjs'] },
    clear: /前提不满足.*mock\.module/, bare: /mock\.module is not a function/ },
];
console.log('\n══ S3: 测试前提 fail-loud(有检查 / 去掉检查的变异 / 前提满足) ══');
for (const c of cases) {
  const orig = fs.readFileSync(c.file), origSha = sha(orig), text = orig.toString('utf8');
  console.log(`\n── ${c.name}`);
  try {
    const B = text.indexOf('// ⟦PREREQ-CHECK-BEGIN⟧'), E = text.indexOf('// ⟦PREREQ-CHECK-END⟧');
    if (B < 0 || E < B) throw new Error('找不到 PREREQ-CHECK 标记块');
    const mutated = text.slice(0, B) + text.slice(E + '// ⟦PREREQ-CHECK-END⟧'.length);

    const r1 = run(c.cwd, c.missing.args, {}, c.missing.drop || []);
    console.log(`① 缺前提 + 有检查: exit=${r1.status}\n${head(r1.out)}`);
    verdict(r1.status === 1 && c.clear.test(r1.out), '给出明确的"前提不满足"说明(缺什么 + 正确运行命令)且 exit 1');

    fs.writeFileSync(c.file, mutated);
    const r2 = run(c.cwd, c.missing.args, {}, c.missing.drop || []);
    console.log(`② 缺前提 + 去掉检查(变异): exit=${r2.status}\n${head(r2.out)}`);
    verdict(!c.clear.test(r2.out) && c.bare.test(r2.out), '变异后不再有明确说明, 退回裸/泛泛异常(证明明确说明确实是检查产生的)');
    fs.writeFileSync(c.file, orig);

    const r3 = run(c.cwd, c.ok.args, c.ok.env || {});
    const sum = r3.out.split('\n').filter((l) => /ALL PASS|^ℹ (tests|pass|fail) /.test(l)).join(' | ');
    console.log(`③ 前提满足: exit=${r3.status}  ${sum}`);
    verdict(r3.status === 0, '前提满足时正常通过');
  } finally {
    fs.writeFileSync(c.file, orig);
    console.log(sha(fs.readFileSync(c.file)) === origSha ? `[RESTORED] ${c.name} 已还原, sha256 ${origSha.slice(0, 16)}… 一致` : `[!!! ${c.name} 还原失败 !!!]`);
  }
}
console.log(allOk ? '\n全部对照符合预期 ✅' : '\n⚠ 有对照不符合预期, 见上 ❌');
process.exit(allOk ? 0 : 1);
