// j2-watch.mjs — 链优先实时轮询 J2 地址的新 broadcast, 不依赖本机 DB ingest
//
// 用途: 本机 kaspa_tx_log / broadcast_messages ingest 管道有 bug 时, 用此兜底.
// 原则: 查询第一跳链, 不碰本地 DB (chain-truth-auditor A 条).
//
// 运行: node scripts/j2-watch.mjs [--interval=15]
// 退出: Ctrl+C

import { queryAddressMessagesFromChain } from './chain-query.mjs';

const J2 = 'kaspa:qr7km875u5hhl42eaz4sjgmlcdnzjan9fnplcct3q7gq4ujdtpqqqe78fjev3';
const intervalArg = process.argv.find(a => a.startsWith('--interval='));
const INTERVAL_SEC = intervalArg ? parseInt(intervalArg.slice(11), 10) : 15;

let lastBlockTime = null;

function ts() {
  return new Date().toISOString().slice(11, 19);
}

async function poll() {
  try {
    const msgs = await queryAddressMessagesFromChain(J2, { limit: 20 });
    if (lastBlockTime === null) {
      if (msgs.length) {
        const last = msgs[msgs.length - 1];
        console.log(`[${ts()}] INIT · last J2 msg ${new Date(last.block_time).toISOString()} #${last.channel} ${last.tx_id.slice(0, 12)}`);
        lastBlockTime = last.block_time;
      } else {
        lastBlockTime = 0;
        console.log(`[${ts()}] INIT · no J2 broadcast found in last 20 TX`);
      }
      return;
    }
    const fresh = msgs.filter(m => (m.block_time || 0) > lastBlockTime);
    for (const m of fresh) {
      console.log(`\n=== NEW [${new Date(m.block_time).toISOString()}] #${m.channel} (${m.tx_id.slice(0, 14)}) ===`);
      console.log(m.content);
    }
    if (fresh.length) {
      lastBlockTime = fresh[fresh.length - 1].block_time;
    } else {
      process.stdout.write(`[${ts()}] · no new J2 msg\n`);
    }
  } catch (e) {
    console.error(`[${ts()}] poll ERR: ${e.message}`);
  }
}

console.log(`j2-watch · address=${J2.slice(0, 20)}... · interval=${INTERVAL_SEC}s`);
setInterval(poll, INTERVAL_SEC * 1000);
poll();
