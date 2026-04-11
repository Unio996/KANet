/**
 * KANet UI — Shared Alpine.js utilities
 *
 * Include via <script src="/public/kanet-ui.js"></script> before Alpine init.
 * Provides: address helpers, time formatting, status mapping, clipboard.
 */

const KANet = {
  /** Truncate Kaspa address: kaspa:qz...last8 */
  shortAddr(addr, tail = 8) {
    if (!addr) return '';
    if (addr.length <= 20) return addr;
    const prefix = addr.startsWith('kaspa:') ? 'kaspa:' : '';
    return prefix + addr.slice(prefix.length, prefix.length + 2) + '...' + addr.slice(-tail);
  },

  /** Copy text to clipboard, returns promise */
  async copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback for non-HTTPS
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    }
  },

  /** Relative time: "3 分钟前", "2 小时前", "昨天" — auto-detects locale */
  relativeTime(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ago';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    const day = Math.floor(hr / 24);
    if (day === 1) return 'yesterday';
    if (day < 30) return day + 'd ago';
    return new Date(iso).toLocaleDateString();
  },

  /** Format absolute time in user's local timezone */
  formatTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString(undefined, { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  },

  /** Format KAS amount: 1234.56789 → "1,234.57" */
  formatKas(amount, decimals = 2) {
    if (amount == null) return '—';
    const n = Number(amount);
    if (isNaN(n)) return '—';
    return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  },

  /** Order status → display label */
  statusLabel(status) {
    const map = {
      published: 'Published', accepted: 'Accepted', paying: 'Paying',
      paid: 'Paid', verified: 'Verified', delivering: 'Delivering',
      completed: 'Completed', cancelled: 'Cancelled', expired: 'Expired',
      disputed: 'Disputed', escalated: 'Escalated', resolved: 'Resolved',
    };
    return map[status] || status;
  },

  /** Order status → semantic color class */
  statusColor(status) {
    const map = {
      published: 'info', accepted: 'info',
      paying: 'warning', paid: 'warning',
      verified: 'success', delivering: 'success', completed: 'success', resolved: 'success',
      cancelled: 'neutral', expired: 'neutral',
      disputed: 'error', escalated: 'error',
    };
    return map[status] || 'neutral';
  },

  /** Health status → dot color */
  healthDot(status) {
    if (status === 'GREEN' || status === 'green') return 'green';
    if (status === 'YELLOW' || status === 'yellow') return 'yellow';
    if (status === 'RED' || status === 'red') return 'red';
    return 'gray';
  },

  /** Side label */
  sideLabel(side) {
    return side === 'buy' ? 'Buy' : side === 'sell' ? 'Sell' : side;
  },

  /** Chain display name */
  chainName(chain) {
    const map = { bnb: 'BNB Chain', eth: 'Ethereum', sol: 'Solana', tron: 'TRON', polygon: 'Polygon' };
    return map[chain] || (chain || '').toUpperCase();
  },

  // ── Exchange UI helpers ────────────────────────────────────

  /** Price vs market badge: +1.2% → green, -0.5% → red */
  priceVsMarketBadge(pct) {
    if (pct == null) return { text: '—', css: 'text-ink-400' };
    const abs = Math.abs(pct).toFixed(1);
    if (pct <= -0.3) return { text: `-${abs}%`, css: 'text-green-600 font-medium' }; // cheaper = good for buyer
    if (pct >= 2.0) return { text: `+${abs}%`, css: 'text-red-500 font-medium' };
    if (pct >= 0.3) return { text: `+${abs}%`, css: 'text-yellow-600' };
    return { text: `${pct >= 0 ? '+' : ''}${abs}%`, css: 'text-ink-500' }; // near market price
  },

  /** Star rating → HTML string (★★★☆☆) */
  starRating(stars, max = 5) {
    const full = Math.min(Math.max(0, Math.round(stars || 0)), max);
    return '★'.repeat(full) + '☆'.repeat(max - full);
  },

  /** Risk level → badge { text, css } */
  riskBadge(risk) {
    const map = {
      low:     { text: 'Low Risk',     css: 'bg-green-100 text-green-700' },
      medium:  { text: 'Medium Risk',  css: 'bg-yellow-100 text-yellow-700' },
      high:    { text: 'High Risk',    css: 'bg-red-100 text-red-700' },
      unknown: { text: 'Unknown',      css: 'bg-gray-100 text-gray-500' },
    };
    return map[risk] || map.unknown;
  },

  /** Exchange offer status → display label (English) */
  exchangeStatus(status) {
    const map = {
      open: 'Open', matched: 'Matched', verifying: 'Verifying',
      awaiting_manual_confirm: 'Awaiting Confirm', delivering: 'Delivering',
      completed: 'Completed', cancelled: 'Cancelled', expired: 'Expired',
      timed_out: 'Timed Out', disputed: 'Disputed',
    };
    return map[status] || status;
  },

  /** Exchange offer status → step index for stepper (0-4) */
  exchangeStep(status) {
    const steps = { open: 0, matched: 1, verifying: 2, delivering: 3, completed: 4 };
    return steps[status] ?? 0;
  },

  /** Chain → TX viewer URL. Kaspa uses local system RPC, cross-chain uses external */
  explorerTxUrl(chain, txHash) {
    if (!txHash) return null;
    if (chain === 'kaspa') return `/api/chain/tx/${txHash}`;
    const map = {
      bnb:     `https://bscscan.com/tx/${txHash}`,
      eth:     `https://etherscan.io/tx/${txHash}`,
      sol:     `https://solscan.io/tx/${txHash}`,
      tron:    `https://tronscan.org/#/transaction/${txHash}`,
    };
    return map[chain] || null;
  },

  /** Format USDT amount: 3.35 → "$3.35" */
  formatUsdt(amount) {
    if (amount == null) return '—';
    const n = Number(amount);
    if (isNaN(n)) return '—';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },

  /** Countdown from expires_at */
  countdown(expiresAt) {
    if (!expiresAt) return '';
    const remaining = new Date(expiresAt).getTime() - Date.now();
    if (remaining <= 0) return 'Expired';
    const min = Math.floor(remaining / 60000);
    if (min < 60) return min + 'm left';
    const hr = Math.floor(min / 60);
    return hr + 'h ' + (min % 60) + 'm left';
  },
};

// Expose globally for Alpine.js templates
window.KANet = KANet;
