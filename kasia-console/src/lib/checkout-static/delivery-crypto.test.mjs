// delivery-crypto.test.mjs — 账本1877 步1: 数字商品交付的密码学 + nonce 只走片段(#) 的纯函数护栏。零链零网络。
// Run: cd kasia-console && node src/lib/checkout-static/delivery-crypto.test.mjs
import assert from 'node:assert';
import { hkdfSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { createRequire } from 'node:module';
const C = await import('./delivery-crypto.js');
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };

const NONCE = '00112233445566778899aabbccddeeff';
const ADDR = 'kaspa:qtestaddress0123456789';
const O = { orderNonceHex: NONCE, orderAddress: ADDR };
const IV = Uint8Array.from({ length: 12 }, (_, i) => i);
const KAT_PAYLOAD = '4b444c31000102030405060708090a0b9adef53520ef06b3bdc224978999df39c08bc45fd0';
const KAT_MAILBOX = '11c286ff74ab862705e3853920fa10dc9326d8d4571938f6e4b156eb67a9079b';
const flipHex = (h, i) => h.slice(0, i) + ((parseInt(h[i], 16) ^ 1).toString(16)) + h.slice(i + 1);

// ── 独立再实现(node:crypto, 不经 WebCrypto/本模块): 防"自己和自己一致"的空判据 ──
const refKey = (nonce, addr, info) => Buffer.from(hkdfSync('sha256', Buffer.from(nonce, 'hex'), Buffer.from(addr), Buffer.from(info), 32));
const refEncrypt = (nonce, addr, pt, iv) => { const c = createCipheriv('aes-256-gcm', refKey(nonce, addr, 'kanet-delivery-v1/aead'), Buffer.from(iv)); c.setAAD(Buffer.from('kanet-delivery-v1|' + addr)); const ct = Buffer.concat([c.update(pt), c.final()]); return Buffer.concat([Buffer.from('KDL1'), Buffer.from(iv), ct, c.getAuthTag()]).toString('hex'); };

