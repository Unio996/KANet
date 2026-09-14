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
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { blake2b } from '@noble/hashes/blake2b';
import { extractTemplateArtifact } from './pool-template-artifact.mjs';
import { procStep } from './diag-step.mjs';   // M10 v2 observe-only (2026-09-05): 同步子进程站计时, 纯透传

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

// silverc 子进程调用(sha256(source+silvercPath+ctor) cache + timeout:30_000)——compileSil(旧 schema)与
// compileSilV100(新 schema, 下方)共用这一段, 各自在拿到原始 JSON 之后按自己的 schema 校验/整形, 不重复
// 维护两份几乎一样的 execFileSync+cache 逻辑。cache key 含 silvercPath, 旧/新两个二进制天然各自独立缓存,
// 不会互相污染(同一份既有纪律, 见下方 compileSil 原注释)。
function _runSilverc(silPath, ctorArr, silvercPath) {
  const ctorJsonStr = JSON.stringify(ctorArr);
  const sourceHash = createHash('sha256').update(readFileSync(silPath)).digest('hex').slice(0, 16);
  const cacheKey = createHash('sha256').update(sourceHash + silvercPath + ctorJsonStr).digest('hex');
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = join(CACHE_DIR, `${cacheKey}.json`);
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8'));

  const dir = mkdtempSync(join(tmpdir(), 'bshard-art-'));
  const ctorPath = join(dir, 'ctor.json'), outPath = join(dir, 'out.json');
  writeFileSync(ctorPath, ctorJsonStr);
  try {
    // M10 v2 observe-only: procStep 只计时打一行 [diag:step] proc.silverc.compile.bshard-artifacts, 异常对象原样透传(下方 catch 照读 e.stderr/e.code)
    procStep('proc.silverc.compile.bshard-artifacts', 'silverc', () => execFileSync(silvercPath, [silPath, '--ctor', ctorPath, '-o', outPath], { stdio: 'pipe', timeout: 30_000 }));
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
  writeFileSync(cacheFile, JSON.stringify(o));
  return o;
}

/** Compile a .sil with ctor JSON via silverc → {script:number[], state_layout:{start,len}} (silverc -o JSON). */
export function compileSil(silPath, ctorArr, silvercPath = SILVERC) {
  const o = _runSilverc(silPath, ctorArr, silvercPath);
  if (!Array.isArray(o.script) || !o.state_layout) throw new Error(`silverc output missing script/state_layout for ${silPath}`);
  return o;
}

/** ctor helpers (旧 silverc ctor JSON node format——SILVERC_LEGACY/SILVERC_ZK 两个旧二进制专用, 不适用 v1.0.0)。 */
export const ctorBytes32 = (hexOrBuf) => {
  const b = Buffer.isBuffer(hexOrBuf) ? hexOrBuf : Buffer.from(hexOrBuf, 'hex');
  if (b.length !== 32) throw new Error(`bytes32 must be 32B, got ${b.length}`);
  return { kind: 'array', data: [...b].map(x => ({ kind: 'byte', data: x })) };
};
export const ctorInt = (n) => ({ kind: 'int', data: Number(n) });

// ── silverc v1.0.0(D-019 锚点, ledger 1216-1218) ──────────────────────────────────────────────────────
//
// 生产权威二进制、产物 schema、ctor JSON 方言都跟上面的旧 SILVERC_LEGACY/SILVERC_ZK **不是同一族**——
// 三处都实测确认过差异, 不是猜测:
//   ① 产物 schema: 旧 = 顶层 {script:number[], state_layout:{start,len}}；v1.0.0 = 嵌套
//      {contracts:{<ContractName>:{compiled:{bytecode:hexString, template_hash:byte[], state_span:{offset,len}}}}}。
//   ② ctor JSON 节点方言: 旧 = {kind:'array',data:[{kind:'byte',data:n},...]} / {kind:'int',data:n}；
//      v1.0.0 = {kind:'bytes',value:[...]} / {kind:'int',value:n}(实测: 旧方言喂 v1.0.0 CLI 直接
//      "missing field `value`" 拒收, 不是"能凑合用旧格式"——两族 ctor 数组不能混用同一份 helper)。
//   ③ 编译器本身: SILVERC_ZK_PATH(silverc-zk-8065184.exe)连当前(v1.0.0 语法迁移后) CloseZkV2.sil 都解析
//      不了(`as byte[8]` 转型语法, parse error), 不只是 ctor 参数数不对——这是 T3 语法迁移(b5a2924c 等)
//      之后, 旧编译器对主网集 .sil 文件已经**结构性作废**, 不是"版本旧但还能凑合编"。
//
// 权威锚点 = scripts/silverc-pin.json（D-019）：name/commit/sha256/schema 版本单源记录，本文件只读它，不
// 重复内嵌 sha256 字面量（同"避免同一事实两处各存一份必陈"通则）。
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SILVERC_PIN_PATH = join(REPO_ROOT, 'scripts', 'silverc-pin.json');
export const DEFAULT_SILVERC_V100_PATH = 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';

let _silvercPinCache = null;
function _loadSilvercPin() {
  if (_silvercPinCache) return _silvercPinCache;
  if (!existsSync(SILVERC_PIN_PATH)) throw new Error(`silverc-pin.json 不存在: ${SILVERC_PIN_PATH}（D-019 权威锚点缺失, 拒绝编译）`);
  const raw = JSON.parse(readFileSync(SILVERC_PIN_PATH, 'utf8'));
  if (!/^[0-9a-f]{64}$/i.test(String(raw.sha256 || ''))) throw new Error(`silverc-pin.json 的 sha256 字段缺失或格式非法(${SILVERC_PIN_PATH})`);
  _silvercPinCache = raw;
  return raw;
}

/**
 * 启动/每次调用前算二进制 sha256, 与 scripts/silverc-pin.json(D-019)比对——不符即拒跑, 不猜哪个对
 * (ledger 1216 原话: "启动 sha256 自检不符即拒跑")。不做跨调用缓存"上次核过就跳过"——sha256 一份
 * ~5MB 二进制是毫秒级, 这不是热路径(创世/anchor 计算低频), 正确性优先于这点性能, 也避免"文件被换了但
 * 内存里缓存的还是旧核对结果"这类窗口。
 * @param {string} v100Path
 * @returns {object} pin 文件内容(调用方可能想读 artifactSchemaVersion 等字段)
 */
export function assertSilvercV100Pinned(v100Path) {
  const pin = _loadSilvercPin();
  if (!existsSync(v100Path)) {
    throw new Error(`silverc v1.0.0 二进制不存在: ${v100Path}（env SILVERC_V100_PATH 或默认路径 ${DEFAULT_SILVERC_V100_PATH}）— 不接受"文件缺失就跳过检查"`);
  }
  const actualSha256 = createHash('sha256').update(readFileSync(v100Path)).digest('hex');
  if (actualSha256 !== pin.sha256) {
    throw new Error(`silverc v1.0.0 二进制 sha256 不符 D-019 锚点(${SILVERC_PIN_PATH}): 期望 ${pin.sha256}, 实际 ${actualSha256}(路径 ${v100Path}) — 拒绝编译, 不猜哪个对`);
  }
  return pin;
}

/**
 * 黄金样本 deep-equal 校验(ledger 1221, Bettor)：Rust 不是可复现构建——同一份源码在不同机器/不同时间干净
 * 重建，产出的可执行文件 sha256 可以不同（已实证：NWT 独立干净构建的二进制 sha256 与本文件不同，D-019
 * 注记记录为构建环境差异，不是分叉/被调包）——**二进制 sha256 只是防调包指纹**（挡"这文件被换成完全不
 * 相干的东西"这种粗暴篡改），**不是"这就是同一个编译器"的判据**。真正的同源判据是：拿一份固定 `.sil` +
 * 固定 ctor 在待核二进制上编译一次，产物 `bytecode` 逐字节 deep-equal 参考值——只要三方对同一源码产出
 * 逐字节相同的机器码，就证明它们是"同一个编译器在做同一件事"，无论各自可执行文件本身的 sha256 是否一致。
 * @param {string} v100Path
 */
export function assertSilvercV100GoldenSample(v100Path) {
  const pin = _loadSilvercPin();
  const g = pin.goldenSample;
  if (!g || !g.silPath || !g.contractName || !Array.isArray(g.ctor) || !g.expectedBytecodeSha256) {
    throw new Error(`silverc-pin.json 缺 goldenSample{silPath,contractName,ctor,expectedBytecodeSha256} 字段(${SILVERC_PIN_PATH}) — ledger 1221 要求，不接受只核二进制 sha256`);
  }
  const goldenSilAbsPath = join(REPO_ROOT, g.silPath);
  if (!existsSync(goldenSilAbsPath)) throw new Error(`黄金样本源文件不存在: ${goldenSilAbsPath}(pin 文件 goldenSample.silPath=${g.silPath})`);
  const o = _runSilverc(goldenSilAbsPath, g.ctor, v100Path);
  const c = o?.contracts?.[g.contractName];
  const bytecode = c?.compiled?.bytecode;
  if (!Array.isArray(bytecode)) {
    throw new Error(`黄金样本编译产物里没有 contracts["${g.contractName}"].compiled.bytecode(number[]) — 二进制跑起来了但产物形状不对, 拒绝信任(${v100Path})`);
  }
  const actualSha256 = createHash('sha256').update(Buffer.from(bytecode)).digest('hex');
  if (actualSha256 !== g.expectedBytecodeSha256) {
    throw new Error(`黄金样本编译产物 sha256 不符 D-019 锚点(${SILVERC_PIN_PATH} goldenSample.expectedBytecodeSha256): 期望 ${g.expectedBytecodeSha256}, 实际 ${actualSha256}(二进制 ${v100Path}) — 二进制 sha256 或许对得上，但同源判据不过，拒绝编译`);
  }
}

/**
 * 启动期自检(observability-only, ledger 1230/1233)——console 启动时若 SILVERC_V100_PATH 已设, 跑一遍两道
 * D-019 校验并 LOUD 打印固定格式日志行, 供 KANet-UI 部署页/人工巡检一眼判断"这台机器的 v1.0.0 编译器锚点
 * 对不对"。**这个函数本身永不 throw**——真正的承重闸在 compileSilV100 内部(每次真实编译前都会调
 * assertSilvercV100Pinned/assertSilvercV100GoldenSample, 那两个函数该抛照抛), 本函数只是把同一次检查提前
 * 到进程启动时做一遍、把结果 LOUD 打出来, 让"这台机器编译器锚点从一开始就不对"这件事不用等到第一次真实
 * genesis-mint 才会被发现——FAIL 不阻止 console 正常启动继续跑 relay 等其它职责(SILVERC_V100_PATH 未设
 * 视为"这台机器暂不需要这条能力", 直接跳过, 不算 FAIL)。
 *
 * 固定日志格式(写入 README, KANet-UI 部署页据此判断, 改动前跟部署方同步)：
 *   PASS: `[silverc-pin] PASS sha256=<前8位hex>... golden=<goldenSample.contractName> ok`
 *   FAIL: `[silverc-pin] FAIL <错误信息全文>`
 *   跳过(未设 env): 不打印任何行(沉默, 不是"隐藏失败"——本来就不要求这台机器具备这条能力)。
 * @param {string} [v100Path] 默认 env SILVERC_V100_PATH；显式传 undefined/空字符串 = 跳过检查
 * @returns {{skipped:true}|{ok:true,sha256:string,golden:string}|{ok:false,error:string}}
 */
export function checkSilvercPinAtStartup(v100Path = process.env.SILVERC_V100_PATH) {
  if (!v100Path) return { skipped: true };
  try {
    const pin = assertSilvercV100Pinned(v100Path);
    assertSilvercV100GoldenSample(v100Path);
    console.log(`[silverc-pin] PASS sha256=${pin.sha256.slice(0, 8)}... golden=${pin.goldenSample?.contractName || '?'} ok`);
    return { ok: true, sha256: pin.sha256, golden: pin.goldenSample?.contractName };
  } catch (e) {
    console.error(`[silverc-pin] FAIL ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/**
 * Compile a .sil with ctor JSON via silverc v1.0.0 → 适配成旧 schema 形状返回({script,state_layout}), 让
 * extractTemplateArtifact 等既有下游零改动直接吃, 不用为新 schema 另外教一遍下游代码。
 * @param {string} silPath
 * @param {Array} ctorArr v1.0.0 ctor JSON 数组(用 ctorBytes32V100/ctorIntV100 构造, 不是上面旧的 ctorBytes32/ctorInt)
 * @param {string} contractName .sil 里 `contract <Name>(...)` 的确切名字——v1.0.0 产物按这个 key 嵌套
 *   (`contracts[contractName]`), 必须与源码里的名字逐字一致, 不猜大小写/下划线变体
 * @param {string} [v100Path] 默认 env SILVERC_V100_PATH, 缺省时退到 pin 文件记录的生产路径(D-019)——注意:
 *   落码/本地测试期间生产路径可能还没放好二进制, 必须显式设 SILVERC_V100_PATH 指向自己的干净构建,
 *   assertSilvercV100Pinned 的 sha256 核对不因为"本地测试"就放宽。
 * @returns {{script:number[], state_layout:{start:number,len:number}, template_hash_bytes:number[]|undefined, _raw:object}}
 */
export function compileSilV100(silPath, ctorArr, contractName, v100Path = process.env.SILVERC_V100_PATH || DEFAULT_SILVERC_V100_PATH) {
  assertSilvercV100Pinned(v100Path);       // ① 二进制 sha256 == D-019 锚点(防调包)
  assertSilvercV100GoldenSample(v100Path); // ② 黄金样本 deep-equal(真正的同源判据, ledger 1221)
  const o = _runSilverc(silPath, ctorArr, v100Path);
  const c = o?.contracts?.[contractName];
  if (!c || !c.compiled) {
    throw new Error(`silverc v1.0.0 产物里没有 contracts["${contractName}"].compiled — 检查 .sil 里 contract 名是否与传入的 contractName 精确一致(${silPath}), 现有顶层 contracts key: ${Object.keys(o?.contracts || {}).join(',') || '(none)'}`);
  }
  const { bytecode, template_hash, state_span } = c.compiled;
  // 实测更正(落码期间自测发现, 非猜测): bytecode 是**字节数组**(number[], 同旧 schema 的 script 字段)，
  // **不是 hex 字符串**——最初以为是 hex 字符串纯属没查 typeof 就假设，已用真实编译产物(RefundClaim.sil)
  // 验证 typeof bytecode === 'object' 且 Array.isArray(bytecode) === true, 值域 0-255。
  if (!Array.isArray(bytecode) || !state_span || typeof state_span.offset !== 'number' || typeof state_span.len !== 'number') {
    throw new Error(`silverc v1.0.0 产物 contracts["${contractName}"].compiled 缺 bytecode(number[])/state_span{offset,len} — schema 漂移? (${silPath})`);
  }
  return {
    script: bytecode,
    state_layout: { start: state_span.offset, len: state_span.len },
    template_hash_bytes: Array.isArray(template_hash) ? template_hash : undefined,
    _raw: o,
  };
}

/** ctor helpers for silverc v1.0.0(D-019)——方言与上面旧的 ctorBytes32/ctorInt 不同, 见本节顶部①②③。 */
export const ctorBytes32V100 = (hexOrBuf) => {
  const b = Buffer.isBuffer(hexOrBuf) ? hexOrBuf : Buffer.from(hexOrBuf, 'hex');
  if (b.length !== 32) throw new Error(`bytes32V100 must be 32B, got ${b.length}`);
  return { kind: 'bytes', value: [...b] };
};
export const ctorIntV100 = (n) => ({ kind: 'int', value: Number(n) });

/**
 * PoolRoot artifact (CP3, J2 2026-08-13 · @Bettor 21:0xZ 采纳 @J1tn (205) 升级为设计定向).
 *
 * 为什么要这个函数（而不是继续让调用方传一个松散前缀串）:
 *   `buildRefundCommand` 原先收 `poolTemplatePrefixHex` —— 一个**调用方自己给的**字符串, 只验 hex 格式 +
 *   `redeem.startsWith(它)`。那只证明"调用方回传了这份 redeem 的前几个字节", **不证明这些字节来自
 *   被认证的 PoolRoot 模板** (Codex 抓的松散点)。而 `state_layout.start` 是 **silverc 对这份 .sil 直接吐出的**
 *   state 起始 offset —— 池腿的权威一直在这里, 不用新造, 只是以前没被取用。
 *
 * ⚠ 本函数**只出编译产物**, 不在这里算 `blake2b(prefix‖suffix)` 当"自验":
 *   那样左右两边都来自**同一次编译**, 等于自己跟自己比(CP3 §4)。跨边界的那一比在 builder 里做,
 *   另一端必须是**烤死/构造记录**的 `root_tmpl_hash`。
 *
 * @param {string} poolRootSilPath
 * @param {Array} poolRootCtor  16 项, 见 pool-bshard-market-setup.mjs:45-49
 * @returns {{script:number[], state_layout:{start:number,len:number}, redeemLen:number}}
 */
export function computePoolRootArtifact(poolRootSilPath, poolRootCtor, silvercPath = SILVERC) {
  const compiled = compileSil(poolRootSilPath, poolRootCtor, silvercPath);
  const sl = compiled.state_layout;
  if (!Number.isInteger(sl?.start) || !Number.isInteger(sl?.len)) {
    throw new Error(`computePoolRootArtifact: state_layout.{start,len} 必须是整数, 得到 ${JSON.stringify(sl)}`);
  }
  return { script: compiled.script, state_layout: { start: sl.start, len: sl.len }, redeemLen: compiled.script.length };
}

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
