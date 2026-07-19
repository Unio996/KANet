// engine-probe.rs — 用 kaspa-txscript@7b1e18cc(=operator 拒绝方节点 commit)离线执行 jepu1
// wire tx 的真实 P2SH 花费(真实 redeem+scriptSig+utxo), 逐 input 输出引擎判决原文+精确错误。
// 执行路径照抄 consensus tx_validation_in_utxo_context.rs::check_scripts_sequential(<=阈值分支),
// 含 CovenantsContext::from_tx + per-input allowed_script_units 预算门 —— 与节点同构 by construction。
// argv[1] = wire dump JSON 路径(docs/evidence/2026-07-19-jepu1-wire-dump.json)
use kaspa_consensus_core::hashing::sighash::SigHashReusedValuesUnsync;
use kaspa_consensus_core::subnets::SubnetworkId;
use kaspa_consensus_core::tx::{
    PopulatedTransaction, ScriptPublicKey, Transaction, TransactionId, TransactionInput,
    TransactionOutpoint, TransactionOutput, TxInputMass, UtxoEntry,
};
use kaspa_txscript::caches::Cache;
use kaspa_txscript::covenants::CovenantsContext;
use kaspa_txscript::{EngineCtx, EngineFlags, TxScriptEngine};
use std::str::FromStr;

fn hexv(s: &str) -> Vec<u8> {
    let mut v = vec![0u8; s.len() / 2];
    faster_hex::hex_decode(s.as_bytes(), &mut v).unwrap();
    v
}

fn spk(flat: &str) -> ScriptPublicKey {
    let b = hexv(flat);
    let version = u16::from_le_bytes([b[0], b[1]]);
    ScriptPublicKey::new(version, b[2..].to_vec().into())
}

fn ju64(v: &serde_json::Value) -> u64 {
    v.as_str().map(|s| s.parse().unwrap()).unwrap_or_else(|| v.as_u64().unwrap())
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let dump: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&a[1]).unwrap()).unwrap();
    let tx_json: serde_json::Value = serde_json::from_str(dump["safeJson"].as_str().unwrap()).unwrap();

    let mut entries: Vec<UtxoEntry> = vec![];
    let inputs: Vec<TransactionInput> = tx_json["inputs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| {
            let u = &i["utxo"];
            let cov = u["covenantId"].as_str().map(|h| kaspa_consensus_core::Hash::from_str(h).unwrap());
            entries.push(UtxoEntry::new(ju64(&u["amount"]), spk(u["scriptPublicKey"].as_str().unwrap()), ju64(&u["blockDaaScore"]), u["isCoinbase"].as_bool().unwrap(), cov));
            TransactionInput {
                previous_outpoint: TransactionOutpoint {
                    transaction_id: TransactionId::from_str(i["transactionId"].as_str().unwrap()).unwrap(),
                    index: i["index"].as_u64().unwrap() as u32,
                },
                signature_script: hexv(i["signatureScript"].as_str().unwrap()),
                sequence: ju64(&i["sequence"]),
                mass: TxInputMass::SigopCount((i["sigOpCount"].as_u64().unwrap() as u8).into()),
            }
        })
        .collect();
    let outputs: Vec<TransactionOutput> = tx_json["outputs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| TransactionOutput { value: ju64(&o["value"]), script_public_key: spk(o["scriptPublicKey"].as_str().unwrap()), covenant: None })
        .collect();
    let tx = Transaction::new(
        tx_json["version"].as_u64().unwrap() as u16,
        inputs,
        outputs,
        ju64(&tx_json["lockTime"]),
        SubnetworkId::from_bytes(hexv(tx_json["subnetworkId"].as_str().unwrap()).try_into().unwrap()),
        ju64(&tx_json["gas"]),
        hexv(tx_json["payload"].as_str().unwrap_or("")),
    );
    println!("txid = {}", tx.id());
    let ptx = PopulatedTransaction::new(&tx, entries);

    let covenants_ctx = match CovenantsContext::from_tx(&ptx) {
        Ok(c) => c,
        Err(e) => {
            println!("CovenantsContext::from_tx ERR: {e}  (本身即候选拒因)");
            return;
        }
    };
    let sig_cache = Cache::new(10_000);
    let reused = SigHashReusedValuesUnsync::new();
    let ctx = EngineCtx::new(&sig_cache).with_covenants_ctx(&covenants_ctx).with_seq_commit_accessor_opt(None).with_reused(&reused);
    let flags = EngineFlags { covenants_enabled: true, ..Default::default() };

    use kaspa_consensus_core::tx::VerifiableTransaction;
    for (i, (input, entry)) in ptx.populated_inputs().enumerate() {
        let limit = input.mass.allowed_script_units();
        let mut vm = TxScriptEngine::from_transaction_input_with_script_units_limit(&ptx, input, i, entry, ctx, flags, limit);
        match vm.execute() {
            Ok(()) => println!("input{i} verdict = OK"),
            Err(e) => println!("input{i} verdict = ERR: {e}"),
        }
    }
}
