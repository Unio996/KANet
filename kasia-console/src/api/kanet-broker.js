// KANet broker API — cross-domain broker stats (Bettor r30 钦定 namespace /api/kanet-broker/*).
//
// KANet broker 跨 3 domain: pool prediction markets + retail dex orders (+ exchange OTC P2P 无 broker).
// 数据源 grep 实证 (J2 r109):
//   - pool_markets (v62+): broker_relay_id (v135) + broker_fee_pct bps + maker_stake_amount + settle_txid
//   - retail_dex_orders (v83): broker_relay_id + broker_fee_kas (TEXT) + state + agent_pay_addr
//
// Iron Rule (Bettor r21/r22/r23 + Owner 钦定):
//   ① user-need: broker 第一视角看自己赚多少 / 跑了多少市场 / 跨域统一视图
//   ② 必要: UI Gap 1 broker home 必需 (= role-home 模板 5 块的"收入" + "状态" 块数据源)
//   ③ 不重复: 不撞 /api/broker/* (= 美股证券 broker namespace, broker.js 已占), 不撞 /api/pool/* (= 单 market 视角不 broker 维度)
//   ④ 充分理由: 跨域聚合 = broker 看不到分散视图, UI 必汇总, 1 endpoint 替 UI 多 RTT
//   ⑤ 简单高效: 2 endpoint 直 SQL JOIN, 无中间层

import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';
import { encrypt } from '../services/crypto.js';
import { reconcileBrokerBots, brokerBotsStatus, stopBrokerBot } from '../services/broker-bot-manager.js';
import { computeMarketBrokerFee } from '../lib/broker-fee-chain.mjs';

// 地址格式校验 (testnet-12 = kaspatest: / mainnet = kaspa:). 宽松长度界, 防垃圾提交.
const KAS_ADDR_RE = /^kaspa(test)?:[a-z0-9]{50,80}$/;
// 🔴 isApprovedTrust() 已删除 (2026-07-28, 半A 裁定的直接后果):
//   它的两个调用点(两个状态端点)已改为不再从 trust_level 派生"已批准"。
//   而按 v0.6 定调【根本不存在审批这件事】⇒ 这个函数编码的正是那道不存在的门。
//   🔴 留着它 = 把那个概念留在原地等下一个人重新接上 —— 与本仓那条同理:
//     "只搬走用户而留着函数, 洞不是被堵上, 是被留在原地"。零调用点时删代价最小。

