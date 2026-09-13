import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake2b.js');
const b2b = (buf) => blake2b(Uint8Array.from(buf), { dkLen: 32 });
const hex = (a) => '0x' + Buffer.from(a).toString('hex');
const ZERO32 = new Array(32).fill(0);
const DEADLINE_MS = 1700000000000;

const c0 = new Array(32).fill(0x01), c1 = new Array(32).fill(0x02), c2 = new Array(32).fill(0x03), c3 = new Array(32).fill(0x04), c4 = new Array(32).fill(0x05);
const committeeHash = [...b2b([...c0, ...c1, ...c2, ...c3, ...c4])];

const ctorBase = [
  hex(committeeHash), DEADLINE_MS, hex(ZERO32), hex(ZERO32),
  0, 0, 0, 100, 0, 0, hex(ZERO32),
];

const tests = [];

// close_commit smoke: no real sigs (checkSig will fail -> validSigs<4 -> require fails) -- this is a NEGATIVE
// smoke (expect fail) since constructing 4 valid signatures is out of scope for a pure-migration smoke check;
// it still proves the entry parses/type-checks/executes up to the sig-count require.
tests.push({
  name: 'SMOKE-close_commit_fail_no_valid_sigs',
  function: 'close_commit',
  constructor_args: ctorBase,
  args: [hex(c0), hex(c1), hex(c2), hex(c3), hex(c4), '', '', '', '', '', 0, 0, hex(ZERO32)],
  expect: 'fail',
  tx: {
    active_input_index: 0,
    inputs: [{ utxo_value: 100, covenant_id: hex(new Array(32).fill(0xaa)), state: { local_yes: 0, local_no: 0, count: 0, pool_value: 100, closed: 0, winningSide: 0, payoutRoot: hex(ZERO32) } }],
    outputs: [{ value: 100, covenant_id: hex(new Array(32).fill(0xaa)), state: { local_yes: 0, local_no: 0, count: 0, pool_value: 100, closed: 1, winningSide: 0, payoutRoot: hex(ZERO32) } }],
  },
});

// refund_flip smoke: pass -- pure state-flip entry, tx.time set past deadline+grace, no sigs needed.
tests.push({
  name: 'SMOKE-refund_flip_pass',
  function: 'refund_flip',
  constructor_args: ctorBase,
  args: [0],
  expect: 'pass',
  tx: {
    active_input_index: 0,
    lock_time: DEADLINE_MS + 7200000 + 1,
    inputs: [{ utxo_value: 100, covenant_id: hex(new Array(32).fill(0xaa)), state: { local_yes: 0, local_no: 0, count: 0, pool_value: 100, closed: 0, winningSide: 0, payoutRoot: hex(ZERO32) } }],
    outputs: [{ value: 100, covenant_id: hex(new Array(32).fill(0xaa)), state: { local_yes: 0, local_no: 0, count: 0, pool_value: 100, closed: 2, winningSide: 0, payoutRoot: hex(ZERO32) } }],
  },
});
// negative counterpart: before deadline+grace -> must fail
tests.push({
  name: 'SMOKE-refund_flip_fail_before_deadline_grace',
  function: 'refund_flip',
  constructor_args: ctorBase,
  args: [0],
  expect: 'fail',
  tx: {
    active_input_index: 0,
    lock_time: DEADLINE_MS,
    inputs: [{ utxo_value: 100, covenant_id: hex(new Array(32).fill(0xaa)), state: { local_yes: 0, local_no: 0, count: 0, pool_value: 100, closed: 0, winningSide: 0, payoutRoot: hex(ZERO32) } }],
    outputs: [{ value: 100, covenant_id: hex(new Array(32).fill(0xaa)), state: { local_yes: 0, local_no: 0, count: 0, pool_value: 100, closed: 2, winningSide: 0, payoutRoot: hex(ZERO32) } }],
  },
});

fs.writeFileSync('scratch/_t1v06_check/RootClose.smoke.test.json', JSON.stringify({ tests }, null, 1));
console.log('wrote', tests.length);
