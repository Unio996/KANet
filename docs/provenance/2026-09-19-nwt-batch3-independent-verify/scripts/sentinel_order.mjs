// NWT: N1 残余盲区闭合 —— 用两两不同的哨兵值走【J2 编码器】与【上游 Rust 编码器(patched cli-debugger 转储)】, 逐字节比。
// 哨兵使 tokenIn/tokenOut、rc_prefix/tok_prefix 等在真实形状里恒等的成对参数变得可区分。
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const D = 'D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/';
const kaspa = await import('kaspa-wasm');
const { encodeConvertToRootcloseAction } = await import('../../src/lib/proto-convert-to-rootclose-witness.mjs');
const { parsePushes } = await import('./decode_pushes.mjs');
const leaf = JSON.parse(readFileSync(D + 'leaf_out.json', 'utf8')).contracts.ShardLeaf_direct;
const abi = leaf.entries.convert_to_rootclose;
const S = { rcOutIdx: 3, rc_prefix: '0xaa01', rc_suffix: '0xbb0202', tokenInIdx: 5, tokenOutIdx: 7, tok_prefix: '0xcc03', tok_suffix: '0xdd040404' };
const j2hex = encodeConvertToRootcloseAction(kaspa, abi, S);
// 上游: 用相同哨兵造 fixture, 让 patched debugger 转储
const fx = JSON.parse(readFileSync(D + 'dbg_fixture.json', 'utf8'));
fx.tests[0].args = [3, '0xaa01', '0xbb0202', 5, 7, '0xcc03', '0xdd040404']; fx.tests[0].name = 'nwt_sentinel';
writeFileSync(D + 'dbg_fixture_sentinel.json', JSON.stringify(fx));
let err = '';
try { execFileSync('D:/silverscript-debugger-3ed9733-eprintln/target/release/cli-debugger.exe', ['D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/src/lib/ShardLeaf_direct.sil', '--test-file', D + 'dbg_fixture_sentinel.json', '--test-name', 'nwt_sentinel', '--run'], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 }); } catch (e) { err = String(e.stderr || ''); }
if (!err) err = ''; // if success path, stderr is not captured by execFileSync; rerun with spawnSync
if (!/J2_DEBUG/.test(err)) { const { spawnSync } = await import('node:child_process'); const r = spawnSync('D:/silverscript-debugger-3ed9733-eprintln/target/release/cli-debugger.exe', ['D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/src/lib/ShardLeaf_direct.sil', '--test-file', D + 'dbg_fixture_sentinel.json', '--test-name', 'nwt_sentinel', '--run'], { maxBuffer: 1 << 26 }); err = r.stderr.toString(); }
const up = err.match(/J2_DEBUG active_sigscript_hex=([0-9a-f]+)/)[1];
console.log('J2 encoder :', j2hex); console.log('upstream   :', up); console.log('BYTE-EQUAL =', j2hex === up);
const pushes = parsePushes(j2hex).map(p => p.kind === 'push' || p.kind.startsWith('PUSHDATA') ? p.data.toString('hex') : p.kind);
console.log('decoded pushes (ABI order rcOutIdx,rc_prefix,rc_suffix,tokenInIdx,tokenOutIdx,tok_prefix,tok_suffix,tag):', JSON.stringify(pushes));
