import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const { parseLauncherEnvText } = await import('file:///D:/kanet-tn12/scratch/_nwt_boot_v04/boot-guard-check.mjs');
const dir = path.join(os.tmpdir(), 'nwt-fuzz-env');
const oracle = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'nwt-fuzz-oracle.json'), 'utf8').replace(/^\uFEFF/, ''));
const EXOTIC = { '\u0085': 'U+0085(NEL)', '\uFEFF': 'U+FEFF(interior)', '\u2028': 'U+2028(LS)', '\u2029': 'U+2029(PS)' };
const tally = {}; let plainDiff = 0; const plain = [];
let flipArm = 0, flipDefOn = 0;
for (const [name, o] of Object.entries(oracle)) {
  const raw = fs.readFileSync(path.join(dir, name), 'utf8'); const text = raw.replace(/^\uFEFF/, '');
  const g = parseLauncherEnvText(raw).vars; const gm = {}; for (const [k, v] of g) if (k.startsWith('NWTZ_') && v !== null) gm[k] = v;
  const om = {}; for (const [k, v] of Object.entries(o.vars || {})) om[k] = v;
  if (JSON.stringify(Object.entries(gm).sort()) === JSON.stringify(Object.entries(om).sort())) continue;
  const chars = Object.keys(EXOTIC).filter((c) => text.includes(c));
  if (!chars.length) { plainDiff++; if (plain.length < 5) plain.push({ name, text: JSON.stringify(text), guard: gm, launcher: om }); continue; }
  const key = chars.map((c) => EXOTIC[c]).sort().join('+'); tally[key] = (tally[key] || 0) + 1;
  // direction: launcher has NWTZ_x === '1' that the guard does NOT have as '1'  => guard says OK while launcher arms
  for (const [k, v] of Object.entries(om)) if (v === '1' && gm[k] !== '1') { flipArm++; break; }
}
console.log('diffs WITHOUT any of U+0085/U+FEFF(interior)/U+2028/U+2029 :', plainDiff);
for (const p of plain) console.log('   PLAIN DIFF', JSON.stringify(p));
console.log('diffs involving them, by char set:', JSON.stringify(tally));
console.log('cases where the launcher ends with a variable === "1" that the guard does not see as "1" (guard would say OK, launcher arms):', flipArm);
