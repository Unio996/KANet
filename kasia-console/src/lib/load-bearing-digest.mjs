// B2(2026-07-25, Codex RESPONSE-20260725-G5-V2-COMMITTED-PARTIAL-CODEX-REVIEW B2, team 三方审
// GREEN): 启动冻结逐文件 digest manifest, 取代/降级仅靠 git diff 判定 runtime-equivalence。
//
// 问题: G5 v1/v2 早期只用 `git diff --stat <package_commit> <runtime_commit> --
// RUNTIME_SCOPE_DIRS` 判空即视为等价——这个判定基于当前磁盘状态跟 git 历史比较, 证明不了
// 进程实际加载进内存的字节(进程可能是脏树启动后又被 revert 干净、或者启动时用的是
// generated/未追踪文件, git diff 看不出这些)。
//
// 设计: health.js 在模块加载时(路由注册之前)调用一次 computeLoadBearingDigest(), 把结果
// 并入 runtime-identity 端点的响应体。G5 gate③ 拿这个 treeDigest 跟 snapshot 里 Owner/委派
// 批准 grant 时算好的 expected_load_bearing_tree_digest 逐字节比对, 不等直接 fail——git diff
// 降级为比对失败时的排障辅助输出, 不再是判定权威。

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

function walkFilesRecursive(absDir, rootDir, out) {
  for (const name of readdirSync(absDir)) {
    const abs = path.join(absDir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walkFilesRecursive(abs, rootDir, out);
    else out.push(path.relative(rootDir, abs).split(path.sep).join('/'));
  }
}

/**
 * @param {string} rootDir - 仓库根目录(getRepoRoot() 的返回值)
 * @param {string[]} scopeDirs - RUNTIME_SCOPE_DIRS(相对 rootDir 的文件/目录路径)
 * @returns {{ treeDigest: string, perFile: Record<string,string>, fileCount: number }}
 */
export function computeLoadBearingDigest(rootDir, scopeDirs) {
  const files = [];
  for (const scopePath of scopeDirs) {
    const abs = path.join(rootDir, scopePath);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isDirectory()) walkFilesRecursive(abs, rootDir, files);
    else files.push(path.relative(rootDir, abs).split(path.sep).join('/'));
  }
  files.sort(); // 确定性: 排序后的相对 POSIX 路径, 不受目录遍历顺序影响
  const perFile = {};
  for (const f of files) {
    perFile[f] = createHash('sha256').update(readFileSync(path.join(rootDir, f))).digest('hex');
  }
  const treeDigest = createHash('sha256')
    .update(files.map((f) => `${f}:${perFile[f]}`).join('\n'))
    .digest('hex');
  return { treeDigest, perFile, fileCount: files.length };
}
