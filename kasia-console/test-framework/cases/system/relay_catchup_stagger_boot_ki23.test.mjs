// relay_catchup_stagger_boot_ki23 — KI 23 cron storm regression
// 8 relay 同 boot + 同 60s catch-up cron → console event loop 阻塞.
// 修法: random 0-60s offset boot 后 first catch-up, 自然分散 cron 到 60s window.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RELAY_RPC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../kasia-relay/src/rpc-listener.mjs');

export default {
  id: 'relay_catchup_stagger_boot_ki23',
  description: 'kasia-relay catchUpHistory stagger boot 防 cron storm (KI 23)',
  domain: 'system',
  tags: ['regression', 'p0', 'ki-23', 'cron-storm'],

  async run() {
    const src = readFileSync(RELAY_RPC, 'utf8');

    // L1: 旧 sync await catchUpHistory() 必删 (boot 不阻 + stagger 必)
    if (src.match(/\n  await catchUpHistory\(\);/)) {
      return { ok: false, error: '旧 sync `await catchUpHistory()` 仍存在 (8 relay sync boot storm 复刻)' };
    }

    // L2: STAGGER_MS random 0-CATCHUP_RETRY_INTERVAL_MS
    if (!src.includes('STAGGER_MS = Math.floor(Math.random() * CATCHUP_RETRY_INTERVAL_MS)')) {
      return { ok: false, error: 'STAGGER_MS random offset 缺' };
    }

    // L3: setTimeout async wrap first catch-up (不阻 boot)
    if (!src.match(/setTimeout\(\(\) => \{\s*catchUpHistory\(\)/)) {
      return { ok: false, error: 'first catch-up 未用 setTimeout async wrap (阻 boot 风险)' };
    }

    // L4: setInterval periodic cron 保留 + 跟 stagger offset cooperate
    if (!src.match(/_catchupTimer = setInterval\(\(\) => \{\s*catchUpHistory\(\)/)) {
      return { ok: false, error: 'periodic setInterval catch-up 路径缺' };
    }

    // L5: comment trace KI 23 reference
    if (!src.includes('KI 23')) {
      return { ok: false, error: 'KI 23 reference comment 缺 (sediment trace)' };
    }

    return { ok: true, summary: 'relay catchUpHistory stagger boot 5 layer PASS (旧 sync 删 + STAGGER_MS random + async wrap + cron preserve + KI 23 trace)' };
  },
};
