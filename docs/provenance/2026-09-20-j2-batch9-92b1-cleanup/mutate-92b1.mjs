// 批9 9-2b (i) 清理笔——变异对照(单文件测试逐个跑): F3-1 / 无 DB import 守卫 / F5-1 两条扫描器对照。
// 用法(从仓库根): node docs/provenance/2026-09-20-j2-batch9-92b1-cleanup/mutate-92b1.mjs > mutation-raw.txt
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const P = (r) => path.join(ROOT, r);
const T = {
  pointers: ['kasia-console', 'src/lib/proto-settlement-pointers.test.mjs'],
  c1: ['kasia-console', 'src/lib/proto-settlement-c1.test.mjs'],
  cc: ['kasia-console', 'src/lib/proto-settlement-chain-checks.test.mjs'],
  scan: ['.', 'shared/test-fixtures/source-scan/scan-non-test-sources.test.mjs'],
  uf: ['kasia-relay', 'src/lib/utxo-facts.test.mjs'],
};
const run = (k) => { const [cwd, f] = T[k]; const r = spawnSync(process.execPath, [f], { cwd: P(cwd), encoding: 'utf8', timeout: 300000, maxBuffer: 1 << 26 }); return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const sub = (a, b) => (s) => { const n = s.split(a).length - 1; if (n !== 1) throw new Error(`锚点命中 ${n}: ${a.slice(0, 50)}`); return s.replace(a, () => b); };
const M = [
  ['Y1', 'kasia-console/src/lib/proto-settlement-pointers.mjs', sub("try { genesisId = lc(kaspa.covenantId({ transactionId: auth.txid, index: auth.index }, [{ index: i, output: probe }])); } catch { genesisId = null; } finally { try { probe.free(); } catch { /* 已释放 */ } }",
    "try { genesisId = lc(kaspa.covenantId({ transactionId: auth.txid, index: auth.index }, [{ index: i, output: probe }])); try { probe.free(); } catch { /* 已释放 */ } } catch { genesisId = null; }"), ['pointers'], 'F3-1: probe.free() 挪出 finally(只在 covenantId 成功后释放)'],
  ['Y2', 'kasia-console/src/lib/proto-settlement-c1.mjs', (s) => "import { sqlite } from '../db/client.js';\n" + s, ['c1'], 'c1 模块又拖进 db/client(无 DB import 守卫)'],
  ['Y3', 'kasia-console/src/lib/proto-settlement-chain-checks.mjs', (s) => "import { sqlite } from '../db/client.js';\n" + s, ['cc'], 'chain-checks 模块又拖进 db/client'],
  ['Y4', 'shared/test-fixtures/source-scan/scan-non-test-sources.mjs', sub("if (c === '\\n' && quote !== '`') { state = 'code'; }", ''), ['scan'], 'F5-1: 未闭合引号不在换行处重新同步(下一行注释里的引用被当成字符串保留)'],
  ['Y5', 'shared/test-fixtures/source-scan/scan-non-test-sources.mjs', sub("if (c === quote) { state = 'code'; out += c; i++; continue; }", "if (c === quote && false) { state = 'code'; out += c; i++; continue; }"), ['scan'], 'F5-1: 字符串收不了尾(其后的行尾注释被吞进字符串态)'],
  ['Y6', 'kasia-relay/src/lib/utxo-facts.test.mjs', sub("const { stripComments } = await import('../../../shared/test-fixtures/source-scan/scan-non-test-sources.mjs');", "const stripComments = (src) => src;"), ['uf'], 'relay 测试的 stripComments 退化成恒等(注释里的 connectRpc 会被误报 ⇒ S1 应红)'],
];
console.log('BASELINE');
for (const k of Object.keys(T)) { const r = run(k); console.log(`  ${k}: exit=${r.status} ${(r.out.match(/\d+ passed, \d+ failed/) || ['?'])[0]}`); if (r.status !== 0) { console.log('BASELINE 不绿, 中止'); process.exit(2); } }
let surv = 0;
for (const [id, file, f, tests, why] of M) {
  const abs = P(file); const orig = fs.readFileSync(abs, 'utf8');
  let m; try { m = f(orig); } catch (e) { console.log(`${id}: 变换失败(${e.message}) :: ${why}`); surv++; continue; }
  try {
    fs.writeFileSync(abs, m);
    const res = tests.map((k) => ({ k, ...run(k) })); const red = res.some((r) => r.status !== 0); if (!red) surv++;
    console.log(`${id}: ${red ? 'KILLED' : 'SURVIVED'} [${res.map((r) => `${r.k}:exit=${r.status}`).join(' ')}] :: ${why}`);
  } finally { fs.writeFileSync(abs, orig); if (fs.readFileSync(abs, 'utf8') !== orig) throw new Error('还原失败 ' + file); }
}
console.log('RESTORED');
let ok = true; for (const k of Object.keys(T)) { const r = run(k); console.log(`  ${k}: exit=${r.status}`); if (r.status !== 0) ok = false; }
console.log(`SUMMARY mutants=${M.length} survivors=${surv} restored_green=${ok}`);
process.exitCode = surv || !ok ? 1 : 0;
