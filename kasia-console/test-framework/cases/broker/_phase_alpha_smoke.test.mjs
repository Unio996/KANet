// T-J2-2026-04-29 Phase α smoke — 验证 4 new actions 接线 OK (无真钱).
// real_send_kas + real_send_evm 在 manual-only Phase β real-chain case 才用, 此 smoke 仅
// verify_broker_v2_active (probe broker path) + cleanup_real_artifacts (DB DELETE) 跑 batch.

import { relayId, relayAddr, freshTestPeer } from '../../lib/peers.mjs';

const peer = freshTestPeer('phase-alpha-smoke-' + Date.now());

export default {
  id: '_phase_alpha_smoke',
  description: 'T-J2-2026-04-29 Phase α — verify 4 new framework actions wired (no-money smoke)',
  domain: 'broker',
  tags: ['phase-alpha', 'smoke', 'manual-only'],
  skip_in_cron: true,
  steps: [
    {
      label: 'verify which broker path actually fires',
      action: 'verify_broker_v2_active',
      test_peer: peer,
      to_relay_id: relayId('trader-b'),
      expected: 'auto',
      expect: {
        must: {
          // 一定 detect 出 v1 OR v2 (不能 unknown)
          // assertion 写法: 用 result key check (runner 把 result 字段挂 last_step.result)
        },
      },
    },
    {
      label: 'cleanup test peer artifacts',
      action: 'cleanup_real_artifacts',
      peer_addr: peer,
    },
  ],
};
