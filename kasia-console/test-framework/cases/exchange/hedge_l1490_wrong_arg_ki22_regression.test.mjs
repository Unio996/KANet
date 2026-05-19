// hedge_l1490_wrong_arg_ki22_regression — NWT N19.38 真因 surface regression
// exchange-machine.js:1490 BUY kaspa_tx 短 circuit path 旧 `executeHedge(finalOffer)` 单 arg → silent skip.
// 修法: 4 args call (offerId, agentName, side, qty) mirror L1810 verify-complete-path pattern.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MACHINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../src/services/exchange-machine.js');

export default {
  id: 'hedge_l1490_wrong_arg_ki22_regression',
  description: 'exchange-machine.js BUY kaspa_tx 短 circuit path executeHedge 必 4 args call (KI 22 silent skip 防)',
  domain: 'exchange',
  tags: ['regression', 'p0', 'ki-22', 'hedge-wrong-arg'],

  async run() {
    const src = readFileSync(MACHINE, 'utf8');

    // L1: 旧 wrong arg pattern `executeHedge(finalOffer)` 单 arg 必删
    if (src.match(/executeHedge\(finalOffer\)\.catch/)) {
      return { ok: false, error: 'executeHedge(finalOffer) 单 arg call 仍存在 (KI 22 silent skip 复刻 — _executeHedge signature 4 args)' };
    }

    // L2: 4 args pattern `executeHedge(finalOffer.id, ...)` 必存在 in BUY kaspa_tx path
    if (!src.match(/executeHedge\(finalOffer\.id,\s*localAgent\.name,\s*hedgeSide,\s*hedgeQty\)/)) {
      return { ok: false, error: '4 args executeHedge call 缺 (Phase 1a fix 漏点)' };
    }

    // L3: BUY kaspa_tx short-circuit path 含 hedgeSide / hedgeQty 计算 (mirror L1810)
    if (!src.includes('const makerGaveKas = finalOffer.give_asset')) {
      return { ok: false, error: 'makerGaveKas 计算缺 — hedge direction 算法漏' };
    }
    if (!src.includes('parseFloat(finalOffer.give_amount)') || !src.includes('parseFloat(finalOffer.want_amount)')) {
      return { ok: false, error: 'hedgeQty 双向 parse 缺 (SELL: give_amount KAS; BUY: want_amount KAS)' };
    }

    // L4: setImmediate wrap (跟 L1810 pattern 同 async dispatch)
    const l1490Block = src.indexOf('BUY-kaspa-shortcut');
    if (l1490Block < 0) {
      return { ok: false, error: 'BUY-kaspa-shortcut path marker 缺 (修法 comment trace 漏)' };
    }
    const blockContext = src.slice(Math.max(0, l1490Block - 200), l1490Block + 200);
    if (!blockContext.includes('setImmediate')) {
      return { ok: false, error: 'L1490 BUY kaspa_tx hedge 缺 setImmediate wrap (mirror L1810 pattern 不齐)' };
    }

    return { ok: true, summary: 'L1490 BUY kaspa_tx hedge 4 args call 4 layer PASS (旧单 arg 删 + 4 args call + direction 算法 + setImmediate wrap)' };
  },
};
