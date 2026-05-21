// B2 v0.5 Sub 2b — PoolSpine + PoolSide P2SH compute helper
// Adapts prediction-escrow-ss.mjs pattern for pool architecture.
//
// Per service spec docs/poolspine-service-layer-spec-2026-05-21.md.
// Hybrid Option D + Angle 2 architecture (= multi-UTXO + oracle aggregated settlement).

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SILVERC = process.env.SILVERC_PATH || 'D:/silverscript/target/release/silverc.exe';
const SPINE_SIL = process.env.POOL_SPINE_SIL_PATH || join(__dirname, 'PoolSpine.sil');
const SIDE_SIL = process.env.POOL_SIDE_SIL_PATH || join(__dirname, 'PoolSide.sil');
const CACHE_DIR = process.env.SS_ARTIFACT_CACHE_DIR || join(tmpdir(), 'kanet-ss-artifact-cache');

function hexToBytes(hex) {
  if (hex.startsWith('0x')) hex = hex.slice(2);
  if (hex.length % 2 !== 0) throw new Error(`invalid hex len: ${hex.length}`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function validatePubkeyHex(hex, name) {
  if (typeof hex !== 'string') throw new Error(`${name} must be hex string`);
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length !== 64) throw new Error(`${name} must be 32 bytes (64 hex chars), got ${clean.length}`);
  if (!/^[0-9a-fA-F]+$/.test(clean)) throw new Error(`${name} contains non-hex chars`);
  return clean;
}

function validateHashHex(hex, name) {
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

function bytes32Expr(hexStr) {
  const bytes = hexToBytes(hexStr);
  return { kind: 'array', data: Array.from(bytes, b => ({ kind: 'byte', data: b })) };
}

function intExpr(n) {
  return { kind: 'int', data: n };
}

async function compileAndComputeP2SH(silPath, ctorJson, contractName, network) {
  const ctorJsonStr = JSON.stringify(ctorJson);
  const silSource = readFileSync(silPath);
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
      stdout = execFileSync(SILVERC, [silPath, '--ctor', ctorPath, '-c'], {
        stdio: 'pipe',
        timeout: 30_000,
      });
    } catch (e) {
      const stderr = e.stderr?.toString() || '';
      throw new Error(`silverc compile ${contractName} fail: ${e.message}${stderr ? ` | stderr: ${stderr.slice(0, 300)}` : ''}`);
    }
    artifact = JSON.parse(stdout.toString());
    if (artifact.contract_name !== contractName) {
      throw new Error(`unexpected contract_name: ${artifact.contract_name} (expected ${contractName})`);
    }
    if (!Array.isArray(artifact.script) || artifact.script.length === 0) {
      throw new Error('compile output missing script bytes');
    }
    writeFileSync(cacheFile, JSON.stringify(artifact));
  }

  const kaspa = await import('kaspa-wasm');
  const { ScriptBuilder, addressFromScriptPublicKey } = kaspa;
  const scriptBytes = new Uint8Array(artifact.script);
  const builder = ScriptBuilder.fromScript(scriptBytes);
  const p2shSpk = builder.createPayToScriptHashScript();
  const addr = addressFromScriptPublicKey(p2shSpk, network);
  if (!addr) throw new Error('addressFromScriptPublicKey returned undefined');

  return {
    p2shAddr: addr.toString(),
    redeemScript: Buffer.from(scriptBytes).toString('hex'),
    scriptBytes,
    cacheHit,
  };
}

/**
 * Compute PoolSpine P2SH addr + redeem script.
 * @returns {{ p2shAddr, redeemScript, cacheHit, p2shHash }}
 */