// ③ 单路由注册函数 —— 外部网关白名单【只能】填这个, 不能填 registerKanetBrokerRoutes。
//   它与主实例注册的是同一个 handler(同一份码, 不是副本)⇒ 两边行为不会漂移。
//   🔴 而"这个口上有什么"由网关那份白名单负责判(它要求【排序后完全相等】), 不由这里负责。
export function registerBrokerOnboardRoute(fastify) {
  // POST /api/kanet-broker/onboard — 玩家自助申请当 broker。body: { broker_address, bot_token, bot_username? }
  fastify.post('/api/kanet-broker/onboard', async (request, reply) => {
    const { broker_address, bot_token, bot_username } = request.body || {};
    if (!broker_address || !KAS_ADDR_RE.test(broker_address)) {
      return reply.code(400).send({ ok: false, error: 'valid broker_address (kaspatest:… / kaspa:…) required' });
    }
    // ① bot_token 不再必填 (设计 v0.6 · Bettor 2026-07-28 批): 它是【通知渠道】, 不是【身份】。
    //   🔵 顺带解掉一条活性: 之前 api.telegram.org 不可达 = 谁都进不来 —— 一个第三方站在
    //     "外部程序能不能接进来"的关键路径上, 而那正是这条路最不该有的形状。
    //     改完它只影响【提供了 token 的人】。
    // 根治(2026-07-08, Owner "找根治问题" 指令, #12): bot_username 之前是 broker 自报字段, 从没验过跟
    // bot_token 是不是真的对应同一个 bot——broker 填错/填别人的 username, 下游(市场详情页/分享链接)会
    // 指向一个完全不同的 bot, 只有真的点开才会暴露。用 Telegram 自己的 getMe API(唯一权威源, 传
    // bot_token 换它自己认的 username)校验。getMe 失败(token 无效/网络问题)直接拒绝, 不静默放行。
    // 🔴 而这道校验【只在提供了 token 时】跑 —— 不是整个关掉: 给了 token 就必须是真的,
    //   否则下游会指向一个不存在/别人的 bot。(验收对照臂: 带一个无效 token ⇒ 必须仍被拒。)
    const hasToken = bot_token != null && String(bot_token).trim() !== '';
    let verifiedUsername = null;
    if (hasToken) {
      try {
        const meRes = await fetch(`https://api.telegram.org/bot${String(bot_token).trim()}/getMe`, { signal: AbortSignal.timeout(8000) });
        const meJson = await meRes.json();
        verifiedUsername = meJson?.result?.username;
        if (!meJson?.ok || !verifiedUsername) {
          return reply.code(400).send({ ok: false, error: `bot_token 校验失败(getMe 返回: ${meJson?.description || 'invalid token'}) — 请确认这是从 @BotFather 拿到的真实 token` });
        }
      } catch (e) {
        return reply.code(502).send({ ok: false, error: `bot_token 校验失败(无法连接 Telegram API: ${e.message}) — 请稍后重试` });
      }
      if (bot_username && String(bot_username).replace(/^@/, '') !== verifiedUsername) {
        console.warn(`[kanet-broker/onboard] broker=${broker_address} 提交的 bot_username=@${bot_username} 跟 getMe 真值 @${verifiedUsername} 不符 — 已用真值覆盖, 不信自报`);
      }
    }
    const now = new Date().toISOString();
    const tokenEnc = hasToken ? encrypt(String(bot_token).trim()) : null;
    const net = broker_address.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';

    // upsert by address (地址制 UNIQUE)。重复提交 = 更新 token/username, status 保持 (approved 不回退到 pending)。
    // bot_username 存 verifiedUsername(getMe 真值), 不存 broker 自报的 bot_username 参数(防止 §上方 mismatch)。
    const existing = sqlite.prepare('SELECT id, status FROM broker_onboarding WHERE broker_address = ?').get(broker_address);
    if (existing) {
      // 🔴 token 变可选之后, 重复提交【不带 token】不许把已有的 token/username 抹掉 ——
      //   否则一个已经接好自己 bot 的 broker, 只要再提交一次(譬如改别的字段)就会把自己的 bot 弄没,
      //   而他不会收到任何提示。⇒ 只在【本次带了 token】时才覆写这两列。
      if (hasToken) {
        sqlite.prepare('UPDATE broker_onboarding SET bot_token_encrypted = ?, bot_username = ?, updated_at = ? WHERE broker_address = ?')
          .run(tokenEnc, verifiedUsername, now, broker_address);
      } else {
        sqlite.prepare('UPDATE broker_onboarding SET updated_at = ? WHERE broker_address = ?').run(now, broker_address);
      }
    } else {
      sqlite.prepare(`INSERT INTO broker_onboarding (id, broker_address, bot_token_encrypted, bot_username, status, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?)`).run(randomUUID(), broker_address, tokenEnc, verifiedUsername, 'pending', now, now);
    }

    // ② 【已删除】onboarding 曾在这里写 identities.trust_level='recommended' (设计 v0.6 · Bettor 2026-07-28 批)。
    //   删除理由 —— 那一列同时在干两件不相干的事:
    //     A 功能开关:「这是一个已登记的 broker」 ← broker-bot-manager 据此决定要不要 fork 他的 bot
    //     B 社交信任:「这个人可信」          ← mind 侧据此注入 "TRUSTED PEER" / 权限档 / senderMeta.authority
    //   而 onboarding 写一次 recommended, 把 A 和 B 【一起】打开了 —— 它只想要 A。
    //   🔴 更糟的一层: identities.trust_level 是 relation_states 缺行时的 fallback,
    //     而一个刚从外面进来的地址【正好没有 relation_states 行】⇒ 那个 fallback 不是边角, 是新地址的默认路径。
    //   ⇒ 信任交回 relation_states(由实际交互决定), 跟所有别人一样。谁都不挡: broker 照样即时生效、无许可。
    //   🔵 也就去掉了一句我们对自己推理引擎说的、证据不支持的话:「他持有那把私钥」不支持「他可信」。
    //   ⇒ 消费侧同批改: broker-bot-manager.approvedBrokers() 不再看 trust_level; 本文件两个状态端点同理。

    // 🔴 status 不再回 'approved' —— 按 v0.6 定调【根本不存在审批这件事】, 而回 'approved'
    //   是在断言一道并不存在的门(Bettor 2026-07-28 半A 裁: 这不是措辞偏好, 是删掉一个假陈述)。
    //   ⇒ 回【可核的事实】: 在册 + 有没有接自己的 bot。措辞归 Owner(半B), 本层只保证不说假话。
    return reply.send({
      ok: true,
      broker_address,
      bot_username: verifiedUsername,
      registered: true,
      has_own_bot: hasToken,
      note: hasToken
        ? '已登记, 即时生效(测试网无许可进出, 无人工审批)。bot_username 经 getMe 校验为真值。'
        : '已登记, 即时生效(测试网无许可进出, 无人工审批)。未提供 bot_token ⇒ 未接自己的 TG bot。',
    });
  });
}

