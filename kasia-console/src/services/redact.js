export function redactMnemonic(mnemonic) {
  if (!mnemonic) return null;
  const words = mnemonic.trim().split(/\s+/);
  return `已配置 (${words.length}词)`;
}

export function redactToken(token) {
  if (!token) return null;
  if (token.length <= 8) return '****';
  return token.slice(0, 4) + '****' + token.slice(-4);
}

export function redactAddress(address) {
  if (!address) return '—';
  if (address.length <= 16) return address;
  return address.slice(0, 12) + '...' + address.slice(-6);
}
