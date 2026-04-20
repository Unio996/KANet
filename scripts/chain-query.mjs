// chain-query.mjs — 链优先查地址消息 (符合 chain-truth-auditor 原则)
//
// 第一跳永远是链 (api.kaspa.org), DB 只作缓存命中加速, 不作真相源.
// 任何 "查 TX / 消息" 类任务必须过此模块.

const CHAIN_API = process.env.CHAIN_API || 'https://api.kaspa.org';

/**
 * 从链上查地址的 broadcast 消息 (解码 ciph_msg:1:bcast:*)
 * @param {string} address - kaspa:xxx 地址
 * @param {object} opts
 * @param {number} [opts.limit=30] - 拉取 TX 数
 * @param {string|null} [opts.channel=null] - 过滤频道名, null = 全部
 * @param {number|null} [opts.sinceBlockTime=null] - 只要 block_time > 这个值的
 * @returns {Promise<Array<{tx_id, block_time, channel, content}>>}
 */
export async function queryAddressMessagesFromChain(address, opts = {}) {
  const { limit = 30, channel = null, sinceBlockTime = null } = opts;
  const url = `${CHAIN_API}/addresses/${address}/full-transactions?limit=${limit}&resolve_previous_outpoints=no`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`chain query failed: HTTP ${res.status}`);
  const txs = await res.json();
  if (!Array.isArray(txs)) throw new Error(`chain query returned non-array`);

  const msgs = [];
  for (const tx of txs) {
    const payloadHex = tx.payload || '';
    if (!payloadHex) continue;
    const payload = Buffer.from(payloadHex, 'hex').toString('utf8');
    const m = payload.match(/^ciph_msg:1:bcast:([^:]+):([\s\S]*)$/);
    if (!m) continue;
    const [, ch, content] = m;
    if (channel && ch !== channel) continue;
    const blockTime = tx.block_time;
    if (sinceBlockTime && blockTime && blockTime <= sinceBlockTime) continue;
    msgs.push({
      tx_id: tx.transaction_id,
      block_time: blockTime,
      channel: ch,
      content,
    });
  }
  msgs.sort((a, b) => (a.block_time || 0) - (b.block_time || 0));
  return msgs;
}

// CLI: node scripts/chain-query.mjs <kaspa-addr> [channel] [--limit=N]
if (process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  const addr = process.argv[2];
  const channel = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
  const limitArg = process.argv.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.slice(8), 10) : 30;
  if (!addr) {
    console.error('usage: node chain-query.mjs <kaspa-addr> [channel] [--limit=N]');
    process.exit(1);
  }
  queryAddressMessagesFromChain(addr, { channel, limit })
    .then(msgs => {
      console.log(`# ${msgs.length} msgs (channel=${channel || '*'}, limit=${limit})\n`);
      for (const m of msgs) {
        const ts = m.block_time ? new Date(m.block_time).toISOString() : '?';
        console.log(`===[${ts}] #${m.channel} (${m.tx_id.slice(0, 14)})===`);
        console.log(m.content);
        console.log('');
      }
    })
    .catch(e => {
      console.error('ERR:', e.message);
      process.exit(2);
    });
}
