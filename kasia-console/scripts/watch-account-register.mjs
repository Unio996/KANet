#!/usr/bin/env node
// watch-account-register.mjs — D-028 一次性登记只读(冷存)账户。只写、不执行——落库上线后由 KANet-UI 在 Bettor GO 之后跑(--apply 是对主网库的写)。
//   DB_PATH=<主网库绝对路径> node kasia-console/scripts/watch-account-register.mjs --from-file <仓库外的输入文件>          (dry-run,默认)
//   DB_PATH=<...>            node kasia-console/scripts/watch-account-register.mjs --from-file <文件> --apply                 (写库,全有或全无)
//   ... | node kasia-console/scripts/watch-account-register.mjs --stdin [--apply]
// 输入行: `名字<TAB>地址[<TAB>一句话来历]`(# 注释与空行跳过)。执行后由执行人删除输入文件。
// 🔴 不接受任何命令行地址/名字(进程表/PowerShell 历史/日志会留痕): 只认 --from-file / --stdin / --apply / --help;其它一律退出 2 且不回显值。
// 🔴 回执只打条数与规范化后的前缀 + 末 6 位;不打名字、不打完整地址。
// 退出码: 0 = 完成(dry-run 或已写);2 = 用法/环境错;3 = 有行被拒(什么都没写)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseInput, registerWatchAccounts } from '../src/lib/watch-account-register.mjs';

const argv = process.argv.slice(2);
const die = (code, msg) => { console.log(msg); process.exit(code); };
const ALLOWED = new Set(['--from-file', '--stdin', '--apply', '--help']);
let fromFile = null, useStdin = false, apply = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!ALLOWED.has(a)) die(2, 'refused: unknown or positional argument (addresses and names are NEVER accepted on the command line; use --from-file <path> or --stdin)');
  if (a === '--help') die(0, 'usage: --from-file <path outside the repo> | --stdin  [--apply]   (input lines: name<TAB>address[<TAB>note]; default is dry-run)');
  if (a === '--apply') apply = true;
  else if (a === '--stdin') useStdin = true;
  else if (a === '--from-file') { fromFile = argv[++i]; if (!fromFile || fromFile.startsWith('--')) die(2, 'refused: --from-file needs a path'); }
}
if (!!fromFile === useStdin) die(2, 'refused: give exactly one of --from-file <path> or --stdin');
if (!process.env.DB_PATH) die(2, 'refused: set DB_PATH to the console database (client.js refuses to guess the live DB)');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let text;
if (fromFile) {
  const abs = path.resolve(fromFile);
  const rel = path.relative(repoRoot, abs);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) die(2, 'refused: the input file must live OUTSIDE the repository (it holds names and addresses; it must never be committable)');
  try { text = fs.readFileSync(abs, 'utf8'); } catch (e) { die(2, `cannot read input file: ${e.code || 'error'}`); }
} else {
  text = fs.readFileSync(0, 'utf8');
}

const { sqlite } = await import('../src/db/client.js');
let Address;
try { ({ Address } = await import('kaspa-wasm')); } catch (e) { die(2, `cannot load kaspa-wasm: ${e.message}`); }

const entries = parseInput(text);
const report = registerWatchAccounts({ db: sqlite, entries, apply, Address });
console.log(`mode=${report.mode} db=${path.basename(process.env.DB_PATH)} lines=${entries.length} accepted=${report.accepted.length} rejected=${report.rejected.length} warnings=${report.warnings.length} applied=${report.applied}`);
for (const a of report.accepted) console.log(`ACCEPT line=${a.line} ${a.short}`);
for (const r of report.rejected) console.log(`REJECT line=${r.line}${r.short ? ' ' + r.short : ''} reason=${r.reason}`);
for (const w of report.warnings) console.log(`WARN line=${w.line} ${w.short} appears in ${w.table}.${w.column} (${w.hits} rows): this address may once have been a LOCAL relay identity; review, not blocked`);
const sk = report.skippedUnparseable; if (sk.relay_nodes || sk.agent_wallets || sk.watch_accounts) console.log(`NOTE unparseable existing addresses skipped in duplicate check: relay_nodes=${sk.relay_nodes} agent_wallets=${sk.agent_wallets} watch_accounts=${sk.watch_accounts}`);
if (report.rejected.length) die(3, 'NOTHING WRITTEN: at least one line was rejected');
if (!apply) console.log('dry-run: nothing written. Re-run with --apply (after NWT check + Bettor GO).');
else console.log('applied. Delete the input file now.');
process.exit(0);
