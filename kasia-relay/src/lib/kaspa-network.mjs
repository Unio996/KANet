// kaspa-network.mjs (relay 薄包装) — 把 shared/lib/kaspa-network.mjs 的纯逻辑绑定到 relay 的 kaspa-wasm（relay 侧 kaspa-wasm 为 junction 到真实包目录, 见 ANTI-PATTERNS 规则 72）。
// 设计 docs/2026-09-13-j2-network-single-source-and-prefix-consistency-helper-design-v0.1.md v0.2 §2.2。
import * as kaspaWasm from 'kaspa-wasm';
import * as core from '../../../shared/lib/kaspa-network.mjs';

const kaspa = { Address: kaspaWasm.Address };

export const { NETWORKS, NetworkMismatchError, configuredNetwork, prefixForNetwork, addressPrefix, rowNetworkMatches } = core;
export function checkAddressOnNetwork(addr, opts = {}) { return core.checkAddressOnNetwork(addr, { kaspa, ...opts }); }
export function assertAddressOnNetwork(addr, opts = {}) { return core.assertAddressOnNetwork(addr, { kaspa, ...opts }); }
export function isAddressOnNetwork(addr, opts = {}) { return core.isAddressOnNetwork(addr, { kaspa, ...opts }); }
