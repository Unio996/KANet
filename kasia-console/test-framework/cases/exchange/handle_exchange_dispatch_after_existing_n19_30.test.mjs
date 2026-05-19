// handle_exchange_dispatch_after_existing_n19_30 — NWT N19.30 真因 surface regression
// handleExchange L150 旧 idempotent guard silent return → autoTaker 永不 fire on direct-API-publish path.
// 修法: existing 时复用 offer.id, 跳 INSERT, 继续 autoTaker dispatch.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILTER = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../src/services/trade-protocol-filter.js');

export default {
  id: 'handle_exchange_dispatch_after_existing_n19_30',
  description: 'handleExchange existing 时不 silent return — 必继 autoTaker dispatch (KI 21)',
  domain: 'exchange',
  tags: ['regression', 'p0', 'n19-30', 'autotaker-trigger'],

  async run() {
    const src = readFileSync(FILTER, 'utf8');

    // L1: handleExchange 函数存在
    if (!src.includes('async function handleExchange(msg)')) {
      return { ok: false, error: 'handleExchange function missing' };
    }

    // L2: existing 旧 silent return pattern 必删
    if (src.match(/if \(existing\) return;\s*$/m)) {
      return { ok: false, error: 'handleExchange 仍有 `if (existing) return;` silent skip (KI 21 复刻)' };
    }

    // L3: existing 时必复用 offer.id (跳 INSERT 但 keep dispatch)
    if (!src.includes('offerId = existing.id')) {
      return { ok: false, error: '修法缺: existing 时未复用 offerId (autoTaker 跑会用错 id)' };
    }

    // L4: INSERT 在 else block (不是 unconditional)
    const handleStart = src.indexOf('async function handleExchange(msg)');
    const insertIdx = src.indexOf('INSERT INTO exchange_offers', handleStart);
    const elseIdx = src.lastIndexOf('} else {', insertIdx);
    if (elseIdx < 0 || elseIdx > insertIdx) {
      return { ok: false, error: 'INSERT 未在 else block (existing 时仍 INSERT 撞 UNIQUE)' };
    }

    // L5: autoTaker dispatch (setImmediate _evaluateAutoTake) 在 if/else 后 (unconditional)
    // 即 existing 和 new INSERT 两 path 都走到 autoTaker
    const autoTakerIdx = src.indexOf('_evaluateAutoTake', handleStart);
    const closeBraceIdx = src.indexOf('}', insertIdx + 100);  // end of else block roughly
    if (autoTakerIdx < closeBraceIdx) {
      return { ok: false, error: 'autoTaker dispatch 在 else block 内 (existing path 不 dispatch)' };
    }

    return { ok: true, summary: 'handleExchange existing 路径 5 layer PASS (函数+silent-skip-删+复用offer.id+INSERT-conditional+dispatch-unconditional)' };
  },
};
