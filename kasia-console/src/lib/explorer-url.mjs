// B2 v0.5 UAT pain point #3 — explorer URL helper.
// User-facing TX hashes should link to a block explorer so users can verify on-chain
// without hand-assembling URLs.

/**
 * Build a block explorer URL for a transaction.
 * @param {string} txid - transaction id
 * @param {string} networkId - e.g. 'testnet-12' or 'mainnet'
 * @returns {string} explorer URL
 */
export function buildExplorerUrl(txid, networkId) {
  if (!txid) return '';
  const net = String(networkId || '');
  if (net.startsWith('testnet')) {
    return `https://explorer-tn12.kaspa.org/txs/${txid}`;
  }
  return `https://explorer.kaspa.org/txs/${txid}`;
}

/**
 * Build a block explorer URL for an address.
 * @param {string} address
 * @param {string} networkId
 * @returns {string} explorer URL
 */
export function buildExplorerAddressUrl(address, networkId) {
  if (!address) return '';
  const net = String(networkId || '');
  if (net.startsWith('testnet')) {
    return `https://explorer-tn12.kaspa.org/addresses/${address}`;
  }
  return `https://explorer.kaspa.org/addresses/${address}`;
}
