// RISC0 guest: real payout guest circuit (P2 golden-reference byte-equal ported logic).
// Source (single-source, do not re-derive): kasia-console/src/lib/pool-payout-root.mjs +
// pool-shard-settle.mjs, byte-anchored by docs/2026-06-28-P2-payout-guest-golden-reference.md.
// Verified byte-equal against all 13 golden vectors in plain Rust (payout-arith crate) before
// being ported here unchanged.
#![no_main]
risc0_zkvm::guest::entry!(main);

use blake2::digest::{Update, VariableOutput};
use blake2::Blake2bVar;
use risc0_zkvm::guest::env;
use serde::{Deserialize, Serialize};

const ZERO32: [u8; 32] = [0u8; 32];
const DEPTH: usize = 10;
const CAP: usize = 1 << DEPTH; // 1024

fn blake2b256(parts: &[&[u8]]) -> [u8; 32] {
    let mut hasher = Blake2bVar::new(32).expect("blake2b-256 init");
    for p in parts {
        hasher.update(p);
    }
    let mut out = [0u8; 32];
    hasher.finalize_variable(&mut out).expect("blake2b-256 finalize");
    out
}

fn serialize_i64(num: i128, size: Option<usize>) -> Vec<u8> {
    let sign: i32 = if num < 0 { -1 } else if num > 0 { 1 } else { 0 };
    let mut positive: u128 = if num < 0 { (-num) as u128 } else { num as u128 };
    let mut bytes: Vec<u8> = Vec::new();
    let mut last_saturated = false;
    loop {
        if positive == 0 {
            if last_saturated {
                bytes.push(0);
                last_saturated = false;
            } else {
                break;
            }
        } else {
            let v = (positive & 0xff) as u8;
            last_saturated = (v & 0x80) != 0;
            positive >>= 8;
            bytes.push(v);
        }
    }
    if let Some(sz) = size {
        assert!(bytes.len() <= sz, "NumberTooLong");
        while bytes.len() < sz {
            bytes.push(0);
        }
    }
    if sign == -1 {
        let last = bytes.len() - 1;
        bytes[last] |= 0x80;
    }
    bytes
}

fn payout_leaf(pk: &[u8; 32], amount_sompi: u64) -> [u8; 32] {
    assert!(amount_sompi > 0, "payout amount must be > 0");
    let amt = serialize_i64(amount_sompi as i128, Some(8));
    blake2b256(&[pk, &amt])
}

fn bets_leaf(pk: &[u8; 32], stake_sompi: u64, dir: u8) -> [u8; 32] {
    assert!(stake_sompi > 0, "bet stake must be > 0");
    assert!(dir == 0 || dir == 1, "dir must be 0/1");
    let stake = serialize_i64(stake_sompi as i128, Some(8));
    let d = serialize_i64(dir as i128, Some(1));
    blake2b256(&[pk, &stake, &d])
}

#[derive(Clone, Copy, Serialize, Deserialize)]
struct Bet {
    pk: [u8; 32],
    stake: u64,
    direction: u8,
}

fn compute_bets_root(ordered_bets: &[Bet]) -> [u8; 32] {
    let mut acc = ZERO32;
    for b in ordered_bets {
        let leaf = bets_leaf(&b.pk, b.stake, b.direction);
        acc = blake2b256(&[&acc, &leaf]);
    }
    acc
}

#[derive(Clone, Copy)]
struct PayoutLeaf {
    pk: [u8; 32],
    amount: u64,
}

// zero_at[d] = root of an all-ZERO32 subtree with 2^d leaves. zero_at[0]=ZERO32 (bare pad leaf),
// zero_at[d+1]=blake2b(zero_at[d],zero_at[d]). Real leaves are always a contiguous prefix (winners
// first, padding after) so any missing sibling at level d is exactly zero_at[d] — this avoids
// materializing all CAP=1024 leaf slots, which OOM-killed the zkVM prover (r0vm) the first time
// (same failure mode as the 2026-06-28 incident in project memory; this is the known fix).
fn zero_at_table() -> [[u8; 32]; DEPTH + 1] {
    let mut t = [ZERO32; DEPTH + 1];
    for d in 0..DEPTH {
        t[d + 1] = blake2b256(&[&t[d], &t[d]]);
    }
    t
}

