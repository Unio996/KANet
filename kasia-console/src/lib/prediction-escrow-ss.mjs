// Phase 4a Sub 3 v2 — PredictionEscrowUnanimous5 P2SH addr compute (Bettor r228 catch + r229/r230 v2 spec).
//
// 关键 sediment (= r228 reviewer 真 catch):
//   silverscript --ctor 是 compile-time bake (= ctor args 编进 artifact.script literal).
//   per-offer 不同 ctor → 不同 artifact.script → 不同 P2SH addr.
//   v1 prepend 274 byte ctor 是 double-encoding 错 (= maker stake 锁错 addr 永 lost 风险).
//   v2 修法: 每 publish 真 shellout silverc.exe → 新 artifact → artifact.script 直 当 redeem.
//
// Workflow (= Path α: .106 装 silverc binary 自治):
//   1. Validate ctor args (= part of r225 6 链下守)
//   2. Build ctor JSON (= [{kind:'array', data:[{kind:'byte', data:N}...]}, ..., {kind:'int', data:N}])
//   3. cache by sha256(.sil source + ctor JSON) — 防 .sil 改 cache invalidate
//   4. cache miss → execFileSync(silverc.exe, [sil, --ctor, ctor.json, -c]) → stdout JSON artifact
//   5. P2SH = ScriptBuilder.fromScript(artifact.script).createPayToScriptHashScript()
//   6. addr = addressFromScriptPublicKey(spk, network)
//
// Deterministic verify (r230 加固 #3):
//   J1 .106 silverc binary sha256=9e4dc3a6 (= match Bettor .109).
//   同 binary + 同 .sil + 同 ctor → 必同 artifact.script (= 已 verify cross-host).

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SILVERC = process.env.SILVERC_PATH || 'D:/silverscript/target/release/silverc.exe';
const SIL_SOURCE = process.env.PREDICTION_SIL_PATH || join(__dirname, 'PredictionEscrowUnanimous5.sil');
const CACHE_DIR = process.env.SS_ARTIFACT_CACHE_DIR || join(tmpdir(), 'kanet-ss-artifact-cache');

