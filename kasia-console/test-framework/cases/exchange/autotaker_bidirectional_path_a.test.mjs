// Path A — autoTaker 双向 KAS↔USDT regression (J2 #523 / NWT N19.18 三方共识 5/19)
// 真凶: trade-protocol-filter.js:211-212 hardcoded 单向 → 30+ day silent return qqjdp=kzc2tgz4cchh 全 BUY 单.
// 验证: 4 处 downstream hardcoded SELL 全 direction-aware (entry / supported chain / offerPrice / discount / wallet).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILTER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../src/services/trade-protocol-filter.js');

export default {
  id: 'autotaker_bidirectional_path_a',
  description: 'Path A autoTaker 双向 KAS↔USDT regression — entry + 4 downstream + autotake_skip emit',
  domain: 'exchange',
  tags: ['regression', 'p0', 'autotaker', 'path-a'],

  async run() {
    const src = readFileSync(FILTER_PATH, 'utf8');

    // L1: entry filter 双向 (NWT N19.18 Q1 attack #0)
    if (!src.includes('isSellKas') || !src.includes('isBuyKas')) {
      return { ok: false, error: 'entry filter 缺 isSellKas/isBuyKas 双向 var' };
    }
    if (src.match(/if \(msg\.give_asset\?\.toUpperCase\(\) !== 'KAS' \|\| msg\.want_asset\?\.toUpperCase\(\) !== 'USDT'\) \{[^}]*return;/)) {
      return { ok: false, error: 'L211-212 hardcoded 单向 filter 仍在 (KI 第 16+ 次复刻)' };
    }

    // L2: supported chain direction-aware (NWT N19.18 Q1 attack #1)
    if (!src.includes("isSellKas ? ['bnb', 'eth', 'sol', 'tron'] : ['kaspa']")) {
      return { ok: false, error: 'supported chain list 未 direction-aware' };
    }

    // L3: offerPrice direction-aware (NWT N19.18 Q1 attack #2)
    if (!src.includes('isSellKas ? (wantAmt / giveAmt) : (giveAmt / wantAmt)')) {
      return { ok: false, error: 'offerPrice 公式未 direction-aware (BUY direction wrong inverse)' };
    }

    // L4: discount sign-flip direction-aware (NWT N19.18 Q1 attack #3)
    if (!src.includes('isSellKas ? ((marketPrice - offerPrice) / marketPrice) : ((offerPrice - marketPrice) / marketPrice)')) {
      return { ok: false, error: 'discount sign 未 direction-aware (BUY 利润逻辑反)' };
    }

    // L5: amount cap normalize USD (wantUsd) (NWT N19.18 Q1 attack #4 part 1)
    if (!src.includes('const wantUsd = isSellKas ? wantAmt : wantAmt * marketPrice')) {
      return { ok: false, error: 'wantUsd normalize 缺 — BUY direction wantAmt 单位是 KAS 不是 USD' };
    }
    if (src.match(/if \(wantAmt > maxUsdt\)/)) {
      return { ok: false, error: 'maxUsdt cap 仍用 wantAmt (应 wantUsd)' };
    }

    // L6: wallet search direction-aware (NWT N19.18 Q1 attack #4 part 2)
    if (!src.includes('if (isSellKas) {') || !src.includes("BUY: broker pays KAS via Kaspa relay")) {
      return { ok: false, error: 'wallet search 未 direction-aware (BUY 不需 EVM wallet)' };
    }

    // L7: autotake_skip event emit (NWT N19.18 Q3 合 commit)
    if (!src.includes("eventType: 'autotake_skip'")) {
      return { ok: false, error: 'autotake_skip chain_event emit 缺 (KI 18 silent skip 不可监控)' };
    }
    if (!src.includes('await _p(')) {
      return { ok: false, error: '_p() 调用未 await — emit 路径可能 fire-and-forget 漏' };
    }

    return { ok: true, summary: 'Path A 双向 autoTaker 7 layer (entry + 4 downstream + USD normalize + autotake_skip) 全 verify PASS' };
  },
};
