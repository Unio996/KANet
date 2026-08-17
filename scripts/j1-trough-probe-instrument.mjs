// J1 trough 探针测量仪器 v4 — Codex MSG-235/236 复审(#2 carried + A-D)合规版
// 授权链: Owner 政策变更(ledger (420)) + 测试计划 docs/2026-08-17-j1-trough-probe-test-plan-v1.md(v1.4)
// 🔴 只准经启动器运行: scripts/j1-trough-probe-launch.sh(清洁树+blob 钉定校验后注入执行身份 env)。
// 用法: bash scripts/j1-trough-probe-launch.sh [TIME_CAP_MIN<=360] [DRYRUN]
//
// 相对 v3 的五处修(对应 Codex 条目):
// #2 submit 阶段完整 txid: 发送器(新版 b01f88b1…)在成功判据成立后、read-back 前发射 `SUBMIT_TXID=<64hex>`,
//    仪器在轮询前解析并持久化; 无该行=合同违约, 样本 excluded(class: no-machine-readable-submit-txid)。
// A  身份矛盾硬拒: console 行 tx_hash 必须与 SUBMIT_TXID 全 64-hex 相等; 不等 ⇒ excluded(txid-identity-contradiction),
//    零 credit。前缀比较已消失。
// B  执行身份绑定: 仅当启动器注入的 EXPECTED_SELF_SHA == 实算 self sha 才运行; run-header JSONL 记
//    {sourceCommit, instrumentBlob, selfSha, senderShaRuntimeCheck, treeClean} 全量执行身份, 每样本带 runId。
// C  TIME_CAP: 有限、正、硬顶 360, 否则拒启。
// D  行绑定: content 全文精确相等 ∧ sender_address == 本 relay 地址; tag 子串只作预过滤; txid 相等为独立第二绑定。
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire('D:/kanet/kanet/kasia-console/package.json');
const { RpcClient, Encoding } = require('kaspa-wasm');

const NODE1 = { id: 'local-J1-ws://127.0.0.1:17210-testnet-12', url: 'ws://127.0.0.1:17210' };
const NODE2 = { id: 'mining-host-100.99.147.101:17210', tunnelPort: 17225 };
const RELAY_ID = 'e7f51073-6b6c-41ea-b7fe-e82e98531a9a';
const MY_ADDR = 'kaspatest:qzdh7nar8wnq4nsag835qv563zkc5q8pufjeq3fcc2nq337mrr04wcfjx6f6u';
const CHANNEL = 'dev-coord-testnet';
const LOG = 'D:/kanet/kanet/scratch/j1-trough-probe-artifact3.jsonl';
const SENDER = 'D:/kanet/kanet/scripts/probe-deps/j1-send-one.sh';
const SENDER_BASH = '/d/kanet/kanet/scripts/probe-deps/j1-send-one.sh';
const PINNED_SENDER_SHA = 'b01f88b18139654d36fb4bdcad6950d7201ea4c38c82101ccc21353f6128364b';
const PAYLOAD = 'D:/kanet/kanet/scratch/j1-trough-payload.json';
const PAYLOAD_BASH = '/d/kanet/kanet/scratch/j1-trough-payload.json';
const HARD_TIME_CAP = 360;

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
  runHeader: true, runId: RUN_ID, t: now(), plan: 'v1.4', instrument: 'v4',
  sourceCommit: SOURCE_COMMIT, instrumentBlob: INSTRUMENT_BLOB, selfSha, treeClean: TREE_CLEAN,
  senderShaRuntimeCheck: { pinned: PINNED_SENDER_SHA, actual: senderShaActual, equal: true },
  node1: NODE1.id, node2: NODE2.id, relay: RELAY_ID, addr: MY_ADDR, timeCapMin: TIME_CAP_MIN, dryrun: DRYRUN,
};
log(runHeader);
console.log(`INSTRUMENT-START v4 ${RUN_ID} commit=${SOURCE_COMMIT.slice(0, 8)} blob=${INSTRUMENT_BLOB.slice(0, 8)} selfSha=OK senderSha=OK cap=${TIME_CAP_MIN}min dryrun=${DRYRUN}`);

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
  const ssh = spawn('ssh', ['-o', 'ConnectTimeout=12', '-L', `${NODE2.tunnelPort}:127.0.0.1:17210`, 'admin@100.99.147.101', 'ping -n 30 127.0.0.1 > NUL'],
    { env: { ...process.env, SSH_ASKPASS: '/d/kanet/kanet/scratch/j1-askpass-0808.sh', SSH_ASKPASS_REQUIRE: 'force', DISPLAY: ':0' }, stdio: 'ignore' });
  try {
    await new Promise(r => setTimeout(r, 5000));
    const v = await rpcRead(`ws://127.0.0.1:${NODE2.tunnelPort}`);
    return { label, node: NODE2.id, ...v };
  } catch (e) {
    return { label, node: NODE2.id, absent: true, reason: String(e.message || e), t: now() };
  } finally { try { ssh.kill(); } catch {} }
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
      const msg = `[J1tn trough probe ${tag} · 计划 v1.4 授权样本] 随机尾: ${randomBytes(12).toString('hex')}`;
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
      // 轮询 first-seen / confirmed; A: 全 64-hex 相等硬闸
      let firstSeen = null, confirmed = null, contradiction = null;
      for (let k = 0; k < 90 && !confirmed && !contradiction; k++) {
        const row = await pollExactRow(tag, msg);
        if (row && /^[0-9a-f]{64}$/.test(String(row.tx_hash || ''))) {
          if (row.tx_hash !== submitTxid) {
            contradiction = { t: now(), submitTxid, rowTxHash: row.tx_hash };
          } else {
            if (!firstSeen) firstSeen = { t: now(), txHash: row.tx_hash, status: row.status };
            if (row.status === 'confirmed') confirmed = { t: now(), txHash: row.tx_hash };
          }
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
