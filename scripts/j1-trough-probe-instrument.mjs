// J1 trough 探针测量仪器 v6 — Codex MSG-237 终审(launcher 信任根/RPC 运行时来源/import 前核/标签一致)合规版
// 授权链: Owner 政策变更(ledger (420)) + 测试计划 docs/2026-08-17-j1-trough-probe-test-plan-v1.md(v1.6)
// 🔴 只准经启动器运行: scripts/j1-trough-probe-launch.sh(外部批准 commit 绑定 + 全 tracked 净树 + blob 校验后注入执行身份 env)。
// 用法(执行方检出根, 树净且在被审 commit 上):
//   J1_PROBE_APPROVED_COMMIT=<被审 commit> J1_PROBE_RELAY_ID=<J2-tn 完整 relayId> bash scripts/j1-trough-probe-launch.sh [TIME_CAP<=360] [DRYRUN]
// pin 链(v6, 全部入 run-header): 外部批准 commit(来自 ledger/Codex 记录) → 启动器身份=HEAD@approved 版本(外绑, 非自证)
//   → 仪器 blob/self-sha → 绑定模块 sha(import 之【前】核, 被换模块零执行) → 发送器 sha
//   → RPC 运行时实体(kaspa-wasm 入口 JS + wasm 字节, resolve 落 vendored git-tracked 路径)。
// 行为要点: SUBMIT_TXID 全量持久化后才轮询 / 身份矛盾=excluded 零 credit / 行绑定=全文+发送方精确相等
//   / TIME_CAP 硬顶 360 / 失败分类学(node-not-synced-submit-reject 等)全字段入档。
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
// v5: 仓库根从仪器自身位置推导(J2 检出根=D:\kanet-tn12, 不能写死 J1 的根)
const SELF_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = dirname(dirname(SELF_PATH));            // <root>/scripts/xxx.mjs → <root>
const toBash = (p) => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (m, d) => '/' + d.toLowerCase());
const require = createRequire(join(REPO_ROOT, 'kasia-console', 'package.json'));
const _readFileSync = (await import('node:fs')).readFileSync;
const _createHash = (await import('node:crypto')).createHash;
const _sha256 = (p) => _createHash('sha256').update(_readFileSync(p)).digest('hex');
// ── v6 blocker#3: 绑定模块 hash 在 import【之前】核——被换的模块一行顶层 JS 都不许执行 ──
const BINDING_MOD = join(REPO_ROOT, 'kasia-console', 'src', 'lib', 'j1-probe-binding.mjs');
const PINNED_BINDING_SHA = 'b54d8af1bd166000be82019142043ebf3cf96500a596b9c4a90ce920a867d55d';
{
  const actual = _sha256(BINDING_MOD);
  if (actual !== PINNED_BINDING_SHA) {
    console.log(`INSTRUMENT-REFUSED: 绑定模块 sha256 不符(import 前拦截) pinned=${PINNED_BINDING_SHA} actual=${actual}`);
    process.exit(1);
  }
}
const { decideProbeBinding } = await import(pathToFileURL(BINDING_MOD).href);
// ── v6 blocker#2: RPC 运行时实体(kaspa-wasm 入口 JS + wasm 字节)进 pin 链——它决定 trough 判相/DAA 读/第二节点测 ──
const RPC_ENTRY = require.resolve('kaspa-wasm');            // 实测 resolve 落仓库内 vendored 路径(git-tracked)
const RPC_WASM = join(dirname(RPC_ENTRY), 'kaspa_bg.wasm');
const PINNED_RPC_ENTRY_SHA = '07f86bebfb8496628f30a8637f90fcfcee67043612ce50f40c578d61f8064bb3';
const PINNED_RPC_WASM_SHA = '51cec45e7f21dd7962bcc1830a4236c514d8f829d2babca30e77602a214c3791';
const rpcEntryShaActual = _sha256(RPC_ENTRY);
const rpcWasmShaActual = _sha256(RPC_WASM);
if (rpcEntryShaActual !== PINNED_RPC_ENTRY_SHA || rpcWasmShaActual !== PINNED_RPC_WASM_SHA) {
  console.log(`INSTRUMENT-REFUSED: RPC 运行时实体 sha256 不符 entry(${rpcEntryShaActual.slice(0,12)} vs ${PINNED_RPC_ENTRY_SHA.slice(0,12)}) wasm(${rpcWasmShaActual.slice(0,12)} vs ${PINNED_RPC_WASM_SHA.slice(0,12)})`);
  process.exit(1);
}
const { RpcClient, Encoding } = require('kaspa-wasm');

