// NWT 批9-1 F2(34bd831a) 独立变异: 目标 src/lib/proto-tx-assembly-settlement.mjs, 在 kasia-console/ 下跑; 每个变异后还原并核 sha256。
const fs = require('fs'), cp = require('child_process'), crypto = require('crypto');
const F = 'src/lib/proto-tx-assembly-settlement.mjs';
const orig = fs.readFileSync(F, 'utf8'); const sha0 = crypto.createHash('sha256').update(orig).digest('hex');
const R = (a, b) => s => { const n = s.split(a).length - 1; if (n !== 1) throw new Error(`pattern matched ${n}x (need 1): ${a.slice(0, 70)}`); return s.replace(a, b); };
const M = [
  ['NWT-h1 outpoint index not compared', R("p.outpoint.txid !== String(u.outpoint.txid).toLowerCase() || p.outpoint.index !== Number(u.outpoint.vout)", "p.outpoint.txid !== String(u.outpoint.txid).toLowerCase()")],
  ['NWT-h2 outpoint txid compared case-sensitively', R("p.outpoint.txid !== String(u.outpoint.txid).toLowerCase()", "p.outpoint.txid !== String(u.outpoint.txid)")],
  ['NWT-h3 wrong field for index (u.outpoint.index)', R("p.outpoint.index !== Number(u.outpoint.vout)", "p.outpoint.index !== Number(u.outpoint.index)")],
  ['NWT-h4 shape: txid pattern accepts anything', R("!/^[0-9a-f]{64}$/.test(p.outpoint.txid)", "false")],
  ['NWT-h5 shape: negative index accepted', R("|| p.outpoint.index < 0) fail(", ") fail(")],
  ['NWT-h6 seal: fee used-outpoint mis-wired to leafOutpoint', R("fee: { value: feeUtxo.value, spkHex: feeUtxo.scriptPublicKeyHex, outpoint: feeUtxo },\n    },\n  });\n\n  const mkInput", "fee: { value: feeUtxo.value, spkHex: feeUtxo.scriptPublicKeyHex, outpoint: leafOutpoint },\n    },\n  });\n\n  const mkInput")],
  ['NWT-h7 close_commit: fee used-outpoint mis-wired to rootCloseOutpoint', R("rootClose: { value: CONTINUATION_OUTPUT_SOMPI, spkHex: currentArtifact.scriptPubKeyHex, outpoint: rootCloseOutpoint },\n      fee: { value: feeUtxo.value, spkHex: feeUtxo.scriptPublicKeyHex, outpoint: feeUtxo },", "rootClose: { value: CONTINUATION_OUTPUT_SOMPI, spkHex: currentArtifact.scriptPubKeyHex, outpoint: rootCloseOutpoint },\n      fee: { value: feeUtxo.value, spkHex: feeUtxo.scriptPublicKeyHex, outpoint: rootCloseOutpoint },")],
  ['NWT-h8 convert: held used-outpoint mis-wired to rootCloseOutpoint', R("held: { value: GENESIS_OUTPUT_SOMPI, spkHex: heldArtifact.scriptPubKeyHex, outpoint: heldTokenOutpoint },\n      fee: { value: feeUtxo.value, spkHex: feeUtxo.scriptPublicKeyHex, outpoint: feeUtxo },\n    },\n  });\n\n  // 两个genesis", "held: { value: GENESIS_OUTPUT_SOMPI, spkHex: heldArtifact.scriptPubKeyHex, outpoint: rootCloseOutpoint },\n      fee: { value: feeUtxo.value, spkHex: feeUtxo.scriptPublicKeyHex, outpoint: feeUtxo },\n    },\n  });\n\n  // 两个genesis")],
  ['NWT-h9 claim_draw: ticket used-outpoint mis-wired to rootClaimOutpoint', R("ticket: { value: GENESIS_OUTPUT_SOMPI, spkHex: ticketArtifact.scriptPubKeyHex, outpoint: ticketOutpoint },", "ticket: { value: GENESIS_OUTPUT_SOMPI, spkHex: ticketArtifact.scriptPubKeyHex, outpoint: rootClaimOutpoint },")],
  ['NWT-h10 claim_draw: held used-outpoint mis-wired to ticketOutpoint', R("held: { value: GENESIS_OUTPUT_SOMPI, spkHex: heldArtifact.scriptPubKeyHex, outpoint: heldTokenOutpoint },\n      fee: { value: feeUtxo.value, spkHex: feeUtxo.scriptPublicKeyHex, outpoint: feeUtxo },\n    },\n  });\n\n  // 🔴 签名前", "held: { value: GENESIS_OUTPUT_SOMPI, spkHex: heldArtifact.scriptPubKeyHex, outpoint: ticketOutpoint },\n      fee: { value: feeUtxo.value, spkHex: feeUtxo.scriptPublicKeyHex, outpoint: feeUtxo },\n    },\n  });\n\n  // 🔴 签名前")],
  ['NWT-h11 whole outpoint identity check removed (= E behaviour)', R("if (p.outpoint.txid !== String(u.outpoint.txid).toLowerCase() || p.outpoint.index !== Number(u.outpoint.vout)) {", "if (false) {")],
  ['NWT-h12 internal guard !u.outpoint removed', R("if (!u || !u.outpoint) throw new Error(", "if (!u) throw new Error(")],
];
const TESTS = ['proto-claim-draw', 'proto-tx-assembly-settlement', 'proto-tx-assembly-settlement-golden'];
const out = [];
for (const [n, fn] of M) {
  let m; try { m = fn(orig); } catch (e) { out.push('?? ' + n + ' :: ' + e.message); continue; }
  fs.writeFileSync(F, m);
  const res = TESTS.map((t) => { const r = cp.spawnSync('node', [`src/lib/${t}.test.mjs`], { encoding: 'utf8', timeout: 180000 }); const f = ((r.stdout || '').match(/\[FAIL\]/g) || []).length; return t.replace('proto-', '').replace('-settlement', '').replace('tx-assembly', 'asm') + ':' + (r.status === 0 ? 'ok' : 'RED(f=' + f + ')'); });
  out.push((res.some((x) => x.includes('RED')) ? 'killed   ' : 'SURVIVED ') + n + '   ' + res.join(' '));
}
fs.writeFileSync(F, orig);
console.log(out.join('\n')); console.log('restored sha256 identical: ' + (sha0 === crypto.createHash('sha256').update(fs.readFileSync(F)).digest('hex')));
