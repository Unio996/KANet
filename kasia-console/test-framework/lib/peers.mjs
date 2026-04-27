// test-framework/lib/peers.mjs — known peer/relay address registry for tests.
// 单一处定义, case 用 alias, 不让 case 文件重复硬编码长地址.

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * Generate a fresh anonymous test peer address (valid kaspa: format).
 * For cases that need a clean-history user simulation.
 * Returns a stable address so test can reference it; caller should ensure unique seed.
 */
export function freshTestPeer(seed) {
  // 60 chars after 'kaspa:q' to look like real addr; deterministic from seed
  const suffix = require('node:crypto').createHash('sha256').update(String(seed)).digest('hex').slice(0, 56);
  return `kaspa:q${suffix.replace(/[^a-z0-9]/g, '0')}`.padEnd(67, '0').slice(0, 67);
}
