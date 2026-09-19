// NWT 批9-1 E 笔(a57db3d5) 独立变异: 目标 src/lib/proto-tx-assembly-settlement.mjs, 须在 kasia-console/ 目录下跑; 每个变异后还原并核 sha256.
const fs = require('fs'), cp = require('child_process'), crypto = require('crypto');
const F = 'src/lib/proto-tx-assembly-settlement.mjs';
const orig = fs.readFileSync(F, 'utf8'); const sha0 = crypto.createHash('sha256').update(orig).digest('hex');
const rep = (a, b) => s => { const n = s.split(a).length - 1; if (n !== 1) throw new Error(`pattern matched ${n}x (need 1): ${a.slice(0, 70)}`); return s.replace(a, b); };
const TESTS = ['proto-claim-draw', 'proto-tx-assembly-settlement', 'proto-tx-assembly-settlement-golden'];
const M = [
  ['NWT-e1 spkByteLen: 0x prefix not stripped', rep("String(hex).replace(/^0x/i, '').length / 2", "String(hex).length / 2")],
  ['NWT-e2 (4) value-vs-builder check skipped for fee only', rep("if (p.value !== u.value) fail(", "if (role !== 'fee' && p.value !== u.value) fail(")],
  ['NWT-e3 hasCovenant check skipped for fee only', rep("if (p.hasCovenant !== inputHasCovenant[i]) fail(", "if (role !== 'fee' && p.hasCovenant !== inputHasCovenant[i]) fail(")],
  ['NWT-e4 spkLen check skipped for fee only', rep("if (p.spkLen !== spkByteLen(u.spkHex)) fail(", "if (role !== 'fee' && p.spkLen !== spkByteLen(u.spkHex)) fail(")],
  ['NWT-e5 first role never checked', rep("roles.forEach((role, i) => {\n    const p = chainParents[role];", "roles.forEach((role, i) => {\n    if (i === 0) return;\n    const p = chainParents[role];")],
  ['NWT-e6 last role (fee) never checked', rep("roles.forEach((role, i) => {\n    const p = chainParents[role];", "roles.forEach((role, i) => {\n    if (role === 'fee') return;\n    const p = chainParents[role];")],
  ['NWT-e7 hasCovenant index off by one', rep("p.hasCovenant !== inputHasCovenant[i]) fail(role, `hasCovenant=${p.hasCovenant} != builder 假设的 ${inputHasCovenant[i]}", "p.hasCovenant !== inputHasCovenant[Math.max(0, i - 1)]) fail(role, `hasCovenant=${p.hasCovenant} != builder 假设的 ${inputHasCovenant[i]}")],
  ['NWT-e8 extra-role keys tolerated', rep("for (const k of Object.keys(chainParents)) if (!roles.includes(k)) fail(", "for (const k of Object.keys(chainParents)) if (false) fail(")],
  ['NWT-e9 (3) constant-value check removed (all non-fee roles)', rep("if (role !== 'fee' && p.value !== EXPECTED_INPUT_VALUE_SOMPI[role]) fail(", "if (false) fail(")],
  ['NWT-e10 claim_draw ticket expected value = CONTINUATION', rep("ticket: { value: GENESIS_OUTPUT_SOMPI, spkHex: ticketArtifact.scriptPubKeyHex },", "ticket: { value: CONTINUATION_OUTPUT_SOMPI, spkHex: ticketArtifact.scriptPubKeyHex },")],
  ['NWT-e11 claim_draw held expected value = CONTINUATION', rep("held: { value: GENESIS_OUTPUT_SOMPI, spkHex: heldArtifact.scriptPubKeyHex },\n      fee: { value: feeUtxo.value, spkHex: feeUtxo.scriptPublicKeyHex },\n    },\n  });\n\n  // 🔴 签名前", "held: { value: CONTINUATION_OUTPUT_SOMPI, spkHex: heldArtifact.scriptPubKeyHex },\n      fee: { value: feeUtxo.value, spkHex: feeUtxo.scriptPublicKeyHex },\n    },\n  });\n\n  // 🔴 签名前")],
  ['NWT-e12 close_commit fee used-value = constant not feeUtxo.value', rep("rootClose: { value: CONTINUATION_OUTPUT_SOMPI, spkHex: currentArtifact.scriptPubKeyHex },\n      fee: { value: feeUtxo.value, spkHex: feeUtxo.scriptPublicKeyHex },", "rootClose: { value: CONTINUATION_OUTPUT_SOMPI, spkHex: currentArtifact.scriptPubKeyHex },\n      fee: { value: 100000000n, spkHex: feeUtxo.scriptPublicKeyHex },")],
  ['NWT-e13 seal used.held value = leaf constant (skips held (4))', rep("held: { value: heldInput.value, spkHex: heldInput.scriptPublicKeyHex },", "held: { value: CONTINUATION_OUTPUT_SOMPI, spkHex: heldInput.scriptPublicKeyHex },")],
  ['NWT-e14 internal-layout guard in seal disabled (guards future drift only)', rep("if (heldIdx !== MARKET_SEAL_HELD_IN_INDEX || feeIdx !== MARKET_SEAL_FEE_IN_INDEX) {", "if (false) {")],
  ['NWT-e15 isPlainObj accepts arrays', rep("x !== null && typeof x === 'object' && !Array.isArray(x)", "x !== null && typeof x === 'object'")],
  ['NWT-e16 close_commit continuation index [1]', rep("continuationOutputIndices: [CLOSE_COMMIT_ROOTCLOSE_OUT_INDEX],", "continuationOutputIndices: [1],")],
  ['NWT-e17 spkLen lower bound <= 0 -> < 0', rep("p.spkLen <= 0 ||", "p.spkLen < 0 ||")],
];
const out = [];
for (const [n, fn] of M) {
  let m; try { m = fn(orig); } catch (e) { out.push('?? ' + n + ' :: ' + e.message); continue; }
  fs.writeFileSync(F, m);
  const res = [];
  for (const t of TESTS) {
    const r = cp.spawnSync('node', [`src/lib/${t}.test.mjs`], { encoding: 'utf8', timeout: 180000 });
    const fails = ((r.stdout || '').match(/\[FAIL\]/g) || []).length;
    res.push(`${t.replace('proto-', '').replace('-settlement', '').replace('tx-assembly', 'asm')}:${r.status === 0 ? 'ok' : 'RED(f=' + fails + ',x=' + r.status + ')'}`);
  }
  const killed = res.some(x => x.includes('RED'));
  out.push((killed ? 'killed   ' : 'SURVIVED ') + n + '   ' + res.join(' '));
}
fs.writeFileSync(F, orig);
const sha1 = crypto.createHash('sha256').update(fs.readFileSync(F)).digest('hex');
console.log(out.join('\n')); console.log('restored sha256 identical: ' + (sha0 === sha1) + ' ' + sha1.slice(0, 16));
