// 变异对照跑批: 逐个破坏 kasia-relay/src/lib/utxo-facts.mjs, 跑 utxo-facts.test.mjs, 期望每个变异至少一条 [FAIL]。
// 每次都在 finally 里还原并核对 sha256, 防止把变异留在工作树里。
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const REL = process.argv[2];                       // kasia-relay 目录(绝对路径)
const target = `${REL}/src/lib/utxo-facts.mjs`;
const test = 'src/lib/utxo-facts.test.mjs';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const orig = fs.readFileSync(target);
const origSha = sha(orig);
const origText = orig.toString('utf8');

const mutations = [
  ['M-a 删掉能力哨兵(covenant_id 字段缺失不再报错)', `!('covenantId' in inner)`, `false`],
  ['M-b 读顶层 e.covenantId(v0.3 前的"归一化惯性"错误)', `const cov = inner.covenantId;`, `const cov = e.covenantId;`],
  ['M-c 面值改升序(O1 的方向错误)', `return a.amount > b.amount ? -1 : 1;   // 面值降序(O1)`, `return a.amount > b.amount ? 1 : -1;`],
  ['M-d 去掉全序 tiebreak(同额只靠输入顺序)', `  if (a.txid !== b.txid) return a.txid < b.txid ? -1 : 1;           // 小写 hex 的字典序 == txid 字节序\n  return a.index - b.index;                                          // index 升序`, `  return 0;`],
  ['M-e facts 判据改成真值判断', `if (cmd.facts !== true) {`, `if (!cmd.facts) {`],
  ['M-f 响应去掉 factsVersion 回声', `const base = { ok: true, facts: true, factsVersion: FACTS_VERSION, form: req.form };`, `const base = { ok: true, facts: true, form: req.form };`],
  ['M-g 形态 O 也带 truncated', `return { ...base, found, missing };`, `return { ...base, found, missing, truncated: false };`],
  ['M-h 旧路径多带一个字段(字节不再不变)', `return { ok: true, utxos: await legacyGetAddressUtxos(cmd.address, getNetworkId()) };`, `return { ok: true, utxos: await legacyGetAddressUtxos(cmd.address, getNetworkId()), facts: false };`],
  ['M-i 共享 rpc 取失败时回落旧路径(违背"不回落")', `const rpc = await getSharedRpc();                       // 超时/未连接 ⇒ 抛错原样上抛(fail-closed)`, `let rpc; try { rpc = await getSharedRpc(); } catch { return { ok: true, utxos: await legacyGetAddressUtxos(cmd.address, getNetworkId()) }; }`],
  ['M-j pmt 校验被拆掉', `if (!Number.isSafeInteger(pmt) || pmt <= 0) {`, `if (false) {`],
  ['M-k observedAtMs 在读之前取', `const info = await withDeadline(() => rpc.getBlockDagInfo(), rpcCallMs, 'getBlockDagInfo');\n  const observedAtMs = nowMs();`, `const observedAtMs = nowMs();\n  const info = await withDeadline(() => rpc.getBlockDagInfo(), rpcCallMs, 'getBlockDagInfo');`],
  ['M-l 截断先于过滤(先切 200 再过滤 min/max)', `keyed.sort((a, b) => cmpKey(a.key, b.key));\n  const truncated = keyed.length > FACTS_LIST_MAX;\n  const utxos = keyed.slice(0, FACTS_LIST_MAX)`, `keyed.sort((a, b) => cmpKey(a.key, b.key));\n  const truncated = keyed.length > FACTS_LIST_MAX + 1;\n  const utxos = keyed.slice(0, FACTS_LIST_MAX + 1)`],
  ['M-m 金额改用 Number 比较(丢精度)', `if (a.amount !== b.amount) return a.amount > b.amount ? -1 : 1;   // 面值降序(O1)`, `if (Number(a.amount) !== Number(b.amount)) return Number(a.amount) > Number(b.amount) ? -1 : 1;`],
  ['M-n 允许 outpoints 与 minAmount 同时给', `if (hasOutpoints && hasBound) throw`, `if (false) throw`],
  ['M-o 塞入 new RpcClient(结构性扫描必须抓到)', `export const FACTS_VERSION = 1;`, `export const FACTS_VERSION = 1;\nconst _leak = () => new RpcClient({});`],
  // ── 9-0 NWT 审后新增(N-T1 / S-1)。find/repl 为数组 = 同时做多处替换(每处都必须恰好命中 1 次) ──
  ['M-p【NWT-e, N-T1】形态 O 的匹配键去掉 index(只按 txid 匹配)——原 33 项下存活的那个真缺口',
    [`const wanted = new Map(req.outpoints.map((o) => [\`\${o.transactionId}:\${o.index}\`, o]));`, `const k = \`\${key.txid}:\${key.index}\`;`, `const h = hit.get(\`\${o.transactionId}:\${o.index}\`);`],
    [`const wanted = new Map(req.outpoints.map((o) => [\`\${o.transactionId}:\`, o]));`, `const k = \`\${key.txid}:\`;`, `const h = hit.get(\`\${o.transactionId}:\`);`]],
  ['M-q【S-1】getUtxosByAddresses 调用去掉截止时间', `await withDeadline(() => rpc.getUtxosByAddresses([cmd.address]), rpcCallMs, 'getUtxosByAddresses');`, `await rpc.getUtxosByAddresses([cmd.address]);`],
  ['M-r【S-1】getBlockDagInfo 调用去掉截止时间', `await withDeadline(() => rpc.getBlockDagInfo(), rpcCallMs, 'getBlockDagInfo');\n  const observedAtMs`, `await rpc.getBlockDagInfo();\n  const observedAtMs`],
  ['M-s【S-1】超时/成功后不清定时器(每次调用漏一个)', `.finally(() => clearTimeout(timer));`, `.finally(() => {});`],
  ['M-t【S-1】超时错误码改名', `new FactsError('facts_rpc_timeout',`, `new FactsError('rpc_timeout',`],
  ['M-u【S-1】RPC 调用预算改成 50000(与 8000 之和 ≥ console 15000)', `export const FACTS_RPC_CALL_MS = 5000;`, `export const FACTS_RPC_CALL_MS = 50000;`],
  ['M-v【S-1】R2(handleGetPastMedianTime)的默认截止时间被设成 0(一切 rpc 都立刻超时)', `rpcCallMs = FACTS_RPC_CALL_MS }) {\n  const rpc = await getSharedRpc();`, `rpcCallMs = 0 }) {\n  const rpc = await getSharedRpc();`],
  ['M-w【NWT S1-f, T6b】R1(handleGetAddressUtxos)的默认截止时间被设成 0——T6 只测了 R2 的默认值, 这个变异原先存活', `legacyGetAddressUtxos, getNetworkId, rpcCallMs = FACTS_RPC_CALL_MS }) {`, `legacyGetAddressUtxos, getNetworkId, rpcCallMs = 0 }) {`],
];

