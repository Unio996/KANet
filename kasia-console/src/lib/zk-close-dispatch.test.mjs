// zk-close-dispatch.test.mjs — regression guard for dispatchUnlockZkClose (J1tn, 缺件③, 2026-07-08).
// Mock ctx (fake kaspaZk/relayCall/getMarket/getDoneJob) — no real zk-sdk WASM, no relay/chain calls.
// Exercises: happy path command assembly (incl. gate_suffix_hex slicing), and every fail-closed guard
// (proving not ready, schema-atomicity violation, missing receipt, relay error, no txId in response).
//
// Run: cd kasia-console && node src/lib/zk-close-dispatch.test.mjs

import { dispatchUnlockZkClose } from './zk-close-dispatch.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };
async function expectFail(name, promise, fragment) {
  const r = await promise;
  ok(r.ok === false && (!fragment || r.error?.includes(fragment)), `${name}: ${r.error}`);
}

const MARKET_ID = 'ext-pool-v07-test-zkclose-dispatch';
const CONT_OUTPOINT = { txid: 'a1b2c3d4'.repeat(8), index: 0 };
const REDEEM_HEX = 'deadbeef'.repeat(50);
const IMAGE_ID = 'c9918501'.repeat(8);
const JOURNAL_HASH = 'e0fd04a7'.repeat(8);
const GATE_ADDR = 'kaspatest:fakegate1234567890';
// simulate a real gate redeemScript: 1B prefix(0x20) + 32B journalHash + 800B suffix template.
const FAKE_SUFFIX = 'ab'.repeat(800);
const FAKE_REDEEM_SCRIPT = '20' + JOURNAL_HASH + FAKE_SUFFIX;
const FAKE_SIG_SCRIPT = 'aa'.repeat(200);

function readyZkContinuation(overrides = {}) {
  return {
    outpoint: CONT_OUTPOINT, redeemHex: REDEEM_HEX, valueSompi: '5111000000',
    attestedWinner: 1, attestedAtMs: 1783413621808,
    proving: {
      status: 'ready', guestPayoutRootHex: '33'.repeat(32), journalHash: JOURNAL_HASH, imageId: IMAGE_ID,
      gate: { address: GATE_ADDR, outpointTxid: 'gatefundtx'.repeat(4), index: 0, fundedAtMs: Date.now() },
      provingError: null,
      ...overrides,
    },
  };
}

function mockCtx({ zkContinuation, doneJob = { receipt_hex: 'cafebabe'.repeat(20) }, relayResult = { txId: 'realtxid123' }, relayThrows = null, kaspaZkThrows = null } = {}) {
  return {
    getMarket: () => ({ metadata: JSON.stringify({ zk_continuation: zkContinuation }) }),
    getDoneJob: () => doneJob,
    kaspaZk: () => {
      if (kaspaZkThrows) throw kaspaZkThrows;
      return {
        ZkScriptBuilder: {
          newR0: () => ({
            commitToGroth16WithFixedJournal: () => {},
            finalizeWithGroth16FixedJournalProof: () => ({ sigScript: FAKE_SIG_SCRIPT, redeemScript: FAKE_REDEEM_SCRIPT }),
          }),
        },
      };
    },
    relayCall: async (cmd) => {
      if (relayThrows) throw relayThrows;
      mockCtx.lastCmd = cmd;   // capture for assembly assertions
      return relayResult;
    },
  };
}

