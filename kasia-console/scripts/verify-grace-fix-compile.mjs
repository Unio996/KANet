// Verify all 4 grace-fix sil files compile clean after Bettor r388/r389 grace fix.
// Tests: PoolSide_v06 / PoolSide_v07 / PoolSpine_v06 / PoolSpine_v07.

import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SILVERC = process.env.SILVERC_PATH || 'D:/silverscript/target/release/silverc.exe';
const LIB = join(__dirname, '..', 'src', 'lib');

function b32(hex) {
  if (hex.startsWith('0x')) hex = hex.slice(2);
  const a = new Uint8Array(32);
  for (let i = 0; i < 32; i++) a[i] = parseInt(hex.substr(i*2,2),16);
  return { kind:'array', data: Array.from(a, b=>({kind:'byte',data:b})) };
}
const I = n => ({ kind:'int', data:n });
const PK = (n) => b32((n.toString(16).padStart(2,'0')).repeat(32).slice(0,64));
const HASH = (n) => b32((n.toString(16).padStart(2,'0')).repeat(32).slice(0,64));

const cacheDir = join(tmpdir(),'kanet-grace-fix-verify');
if (!existsSync(cacheDir)) mkdirSync(cacheDir,{recursive:true});

const cases = [
  {
    name: 'PoolSpine_v06',
    sil: 'PoolSpine_v06.sil',
    // 10 args: makerPk, brokerPk, poolMerkleRoot, deadline, minerFee, brokerFeePct,
    //         oracleFeePct, oracleBondAmount, makerStakeAmount, marketMetadataHash
    ctor: [PK(1), PK(2), HASH(0x11), I(1800000000), I(50000), I(100), I(100), I(100000000), I(10000000000), HASH(0xab)],
  },
  {
    name: 'PoolSpine_v07',
    sil: 'PoolSpine_v07.sil',
    // 13 args: + shard_id, shard_count, market_id
    ctor: [PK(1), PK(2), HASH(0x11), I(1800000000), I(50000), I(100), I(100), I(100000000), I(10000000000), HASH(0xab), I(0), I(1), HASH(0xcc)],
  },
  {
    name: 'PoolSide_v06',
    sil: 'PoolSide_v06.sil',
    // 6 args: bettorPk, spineP2shHash, poolMerkleRoot, marketMetadataHash, direction, deadline
    ctor: [PK(0xa), HASH(0xbb), HASH(0x11), HASH(0xab), I(0), I(1800000000)],
  },
  {
    name: 'PoolSide_v07',
    sil: 'PoolSide_v07.sil',
    // same 6 args as v06
    ctor: [PK(0xa), HASH(0xbb), HASH(0x11), HASH(0xab), I(0), I(1800000000)],
  },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const silPath = join(LIB, c.sil);
  const ctorPath = join(cacheDir, c.name + '.ctor.json');
  writeFileSync(ctorPath, JSON.stringify(c.ctor));
  try {
    const stdout = execFileSync(SILVERC, [silPath, '--ctor', ctorPath, '-c'], { stdio: 'pipe', timeout: 30_000 });
    const art = JSON.parse(stdout.toString());
    console.log(`✓ ${c.name}: ${art.script.length}B, contract=${art.contract_name}`);
    pass++;
  } catch (e) {
    const stderr = e.stderr?.toString() || '';
    console.error(`✗ ${c.name}: FAIL`);
    console.error('  stderr:', stderr.slice(0,400));
    fail++;
  }
}
console.log(`\n${pass}/${cases.length} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
