// oracle-code-manifest 确定性单元测试 (KANet-UI wave1 #3). 跑: node kasia-console/src/lib/oracle-code-manifest.test.mjs
// 守: 纯函数同进程多次调用 byte-equal / 缓存一致 / manifest 清单 sorted+含判决依赖 / hash 形态 64-hex。
import { computeOracleCodeManifestHash, getOracleCodeManifestHash, ORACLE_SETTLE_MANIFEST, warnAxisMismatch, hashFileContentNormalized } from './oracle-code-manifest.mjs';

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; console.error(`✘ ${name}`); }
}
function eq(got, want, name) {
  if (got === want) { pass++; }
  else { fail++; console.error(`✘ ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}

// ── 确定性: 同进程多次 compute → byte-equal (跨节点同文件 → 同 hash 的本机自证) ──
const h1 = computeOracleCodeManifestHash();
const h2 = computeOracleCodeManifestHash();
eq(h1, h2, 'compute 同进程两次 byte-equal');

// ── hash 形态: 64-char 小写 hex (sha256) ──
ok(/^[0-9a-f]{64}$/.test(h1), 'hash 是 64-char hex sha256');

// ── 缓存: getOracleCodeManifestHash() == compute (lazy cache 不变值) ──
eq(getOracleCodeManifestHash(), h1, 'getOracleCodeManifestHash == compute');
eq(getOracleCodeManifestHash(), getOracleCodeManifestHash(), 'cached 多次调用一致');

// ── manifest 清单不变量 ──
const m = ORACLE_SETTLE_MANIFEST;
ok(Array.isArray(m) && m.length >= 5, 'manifest 非空 (≥5 判决路文件)');
const sorted = [...m].sort();
ok(JSON.stringify(m) === JSON.stringify(sorted), 'manifest sorted (顺序无关确定性)');
ok(new Set(m).size === m.length, 'manifest 无重复 (每文件算一次)');
// 判决依赖必在清单 (NWT hash集==输入集 的码层对偶: 漏一个 = 那文件漂移逃闸)
ok(m.includes('src/lib/judgeline.mjs'), 'manifest 含 judgeline (J1 D-L1)');
ok(m.includes('src/lib/oracle-evidence-extractors.mjs'), 'manifest 含 extractors (J2 normalizeAbbr/抽取)');
ok(m.includes('src/services/bettor-prediction-voter.js'), 'manifest 含 voter (deriveKanetNativeVote)');
ok(m.includes('src/services/pool-market-settler.js'), 'manifest 含 settler (decideConsensusV06)');
ok(m.includes('src/lib/oracle-code-manifest.mjs'), 'manifest self-include (改清单即改 hash)');

// ── CRLF/LF 不变性 (NWT probe 命门: Windows working-tree CRLF vs git blob LF 必产同 hash) ──
//   不修(无 normalize)此断言会 fail = 证 bug。修后 PASS = 跨节点 autocrlf 差不漂版本。
eq(hashFileContentNormalized('a\r\nb\r\nc'), hashFileContentNormalized('a\nb\nc'), 'CRLF == LF hash 不变 (跨节点 autocrlf robust)');
eq(hashFileContentNormalized('x\ny'), hashFileContentNormalized('x\ny'), 'LF == LF (sanity)');
ok(/^[0-9a-f]{64}$/.test(hashFileContentNormalized('z')), 'hashFileContentNormalized 形态 64-hex');

// ── 诊断面 warnAxisMismatch (条件②可归因): 可调用·不抛·返回结构化区分 axis ──
let threw = false, diag;
const _origWarn = console.warn; console.warn = () => {};  // 静音测试期 warn 噪音
try { diag = warnAxisMismatch({ marketId: 'mkt123456789abc', axis: 'code', voterPk: 'pk0987654321def', quorumHash: 'aaaa', voterHash: 'bbbb' }); }
catch { threw = true; }
console.warn = _origWarn;
ok(!threw, 'warnAxisMismatch 不抛');
eq(diag?.axis, 'code', 'warnAxisMismatch 返回 axis (区分码漂/源漂)');
ok(diag?.marketId?.length <= 12 && diag?.voterPk?.length <= 12, 'warnAxisMismatch 截断 id (日志可读)');

console.log(`oracle-code-manifest test: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
