// handshake-switch.test.mjs — V1 / V5(纯函数侧) + 日志去重器(§7.4 / §8.3)。设计 v0.4。
// 单文件跑: node src/lib/handshake-switch.test.mjs (纯函数, 零依赖)。
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handshakeAutoAcceptEnabled, handshakeStartupLine, createOncePerKeyLogger, DISABLED_LOG_CAP } from './handshake-switch.mjs';

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const K = 'RELAY_HANDSHAKE_AUTO_ACCEPT';

t('V1 只认字面 \'1\': 未设 / \'0\' / \'on\' / \'true\' / \' 1\' / \'"1"\' / \'\' / \'01\' / 全角 \'１\' / \'1\\n\' / \'1 \' / \'TRUE\' / \'yes\' / \'2\' 全部为 false; \'1\' 为 true', () => {
  assert.strictEqual(handshakeAutoAcceptEnabled({}), false);
  for (const v of ['0', 'on', 'true', ' 1', '"1"', '', '01', '１', '1\n', '1 ', 'TRUE', 'yes', '2', 'ON', 'enabled', '1.0']) assert.strictEqual(handshakeAutoAcceptEnabled({ [K]: v }), false, JSON.stringify(v));
  assert.strictEqual(handshakeAutoAcceptEnabled({ [K]: '1' }), true);
});
t('V1 键名钉死: 只读 RELAY_HANDSHAKE_AUTO_ACCEPT(旧闸键 KANET_CATCHUP_COMM=on / 拼错的键都不开)', () => {
  assert.strictEqual(handshakeAutoAcceptEnabled({ KANET_CATCHUP_COMM: 'on' }), false);
  assert.strictEqual(handshakeAutoAcceptEnabled({ RELAY_HANDSHAKE_AUTO_ACCEPT_: '1', HANDSHAKE_AUTO_ACCEPT: '1', relay_handshake_auto_accept: '1' }), false);
});
t('V1 每次调用读(§6.2 ②): 默认参数是当前 process.env, 改 env 立即生效, 不缓存', () => {
  const prev = process.env[K];
  try {
    delete process.env[K]; assert.strictEqual(handshakeAutoAcceptEnabled(), false);
    process.env[K] = '1'; assert.strictEqual(handshakeAutoAcceptEnabled(), true);
    process.env[K] = 'on'; assert.strictEqual(handshakeAutoAcceptEnabled(), false);
    delete process.env[K]; assert.strictEqual(handshakeAutoAcceptEnabled(), false);
  } finally { if (prev === undefined) delete process.env[K]; else process.env[K] = prev; }
});
t('V1 不改传入的 env / 不依赖网络: 传 KASPA_NETWORK 各值结果相同(默认关, 不按网络分支)', () => {
  for (const net of ['mainnet', 'testnet-12', 'simnet', undefined]) assert.strictEqual(handshakeAutoAcceptEnabled({ KASPA_NETWORK: net }), false);
  const env = Object.freeze({ [K]: '1' });
  assert.strictEqual(handshakeAutoAcceptEnabled(env), true);
});

