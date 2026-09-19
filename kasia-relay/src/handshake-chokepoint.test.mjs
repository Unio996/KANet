// handshake-chokepoint.test.mjs — V2d(设计 v0.4 §7.2 / §8.2 / §8.4): chain.mjs acceptHandshake 的 chokepoint。
//   关闭态返回 null(不碰钱包、不加密、不构造载荷)、自己打一行带调用者标识的日志(按 peer 去重); 开启态的输出与基线原文【结构性等价】——
//   §8.2: 握手 JSON 含 timestamp: Date.now(), 加密用每次新生成的临时 ECDH 密钥 + 随机 nonce ⇒ 密文字节永远不同, 逐字节比对无意义。
//   所以比的是: {to, amount} 相等 / payload 以握手前缀开头且长度一致 / 用接收方私钥【解密后】字段(type / version / isResponse / alias / theirAlias)与基线相同, timestamp 只断言为最近毫秒数。
//
// 🔴 密钥: 全程只用本进程内 crypto.randomBytes 现生成的一次性测试私钥(发送方与接收方各一把), 进程结束即弃; 不读、不打印、不落盘任何真实密钥。
//    (即便运行环境里已有 KASPA_PRIVKEY / KASPA_MNEMONIC, 本测试也在进程内用一次性 key 覆盖它——绝不用它。)
// 单文件跑: node src/handshake-chokepoint.test.mjs (不连节点; import chain.mjs 会带进 rpc-listener.mjs 顶层, 与 drain-finality 测试同理, 需 kaspa-wasm)。
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = '6635ff89';
const BEFORE_TXT = fs.readFileSync(path.join(HERE, '..', 'test-fixtures', 'handshake-switch', `acceptHandshake.BEFORE-${BASE}.txt`), 'utf8');

process.env.KASPA_NETWORK = 'testnet-12';   // 本进程内固定(rpc-listener 顶层要求已知网络; wallet 支持 testnet-12); 不连节点
const K = 'RELAY_HANDSHAKE_AUTO_ACCEPT';
delete process.env.KASPA_PRIVKEY; delete process.env.KASPA_MNEMONIC;   // 先让"钱包不可用"——关闭态若碰了钱包会立刻抛错(见 C1)

const chain = await import('./chain.mjs');
const { KaspaWallet, getWallet } = await import('./lib/wallet.mjs');
const { decrypt, encrypt } = await import('./lib/crypto.mjs');
const { deriveAliases } = await import('./lib/alias.mjs');
const { encodeHandshakePayload, PREFIX_HEX } = await import('./lib/protocol.mjs');
const { KASIA_MIN_AMOUNT } = await import('./lib/transaction.mjs');

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const withEnv = async (val, fn) => {
  const prev = process.env[K];
  if (val === undefined) delete process.env[K]; else process.env[K] = val;
  try { return await fn(); } finally { if (prev === undefined) delete process.env[K]; else process.env[K] = prev; }
};
const captureLogs = async (fn) => {
  const lines = []; const orig = console.log;
  console.log = (...a) => { lines.push(a.map(String).join(' ')); };
  try { await fn(); } finally { console.log = orig; }
  return lines;
};

// 一次性测试接收方(地址 + 私钥)
const RECIPIENT_PRIV = crypto.randomBytes(32).toString('hex');
const RECIPIENT = KaspaWallet.fromPrivateKey(RECIPIENT_PRIV, 'testnet-12').getAddress();
const RECIPIENT2 = KaspaWallet.fromPrivateKey(crypto.randomBytes(32).toString('hex'), 'testnet-12').getAddress();
const RECIPIENT3 = KaspaWallet.fromPrivateKey(crypto.randomBytes(32).toString('hex'), 'testnet-12').getAddress();   // 从未出现过的 peer(去重是进程级, 前面的测试已用掉 RECIPIENT)
async function namedCaller(addr) { return await chain.acceptHandshake({ address: addr }); }

