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
import { writeFileSync, readFileSync, mkdtempSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { blake2b } from '@noble/hashes/blake2b';
import { extractTemplateArtifact } from './pool-template-artifact.mjs';

// 🔴 事故修复(2026-07-07，Bettor/NWT 裁定): 这个模块级默认被 bshard-settle-daemon.mjs/bshard-auto-settler.mjs
// 多处隐式依赖(调 compilePayoutShardRedeem 不传 silverc 参数 → 落到这个默认) — 今晚 KANet-UI 重启把
// D:/silverscript/target/release/silverc.exe 原地覆盖成 j2-oppick-fix 分支(含 faaa074，改了
// validateOutputStateWithTemplate 的 codegen 形状)，而 settle daemon 结算的是 PayoutShard V1(committee-sig)
// 市场，V1 续约地址必须跟 genesis 时的字节 byte-exact，不能用这个新 binary 重算。默认改保守(legacy)，
// ZK 专属函数(compilePayoutShardV2Redeem/computeCloseZkTmplAnchor)由调用方(pool.js)显式传参不受此默认影响。
const SILVERC = process.env.SILVERC_LEGACY_PATH || 'D:/silverscript/versioned-builds/silverc-legacy-2c46231.exe';

// 2026-07-14 (J1tn, event-loop 饿死追凶第四源排查副产出): compileSil 此前每次调用都裸 execFileSync
// (mkdtempSync 开新临时目录, 无 cache 无 timeout) —— pool-p2sh.mjs/prediction-escrow-ss.mjs 同款 silverc
// 编译点都有 sha256(source+ctor) cache + timeout:30_000, 这里两层都缺(NWT/J2 7/14 diff审实测坐实,
// pool-seeder.mjs 当天真撞过同一 legacy 二进制 spawnSync ETIMEDOUT, 证明编译器确会偶发慢)。
// 补齐时 cache key 必须把 silvercPath 编进去 ——本文件的 compileSil/computeSpineArtifact/
// computePoolSideArtifact/computeMarketCreateArtifacts 全接受可覆盖的 silvercPath 参数,
// 全库实测同一 .sil+ctor 组合会分别被 SILVERC_LEGACY 和 SILVERC_ZK 两个不同二进制调用
// (closezk-v2-mint.mjs / pool-shard-register.mjs 两处), 若 cache key 沿用 pool-p2sh.mjs 那种
// 不含二进制路径的写法, legacy/zk 两侧编译结果会互相污染缓存 —— 正是本文件顶部注释警告的
// "MUST compile with the SAME silverc binary" 场景, 比原本无 cache 的慢更危险(错的哈希会被烤进链上模板)。
const CACHE_DIR = process.env.SS_ARTIFACT_CACHE_DIR || join(tmpdir(), 'kanet-ss-artifact-cache');

/** Compile a .sil with ctor JSON via silverc → {script:number[], state_layout:{start,len}} (silverc -o JSON). */
export function compileSil(silPath, ctorArr, silvercPath = SILVERC) {
  const ctorJsonStr = JSON.stringify(ctorArr);
  const sourceHash = createHash('sha256').update(readFileSync(silPath)).digest('hex').slice(0, 16);
  // silvercPath 编进 key: 同 .sil+ctor 在 legacy/zk 两个二进制间必须各自独立缓存, 不能共享。
  const cacheKey = createHash('sha256').update(sourceHash + silvercPath + ctorJsonStr).digest('hex');
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = join(CACHE_DIR, `${cacheKey}.json`);
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8'));

  const dir = mkdtempSync(join(tmpdir(), 'bshard-art-'));
  const ctorPath = join(dir, 'ctor.json'), outPath = join(dir, 'out.json');
  writeFileSync(ctorPath, ctorJsonStr);
  try {
    execFileSync(silvercPath, [silPath, '--ctor', ctorPath, '-o', outPath], { stdio: 'pipe', timeout: 30_000 });
  } catch (e) {
    // 观测性 fix(2026-07-08 backlog 调查发现): e.stderr 是空 Buffer(spawn 失败/子进程无输出崩溃等场景)
    // 时仍是 truthy 对象(Buffer 非空字符串才是空)——旧写法 `e.stderr ? ... : e.message` 会选中空 stderr,
    // 把真正有用的 e.message(如 spawn ENOMEM/ETIMEDOUT/ENOENT)盖成空字符串, 生产日志出现过"fail: "
    // 后面啥都没有的情况, 排障时看不到真实原因。改成: stderr 非空文本优先, 否则退到 e.message, 再否则退到
    // e.code/errno, 确保至少有一项非空。
    const stderrText = e.stderr ? e.stderr.toString().trim() : '';
    const detail = stderrText || e.message || `errno=${e.errno ?? '?'} code=${e.code ?? '?'} signal=${e.signal ?? '?'}`;
    throw new Error(`silverc compile ${silPath} fail: ${detail.slice(0, 300)}`);
  }
  const o = JSON.parse(readFileSync(outPath, 'utf8'));
  if (!Array.isArray(o.script) || !o.state_layout) throw new Error(`silverc output missing script/state_layout for ${silPath}`);
  writeFileSync(cacheFile, JSON.stringify(o));
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
  const compiled = compileSil(spineSilPath, spineCtor, silvercPath);
  const a = extractTemplateArtifact(compiled);
  // spine_p2sh_hash = blake2b(full redeem) (= Kaspa P2SH commitment; for register_bet fix-a ctor + claim
  // spineP2shHash check). DISTINCT from templateHashHex (= blake2b(prefix‖suffix), state-excluded, for the
  // readInputStateWithTemplate template check). NWT/Bettor fix-a binds the PoolSide to the market's single spine.
  const p2shHashHex = Buffer.from(blake2b(Buffer.from(compiled.script), { dkLen: 32 })).toString('hex');
  return {
    templateHashHex: a.expectedTemplateHashHex,
    p2shHashHex,
    prefixLen: a.templatePrefixLen, suffixLen: a.templateSuffixLen,
    redeemLen: a.templatePrefixLen + a.encodedStateLen + a.templateSuffixLen,
  };
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
 * Fail-fast canonical genesis-seed guard for the spine ctor (PoolSpine_v08_shard.sil aa041d91).
 * The committee-bypass fix (PoolShard_fold fold L108-110) pins the folded parent's outcome to the GENESIS
 * seed: new.closed==0, new.winningSide==0, new.payoutRoot==init_payoutRoot. For the induction base case +
 * cross-node determinism, the genesis ctor MUST seed the canonical zero outcome. A non-canonical seed does
 * NOT break fund-safety (init_closed=1 → register gate blocks all bets = dead market; init_payoutRoot≠ZERO →
 * close_commit overwrites at settle), but it breaks cross-node P2SH byte-equality + diverges the fold
 * canonical-pin. Verified ctor positions (git show aa041d91:...PoolSpine_v08_shard.sil):
 *   [c0..c4Pk(0-4), market_id(5), deadline(6), init_closed(7), init_winningSide(8), init_payoutRoot(9),
 *    init_fold_tmpl_hash(10), init_shard_count(11)].
 */
export function assertCanonicalGenesisSpineSeed(spineCtor) {
  const isIntZero = (n) => n && n.kind === 'int' && Number(n.data) === 0;
  const isZero32 = (n) => n && n.kind === 'array' && n.data.length === 32 && n.data.every(b => Number(b.data) === 0);
  if (!Array.isArray(spineCtor) || spineCtor.length < 12) throw new Error(`spineCtor must have 12 ctor nodes (PoolSpine_v08_shard), got ${spineCtor && spineCtor.length}`);
  if (!isIntZero(spineCtor[7])) throw new Error('genesis seed: init_closed (idx 7) must be int 0 (open) — fold/register induction base case');
  if (!isIntZero(spineCtor[8])) throw new Error('genesis seed: init_winningSide (idx 8) must be int 0 (canonical) — fold L109 new.winningSide==0');
  if (!isZero32(spineCtor[9])) throw new Error('genesis seed: init_payoutRoot (idx 9) must be ZERO32 — fold L110 pins new.payoutRoot==init_payoutRoot');
  if (!isZero32(spineCtor[10])) throw new Error('genesis seed: init_fold_tmpl_hash (idx 10) must be ZERO32 (genesis)');
  if (!isIntZero(spineCtor[11])) throw new Error('genesis seed: init_shard_count (idx 11) must be int 0 (genesis; close_commit attests final count)');
}

/**
 * Full create-phase per-market artifact bundle. Chains spine → PoolSide (single-source ctor + silverc).
 * @param {object} opts { spineSilPath, poolSideSilPath, spineCtor, poolSideCtorBase (6 State init, WITHOUT spine_template_hash), silvercPath? }
 * @returns {{ spine, poolSide }}  spine={templateHashHex,prefixLen,suffixLen}, poolSide={templateHashHex,prefix/suffix,...}
 */
export function computeMarketCreateArtifacts({ spineSilPath, poolSideSilPath, spineCtor, poolSideCtorBase, silvercPath = SILVERC }) {
  assertCanonicalGenesisSpineSeed(spineCtor); // fail-fast: genesis must seed canonical zero outcome (induction base + cross-node determinism)
  const spine = computeSpineArtifact(spineSilPath, spineCtor, silvercPath);
  const poolSideCtor = [...poolSideCtorBase, ctorBytes32(spine.templateHashHex)];
  const poolSide = computePoolSideArtifact(poolSideSilPath, poolSideCtor, silvercPath);
  return { spine, poolSide };
}
