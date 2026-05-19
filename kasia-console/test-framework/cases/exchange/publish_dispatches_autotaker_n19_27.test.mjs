// publish_dispatches_autotaker_n19_27 — NWT N19.27 真链 Round 4 surface real trigger gap regression
// /api/exchange/publish endpoint INSERT 后必 dispatch onBroadcastWritten →
// _evaluateAutoTake fire on broker self-publish (KI 20 silent skip 防御).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../src/api/exchange.js');

export default {
  id: 'publish_dispatches_autotaker_n19_27',
  description: '/api/exchange/publish 必 dispatch onBroadcastWritten 触发 autoTaker pipeline',
  domain: 'exchange',
  tags: ['regression', 'p0', 'n19-27', 'autotaker-trigger'],

  async run() {
    const src = readFileSync(API, 'utf8');

    // L1: /api/exchange/publish endpoint 存在
    if (!src.includes("fastify.post('/api/exchange/publish'")) {
      return { ok: false, error: '/api/exchange/publish endpoint missing' };
    }

    // L2: INSERT exchange_offers 后必 dispatch onBroadcastWritten
    // NWT N19.41 fix: 支持 static OR dynamic import (J2 #528 用 await import() inside try block)
    const hasOnBroadcast = src.includes('onBroadcastWritten') && (
      src.match(/import\s*\{[^}]*onBroadcastWritten/)                    // static import
      || src.match(/await\s+import\([^)]*trade-protocol-filter/)         // dynamic import await
    );
    if (!hasOnBroadcast) {
      return { ok: false, error: 'onBroadcastWritten 未 dispatch in publish endpoint (KI 20 silent skip 风险)' };
    }

    // L3: dispatch 在 INSERT 后 reply 之前 (顺序检查)
    const publishStartIdx = src.indexOf("fastify.post('/api/exchange/publish'");
    const insertIdx = src.indexOf('INSERT OR IGNORE INTO exchange_offers', publishStartIdx);
    const dispatchIdx = src.indexOf('onBroadcastWritten', insertIdx);
    const replyIdx = src.indexOf('return reply.send', insertIdx);
    if (insertIdx < 0 || dispatchIdx < 0 || replyIdx < 0) {
      return { ok: false, error: 'INSERT/dispatch/reply 顺序定位 fail' };
    }
    if (!(insertIdx < dispatchIdx && dispatchIdx < replyIdx)) {
      return { ok: false, error: `dispatch 顺序错: INSERT(${insertIdx}) → dispatch(${dispatchIdx}) → reply(${replyIdx}) 不连续` };
    }

    // L4: dispatch 用 protocolMsg content (taken from publish body)
    // NWT N19.41 fix: 加 /s flag (dotall) — J2 #528 multi-line `onBroadcastWritten({\n  tx_hash: ...,\n  content: JSON.stringify(protocolMsg),\n})`
    if (!src.match(/onBroadcastWritten\([^)]*content:\s*JSON\.stringify\(protocolMsg\)/s)) {
      return { ok: false, error: 'dispatch payload 缺 content=protocolMsg (autoTaker parse 必)' };
    }

    return { ok: true, summary: '/api/exchange/publish dispatch onBroadcastWritten 4 layer PASS (endpoint + import + sequence + payload)' };
  },
};
