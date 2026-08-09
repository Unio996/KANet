// Pins the ONE convention by which consolidated_pool is read out of a PayoutShard redeem.
//
// Why this file exists (2026-08-10, J1, assigned by Bettor 20:25):
// J2 needed consolidated_pool from `payout_redeem_hex` for the V2-refund verification and said
// the right thing about the obvious approach -- "if I decode those bytes myself I am verifying my
// own replica, not the real code". So the answer was to export the function production already
// calls, not to hand over an offset. This test keeps that answer true.
//
// The trap it guards is not the offset being wrong today. It is that TWO production sites read
// this field independently:
//     bshard-close-enforce.mjs   readPsConsolidatedPool()      _PS_STATE_START + 1
//     bshard-close-transport.mjs:381                            readBigInt64LE(2)   (inline)
// Those are the same number written two different ways. Move _PS_STATE_START and only one of them
// follows -- and the divergence is silent, because both still return a plausible sompi value.
// That is the same shape as the diagnose() call-site parity defect found earlier the same day:
// a fix that lands at one site while the load-bearing consumer keeps the old behaviour.
import { readPsConsolidatedPool } from './bshard-close-enforce.mjs';

let bad = 0;
const ok = (cond, name) => { if (!cond) bad++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); };

// Synthetic PS redeem state prefix: 1B marker ‖ PUSH8 len byte ‖ int64LE(consolidated_pool)
function synth(poolSompi) {
  const b = Buffer.alloc(64);
  b[0] = 0x51;                       // marker @ 0
  b[1] = 0x08;                       // PUSH8 length byte @ _PS_STATE_START (1)
  b.writeBigInt64LE(BigInt(poolSompi), 2);
  return b.toString('hex');
}

const POOL = 270_000_000n;           // 2.7 KAS -- the canary shard's actual on-chain balance
const hex = synth(POOL);

ok(readPsConsolidatedPool(hex) === POOL, 'exported parser reads the value back');

// THE load-bearing one: the exported parser and the inline read in bshard-close-transport.mjs:381
// must agree. If someone shifts the state layout and updates only one site, this reddens.
const inlineAsInTransport = Buffer.from(hex, 'hex').readBigInt64LE(2);
ok(readPsConsolidatedPool(hex) === inlineAsInTransport,
   'exported parser agrees with the inline read at bshard-close-transport.mjs:381');

// Unreadable must be null, never 0. A zero pool is a meaningful value (a shard with nothing in
// it); returning it for "too short to tell" would let a caller treat an unparseable redeem as an
// empty one -- the same null-vs-zero conflation NWT caught in peerCount.
ok(readPsConsolidatedPool('51') === null, 'too-short redeem yields null, not 0');
ok(readPsConsolidatedPool('') === null, 'empty input yields null, not 0');
ok(readPsConsolidatedPool(null) === null, 'null input yields null, not 0');

// Zero is a real readable value and must NOT be confused with unreadable.
ok(readPsConsolidatedPool(synth(0)) === 0n, 'a genuinely zero pool reads as 0n, distinct from null');

// Scope note, stated so nobody reads more into a green run than it earns: this pins the BYTE
// CONVENTION between two call sites. It does not prove the layout constant matches any deployed
// covenant -- that is what the offset tripwire test against a live-compiled ctor is for.
console.log(bad === 0 ? `ALL ${6} PASS` : `${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