console.log('[test] happy path: correct command assembly, gate_suffix_hex sliced right, txid returned:');
{
  const ctx = mockCtx({ zkContinuation: readyZkContinuation() });
  const r = await dispatchUnlockZkClose({ marketId: MARKET_ID, continuationOutpoint: CONT_OUTPOINT, attestedWinner: 1 }, ctx);
  ok(r.ok && r.txid === 'realtxid123', `dispatch ok, txid=${r.txid}`);
  const cmd = mockCtx.lastCmd;
  ok(cmd.type === 'bshard_zk_close', 'command type=bshard_zk_close');
  ok(cmd.inputs.closezk.redeem_hex === REDEEM_HEX, 'closezk.redeem_hex passthrough');
  ok(cmd.inputs.closezk.outpointTxid === CONT_OUTPOINT.txid && cmd.inputs.closezk.index === 0, 'closezk outpoint correct');
  ok(cmd.inputs.closezk.state.attestedWinner === 1 && cmd.inputs.closezk.state.consolidated_pool === '5111000000', 'closezk.state correct');
  ok(cmd.inputs.gate.address === GATE_ADDR && cmd.inputs.gate.sig_script_hex === FAKE_SIG_SCRIPT, 'gate input correct (address + reconstructed sigScript)');
  ok(cmd.witness.guest_payout_root_hex === '33'.repeat(32), 'witness.guest_payout_root_hex correct');
  ok(cmd.witness.gate_suffix_hex === FAKE_SUFFIX, `gate_suffix_hex correctly sliced (${cmd.witness.gate_suffix_hex.length / 2}B, expected 800B)`);
  ok(cmd.witness.self_out_idx === 0, 'self_out_idx=0');
}

console.log('[test] fail-closed guards:');
{
  await expectFail('proving.status not ready (pending)',
    dispatchUnlockZkClose({ marketId: MARKET_ID, continuationOutpoint: CONT_OUTPOINT, attestedWinner: 1 },
      mockCtx({ zkContinuation: { ...readyZkContinuation(), proving: { status: 'pending' } } })),
    '!= ready');

  await expectFail('proving.status failed',
    dispatchUnlockZkClose({ marketId: MARKET_ID, continuationOutpoint: CONT_OUTPOINT, attestedWinner: 1 },
      mockCtx({ zkContinuation: { ...readyZkContinuation(), proving: { status: 'failed', provingError: 'boom' } } })),
    '!= ready');

  const missingGate = readyZkContinuation(); missingGate.proving.gate = null;
  await expectFail('schema-atomicity violated: status=ready but gate missing',
    dispatchUnlockZkClose({ marketId: MARKET_ID, continuationOutpoint: CONT_OUTPOINT, attestedWinner: 1 }, mockCtx({ zkContinuation: missingGate })),
    'schema 原子性假设被违反');

  await expectFail('zk_continuation missing entirely',
    dispatchUnlockZkClose({ marketId: MARKET_ID, continuationOutpoint: CONT_OUTPOINT, attestedWinner: 1 }, mockCtx({ zkContinuation: undefined })),
    'zk_continuation missing');

  await expectFail('no done job / missing receipt_hex',
    dispatchUnlockZkClose({ marketId: MARKET_ID, continuationOutpoint: CONT_OUTPOINT, attestedWinner: 1 },
      mockCtx({ zkContinuation: readyZkContinuation(), doneJob: null })),
    'receipt_hex missing');

  await expectFail('relay call throws',
    dispatchUnlockZkClose({ marketId: MARKET_ID, continuationOutpoint: CONT_OUTPOINT, attestedWinner: 1 },
      mockCtx({ zkContinuation: readyZkContinuation(), relayThrows: new Error('connection refused') })),
    'relay dispatch fail');

  await expectFail('relay responds without a txId',
    dispatchUnlockZkClose({ marketId: MARKET_ID, continuationOutpoint: CONT_OUTPOINT, attestedWinner: 1 },
      mockCtx({ zkContinuation: readyZkContinuation(), relayResult: { error: 'invalid location' } })),
    '响应无 txId');

  const shortRedeem = readyZkContinuation();
  const badCtx = mockCtx({ zkContinuation: shortRedeem });
  badCtx.kaspaZk = () => ({ ZkScriptBuilder: { newR0: () => ({ commitToGroth16WithFixedJournal: () => {}, finalizeWithGroth16FixedJournalProof: () => ({ sigScript: 'aa', redeemScript: '2000' }) }) } });
  await expectFail('redeemScript too short to contain a gate suffix', dispatchUnlockZkClose({ marketId: MARKET_ID, continuationOutpoint: CONT_OUTPOINT, attestedWinner: 1 }, badCtx), '太短');
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — dispatchUnlockZkClose: command assembly correct, gate witness deterministically reconstructed, all fail-closed guards hold'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
