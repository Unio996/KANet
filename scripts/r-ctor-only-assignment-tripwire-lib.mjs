// r-ctor-only-assignment-tripwire-lib.mjs — R-CTOR-ONLY-ASSIGNMENT-TRIPWIRE 判定逻辑单源
// (T4 v0.4 §1.3, docs/2026-09-14-j2-t4-market-genesis-console-side-skeleton-v0.4.md, ledger 1203/1204)。
//
// 拆成独立无副作用文件（同 m0a-lib.mjs 之于 lint-kanet.mjs 的既有分层惯例）——lint-kanet.mjs 顶层是一段
// 立即执行并以 process.exit() 收尾的脚本，不是纯模块：直接 `import` 它会把整个 lint 跑一遍并让进程退出，
// 测试文件永远跑不到自己的断言。判定逻辑单独放这里，两边（lint-kanet.mjs 的检查函数 + 测试文件的单元测试）
// 各自 import，互不干扰。
//
// poolMerkleRoot/committee_hash/predicate_commit 三字段是 T4 创世对照 (c)+(d) 覆盖论证的唯一前提（"这三个
// 字段在全部 T3 合约里永远 ctor-only、从未被赋值"）的具身条件——当前(J2/NWT 独立 grep)为真，但这是运行期
// 可能被打破的代码事实，不是 silverscript 语言层面的保证（它们只是普通 byte[32] ctor 参数，没有语言级
// const 保护）。

export const CTOR_ONLY_TRIPWIRE_FIELDS = ['poolMerkleRoot', 'committee_hash', 'predicate_commit'];
const CTOR_ONLY_TRIPWIRE_RE = new RegExp(`\\b(${CTOR_ONLY_TRIPWIRE_FIELDS.join('|')})\\s*=(?!=)`);

// 纯函数（内容 in, 命中数组 out）——不碰 fs/git/ROOT，直接单元测。.sil 只有 `//` 行注释、无 `/* */` 块注释
// （已核实全仓 59 个 .sil 文件零命中），按行内 `//` 切一刀去掉尾随注释即可，不需要接 silverc tokenizer。
export function findCtorOnlyTripwireHits(content) {
  const hits = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const codeOnly = lines[i].split('//')[0];
    const m = codeOnly.match(CTOR_ONLY_TRIPWIRE_RE);
    if (m) hits.push({ field: m[1], line: i + 1 });
  }
  return hits;
}
