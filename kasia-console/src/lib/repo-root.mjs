// J2 2026-07-25 — 共享 repo root 解析 helper（Bettor/NWT/KANet-UI 定案：根治"ROOT-depth bug"复发
// 族，2026-07-25 这轮 G5 深审连撞两次：health.js 照抄 G5 的 4 层'../../../..'但自己只 3 层深，
// reconcile 脚本照抄又错成 3 层但自己只 2 层深——每个文件硬编码"往上跳几层"这个数字本身就是 bug
// 温床，文件挪位置/新文件深度算错都会静默产出错误 ROOT。
//
// 根治：不再硬编码层数，从调用文件所在目录往上走，直到找到 .git 目录为止——这对任何深度的文件都
// 天然正确，不需要每次新增文件时人工数斜杠。

import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * 从 startDir 往上walk, 找到含 .git 目录的那层, 返回其绝对路径(即 repo root)。
 * @param {string} startDir 调用方文件所在目录(通常传 path.dirname(fileURLToPath(import.meta.url)))
 * @returns {string} repo root 绝对路径
 */
export function getRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`getRepoRoot: 从 ${startDir} 往上走到了文件系统根都没找到 .git 目录`);
    }
    dir = parent;
  }
}
