import { storageMass } from './storage-mass-oracle.mjs';
const V = [
  { n:'H1 1-in/2-out 200M→100M/99M', ins:[{amount:200_000_000n}], outs:[{amount:100_000_000n},{amount:99_000_000n}], exp:15101n },
  { n:'H2 1-in/1-out 200M→100M',      ins:[{amount:200_000_000n}], outs:[{amount:100_000_000n}], exp:5000n },
  { n:'H3 2-in/2-out 150M,50M→100M,99M', ins:[{amount:150_000_000n},{amount:50_000_000n}], outs:[{amount:100_000_000n},{amount:99_000_000n}], exp:0n },
  { n:'H4 3-in/3-out 70M,70M,60M→60M,70M,69M', ins:[{amount:70_000_000n},{amount:70_000_000n},{amount:60_000_000n}], outs:[{amount:60_000_000n},{amount:70_000_000n},{amount:69_000_000n}], exp:443n },
  { n:'H5 3-in/2-out 100M,50M,30M→150M,28M', ins:[{amount:100_000_000n},{amount:50_000_000n},{amount:30_000_000n}], outs:[{amount:150_000_000n},{amount:28_000_000n}], exp:0n },
];
let p=0,f=0;
for (const v of V){ const g=storageMass(v.ins,v.outs); const ok=g===v.exp; console.log(`${ok?'[PASS]':'[FAIL]'} ${v.n} = ${g}`+(ok?'':` exp ${v.exp}`)); ok?p++:f++; }
console.log(`\nNWT 独立 oracle vs J2 手算 H1-H5: ${p} PASS / ${f} FAIL`);
process.exit(f?1:0);