fn payout_root(leaves: &[PayoutLeaf]) -> [u8; 32] {
    assert!(leaves.len() <= CAP, ">CAP leaves needs rolling payout-shard");
    assert!(!leaves.is_empty(), "payout_root requires at least one leaf");
    let zero_at = zero_at_table();
    let mut level: Vec<[u8; 32]> = leaves.iter().map(|w| payout_leaf(&w.pk, w.amount)).collect();
    for d in 0..DEPTH {
        let width = level.len();
        let mut next = Vec::with_capacity((width + 1) / 2);
        let mut i = 0;
        while i < width {
            let left = level[i];
            let right = if i + 1 < width { level[i + 1] } else { zero_at[d] };
            next.push(blake2b256(&[&left, &right]));
            i += 2;
        }
        level = next;
    }
    level[0]
}

#[derive(Clone, Copy, Serialize, Deserialize)]
struct FeeLeafIn {
    pk: [u8; 32],
    amount: u64,
}

#[derive(Serialize, Deserialize)]
struct GuestInput {
    bettors: Vec<Bet>, // absorb (continuation-chain) order — also the betsRoot input-side order
    winning_direction: u8,
    pool_total_sompi: Option<u64>,
    fee_bps: u64,
    fee_leaves: Vec<FeeLeafIn>,
}

fn main() {
    let input: GuestInput = env::read();

    let bets_root = compute_bets_root(&input.bettors);

    let pool: u64 = input.pool_total_sompi.unwrap_or_else(|| input.bettors.iter().map(|b| b.stake).sum());
    let fee_from_leaves: u64 = input.fee_leaves.iter().map(|l| l.amount).sum();
    let fee_sompi: u64 = if fee_from_leaves > 0 {
        fee_from_leaves
    } else {
        ((pool as u128) * (input.fee_bps as u128) / 10000u128) as u64
    };
    let distributable = pool - fee_sompi;
    let winners: Vec<&Bet> = input.bettors.iter().filter(|b| b.direction == input.winning_direction).collect();
    let total_win_stake: u64 = winners.iter().map(|b| b.stake).sum();

    let payout_root_bytes = if winners.is_empty() || total_win_stake == 0 {
        // degenerate (no winning-side bettors) -> refund path, out of scope for this guest/journal.
        ZERO32
    } else {
        let mut payouts: Vec<PayoutLeaf> = winners
            .iter()
            .map(|b| {
                let amt = ((b.stake as u128) * (distributable as u128) / (total_win_stake as u128)) as u64;
                PayoutLeaf { pk: b.pk, amount: amt }
            })
            .collect();
        let assigned: u64 = payouts.iter().map(|p| p.amount).sum();
        payouts[0].amount += distributable - assigned; // dust -> winners[0]
        let mut leaves = payouts;
        leaves.extend(input.fee_leaves.iter().map(|l| PayoutLeaf { pk: l.pk, amount: l.amount }));
        payout_root(&leaves)
    };

    // Journal = compact raw bytes, per J2 (covenant reconstruct expects this exact layout, not a
    // serde-framed struct): betsRootBaked(32B) || attestedWinner(1B) || guestPayoutRoot(32B) = 65B.
    // env::commit_slice writes raw Pod bytes with no word-padding/framing (verified against
    // risc0-zkvm 3.0.5 source: write_slice -> bytemuck::cast_slice -> sys_write, byte-exact).
    let mut journal = [0u8; 65];
    journal[0..32].copy_from_slice(&bets_root);
    journal[32] = input.winning_direction;
    journal[33..65].copy_from_slice(&payout_root_bytes);
    env::commit_slice(&journal);
}
