import fs from 'node:fs';
const hex = (a) => '0x' + Buffer.from(a).toString('hex');
const ZERO32 = new Array(32).fill(0);
const PAYOUT_COV = new Array(32).fill(0xaa);

// Reuse PoolSideStub artifacts already derived+compiled in the draw-down provenance dir.
const stub = JSON.parse(fs.readFileSync('D:/kanet-tn12/scratch/_j2_wt_t3_market/docs/provenance/2026-09-14-j2-t3-v03-drawdown-mustfix/PoolSideStub.compiled.json', 'utf8'));
const c = Object.values(stub.contracts)[0].compiled;
const bytecode = c.bytecode;
const { offset, len } = c.state_span;
const prefix = bytecode.slice(0, offset);
const suffix = bytecode.slice(offset + len);
const templateHash = c.template_hash;

const ctorArgs = [
  hex(ZERO32),               // market_id
  hex(templateHash),         // ps_tmpl_hash (real PoolSideStub template hash, reused as the dust-ticket template)
  hex(new Array(32).fill(0x37)), // shard_pool_id
  10,                         // seal_count
  1,                          // min_bet
  hex(PAYOUT_COV),            // payout_cov_id
  1700000000,                 // deadline (seconds)
  0, 0, 0, 0,                 // init_local_yes/no/count/pool_value
];

const BETTOR_PK = new Array(32).fill(0x22);

const tests = [];

// register_append pass: side=0 (yes), stake=50, leaf continues with local_yes+=50, count+1, pool_value+=50;
// ticket output must validateOutputStateWithTemplate as Tk{bettorPk,direction:0,stake:50,shardPoolId}.
tests.push({
  name: 'SMOKE-register_append_pass',
  function: 'register_append',
  constructor_args: ctorArgs,
  args: [0, 50, 0, 1, hex(BETTOR_PK), hex(prefix), hex(suffix)],
  expect: 'pass',
  tx: {
    active_input_index: 0,
    inputs: [{ utxo_value: 1, covenant_id: hex(new Array(32).fill(0xbb)), state: { local_yes: 0, local_no: 0, count: 0, pool_value: 0 } }],
    outputs: [
      { value: 50, covenant_id: hex(new Array(32).fill(0xbb)), state: { local_yes: 50, local_no: 0, count: 1, pool_value: 50 } },
      { value: 1, covenant_id: hex(new Array(32).fill(0x37)) /* unused by this check, ticket goes via template match */,
        state: { bettorPk: hex(BETTOR_PK), direction: 0, stake: 50, shardPoolId: hex(new Array(32).fill(0x37)) } },
    ],
  },
});

// consolidate_to_payout pass: sealed (count==seal_count=10), ps input carries payout_cov_id, output continues same cov.
tests.push({
  name: 'SMOKE-consolidate_to_payout_pass_sealed',
  function: 'consolidate_to_payout',
  constructor_args: [
    hex(ZERO32), hex(templateHash), hex(new Array(32).fill(0x37)), 10, 1, hex(PAYOUT_COV), 1700000000,
    0, 0, 10, 300,   // init_count == seal_count(10), init_pool_value=300 (self's own leaf state as active input)
  ],
  args: [1, 1],
  expect: 'pass',
  tx: {
    active_input_index: 0,
    lock_time: 1700000000000,
    inputs: [
      { utxo_value: 1, covenant_id: hex(new Array(32).fill(0xbb)), state: { local_yes: 300, local_no: 0, count: 10, pool_value: 300 } },
      { utxo_value: 500, covenant_id: hex(PAYOUT_COV), signature_script_hex: '0x00' + 'ff'.repeat(20) },
    ],
    outputs: [
      { value: 1, covenant_id: hex(new Array(32).fill(0xbb)) },   // dummy output 0 (unused by this entry)
      { value: 800, covenant_id: hex(PAYOUT_COV), authorizing_input: 1 },   // psOutIdx=2? fix index below
    ],
  },
});

fs.writeFileSync('scratch/_t1v06_check/ShardLeaf.smoke.test.json', JSON.stringify({ tests }, null, 1));
console.log('wrote', tests.length);
