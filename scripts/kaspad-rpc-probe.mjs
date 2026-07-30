// kaspad-rpc-probe.mjs — one-shot TN12 node liveness probe for kaspad-watchdog.ps1
//
// 判据(替代坏掉的 CommandLine-match·见 scratch/watchdog-fix/PROPOSAL-...md):
//   "我们那台 TN12 在答、且数据真回来了" = 活
//   —— 不是"口通"、不是"进程在"。原 CommandLine 判据两机两形态坏法(A 空 CommandLine 假 DEAD /
//      B 多进程匹配假活)见 needs-change 台账。
//
// 🔴 必改一/二(Bettor 08:08 verdict·§5 实测钉死):
//   · getBlockDagInfo().network === 'testnet-12'  ← 身份字段(实测:networkName=undefined 不可用;
//        且用错 networkId 构造 RpcClient 照样连上照样答 ⇒ 连上≠是 TN12 ⇒ 必须查此字段)
//   · virtualDaaScore 是合理正数        ← 数据真回来(不是空/错误对象)
// 🔴 必改四:所有 RPC 调用带定死超时,永不挂(挂住与死掉的进程输出必须可分)。
//
// 🔴 退码必须【可区分】(Bettor 08:56:别把四种失败塌成一个"失败",否则 watchdog 又回到"一个恒定的死"):
//   0 = ALIVE
//   2 = 身份不符 (wrong-network:连上了但不是我们那台 TN12)
//   3 = 数据空   (empty-data:答了但 DAA 不是合理正数)
//   4 = 探测超时 (timeout:某个 RPC 调用超时,含硬超时兜底)
//   5 = 连不上   (connect-fail:连接被拒/RPC 不在)
//   6 = 依赖缺失 (kaspa-wasm 加载失败:探测器自身坏,不是节点坏)
//   1 = 其它异常
// stdout 打印一行 ALIVE:... / DEAD:<reason>,reason 亦带类型,供 PS 端 parse。
// 用法: node scripts/kaspad-rpc-probe.mjs [--timeout-ms=8000]

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const URL = process.env.KASPAD_PROBE_URL || 'ws://127.0.0.1:17210';
const EXPECT_NETWORK = process.env.KASPAD_PROBE_NETWORK || 'testnet-12';
const TIMEOUT_MS = (() => {
  const a = process.argv.find((x) => x.startsWith('--timeout-ms='));
  const v = a ? parseInt(a.split('=')[1], 10) : NaN;
  return Number.isFinite(v) && v > 0 ? v : 8000;
})();

function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout:${label}:${ms}ms`)), ms)),
  ]);
}

function die(reason, code) {
  // 单行、机器可 parse。DEAD 一律 code!=0。
  process.stdout.write(`DEAD:${reason}\n`);
  process.exit(code == null ? 1 : code);
}

(async () => {
  // 🔴 硬超时兜底:整个进程绝不超过 TIMEOUT_MS*2 —— 即便 kaspa-wasm 内部卡住,也强制退出为 DEAD。
  //    (挂住的探测 == 死掉的探测,不许静默拖住 watchdog 循环)
  const hardKill = setTimeout(() => die('probe-hardtimeout', 4), TIMEOUT_MS * 2 + 1000);
  hardKill.unref?.();

  let rpc = null;
  try {
    let kaspa;
    try {
      kaspa = require(join(__dirname, '..', 'kasia-relay', 'node_modules', 'kaspa-wasm', 'kaspa.js'));
    } catch (e) {
      die(`kaspa-wasm-load-fail:${e.message}`, 6);
    }
    const { RpcClient, Encoding } = kaspa;
    if (!RpcClient || !Encoding) die('kaspa-wasm-missing-exports', 6);

    rpc = new RpcClient({ url: URL, encoding: Encoding.Borsh, networkId: EXPECT_NETWORK });
    // 连不上(5) 与 超时(4) 要分开:connect 失败若非 timeout,归"连不上"。
    try {
      await withTimeout(rpc.connect(), TIMEOUT_MS, 'connect');
    } catch (ce) {
      const m = ce && ce.message ? ce.message : String(ce);
      if (m.startsWith('timeout:')) die(`timeout:connect:${m}`, 4);
      die(`connect-fail:${m}`, 5);
    }

    const dag = await withTimeout(rpc.getBlockDagInfo(), TIMEOUT_MS, 'getBlockDagInfo');

    // 必改二:身份字段。连上不代表是 TN12,必须核 network。
    if (!dag || dag.network !== EXPECT_NETWORK) {
      die(`wrong-network:${dag && dag.network}`, 2);
    }
    // 必改一:数据真回来。virtualDaaScore 必须是合理正数(BigInt 或 number)。
    const daa = typeof dag.virtualDaaScore === 'bigint' ? dag.virtualDaaScore : BigInt(dag.virtualDaaScore || 0);
    if (!(daa > 0n)) {
      die(`empty-data:daa=${dag.virtualDaaScore}`, 3);
    }

    process.stdout.write(`ALIVE:network=${dag.network} daa=${daa.toString()}\n`);
    clearTimeout(hardKill);
    await rpc.disconnect().catch(() => {});
    process.exit(0);
  } catch (e) {
    try { await rpc?.disconnect(); } catch {}
    const m = e && e.message ? e.message : String(e);
    if (m.startsWith('timeout:')) die(`timeout:${m}`, 4);   // RPC 调用超时(如 getBlockDagInfo 超时)
    die(`probe-error:${m}`, 1);
  }
})();
