import { buildMerkle, proveMerkle, root, hex, le8 } from './merkle.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake2b.js');
const b2b = (buf) => blake2b(Uint8Array.from(buf), { dkLen: 32 });
const p2sh = (bytecode) => '0xaa20' + Buffer.from(b2b(bytecode)).toString('hex') + '87';

const compiled = JSON.parse(fs.readFileSync('scratch/_t1v06_check/PoolSideStub.compiled.json', 'utf8'));
const c = Object.values(compiled.contracts)[0].compiled;
const bytecode = c.bytecode;
const { offset, len } = c.state_span;
const prefix = bytecode.slice(0, offset);
const suffix = bytecode.slice(offset + len);
const templateHash = c.template_hash;
const fullBytecodeHex = '0x' + Buffer.from(bytecode).toString('hex');
const utxoScriptHex = p2sh(bytecode);

const BETTOR_PK = new Array(32).fill(0x22);
const SHARD_POOL_ID = new Array(32).fill(0x37);
const OWN_COV = new Array(32).fill(0xaa);
const ZERO32 = new Array(32).fill(0);
const MERKLE_INDEX = 0;   // depth-1 cap (0 or 1)
const TREE_DEPTH = 1;

function leafFor(pk, payout) { return [...b2b([...pk, ...le8(payout)])]; }
function buildRootFor(payout, idx) {
  const leaves = {}; leaves[idx] = leafFor(BETTOR_PK, payout);
  const levels = buildMerkle(TREE_DEPTH, leaves);
  const siblings = proveMerkle(levels, idx, TREE_DEPTH);
  return { payoutRoot: root(levels, TREE_DEPTH), siblings };
}

function ctorRC({ pool_value, closed, payoutRoot, claimed_bitmap }) {
  return [
    '0x' + Buffer.from(templateHash).toString('hex'),   // ps_tmpl_hash -- real PoolSideStub template hash
    hex(SHARD_POOL_ID),   // shard_pool_id
    0, 0, 0,              // init_local_yes/no/count
    pool_value, closed, 1 /* winningSide */, hex(payoutRoot), claimed_bitmap,
  ];
}

function mkVector(name, { pool_value, payout, expect, selfOutPresent, selfOutValue, claimed_bitmap = 0, breakTicketOwner = false, breakDirection = false }) {
  const { payoutRoot, siblings } = buildRootFor(payout, MERKLE_INDEX);
  const outputs = [ { value: payout, p2pk_pubkey: '0x' + Buffer.from(BETTOR_PK).toString('hex') } ];
  if (selfOutPresent) {
    outputs.push({
      value: selfOutValue, covenant_id: hex(OWN_COV),
      state: { local_yes: 0, local_no: 0, count: 0, pool_value: pool_value - payout, closed: 1, winningSide: 1,
        payoutRoot: hex(payoutRoot), claimed_bitmap: claimed_bitmap + 1 },
    });
  }
  return {
    name, function: 'claim_draw',
    constructor_args: ctorRC({ pool_value, closed: 1, payoutRoot, claimed_bitmap }),
    args: [
      selfOutPresent ? 1 : 0,   // rootOutIdx (unused in exact branch but must be a valid arg)
      0,                         // payoutOutIdx
      payout, MERKLE_INDEX, TREE_DEPTH, siblings.map(hex),
      2,                         // ticketInIdx
      prefix.length, suffix.length,
    ],
    expect,
    tx: {
      active_input_index: 0,
      inputs: [
        { utxo_value: pool_value, covenant_id: hex(OWN_COV) },
        { utxo_value: 1 },
        { utxo_value: 10, utxo_script_hex: utxoScriptHex, signature_script_hex: fullBytecodeHex },
      ],
      outputs,
    },
  };
}

const vectors = [
  mkVector('DD-RC-claim_draw-1_pass_exact_no_continuation', { pool_value: 5000, payout: 5000, expect: 'pass', selfOutPresent: false }),
  mkVector('DD-RC-claim_draw-2_pass_partial_with_continuation', { pool_value: 5000, payout: 2000, expect: 'pass', selfOutPresent: true, selfOutValue: 3000 }),
  mkVector('DD-RC-claim_draw-3_fail_partial_continuation_wrong_amount', { pool_value: 5000, payout: 2000, expect: 'fail', selfOutPresent: true, selfOutValue: 3001 }),
  mkVector('DD-RC-claim_draw-4_fail_partial_missing_continuation', { pool_value: 5000, payout: 2000, expect: 'fail', selfOutPresent: false }),
];

fs.writeFileSync('scratch/_t1v06_check/RootClaim.drawdown.test.json', JSON.stringify({ tests: vectors }, null, 1));
console.log('prefix_len', prefix.length, 'suffix_len', suffix.length, 'template_hash', '0x'+Buffer.from(templateHash).toString('hex'));
console.log('wrote', vectors.length, 'vectors');
