// NWT: build a scratch copy of the E commit's proto-tx-assembly-settlement.test.mjs with ONE extra probe block (identity binding of chainParents).
// Run from kasia-console/. Writes src/lib/_nwt_e_probe.test.mjs (untracked; deleted by the caller afterwards).
const fs = require('fs');
const src = fs.readFileSync('src/lib/proto-tx-assembly-settlement.test.mjs', 'utf8');
const anchor = '  // ══════════ ⑤ close_commit 修复回归';
if (src.split(anchor).length !== 2) throw new Error('anchor not unique');
const probe = `
  { const { goodChainParents } = await import('./proto-chain-parents-fixtures.mjs');
    const { ChainParentsError } = await import('./proto-tx-assembly-settlement.mjs');
    const cpA = goodChainParents('close_commit', closeCommitFeeUtxo);           // facts "verified" for outpoint A (value + spk length + hasCovenant=false)
    const feeB = { ...closeCommitFeeUtxo, txid: 'ee'.repeat(32), vout: 9 };      // a DIFFERENT outpoint, same value / spk
    t('NWT-E1 probe: chainParents attests outpoint A, builder is handed outpoint B (same value/spk length) -> ACCEPTED?', () => {
      const b = buildCloseCommitTxJson(closeArgs({ feeUtxo: feeB, chainParents: cpA }));
      const spent = JSON.stringify(b, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
      console.log('   PROBE-RESULT: builder ACCEPTED; fee outpoint B present in built tx=' + spent.includes('ee'.repeat(32)) + '; outpoint A present=' + spent.includes(String(closeCommitFeeUtxo.txid)));
    });
    t('NWT-E1 control: same probe with value+1 on B -> must be rejected by the assertion (proves the assertion is live)', () => {
      let e = null; try { buildCloseCommitTxJson(closeArgs({ feeUtxo: { ...feeB, value: feeB.value + 1n }, chainParents: cpA })); } catch (x) { e = x; }
      if (!(e instanceof ChainParentsError)) throw new Error('expected ChainParentsError, got ' + (e && e.message));
      console.log('   PROBE-CONTROL: rejected with code=' + e.code + ' role=' + e.role);
    });
  }
`;
fs.writeFileSync('src/lib/_nwt_e_probe.test.mjs', src.replace(anchor, probe + anchor));
console.log('probe file written');
