// peer-watch.mjs — 链优先多地址实时监听 (J2 / NWT / 任何外部 Claude)
//
// 替代 j2-watch.mjs: 只盯一个地址不够用, 会漏消息 (NWT 和 J2 地址不同).
// 此脚本轮询一组地址, 抓任何 dev-coord / kanet-dev 新消息.
//
// 用法: node scripts/peer-watch.mjs [--interval=15]

import { queryAddressMessagesFromChain } from './chain-query.mjs';

const PEERS = {
  J2: 'kaspa:qr7km875u5hhl42eaz4sjgmlcdnzjan9fnplcct3q7gq4ujdtpqqqe78fjev3',
  NWT: 'kaspa:qzd2ktu49f4cqwy7f4s2kmd5m4j0l27gfghjenurypaum99qxz2w7ktl95grm',
};

const intervalArg = process.argv.find(a => a.startsWith('--interval='));
const INTERVAL_SEC = intervalArg ? parseInt(intervalArg.slice(11), 10) : 15;

const lastSeen = {};
for (const name of Object.keys(PEERS)) lastSeen[name] = null;

function tsNow() {
  return new Date().toISOString().slice(11, 19);
}

async function pollOne(name, address) {
  try {
    const msgs = await queryAddressMessagesFromChain(address, { limit: 15 });
    const devMsgs = msgs.filter(m => m.channel === 'dev-coord' || m.channel === 'kanet-dev');
    if (devMsgs.length === 0) return;
    devMsgs.sort((a, b) => (a.block_time || 0) - (b.block_time || 0));

    if (lastSeen[name] === null) {
      const last = devMsgs[devMsgs.length - 1];
      console.log(`[${tsNow()}] INIT ${name} last=${new Date(last.block_time).toISOString()} #${last.channel} ${last.tx_id.slice(0, 12)}`);
      lastSeen[name] = last.block_time;
      return;
    }
    const fresh = devMsgs.filter(m => (m.block_time || 0) > lastSeen[name]);
    for (const m of fresh) {
      console.log(`\n=== NEW [${new Date(m.block_time).toISOString()}] ${name} #${m.channel} (${m.tx_id.slice(0, 14)}) ===`);
      console.log(m.content);
    }
    if (fresh.length) lastSeen[name] = fresh[fresh.length - 1].block_time;
  } catch (e) {
    console.error(`[${tsNow()}] ${name} ERR: ${e.message}`);
  }
}

async function poll() {
  await Promise.all(Object.entries(PEERS).map(([name, addr]) => pollOne(name, addr)));
  const summary = Object.entries(lastSeen).map(([k, v]) => `${k}=${v ? new Date(v).toISOString().slice(11, 19) : '?'}`).join(' ');
  process.stdout.write(`[${tsNow()}] · ${summary}\n`);
}

console.log(`peer-watch · ${Object.keys(PEERS).length} peers · interval=${INTERVAL_SEC}s`);
setInterval(poll, INTERVAL_SEC * 1000);
poll();
