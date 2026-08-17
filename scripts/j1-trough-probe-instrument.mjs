// J1 trough 探针测量仪器 v3 — Codex b7e269f6 四条 MUST-FIX 合规版(纯 Node, 弃 shell 内嵌)
// 授权链: Owner 政策变更(ledger (420)) + 测试计划 docs/2026-08-17-j1-trough-probe-test-plan-v1.md(v1.3)
// 用法: node scripts/j1-trough-probe-instrument.mjs [TIME_CAP_MIN=360] [DRYRUN=0]
//
// MUST-FIX 落点:
// #1 依赖 sha256 启动强制: 唯一测量链依赖 = 发送器(git-tracked 副本 scripts/probe-deps/j1-send-one.sh),
//    启动实算 sha256 比对 PINNED_SENDER_SHA, 不符拒跑。RPC 采样/第二节点读均为本文件内嵌(kaspa-wasm 直连),
//    j1-node-sync.mjs/j1-remote-node-check-0812.mjs 两个旧依赖已从测量链移除。ssh+askpass=凭据传输非测量逻辑(计划披露)。
// #2 完整 submit txid: 发送器仅报 8 位前缀 ⇒ 记 prefix + 经唯一 TAG 从 console 行取完整 tx_hash,
//    校验 prefix 一致后作为 submitTxid 持久化(console 是应用暴露点, Codex 许可的绑定路径)。
// #3 firstSeen 仅当 row.tx_hash 匹配 /^[0-9a-f]{64}$/ 才置位, 完整 hash 独立字段。
// #4 第二节点样本: trigger 检出后、发送前立读(带真时戳); confirmed 后补读一次。失败记 {absent, reason}。
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
const require = createRequire('D:/kanet/kanet/kasia-console/package.json');
const { RpcClient, Encoding } = require('kaspa-wasm');

const TIME_CAP_MIN = Number(process.argv[2] || 360);
const DRYRUN = process.argv[3] === '1';
const NODE1 = { id: 'local-J1-ws://127.0.0.1:17210-testnet-12', url: 'ws://127.0.0.1:17210' };
const NODE2 = { id: 'mining-host-100.99.147.101:17210', tunnelPort: 17225 };
const RELAY_ID = 'e7f51073-6b6c-41ea-b7fe-e82e98531a9a';
const CHANNEL = 'dev-coord-testnet';
const LOG = 'D:/kanet/kanet/scratch/j1-trough-probe-artifact3.jsonl';
const SENDER = 'D:/kanet/kanet/scripts/probe-deps/j1-send-one.sh';
const SENDER_BASH = '/d/kanet/kanet/scripts/probe-deps/j1-send-one.sh';
const PINNED_SENDER_SHA = 'c70c76d47d279e3956faafeae36686c5dd25cb0d757d4c0cb26d042d12c5980f';
const PAYLOAD = 'D:/kanet/kanet/scratch/j1-trough-payload.json';
const PAYLOAD_BASH = '/d/kanet/kanet/scratch/j1-trough-payload.json';
const ASKPASS_SHA_RECORDED = null; // 凭据文件: 只在计划中披露路径与角色, 不参与测量语义

const now = () => new Date().toISOString();
const log = (o) => appendFileSync(LOG, JSON.stringify(o) + '\n');
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

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
  // #4: 即时读, 带真时戳; ssh 隧道短生命周期
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

async function pollRowByTag(tag) {
  try {
    const res = await fetch(`http://127.0.0.1:3200/api/chat/messages?channel=${CHANNEL}&limit=10`, { signal: AbortSignal.timeout(8000) });
    const j = await res.json();
    return (j.messages || []).find(m => String(m.content || '').includes(tag)) || null;
  } catch { return null; }
}

