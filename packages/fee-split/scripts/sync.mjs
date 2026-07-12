// sync.mjs — 唯一合法的 packages/fee-split/fee-split.mjs 写入路径(B线落3, NWT G1 修法②)。
// 单源: kasia-console/src/lib/fee-split.mjs 是真相源, 本脚本只做"读源+加生成头+原样写出", 不改一行逻辑。
// 手改 packages/fee-split/fee-split.mjs 会被 lint-kanet 的 R-FEE-SPLIT-PKG-DRIFT 规则(hash 校验)拦下。
// Run: node packages/fee-split/scripts/sync.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '../../../kasia-console/src/lib/fee-split.mjs');
const DEST = join(HERE, '../fee-split.mjs');

const src = readFileSync(SRC, 'utf8');
const hash = createHash('sha256').update(src).digest('hex');
const header = `// ⚠ 自动生成 — 勿手改。源 = kasia-console/src/lib/fee-split.mjs (sha256:${hash})\n` +
  `// 手改会被 lint-kanet R-FEE-SPLIT-PKG-DRIFT 拦下(commit 卡点, 非 WARN)。重新同步: node scripts/sync.mjs\n\n`;
writeFileSync(DEST, header + src);
console.log(`[sync] fee-split.mjs synced (sha256:${hash.slice(0, 16)}…) — 源逐字节复制, 生成头已加`);
