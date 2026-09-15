import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const kaspa = await import(pathToFileURL('D:/kanet-tn12/scratch/_j2_wt_proto_v0/kasia-console/node_modules/kaspa-wasm/kaspa.js').href);
const { encodeRegisterAppendAction } = await import(pathToFileURL('D:/kanet-tn12/scratch/_j2_wt_proto_v0/kasia-console/src/lib/proto-register-append-witness.mjs').href);

const D = 'D:/kanet-tn12/scratch/_j2_wt_proto_v0/docs/provenance/2026-09-15-j2-d020-register-append-single-tx-verification';
const vectors = JSON.parse(fs.readFileSync(`${D}/d020_vectors.test.json`, 'utf8'));
const v = vectors.tests.find(t => t.name === '①a_leaf_first_bet_no_held_no_stake_pass');

// Recompile the SAME active contract instance (ctorArgs) to get the real entries.register_append ABI
const SILVERC = 'D:/kanet-tn12/scratch/_j2_silverc_v100/target/release/silverc.exe';
const CWD = 'D:/kanet-tn12/scratch/_j2_wt_proto_v0/kasia-console';
const SLD = `${CWD}/src/lib/ShardLeaf_direct.sil`;
function toCtorObjs(arr) { return arr.map((val) => (typeof val === 'string' && val.startsWith('0x')) ? { kind: 'bytes', value: [...Buffer.from(val.slice(2), 'hex')] } : { kind: 'int', value: val }); }
const dir = 'D:/kanet-tn12/scratch/_j2_d020_witness_check';
const ctorPath = `${dir}/active.ctor.json`, outPath = `${dir}/active.compiled.json`;
fs.writeFileSync(ctorPath, JSON.stringify(toCtorObjs(v.constructor_args), null, 1));
execSync(`"${SILVERC}" "${SLD}" --ctor "${ctorPath}" -o "${outPath}"`, { cwd: CWD });
const compiled = JSON.parse(fs.readFileSync(outPath, 'utf8'));
const contractName = Object.keys(compiled.contracts)[0];
const entryAbi = compiled.contracts[contractName].entries['register_append'];
console.log('dispatch_tag =', entryAbi.dispatch_tag);
console.log('params =', entryAbi.params?.map(p => p.name || p));

const [side, stake, leafOutIdx, psOutIdx, bettorPk, ps_prefix, ps_suffix, tok_out, tok_prefix, tok_suffix] = v.args;
const w = { side, stake, leafOutIdx, psOutIdx, bettorPk, ps_prefix, ps_suffix, tok_out, tok_prefix, tok_suffix };
const actionHex = encodeRegisterAppendAction(kaspa, entryAbi, w);
const mine = actionHex.startsWith('0x') ? actionHex.slice(2) : actionHex;

const real = fs.readFileSync(`${dir}/real_action_from_debugger.hex`, 'utf8').trim();
console.log('mine length', mine.length, 'real length', real.length);
console.log('EQUAL:', mine.toLowerCase() === real.toLowerCase());
if (mine.toLowerCase() !== real.toLowerCase()) {
  for (let i = 0; i < Math.max(mine.length, real.length); i++) {
    if (mine[i] !== real[i]) { console.log('first diff at char', i, 'mine=', mine.slice(i, i+20), 'real=', real.slice(i, i+20)); break; }
  }
}