// ── 启动自检(#1) ──
if (!existsSync(SENDER)) { console.log('INSTRUMENT-REFUSED: 发送器 git 副本缺失 ' + SENDER); process.exit(1); }
const actualSha = sha256(SENDER);
if (actualSha !== PINNED_SENDER_SHA) { console.log(`INSTRUMENT-REFUSED: 发送器 sha256 不符 pinned=${PINNED_SENDER_SHA} actual=${actualSha}`); process.exit(1); }
const selfSha = sha256(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:'));
console.log(`INSTRUMENT-START v3 selfSha=${selfSha.slice(0, 16)}… senderSha=OK cap=${TIME_CAP_MIN}min dryrun=${DRYRUN}`);

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
      const node2AtTrigger = await secondNodeRead('at-trigger'); // #4
      const tag = `${new Date().toISOString().slice(11, 19).replace(/:/g, '')}-${Math.floor(Math.random() * 32768)}`;
      const msg = `[J1tn trough probe ${tag} · 计划 v1.3 授权样本] 随机尾: ${createHash('sha256').update(String(Math.random()) + now()).digest('hex').slice(0, 24)}`;
      writeFileSync(PAYLOAD, JSON.stringify({ relayId: RELAY_ID, channel: CHANNEL, message: msg }));
      const t0 = now();
      const send = spawnSync('bash', [SENDER_BASH, PAYLOAD_BASH], {
        env: { ...process.env, J1_ALLOW_RAW_CHAR: '1', J1_SEND_MAX: '2', J1_SEND_SLEEP: '5' }, encoding: 'utf8', timeout: 300000,
      });
      const sendOut = (send.stdout || '') + (send.stderr || '');
      const prefixMatch = sendOut.match(/txId[=\s:"]+([0-9a-f]{8,64})/i);
      const submitPrefix = prefixMatch ? prefixMatch[1] : null;
      const failClass = /RPC node is not synced/.test(sendOut) ? 'node-not-synced-submit-reject'
        : /UTXO too small|need ~3/.test(sendOut) ? 'utxo-too-small(SEND-leg)'
        : /REFUSED/.test(sendOut) ? 'sender-refused'
        : /rc=7/.test(sendOut) ? 'connection-refused'
        : null;
      if (!submitPrefix) {
        log({ sample: 'excluded', trigger, submit: { t0, ok: false, failClass, logTail: sendOut.split('\n').slice(-4).join(' | ') }, node2AtTrigger, exclusionRule: 'no-submit => zero node-health credit; class recorded' });
        console.log(`SAMPLE-EXCLUDED(${failClass || 'unknown'}) — 零 node-health credit, 已全字段入档`);
        if (failClass === 'sender-refused') { console.log('ABORT: 发送器 REFUSED(中止判据②)'); break; }
        await new Promise(r => setTimeout(r, 60000)); continue;
      }
      // 轮询 first-seen / confirmed (#2 #3): 最多 15min
      let firstSeen = null, confirmed = null, fullTxid = null;
      for (let k = 0; k < 90 && !confirmed; k++) {
        const row = await pollRowByTag(tag);
        if (row && /^[0-9a-f]{64}$/.test(String(row.tx_hash || ''))) {
          fullTxid = row.tx_hash;
          if (!firstSeen) {
            if (!fullTxid.startsWith(submitPrefix.slice(0, 8))) console.log(`WARN: 前缀不符 sender=${submitPrefix} console=${fullTxid.slice(0, 8)}`);
            firstSeen = { t: now(), txHash: fullTxid, status: row.status };
          }
          if (row.status === 'confirmed') confirmed = { t: now(), txHash: fullTxid };
        }
        if (!confirmed) await new Promise(r => setTimeout(r, 10000));
      }
      const node2AtConfirm = confirmed ? await secondNodeRead('at-confirm') : { label: 'at-confirm', skipped: 'no-confirm' };
      got++;
      log({ sample: got, node: NODE1.id, trigger, submit: { t0, ok: true, txidPrefix: submitPrefix, txidFull: fullTxid }, firstSeen: firstSeen || 'none-within-15min', confirmed: confirmed || 'timeout-15min', node2AtTrigger, node2AtConfirm });
      console.log(`TROUGH-PROBE-SAMPLE #${got}: t0=${t0} firstSeen=${firstSeen ? firstSeen.t : '无'} confirmed=${confirmed ? confirmed.t : '超时'} txid=${fullTxid ? fullTxid.slice(0, 12) : '?'}`);
    }
  }
  await new Promise(r => setTimeout(r, 60000));
}
console.log(`PROBE-INSTRUMENT-DONE samples=${got} elapsedMin=${Math.round((Date.now() - start) / 60000)} log=${LOG}`);
process.exit(0);