t('V5 启动行(关闭): 未设 ⇒ DISABLED + raw=<unset> + RELAY_MODE', () => {
  assert.strictEqual(handshakeStartupLine({}, 'rpc'), 'handshake auto-accept: DISABLED (RELAY_HANDSHAKE_AUTO_ACCEPT!=1, raw=<unset>, RELAY_MODE=rpc)');
});
t('V5 启动行(关闭): 写成 \'on\' / \'true\' / \' 1\' / \'\' 时 raw 带 JSON 引号原样显示(拼写错误一眼可见), 仍是 DISABLED', () => {
  assert.strictEqual(handshakeStartupLine({ [K]: 'on' }, 'indexer'), 'handshake auto-accept: DISABLED (RELAY_HANDSHAKE_AUTO_ACCEPT!=1, raw="on", RELAY_MODE=indexer)');
  assert.ok(handshakeStartupLine({ [K]: ' 1' }, 'rpc').includes('raw=" 1"'));
  assert.ok(handshakeStartupLine({ [K]: '' }, 'rpc').includes('raw=""'));
  assert.ok(handshakeStartupLine({ [K]: '1\n' }, 'rpc').includes('raw="1\\n"'));
  for (const v of ['on', 'true', ' 1', '', '0']) assert.ok(handshakeStartupLine({ [K]: v }, 'rpc').startsWith('handshake auto-accept: DISABLED'), v);
});
t('V5 启动行(开启): \'1\' ⇒ ENABLED + RELAY_MODE, 不含 DISABLED', () => {
  const l = handshakeStartupLine({ [K]: '1' }, 'rpc');
  assert.strictEqual(l, 'handshake auto-accept: ENABLED (RELAY_MODE=rpc)');
  assert.ok(!l.includes('DISABLED'));
});
t('V5/V6 启动行是单行(无换行)且以固定前缀开头——部署后 grep -c \'handshake auto-accept: DISABLED\' 计数口径稳定', () => {
  for (const env of [{}, { [K]: 'on' }, { [K]: '1\n' }, { [K]: '1' }]) { const l = handshakeStartupLine(env, 'rpc'); assert.ok(!/[\r\n]/.test(l), JSON.stringify(l)); assert.ok(l.startsWith('handshake auto-accept: ')); }
});

t('去重器: 同 key 只打一次; 不同 key 各一次', () => {
  const out = []; const once = createOncePerKeyLogger((...a) => out.push(a.join(' ')));
  once('a', 'A1'); once('a', 'A2'); once('a', 'A3'); once('b', 'B1');
  assert.deepStrictEqual(out, ['A1', 'B1']);
});
t('去重器上限(§8.3): 上限内各一行; 满后恰一行 "suppressing further disabled-peer logs" 再静默; 上限之后的新 key 不再打印', () => {
  const out = []; const once = createOncePerKeyLogger((...a) => out.push(a.join(' ')), { cap: 3 });
  for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) once(k, 'L-' + k);
  assert.deepStrictEqual(out, ['L-a', 'L-b', 'L-c', 'suppressing further disabled-peer logs']);
  once('a', 'again'); once('zzz', 'new');   // 已见 key 静默; 新 key 静默
  assert.strictEqual(out.length, 4);
});
t('去重器上限: 默认上限 1000(DISABLED_LOG_CAP); 第 1000 个 key 仍打印, 第 1001 个触发抑制提示', () => {
  assert.strictEqual(DISABLED_LOG_CAP, 1000);
  const out = []; const once = createOncePerKeyLogger((...a) => out.push(a.join(' ')));
  for (let i = 0; i < 1000; i++) once('k' + i, 'x');
  assert.strictEqual(out.length, 1000);
  once('k1000', 'x');
  assert.strictEqual(out.length, 1001); assert.strictEqual(out[1000], 'suppressing further disabled-peer logs');
  once('k1001', 'x'); assert.strictEqual(out.length, 1001);
});
t('去重器: 每个实例各有自己的 Set(两个去重器互不影响)', () => {
  const o1 = [], o2 = [];
  const a = createOncePerKeyLogger((x) => o1.push(x)), b = createOncePerKeyLogger((x) => o2.push(x));
  a('k', 'A'); b('k', 'B'); a('k', 'A'); b('k', 'B');
  assert.deepStrictEqual([o1, o2], [['A'], ['B']]);
});

t('模块零 import、除默认参数外不读 process.env(读取集中在一处, 每次调用读)', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'handshake-switch.mjs'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/^\s*import\s/m.test(src), '出现 import');
  const envReads = src.match(/process\.env/g) || [];
  assert.strictEqual(envReads.length, 2, 'process.env 出现次数(两个函数的默认参数各一): ' + envReads.length);
  assert.ok(!/^(const|let|var)\s+\w+\s*=\s*process\.env/m.test(src), '不得在模块顶层把 env 读成常量');
});

console.log(`\nhandshake-switch.test: ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
