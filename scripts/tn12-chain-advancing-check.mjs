#!/usr/bin/env node
/**
 * TN12 链是否在推进 —— 20 秒双采样（只读，不发交易、不碰密钥）。
 *
 * 🔴 **它回答的是「本窗口有没有观察到推进」，不是「链是死是活」** ——
 *    第一版我把零增长直接写成「停摆/halt」，**实测当场打脸**：
 *    07:2xZ 读到 `77078584`、08:0xZ 读到 `77078870` ⇒ **40 分钟涨了 286**，
 *    链其实在出块，只是慢到 ≈0.12/s（TN12 常态 ≈1/s，约 1/10 速率）。
 *    ⇒ **20 秒零增长同时符合「停摆」与「很慢」**，这个窗口分不开它们。
 *    🔨 判据：**一个采样窗口只能证伪它覆盖得住的东西；报结论时要把窗口长度一起报。**
 *
 * 🔵 **为什么还值得跑**：节点会**自报 `isSynced=true` 同时不出块**（2026-08-12 实测），
 *    所以判"链还活着"要用**会单调前进的量**，不能用节点对自己的形容词。
 *
 * 跑： node scripts/tn12-chain-advancing-check.mjs
 * 要分开「停了」与「很慢」： 记下输出里的 daa 与时刻，过 30–60 分钟再跑一次比差值。
 */
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.KANET_ROOT || join(HERE, '..');

// RPC 端点以 kanet.env 为准 —— 🔴 别照记忆里的端口探: 我先探了 16210(也 LISTENING)连不上,
// 差点报成"节点 RPC 死了", 真正的是 KASPA_RPC_URL 里那个。
function resolveRpcUrl() {
  if (process.env.KASPA_RPC_URL) return process.env.KASPA_RPC_URL;
  const envFile = join(ROOT, 'kanet.env');
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, 'utf8').match(/^\s*KASPA_RPC_URL\s*=\s*(\S+)/m);
    if (m) return m[1];
  }
  return 'ws://127.0.0.1:17210';
}

const kaspaPath = ['kasia-relay', 'kasia-console']
  .map((d) => join(ROOT, d, 'node_modules', 'kaspa-wasm', 'kaspa.js'))
  .find((p) => existsSync(p));
if (!kaspaPath) { console.error('找不到 kaspa-wasm（relay / console 两处都没有）'); process.exit(2); }

const w = await import(pathToFileURL(kaspaPath).href);
const { RpcClient, Encoding } = w;
const url = resolveRpcUrl();
const rpc = new RpcClient({ url, encoding: Encoding.Borsh, networkId: process.env.KASPA_NETWORK || 'testnet-12' });

try {
  await Promise.race([rpc.connect({}), new Promise((_, r) => setTimeout(() => r(new Error('connect timeout 10s')), 10000))]);
  const info = await rpc.getInfo().catch(() => ({}));
  const a = await rpc.getBlockDagInfo();
  await new Promise((r) => setTimeout(r, 20000));
  const b = await rpc.getBlockDagInfo();
  const d1 = BigInt(a.virtualDaaScore); const d2 = BigInt(b.virtualDaaScore);
  const pmt = Number(b.pastMedianTime || 0);

  console.log(`rpc            = ${url}`);
  console.log(`isSynced(自报)  = ${info.isSynced}   ⚠ 自报值, 不作判据`);
  console.log(`tips           = ${(b.tipHashes || []).length}`);
  if (pmt) console.log(`pastMedianTime 落后现在 = ${Math.round((Date.now() - pmt) / 1000)} 秒`);
  console.log(`t0 daa         = ${String(d1)}`);
  console.log(`t+20s daa      = ${String(d2)}   Δ = ${String(d2 - d1)}`);
  console.log(`blockCount Δ   = ${String(BigInt(b.blockCount || 0) - BigInt(a.blockCount || 0))}`);

  if (d2 > d1) {
    console.log(`\n✅ 本窗口观察到推进（20 秒 +${String(d2 - d1)}）。`);
  } else {
    console.log('\n🟡 本窗口【未观察到推进】—— 注意: 这**不等于停摆**。');
    console.log('   慢速出块在 20 秒窗口里同样是零增长（2026-08-12 实测: 40 分钟只涨 286 ≈ 0.12/s）。');
    console.log(`   要分开「停了」与「很慢」: 记下 daa=${String(d2)} 与当前时刻, 过 30–60 分钟再跑一次比差值。`);
  }
  await rpc.disconnect();
} catch (e) {
  console.log('🔴 RPC 失败:', (e?.message || e).toString().slice(0, 200));
  process.exitCode = 1;
}
process.exit(process.exitCode || 0);
