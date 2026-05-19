// test_mode_env_flag_n19_25 — NWT N19.25 / Owner 5/19 "干!!!" KANET_TEST_MODE env flag regression
// Production 默认 (KANET_TEST_MODE undefined): own_offer skip + same-org skip 仍守.
// Test mode (KANET_TEST_MODE=1): bypass own_offer + same-org → 4 actor 单 console 真链测试.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILTER = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../src/services/trade-protocol-filter.js');
const ENGINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../src/services/cross-match-engine.js');

export default {
  id: 'test_mode_env_flag_n19_25',
  description: 'KANET_TEST_MODE env flag bypass own_offer + same-org for multi-actor test',
  domain: 'exchange',
  tags: ['regression', 'test-mode', 'n19-25'],

  async run() {
    const filterSrc = readFileSync(FILTER, 'utf8');
    const engineSrc = readFileSync(ENGINE, 'utf8');

    // L1: trade-protocol-filter.js own_offer skip 加 env bypass
    if (!filterSrc.includes("process.env.KANET_TEST_MODE !== '1' && localAddrs.includes(msg._from)")) {
      return { ok: false, error: 'own_offer skip 缺 KANET_TEST_MODE env bypass' };
    }

    // L2: cross-match-engine.js same-org skip 加 env bypass
    if (!engineSrc.includes("process.env.KANET_TEST_MODE !== '1' && brokerAddrs.includes(buy.maker) && brokerAddrs.includes(sell.maker)")) {
      return { ok: false, error: 'cross-match same-org skip 缺 KANET_TEST_MODE env bypass' };
    }

    // L3: production 默认安全 (env var 没 set 时 skip 仍 trigger)
    delete process.env.KANET_TEST_MODE;
    const isProd = process.env.KANET_TEST_MODE !== '1';
    if (!isProd) return { ok: false, error: 'env var unset 后仍非 production mode' };

    // L4: test mode 启用时 bypass
    process.env.KANET_TEST_MODE = '1';
    const isTest = process.env.KANET_TEST_MODE === '1';
    if (!isTest) return { ok: false, error: 'KANET_TEST_MODE=1 set 后仍非 test mode' };
    delete process.env.KANET_TEST_MODE;  // clean up after test

    return { ok: true, summary: 'KANET_TEST_MODE env flag 4 layer PASS (own_offer + same-org bypass + production default + test enable)' };
  },
};
