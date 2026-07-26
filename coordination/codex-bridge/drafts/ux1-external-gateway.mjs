// ux1-external-gateway.mjs — 外部程序接入入口 v0.1 (J2, 契约 DRI)  🔴 草案, 未接线, 未部署
//
// Owner 2026-07-26 05:15 逐字:「当下只有【模块化, 外部程序接入】。其他不要再浪费任何资源。」
// ⇒ 本文件是那两件里【外部程序接入】的对外那一面, 写成可独立测试的模块(= 另一件: 模块化)。
//
// 🔴 它【不改】主 console 的 fastify 实例, 也不改它的 HOST 绑定。
//    这是一个独立实例 —— 照仓内既有先例 kasia-console/src/services/zk-prove-server.mjs:4,
//    那份是 NWT 05:10 指出的全仓最佳实践。**继承, 不重写。**
//
// 继承自 zk-prove-server 的四条(逐条对应它的行号):
//   :29-30  TOKEN 未设 ⇒ 【不启动】。fail-closed, 不是 fail-open
//   :15     HOST 显式给, 默认【不是】 0.0.0.0
//   :20/:38 定时安全比较 + 401 不回显任何细节
//   :90     独立 listen, 与主实例互不影响
//
// 🔴🔴 而"可达"与"鉴权"必须在【同一个变更】里落地(J2 05:06 查、Bettor 05:07 定为设计前提):
//   本机防火墙有一条 Program=node.exe · LocalPort=Any · RemoteIP=Any · Allow 的规则
//   ⇒ 一旦某个 node 进程绑了非回环口, 后面【没有第二道闸】。
//   ⇒ 所以本模块把两件焊死: startExternalGateway() 里【没有】"先开口子, 鉴权以后再加"的路径。
//      缺 token ⇒ 直接不监听。这不是"加固", 这是新入口的出厂形状。

import { timingSafeEqual } from 'node:crypto';

export const DISCLAIMER_HEADER = 'X-KANet-Disclaimer';
export const DISCLAIMER_VALUE = 'testnet-only-no-investment-advice';
export const MAX_LIMIT = 200;
export const DEFAULT_LIMIT = 50;
const CHANNEL_RE = /^[a-z0-9-]{1,40}$/;

function safeEqual(a, b) {
  const A = Buffer.from(String(a ?? ''), 'utf8');
  const B = Buffer.from(String(b ?? ''), 'utf8');
  if (A.length !== B.length) return false; // 长度差异本身不是需要隐藏的秘密(同 zk-prove-server:20 口径)
  return timingSafeEqual(A, B);
}

/**
 * 🔴 limit 解析。与现有 /api/public/channel/:name/messages 的行为【故意不同】, 差异写在这里:
 *
 *   现有那行(kasia-console/src/api/chat.js:555) 是 `Math.min(parseInt(raw) || 50, 200)`。
 *   我实跑逐次数过它的返回条数, 五种输入五种静默行为:
 *     limit=abc → 50   (非法值静默退回默认)
 *     limit=0   → 50   (0 是 falsy, 被 || 吃掉)
 *     limit=201 → 200  (静默截断, 响应里没有任何标记)
 *     limit=-5  → 535  (Math.min(-5,200) = -5 ⇒ SQL `LIMIT -1..` 在 SQLite 里等于【不限制】⇒ 返回全部)
 *   ⇒ 外部集成方【看不出自己写错了】: 名字打错、拉不全、传了负数, 状态码全是 200。
 *
 *   🔵 而我【不去改那个现有端点】—— 那是"加固基础", Owner 明令停。
 *      我做的是: 新入口不复制这个形状。非法值【报错】, 截断【带标记】。
 */
export function parseLimit(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, limit: DEFAULT_LIMIT, truncated: false };
  if (!/^\d+$/.test(String(raw))) return { ok: false, error: 'limit_must_be_a_non_negative_integer', got: String(raw) };
  const n = Number(raw);
  if (n === 0) return { ok: false, error: 'limit_must_be_at_least_1', got: String(raw) };
  if (n > MAX_LIMIT) return { ok: true, limit: MAX_LIMIT, truncated: true };
  return { ok: true, limit: n, truncated: false };
}

/**
 * 纯函数核心 —— 不碰网络、不碰 fastify、不 import 任何仓内模块。
 * 🔵 这是"模块化"那一件的具体形态: 取数由调用方注入, 于是它能在没有 DB、没有 live 的地方被测。
 *
 * @param {{name:string, limit?:string}} req
 * @param {{listPublicMessages:(name:string,limit:number)=>Array, channelHasHistory:(name:string)=>boolean}} store
 */
