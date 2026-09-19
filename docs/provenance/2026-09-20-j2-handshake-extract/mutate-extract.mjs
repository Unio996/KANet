// 握手开关笔一——变异对照(小批量, 单文件测试逐个跑; 提交内存 80% 限制期间不跑大批量)。
// 每个变异: 备份 → 改一处 → 跑 handshake-accept.test.mjs → 必须【红】(退出码非 0)→ 无论如何还原并确认字节相同。
// 用法: node docs/provenance/2026-09-20-j2-handshake-extract/mutate-extract.mjs > mutation-raw.txt
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MOD = path.join(ROOT, 'kasia-relay/src/lib/handshake-accept.mjs');
const RELAY = path.join(ROOT, 'kasia-relay/src/relay.mjs');
const TEST = 'src/lib/handshake-accept.test.mjs';

// [id, 文件, 找, 换, 说明]; 找必须恰命中 1 次(除非 all:true)
const MUTANTS = [];
const M = (id, file, find, repl, why, opt = {}) => MUTANTS.push([id, file, find, repl, why, opt]);
M('M1', MOD, 'if (_acceptedPeers.has(peer)) {', 'if (false) {', '删内存去重 ⇒ 同 peer 重复接受');
M('M2', MOD, "log(\"HANDSHAKE from\", peer.slice(-12), \"→ already\", rs.status, \"in DB, skipping\");\n          _acceptedPeers.add(peer);", "log(\"HANDSHAKE from\", peer.slice(-12), \"→ already\", rs.status, \"in DB, skipping\");", 'DB 命中后不记内存 ⇒ 之后每次都再 fetch');
M('M3', MOD, " || rs.status === 'confirmed'", '', "DB 跳过集合去掉 confirmed");
M('M4', MOD, "      const sent = await sendKaspa({ to: draft.to, amount: draft.amount, payload: draft.payload });", "      _acceptedPeers.add(peer);\n      const sent = await sendKaspa({ to: draft.to, amount: draft.amount, payload: draft.payload });", '乐观写入: 发送前先记内存(NO TX NO STATE 违反)');
M('M5', MOD, "amount: '0.2'", "amount: '0.3'", 'ingestTx 金额改动');
M('M6', MOD, 'if (consoleUrl) {', 'if (true) {', '去掉 consoleUrl 空值保护 ⇒ 无 console 也 fetch');
M('M7', MOD, "  const _acceptedPeers = new Set(); // dedup: only accept handshake from each address once\n", '', '去重 Set 移出工厂(模块级共享)', { hoistSet: true });
M('M8', MOD, "      ingestHandshake({ localAddress, remoteAddress: peer, txid: sent?.txId });\n      ingestTx(", "      ingestTx(", '换 ingest 顺序(先 ingestTx 后 ingestHandshake)', { swapIngest: true });
M('M9', MOD, '"HANDSHAKE ACCEPT ERROR:"', '"HANDSHAKE ERROR:"', '改错误日志文案');
M('M10', MOD, 'peer.slice(-12), "→ already accepted (memory)', 'peer.slice(-10), "→ already accepted (memory)', '日志里 peer 截断位数改动');
M('M11', MOD, 'log("Accept draft failed:", draft); return; }', 'log("Accept draft failed:", draft); }', 'draft 失败后不 return(继续发送)');
M('M12', MOD, "encodeURIComponent(localAddress)", "encodeURIComponent(peer)", 'fetch URL 里 local 参数写错');
M('M13', RELAY, 'consoleUrl: CONSOLE_URL, localAddress });', 'consoleUrl: CONSOLE_URL });', 'relay.mjs 注入漏 localAddress');
M('M14', RELAY, 'fetch, log, ingestHandshake, ingestTx,', 'fetch, log, ingestHandshake,', 'relay.mjs 注入漏 ingestTx');
M('M15', RELAY, "// 入站握手接受", "const _acceptedPeers = new Set();\n// 入站握手接受", 'relay.mjs 残留旧去重 Set');

const run = () => spawnSync(process.execPath, [TEST], { cwd: path.join(ROOT, 'kasia-relay'), encoding: 'utf8', timeout: 120000 });
const base = run();
console.log(`BASELINE exit=${base.status} :: ${(base.stdout.match(/handshake-accept\.test: .*/) || ['?'])[0]}`);
if (base.status !== 0) { console.log('BASELINE 不绿, 中止'); process.exit(2); }

let survivors = 0;
for (const [id, file, find, repl, why, opt = {}] of MUTANTS) {
  const orig = fs.readFileSync(file, 'utf8');
  const n = orig.split(find).length - 1;
  if (n !== 1) { console.log(`${id}: 锚点命中 ${n} 次(应为 1) — 跳过 :: ${why}`); survivors++; continue; }
  let mutated = orig.replace(find, () => repl);
  if (opt.hoistSet) mutated = mutated.replace('export function createHandshakeAcceptor', () => "const _acceptedPeers = new Set();\nexport function createHandshakeAcceptor");
  if (opt.swapIngest) mutated = mutated.replace(/(      ingestTx\([^\n]*\n)/, (m) => m + "      ingestHandshake({ localAddress, remoteAddress: peer, txid: sent?.txId });\n");
  try {
    fs.writeFileSync(file, mutated);
    const r = run();
    const failLines = (r.stdout.match(/^\[FAIL\].*$/gm) || []).length;
    const red = r.status !== 0;
    if (!red) survivors++;
    console.log(`${id}: ${red ? 'KILLED' : 'SURVIVED'} exit=${r.status} fail=${failLines} :: ${why}`);
  } finally {
    fs.writeFileSync(file, orig);
    if (fs.readFileSync(file, 'utf8') !== orig) throw new Error('还原失败 ' + file);
  }
}
const after = run();
console.log(`RESTORED baseline exit=${after.status} :: ${(after.stdout.match(/handshake-accept\.test: .*/) || ['?'])[0]}`);
console.log(`SUMMARY mutants=${MUTANTS.length} survivors=${survivors}`);
process.exitCode = survivors ? 1 : 0;