// hex → Uint8Array
function hexToBytes(hex) {
  if (hex.startsWith('0x')) hex = hex.slice(2);
  if (hex.length % 2 !== 0) throw new Error(`invalid hex len: ${hex.length}`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// Validate 32-byte x-only pubkey hex
function validatePubkeyHex(hex, name) {
  if (typeof hex !== 'string') throw new Error(`${name} must be hex string`);
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length !== 64) throw new Error(`${name} must be 32 bytes (64 hex chars), got ${clean.length}`);
  if (!/^[0-9a-fA-F]+$/.test(clean)) throw new Error(`${name} contains non-hex chars`);
  return clean;
}

function validateInt(v, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${name} must be integer in [${min}, ${max}], got ${v}`);
  }
  return n;
}

// silverc ctor format: byte[32] = {kind:'array', data:[{kind:'byte', data:N}...]}, int = {kind:'int', data:N}
function bytes32Expr(hexStr) {
  const bytes = hexToBytes(hexStr);
  return { kind: 'array', data: Array.from(bytes, b => ({ kind: 'byte', data: b })) };
}
function intExpr(n) {
  return { kind: 'int', data: n };
}

/**
 * Compute PredictionEscrowUnanimous5 P2SH addr + redeem script for given ctor args.
 * Per-offer compile via silverc.exe shellout (Path α, Bettor r230 钦定).
 *
 * v3 (Bettor r233): 13 ctor params 加 makerStakeAmount + takerStakeAmount (= 真 P2P 双锁).
 * 3 entrypoints: settle (5 oracle unanimous), refund_both (双方各回 stake), refund_maker_unjoined (= taker 未 join 单边 refund).
 *
 * @returns {{ p2shAddr: string, redeemScript: string, cacheHit: boolean }}
 */
export async function computeEscrowP2SH(args) {
  // Validate r225 6 链下守 early-fail
  const makerPk = validatePubkeyHex(args.makerPk, 'makerPk');
  const takerPk = validatePubkeyHex(args.takerPk, 'takerPk');
  const brokerPk = validatePubkeyHex(args.brokerPk, 'brokerPk');
  if (!Array.isArray(args.oraclePks) || args.oraclePks.length !== 5) {
    throw new Error('oraclePks must be array of 5 x-only pubkeys');
  }
  const oraclePks = args.oraclePks.map((pk, i) => validatePubkeyHex(pk, `oracle${i+1}Pk`));
  const allPks = new Set([makerPk, takerPk, brokerPk, ...oraclePks]);
  if (allPks.size !== 8) throw new Error('ctor pubkeys must all be unique (maker/taker/broker + 5 oracle = 8 distinct)');
  const deadline = validateInt(args.deadline, 'deadline', 1);
  const minerFee = validateInt(args.minerFee, 'minerFee', 0, 10_000_000);
  const brokerFeePct = validateInt(args.brokerFeePct, 'brokerFeePct', 0, 9999);  // < 10000 防 force refund
  // v3 加: 双 stake sompi int (= 真 P2P, 必 > 0)
  const makerStakeAmount = validateInt(args.makerStakeAmount, 'makerStakeAmount', 1);
  const takerStakeAmount = validateInt(args.takerStakeAmount, 'takerStakeAmount', 1);
  if (!args.network) throw new Error('network required');

  // Build ctor JSON (= silverc CLI 接 format, 13 params 顺序 align .sil v3 signature)
  const ctorJson = [
    bytes32Expr(makerPk),
    bytes32Expr(takerPk),
    bytes32Expr(brokerPk),
    ...oraclePks.map(bytes32Expr),
    intExpr(deadline),
    intExpr(minerFee),
    intExpr(brokerFeePct),
    intExpr(makerStakeAmount),
    intExpr(takerStakeAmount),
  ];
  const ctorJsonStr = JSON.stringify(ctorJson);

  // Cache key = sha256(.sil source + ctor) — .sil 改自动 invalidate
  const silSource = readFileSync(SIL_SOURCE);
  const sourceHash = createHash('sha256').update(silSource).digest('hex').slice(0, 16);
  const cacheKey = createHash('sha256').update(sourceHash + ctorJsonStr).digest('hex');
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = join(CACHE_DIR, `${cacheKey}.json`);
  const ctorPath = join(CACHE_DIR, `${cacheKey}.ctor.json`);

  let artifact;
  let cacheHit = false;
  if (existsSync(cacheFile)) {
    artifact = JSON.parse(readFileSync(cacheFile, 'utf8'));
    cacheHit = true;
  } else {
    writeFileSync(ctorPath, ctorJsonStr);
    let stdout;
    try {
      stdout = execFileSync(SILVERC, [SIL_SOURCE, '--ctor', ctorPath, '-c'], {
        stdio: 'pipe',
        timeout: 30_000,
      });
    } catch (e) {
      const stderr = e.stderr?.toString() || '';
      throw new Error(`silverc compile fail: ${e.message}${stderr ? ` | stderr: ${stderr.slice(0, 300)}` : ''}`);
    }
    artifact = JSON.parse(stdout.toString());
    if (artifact.contract_name !== 'PredictionEscrowUnanimous5') {
      throw new Error(`unexpected contract_name: ${artifact.contract_name}`);
    }
    if (!Array.isArray(artifact.script) || artifact.script.length === 0) {
      throw new Error(`compile output missing script bytes`);
    }
    writeFileSync(cacheFile, JSON.stringify(artifact));
  }

  // P2SH wrap: artifact.script 是完整 redeem (ctor 已 baked, NO prepend per r228 catch)
  const kaspa = await import('kaspa-wasm');
  const { ScriptBuilder, addressFromScriptPublicKey } = kaspa;
  const scriptBytes = new Uint8Array(artifact.script);
  const builder = ScriptBuilder.fromScript(scriptBytes);
  const p2shSpk = builder.createPayToScriptHashScript();
  const addr = addressFromScriptPublicKey(p2shSpk, args.network);
  if (!addr) throw new Error('addressFromScriptPublicKey returned undefined');

  return {
    p2shAddr: addr.toString(),
    redeemScript: Buffer.from(scriptBytes).toString('hex'),
    cacheHit,
  };
}

/** Inspect silverc binary + .sil source (= debug helper). */
export function getEscrowToolchainSummary() {
  const silSource = readFileSync(SIL_SOURCE);
  const sourceHash = createHash('sha256').update(silSource).digest('hex').slice(0, 16);
  let silvercVersion = null;
  try {
    silvercVersion = execFileSync(SILVERC, ['--help'], { stdio: 'pipe', timeout: 5000 }).toString().split('\n')[0].trim();
  } catch {}
  return {
    silverc_path: SILVERC,
    silverc_help_first_line: silvercVersion,
    sil_source_path: SIL_SOURCE,
    sil_source_hash16: sourceHash,
    cache_dir: CACHE_DIR,
  };
}