export function handleListMessages(req, store) {
  const name = req?.name;
  if (!CHANNEL_RE.test(String(name ?? ''))) {
    return { status: 400, body: { error: 'invalid_channel_name', hint: '小写字母/数字/连字符, 1-40 字符' } };
  }
  const lim = parseLimit(req?.limit);
  if (!lim.ok) return { status: 400, body: { error: lim.error, got: lim.got } };

  const messages = store.listPublicMessages(name, lim.limit);
  if (!Array.isArray(messages)) return { status: 500, body: { error: 'store_returned_non_array' } };

  // 🔴 「频道不存在」与「频道存在但为空」在现有端点上无法区分(两者都是 200 + 空数组)。
  //    而我【不发明一个频道注册表】—— 那是本仓没有的东西, 造它就是加功能。
  //    我能诚实给出的是一个【可判定的事实】: 这个名字下我们有没有任何公开消息。
  //    ⇒ channel_has_history=false 的准确含义: "这个名字下我们没有公开消息" ——
  //      它【可能】是打错了名字, 也【可能】是一个还没有内容的频道。字段名如实说这件事。
  const hasHistory = messages.length > 0 ? true : Boolean(store.channelHasHistory(name));

  return {
    status: 200,
    body: {
      messages,
      channel: name,
      limit_applied: lim.limit,          // 🔴 回显真正生效的值, 不让调用方猜
      truncated: lim.truncated,          // 🔴 被截断【明说】, 现有端点是静默的
      channel_has_history: hasHistory,   // 🔴 见上, 字段名不承诺它证明不了的事
    },
  };
}

/**
 * 挂到一个【独立】的 fastify 实例上。缺 token ⇒ 不启动。
 * @returns {Promise<{started:boolean, reason?:string, host?:string, port?:number}>}
 */
export async function startExternalGateway({ fastifyFactory, store, env = process.env, log = console }) {
  const TOKEN = env.KANET_EXTERNAL_GATEWAY_TOKEN;
  const HOST = env.KANET_EXTERNAL_GATEWAY_HOST;   // 🔴 无默认值 —— 见下
  const PORT = Number(env.KANET_EXTERNAL_GATEWAY_PORT || 0);

  // 🔴 三条 fail-closed, 顺序即优先级。任何一条不满足 ⇒ 【不监听】, 而不是"先开着再说"。
  if (!TOKEN) return { started: false, reason: 'KANET_EXTERNAL_GATEWAY_TOKEN 未设 ⇒ 不启动(fail-closed)' };
  if (TOKEN.length < 32) return { started: false, reason: 'token 短于 32 字符 ⇒ 不启动' };
  if (!HOST) {
    // 🔴 故意【不给默认值】。给 '0.0.0.0' 会一步暴露(本机防火墙对 node.exe 全放行);
    //    给 '127.0.0.1' 又会让人以为"配好了"而其实外面根本连不上 —— 两个默认值都会骗人。
    return { started: false, reason: 'KANET_EXTERNAL_GATEWAY_HOST 未设 ⇒ 不启动(不猜绑定地址: 猜宽=一步暴露, 猜窄=假装可达)' };
  }
  if (!PORT) return { started: false, reason: 'KANET_EXTERNAL_GATEWAY_PORT 未设 ⇒ 不启动' };

  const app = fastifyFactory();

  app.addHook('onRequest', async (request, reply) => {
    reply.header(DISCLAIMER_HEADER, DISCLAIMER_VALUE);
    if (!safeEqual(request.headers?.authorization, `Bearer ${TOKEN}`)) {
      // 🔴 401 不回显任何细节 —— 不说是缺了头、还是token错、还是长度不对
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/v1/channels/:name/messages', async (request, reply) => {
    const r = handleListMessages({ name: request.params?.name, limit: request.query?.limit }, store);
    return reply.code(r.status).send(r.body);
  });

  await app.listen({ port: PORT, host: HOST });
  log.log?.(`[ux1-gateway] listening ${HOST}:${PORT} — bearer-auth, read-only, 单端点。`);
  return { started: true, host: HOST, port: PORT, app };
}

// ⚠️ 覆盖边界(自述, 不藏):
//   🔴 未接线: 本文件【没有】被 kasia-console 任何地方 import。它是可审对象, 不是已部署的东西。
//   🔴 未部署 · 未在任何机器上监听过任何端口 · 未改任何现有端点。
//   🔴 只读: 本模块【只有】一个 GET。没有写入路径, 没有资金路径, 没有签名路径。
//   ⚠️ store 由调用方注入 —— 也就是说【真实取数那一段还没写】, 而那一段要读 broadcast_messages
//      且必须保留现有端点的 visibility='public' AND status != 'local' 硬过滤(chat.js:557)。
//      🔴 这一格是【未做】, 不许读成"已经能跑"。
