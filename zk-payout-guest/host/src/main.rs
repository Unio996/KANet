// Host: real Groth16 RISC0 proving run of the payout guest. Explicitly requests
// ReceiptKind::Groth16 (default is Composite/STARK, NOT usable by Kaspa OpZkPrecompile verifier)
// and exports the receipt borsh-serialized, matching zk-sdk expected Groth16Receipt<ReceiptClaim>
// wire format (per J2, 2026-07-06 13:32Z).
//
// Usage:
//   host                                  -> demo mode: hardcoded golden-ref V3/B2 vector,
//                                             asserts byte-equal against golden-reference (regression guard).
//   host <input.json> [output_basename]   -> production mode: reads real GuestInput from JSON file,
//                                             no golden-ref assertion (real market data wont match demo roots).
//                                             output_basename defaults to /root/payout-guest/groth16_receipt.
use methods::{PAYOUT_ELF, PAYOUT_ID};
use risc0_zkvm::sha::{Digest, Sha256 as _};
use risc0_zkvm::{default_prover, ExecutorEnv, ProverOpts};
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Clone, Copy, Serialize, Deserialize)]
struct Bet {
    pk: [u8; 32],
    stake: u64,
    direction: u8,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
struct FeeLeafIn {
    pk: [u8; 32],
    amount: u64,
}

#[derive(Serialize, Deserialize)]
struct GuestInput {
    bettors: Vec<Bet>,
    winning_direction: u8,
    pool_total_sompi: Option<u64>,
    fee_bps: u64,
    fee_leaves: Vec<FeeLeafIn>,
}

fn pk_of(b: u8) -> [u8; 32] {
    [b; 32]
}

fn demo_input() -> GuestInput {
    let bettors = vec![
        Bet { pk: pk_of(1), stake: 2_065_000_000, direction: 0 },
        Bet { pk: pk_of(2), stake: 5_000_000_000, direction: 0 },
        Bet { pk: pk_of(3), stake: 10_000_000_000, direction: 1 },
    ];
    let pool: u64 = bettors.iter().map(|b| b.stake).sum();
    let fee_leaves = vec![
        FeeLeafIn { pk: pk_of(0x09), amount: 324_235_000 },
        FeeLeafIn { pk: pk_of(0x10), amount: 56_883_334 },
        FeeLeafIn { pk: pk_of(0x11), amount: 56_883_333 },
        FeeLeafIn { pk: pk_of(0x12), amount: 56_883_333 },
    ];
    GuestInput { bettors, winning_direction: 0, pool_total_sompi: Some(pool), fee_bps: 0, fee_leaves }
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::filter::EnvFilter::from_default_env())
        .init();

    let args: Vec<String> = std::env::args().collect();
    let demo_mode = args.len() < 2;
    let out_base = if args.len() >= 3 { args[2].clone() } else { "/root/payout-guest/groth16_receipt".to_string() };

    let input: GuestInput = if demo_mode {
        println!("no input.json arg given -> demo mode (hardcoded golden-ref V3/B2 vector)");
        demo_input()
    } else {
        let raw = fs::read_to_string(&args[1]).unwrap_or_else(|e| panic!("failed to read input json {}: {}", args[1], e));
        serde_json::from_str(&raw).unwrap_or_else(|e| panic!("failed to parse GuestInput json: {}", e))
    };

    let env = ExecutorEnv::builder().write(&input).unwrap().build().unwrap();

    let prover = default_prover();
    let opts = ProverOpts::groth16();
    println!("proving with ReceiptKind::Groth16 (this is much heavier than Composite — expect a long wait)...");
    let prove_info = prover.prove_with_opts(env, PAYOUT_ELF, &opts).unwrap();
    let receipt = prove_info.receipt;

    receipt.verify(PAYOUT_ID).unwrap();

    let journal_bytes = &receipt.journal.bytes;
    assert_eq!(journal_bytes.len(), 65, "journal must be exactly 65 raw bytes (32+1+32)");
    let bets_root_hex = hex::encode(&journal_bytes[0..32]);
    let attested_winner = journal_bytes[32];
    let payout_root_hex = hex::encode(&journal_bytes[33..65]);

    println!("bets_root       = {}", bets_root_hex);
    println!("attested_winner = {}", attested_winner);
    println!("payout_root     = {}", payout_root_hex);

    if demo_mode {
        const EXPECT_BETS_ROOT: &str = "41b7e8e6e891da7eb4f17467e2297f06954b59c7035efbc6df37ce1dbb9dece9";
        const EXPECT_PAYOUT_ROOT: &str = "759b6e2682d053f7fa18e9b6b2498f30afbc429cc53a6307fe03fbe5b722e669";
        assert_eq!(bets_root_hex, EXPECT_BETS_ROOT, "bets_root MISMATCH vs golden-reference B2");
        assert_eq!(payout_root_hex, EXPECT_PAYOUT_ROOT, "payout_root MISMATCH vs golden-reference V3");
        assert_eq!(attested_winner, 0);
        println!("\n✅ REAL GROTH16 PROOF byte-equal against golden-reference V3/B2 — PASS (regression guard)");
    }

    let image_id = Digest::from(PAYOUT_ID);
    let journal_digest = risc0_zkvm::sha::Impl::hash_bytes(journal_bytes);
    println!("\nimage_id (PAYOUT_ID) = {}", image_id);
    println!("journal_digest       = {}", journal_digest);

    let groth16_receipt = receipt.inner.groth16().expect("receipt should be a Groth16 receipt (ReceiptKind::Groth16 requested)");
    let borsh_bytes = borsh::to_vec(groth16_receipt).expect("borsh-serialize Groth16Receipt<ReceiptClaim>");
    let borsh_path = format!("{}.borsh", out_base);
    let hex_path = format!("{}.hex", out_base);
    fs::write(&borsh_path, &borsh_bytes).unwrap();
    fs::write(&hex_path, hex::encode(&borsh_bytes)).unwrap();

    // machine-readable summary so a caller (e.g. the J1-side polling daemon) does not have to scrape stdout.
    let summary = serde_json::json!({
        "bets_root_hex": bets_root_hex,
        "attested_winner": attested_winner,
        "payout_root_hex": payout_root_hex,
        "image_id": image_id.to_string(),
        "journal_digest": journal_digest.to_string(),
        "receipt_borsh_path": borsh_path,
        "receipt_hex_path": hex_path,
        "receipt_borsh_bytes_len": borsh_bytes.len(),
        "demo_mode": demo_mode,
    });
    let summary_path = format!("{}.summary.json", out_base);
    fs::write(&summary_path, serde_json::to_string_pretty(&summary).unwrap()).unwrap();

    println!("\nGroth16Receipt<ReceiptClaim> borsh bytes: {} bytes -> {} / {}", borsh_bytes.len(), borsh_path, hex_path);
    println!("summary -> {}", summary_path);
}
