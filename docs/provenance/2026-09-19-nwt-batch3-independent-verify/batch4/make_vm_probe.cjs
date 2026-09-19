const fs = require('fs');
const src = 'D:/kanet-tn12/scratch/_nwt_wt_j2_7f1e339b/kasia-console/src/lib/proto-tx-assembly-settlement.test.mjs';
let s = fs.readFileSync(src, 'utf8');
const marker = "  t('②relay真代码能反序列化+extractTxShape+validateFixedValueOutputs通过(续约非genesis)'";
if (!s.includes(marker)) throw new Error('marker missing');
const probe = `  t('NWT-VM-PROBE 修后 builder 真实输出的委员签名: 上游 VM(patched cli-debugger)与自移植 sighash 双重验', () => {
    const NB = 'file:///D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/';
    const tx = kaspa.Transaction.deserializeFromSafeJSON(closeCommitBuilt.txJson);
    const toHex = (b) => '0x' + Buffer.from(b).toString('hex');
    const ps = nwtParsePushes(Buffer.from(tx.inputs[0].signatureScript, 'hex').toString('hex'));
    const num = (p) => Number(BigInt(p.kind === 'OP_0' ? 0 : (p.small ?? 0)));
    const pk = ps.slice(0, 5).map((p) => toHex(p.data)); const sigs = ps.slice(5, 10).map((p) => toHex(p.data));
    const args = [...pk, ...sigs, num(ps[10]), num(ps[11]), toHex(ps[12].data), toHex(ps[13].data), toHex(ps[14].data)];
    const cs = { local_yes: currentState.local_yes, local_no: currentState.local_no, count: currentState.count, pool_value: currentState.pool_value };
    const art = computeRootCloseGenesisArtifact({ marketId: MARKET_ID, committeePubkeyHex: genesisArtifacts.committeePubkeyHex, deadlineMs: DEADLINE_MS, rootCloseTmplHash: genesisArtifacts.rootCloseTmplHash, state: { ...cs, closed: 0, winningSide: 0, payoutRoot: '00'.repeat(32) } });
    const ctor = (closed, win, root) => [toHex(Buffer.from(art.committeeHash, 'hex')), DEADLINE_MS, toHex(Buffer.from(art.rootClaimTmplHash, 'hex')), toHex(Buffer.from(art.refundClaimTmplHash, 'hex')), toHex(Buffer.from(token_tmpl_hash, 'hex')), cs.local_yes, cs.local_no, cs.count, cs.pool_value, closed, win, toHex(Buffer.from(root, 'hex'))];
    const rcCov = String(tx.outputs[0].covenant.covenantId);
    const mkFx = (withCov) => ({ tests: [{ name: 'nwt_fixed', function: 'close_commit', constructor_args: ctor(0, 0, '00'.repeat(32)), args, expect: 'pass',
      tx: { version: 1, lock_time: Number(tx.lockTime), active_input_index: 0,
        inputs: tx.inputs.map((i, k) => ({ prev_txid: String(i.previousOutpoint.transactionId), prev_index: Number(i.previousOutpoint.index), sequence: 0, utxo_value: Number(i.utxo.amount), ...(k === 0 ? { covenant_id: rcCov } : {}) })),
        outputs: tx.outputs.map((o, k) => (k === 0 ? { value: Number(o.value), ...(withCov ? { covenant_id: rcCov, authorizing_input: 0 } : {}), constructor_args: ctor(1, NEW_WINNING_SIDE, NEW_PAYOUT_ROOT_HEX) } : { value: Number(o.value), script_hex: String(o.scriptPublicKey.script) })) } }] });
    const run = (fx, name) => { const p = require0('node:path'); const f = require0('node:os').tmpdir() + '/_nwt_vm_' + name + '.json'; fs.writeFileSync(f, JSON.stringify(fx)); const r = spawnSync('D:/silverscript-debugger-3ed9733-eprintln/target/release/cli-debugger.exe', ['D:/kanet-tn12/scratch/_nwt_wt_j2_7f1e339b/kasia-console/src/lib/RootClose.sil', '--test-file', f, '--test-name', 'nwt_fixed', '--run'], { maxBuffer: 1 << 26 }); return { status: r.status, out: r.stdout.toString().split('\n')[0].slice(0, 120), err: r.stderr.toString().split('\n').filter((l) => /verification failed|error:/.test(l)).slice(0, 2).join(' | ').slice(0, 160) }; };
    const A = run(mkFx(true), 'A'); const B = run(mkFx(false), 'B');
    console.log('NWT-VM-PROBE upstream VM, real builder tx + real committee sigs, output0 covenant PRESENT  => exit=' + A.status + ' ' + A.out + ' ' + A.err);
    console.log('NWT-VM-PROBE upstream VM, same sigs, output0 covenant STRIPPED (reverse arm)               => exit=' + B.status + ' ' + B.out + ' ' + B.err);
    const d = { version: Number(tx.version), lockTime: BigInt(tx.lockTime), inputs: tx.inputs.map((i) => ({ txid: String(i.previousOutpoint.transactionId), index: Number(i.previousOutpoint.index), sequence: BigInt(i.sequence), spkHex: String(i.utxo.scriptPublicKey.script), amount: BigInt(i.utxo.amount) })), outputs: tx.outputs.map((o) => ({ value: BigInt(o.value), spkHex: String(o.scriptPublicKey.script), covenant: o.covenant ? { auth: Number(o.covenant.authorizingInput), id: String(o.covenant.covenantId) } : null })) };
    const okFinal = sigs.map((sg) => nwtVerify(sg.slice(2, 2 + 128), nwtSighash(d, 0), genesisArtifacts.committeePubkeyHex));
    const d2 = { ...d, outputs: d.outputs.map((o, k) => (k === 0 ? { ...o, covenant: null } : o)) };
    const okStrip = sigs.map((sg) => nwtVerify(sg.slice(2, 2 + 128), nwtSighash(d2, 0), genesisArtifacts.committeePubkeyHex));
    console.log('NWT-VM-PROBE own sighash port: final tx sigs=' + JSON.stringify(okFinal) + ' | covenant-stripped sigs=' + JSON.stringify(okStrip));
    if (A.status !== 0) throw new Error('上游 VM 对修后 builder 真实输出 FAIL: ' + A.out + ' ' + A.err);
    if (B.status === 0) throw new Error('反向臂应失败却通过(签名没有绑定 covenant?)');
  });

`;
s = s.replace(marker, probe + marker);
s = s.replace("import fs from 'node:fs';", "import fs from 'node:fs';\nimport { createRequire } from 'node:module';\nimport { nwtParsePushesImp } from './_nwt_shim.mjs';");
fs.writeFileSync('D:/kanet-tn12/scratch/_nwt_wt_j2_7f1e339b/kasia-console/src/lib/_nwt_vm_probe.mjs', s);
console.log('probe written');
