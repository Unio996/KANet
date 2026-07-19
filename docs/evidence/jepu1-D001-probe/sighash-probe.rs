// tmp-jepu1-sighash-probe.rs — 用 tn12 真 consensus-core 直接算 jepu1 input0 的节点真 sighash
// (J1tn 2026-07-18, 引擎trace后续: debugger CLI 无 sighash dump 入口, 绕道直调同一 crate 的
//  calc_schnorr_signature_hash — 与节点/debugger 引擎同源 by construction)
//
// 部署(J2 机器, silverscript workspace — 不碰 D:\rusty-kaspa 树/二进制):
//   1. mkdir D:\silverscript\sighash-probe\src, 本文件存为 src\main.rs
//   2. sighash-probe\Cargo.toml:
//        [package]
//        name = "sighash-probe"
//        version = "0.1.0"
//        edition = "2024"
//        [dependencies]
//        kaspa-consensus-core = { workspace = true }
//        kaspa-hashes = { workspace = true }
//        faster-hex = "0.9"
//      并在 D:\silverscript\Cargo.toml 的 members 里加 "sighash-probe"
//   3. cargo run -p sighash-probe --release -- 之后按下方 ARGS 顺序传参
//
// ARGS(全部 hex/十进制, 按 jepu1 真值填):
//   argv[1] = spine input0 previousOutpoint txid (64 hex)
//   argv[2] = previousOutpoint index (十进制)
//   argv[3] = input0 utxo amount sompi (十进制)
//   argv[4] = input0 utxo scriptPublicKey flat-hex (前4 hex=version LE, 余=script)
//   argv[5] = tx 骨架 JSON 文件路径 — {"version":0,"lockTime":0,"gas":0,
//              "subnetworkId":"00..00(40hex)","payload":"",
//              "inputs":[{"txid":"..","index":n,"sequence":0,"sigOpCount":8}, ×5 按序],
//              "outputs":[{"value":sompi,"spk":"flat-hex"}, ×10 按序]}
//   (inputs 的 utxo 只需 input0 的 — calc 只用被签 input 的 utxo; 其余 input 只进 prev_outs/seq/sigop hashes)
use kaspa_consensus_core::hashing::sighash::{calc_schnorr_signature_hash, SigHashReusedValuesUnsync};
use kaspa_consensus_core::hashing::sighash_type::SIG_HASH_ALL;
use kaspa_consensus_core::subnets::SubnetworkId;
use kaspa_consensus_core::tx::{
    PopulatedTransaction, ScriptPublicKey, Transaction, TransactionId, TransactionInput,
    TransactionOutpoint, TransactionOutput, TxInputMass, UtxoEntry,
};
use std::str::FromStr;

fn hexv(s: &str) -> Vec<u8> { let mut v = vec![0u8; s.len() / 2]; faster_hex::hex_decode(s.as_bytes(), &mut v).unwrap(); v }

fn spk(flat: &str) -> ScriptPublicKey {
    let b = hexv(flat);
    let version = u16::from_le_bytes([b[0], b[1]]);
    ScriptPublicKey::new(version, b[2..].to_vec().into())
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let skeleton: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&a[5]).unwrap()).unwrap();
    let inputs: Vec<TransactionInput> = skeleton["inputs"].as_array().unwrap().iter().map(|i| TransactionInput {
        previous_outpoint: TransactionOutpoint {
            transaction_id: TransactionId::from_str(i["txid"].as_str().unwrap()).unwrap(),
            index: i["index"].as_u64().unwrap() as u32,
        },
        signature_script: vec![],
        sequence: i["sequence"].as_u64().unwrap(),
        mass: TxInputMass::SigopCount((i["sigOpCount"].as_u64().unwrap() as u8).into()),
    }).collect();
    let outputs: Vec<TransactionOutput> = skeleton["outputs"].as_array().unwrap().iter().map(|o| TransactionOutput {
        value: o["value"].as_u64().unwrap(),
        script_public_key: spk(o["spk"].as_str().unwrap()),
        covenant: None,
    }).collect();
    let tx = Transaction::new(
        skeleton["version"].as_u64().unwrap() as u16,
        inputs, outputs,
        skeleton["lockTime"].as_u64().unwrap(),
        SubnetworkId::from_bytes(hexv(skeleton["subnetworkId"].as_str().unwrap()).try_into().unwrap()),
        skeleton["gas"].as_u64().unwrap(),
        hexv(skeleton["payload"].as_str().unwrap_or("")),
    );
    let utxo = UtxoEntry::new(a[3].parse().unwrap(), spk(&a[4]), 0, false);
    // populate: 只有被签 input 的 utxo 参与 per-input 段; 其余 inputs 的 utxo 不进 SIGHASH_ALL preimage
    let entries: Vec<UtxoEntry> = (0..tx.inputs.len()).map(|_| utxo.clone()).collect();
    let ptx = PopulatedTransaction::new(&tx, entries);
    let reused = SigHashReusedValuesUnsync::new();
    let h = calc_schnorr_signature_hash(&ptx, 0, SIG_HASH_ALL, &reused);
    println!("txid          = {}", tx.id());
    println!("node sighash  = {}", h);
    // 期望: txid == f9e64afc...(证明骨架填对) → node sighash 与 ad7eb3a1 比对 = 终判
}
