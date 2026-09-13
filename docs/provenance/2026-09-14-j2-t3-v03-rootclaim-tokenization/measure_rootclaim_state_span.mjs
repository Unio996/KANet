// Bettor 1145(a): OWN_PREFIX_LEN/OWN_STATE_LEN 不许手抄——从 PayoutShard.sil 实际编译产物量测, 跟源码里
// 硬编码的常量比对, 不一致就是"常量漂移"(源码结构或 ctor 动态字段长度变了, 但没人去重算硬编码值)。
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const SILVERC = 'D:/kanet-tn12/scratch/_j2_silverc_v100/target/release/silverc.exe';
const SIL = process.argv[2] || 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/PayoutShard.sil';
const CTOR = process.argv[3] || 'D:/kanet-tn12/scratch/_j2_wt_t3_market/scratch/_t1v06_check/PayoutShard_v03.ctor.json';
const OUT = process.argv[4] || 'D:/kanet-tn12/scratch/_j2_wt_t3_market/scratch/_t1v06_check/_measure_out.json';

execSync(`"${SILVERC}" "${SIL}" --ctor "${CTOR}" -o "${OUT}"`, { cwd: 'D:/kanet-tn12/scratch/_j2_wt_t3_market' });
const compiled = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const c = Object.values(compiled.contracts)[0].compiled;
const measured = {
  own_prefix_len: c.state_span.offset,
  own_state_len: c.state_span.len,
  own_suffix_len: c.bytecode.length - c.state_span.offset - c.state_span.len,
  bytecode_length: c.bytecode.length,
};

// Parse the source's hardcoded OWN_PREFIX_LEN / OWN_STATE_LEN constants (if present) to compare.
const src = fs.readFileSync(SIL, 'utf8');
const mPrefix = src.match(/int\s+constant\s+OWN_PREFIX_LEN\s*=\s*(\d+)\s*;/);
const mState = src.match(/int\s+constant\s+OWN_STATE_LEN\s*=\s*(\d+)\s*;/);
const declared = {
  own_prefix_len: mPrefix ? Number(mPrefix[1]) : null,
  own_state_len: mState ? Number(mState[1]) : null,
};

console.log(JSON.stringify({ measured, declared }, null, 1));

let drift = false;
if (declared.own_prefix_len !== null && declared.own_prefix_len !== measured.own_prefix_len) { console.error(`DRIFT: OWN_PREFIX_LEN source=${declared.own_prefix_len} measured=${measured.own_prefix_len}`); drift = true; }
if (declared.own_state_len !== null && declared.own_state_len !== measured.own_state_len) { console.error(`DRIFT: OWN_STATE_LEN source=${declared.own_state_len} measured=${measured.own_state_len}`); drift = true; }
if (drift) { console.error('CONSTANT DRIFT DETECTED — recompile and update the hardcoded constants in the .sil source.'); process.exit(1); }
console.log('OK: no drift, hardcoded constants match the actual compiled artifact.');
