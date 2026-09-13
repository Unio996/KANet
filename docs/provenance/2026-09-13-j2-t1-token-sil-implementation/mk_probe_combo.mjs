import fs from 'node:fs';
const claim = JSON.parse(fs.readFileSync('claim_stub2.derived.json', 'utf8')).M;
const ctorArgs = JSON.parse(fs.readFileSync('ProbeBoutCombo.args.json', 'utf8')).map(a => a.value !== undefined && Array.isArray(a.value) ? '0x' + Buffer.from(a.value).toString('hex') : a.value);
const cid = '0x' + claim.spk.slice(4, 4 + 64);
const tests = [{
  name: 'combo_pass',
  function: 'check',
  constructor_args: ctorArgs,
  args: [0, { winner_pk: '0x' + '77'.repeat(32), amount: 500 }, cid],
  expect: 'pass',
  tx: {
    active_input_index: 0,
    inputs: [
      { utxo_value: 1, covenant_id: '0x' + '00'.repeat(32) },
      { utxo_value: 1, covenant_id: cid },
    ],
    outputs: [
      { value: 1, covenant_id: cid, authorizing_input: 1, script_hex: claim.spk },
    ],
  },
}];
fs.writeFileSync('ProbeBoutCombo.test.json', JSON.stringify({ tests }, null, 2));
console.log('cid', cid);
