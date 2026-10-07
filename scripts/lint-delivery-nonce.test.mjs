// lint-delivery-nonce.test.mjs — R-DELIVERY-NONCE-IN-QUERY(账本1877 v0.3 §3 断言 d)的阳性/阴性对照: 规则必须真的能抓到, 且不误伤合法写法。
// Run: node scripts/lint-delivery-nonce.test.mjs   (在 checkout-static 目录下临时写探针文件, 跑完即删)
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'kasia-console/src/lib/checkout-static');
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const probe = (name, code) => {
  const fp = join(DIR, `_lintprobe_${process.pid}_${name}.js`);
  writeFileSync(fp, code);
  try {
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts/lint-kanet.mjs'), fp], { cwd: ROOT, encoding: 'utf8' });
    return { hit: /R-DELIVERY-NONCE-IN-QUERY/.test(r.stdout + r.stderr) && /violation/.test(r.stdout + r.stderr), status: r.status, out: r.stdout + r.stderr };
  } finally { try { unlinkSync(fp); } catch {} }
};
const BAD = {
  searchParamsSet: "export const f = (u, orderNonce) => u.searchParams.set('n', orderNonce);\n",
  fetchUrl: "export const g = (nonce) => fetch('/pick?n=' + nonce);\n",
  templateQuery: "export const h = (order_nonce) => `/pickup?n=${order_nonce}`;\n",
  encode: "export const i = (orderNonce) => 'x=' + encodeURIComponent(orderNonce);\n",
  newUrl: "export const j = (orderNonce) => new URL('https://x.test/?n=' + orderNonce);\n",
};
for (const [k, code] of Object.entries(BAD)) t(`阳性对照 ${k}: 被抓到且 lint 失败(退出码≠0)`, () => { const r = probe(k, code); assert.ok(r.hit, r.out.slice(0, 300)); assert.notStrictEqual(r.status, 0); });
const GOOD = {
  fragmentOnly: "export const a = (orderNonce) => '#n=' + orderNonce;\n",
  noNonceInUrl: "export const b = (u, q) => u.searchParams.set('q', q);\n",
  commentOnly: "// 不要 u.searchParams.set('n', orderNonce)\nexport const c = 1;\n",
  allowed: "export const d = (u, orderNonce) => { if (u.search.includes(orderNonce)) throw new Error('x'); const p = new URLSearchParams(u.search); return p.get(orderNonce); }; // lint-allow: R-DELIVERY-NONCE-IN-QUERY\n",
};
for (const [k, code] of Object.entries(GOOD)) t(`阴性对照 ${k}: 不误伤`, () => { const r = probe(k, code); assert.ok(!r.hit, r.out.slice(0, 300)); });
t('规则只管 checkout-static: 同样的坏写法放在别处不触发(范围不外溢)', () => {
  const fp = join(ROOT, 'scripts', `_lintprobe_${process.pid}_elsewhere.mjs`);
  writeFileSync(fp, BAD.searchParamsSet);
  try { const r = spawnSync(process.execPath, [join(ROOT, 'scripts/lint-kanet.mjs'), fp], { cwd: ROOT, encoding: 'utf8' }); assert.ok(!/R-DELIVERY-NONCE-IN-QUERY/.test(r.stdout + r.stderr)); } finally { try { unlinkSync(fp); } catch {} }
});
t('现有 checkout-static 全部源文件当前零命中(规则不会让既有文件红)', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/lint-kanet.mjs'), ...['checkout.js', 'order-receipt.js', 'monitor.js', 'order-template.js', 'delivery-crypto.js', 'verify-core.js', 'resolve-order-browser.js'].map((f) => join(DIR, f))], { cwd: ROOT, encoding: 'utf8' });
  assert.ok(!/R-DELIVERY-NONCE-IN-QUERY/.test(r.stdout + r.stderr), (r.stdout + r.stderr).slice(0, 400));
});
console.log(`\n${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
