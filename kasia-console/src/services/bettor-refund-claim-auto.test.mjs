// claimAuto CPU 根治·funds-safety 不变量测试 (J1, 2026-06-19 post-wave1#1).
// 跑: node kasia-console/src/services/bettor-refund-claim-auto.test.mjs
// 守 NWT 钦点不变量: map.get 分类 ≡ 旧 per-side 派生 loop 分类, 对所有本地 bettor 永不 false-miss
// (本地漏判→refund 永不 dispatch=资金卡死). mock pubkey 不需 kaspa-wasm.
import { resolveSigningRelay } from './bettor-refund-claim-auto.mjs';

let pass = 0, fail = 0;
function eq(got, want, name) {
  if (got === want) pass++;
  else { fail++; console.error(`✘ ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}

// ── 参考·旧 per-relay loop 分类 (lowercase 比 + first-match break, 同源码 L64-72 原逻辑) ──
function oldLoopClassify(relays, pubkeyOf, bettorPk) {
  for (const r of relays) {
    let pk;
    try { pk = pubkeyOf(r.address); } catch { continue; }   // 同旧 loop catch{}
    if (String(pk).toLowerCase() === String(bettorPk).toLowerCase()) return r; // first-match break
  }
  return null;
}
// ── 新·建 map (== buildPubkeyToRelayMap 逻辑: lowercase key + first-match has-guard + throw skip) ──
function buildMap(relays, pubkeyOf) {
  const m = new Map();
  for (const r of relays) {
    let pk;
    try { pk = String(pubkeyOf(r.address)).toLowerCase(); } catch { continue; }
    if (!m.has(pk)) m.set(pk, r);
  }
  return m;
}

// mock 派生: address → pubkey (确定性). 'BAD' 地址 throw (模拟 invalid address).
const pubkeyOf = (addr) => { if (addr === 'BAD') throw new Error('invalid'); return 'PK_' + addr; };

const relays = [
  { id: 'r1', address: 'addrA' }, // PK_addrA
  { id: 'r2', address: 'addrB' }, // PK_addrB
  { id: 'r3', address: 'addrA' }, // PK_addrA (dup pubkey → first-match 取 r1)
  { id: 'r4', address: 'BAD' },   // throw → 两侧都跳过
];
const map = buildMap(relays, pubkeyOf);

// ── 核心: 对所有可能 bettor_pk, map 分类必 ≡ 旧 loop 分类 (funds-safety 不变量) ──
const probes = ['PK_addrA', 'PK_addrB', 'pk_addra' /*大小写*/, 'PK_addrC' /*remote*/, 'PK_BAD', null, undefined, ''];
for (const pk of probes) {
  const oldR = oldLoopClassify(relays, pubkeyOf, pk);
  const newR = resolveSigningRelay(map, pk);
  // 比 relay id (null===null)
  eq(newR?.id ?? null, oldR?.id ?? null, `分类等价 bettor_pk=${JSON.stringify(pk)}`);
}

// ── 具体断言 ──
eq(resolveSigningRelay(map, 'PK_addrA')?.id, 'r1', '本地 A → r1 (first-match, 非 r3 dup)');
eq(resolveSigningRelay(map, 'PK_addrB')?.id, 'r2', '本地 B → r2');
eq(resolveSigningRelay(map, 'pk_addra')?.id, 'r1', 'lowercase 不敏感 → r1');
eq(resolveSigningRelay(map, 'PK_addrC'), null, 'remote bettor → null (skip, 不 false-hit)');
eq(resolveSigningRelay(map, 'PK_BAD'), null, 'throw 地址不进 map → null (同旧 loop skip)');
eq(resolveSigningRelay(map, null), null, 'null bettor_pk → null');
eq(resolveSigningRelay(null, 'PK_addrA'), null, 'null map → null (防御)');

// ── 关键: 本地 bettor 永不 false-miss (在 map 里的本地 pk 必返非 null) ──
for (const r of relays) {
  if (r.address === 'BAD') continue;
  const pk = pubkeyOf(r.address);
  eq(resolveSigningRelay(map, pk) !== null, true, `本地 ${r.address} 不 false-miss (resolve 非 null)`);
}

console.log(`\nclaimAuto resolveSigningRelay test: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
