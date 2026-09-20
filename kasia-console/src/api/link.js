// TG bot /link binding (Bettor r277 / Owner 钦定 — 砍签名挑战).
//
// 共识 (3 agent grep-backed): /link nonce/verify 是 over-engineering.
//   - 下注鉴权自洽: PoolSide.sil claim_winner + refund_market_cancelled 硬 require
//     checkSig(bettorSig, pubkey(bettorPk)). 冒报他人地址 → 钱进只有他人 key 能取的 P2SH (自损).
//   - 通知隐私 false premise: Kaspa 公开账本 + chain_events 公开. Eve 冒绑 Alice 收 push
//     = Eve 自轮询链, 0 leakage 增量.
//   → 一刀 rip 净, 不留 optional 双 code path.
//
// 流程: 用户 TG /link <kaspa_addr> → bot POST /api/link/bind → INSERT user_notification_prefs.
// 订阅管理走 POST /api/link/subscribe (= 唯一允许 bot Console write 项, S5 lint+test 边界).
//
// 历史: r219 v1.3 ship nonce+verifyMessage. r275 全砍共识 (Bettor r277 GO).

import { sqlite } from '../db/client.js';
import { verifyIngestRequest } from '../services/ingest-auth.js';
import { configuredNetwork, checkAddressOnNetwork } from '../lib/kaspa-network.mjs';

export async function registerLinkRoutes(fastify) {
  // POST /api/link/bind {address, telegram_user_id}
  // 替代 nonce+verify 旧路径. 直接 INSERT user_notification_prefs default subscribed=1 notify.
  fastify.post('/api/link/bind', { preHandler: async (request, reply) => { await verifyIngestRequest(request, reply); } }, async (request, reply) => {
    const { address, telegram_user_id } = request.body || {};
    if (!address || typeof address !== 'string') {
      return reply.code(400).send({ ok: false, error: 'address required', code: 'empty' });
    }
    // CR-3 (Owner 批 2026-09-20; 变更说明 docs/2026-09-20-kanetui-tg-bot-mainnet-relaunch-and-proto-v0-repoint-change-note-v0.1.md §2): 绑定属"身份路", 地址必须是【本 console 配置网络】的合法地址——
    // 复用既有网络单一源 lib/kaspa-network.mjs(先 Address.validate 校验和, 再比前缀; 设计 J2 2026-09-13 v0.2 I2/I3), 不新造前缀判断。
    // 之前只校验 startsWith('kaspa'): 主网库里 kaspatest: 地址反而能绑成功(kaspatest 以 kaspa 开头), 且不验校验和。
    // KASPA_NETWORK 未设/未知 ⇒ fail-closed 503(configuredNetwork 无默认值)。错误只回机器码 code + expected_prefix, 用户可见文案由 bot 按 code 渲染。
    let network;
    try { network = configuredNetwork(); }
    catch { return reply.code(503).send({ ok: false, error: 'network not configured', code: 'network-unset' }); }
    const chk = checkAddressOnNetwork(address, { network, who: 'link.js:bind' });
    if (!chk.ok) {
      return reply.code(400).send({ ok: false, error: `address must be a valid ${network} address (${chk.expectedPrefix}: prefix)`, code: chk.code, expected_prefix: chk.expectedPrefix });
    }
    if (!telegram_user_id || typeof telegram_user_id !== 'string') {
      return reply.code(400).send({ ok: false, error: 'telegram_user_id required' });
    }
    const stmt = sqlite.prepare(`
      INSERT OR REPLACE INTO user_notification_prefs (telegram_user_id, kaspa_address, event_type, subscribed, linked_at, updated_at)
      VALUES (?, ?, 'notify', 1, COALESCE((SELECT linked_at FROM user_notification_prefs WHERE telegram_user_id=? AND kaspa_address=? AND event_type='notify'), CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
    `);
    stmt.run(telegram_user_id, address, telegram_user_id, address);
    return reply.send({ ok: true, address, telegram_user_id, linked: true });
  });

  // POST /api/link/subscribe {telegram_user_id, kaspa_address, event_type, subscribed}
  // 用户管订阅 — 唯一允许 bot Console write 项 (S5 lint+test 边界).
  // Requires prior /api/link/bind for (tg_user, addr) tuple (= 任意 row exists).
  fastify.post('/api/link/subscribe', { preHandler: async (request, reply) => { await verifyIngestRequest(request, reply); } }, async (request, reply) => {
    const { telegram_user_id, kaspa_address, event_type, subscribed } = request.body || {};
    if (!telegram_user_id || !kaspa_address || !event_type) {
      return reply.code(400).send({ ok: false, error: 'telegram_user_id + kaspa_address + event_type required' });
    }
    const sub = subscribed === false || subscribed === 0 ? 0 : 1;
    const linked = sqlite.prepare(
      'SELECT 1 FROM user_notification_prefs WHERE telegram_user_id=? AND kaspa_address=? LIMIT 1'
    ).get(telegram_user_id, kaspa_address);
    if (!linked) {
      return reply.code(403).send({ ok: false, error: 'address not bound (call /api/link/bind first)' });
    }
    sqlite.prepare(`
      INSERT OR REPLACE INTO user_notification_prefs (telegram_user_id, kaspa_address, event_type, subscribed, linked_at, updated_at)
      VALUES (?, ?, ?, ?, COALESCE((SELECT linked_at FROM user_notification_prefs WHERE telegram_user_id=? AND kaspa_address=? AND event_type=?), CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
    `).run(telegram_user_id, kaspa_address, event_type, sub, telegram_user_id, kaspa_address, event_type);
    return reply.send({ ok: true, telegram_user_id, kaspa_address, event_type, subscribed: sub });
  });
}
