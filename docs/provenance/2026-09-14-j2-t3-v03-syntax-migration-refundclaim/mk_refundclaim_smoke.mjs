// RefundClaim.sil §7 纯语法迁移(entrypoint function→entry, 裸struct→State{}, P2PK byte[34]→byte[36]) smoke 向量。
// 无既有 test.json(该文件此前从未有过向量证据)——补 3 条烟雾向量证"编译通过 + 零业务逻辑改动"标准兑现。
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
  const ctorPath = `scratch/_t1v06_check/RC_ticket_${tag}.ctor.json`;
  const outPath = `scratch/_t1v06_check/RC_ticket_${tag}.compiled.json`;
  fs.writeFileSync(ctorPath, JSON.stringify(ctor, null, 1));
  execSync(`"${SILVERC}" "${STUB}" --ctor "${ctorPath}" -o "${outPath}"`, { cwd: CWD });
  const compiled = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const c = Object.values(compiled.contracts)[0].compiled;
  const bc = c.bytecode;
  const { offset, len } = c.state_span;
  return { prefix: bc.slice(0, offset), suffix: bc.slice(offset + len), templateHash: c.template_hash, bc, scriptHex: '0x' + p2sh(bc), fullBytecodeHex: '0x' + Buffer.from(bc).toString('hex') };
}

const ticket60 = compileTicket(BETTOR_PK, 0, 60, SHARD_POOL_ID, 'stake60');

function ctorArgs({ pool_value = 100, closed = 2, psTmplHash = ticket60.templateHash }) {
  return [hex(psTmplHash), hex(SHARD_POOL_ID), 0, 0, 0, pool_value, closed, 0, hex(ZERO32)];
}
function ticketInput(t) { return { utxo_value: 1, utxo_script_hex: t.scriptHex, signature_script_hex: t.fullBytecodeHex }; }
function selfInput(pool_value) { return { utxo_value: 1, covenant_id: hex(RC_COV), state: { local_yes: 0, local_no: 0, count: 0, pool_value, closed: 2, winningSide: 0, payoutRoot: ZERO32 } }; }

const tests = [];

// SMOKE-1: pass -- existing (pre-drawdown-fix) unconditional-continuation shape: pool 100, refund stake 60,
// continuation pool_value=40, matching state 一字不动的迁移标准.
tests.push({
  name: 'SMOKE-refund_payout_pass_partial_drawdown',
  function: 'refund_payout',
  constructor_args: ctorArgs({ pool_value: 100 }),
  args: [0, 1, 2, ticket60.prefix.length, ticket60.suffix.length],
  expect: 'pass',
  tx: {
    active_input_index: 0,
    inputs: [selfInput(100), { utxo_value: 1, covenant_id: hex(RC_COV), signature_script_hex: '0x00ff' }, ticketInput(ticket60)],
    outputs: [
      { value: 40, covenant_id: hex(RC_COV), state: { local_yes: 0, local_no: 0, count: 0, pool_value: 40, closed: 2, winningSide: 0, payoutRoot: ZERO32 } },
      { value: 60, p2pk_pubkey: hex(BETTOR_PK) },
    ],
  },
});
// SMOKE-2: fail -- closed != 2 (仅 cancelled 可 refund) 结构性拒绝.
tests.push({
  name: 'SMOKE-refund_payout_fail_not_cancelled',
  function: 'refund_payout',
  constructor_args: ctorArgs({ pool_value: 100, closed: 0 }),
  args: [0, 1, 2, ticket60.prefix.length, ticket60.suffix.length],
  expect: 'fail',
  tx: {
    active_input_index: 0,
    inputs: [selfInput(100), { utxo_value: 1, covenant_id: hex(RC_COV), signature_script_hex: '0x00ff' }, ticketInput(ticket60)],
    outputs: [
      { value: 1000, covenant_id: hex(RC_COV), state: { local_yes: 0, local_no: 0, count: 0, pool_value: 40, closed: 0, winningSide: 0, payoutRoot: ZERO32 } },
      { value: 60, p2pk_pubkey: hex(BETTOR_PK) },
    ],
  },
});
// SMOKE-3: fail -- 票不属本 pool (shardPoolId 不匹配).
const otherPool = new Array(32).fill(0x55);
const ticketOtherPool = compileTicket(BETTOR_PK, 0, 60, otherPool, 'other_pool');
tests.push({
  name: 'SMOKE-refund_payout_fail_ticket_wrong_pool',
  function: 'refund_payout',
  constructor_args: ctorArgs({ pool_value: 100 }),
  args: [0, 1, 2, ticketOtherPool.prefix.length, ticketOtherPool.suffix.length],
  expect: 'fail',
  tx: {
    active_input_index: 0,
    inputs: [selfInput(100), { utxo_value: 1, covenant_id: hex(RC_COV), signature_script_hex: '0x00ff' }, ticketInput(ticketOtherPool)],
    outputs: [
      { value: 40, covenant_id: hex(RC_COV), state: { local_yes: 0, local_no: 0, count: 0, pool_value: 40, closed: 2, winningSide: 0, payoutRoot: ZERO32 } },
      { value: 60, p2pk_pubkey: hex(BETTOR_PK) },
    ],
  },
});

fs.writeFileSync('scratch/_t1v06_check/RefundClaim.smoke.test.json', JSON.stringify({ tests }, null, 1));
console.log('wrote', tests.length, 'smoke vectors');
