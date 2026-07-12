// B2 v0.5 UAT pain point #3 — explorer URL helper.
// User-facing TX hashes should link to a block explorer so users can verify on-chain
// without hand-assembling URLs.
// explorer-url 全库收敛 v1.1 (2026-07-12, NWT 红队 31eade42 GREEN-with-MUST-FIX 折入):
// explorer-tn12.kaspa.org DNS 不存在 (Owner 实测 ENOTFOUND) — TN12 是 KANet 自建私有测试网,
// 从未有人架设公网 explorer。testnet 分支改为诚实返回 null (不是换个域名, 是承认没有);
// mainnet 分支 (explorer.kaspa.org 真实可达) 不动。

/**
 * Build a block explorer URL for a transaction.
 * @param {string} txid - transaction id
 * @param {string} networkId - e.g. 'testnet-12' or 'mainnet'
 * @returns {string|null} explorer URL, or null if no public explorer exists for this network (testnet)
 */
export function buildExplorerUrl(txid, networkId) {
  if (!txid) return null;
  if (String(networkId || '').startsWith('testnet')) return null;
  return `https://explorer.kaspa.org/txs/${txid}`;
}

/**
 * Build a block explorer URL for an address.
 * @param {string} address
 * @param {string} networkId
 * @returns {string|null} explorer URL, or null if no public explorer exists for this network (testnet)
 */
export function buildExplorerAddressUrl(address, networkId) {
  if (!address) return null;
  if (String(networkId || '').startsWith('testnet')) return null;
  return `https://explorer.kaspa.org/addresses/${address}`;
}

/**
 * Display-layer helper: degrade to a plain-text txid credential when no explorer URL exists.
 * Consumers must route through this (never interpolate buildExplorerUrl()'s return value directly —
 * a bare template literal would stringify null into the literal word "null").
 * @param {string} txid
 * @param {string|null} url - result of buildExplorerUrl(txid, networkId)
 * @returns {string} url if present, else "TX: {txid}"; '' if no txid at all
 */
export function formatTxReference(txid, url) {
  if (!txid) return '';
  return url ? url : `TX: ${txid}`;
}