// ══ 关闭态(钱包尚未初始化: 此时 getWallet() 会抛错, 所以"返回 null 而不是抛"本身就证明没碰钱包) ═══════════════════════════
await t('C0 前提: 此刻钱包不可用(getWallet 抛错)——之后关闭态的 null 才有证明力', () => {
  assert.throws(() => getWallet(), /KASPA_MNEMONIC or KASPA_PRIVKEY/);
});
for (const [label, val] of [['未设', undefined], ["'0'", '0'], ["'on'", 'on'], ["'true'", 'true'], ["' 1'", ' 1'], ["''", '']]) {
  await t(`V2d 关闭态(${label}): acceptHandshake 返回 null(不抛、不碰钱包)`, async () => {
    await withEnv(val, async () => {
      const r = await chain.acceptHandshake({ address: RECIPIENT });
      assert.strictEqual(r, null);
    });
  });
}
await t('V2d 关闭态: 缺参数也返回 null 不抛(params 为 undefined / 无 address)', async () => {
  await withEnv(undefined, async () => {
    assert.strictEqual(await chain.acceptHandshake(), null);
    assert.strictEqual(await chain.acceptHandshake({}), null);
  });
});
await t('V2d 关闭态日志(§8.4): 恰一行 "disabled (chokepoint, caller=<调用者>)", 带调用函数名与文件:行; 同 peer 再调不再打; 换 peer 再打一行', async () => {
  await withEnv(undefined, async () => {
    const lines = await captureLogs(async () => { await namedCaller(RECIPIENT2); await namedCaller(RECIPIENT2); await namedCaller(RECIPIENT2); });
    const hit = lines.filter((l) => l.includes('disabled (chokepoint, caller='));
    assert.strictEqual(hit.length, 1, '同 peer 三次应 1 行, 实得 ' + hit.length + ' :: ' + lines.join(' | '));
    assert.ok(/caller=namedCaller@handshake-chokepoint\.test\.mjs:\d+/.test(hit[0]), '调用者标识: ' + hit[0]);
    assert.ok(hit[0].includes(RECIPIENT2.slice(-12)), 'peer 后 12 位');
    const lines2 = await captureLogs(async () => { await namedCaller(RECIPIENT3); });
    assert.strictEqual(lines2.filter((l) => l.includes('disabled (chokepoint, caller=')).length, 1, '换 peer 应再 1 行');
  });
});
await t('V2d 关闭态日志不含路径(D-021: 只带文件名:行, 不带目录)', async () => {
  await withEnv(undefined, async () => {
    const lines = await captureLogs(async () => { const a = RECIPIENT + ''; await withEnv(undefined, () => chain.acceptHandshake({ address: a + 'x' })); });
    const hit = lines.filter((l) => l.includes('chokepoint'));
    assert.ok(hit.length >= 1);
    for (const l of hit) assert.ok(!/[A-Za-z]:[\\/]|file:\/\//.test(l), '日志里出现路径: ' + l);
  });
});

// ══ 开启态: 结构性等价(§8.2) ═════════════════════════════════════════════════════════════════════════════════════
const SENDER_PRIV = crypto.randomBytes(32).toString('hex');
process.env.KASPA_PRIVKEY = SENDER_PRIV;   // 一次性测试发送方私钥(进程内现生成, 不打印)
const SENDER = getWallet().getAddress();
const beforeFn = new Function('getWallet', 'deriveAliases', 'encrypt', 'encodeHandshakePayload', 'KASIA_MIN_AMOUNT',
  BEFORE_TXT.replace(/^export\s+/, '') + '\nreturn acceptHandshake;')(getWallet, deriveAliases, encrypt, encodeHandshakePayload, KASIA_MIN_AMOUNT);

async function decodeDraft(draft) {
  assert.ok(draft && typeof draft.payload === 'string', '无草稿');
  assert.ok(draft.payload.startsWith(PREFIX_HEX.HANDSHAKE), 'payload 应以握手前缀开头');
  const enc = Buffer.from(draft.payload.slice(PREFIX_HEX.HANDSHAKE.length), 'hex');
  return JSON.parse(await decrypt(enc, RECIPIENT_PRIV));
}
await t('V2d 开启态 ▲ 基线原文与现函数: {to, amount} 相等; payload 前缀 + 长度相同; 解密后 type/version/isResponse/alias/theirAlias 相同且等于预期派生值; timestamp 是最近毫秒数; 字段集相同', async () => {
  await withEnv('1', async () => {
    const t0 = Date.now();
    const b = await beforeFn({ address: RECIPIENT });
    const a = await chain.acceptHandshake({ address: RECIPIENT });
    const t1 = Date.now();
    assert.ok(a && b, '两边都应产出草稿');
    assert.deepStrictEqual({ to: a.to, amount: a.amount }, { to: b.to, amount: b.amount });
    assert.strictEqual(a.to, RECIPIENT); assert.strictEqual(a.amount, KASIA_MIN_AMOUNT);
    assert.strictEqual(a.payload.length, b.payload.length, 'payload 长度');
    assert.notStrictEqual(a.payload, b.payload, '(对照) 同明文两次密文应不同——证明逐字节比对本来就不可行');
    const da = await decodeDraft(a), db = await decodeDraft(b);
    const { myAlias, theirAlias } = await deriveAliases(SENDER_PRIV, RECIPIENT);
    for (const d of [da, db]) {
      assert.strictEqual(d.type, 'handshake'); assert.strictEqual(d.version, 1); assert.strictEqual(d.isResponse, true);
      assert.strictEqual(d.alias, myAlias); assert.strictEqual(d.theirAlias, theirAlias);
      assert.ok(Number.isInteger(d.timestamp) && d.timestamp >= t0 - 1000 && d.timestamp <= t1 + 1000, 'timestamp 应是最近毫秒数: ' + d.timestamp);
    }
    assert.deepStrictEqual(Object.keys(da).sort(), Object.keys(db).sort());
    assert.deepStrictEqual(Object.keys(da).sort(), ['alias', 'isResponse', 'theirAlias', 'timestamp', 'type', 'version']);
    const { timestamp: _x, ...ra } = da, { timestamp: _y, ...rb } = db;
    assert.deepStrictEqual(ra, rb);
  });
});
await t('V2d 阳性对照: 开启态不打 chokepoint 日志; 每次调用读 env——同一进程内关→开→关 立即生效', async () => {
  const lines = await captureLogs(async () => {
    await withEnv('1', async () => { const r = await chain.acceptHandshake({ address: RECIPIENT }); assert.ok(r && r.payload); });
  });
  assert.ok(!lines.some((l) => l.includes('chokepoint')), '开启态不该打 chokepoint 日志');
  await withEnv(undefined, async () => { assert.strictEqual(await chain.acceptHandshake({ address: RECIPIENT }), null); });
  await withEnv('1', async () => { assert.ok((await chain.acceptHandshake({ address: RECIPIENT }))?.payload); });
  await withEnv('on', async () => { assert.strictEqual(await chain.acceptHandshake({ address: RECIPIENT }), null); });
});
await t('V2d 关闭态且钱包已可用时同样返回 null(不是"因为没钱包才 null")', async () => {
  await withEnv(undefined, async () => { assert.strictEqual(await chain.acceptHandshake({ address: RECIPIENT }), null); });
});
await t('V2d 只有握手接受草稿受闸: initiateHandshake / sendMessage 不在本闸内(仍可构造草稿)——闸只管"自动接受"', async () => {
  await withEnv(undefined, async () => {
    const r = await chain.initiateHandshake({ address: RECIPIENT });
    assert.ok(r && r.payload, 'initiateHandshake 不该被本开关关闭');
    const m = await chain.sendMessage({ address: RECIPIENT, message: 'hi' });
    assert.ok(m && m.payload, 'sendMessage 不该被本开关关闭');
  });
});

console.log(`\nhandshake-chokepoint.test: ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
