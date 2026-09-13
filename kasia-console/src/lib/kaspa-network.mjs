// kaspa-network.mjs (console 薄包装) — 把 shared/lib/kaspa-network.mjs 的纯逻辑绑定到 console 的 kaspa-wasm。
// 站点只需: import { assertAddressOnNetwork } from '../lib/kaspa-network.mjs'; const network = assertAddressOnNetwork(addr, { who: 'pool.js:744' });
// 设计 docs/2026-09-13-j2-network-single-source-and-prefix-consistency-helper-design-v0.1.md v0.2 §2.2（NWT Q3: kaspa 注入而非 shared 自 import）。
import { Address } from 'kaspa-wasm';
import * as core from '../../../shared/lib/kaspa-network.mjs';

const kaspa = { Address };

export const { NETWORKS, NetworkMismatchError, configuredNetwork, prefixForNetwork, addressPrefix, rowNetworkMatches } = core;
export function checkAddressOnNetwork(addr, opts = {}) { return core.checkAddressOnNetwork(addr, { kaspa, ...opts }); }
export function assertAddressOnNetwork(addr, opts = {}) { return core.assertAddressOnNetwork(addr, { kaspa, ...opts }); }
export function isAddressOnNetwork(addr, opts = {}) { return core.isAddressOnNetwork(addr, { kaspa, ...opts }); }