await t('已知答案: 固定 iv 的 payload 与独立 node:crypto 实现逐字节一致, 且等于冻结值', async () => {
  const got = await C.encryptDeliverable({ ...O, plaintext: 'hello', _ivForTest: IV });
  assert.strictEqual(got, KAT_PAYLOAD);
  assert.strictEqual(got, refEncrypt(NONCE, ADDR, Buffer.from('hello'), IV));
});
await t('信箱私钥: 冻结值 + 与独立 HKDF 一致', async () => {
  const k = await C.deriveMailboxKey(O);
  assert.strictEqual(k.mailboxPrivHex, KAT_MAILBOX); assert.strictEqual(k.counter, 0);
  assert.strictEqual(k.mailboxPrivHex, refKey(NONCE, ADDR, 'kanet-delivery-v1/mailbox/0').toString('hex'));
});
await t('解密独立实现产出的密文(跨实现互通)', async () => {
  const p = refEncrypt(NONCE, ADDR, Buffer.from('下载链接 https://example.test/x?k=1'), IV);
  assert.strictEqual(await C.decryptDeliverable({ ...O, payloadHex: p }), '下载链接 https://example.test/x?k=1');
});
await t('往返: 字符串 / 字节 / 含中文 / 上限 1024B', async () => {
  for (const pt of ['code-ABCD-1234', '激活码：测试✓', 'x'.repeat(1024), new Uint8Array([104, 105])]) {
    const p = await C.encryptDeliverable({ ...O, plaintext: pt });
    assert.strictEqual(await C.decryptDeliverable({ ...O, payloadHex: p }), typeof pt === 'string' ? pt : 'hi');
  }
});
await t('明文空 / 超上限 / 非法输入 ⇒ 抛', async () => {
  await assert.rejects(C.encryptDeliverable({ ...O, plaintext: '' }), /不能为空/);
  await assert.rejects(C.encryptDeliverable({ ...O, plaintext: 'x'.repeat(1025) }), /上限/);
  await assert.rejects(C.encryptDeliverable({ ...O, orderNonceHex: 'zz', plaintext: 'a' }), /32 位小写 hex/);
  await assert.rejects(C.encryptDeliverable({ ...O, orderNonceHex: NONCE.toUpperCase(), plaintext: 'a' }), /32 位小写 hex/);
  await assert.rejects(C.encryptDeliverable({ ...O, orderAddress: '', plaintext: 'a' }), /orderAddress/);
});
await t('iv 每次随机: 同输入两次加密密文不同', async () => {
  const a = await C.encryptDeliverable({ ...O, plaintext: 'same' }), b = await C.encryptDeliverable({ ...O, plaintext: 'same' });
  assert.notStrictEqual(a, b);
});
await t('域分离: 换 nonce 任一位 / 换订单地址 ⇒ 信箱私钥全变且解不开', async () => {
  const base = (await C.deriveMailboxKey(O)).mailboxPrivHex;
  for (let i = 0; i < NONCE.length; i += 5) assert.notStrictEqual((await C.deriveMailboxKey({ ...O, orderNonceHex: flipHex(NONCE, i) })).mailboxPrivHex, base);
  assert.notStrictEqual((await C.deriveMailboxKey({ ...O, orderAddress: ADDR + 'x' })).mailboxPrivHex, base);
  const p = await C.encryptDeliverable({ ...O, plaintext: 'secret' });
  assert.strictEqual(await C.decryptDeliverable({ ...O, orderNonceHex: flipHex(NONCE, 0), payloadHex: p }), null);
  assert.strictEqual(await C.decryptDeliverable({ ...O, orderAddress: ADDR + 'x', payloadHex: p }), null, '关联数据/密钥绑订单地址: 换订单地址不能解');
});
await t('篡改: 逐字节翻转 payload 的每个位置(魔数/iv/密文/tag)都 ⇒ null, 且不抛', async () => {
  const p = await C.encryptDeliverable({ ...O, plaintext: 'tamper-me' });
  for (let i = 0; i < p.length; i++) assert.strictEqual(await C.decryptDeliverable({ ...O, payloadHex: flipHex(p, i) }), null, `pos ${i}`);
});
await t('畸形: 截断 / 加长 / 奇数长度 / 非 hex / 空 / 非字符串 / 超长 ⇒ null', async () => {
  const p = await C.encryptDeliverable({ ...O, plaintext: 'abc' });
  for (const bad of [p.slice(0, -2), p + '00', p.slice(0, -1), 'zz' + p.slice(2), '', null, undefined, 123, '00'.repeat(5000), '4b444c31']) assert.strictEqual(await C.decryptDeliverable({ ...O, payloadHex: bad }), null);
});
await t('拒绝采样: 0 / n / n+1 无效, 第 4 个有效 ⇒ counter=3; 16 次全无效 ⇒ 抛', async () => {
  const n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
  const b = (x) => Uint8Array.from(Buffer.from(x.toString(16).padStart(64, '0'), 'hex'));
  const seq = [0n, n, n + 1n, 5n];
  const r = await C.pickScalar(async (i) => b(seq[i] ?? 0n));
  assert.strictEqual(r.counter, 3); assert.strictEqual(r.privHex, b(5n).reduce((s, x) => s + x.toString(16).padStart(2, '0'), ''));
  assert.strictEqual((await C.pickScalar(async () => b(n - 1n))).counter, 0, 'n-1 合法');
  await assert.rejects(C.pickScalar(async () => b(0n)), /拒绝采样/);
});
await t('信箱地址: 用 kaspa-wasm 真派生(确定性, 主网前缀 kaspa:)', async () => {
  const kaspa = createRequire(import.meta.url)('../../../../kasia-relay/node_modules/kaspa-wasm');
  const k = (await C.deriveMailboxKey(O)).mailboxPrivHex;
  const a1 = C.mailboxAddress(kaspa, k, 'mainnet'), a2 = C.mailboxAddress(kaspa, k, 'mainnet');
  assert.strictEqual(a1, a2); assert.ok(a1.startsWith('kaspa:q'), a1);
  assert.ok(C.mailboxAddress(kaspa, k, 'simnet').startsWith('kaspasim:'));
});

