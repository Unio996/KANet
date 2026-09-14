import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake2b.js');
const b2b = (buf) => blake2b(Uint8Array.from(buf), { dkLen: 32 });
const hex = (a) => '0x' + Buffer.from(a).toString('hex');
const p2sh = (bytecode) => 'aa20' + Buffer.from(b2b(bytecode)).toString('hex') + '87';
const ZERO32 = new Array(32).fill(0);
const SHARD_POOL_ID = new Array(32).fill(0x37);

// Reuse PoolSideStub2 (already derived+compiled for ShardLeaf's own smoke test, same Tk shape/values).
const stub = JSON.parse(fs.readFileSync('D:/kanet-tn12/scratch/_j2_wt_t3_market/scratch/_t1v06_check/PoolSideStub2.compiled.json', 'utf8'));
const stubC = Object.values(stub.contracts)[0].compiled;
const stubBc = stubC.bytecode;
const stubPrefix = stubBc.slice(0, stubC.state_span.offset);
const stubSuffix = stubBc.slice(stubC.state_span.offset + stubC.state_span.len);
const ticketScriptHex = '0x' + p2sh(stubBc);

const ctorArgs = [
  hex(ZERO32),              // market_id
  hex(ZERO32),              // ps_tmpl_hash (unused by convert_to_rootclose; only register_append reads it -- but harness needs a real value for register_append test, see below)
  hex(SHARD_POOL_ID),       // shard_pool_id
  1,                         // seal_count (DoD single-shard)
  1,                         // min_bet
  hex(ZERO32),              // rootclose_tmpl_hash (filled per-test below with the real RootClose template hash)
  hex(ZERO32),              // rootclose_init_payoutRoot
  0, 0, 0, 0,                // init_local_yes/no/count/pool_value
];

const BETTOR_PK = new Array(32).fill(0x22);

const tests = [];

// register_append (byte-identical to ShardLeaf) -- reuse the exact matched ticket template.
const ctorForRegister = [...ctorArgs];
ctorForRegister[1] = '0x' + Buffer.from(stubC.template_hash).toString('hex'); // ps_tmpl_hash = real PoolSideStub2 template hash
tests.push({
  name: 'SMOKE-register_append_pass',
  function: 'register_append',
  constructor_args: ctorForRegister,
  args: [0, 50, 0, 1, hex(BETTOR_PK), hex(stubPrefix), hex(stubSuffix)],
  expect: 'pass',
  tx: {
    active_input_index: 0,
    inputs: [{ utxo_value: 1, covenant_id: hex(new Array(32).fill(0xbb)), state: { local_yes: 0, local_no: 0, count: 0, pool_value: 0 } }],
    outputs: [
      { value: 50, covenant_id: hex(new Array(32).fill(0xbb)), state: { local_yes: 50, local_no: 0, count: 1, pool_value: 50 } },
      { value: 1, script_hex: ticketScriptHex },
    ],
  },
});

// convert_to_rootclose: compile a matching RootClose genesis instance (7 fields: local_yes=100,local_no=0,
// count=1,pool_value=100,closed=0,winningSide=0,payoutRoot=ZERO32) to get its real prefix/suffix/template_hash/P2SH.
fs.writeFileSync('scratch/_t1v06_check/RootCloseTarget.ctor.json', JSON.stringify([
  { kind: 'bytes', value: new Array(32).fill(0) },   // committee_hash (unused fields for genesis shape only)
  { kind: 'int', value: 1700000000000 },              // deadline_ms
  { kind: 'bytes', value: new Array(32).fill(0) },   // claim_tmpl_hash
  { kind: 'bytes', value: new Array(32).fill(0) },   // refundclaim_tmpl_hash
  { kind: 'int', value: 100 }, { kind: 'int', value: 0 }, { kind: 'int', value: 1 }, { kind: 'int', value: 100 },
  { kind: 'int', value: 0 }, { kind: 'int', value: 0 }, { kind: 'bytes', value: new Array(32).fill(0) },
], null, 1));

export const rootCloseCtorPath = 'scratch/_t1v06_check/RootCloseTarget.ctor.json';

fs.writeFileSync('scratch/_t1v06_check/ShardLeaf_direct.smoke.tests_partial.json', JSON.stringify(tests, null, 1));
console.log('wrote partial (register_append only); convert_to_rootclose assembled by shell after compiling RootCloseTarget');
