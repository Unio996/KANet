// RefundClaim.refund_payout draw-down MUST-FIX 向量(第五处同 class, 见 PayoutShard.claim/refund_claim,
// PayoutShardV2.refund_claim, RootClaim.claim_draw 已修四处; 同 4-向量形状: exact-no-continuation pass /
// partial-with-continuation pass / partial-continuation-wrong-amount fail / partial-missing-continuation fail)。
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake2b.js');
const b2b = (buf) => blake2b(Uint8Array.from(buf), { dkLen: 32 });
const hex = (a) => '0x' + Buffer.from(a).toString('hex');
const p2sh = (bytecode) => 'aa20' + Buffer.from(b2b(bytecode)).toString('hex') + '87';
const SILVERC = 'D:/kanet-tn12/scratch/_j2_silverc_v100/target/release/silverc.exe';
const STUB = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/docs/provenance/2026-09-14-j2-t3-v03-drawdown-mustfix/PoolSideStub.sil';
const CWD = 'D:/kanet-tn12/scratch/_j2_wt_t3_market';

const ZERO32 = new Array(32).fill(0);
const BETTOR_PK = new Array(32).fill(0x22);
const SHARD_POOL_ID = new Array(32).fill(0x37);
const RC_COV = new Array(32).fill(0xcc);

function compileTicket(bettorPk, direction, stake, shardPoolId, tag) {
  const ctor = [
    { kind: 'bytes', value: bettorPk }, { kind: 'int', value: direction },
    { kind: 'int', value: stake }, { kind: 'bytes', value: shardPoolId },
  ];
  const ctorPath = `scratch/_t1v06_check/RCDD_ticket_${tag}.ctor.json`;
  const outPath = `scratch/_t1v06_check/RCDD_ticket_${tag}.compiled.json`;
  fs.writeFileSync(ctorPath, JSON.stringify(ctor, null, 1));
  execSync(`"${SILVERC}" "${STUB}" --ctor "${ctorPath}" -o "${outPath}"`, { cwd: CWD });
  const compiled = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const c = Object.values(compiled.contracts)[0].compiled;
  const bc = c.bytecode;
  const { offset, len } = c.state_span;
  return { prefix: bc.slice(0, offset), suffix: bc.slice(offset + len), templateHash: c.template_hash, bc, scriptHex: '0x' + p2sh(bc), fullBytecodeHex: '0x' + Buffer.from(bc).toString('hex') };
}

function ctorArgs({ pool_value, closed = 2, psTmplHash }) {
  return [hex(psTmplHash), hex(SHARD_POOL_ID), 0, 0, 0, pool_value, closed, 0, hex(ZERO32)];
}
function ticketInput(t) { return { utxo_value: 1, utxo_script_hex: t.scriptHex, signature_script_hex: t.fullBytecodeHex }; }
function selfInput(pool_value) { return { utxo_value: 1, covenant_id: hex(RC_COV), state: contState(pool_value) }; }
function fillerInput() { return { utxo_value: 1, covenant_id: hex(RC_COV), signature_script_hex: '0x00ff' }; }
function contState(pool_value) { return { local_yes: 0, local_no: 0, count: 0, pool_value, closed: 2, winningSide: 0, payoutRoot: ZERO32 }; }

function mkVector(name, { pool_value, stake, expect, selfOutPresent, selfOutValue, ticketTag }) {
  const ticket = compileTicket(BETTOR_PK, 0, stake, SHARD_POOL_ID, ticketTag);
  const outputs = [{ value: stake, p2pk_pubkey: hex(BETTOR_PK) }];
  // Mirrors the established DD-PS-*/DD-PSV2-* precedent exactly: when selfOutPresent is false, `outputs`
  // stays length-1 (no second output at all) -- rootOutIdx=1 then indexes out of bounds, which is itself the
  // proof for both the "exact, no continuation needed" pass case (the `if` branch never touches rootOutIdx,
  // so an absent slot 1 is harmless) and the "missing continuation" fail case (the `else` branch DOES need
  // slot 1 and finds nothing there).
  if (selfOutPresent) {
    outputs.push({ value: selfOutValue, covenant_id: hex(RC_COV), state: contState(pool_value - stake) });
  }
  return {
    name, function: 'refund_payout',
    constructor_args: ctorArgs({ pool_value, psTmplHash: ticket.templateHash }),
    args: [1, 0, 2, ticket.prefix.length, ticket.suffix.length],
    expect,
    tx: { active_input_index: 0, inputs: [selfInput(pool_value), fillerInput(), ticketInput(ticket)], outputs },
  };
}

const tests = [
  mkVector('DD-RC-refund-1_pass_exact_no_continuation', { pool_value: 80, stake: 80, expect: 'pass', selfOutPresent: false, ticketTag: 'exact80' }),
  mkVector('DD-RC-refund-2_pass_partial_with_continuation', { pool_value: 80, stake: 30, expect: 'pass', selfOutPresent: true, selfOutValue: 50, ticketTag: 'partial30' }),
  mkVector('DD-RC-refund-3_fail_partial_continuation_wrong_amount', { pool_value: 80, stake: 30, expect: 'fail', selfOutPresent: true, selfOutValue: 49, ticketTag: 'partial30wrong' }),
  mkVector('DD-RC-refund-4_fail_partial_missing_continuation', { pool_value: 80, stake: 30, expect: 'fail', selfOutPresent: false, ticketTag: 'partial30missing' }),
];

fs.writeFileSync('scratch/_t1v06_check/RefundClaim.drawdown.test.json', JSON.stringify({ tests }, null, 1));
console.log('wrote', tests.length, 'vectors');