// ── pickDeliverable(买家页读链后的选择逻辑) ──
const mk = async (pt, o = {}) => ({ txid: o.txid || 'aa'.repeat(32), payloadHex: await C.encryptDeliverable({ ...O, plaintext: pt }), isAccepted: o.isAccepted ?? true, acceptingBlueScore: o.score ?? 1000 });
await t('pickDeliverable: 垃圾/他人密文在前, 真交付物在后 ⇒ 取到真的', async () => {
  const other = { txid: 'bb'.repeat(32), payloadHex: await C.encryptDeliverable({ orderNonceHex: flipHex(NONCE, 3), orderAddress: ADDR, plaintext: 'not-yours' }), isAccepted: true, acceptingBlueScore: 900 };
  const r = await C.pickDeliverable({ ...O, txs: [{ txid: 'cc'.repeat(32), payloadHex: '00ff', isAccepted: true, acceptingBlueScore: 900 }, other, await mk('REAL')], currentBlueScore: 2000 });
  assert.deepStrictEqual(r, { status: 'delivered', txid: 'aa'.repeat(32), plaintext: 'REAL' });
});
await t('pickDeliverable: 深度边界 19 ⇒ pending_depth, 20 ⇒ delivered; 未 accepted ⇒ pending_depth', async () => {
  const tx = await mk('D', { score: 1000 });
  assert.strictEqual((await C.pickDeliverable({ ...O, txs: [tx], currentBlueScore: 1019 })).status, 'pending_depth');
  assert.strictEqual((await C.pickDeliverable({ ...O, txs: [tx], currentBlueScore: 1020 })).status, 'delivered');
  assert.strictEqual((await C.pickDeliverable({ ...O, txs: [{ ...tx, isAccepted: false }], currentBlueScore: 9999 })).status, 'pending_depth');
  assert.strictEqual((await C.pickDeliverable({ ...O, txs: [{ ...tx, acceptingBlueScore: NaN }], currentBlueScore: 9999 })).status, 'pending_depth');
});
await t('pickDeliverable: 没有任何能解的 ⇒ none; 空/缺省 txs ⇒ none', async () => {
  assert.strictEqual((await C.pickDeliverable({ ...O, txs: [{ txid: 'x', payloadHex: '4b444c31' + '00'.repeat(40), isAccepted: true, acceptingBlueScore: 1 }], currentBlueScore: 99 })).status, 'none');
  assert.strictEqual((await C.pickDeliverable({ ...O, txs: [], currentBlueScore: 99 })).status, 'none');
  assert.strictEqual((await C.pickDeliverable({ ...O, currentBlueScore: 99 })).status, 'none');
});
await t('pickDeliverable: "粘贴密文"路径 = decryptDeliverable 同一 AEAD 校验(粘贴错/改过的密文 ⇒ null)', async () => {
  const p = await C.encryptDeliverable({ ...O, plaintext: 'paste-ok' });
  assert.strictEqual(await C.decryptDeliverable({ ...O, payloadHex: p }), 'paste-ok');
  assert.strictEqual(await C.decryptDeliverable({ ...O, payloadHex: flipHex(p, p.length - 3) }), null);
});

