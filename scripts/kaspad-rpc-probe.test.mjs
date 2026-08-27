// 防回归向量 (NWT 2026-08-27): STATE_FILE 默认路径必须绝对 + 含分隔符 + dirname 存在 + 非 drive-relative。
// 守 2026-08-27 单反斜杠 bug: 'D:\kaspa-tn12-data\...' 被 JS 吃成 'D:kaspa-tn12-data...' = drive-relative
// ⇒ 状态文件落 cwd 相关位置 ⇒ prev=null 恒真 ⇒ code 8 STALL 检测静默失效。
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const probe = join(__dirname, 'kaspad-rpc-probe.mjs');
const out = execFileSync('node', [probe, '--print-state-path'], { encoding: 'utf8' }).trim();

let pass = 0, fail = 0;
const assert = (n, c) => { if (c) { pass++; console.log(`PASS ${n}`); } else { fail++; console.log(`FAIL ${n} (got: ${out})`); } };
assert('isAbsolute', isAbsolute(out));
assert('has-separator', /[/\\]/.test(out));
assert('not-drive-relative', !/^[A-Za-z]:[^/\\]/.test(out)); // D:kaspa... (盘符后无分隔符) = bug 形态
assert('dirname-exists', existsSync(dirname(out)));
console.log(`==== probe state-path VA: pass=${pass} fail=${fail} ====`);
process.exit(fail > 0 ? 1 : 0);
