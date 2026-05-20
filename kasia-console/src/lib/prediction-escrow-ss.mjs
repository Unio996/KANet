// Phase 4a Sub 3 — PredictionEscrowUnanimous5 P2SH addr compute (Bettor r225 v2.1 audit + Owner 5-of-5 unanimous 钦定).
//
// Workflow:
//   1. Load artifact (= silverc compile output JSON, 523 byte script + abi)
//   2. Build redeem_script = ctor args push opcodes prepend + artifact.script
//      - ctor 11 params (.sil source order):
//          byte[32] makerPk, takerPk, brokerPk,
//          byte[32] oracle1Pk, oracle2Pk, oracle3Pk, oracle4Pk, oracle5Pk,
//          int deadline, int minerFee, int brokerFeePct
//      - silverscript convention: ctor args pushed LIFO before script (= last param pushed first onto stack)
//   3. P2SH script = createPayToScriptHashScript(redeem_script) via kaspa-wasm ScriptBuilder
//   4. P2SH addr = addressFromScriptPublicKey(p2shScript, network)
//
// 用 by:
//   - api/bettor.js publish endpoint Sub 4 (= maker transfer SS P2SH addr 不 maker 自家钱包)
//   - services/bettor-prediction-settler.js Sub 8 (= settle TX build use same redeem_script)
//   - services/bettor-prediction-settler.js Sub 9 (= refund TX build use same redeem_script)

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACT_PATH = join(__dirname, 'PredictionEscrowUnanimous5.json');

// Cached artifact load (= 单 contract, 不变, 启动 load 1 次)
let _artifact = null;
function getArtifact() {
  if (_artifact) return _artifact;
  const raw = readFileSync(ARTIFACT_PATH, 'utf8');
  _artifact = JSON.parse(raw);
  if (_artifact.contract_name !== 'PredictionEscrowUnanimous5') {
    throw new Error(`unexpected contract_name: ${_artifact.contract_name}`);
  }
  if (!Array.isArray(_artifact.script) || _artifact.script.length !== 523) {
    throw new Error(`unexpected script size: ${_artifact.script?.length} (expect 523)`);
  }
  return _artifact;
}

// hex → Uint8Array
function hexToBytes(hex) {
  if (hex.startsWith('0x')) hex = hex.slice(2);
  if (hex.length % 2 !== 0) throw new Error(`invalid hex len: ${hex.length}`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// validate 32-byte x-only pubkey hex
function validatePubkeyHex(hex, name) {
  if (typeof hex !== 'string') throw new Error(`${name} must be hex string`);
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length !== 64) throw new Error(`${name} must be 32 bytes (64 hex chars), got ${clean.length}`);
  if (!/^[0-9a-fA-F]+$/.test(clean)) throw new Error(`${name} contains non-hex chars`);
  return clean;
}

// validate integer ctor param
function validateInt(v, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${name} must be integer in [${min}, ${max}], got ${v}`);
  }
  return n;
}

/**
 * Compute PredictionEscrowUnanimous5 P2SH addr + redeem script for given ctor args.
 *
 * @param {object} args
 * @param {string} args.makerPk      32-byte x-only hex
 * @param {string} args.takerPk      32-byte x-only hex
 * @param {string} args.brokerPk     32-byte x-only hex
 * @param {string[]} args.oraclePks  5 × 32-byte x-only hex (= maker 自选 5 oracle relay pubkeys)
 * @param {number} args.deadline    epoch seconds (UTC int, Kaspa tx.time second precision)
 * @param {number} args.minerFee    sompi int (= testnet 默 10000)
 * @param {number} args.brokerFeePct basis points (= 100 means 1%, < 10000)
 * @param {string} args.network     "mainnet" | "testnet-12"
 * @returns {{ p2shAddr: string, redeemScript: string }}  redeemScript = hex
 */
export async function computeEscrowP2SH(args) {
  // Validate ctor args (= match .sil ctor signature)
  const makerPk = validatePubkeyHex(args.makerPk, 'makerPk');
  const takerPk = validatePubkeyHex(args.takerPk, 'takerPk');
  const brokerPk = validatePubkeyHex(args.brokerPk, 'brokerPk');
  if (!Array.isArray(args.oraclePks) || args.oraclePks.length !== 5) {
    throw new Error('oraclePks must be array of 5 x-only pubkeys');
  }
  const oraclePks = args.oraclePks.map((pk, i) => validatePubkeyHex(pk, `oracle${i+1}Pk`));
  // Unique check — 5 oracle 不重复 + maker/taker/broker/oracle 不重叠 (= r225 6 链下守, Sub 4 publish 也加, 此处早 fail safe)
  const allPks = new Set([makerPk, takerPk, brokerPk, ...oraclePks]);
  if (allPks.size !== 8) throw new Error('ctor pubkeys must all be unique (maker/taker/broker + 5 oracle = 8 distinct)');
  const deadline = validateInt(args.deadline, 'deadline', 1);
  const minerFee = validateInt(args.minerFee, 'minerFee', 0, 10_000_000);
  const brokerFeePct = validateInt(args.brokerFeePct, 'brokerFeePct', 0, 9999);  // < 10000 防 force refund per Bettor 6 守
  if (!args.network) throw new Error('network required');

  // kaspa-wasm late import (= load only when called, init time savings)
  const kaspa = await import('kaspa-wasm');
  const { ScriptBuilder, addressFromScriptPublicKey } = kaspa;

  // Build redeem_script:
  // silverscript convention — ctor args pushed in LIFO order (= last param first).
  // Order REVERSED from .sil signature:
  //   push brokerFeePct (int)
  //   push minerFee (int)
  //   push deadline (int)
  //   push oracle5Pk .. oracle1Pk (32-byte each)
  //   push brokerPk .. makerPk (32-byte each)
  // Then artifact.script (= 523 bytes contract logic).
  //
  // 注意: 此 LIFO 顺序 ↔ .sil signature 顺序的关系是 silverscript SDK convention.
  // Phase 4a 真 e2e PASS 验后 sediment 写明确 (Bettor compile JSON 提供顺序若 explicit, 优先).
  const builder = new ScriptBuilder();
  builder.addData(hexToBytes(brokerPk));
  builder.addData(hexToBytes(takerPk));
  builder.addData(hexToBytes(makerPk));
  for (let i = 5; i >= 1; i--) {
    builder.addData(hexToBytes(oraclePks[i-1]));
  }
  builder.addI64(BigInt(brokerFeePct));
  builder.addI64(BigInt(minerFee));
  builder.addI64(BigInt(deadline));
  // Append contract script bytes
  const scriptBytes = new Uint8Array(getArtifact().script);
  builder.addOps(scriptBytes);

  // P2SH wrap + addr
  const p2shSpk = builder.createPayToScriptHashScript();
  const addr = addressFromScriptPublicKey(p2shSpk, args.network);
  if (!addr) throw new Error('addressFromScriptPublicKey returned undefined');

  return {
    p2shAddr: addr.toString(),
    redeemScript: builder.toString(),  // hex
  };
}

/** Inspect loaded artifact (= debug helper). */
export function getEscrowArtifactSummary() {
  const a = getArtifact();
  return {
    contract_name: a.contract_name,
    script_size: a.script.length,
    abi_entries: a.abi?.map(e => ({ name: e.name, inputs: e.inputs?.length || 0 })) || [],
    state_layout: a.state_layout,
  };
}
