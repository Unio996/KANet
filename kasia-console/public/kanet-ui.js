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

  /** Relative time: "3 分钟前", "2 小时前", "昨天" */
  relativeTime(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return '刚刚';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} 分钟前`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} 小时前`;
    const day = Math.floor(hr / 24);
    if (day === 1) return '昨天';
    if (day < 30) return `${day} 天前`;
    return new Date(iso).toLocaleDateString('zh-CN');
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
      published: '已发布', accepted: '已接受', paying: '付款中',
      paid: '已付款', verified: '已验证', delivering: '交割中',
      completed: '已完成', cancelled: '已取消', expired: '已过期',
      disputed: '争议中', escalated: '已上报', resolved: '已解决',
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
    return side === 'buy' ? '买入' : side === 'sell' ? '卖出' : side;
  },

  /** Chain display name */
  chainName(chain) {
    const map = { bnb: 'BNB Chain', eth: 'Ethereum', sol: 'Solana', tron: 'TRON' };
    return map[chain] || (chain || '').toUpperCase();
  },
};

// Expose globally for Alpine.js templates
window.KANet = KANet;
