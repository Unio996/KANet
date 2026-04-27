// 反查 BSC: broker 收款地址最近 USDT 转入, 找 Owner 1.88 USDT from 0x1417cfDaD...
// 不让 Owner 手贴 tx hash, 系统自己查链.

const BROKER_BSC = '0xaD12544E7020e16D1279c65Cc5810c8D8a3efcEe';
const OWNER_BSC  = '0x1417cfDaD7a5Be7d3D2835001019' + '4CFcABf2596D';  // 从 Kasia DM 截图复述
const USDT_BNB   = '0x55d398326f99059fF775485246999027B3197955';  // BSC USDT (BEP20)
const RPC_LIST = [
  'https://bsc-rpc.publicnode.com',
  'https://bsc.drpc.org',
  'https://1rpc.io/bnb',
  'https://bsc-dataseed.bnbchain.org',
  'https://bsc-dataseed2.bnbchain.org',
  'https://binance.llamarpc.com',
];

// USDT Transfer event topic: keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Pad address to 32-byte topic format (0x prefix + 24 zero hex + 40 hex address, lowercase)
function topicPad(addr) {
  const a = addr.replace(/^0x/, '').toLowerCase();
  return '0x' + '0'.repeat(64 - a.length) + a;
}

async function rpc(method, params) {
  let lastErr;
  for (const url of RPC_LIST) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(8000),
      });
      const j = await res.json();
      if (j.error) { lastErr = `${url}: ${j.error.message}`; continue; }
      return { ...j, _rpc: url };
    } catch (e) { lastErr = `${url}: ${e.message}`; }
  }
  return { error: { message: 'all RPC failed: ' + lastErr } };
}

async function main() {
  console.log('Broker BSC收款:', BROKER_BSC);
  console.log('Owner BSC付款:',  OWNER_BSC);
  console.log('USDT contract:',  USDT_BNB);
  console.log();

  // 当前块
  const head = await rpc('eth_blockNumber', []);
  const headNum = parseInt(head.result, 16);
  // 30 min = ~600 blocks (BSC ~3s/block)
  // 扩大到近 5h 全扫, 不漏 Owner 任何付款时间窗. 多 RPC 分段防限速.
  const SPAN = 1500;  // 缩到 ~75min, 找最近 Owner 这单 1.5387 USDT
  const fromBlock = '0x' + (headNum - SPAN).toString(16);
  const toBlock   = 'latest';
  console.log(`扫块: ${headNum - SPAN} → ${headNum} (last ~30min, RPC=${head._rpc})`);

  // 分段扫 (单段 ≤ 1000 blocks 防 RPC 拒)
  const CHUNK = 1000;
  const events = [];
  for (let start = headNum - SPAN; start < headNum; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, headNum);
    const chunkLogs = await rpc('eth_getLogs', [{
      address: USDT_BNB,
      topics: [TRANSFER_TOPIC, null, topicPad(BROKER_BSC)],
      fromBlock: '0x' + start.toString(16),
      toBlock:   '0x' + end.toString(16),
    }]);
    if (chunkLogs.error) { console.warn(`chunk ${start}-${end} err:`, chunkLogs.error.message); continue; }
    events.push(...(chunkLogs.result || []));
  }
  // also fetch BNB native transfers? eth_getLogs only catches USDT contract events.
  // 同时查 broker BNB native 转入 (用 alchemy_getAssetTransfers 风格不可用 → trace_filter / debug_traceBlock 不公开).
  // 简化: 只查 USDT, 因为协议只验 USDT.
  const logs = { result: events };
  if (logs.error) { console.error('RPC error:', logs.error); return; }

  console.log(`\n找到 ${events.length} 笔 USDT 转入 broker 地址:`);
  for (const e of events) {
    const fromTopic = e.topics[1];  // 0x000...{40hex_addr}
    const fromAddr  = '0x' + fromTopic.slice(-40);
    const valueHex  = e.data;       // 32-byte amount
    // BSC USDT = 18 decimals
    const valueWei  = BigInt(valueHex);
    const valueUsdt = Number(valueWei) / 1e18;
    const isOwner   = fromAddr.toLowerCase() === OWNER_BSC.toLowerCase();
    const mark      = isOwner ? '★ MATCH OWNER' : '';
    console.log(`  block=${parseInt(e.blockNumber,16)}  tx=${e.transactionHash}  from=${fromAddr}  amount=${valueUsdt} USDT  ${mark}`);
  }
}

main().catch(e => { console.error('ERR:', e.message, e.stack); process.exit(1); });
