// NWT: differential test of the two env parsers.
//   LOADER = scripts/start-console-mainnet.ps1 (PowerShell):  skip /^\s*#/ and blank; if /^([^=]+)=(.*)$/  -> Process[$1.Trim()] = $2   (last wins, value kept verbatim)
//   GUARD  = appendix C.3 boot-guard-check.mjs:               /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/ and not /^\s*#/  -> Map.set (last wins)
// Both ported literally. Reports every line shape where the effective value of KEY differs.
const loader = (text) => {
  const m = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || /^\s*$/.test(line)) continue;
    const r = /^([^=]+)=(.*)$/.exec(line);
    if (r) m.set(r[1].trim(), r[2]);                       // .Trim() on the key, value verbatim
  }
  return m;
};
const guard = (text) => {
  const kv = new Map();
  for (const line of text.split(/\r?\n/)) { const r = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line); if (r && !/^\s*#/.test(line)) kv.set(r[1], r[2]); }
  return kv;
};
const shapes = [
  ['KEY=1', 'plain'], [' KEY=1', 'leading space'], ['KEY =1', 'space before ='], ['KEY\t=1', 'tab before ='], ['KEY= 1', 'space after ='], ['KEY=1 ', 'trailing space'],
  ['KEY="1"', 'quoted'], ['KEY=1 # c', 'inline comment'], ['export KEY=1', 'export prefix'], ['#KEY=1', 'commented'], ['  #KEY=1', 'indented comment'],
  ['KEY==1', 'double ='], ['KEY=1 ', 'trailing NBSP'], ['﻿KEY=1', 'BOM before key (first line of a BOM file)'],
];
let diffs = 0;
for (const [line, name] of shapes) {
  const L = loader(line + '\n').get('KEY'), G = guard(line + '\n').get('KEY');
  const same = L === G;
  if (!same) diffs++;
  console.log((same ? 'same  ' : 'DIFFER') + '  ' + name.padEnd(42) + ' loader=' + JSON.stringify(L) + ' guard=' + JSON.stringify(G) + (same ? '' : (L === '1' && G === undefined ? '   <== console gets KEY=1, guard sees KEY absent (would say OK)' : '')));
}
// duplicate keys: last wins in both?
const dup = 'KEY=1\nKEY=0\n', dup2 = 'KEY=0\nKEY=1\n';
console.log('dup(last=0)   loader=' + loader(dup).get('KEY') + ' guard=' + guard(dup).get('KEY') + ' | dup(last=1) loader=' + loader(dup2).get('KEY') + ' guard=' + guard(dup2).get('KEY'));
console.log('DIFFER count = ' + diffs);
