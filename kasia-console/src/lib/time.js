export function nowIso() {
  return new Date().toISOString();
}

export function fmtDate(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleString(undefined, { hour12: false });
}

export function relativeTime(isoStr) {
  if (!isoStr) return '—';
  const diff = Date.now() - new Date(isoStr).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}