// v5(计划 v1.5): host 身份全部由启动器钉定注入(J2-tn host profile 写死在 launcher, 非自由参数)。
// 安全承重=SENDER_ADDR(行绑定用, 完整钉定); RELAY_ID=传输寻址(前缀经 launcher 校验+此处全量入档)——
// 错 relayId 只会让 sender_address 不符 ⇒ not-bound 零 credit, 结构上无法伪造 credit。
const NODE1 = { id: process.env.J1_PROBE_NODE1_ID || '', url: 'ws://127.0.0.1:17210' };
const NODE2 = { id: process.env.J1_PROBE_NODE2_ID || '', url: process.env.J1_PROBE_NODE2_URL || '' };
const RELAY_ID = process.env.J1_PROBE_RELAY_ID || '';
const MY_ADDR = process.env.J1_PROBE_SENDER_ADDR || '';
if (!NODE1.id || !NODE2.id || !NODE2.url || !RELAY_ID || !MY_ADDR) {
  console.log('INSTRUMENT-REFUSED: 缺 host profile env(NODE1_ID/NODE2_ID/NODE2_URL/RELAY_ID/SENDER_ADDR, 须经启动器注入)'); process.exit(1);
}
const CHANNEL = 'dev-coord-testnet';
const LOG = join(REPO_ROOT, 'scratch', 'j1-trough-probe-artifact3.jsonl');
const SENDER = join(REPO_ROOT, 'scripts', 'probe-deps', 'j1-send-one.sh');
const SENDER_BASH = toBash(SENDER);
const PINNED_SENDER_SHA = 'b01f88b18139654d36fb4bdcad6950d7201ea4c38c82101ccc21353f6128364b';
const PAYLOAD = join(REPO_ROOT, 'scratch', 'j1-trough-payload.json');
const PAYLOAD_BASH = toBash(PAYLOAD);
const HARD_TIME_CAP = 360;
// 🔴 单一不可变 plan 标签常量(Codex MSG-238 MUST-FIX): run-header 与探针消息构造【共用】此常量,
//    使两者标签结构上无法独立漂移。改版本只改这一处。禁在别处硬编码 v1.x 授权标签。
const PLAN_LABEL = 'v1.6';
mkdirSync(join(REPO_ROOT, 'scratch'), { recursive: true });

const now = () => new Date().toISOString();
const log = (o) => appendFileSync(LOG, JSON.stringify(o) + '\n');
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

// ── C: TIME_CAP 校验(有限/正/硬顶) ──
const capRaw = process.argv[2] === undefined ? HARD_TIME_CAP : Number(process.argv[2]);
if (!Number.isFinite(capRaw) || capRaw <= 0 || capRaw > HARD_TIME_CAP) {
  console.log(`INSTRUMENT-REFUSED: TIME_CAP_MIN 非法(须有限、>0、<=${HARD_TIME_CAP}), 拿到: ${process.argv[2]}`); process.exit(1);
}
const TIME_CAP_MIN = capRaw;
const DRYRUN = process.argv[3] === '1';

// ── B: 执行身份绑定(启动器注入) ──
const EXPECTED_SELF_SHA = process.env.J1_PROBE_EXPECTED_SELF_SHA || '';
const SOURCE_COMMIT = process.env.J1_PROBE_SOURCE_COMMIT || '';
const INSTRUMENT_BLOB = process.env.J1_PROBE_INSTRUMENT_BLOB || '';
const TREE_CLEAN = process.env.J1_PROBE_TREE_CLEAN || '';
const selfPath = fileURLToPath(import.meta.url);
const selfSha = sha256(selfPath);
if (!EXPECTED_SELF_SHA || !SOURCE_COMMIT || !INSTRUMENT_BLOB) {
  console.log('INSTRUMENT-REFUSED: 缺执行身份 env(须经 scripts/j1-trough-probe-launch.sh 启动)'); process.exit(1);
}
if (selfSha !== EXPECTED_SELF_SHA) {
  console.log(`INSTRUMENT-REFUSED: self sha256 与启动器钉定不符 expected=${EXPECTED_SELF_SHA} actual=${selfSha}`); process.exit(1);
}
// ── #1 runtime: 发送器 hash 实算比对, 结果进 run-header ──
if (!existsSync(SENDER)) { console.log('INSTRUMENT-REFUSED: 发送器 git 副本缺失'); process.exit(1); }
const senderShaActual = sha256(SENDER);
if (senderShaActual !== PINNED_SENDER_SHA) {
  console.log(`INSTRUMENT-REFUSED: 发送器 sha256 不符 pinned=${PINNED_SENDER_SHA} actual=${senderShaActual}`); process.exit(1);
}
const RUN_ID = `run-${new Date().toISOString().replace(/[:.]/g, '')}-${randomBytes(3).toString('hex')}`;
const runHeader = {
  runHeader: true, runId: RUN_ID, t: now(), plan: PLAN_LABEL, instrument: 'v6', approvedCommit: process.env.J1_PROBE_APPROVED_COMMIT || '',
  sourceCommit: SOURCE_COMMIT, instrumentBlob: INSTRUMENT_BLOB, selfSha, treeClean: TREE_CLEAN,
  senderShaRuntimeCheck: { pinned: PINNED_SENDER_SHA, actual: senderShaActual, equal: true },
  bindingShaRuntimeCheck: { pinned: PINNED_BINDING_SHA, checkedBeforeImport: true },
  rpcRuntime: { entry: RPC_ENTRY, entrySha: rpcEntryShaActual, wasmSha: rpcWasmShaActual, pinnedEntry: PINNED_RPC_ENTRY_SHA, pinnedWasm: PINNED_RPC_WASM_SHA },
  node1: NODE1.id, node2: NODE2.id, relay: RELAY_ID, addr: MY_ADDR, timeCapMin: TIME_CAP_MIN, dryrun: DRYRUN,
};
log(runHeader);
console.log(`INSTRUMENT-START v6 ${RUN_ID} commit=${SOURCE_COMMIT.slice(0, 8)} blob=${INSTRUMENT_BLOB.slice(0, 8)} selfSha=OK senderSha=OK cap=${TIME_CAP_MIN}min dryrun=${DRYRUN}`);

