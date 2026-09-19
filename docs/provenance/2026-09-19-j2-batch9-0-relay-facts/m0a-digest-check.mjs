// M0a 摘要对照(自解释): 同一算法(scripts/m0a-lib.mjs 的 sha256Hex)分别对【基线提交】与【当前 HEAD】
// 各算一次 proto-relay-ipc.mjs, 并与各自提交里 manifest 的 PVF-proto-relay-ipc-funnel.content_digest 比对。
// 运行(在仓库根): node docs/provenance/2026-09-19-j2-batch9-0-relay-facts/m0a-digest-check.mjs
import { execFileSync } from 'node:child_process';
import { sha256Hex } from '../../../scripts/m0a-lib.mjs';

const REL = 'kasia-console/src/lib/proto-relay-ipc.mjs';
const MANIFEST = 'scripts/m0a-exception-manifest.json';
const show = (rev, p) => execFileSync('git', ['show', `${rev}:${p}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const manifestDigest = (rev) => {
  const m = JSON.parse(show(rev, MANIFEST));
  const e = (m.entries ?? m).find((x) => x.id === 'PVF-proto-relay-ipc-funnel');
  return { digest: e.content_digest, review_ref: e.review_ref };
};

let ok = true;
for (const [label, rev] of [['基线 6f6f9901', '6f6f9901'], ['当前 HEAD', 'HEAD']]) {
  const file = sha256Hex(show(rev, REL));
  const man = manifestDigest(rev);
  const match = file === man.digest;
  if (!match) ok = false;
  console.log(`${label}: 文件重算 ${file}`);
  console.log(`${' '.repeat(label.length + 1)} manifest  ${man.digest}   review_ref=${man.review_ref}   ${match ? '✅ MATCH' : '❌ MISMATCH'}`);
}
const base = sha256Hex(show('6f6f9901', REL)), head = sha256Hex(show('HEAD', REL));
console.log(`\n文件内容是否变化: ${base !== head ? '是(白名单多一行 read + 注释)——故 manifest digest 必须随之更新' : '否'}`);
console.log(`review_ref 未改(仍是上次批准的提交, 待 NWT 审本 diff 后更新): ${manifestDigest('6f6f9901').review_ref === manifestDigest('HEAD').review_ref ? '是' : '否'}`);
process.exit(ok ? 0 : 1);
