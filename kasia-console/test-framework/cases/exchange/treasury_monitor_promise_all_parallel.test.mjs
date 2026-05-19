// treasury_monitor_promise_all_parallel — J2 P0 fix 5/19 Owner "快!" 钦定
// 旧 sequential `for (await ...)` RPC × N chains → 30+ sec event loop block.
// 修后 Promise.all parallel → 单 worst chain 限速 ~5s.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MONITOR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../src/services/broker-treasury-monitor.js');

export default {
  id: 'treasury_monitor_promise_all_parallel',
  description: 'treasury_monitor _runSnapshot Promise.all parallel (KI 25 event-loop-block 修)',
  domain: 'exchange',
  tags: ['regression', 'p0', 'ki-25', 'event-loop-block'],

  async run() {
    const src = readFileSync(MONITOR, 'utf8');

    // L1: 旧 sequential pattern `await _snapshotEvmBalance` 在 nested for loop 必删
    const seqPattern = /for \(const w of wallets\) \{[\s\S]{0,500}for \(const asset of[\s\S]{0,200}const snap = await _snapshotEvmBalance/;
    if (seqPattern.test(src)) {
      return { ok: false, error: '旧 sequential await _snapshotEvmBalance 仍存在 (KI 25 event-loop-block)' };
    }

    // L2: Promise.all parallel
    if (!src.includes('Promise.all(tasks)')) {
      return { ok: false, error: 'Promise.all(tasks) 缺 — parallel RPC dispatch 未实施' };
    }

    // L3: tasks array push pattern
    if (!src.match(/tasks\.push\(_snapshotEvmBalance/)) {
      return { ok: false, error: 'tasks.push(_snapshotEvmBalance) 缺' };
    }

    // L4: .catch fallback 每个 task (避免 1 chain fail 拖全 batch)
    if (!src.match(/_snapshotEvmBalance\([^)]+\)\.catch/)) {
      return { ok: false, error: 'catch fallback 缺 (Promise.all 1 fail abort all 风险)' };
    }

    // L5: filter Boolean (排空)
    if (!src.includes('.filter(Boolean)')) {
      return { ok: false, error: 'filter(Boolean) 缺 (null snapshots 混入 INSERT)' };
    }

    return { ok: true, summary: 'treasury_monitor Promise.all parallel 5 layer PASS (旧 sequential 删 + Promise.all + tasks.push + catch fallback + filter)' };
  },
};