async function rpcRead(url) {
  const rpc = new RpcClient({ url, encoding: Encoding.Borsh, networkId: 'testnet-12' });
  try {
    await Promise.race([rpc.connect({}), new Promise((_, r) => setTimeout(() => r(new Error('connect-timeout')), 8000))]);
    const si = await rpc.getServerInfo();
    const dag = await rpc.getBlockDagInfo();
    await rpc.disconnect();
    return { t: now(), daa: Number(dag.virtualDaaScore), isSynced: !!si.isSynced, tips: (dag.tipHashes || []).length };
  } catch (e) { try { await rpc.disconnect(); } catch {} throw e; }
}

async function secondNodeRead(label) {
  // v5: 第二节点=启动器钉定 URL 直连(J2-tn host 场景下指 J1 笔记本节点 100.111.126.10:17210, 绑 0.0.0.0 tailnet 可达)。
  try {
    const v = await rpcRead(NODE2.url);
    return { label, node: NODE2.id, ...v };
  } catch (e) {
    return { label, node: NODE2.id, absent: true, reason: String(e.message || e), t: now() };
  }
}

// D: 精确行绑定 — content 全文相等 ∧ sender == 本 relay 地址(tag 子串只是预过滤)
async function pollExactRow(tag, exactMsg) {
  try {
    const res = await fetch(`http://127.0.0.1:3200/api/chat/messages?channel=${CHANNEL}&limit=10`, { signal: AbortSignal.timeout(8000) });
    const j = await res.json();
    return (j.messages || []).find(m =>
      String(m.content || '').includes(tag) &&
      String(m.content || '') === exactMsg &&
      String(m.sender_address || '') === MY_ADDR) || null;
  } catch { return null; }
}

