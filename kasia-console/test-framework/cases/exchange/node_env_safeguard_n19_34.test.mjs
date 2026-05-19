// node_env_safeguard_n19_34 — NWT N19.34 / J2 #533 Counter Q2 boot-time double-check regression
// 防 production deploy 忘 unset KANET_TEST_MODE → broker self-deal (own_offer + same-org skip bypass).
// 双 layer fail-closed: NODE_ENV=production AND KANET_TEST_MODE=1 → refuse start; NODE_ENV undefined AND KANET_TEST_MODE=1 → refuse (paranoid).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const INDEX = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../src/index.js');
const STARTUP = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../kanet-start.sh');

export default {
  id: 'node_env_safeguard_n19_34',
  description: 'NODE_ENV + KANET_TEST_MODE boot-time double-check 防 production self-deal',
  domain: 'exchange',
  tags: ['regression', 'p0', 'n19-34', 'production-safeguard'],

  async run() {
    const indexSrc = readFileSync(INDEX, 'utf8');
    const startupSrc = readFileSync(STARTUP, 'utf8');

    // L1: index.js 含 KANET_TEST_MODE check
    if (!indexSrc.includes("process.env.KANET_TEST_MODE === '1'")) {
      return { ok: false, error: 'index.js boot-time KANET_TEST_MODE check 缺' };
    }

    // L2: production NODE_ENV + test mode = refuse start
    if (!indexSrc.includes("NODE_ENV === 'production'") || !indexSrc.match(/FATAL.*KANET_TEST_MODE.*production[\s\S]*?process\.exit\(1\)/)) {
      return { ok: false, error: 'NODE_ENV=production + KANET_TEST_MODE=1 refuse start 路径缺' };
    }

    // L3: NODE_ENV undefined + test mode = refuse start (paranoid)
    if (!indexSrc.match(/!process\.env\.NODE_ENV[\s\S]*?FATAL[\s\S]*?process\.exit\(1\)/)) {
      return { ok: false, error: 'NODE_ENV undefined + KANET_TEST_MODE=1 refuse start 路径缺 (paranoid layer)' };
    }

    // L4: kanet-start.sh 加显 NODE_ENV=development
    if (!startupSrc.includes('export NODE_ENV="${NODE_ENV:-development}"')) {
      return { ok: false, error: 'kanet-start.sh 缺 NODE_ENV=development 显式 set (dev script must explicit)' };
    }

    return { ok: true, summary: 'NODE_ENV safeguard 4 layer PASS (index.js double-check + paranoid + kanet-start.sh explicit set)' };
  },
};
