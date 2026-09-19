// NWT 批9-1 F2(34bd831a) 独立验证: 4 个 builder × 12 个输入角色, 在【真实 builder 整链】上验证
//   (i)  WIRING: used[role].outpoint 与【构造出的交易里该输入位置的 previousOutpoint】是同一个(接线错位只会让"对照臂成功"照样绿, 所以要看交易本身);
//   (ii) 证据 A、实花 B(同面值同 spk, 只换 outpoint) ⇒ ChainParentsError 且 .role == 该角色;
//   (iii) 对照臂: chainParents 也按 B ⇒ 构造成功, 且【交易里该输入 == B】。
// 在 kasia-console/ 下跑; 生成 src/lib/_nwt_f2_probe.test.mjs = proto-claim-draw.test.mjs + 一个探针块(未跟踪, 用完删除)。
const fs = require('fs');
const src = fs.readFileSync('src/lib/proto-claim-draw.test.mjs', 'utf8');
const anchor = "let built;\nt('①claim_draw buildClaimDrawTxJson 真实构造成功";
if (src.split(anchor).length !== 2) throw new Error('anchor not unique');
const probe = `
{ // ═══ NWT-F2 probe ═══
  const { goodChainParents } = await import('./proto-chain-parents-fixtures.mjs');
  const { ChainParentsError } = await import('./proto-tx-assembly-settlement.mjs');
  const STEPS = [
    ['seal', sealArgs, buildMarketSealTxJson, { leaf: ['leafOutpoint', 0], held: ['heldInput', 1], fee: ['feeUtxo', 2] }],
    ['close_commit', closeCommitArgs, buildCloseCommitTxJson, { rootClose: ['rootCloseOutpoint', 0], fee: ['feeUtxo', 1] }],
    ['convert_to_claim', convertArgs, buildConvertToClaimTxJson, { rootClose: ['rootCloseOutpoint', 0], held: ['heldTokenOutpoint', 1], fee: ['feeUtxo', 2] }],
    ['claim_draw', args, buildClaimDrawTxJson, { rootClaim: ['rootClaimOutpoint', 0], ticket: ['ticketOutpoint', 1], held: ['heldTokenOutpoint', 2], fee: ['feeUtxo', 3] }],
  ];
  const inputsOf = (b) => { const tx = kaspa.Transaction.deserializeFromSafeJSON(b.txJson); const r = tx.inputs.map((i) => String(i.previousOutpoint.transactionId).toLowerCase() + ':' + Number(i.previousOutpoint.index)); tx.free(); return r; };
  const opStr = (o) => String(o.txid).toLowerCase() + ':' + Number(o.vout);
  let n = 0, wiringOk = 0, rejectOk = 0, controlOk = 0, controlOther = 0;
  for (const [step, argsFn, build, roleMap] of STEPS) {
    for (const [role, [field, idx]] of Object.entries(roleMap)) {
      n++;
      const base = argsFn(); const cpA = goodChainParents(step, base);
      const B = { txid: ('e' + String(n).padStart(2, '0')).padEnd(64, 'b'), vout: 7 };
      const swapped = (base[field] && base[field].scriptPublicKeyHex !== undefined) ? { ...base[field], txid: B.txid, vout: B.vout } : { txid: B.txid, vout: B.vout };
      t('NWT-F2 ' + step + '/' + role + ' (i) WIRING: the built tx spends the declared outpoint at input ' + idx, () => {
        const ins = inputsOf(build(base)); if (ins[idx] !== opStr(base[field])) throw new Error('input[' + idx + ']=' + ins[idx] + ' != declared ' + opStr(base[field])); wiringOk++;
      });
      t('NWT-F2 ' + step + '/' + role + ' (ii) evidence for A, spending B => ChainParentsError role=' + role, () => {
        let e = null; try { build(argsFn({ [field]: swapped, chainParents: cpA })); } catch (x) { e = x; }
        if (!(e instanceof ChainParentsError)) throw new Error('expected ChainParentsError, got ' + (e && e.constructor && e.constructor.name) + ': ' + (e && e.message).slice(0, 120));
        if (e.role !== role) throw new Error('role ' + e.role + ' != ' + role); rejectOk++;
      });
      t('NWT-F2 ' + step + '/' + role + ' (iii) control: evidence recomputed for B => builds, and the tx input == B', () => {
        let b; try { b = build(argsFn({ [field]: swapped })); } catch (x) { if (x instanceof ChainParentsError) throw x; controlOther++; console.log('   (control arm rejected by a PRE-EXISTING check, not by F2: ' + String(x.message).slice(0, 90) + ')'); return; }
        const ins = inputsOf(b); if (ins[idx] !== B.txid + ':' + B.vout) throw new Error('control built but input[' + idx + ']=' + ins[idx] + ' != B'); controlOk++;
      });
    }
  }
  t('NWT-F2 SUMMARY roles=' + n + ' wiringOk=' + wiringOk + ' rejectOk=' + rejectOk + ' controlOk=' + controlOk + ' controlRejectedByPreexistingCheck=' + controlOther, () => { if (n !== 12 || wiringOk !== 12 || rejectOk !== 12) throw new Error('summary mismatch'); console.log('   SUMMARY roles=' + n + ' wiringOk=' + wiringOk + ' rejectOk=' + rejectOk + ' controlOk=' + controlOk + ' controlRejectedByPreexistingCheck=' + controlOther); });
}
`;
fs.writeFileSync('src/lib/_nwt_f2_probe.test.mjs', src.replace(anchor, probe + anchor));
console.log('probe file written');