const start = Date.now();
let got = 0, lastProbeMin = 0;
let d1 = null, d2 = null, d3 = null;
while (got < 3) {
  if ((Date.now() - start) / 60000 >= TIME_CAP_MIN) { console.log(`TIME-CAP ${TIME_CAP_MIN}min, samples=${got}`); break; }
  let v;
  try { v = await rpcRead(NODE1.url); } catch (e) { console.log('PROBE-ERR ' + e.message); await new Promise(r => setTimeout(r, 60000)); continue; }
  if (v.tips > 500) { console.log('ABORT: tips>500 runaway'); break; }
  d1 = d2; d2 = d3; d3 = v;
  if (d1) {
    const spanSec = (new Date(d3.t) - new Date(d1.t)) / 1000;
    const rate = (d3.daa - d1.daa) / spanSec;
    const nowMin = Date.now() / 60000;
    if (rate < 1 && nowMin - lastProbeMin >= 15) {
      console.log(`TROUGH 触发 ${v.t} rate=${rate.toFixed(2)}/s (${d1.daa}→${d3.daa}/${spanSec}s)`);
      if (DRYRUN) { console.log('DRYRUN: 不发送'); await new Promise(r => setTimeout(r, 60000)); continue; }
      lastProbeMin = nowMin;
      const trigger = { t: v.t, d1: d1.daa, d3: d3.daa, rateBucket: rate.toFixed(2), node1: { isSynced: v.isSynced, tips: v.tips } };
      const node2AtTrigger = await secondNodeRead('at-trigger');
      const tag = `${new Date().toISOString().slice(11, 19).replace(/:/g, '')}-${randomBytes(2).toString('hex')}`;
      const msg = `[J1tn trough probe ${tag} · 计划 ${PLAN_LABEL} 授权样本] 随机尾: ${randomBytes(12).toString('hex')}`;
      writeFileSync(PAYLOAD, JSON.stringify({ relayId: RELAY_ID, channel: CHANNEL, message: msg }));
      const t0 = now();
      const send = spawnSync('bash', [SENDER_BASH, PAYLOAD_BASH], {
        env: { ...process.env, J1_ALLOW_RAW_CHAR: '1', J1_SEND_MAX: '2', J1_SEND_SLEEP: '5' }, encoding: 'utf8', timeout: 300000,
      });
      const sendOut = (send.stdout || '') + (send.stderr || '');
      // #2: submit 阶段完整 txid(机器可读行)
      const submitM = sendOut.match(/^SUBMIT_TXID=([0-9a-f]{64})$/m);
      const submitTxid = submitM ? submitM[1] : null;
      const failClass = /RPC node is not synced/.test(sendOut) ? 'node-not-synced-submit-reject'
        : /UTXO too small|need ~3/.test(sendOut) ? 'utxo-too-small(SEND-leg)'
        : /REFUSED/.test(sendOut) ? 'sender-refused'
        : /rc=7/.test(sendOut) ? 'connection-refused'
        : /txId/.test(sendOut) ? 'success-but-no-machine-readable-submit-txid' : 'unknown';
      if (!submitTxid) {
        log({ runId: RUN_ID, sample: 'excluded', trigger, submit: { t0, ok: false, failClass, logTail: sendOut.split('\n').slice(-4).join(' | ') }, node2AtTrigger, exclusionRule: 'no submit txid => zero node-health credit' });
        console.log(`SAMPLE-EXCLUDED(${failClass}) — 零 node-health credit`);
        if (failClass === 'sender-refused') { console.log('ABORT: 发送器 REFUSED(中止判据②)'); break; }
        await new Promise(r => setTimeout(r, 60000)); continue;
      }
      // 轮询 first-seen / confirmed; 判定全权委托绑定模块(带 test/mutants 的那份, sha 已钉)
      let firstSeen = null, confirmed = null, contradiction = null;
      for (let k = 0; k < 90 && !confirmed && !contradiction; k++) {
        const row = await pollExactRow(tag, msg);
        const v = decideProbeBinding({ submitTxid, row, exactMsg: msg, expectedSender: MY_ADDR });
        if (v.verdict === 'contradiction') {
          contradiction = { t: now(), submitTxid, rowTxHash: v.txHash };
        } else if (v.verdict === 'first-seen' || v.verdict === 'confirmed') {
          if (!firstSeen) firstSeen = { t: now(), txHash: v.txHash, status: row.status };
          if (v.verdict === 'confirmed') confirmed = { t: now(), txHash: v.txHash };
        }
        if (!confirmed && !contradiction) await new Promise(r => setTimeout(r, 10000));
      }
      if (contradiction) {
        log({ runId: RUN_ID, sample: 'excluded', trigger, submit: { t0, ok: true, txidFull: submitTxid }, contradiction, node2AtTrigger, exclusionRule: 'txid-identity-contradiction => zero node-health credit' });
        console.log('SAMPLE-EXCLUDED(txid-identity-contradiction)');
        await new Promise(r => setTimeout(r, 60000)); continue;
      }
      const node2AtConfirm = confirmed ? await secondNodeRead('at-confirm') : { label: 'at-confirm', skipped: 'no-confirm' };
      got++;
      log({ runId: RUN_ID, sample: got, node: NODE1.id, trigger, submit: { t0, ok: true, txidFull: submitTxid }, firstSeen: firstSeen || 'none-within-15min', confirmed: confirmed || 'timeout-15min', node2AtTrigger, node2AtConfirm });
      console.log(`TROUGH-PROBE-SAMPLE #${got}: t0=${t0} firstSeen=${firstSeen ? firstSeen.t : '无'} confirmed=${confirmed ? confirmed.t : '超时'} txid=${submitTxid.slice(0, 12)}`);
    }
  }
  await new Promise(r => setTimeout(r, 60000));
}
console.log(`PROBE-INSTRUMENT-DONE ${RUN_ID} samples=${got} elapsedMin=${Math.round((Date.now() - start) / 60000)} log=${LOG}`);
process.exit(0);
