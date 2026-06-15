// pool-bshard-artifacts.mjs — bshard per-market artifact pipeline (J2, 2026-06-15).
//
// Produces the per-market template artifacts the bshard contracts bake/witness. Chains the compile→extract proven
// in _j2_chain_extract: market spine ctor → spine_template_hash → PoolSide ctor (bakes it) → PoolSide artifact.
// All artifacts are PER-MARKET (spine ctor bakes committee/market_id/deadline; PoolSide bakes spine_template_hash).
//
// 🔴 silverc-anchor (KANet-UI/NWT 承重墙): this MUST compile with the SAME silverc binary as the deployed contracts
// (cross-node :3300 silverc SHA256 == :3200 == 9e4dc3a6...). Else baked hashes ≠ on-chain templates → claim/register
// fail. Single-source SILVERC (= pool-p2sh.mjs L17). Compile is deterministic given (same .sil, same silverc, same ctor).
//
// Consumers:
//   - J1 register_bet ctor: ps_template_hash (validateOutputStateWithTemplate of the bettor's PoolSide output)
//   - register witness: ps_prefix / ps_suffix
//   - PoolSide ctor: spine_template_hash (claim_winner readInputStateWithTemplate of the spine close-commit)
//   - claim witness: spine_prefix_len / spine_suffix_len

import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractTemplateArtifact } from './pool-template-artifact.mjs';

const SILVERC = process.env.SILVERC_PATH || 'D:/silverscript/target/release/silverc.exe';

/** Compile a .sil with ctor JSON via silverc → {script:number[], state_layout:{start,len}} (silverc -o JSON). */
export function compileSil(silPath, ctorArr, silvercPath = SILVERC) {
  const dir = mkdtempSync(join(tmpdir(), 'bshard-art-'));
  const ctorPath = join(dir, 'ctor.json'), outPath = join(dir, 'out.json');
  writeFileSync(ctorPath, JSON.stringify(ctorArr));
  try {
    execFileSync(silvercPath, [silPath, '--ctor', ctorPath, '-o', outPath], { stdio: 'pipe' });
  } catch (e) {
    throw new Error(`silverc compile ${silPath} fail: ${(e.stderr ? e.stderr.toString() : e.message).slice(0, 300)}`);
  }
  const o = JSON.parse(readFileSync(outPath, 'utf8'));
  if (!Array.isArray(o.script) || !o.state_layout) throw new Error(`silverc output missing script/state_layout for ${silPath}`);
  return o;
}

/** ctor helpers (silverc ctor JSON node format). */
export const ctorBytes32 = (hexOrBuf) => {
  const b = Buffer.isBuffer(hexOrBuf) ? hexOrBuf : Buffer.from(hexOrBuf, 'hex');
  if (b.length !== 32) throw new Error(`bytes32 must be 32B, got ${b.length}`);
  return { kind: 'array', data: [...b].map(x => ({ kind: 'byte', data: x })) };
};
export const ctorInt = (n) => ({ kind: 'int', data: Number(n) });

/**
 * Spine artifact (PoolSpine_v08_shard): compile with the market's spine ctor → extract template artifact.
 * @param {string} spineSilPath
 * @param {Array} spineCtor  [c0..c4Pk, market_id, deadline, init_closed, init_winningSide, init_payoutRoot, init_fold_tmpl_hash, init_shard_count]
 * @returns {{templateHashHex:string, prefixLen:number, suffixLen:number, redeemLen:number}}
 */
export function computeSpineArtifact(spineSilPath, spineCtor, silvercPath = SILVERC) {
  const a = extractTemplateArtifact(compileSil(spineSilPath, spineCtor, silvercPath));
  return { templateHashHex: a.expectedTemplateHashHex, prefixLen: a.templatePrefixLen, suffixLen: a.templateSuffixLen, redeemLen: a.templatePrefixLen + a.encodedStateLen + a.templateSuffixLen };
}

/**
 * PoolSide artifact (PoolSide_v08_shard): compile with the spine_template_hash baked → extract template artifact.
 * @param {string} poolSideSilPath
 * @param {Array} poolSideCtor  [6 State init..., spine_template_hash(bytes32)]  (spine_template_hash from computeSpineArtifact)
 * @returns {{templateHashHex, templatePrefix:Buffer, templateSuffix:Buffer, prefixLen, suffixLen}}
 */
export function computePoolSideArtifact(poolSideSilPath, poolSideCtor, silvercPath = SILVERC) {
  const a = extractTemplateArtifact(compileSil(poolSideSilPath, poolSideCtor, silvercPath));
  return { templateHashHex: a.expectedTemplateHashHex, templatePrefix: a.templatePrefix, templateSuffix: a.templateSuffix, prefixLen: a.templatePrefixLen, suffixLen: a.templateSuffixLen };
}

/**
 * Full create-phase per-market artifact bundle. Chains spine → PoolSide (single-source ctor + silverc).
 * @param {object} opts { spineSilPath, poolSideSilPath, spineCtor, poolSideCtorBase (6 State init, WITHOUT spine_template_hash), silvercPath? }
 * @returns {{ spine, poolSide }}  spine={templateHashHex,prefixLen,suffixLen}, poolSide={templateHashHex,prefix/suffix,...}
 */
export function computeMarketCreateArtifacts({ spineSilPath, poolSideSilPath, spineCtor, poolSideCtorBase, silvercPath = SILVERC }) {
  const spine = computeSpineArtifact(spineSilPath, spineCtor, silvercPath);
  const poolSideCtor = [...poolSideCtorBase, ctorBytes32(spine.templateHashHex)];
  const poolSide = computePoolSideArtifact(poolSideSilPath, poolSideCtor, silvercPath);
  return { spine, poolSide };
}