let allRed = true;
try {
  for (const [name, find, repl] of mutations) {
    const finds = Array.isArray(find) ? find : [find], repls = Array.isArray(repl) ? repl : [repl];
    const bad = finds.map((f, i) => [i, origText.split(f).length - 1]).filter(([, c]) => c !== 1);
    if (bad.length) { console.log(`[ERR ] ${name}: 变异锚点命中次数不是恰 1 次(${bad.map(([i, c]) => `#${i}=${c}`).join(',')})——变异脚本与源码不同步`); allRed = false; continue; }
    let mutated = origText;
    finds.forEach((f, i) => { mutated = mutated.replace(f, repls[i]); });
    fs.writeFileSync(target, mutated);
    const r = spawnSync(process.execPath, [test], { cwd: REL, encoding: 'utf8', timeout: 120000 });
    const fails = (r.stdout || '').split('\n').filter((l) => l.startsWith('[FAIL]')).map((l) => l.slice(7, 40).trim());
    const crashed = r.status !== 0 && fails.length === 0;
    const red = fails.length > 0 || crashed;
    if (!red) allRed = false;
    console.log(`${red ? '[RED ]' : '[GREEN⚠ 变异存活!]'} ${name}  →  ${crashed ? '进程异常退出' : fails.length + ' 条失败'} ${fails.slice(0, 4).map((x) => '«' + x + '»').join(' ')}`);
  }
} finally {
  fs.writeFileSync(target, orig);
  const now = sha(fs.readFileSync(target));
  console.log(now === origSha ? `[RESTORED] utxo-facts.mjs 已还原, sha256 ${origSha.slice(0, 16)}… 一致` : `[!!! 还原失败 !!!] ${now} != ${origSha}`);
}
console.log(allRed ? '\n全部变异均被测试抓到' : '\n⚠ 有变异存活或锚点失配, 见上');
process.exit(allRed ? 0 : 1);
