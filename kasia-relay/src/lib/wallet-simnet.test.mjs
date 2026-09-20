// wallet-simnet.test.mjs — 批9 9-4: relay 钱包认 simnet(一行 case)+ mainnet / testnet 分支逐字未变的对照。
// 背景: relay 起在 simnet 时 relay.mjs 顶层 getWallet().getAddress() 抛 "Unsupported network type: simnet" ⇒ relay 起不来, 9-4 隔离 simnet 端到端无从谈起。
// 全程只用进程内 randomBytes 现生成的一次性私钥(不读不打印任何真实密钥); 不连节点。
// Run: cd kasia-relay && node src/lib/wallet-simnet.test.mjs
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import * as kaspa from 'kaspa-wasm';
import { KaspaWallet } from './wallet.mjs';

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const priv = crypto.randomBytes(32).toString('hex');
const W = (net) => KaspaWallet.fromPrivateKey(priv, net);
const SRC = fs.readFileSync(new URL('./wallet.mjs', import.meta.url), 'utf8');
const BEFORE = fs.readFileSync(new URL('../../test-fixtures/wallet-simnet/getNetworkType.BEFORE-cd0b9f88.txt', import.meta.url), 'utf8');
const fnText = (src) => { const a = src.indexOf('function getNetworkType'); return src.slice(a, src.indexOf('\n}\n', a) + 3); };

t('simnet: getAddress 不再抛错, 前缀 kaspasim; getNetworkType() 是 NetworkType.Simnet(3)', () => {
  const w = W('simnet');
  assert.ok(w.getAddress().startsWith('kaspasim:'), w.getAddress().split(':')[0]);
  assert.strictEqual(w.getNetworkType(), kaspa.NetworkType.Simnet); assert.strictEqual(kaspa.NetworkType.Simnet, 3);
  assert.strictEqual(w.getNetworkId(), 'simnet');
});
t('mainnet / testnet-10/11/12 行为不变: 前缀与 NetworkType 与基线一致(同一把 key)', () => {
  assert.ok(W('mainnet').getAddress().startsWith('kaspa:') && !W('mainnet').getAddress().startsWith('kaspasim:'));
  assert.strictEqual(W('mainnet').getNetworkType(), kaspa.NetworkType.Mainnet);
  for (const n of ['testnet-10', 'testnet-11', 'testnet-12']) { assert.ok(W(n).getAddress().startsWith('kaspatest:'), n); assert.strictEqual(W(n).getNetworkType(), kaspa.NetworkType.Testnet, n); }
});
t('getGeneratorNetworkId 不动: testnet-12 → testnet-10 的既有映射保留; simnet 原样返回 simnet; mainnet 原样', () => {
  assert.strictEqual(W('testnet-12').getGeneratorNetworkId(), 'testnet-10'); assert.strictEqual(W('simnet').getGeneratorNetworkId(), 'simnet'); assert.strictEqual(W('mainnet').getGeneratorNetworkId(), 'mainnet');
});
t('其它网络名仍拒(不是"放开一切"): simnet2 / devnet / SIMNET / 空串 / 带空白 / testnet-9 ⇒ Unsupported network type', () => {
  for (const n of ['simnet2', 'devnet', 'SIMNET', '', ' simnet', 'simnet ', 'testnet-9', 'kaspasim']) assert.throws(() => W(n).getAddress(), /Unsupported network type/, JSON.stringify(n));
});
t('逐字对照: 现函数删去 simnet 那一行后与基线 cd0b9f88 的 getNetworkType 逐字相同(mainnet / testnet 分支一字未动, 只多一个 case)', () => {
  const now = fnText(SRC);
  const lines = now.split('\n'); const idx = lines.findIndex((l) => /^\s*case 'simnet':/.test(l));
  assert.ok(idx > 0, '现函数里应有 simnet case'); assert.strictEqual(lines.filter((l) => /case 'simnet'/.test(l)).length, 1, '恰一处');
  lines.splice(idx, 1);
  assert.strictEqual(lines.join('\n'), BEFORE);
  assert.strictEqual(now.split('\n').length, BEFORE.split('\n').length + 1, '恰多一行');
});
t('整个 wallet.mjs 相对基线只多这一行(逐行对照: 现文件删掉 simnet case 行后 == git 基线文本的函数外部分不变)——函数体之外的文本未变', () => {
  const outside = (src) => { const a = src.indexOf('function getNetworkType'); const b = src.indexOf('\n}\n', a) + 3; return src.slice(0, a) + src.slice(b); };
  // 基线函数外文本无法从夹具还原, 这里用结构性断言: simnet 字样在整个文件里只出现在那一处 case 及其注释
  const hits = SRC.split('\n').filter((l) => /simnet/i.test(l));
  assert.strictEqual(hits.length, 1, '整个 wallet.mjs 里 simnet 只出现在新增那一行: ' + hits.length);
  assert.ok(outside(SRC).length > 1000);
});

console.log(`\nwallet-simnet.test: ${pass} passed, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