// ── 发票链接: nonce 只走片段 ──
await t('buildInvoiceLink: nonce 只在 #n=, search/pathname 里零 nonce 子串; 公开参数照常走查询串', () => {
  const link = C.buildInvoiceLink({ baseUrl: 'https://example.github.io/checkout/order.html', publicParams: { q: 'QUOTEabc', ch: 'chan1', sc: 'sig9' }, orderNonceHex: NONCE });
  const u = new URL(link);
  assert.strictEqual(u.hash, '#n=' + NONCE);
  assert.ok(!C.leaksNonce(u.search + u.pathname + u.host, NONCE));
  assert.strictEqual(u.searchParams.get('q'), 'QUOTEabc');
});
await t('buildInvoiceLink: 公开参数里藏 nonce 片段(含大写) / 键叫 n / baseUrl 带片段 / 路径含 nonce ⇒ 抛', () => {
  const base = 'https://example.github.io/o.html';
  assert.throws(() => C.buildInvoiceLink({ baseUrl: base, publicParams: { q: 'x' + NONCE.slice(4, 14) }, orderNonceHex: NONCE }), /公开参数 q 含 nonce 片段/);
  assert.throws(() => C.buildInvoiceLink({ baseUrl: base, publicParams: { q: NONCE.toUpperCase() }, orderNonceHex: NONCE }), /公开参数 q 含 nonce 片段/);
  assert.throws(() => C.buildInvoiceLink({ baseUrl: base, publicParams: { n: '1' }, orderNonceHex: NONCE }), /不得使用键/);
  assert.throws(() => C.buildInvoiceLink({ baseUrl: base + '#x', publicParams: {}, orderNonceHex: NONCE }), /自带片段/);
  assert.throws(() => C.buildInvoiceLink({ baseUrl: `https://example.github.io/${NONCE}/o.html`, publicParams: {}, orderNonceHex: NONCE }), /路径\/查询含 nonce/);
  assert.throws(() => C.buildInvoiceLink({ baseUrl: base, orderNonceHex: 'short' }), /非法/);
});
await t('readNonceFromHash: 只认片段里的 n=<32hex>; 查询串里的 n= 不被认(它根本不该在那)', () => {
  assert.strictEqual(C.readNonceFromHash('#n=' + NONCE), NONCE);
  assert.strictEqual(C.readNonceFromHash('n=' + NONCE), NONCE);
  assert.strictEqual(C.readNonceFromHash('#x=1&n=' + NONCE + '&y=2'), NONCE);
  for (const bad of ['', '#', '#n=short', '#n=' + NONCE.toUpperCase(), '?n=' + NONCE, null, undefined, '#n=' + NONCE + 'ff']) assert.strictEqual(C.readNonceFromHash(bad), null, String(bad));
});
await t('takeNonceFromLocation: 读到后立刻 replaceState 且新 URL 不含片段/nonce; 没有 nonce 时不动地址栏', () => {
  const calls = [];
  const history = { replaceState: (...a) => calls.push(a) };
  const n = C.takeNonceFromLocation({ hash: '#n=' + NONCE, pathname: '/checkout/order.html', search: '?q=Q' }, history, 'T');
  assert.strictEqual(n, NONCE); assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][2], '/checkout/order.html?q=Q'); assert.ok(!String(calls[0][2]).includes('#') && !C.leaksNonce(JSON.stringify(calls[0]), NONCE));
  assert.strictEqual(C.takeNonceFromLocation({ hash: '', pathname: '/a', search: '' }, history), null); assert.strictEqual(calls.length, 1);
});
await t('v0.3 §3 f: receiptLinkMismatch 只比 q/ch/sc, 追加 #n=<nonce> 不影响结果, 且 order-receipt.js 从不读取 hash', async () => {
  const R = await import('./order-receipt.js');
  const { readFileSync } = await import('node:fs');
  const link = 'https://example.github.io/o.html?q=Q1&ch=C1&sc=S1';
  const receipt = { link };
  assert.strictEqual(R.receiptLinkMismatch(receipt, link), null);
  assert.strictEqual(R.receiptLinkMismatch(receipt, link + '#n=' + NONCE), null);
  assert.strictEqual(R.receiptLinkMismatch(receipt, link.replace('q=Q1', 'q=Q2') + '#n=' + NONCE), 'q');
  const src = readFileSync(new URL('./order-receipt.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/\.hash\b|location\.hash/.test(src),'order-receipt.js 不得读取 hash(片段里是 nonce)');
});
await t('静态: 本模块的 URL/请求构造点不读 location.search 里的 nonce, 且没有 fetch/XMLHttpRequest/WebSocket(密码学模块不发网络)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./delivery-crypto.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/.test(src));
  assert.ok(!/location\.search/.test(src.replace(/location\.pathname \+ location\.search/g, '')), '不得从 search 取 nonce');
});
// ───────── 步 3: 退款私钥(Bettor 账本1879) + 发票片段里的 deadline ─────────
const KAT_REFUND = '4e0f0ce8e199b782c4f3ecdc72dcabee09e8bc763922c01839c6f41775182d9e';
await t('退款私钥: 冻结值 + 与独立 HKDF(salt=退款盐, 不含订单地址)一致; 与信箱/AEAD 派生域分离', async () => {
  const r = await C.deriveRefundKey({ orderNonceHex: NONCE, network: 'simnet' });
  assert.strictEqual(r.refundPrivHex, KAT_REFUND); assert.strictEqual(r.counter, 0);
  assert.strictEqual(r.refundPrivHex, Buffer.from(hkdfSync('sha256', Buffer.from(NONCE, 'hex'), Buffer.from('kanet-delivery-v1|refund|simnet'), Buffer.from('kanet-delivery-v1/refund/0'), 32)).toString('hex'));
  assert.notStrictEqual(r.refundPrivHex, (await C.deriveMailboxKey(O)).mailboxPrivHex);
  assert.notStrictEqual(r.refundPrivHex, refKey(NONCE, ADDR, 'kanet-delivery-v1/refund/0').toString('hex'), '盐里不含订单地址(否则与订单地址循环依赖)');
});
await t('退款私钥: 换 network / 换 nonce 任一位 ⇒ 全变; 非法输入 ⇒ 抛', async () => {
  const base = (await C.deriveRefundKey({ orderNonceHex: NONCE, network: 'simnet' })).refundPrivHex;
  assert.notStrictEqual((await C.deriveRefundKey({ orderNonceHex: NONCE, network: 'mainnet' })).refundPrivHex, base);
  for (let i = 0; i < NONCE.length; i += 7) assert.notStrictEqual((await C.deriveRefundKey({ orderNonceHex: flipHex(NONCE, i), network: 'simnet' })).refundPrivHex, base);
  await assert.rejects(C.deriveRefundKey({ orderNonceHex: 'zz', network: 'simnet' }), /32 位/);
  for (const bad of ['', 'A', 'a b', 'x'.repeat(30), undefined]) await assert.rejects(C.deriveRefundKey({ orderNonceHex: NONCE, network: bad }), /network/);
});
await t('退款私钥 → kaspa-wasm 真派生 P2PK 地址(确定性, 与信箱同一函数 mailboxAddress)', async () => {
  const kaspa = createRequire(import.meta.url)('../../../../kasia-relay/node_modules/kaspa-wasm');
  const k = (await C.deriveRefundKey({ orderNonceHex: NONCE, network: 'simnet' })).refundPrivHex;
  const a = C.mailboxAddress(kaspa, k, 'simnet'); assert.strictEqual(a, C.mailboxAddress(kaspa, k, 'simnet')); assert.ok(a.startsWith('kaspasim:q'));
});
await t('发票链接带 deadline: 仍只在片段; readInvoiceFromHash 解析 {nonce, deadlineMs}; 非法 deadline 视为缺失; 查询串里的 dl/n 不被认', () => {
  const dl = 1790000000000;
  const link = C.buildInvoiceLink({ baseUrl: 'https://example.github.io/o.html', publicParams: { q: 'Q' }, orderNonceHex: NONCE, deadlineMs: dl });
  const u = new URL(link); assert.strictEqual(u.hash, `#n=${NONCE}&dl=${dl}`); assert.ok(!C.leaksNonce(u.search + u.pathname, NONCE));
  assert.deepStrictEqual(C.readInvoiceFromHash(u.hash), { nonce: NONCE, deadlineMs: dl });
  assert.deepStrictEqual(C.readInvoiceFromHash('#n=' + NONCE), { nonce: NONCE, deadlineMs: undefined });
  for (const bad of ['#n=' + NONCE + '&dl=0', '#n=' + NONCE + '&dl=abc', '#n=' + NONCE + '&dl=1234567890123456']) assert.strictEqual(C.readInvoiceFromHash(bad).deadlineMs, undefined, bad);
  assert.strictEqual(C.readInvoiceFromHash('?n=' + NONCE + '&dl=5'), null); assert.strictEqual(C.readInvoiceFromHash(''), null);
  assert.throws(() => C.buildInvoiceLink({ baseUrl: 'https://x.test/o.html', orderNonceHex: NONCE, deadlineMs: -1 }), /deadlineMs/);
});
await t('takeInvoiceFromLocation: 读后立刻 replaceState 抹片段(含 dl); 无发票不动', () => {
  const calls = []; const history = { replaceState: (...a) => calls.push(a) };
  const inv = C.takeInvoiceFromLocation({ hash: `#n=${NONCE}&dl=1790000000000`, pathname: '/o.html', search: '?q=Q' }, history);
  assert.deepStrictEqual(inv, { nonce: NONCE, deadlineMs: 1790000000000 }); assert.strictEqual(calls.length, 1); assert.strictEqual(calls[0][2], '/o.html?q=Q');
  assert.strictEqual(C.takeInvoiceFromLocation({ hash: '', pathname: '/o.html', search: '' }, history), null); assert.strictEqual(calls.length, 1);
});
console.log(`\n${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
