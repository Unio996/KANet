// test-framework/lib/peers.mjs — known peer/relay address registry for tests.
// 单一处定义, case 用 alias, 不让 case 文件重复硬编码长地址.

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data/console.db');

const RELAY_ADDR_BY_ALIAS = {
  // brokers
  'trader-b': 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l',
  'trader-a': 'kaspa:qpsys3gzy4lg8txkuskhfnc4tskzn5r344eyudgyrc43te7vlq3f5a2cr843s',
  // dev relays
  'nwt': 'kaspa:qzd2ktu49f4cqwy7f4s2kmd5m4j0l27gfghjenurypaum99qxz2w7ktl95grm',
  'j2': 'kaspa:qr7km875u5hhl42eaz4sjgmlcdnzjan9fnplcct3q7gq4ujdtpqqqe78fjev3',
  'kanet': 'kaspa:qpf2f39dp869lfm3f32z0ujsrafamznjxxknlk792ftc9jhk2cs7y7err0tz9',
};

const RELAY_ID_BY_ALIAS = {
  'trader-b': '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0',
  'trader-a': 'df8cd0f9-27e7-45c6-bbea-2fa11a1ff1cd',
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
 * Generate a fresh anonymous test peer address (valid kaspa: format prefix only).
 * **LIMITATION (Bug-Z10 dig)**: synthetic peers are NOT in real Kasia network.
 * - /api/agent/reply works (sync HTTP, no chain hop)
 * - But broker-action-queue _qDm chain broadcast 真**fails silently** for these peers
 * - Therefore: cases using freshTestPeer should NOT assert on broker outbound DMs
 *   that go through chain (e.g. dm_pay_instr / dm_order_confirmed via Kasia)
 * - Use realLocalPeer() instead when chain DM verification matters
 *
 * For cases that need a clean-history user simulation but only check broker reply
 * via /api/agent/reply (sync), freshTestPeer is fine.
 */
export function freshTestPeer(seed) {
  // 60 chars after 'kaspa:q' to look like real addr; deterministic from seed
  const suffix = createHash('sha256').update(String(seed)).digest('hex').slice(0, 56);
  return `kaspa:q${suffix.replace(/[^a-z0-9]/g, '0')}`.padEnd(67, '0').slice(0, 67);
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
