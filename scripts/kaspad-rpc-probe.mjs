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
//   7 = SYNCING  (IBD 中: isSynced=false 且有进度信号 = 不该重启)
//   8 = STALLED  (SYNCING 但 >STALL_MS 零进度: 只告警不重启, 交操作员)
//   9 = DEAD:no-process (连不上 且 无 kaspad.exe 进程 = 真死候选; v0.4 三态 §3b)
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

const STATE_FILE = process.env.KASPAD_PROBE_STATE || 'D:/kaspa-tn12-data/kaspad-probe-state.json';
const STALL_MS = (() => { const v = process.env.KASPAD_PROBE_STALL_MS ? parseInt(process.env.KASPAD_PROBE_STALL_MS, 10) : NaN; return Number.isFinite(v) && v > 0 ? v : 120 * 60 * 1000; })(); // 默认 120min (NWT: 缺块体遍历实测静默 58min 贴边 60min, 抬 120 留裕; progressing 含 ibdPeer 使 IBD 期 code8 近不可达=只告警, 真卡死但 peer 连着会漏告警=良性)

function readState() { try { return JSON.parse(require('fs').readFileSync(STATE_FILE, 'utf8')); } catch { return null; } }
function writeState(o) { try { require('fs').writeFileSync(STATE_FILE, JSON.stringify(o)); } catch {} }
function kaspadProcessExists() {
  // win32 进程枚举供 code 9(no-process)。非 win32 或查失败 => null(未知, 不误判死)
  try {
    if (process.platform !== 'win32') return null;
    const out = require('child_process').execSync('tasklist /FI "IMAGENAME eq kaspad.exe" /NH', { timeout: 5000, encoding: 'utf8' });
    return /kaspad\.exe/i.test(out);
  } catch { return null; }
}

// 测试钩子(防回归向量用, NWT): 打印解析后的 STATE_FILE 默认路径并退出, 不连接节点
if (process.argv.includes('--print-state-path')) { process.stdout.write(STATE_FILE + '\n'); process.exit(0); }

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
      // code 9 (DEAD:no-process): 连不上 且 无 kaspad.exe 进程 = 真死候选 (v0.4 §3b 第二路)
      const exists = kaspadProcessExists();
      if (exists === false) die(`no-process:connect-fail:${m}`, 9);
      die(`connect-fail:${m}`, 5);
    }

    const dag = await withTimeout(rpc.getBlockDagInfo(), TIMEOUT_MS, 'getBlockDagInfo');

    // 必改二:身份字段。连上不代表是 TN12,必须核 network。
    if (!dag || dag.network !== EXPECT_NETWORK) {
      die(`wrong-network:${dag && dag.network}`, 2);
    }
    // 必改一:数据真回来。virtualDaaScore 必须是合理正数(BigInt 或 number)。
    const daa = typeof dag.virtualDaaScore === 'bigint' ? dag.virtualDaaScore : BigInt(dag.virtualDaaScore || 0);
    // v0.4 三态: 增采 isSynced + isIbdPeer (在 getBlockDagInfo 后, 只加不改现有身份/超时判据)
    const info = await withTimeout(rpc.getInfo(), TIMEOUT_MS, 'getInfo');
    let ibdPeer = false;
    try {
      const peers = await withTimeout(rpc.getConnectedPeerInfo(), TIMEOUT_MS, 'peers');
      ibdPeer = (peers.peerInfo || peers.infos || peers.peers || []).some((p) => p.is_ibd_peer || p.isIbdPeer);
    } catch {}
    const isSynced = info.isSynced === true;
    if (isSynced && !(daa > 0n)) {
      // 收窄: isSynced 真但 daa 非正数 = 真数据空(罕见); daa=0 的 IBD 走下面 code 7 不再是 3
      die(`empty-data:daa=${dag.virtualDaaScore}`, 3);
    }
    if (!isSynced) {
      // isSynced=false = IBD 中 => SYNCING(7) / STALLED(8), 绝不 DEAD (规则 72 与 VB-9 两根因: daa=0 是 SYNCING 非死)
      const hc = BigInt(dag.headerCount || 0), bc = BigInt(dag.blockCount || 0);
      const prev = readState();
      const progressing = ibdPeer || !prev ||
        hc > BigInt(prev.headerCount || 0) || bc > BigInt(prev.blockCount || 0) || daa > BigInt(prev.daa || 0);
      const now = Date.now();
      const lastProgressTs = (progressing || !prev) ? now : (prev.lastProgressTs || now);
      writeState({ headerCount: hc.toString(), blockCount: bc.toString(), daa: daa.toString(), lastProgressTs });
      if (!progressing && prev && (now - lastProgressTs) > STALL_MS) {
        die(`SYNC-STALLED:hdr=${hc} blk=${bc} daa=${daa} stalledMs=${now - lastProgressTs}`, 8);
      }
      process.stdout.write(`SYNCING:isSynced=false hdr=${hc} blk=${bc} daa=${daa} ibdPeer=${ibdPeer} progressing=${progressing}\n`);
      clearTimeout(hardKill);
      await rpc.disconnect().catch(() => {});
      process.exit(7);
    }

    // ALIVE(0) = HEALTHY: isSynced=true 且 daa>0
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
