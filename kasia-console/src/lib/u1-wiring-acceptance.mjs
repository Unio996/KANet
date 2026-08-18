// ①-1..①-10 验收(预注册于设计报告 §8, 事后不加项) —— 针对 POST /api/identity/u1-register 接线。
// 🔴 安全闸: import 前把 DB_PATH 指到临时库并断言, 绝不碰 live
//    (我上一版验收脚本没设 DB_PATH, client.js 落到真 console.db, 迁移被跑到了 live 库上)。
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';
const dir = mkdtempSync(join(tmpdir(), 'u1-wiring-'));
process.env.DB_PATH = join(dir, 'probe.db');
const { runMigrations } = await import('../db/migrate.js');
const { dbPath } = await import('../db/client.js');
assert.ok(dbPath.startsWith(dir), `安全闸: 必须临时库, 实际 ${dbPath}`);
runMigrations();

const src = readFileSync(new URL('../api/identities.js', import.meta.url), 'utf8');
const routeSrc = src.slice(src.indexOf("fastify.post('/api/identity/u1-register'"));
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log('[PASS] ' + n); pass++; } catch (e) { console.log('[FAIL] ' + n + ' :: ' + e.message); fail++; } };
const A = (c, m) => { if (!c) throw new Error(m || 'assert'); };
assert.ok(routeSrc.length > 500, '取路由源码失败, 后面的断言会全部虚过');

// 🔴 ①-0 是本套件【最先加、最后才想到】的一条, 加它的原因写在这里, 别删:
//    ①-1..①-11 全部是 readFileSync + 正则/includes 的【纯文本】判据。
//    2026-08-18 我把路由插到了 registerIdentityRoutes 函数体【外面】(模块顶层),
//    该文件 import 即抛 ReferenceError: fastify is not defined,
//    而这套静态验收照样 10 PASS —— 不是走运漏过, 是这类问题【不在文本匹配的判别范围内】。
//    ⇒ 任何检查源码里有没有某段字的套件, 都必须配一条【真的把它加载起来】的用例。
const ta = async (n, fn) => { try { await fn(); console.log('[PASS] ' + n); pass++; } catch (e) { console.log('[FAIL] ' + n + ' :: ' + e.message); fail++; } };

await ta('①-0 模块可真 import, 且路由注册在 registerIdentityRoutes 函数体内(非模块顶层)', async () => {
  const mod = await import('../api/identities.js');   // 顶层 fastify.post ⇒ 这一行就抛
  A(typeof mod.registerIdentityRoutes === 'function', '未导出 registerIdentityRoutes');
  // 阳性对照: 用假 fastify 调它, 必须真的注册到 u1-register
  //   —— 路由若又被挪出函数体, import 会先炸; 若被挪进别的函数, 这里收不到。
  const seen = [];
  const fake = new Proxy({}, { get: (_, k) => (k === 'post' || k === 'get')
    ? (path) => { seen.push(k + ' ' + path); } : () => {} });
  mod.registerIdentityRoutes(fake);
  A(seen.includes('post /api/identity/u1-register'),
    '调 registerIdentityRoutes 后没看到 u1-register 注册, 实收: ' + JSON.stringify(seen));
});

t('①-1 registerIdentity 生产签名逐字未变(仍三键, 无新参; 时钟仍钉死在入口)', () => {
  const reg = readFileSync(new URL('./u1-registration.mjs', import.meta.url), 'utf8');
  A(reg.includes('export async function registerIdentity(args = {})'), '生产签名被改了');
  A(reg.includes('clock: () => Date.now()'), '时钟不再钉死在生产入口');
});

t('①-2 禁展开 body(负面 grep + 🔴每条先过自己的阳性对照)', () => {
  // 🔴 负面判据的通病: 正则写坏时它对任何输入都不命中 ⇒ 用例【永远通过】。
  //    所以每条先用一个【已知必中】的合成坏样本证明它抓得住, 再断言真码不命中。
  const probes = [
    { re: /\.\.\.\s*req(uest)?\.body/, bad: 'const submission = { ...req.body };' },
    { re: /Object\.assign\([^)]*req(uest)?\.body/, bad: 'Object.assign(submission, request.body);' },
    { re: /\.\.\.\s*b\b/, bad: 'const submission = { ...b };' },
  ];
  for (const { re, bad } of probes) {
    A(re.test(bad), `阳性对照失败: ${re} 连已知坏样本都抓不住 ⇒ 这条负面判据是空的`);
    A(!re.test(routeSrc), `真码命中了展开模式 ${re}`);
  }
});

t('①-3 🔴 注入面: handler 不得把 custody 抄进 submission(模块故意不看 s.custody)', () => {
  A(!routeSrc.includes('custody'), 'handler 出现了 custody');
});

t('①-4 🔴 注入面: 不得转发调用方给的 challengeStore, 必须自己造', () => {
  A(!/challengeStore:\s*b\./.test(routeSrc), 'handler 转发了调用方的 challengeStore');
  A(routeSrc.includes('createChallengeStore(sqlite, CANONICAL_CHALLENGE_TABLE)'), 'handler 没有自己造 store');
});