export async function registerKanetBrokerRoutes(fastify) {
  // GET /api/kanet-broker/markets/:relay_id — 列名下市场 + 订单 (跨域)
  // Response: { relay_id, pool_markets: [...], retail_dex_orders: [...], totals: {...} }
  fastify.get('/api/kanet-broker/markets/:relay_id', async (request, reply) => {
    const { relay_id } = request.params;
    if (!relay_id) return reply.code(400).send({ ok: false, error: 'relay_id required' });

    const poolMarkets = sqlite.prepare(`
      SELECT id, protocol_status, broker_fee_pct, maker_stake_amount,
             outcome_market_source, outcome_condition_id, resolution_rule_spec,
             deadline, settle_txid, refund_txid, created_at
      FROM pool_markets
      WHERE broker_relay_id = ?
      ORDER BY created_at DESC
    `).all(relay_id);

    // retail-dex orders use system-wide configured broker (retail_dex_broker_config) not per-order
    // broker_relay_id. So: return all retail orders only if THIS relay_id is configured retail broker.
    const isRetailBroker = sqlite.prepare(
      'SELECT 1 FROM retail_dex_broker_config WHERE broker_relay_id = ? LIMIT 1'
    ).get(relay_id);
    const retailOrders = isRetailBroker ? sqlite.prepare(`
      SELECT id, state, broker_fee_kas, agent_pay_addr,
             mid_price_at_quote, expires_at, created_at, deliver_tx_hash, refund_tx_hash
      FROM retail_dex_orders
      ORDER BY created_at DESC
    `).all() : [];

    const totals = {
      pool_active: poolMarkets.filter(m => !m.settle_txid && !m.refund_txid).length,
      pool_settled: poolMarkets.filter(m => !!m.settle_txid).length,
      pool_refunded: poolMarkets.filter(m => !!m.refund_txid).length,
      retail_active: retailOrders.filter(o => o.state !== 'completed' && o.state !== 'refunded' && o.state !== 'cancelled').length,
      retail_completed: retailOrders.filter(o => o.state === 'completed').length,
      retail_refunded: retailOrders.filter(o => o.state === 'refunded').length,
    };

    return reply.send({
      ok: true,
      relay_id,
      pool_markets: poolMarkets,
      retail_dex_orders: retailOrders,
      totals,
    });
  });

  // GET /api/kanet-broker/earnings/:relay_id — 历史 broker fee 累计 (跨域)
  //
  // Pool fee math: fee_kas = (maker_stake_amount × broker_fee_pct / 10000) / 1e8
  //   (per PoolSpine_v06.sil L165 + bettor-prediction-settler.js:282 strict require)
  //   Realized only when settle_txid set; pending if status active.
  //
  // Retail fee: broker_fee_kas stored directly as TEXT KAS (v72), realized when settle_tx_hash set.
  //
  // Returns:
  //   { relay_id,
  //     realized: { pool_kas, retail_kas, total_kas, n_markets, n_orders },
  //     pending:  { pool_kas, retail_kas, total_kas, n_markets, n_orders },
  //     by_market: [{ source: 'pool'|'retail', id, fee_kas, status, settled_at }, ...] }
  fastify.get('/api/kanet-broker/earnings/:relay_id', async (request, reply) => {
    const { relay_id } = request.params;
    if (!relay_id) return reply.code(400).send({ ok: false, error: 'relay_id required' });

    // 查漏补缺(2026-07-04, Owner 撞见 DM vs UI 收益显示"完全不一样"·系统性 consolidate·非打补丁):
    // fee 计算改调单一权威 computeMarketBrokerFee(lib/broker-fee-chain.mjs) — 跟 DM 端
    // (/earnings-by-address) 共用同一份逻辑, 不再各自维护一份"怎么算 broker fee"(Owner 点破的
    // "一个功能几个并行相似程序"活案例根治)。
    const relayRow = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relay_id);
    const brokerAddress = relayRow?.address || null;

    // shard-blind display fix (Bettor 2026-07-04, Owner 抓 via earnings-by-address 同源 bug): 排除
    // shard_internal 内部克隆, 只显逻辑/用户面盘 (母盘的 per-shard 副本不该单独列一行)。
    const poolRows = sqlite.prepare(`
      SELECT id, broker_fee_pct, maker_stake_amount, protocol_status, settle_txid, refund_txid, updated_at, metadata
      FROM pool_markets WHERE broker_relay_id = ? AND protocol_status != 'shard_internal'
    `).all(relay_id);

    // Same retail-broker scope as above: system-wide broker config, return all if configured.
    const isRetailBroker = sqlite.prepare(
      'SELECT 1 FROM retail_dex_broker_config WHERE broker_relay_id = ? LIMIT 1'
    ).get(relay_id);
    const retailRows = isRetailBroker ? sqlite.prepare(`
      SELECT id, broker_fee_kas, state, deliver_tx_hash, refund_tx_hash, updated_at
      FROM retail_dex_orders
    `).all() : [];

    let realizedPoolSompi = 0n;
    let pendingPoolSompi = 0n;
    let refundedPoolSompi = 0n; // KANet-UI (Bettor r618): refunded 市场 fee (被退, broker 未赚)
    let realizedPoolN = 0;
    let pendingPoolN = 0;
    let refundedPoolN = 0;
    const byMarket = [];

    for (const r of poolRows) {
      const { status, feeSompi, chainVerified, estimated } = computeMarketBrokerFee(r, brokerAddress);
      if (status === 'settled') {
        realizedPoolSompi += feeSompi;
        realizedPoolN += 1;
      } else if (status === 'refunded') {
        refundedPoolSompi += feeSompi;
        refundedPoolN += 1;
      } else {
        pendingPoolSompi += feeSompi;
        pendingPoolN += 1;
      }
      byMarket.push({
        source: 'pool',
        id: r.id,
        fee_kas: (Number(feeSompi) / 1e8).toFixed(8),
        status,
        settled_at: status === 'settled' ? r.updated_at : null,
        chain_verified: chainVerified,
        estimated,
      });
    }

    let realizedRetailKas = 0;
    let pendingRetailKas = 0;
    let refundedRetailKas = 0;
    let realizedRetailN = 0;
    let pendingRetailN = 0;
    let refundedRetailN = 0;

    for (const r of retailRows) {
      const fee = parseFloat(r.broker_fee_kas || '0') || 0;
      const isRealized = !!r.deliver_tx_hash && r.state === 'completed';
      const isRefunded = !!r.refund_tx_hash || r.state === 'refunded' || r.state === 'cancelled';
      const status = isRealized ? 'settled' : (isRefunded ? 'refunded' : r.state);
      if (isRealized) {
        realizedRetailKas += fee;
        realizedRetailN += 1;
      } else if (isRefunded) {
        refundedRetailKas += fee;
        refundedRetailN += 1;
      } else {
        pendingRetailKas += fee;
        pendingRetailN += 1;
      }
      byMarket.push({
        source: 'retail',
        id: r.id,
        fee_kas: fee.toFixed(8),
        status,
        settled_at: isRealized ? r.updated_at : null,
      });
    }

    const realizedPoolKas = Number(realizedPoolSompi) / 1e8;
    const pendingPoolKas = Number(pendingPoolSompi) / 1e8;
    const refundedPoolKas = Number(refundedPoolSompi) / 1e8;

    return reply.send({
      ok: true,
      relay_id,
      realized: {
        pool_kas: realizedPoolKas.toFixed(8),
        retail_kas: realizedRetailKas.toFixed(8),
        total_kas: (realizedPoolKas + realizedRetailKas).toFixed(8),
        n_markets: realizedPoolN,
        n_orders: realizedRetailN,
      },
      pending: {
        pool_kas: pendingPoolKas.toFixed(8),
        retail_kas: pendingRetailKas.toFixed(8),
        total_kas: (pendingPoolKas + pendingRetailKas).toFixed(8),
        n_markets: pendingPoolN,
        n_orders: pendingRetailN,
      },
      refunded: {
        pool_kas: refundedPoolKas.toFixed(8),
        retail_kas: refundedRetailKas.toFixed(8),
        total_kas: (refundedPoolKas + refundedRetailKas).toFixed(8),
        n_markets: refundedPoolN,
        n_orders: refundedRetailN,
      },
      by_market: byMarket,
    });
  });

  // GET /api/kanet-broker/earnings-by-address/:address — address-keyed broker 收益 (Owner 钦定 2026-06-22 DM/UI 显示)。
  //   地址制铁律: broker 身份 = 地址。broker_pk = XOnlyPublicKey.fromAddress(address) (= pool.js deriveXOnlyPubkey 同源,
  //   create-v07 broker_address 存的就是它)。外部地址-broker 无 relay_id (broker_relay_id=null) → 按 broker_pk 查得到。
  //   仅 pool fee (retail_dex 是 relay-keyed, 外部地址-broker 不涉)。fee 数学 == earnings/:relay_id (phase2_broker_fee_sompi 实落 / 回退估算)。
  fastify.get('/api/kanet-broker/earnings-by-address/:address', async (request, reply) => {
    const { address } = request.params;
    if (!address || !String(address).startsWith('kaspa')) return reply.code(400).send({ ok: false, error: 'valid kaspa address required' });
    let brokerPk;
    try { const kaspa = await import('kaspa-wasm'); brokerPk = kaspa.XOnlyPublicKey.fromAddress(new kaspa.Address(String(address))).toString().toLowerCase(); }
    catch (e) { return reply.code(400).send({ ok: false, error: `address→pubkey derive fail: ${e.message}` }); }

    // shard-blind display fix (Bettor 2026-07-04, Owner 抓): shard_internal 是内部克隆(母盘的 per-shard 副本,
    // maker_stake=0), 不该跟母盘一起列进用户面"经手市场"——排除它, 只显逻辑/用户面盘。收益数字本身不受影响
    // (fee 只落在真实结算, 克隆盘从不会单独结算/退款)。
    const poolRows = sqlite.prepare(`
      SELECT id, broker_fee_pct, maker_stake_amount, protocol_status, settle_txid, refund_txid, updated_at, metadata
      FROM pool_markets WHERE LOWER(broker_pk) = ? AND protocol_status != 'shard_internal'
    `).all(brokerPk);

    // 查漏补缺(2026-07-04, Owner 撞见 DM vs UI"完全不一样"·consolidate 非打补丁): 改调单一权威
    // computeMarketBrokerFee(lib/broker-fee-chain.mjs) — 之前这条路径靠 metadata.settle_evidence.
    // fee_payouts, 这个字段从没被任何代码写过(幽灵字段, 全库 grep 零命中), bshard 盘(几乎全部新盘)
    // 因此永远算不出 realized fee。跟 /earnings/:relay_id 共用同一份链验逻辑, 不再各自维护一份。
    const brokerAddr = String(address);
    let realizedKas = 0, pendingKas = 0, refundedKas = 0, realizedN = 0, pendingN = 0, refundedN = 0;
    const byMarket = [];
    for (const r of poolRows) {
      const { status, feeSompi, chainVerified, estimated } = computeMarketBrokerFee(r, brokerAddr);
      const feeKas = Number(feeSompi) / 1e8;
      if (status === 'settled') {
        realizedKas += feeKas; realizedN += 1;
        byMarket.push({ id: r.id, fee_kas: feeKas.toFixed(8), status: 'settled', chain_verified: true, settle_txid: r.settle_txid, settled_at: r.updated_at });
      } else if (status === 'refunded') {
        refundedN += 1;
        byMarket.push({ id: r.id, fee_kas: '0.00000000', status: 'refunded', chain_verified: false });
      } else {
        pendingKas += feeKas; pendingN += 1;
        byMarket.push({ id: r.id, fee_kas: feeKas.toFixed(8), status: 'pending', chain_verified: false, estimated });
      }
    }
    return reply.send({
      ok: true, address: brokerAddr, broker_pk: brokerPk,
      realized: { pool_kas: realizedKas.toFixed(8), n_markets: realizedN, source: 'chain-verified: fee tx in kaspa_tx_log + outputs_json parsed (multi-output aware)' },
      pending: { pool_kas: pendingKas.toFixed(8), n_markets: pendingN },
      refunded: { pool_kas: refundedKas.toFixed(8), n_markets: refundedN },
      cross_node_note: '本节点链口径: 仅含本节点 pool_markets + kaspa_tx_log 可见 fee。他节点产出市场 fee 未含 (V2 per-recipient fee-index 才全跨节点)。',
      by_market: byMarket,
    });
  });

  // ─── 玩家→轻路 broker onboarding 骨架 (Owner 钦定 2026-06-22, task#4) ──────────────
  //   铁律 = 地址制 (broker 身份 = broker_address, 非 relay_id)。骨架只做'存 + 审批门'。
  //   命名空间走 /api/kanet-broker/* (非 /api/broker/* — 后者是美股证券 broker.js 占用, 见本文件 iron rule ③)。
  //   多-bot tg-manager (托管各 broker token 同步呈现市场) = 下一步, 不在骨架。
  //   ⚠ 安全: bot_token = Telegram secret, 加密落库 (crypto.encrypt), 任何 GET 都不回 token。Bettor 审 onboarding 安全 + 命门④ fee 地址链锚。

  // ③ onboard 抽成【单路由注册函数】(设计 §三 · NWT §③ 前置):
  //   本文件只导出一个 registerKanetBrokerRoutes, 而它注册 9 条路由 —— 其中含
  //   POST /api/kanet-broker/bots/stop(停掉任意 broker 的 bot)。
  //   🔴 外部网关白名单若直接填那个函数, 九条会一起上外网 ⇒ 必须有一个只注册 onboard 的入口。
  registerBrokerOnboardRoute(fastify);

  // GET /api/kanet-broker/onboard/status?address=… — 查单个地址 onboarding 状态 (token 永不回)。
  fastify.get('/api/kanet-broker/onboard/status', async (request, reply) => {
    const address = request.query.address;
    if (!address) return reply.code(400).send({ ok: false, error: 'address query param required' });
    // 🔴 半A(Bettor 2026-07-28): 不再从 identities.trust_level 派生 'approved'。
    //   两个理由, 各自独立成立:
    //   ① onboarding 已不再写那一列 ⇒ 继续读它, 新 broker 会被显示成【未批准】, 而他的 bot 照常在跑
    //      ⇒ 系统行为与它对用户的自述相反, 而两边各自都"按代码正确工作"
    //   ② 按 v0.6 定调根本不存在审批 ⇒ 'approved' 本身就是在断言一道不存在的门
    //   ⇒ 改回可核的事实: 在册 + 有没有接自己的 bot。has_bot_token 之前是【硬编码 true】—— 那也是假的。
    const row = sqlite.prepare('SELECT broker_address, bot_username, bot_token_encrypted, status, created_at, updated_at FROM broker_onboarding WHERE broker_address = ?').get(address);
    if (!row) return reply.send({ ok: true, onboarded: false });
    return reply.send({
      ok: true, onboarded: true,
      broker_address: row.broker_address,
      bot_username: row.bot_username,
      registered: true,
      has_own_bot: !!row.bot_token_encrypted,
      // 🔴 不再回 status(NWT 2026-07-28 装载前拦下, 走他的甲案):
      //   broker_onboarding.status 是 vestigial —— 唯一写入是 INSERT 的 'pending', 没有任何路径把它设别的值
      //   ⇒ 它只有一个可能值 ⇒ 零信息量。而它此前之所以"看起来对", 全靠 trust 派生的那个 override 盖着它。
      //   ⇒ ⇒ 把 override 拿掉后它露出来, 而 UI 把 'pending' 读成【地址被标记 blocked, 需 Owner 手动放行】
      //     ⇒ 每个注册成功的 broker 都会看到那句, 而那三句话一句都不成立。
      //   🔴 所以回它 = 明知会让 UI 说假话还回。删掉这个字段是【删假陈述】, 不是【换一句话】。
      // 🔵 而我原来的枚举停在 API 层("谁读 trust_level"), 漏了【谁读由它派生出来的东西】——
      //   判据要再往下一层, 这是 NWT 抓出来的第四个消费者。
      created_at: row.created_at,
    });
  });

  // GET /api/kanet-broker/onboard/list — Owner/admin 看全部申请 (token 永不回)。
  fastify.get('/api/kanet-broker/onboard/list', async (request, reply) => {
    // 🔴 半A 同上: 不再 LEFT JOIN identities 派生 'approved'(见 /onboard/status 处的两条理由)。
    const rows = sqlite.prepare(`
      SELECT b.broker_address, b.bot_username, b.bot_token_encrypted, b.status, b.created_at
      FROM broker_onboarding b
      ORDER BY b.created_at DESC
    `).all();
    // 🔴 同上: status 与由它算出来的 pending 计数一并去掉 —— 那一列只有一个可能值,
    //   于是 "pending" 恒等于总数, 它数的不是"有多少在等", 是"有多少行"。零信息量的计数比没有更坏。
    const brokers = rows.map(r => ({
      broker_address: r.broker_address,
      bot_username: r.bot_username,
      registered: true,
      has_own_bot: !!r.bot_token_encrypted,
      created_at: r.created_at,
    }));
    return reply.send({
      ok: true,
      count: brokers.length,
      with_own_bot: brokers.filter(b => b.has_own_bot).length,   // 可核的事实: 有几个接了自己的 bot
      brokers,
    });
  });

  // ─── 多-bot tg-manager (Owner 钦定 2026-06-22): 每 approved broker 一个真 bot ─────────────
  //   reconcile = 读 approved broker_onboarding → 各 token fork 一个 bot 进程 (一 token 一 poller, 防 409)。
  //   approval 经 /identities trust 后调此 endpoint (或等 60s 周期 reconcile) → bot 真拉起。token 永不外回。

  // POST /api/kanet-broker/bots/reconcile — 立即对齐 (审批后调一下 bot 即刻拉起, 不用等周期)。
  fastify.post('/api/kanet-broker/bots/reconcile', async (request, reply) => {
    const r = reconcileBrokerBots();
    return reply.send(r);
  });

  // GET /api/kanet-broker/bots/status — 各 broker bot 运行状态 (token 不回)。
  fastify.get('/api/kanet-broker/bots/status', async (request, reply) => {
    return reply.send(brokerBotsStatus());
  });

  // POST /api/kanet-broker/bots/stop — 停某 broker 的 bot (admin)。body {broker_address}
  fastify.post('/api/kanet-broker/bots/stop', async (request, reply) => {
    const addr = request.body?.broker_address;
    if (!addr) return reply.code(400).send({ ok: false, error: 'broker_address required' });
    return reply.send(stopBrokerBot(addr));
  });
}
