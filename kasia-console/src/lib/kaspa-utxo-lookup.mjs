// kaspa-utxo-lookup.mjs — console 侧只读链读: 某地址当前 UTXO 集 (KAS 单位) (J2 2026-08-29, broker-money-path 阶段 2)
// 用途: broker-refund-classify / broker-escrow-check 否定断言的必需前置 (NWT: 免退款终态/no_escrow 须走 authoritative path, 不能只靠 gappy index)。
// 形: 与 cross-chain-verify.mjs:520-544 的 RPC 回退同一套 (getWorkingRpc + RpcClient.getUtxosByAddresses, 5s 超时), 收拢成单一权威。
// 🔴 只读; 不签名不广播; 失败 throw (调用方 ⇒ UNKNOWN, 方向安全)。返回 [{ txid, index, amountKas, amountSompi, blockDaaScore }]。
// 🔴 诚实边界: current-UTXO ≠ payment-history (收款后扫走 = 无 UTXO 但付过) —— 只作肯定证据, 否定断言还须 coverage 账 (L2)。
export async function fetchAddressUtxosKas(address, { timeoutMs = 5000 } = {}) {
  if (!address || typeof address !== 'string') throw new Error('fetchAddressUtxosKas: address required');
  const { getWorkingRpc } = await import('../services/rpc-health.js');
  const { url: rpcUrl } = await getWorkingRpc();
  if (!rpcUrl) throw new Error('no RPC node available');
  const kaspa = await import('kaspa-wasm');
  const { RpcClient, Encoding, Address } = kaspa;
  const networkId = process.env.KASPA_NETWORK || 'mainnet';
  const rpc = new RpcClient({ url: rpcUrl, encoding: Encoding.Borsh, networkId });
  const withTimeout = (p, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timeout`)), timeoutMs))]);
  try {
    await withTimeout(rpc.connect({}), 'RPC connect');
    const { entries } = await withTimeout(rpc.getUtxosByAddresses([new Address(address)]), 'UTXO query');
    return (entries || []).map((e) => {
      const outpoint = e?.outpoint || e?.entry?.outpoint || {};
      const sompi = Number(e?.utxoEntry?.amount ?? e?.entry?.utxoEntry?.amount ?? e?.amount ?? 0);
      const daa = Number(e?.utxoEntry?.blockDaaScore ?? e?.entry?.utxoEntry?.blockDaaScore ?? 0);
      return { txid: String(outpoint.transactionId || ''), index: Number(outpoint.index ?? 0), amountSompi: sompi, amountKas: sompi / 1e8, blockDaaScore: daa };
    });
  } finally {
    try { await rpc.disconnect(); } catch { /* best-effort */ }
  }
}

/** 把 async 链读变成 classify 需要的同步闭包: 先 await 取, 失败则返回一个 throw 的闭包 (⇒ UNKNOWN)。 */
export async function makeUtxoLookup(address, opts) {
  try {
    const utxos = await fetchAddressUtxosKas(address, opts);
    return () => utxos;
  } catch (e) {
    const err = e;
    return () => { throw err; };
  }
}
