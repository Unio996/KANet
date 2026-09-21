// NWT 突变跑器(只在 NWT 自己的 worktree 里改文件, 跑完 git checkout 还原)。用法: node mutate.mjs <mutants.json>
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const WT = 'D:/kanet-tn12/scratch/_nwt_wt_f1f2';
const KC = `${WT}/kasia-console`;
const specs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = [];
for (const m of specs) {
  const abs = `${KC}/${m.file}`;
  const orig = fs.readFileSync(abs, 'utf8');
  let mutated;
  if (m.transform === 'move-gate-before-mempool') {
    const s = orig.indexOf('  // F1: 唯一路径'); const e = orig.indexOf('  if (!row.prepared_tx_json) {');
    if (s < 0 || e < 0 || e < s) { out.push({ id: m.id, error: 'move anchors not found' }); continue; }
    const block = orig.slice(s, e);
    const anchor = '  const key = row.intent_key, txid = row.prepared_txid;\n';
    const a = orig.indexOf(anchor);
    if (a < 0) { out.push({ id: m.id, error: 'anchor2 not found' }); continue; }
    mutated = orig.slice(0, s) + orig.slice(e);
    const a2 = mutated.indexOf(anchor);
    mutated = mutated.slice(0, a2 + anchor.length) + block + mutated.slice(a2 + anchor.length);
  } else {
    const n = orig.split(m.from).length - 1;
    if (n !== 1) { out.push({ id: m.id, error: `pattern occurs ${n}x (need exactly 1)`, from: m.from.slice(0, 60) }); continue; }
    mutated = orig.replace(m.from, () => m.to);
  }
  fs.writeFileSync(abs, mutated);
  try {
    const tests = Array.isArray(m.tests) ? m.tests : [m.tests];
    const res = [];
    for (const t of tests) {
      const r = spawnSync('node ' + t + ' 2>&1', { cwd: KC, encoding: 'utf8', timeout: 300000, shell: true, env: { ...process.env, _PROTO_SETTLEMENT_INTENT_TEST_BOOTSTRAPPED: '' } });
      const txt = (r.stdout || '') + (r.stderr || '');
      const red = txt.split('\n').filter((l) => /❌|\[FAIL\]|FAIL /.test(l)).map((l) => l.trim().slice(0, 150));
      // 组标签: 取失败行之前最近的 [test] 行
      const lines = txt.split('\n'); const groups = new Set(); let cur = '';
      for (const l of lines) { if (l.startsWith('[test]')) cur = l.slice(0, 40); if (/❌/.test(l)) groups.add(cur); }
      res.push({ test: t.split('/').pop(), exit: r.status, redCount: red.length, groups: [...groups], sample: red.slice(0, 3) });
    }
    out.push({ id: m.id, desc: m.desc, killed: res.some((x) => x.exit !== 0 || x.redCount > 0), res });
  } finally {
    fs.writeFileSync(abs, orig);
    spawnSync('git', ['checkout', '--', m.file], { cwd: KC });
  }
}
console.log(JSON.stringify(out, null, 1));