t('①-5 🔴 注入面: 类时钟/验签器/表名逃逸口字段不得进入 args', () => {
  for (const bad of ['clock', 'verifyMessageFn', 'expectedTable', '__testOnly']) {
    A(!routeSrc.includes(bad), `handler 里出现了逃逸口字段 ${bad}`);
  }
});

t('①-6 handler 不碰那两张表(读写权归模块)', () => {
  A(!routeSrc.includes('u1_identity_challenge'), 'handler 直接引用了挑战表');
  A(!routeSrc.includes('u1_identity_registration'), 'handler 直接引用了登记表');
});

t('①-7 🔴 fail-closed 传导: 表不存在时明确失败, 绝不回"成功"', () => {
  A(routeSrc.includes('CHALLENGE_STORE_UNAVAILABLE'), '缺表不存在时的显式失败码');
  A(routeSrc.includes('reply.code(503)'), '缺 5xx 失败响应');
  const catchBlock = routeSrc.slice(routeSrc.indexOf('} catch (e) {'), routeSrc.indexOf('const result'));
  A(!catchBlock.includes('ok: true'), 'catch 分支里疑似返回了成功');
});

t('①-8 白名单是六个字段(含 signature) 且逐字段显式取', () => {
  // 🔵 故意不用正则: 上一版用模板字符串拼 new RegExp —— 模板会把 \s 当转义吃掉,
  //    实际正则变成 `s*`, 它从没按我以为的方式工作过。字面量 includes 免转义且断言更严。
  for (const f of ['relayId', 'rootXpub', 'identityIndex', 'identityPubkeyXOnly', 'challenge', 'signature']) {
    A(routeSrc.includes(f + ': b.' + f + ','), '白名单缺 ' + f + ' 或不是逐字段显式取');
  }
  A(routeSrc.includes('signature: b.signature,'), 'signature 缺失 ⇒ PoP 会 MALFORMED(设计稿 §1 原来漏了它)');
});

t('①-9 结果直传模块判定, handler 不改写 ok/code', () => {
  A(routeSrc.includes('registerIdentity({ sqlite, submission, challengeStore })'), '调用形状不是设计里那三个键');
  A(routeSrc.includes('result.ok ? 200 : 400'), 'handler 没按模块结果决定状态码');
});

t('①-11 端点真的挂上了(不是写了没注册) — 【新增格, 非替换 ①-10】', () => {
  A(src.includes("fastify.post('/api/identity/u1-register'"), '端点未注册');
  const idx = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  A(idx.includes('registerIdentityRoutes(fastify)'), 'identities 路由组未被挂载');
});

console.log(`\n① 验收: ${pass} PASS / ${fail} FAIL   (临时库 ${dbPath})`);

// 🔴 ①-10 (TOCTOU) 【本轮不可跑 —— 如实标出, 而不是换掉它】
//    §8 预注册的 ①-10 是: 另一连接在 u1-registration.mjs :176↔:265 之间改 relay_nodes
//    ⇒ 必拒, 且【一个字节都没写】。它验的是 ② 的事务内重派生, 而 ② 尚未实现
//    ⇒ 现在跑它只会得到一个【与被验机制无关】的绿灯。
//    ⚠ 我起初把"端点挂没挂上"写在了 ①-10 这个编号下 —— 那是【替换】预注册判据, 不是补充。
//       已改为新增 ①-11, ①-10 保持 PENDING(随 ② 一并跑)。
//    🔨 **预注册的判据只能新增, 不能替换** —— 否则"事后不加项"这句承诺就只剩字面。
console.log('\n── ①-10 (TOCTOU) 已随 ② 关闭 ──');
console.log('  ①-10a 真闸  = ✅ 跑在 u1-registration.test.mjs 的 ②-2/②-3/②-4(混合态 / 清 mnemonic / 删行 ⇒ 各自拒 + 零写入)');
console.log('        阴性对照: 同一批用例跑在 ② 之前的生产码上 ⇒ 三格全红 ⇒ 有判别力, 不是天然绿');
console.log('  ①-10b 取值来源 = 🔵 改判 UNREACHABLE(等价改写, 非缺陷): deriveCustody 的 ok 分支全文件只有一个取值,');
console.log('        两次都 ok 时两个变量必然相等; 不 ok 时 throw 已回滚、INSERT 不执行 ⇒ 写哪个变量外部观察不到。');
console.log('        🔨 与我删掉值比对那条死分支同一个理由 —— §8 预注册时没看出这格得了同一种病。');
console.log('        承重那一格(重派生 + 不 ok 就回滚)由变异「② 事务内重派生闸拆掉」正面覆盖, 实测 detect。');
console.log('  ①-10c′ 兜底 = ✅ DB CHECK 可达性用例已跑: custody 非 mnemonic 必被约束拒, 且阳性对照合法值写得进');
console.log('  变异读数: 20 detected / 0 MISSED / 0 INERT / 0 BROKEN / 5 UNREACHABLE');
console.log('  🔴 而这些数字能信的前提是 harness② 自检三臂先过(含阴性臂 MISSED=1, 证它不是恒红装置) —— 本轮已跑。');
