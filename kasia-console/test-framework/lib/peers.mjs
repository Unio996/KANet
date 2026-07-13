// test-framework/lib/peers.mjs — known peer/relay address registry for tests.
// 单一处定义, case 用 alias, 不让 case 文件重复硬编码长地址.

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data/console.db');

const RELAY_ADDR_BY_ALIAS = {
  // brokers
  // KANet-UI 2026-07-13: trader-b 原映射(0a8e9723.../qrxw764gez...)在当前 relay_nodes 表里完全不存在
  // (peers.mjs 自 4/28 未更新, 期间 relay 被重建/迁移) — 44 个用 relayId('trader-b') 的 broker case
  // 全部打到不存在的 relay id, /api/agent/reply 的 is_dex_broker/is_service 门禁查不到行直接 skip,
  // 落地空回复(现场验证: 打旧 id → {reply:""}, 打真实 broker-1 id → 真实 LLM 回复), 造成 25 个 FAIL。
  // 改指向当前唯一带 is_dex_broker=1/is_service=1 的 broker-1。
  'trader-b': 'kaspatest:qq0khf22ca90thy7py06d4v8m4yudjrv0r4754jraktkgefr0z9rqn43s708z',
  'trader-a': 'kaspa:qpsys3gzy4lg8txkuskhfnc4tskzn5r344eyudgyrc43te7vlq3f5a2cr843s',
  // dev relays
  'martin': 'kaspa:qptg465n4jedfujewj3hfgkxtysq40v2jakxp2w6uuvrhf6sajf0kzewvmcmv',
  'nwt': 'kaspa:qzd2ktu49f4cqwy7f4s2kmd5m4j0l27gfghjenurypaum99qxz2w7ktl95grm',
  'j2': 'kaspa:qr7km875u5hhl42eaz4sjgmlcdnzjan9fnplcct3q7gq4ujdtpqqqe78fjev3',
  'kanet': 'kaspa:qpf2f39dp869lfm3f32z0ujsrafamznjxxknlk792ftc9jhk2cs7y7err0tz9',
};

const RELAY_ID_BY_ALIAS = {
  'trader-b': '15593e10-fe63-4806-a7b5-cae062699de8', // broker-1 (真 is_dex_broker=1/is_service=1)
  'trader-a': 'df8cd0f9-27e7-45c6-bbea-2fa11a1ff1cd',
  'martin': '3765cc82-5e20-4e61-bb0a-697277287223',
  'nwt': '5b236c08-03d0-456c-953d-e10001610938',
};

export function relayAddr(alias) {
  if (alias.startsWith('kaspa:')) return alias;
  return RELAY_ADDR_BY_ALIAS[alias.toLowerCase()] || null;
}

export function relayId(alias) {
  if (/^[a-f0-9-]{36}$/i.test(alias)) return alias;
  return RELAY_ID_BY_ALIAS[alias.toLowerCase()] || null;
}

/**
 * Generate a fresh anonymous test peer address (valid kaspa: bech32 format).
 *
 * **R-NWT-2026-04-28 Kaspa bech32 fix** (J1 3b74f4fe + J2 5bc6645d ack):
 * 之前用 hex charset (0-9a-f) 含 'b' — Kaspa bech32 charset 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
 * 不含 'b' / 'i' / 'o' / '1'. relay sendCommand validate 真**真**真**真**真 reject 'invalid character b'.
 * 真**真**真**真 broker outbound _qDm 路径 silent fail (state_expire_boundary T1 EMPTY 真因).
 *
 * 修: map sha256 bytes to bech32 charset chars (32 chars, 5 bits each).
 * 真**真**真**valid Kaspa bech32 string (满**真**真**真 character validation).
 *
 * **LIMITATION (Bug-Z10 dig, retain)**: synthetic peers are still NOT in real Kasia network.
 * - /api/agent/reply works (sync HTTP, no chain hop)
 * - broker-action-queue _qDm chain broadcast 真**真**真**真 deliver (peer addr 真**真 reachable)
 *   但**真**真**真 fail 在 'reach' 阶段, 不**真**'parse' 阶段 — broker handler sync return path 真生效
 * - Use realLocalPeer() when chain DM delivery verification matters
 */
const KASPA_BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
export function freshTestPeer(seed) {
  const hashBytes = createHash('sha256').update(String(seed)).digest();
  let suffix = '';
  for (let i = 0; i < 60; i++) {
    suffix += KASPA_BECH32_CHARSET[hashBytes[i % hashBytes.length] % 32];
  }
  return `kaspa:q${suffix.slice(0, 60)}`;
}

/**
 * Return the address of a REAL local relay that exists in Kasia network.
 * Use this when test needs to verify broker chain DM delivery (broker DMs this
 * relay, scout sees it, messages table records inbound).
 *
 * Default: NWT relay (5b236c08) — real Kasia identity, alive on this machine.
 *
 * Tradeoff vs freshTestPeer: pollutes real relay's history (cleanup_peer can clear it).
 */
export function realLocalPeer(alias = 'nwt') {
  const addr = relayAddr(alias);
  if (!addr) throw new Error(`realLocalPeer: unknown alias '${alias}'`);
  return addr;
}