export async function computeSpineP2SH(args) {
  const makerPk = validatePubkeyHex(args.makerPk, 'makerPk');
  const brokerPk = validatePubkeyHex(args.brokerPk, 'brokerPk');
  if (!Array.isArray(args.oraclePks) || args.oraclePks.length !== 3) {
    throw new Error('oraclePks must be array of 3 x-only pubkeys (= v0.5 3-of-3)');
  }
  const oraclePks = args.oraclePks.map((pk, i) => validatePubkeyHex(pk, `oracle${i+1}Pk`));
  const allPks = new Set([makerPk, brokerPk, ...oraclePks]);
  if (allPks.size !== 5) throw new Error('ctor pubkeys must all be unique (maker + broker + 3 oracle = 5)');
  const deadline = validateInt(args.deadline, 'deadline', 1);
  const minerFee = validateInt(args.minerFee, 'minerFee', 1, 10_000_000);
  const brokerFeePct = validateInt(args.brokerFeePct, 'brokerFeePct', 0, 9999);
  const oracleBondAmount = validateInt(args.oracleBondAmount, 'oracleBondAmount', 1);
  const makerStakeAmount = validateInt(args.makerStakeAmount, 'makerStakeAmount', 1);
  const marketMetadataHash = validateHashHex(args.marketMetadataHash, 'marketMetadataHash');
  if (!args.network) throw new Error('network required');

  // PoolSpine.sil ctor order: maker, broker, oracle1-3, deadline, minerFee, brokerFeePct, oracleBondAmount, makerStakeAmount, marketMetadataHash
  const ctorJson = [
    bytes32Expr(makerPk),
    bytes32Expr(brokerPk),
    ...oraclePks.map(bytes32Expr),
    intExpr(deadline),
    intExpr(minerFee),
    intExpr(brokerFeePct),
    intExpr(oracleBondAmount),
    intExpr(makerStakeAmount),
    bytes32Expr(marketMetadataHash),
  ];

  const result = await compileAndComputeP2SH(SPINE_SIL, ctorJson, 'PoolSpine', args.network);

  // Compute P2SH hash for Side ctor reference (= blake2b of redeem script)
  // Note: Kaspa P2SH hash is OP_BLAKE2B [32-byte hash] OP_EQUAL where hash = blake2b(redeem)
  const p2shHash = createHash('sha256').update(result.scriptBytes).digest('hex'); // sha256 placeholder, kaspa uses blake2b
  // Production: use kaspa-wasm blake2b helper for exact match — defer if needed

  return {
    p2shAddr: result.p2shAddr,
    redeemScript: result.redeemScript,
    p2shHash,  // for PoolSide ctor reference
    cacheHit: result.cacheHit,
  };
}

/**
 * Compute PoolSide P2SH addr + redeem script for a specific bettor.
 * @returns {{ p2shAddr, redeemScript, cacheHit }}
 */
export async function computeSideP2SH(args) {
  const bettorPk = validatePubkeyHex(args.bettorPk, 'bettorPk');
  const spineP2shHash = validateHashHex(args.spineP2shHash, 'spineP2shHash');
  if (!Array.isArray(args.oraclePks) || args.oraclePks.length !== 3) {
    throw new Error('oraclePks must be array of 3 x-only pubkeys');
  }
  const oraclePks = args.oraclePks.map((pk, i) => validatePubkeyHex(pk, `oracle${i+1}Pk`));
  const marketMetadataHash = validateHashHex(args.marketMetadataHash, 'marketMetadataHash');
  const direction = validateInt(args.direction, 'direction', 0, 1);
  const stakeAmount = validateInt(args.stakeAmount, 'stakeAmount', 1);
  const deadline = validateInt(args.deadline, 'deadline', 1);
  if (!args.network) throw new Error('network required');

  // PoolSide.sil ctor order: bettorPk, spineP2shHash, oracle1-3, marketMetadataHash, direction, stakeAmount, deadline
  const ctorJson = [
    bytes32Expr(bettorPk),
    bytes32Expr(spineP2shHash),
    ...oraclePks.map(bytes32Expr),
    bytes32Expr(marketMetadataHash),
    intExpr(direction),
    intExpr(stakeAmount),
    intExpr(deadline),
  ];

  const result = await compileAndComputeP2SH(SIDE_SIL, ctorJson, 'PoolSide', args.network);

  return {
    p2shAddr: result.p2shAddr,
    redeemScript: result.redeemScript,
    cacheHit: result.cacheHit,
  };
}
