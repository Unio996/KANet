// external-gateway.mjs — 对外网关: 一个【独立的】Fastify 实例, 只服务协议面白名单里的路由。
//
// 🔴 为什么是独立实例, 而不是"主实例 + 一道鉴权闸"(NWT 07:12 设计 · Bettor 07:13 批):
//    单实例加闸 ⇒ 一条【没人分类过 / 以后新加】的路由是否安全, 取决于那道闸有没有覆盖它,
//    而"覆盖"这件事没有任何机制保证 —— 它靠人记得。
//    独立实例 ⇒ 不在白名单上的路由在这个实例上【根本不存在】: 是【连不上】, 不是【被拒】。
//    ⇒ 那条老规矩: 取消危险动作, 而不是给危险动作加一道闸。
//
// 🔴 而它同时把"可达与鉴权必须同一个变更"从【纪律】变成【结构】:
//    这个对外监听口只有在白名单非空时才被创建 ⇒ 造不出"开了口而清单还没写"的中间态。
//
// 🔴 白名单只有【一条】(J2 6dec4d6f 分界线): 外部程序今天确实只能用这一条。
//    deny 侧最不能漏的两条(J2 点名), 它们【不在这里注册】, 因此从这个口连不到:
//      POST /api/agent/create              铸身份
//      POST /api/relay/:id/publish-card    让我们的 relay 花我们的币发链上 TX
//      POST /api/chat/send                 用【我们的钥匙】替调用方说话(Bettor 07:15 裁定 deny)
//
// 🔴 控制面(现有 console)【零改动】: 仍绑 127.0.0.1, 且本版【不加 bearer】——
//    实测每一个内部调用方都不带 Authorization 头, 加它 = 装载那一刻全部 401(含协调频道本身)。
//    控制面本版的安全前提就是"继续绑回环"那一条, 而它没动。(NWT 07:25 · Bettor 07:26 裁)
import Fastify from 'fastify';
import { registerPublicChannelReadRoute } from '../api/chat.js';

/**
 * 协议面白名单 —— 唯一真相源。
 * 🔴 每一项必须写明【为什么它是协议面】, 判据用 docs/KANet-Positioning.md:78 那四条原文,
 *    不自创分类: 「不运营任何业务。不撮合交易, 不托管资金, 不设定价格, 不审核参与者。」
 */
const PROTOCOL_ROUTES = Object.freeze([
  Object.freeze({
    method: 'GET',
    path: '/api/public/channel/:name/messages',
    register: registerPublicChannelReadRoute,
    why: '读链上已公开的消息。不撮合·不托管·不定价·不审核参与者(无任何我们发放的凭证)。',
  }),
]);

/**
 * 🔴 启动对外网关。fail-closed 的三道:
 *   ① 白名单为空        ⇒ 不启动(而不是启动一个空实例)
 *   ② 未配置对外端口     ⇒ 不启动。照 zk-prove-server 的先例: 缺配置 ⇒ NOT started, 不是 fail-open
 *   ③ 绑定地址未显式给出 ⇒ 不启动。绝不"默认 0.0.0.0" —— 暴露必须是一次显式决定
 *
 * @returns {Promise<null|{close: () => Promise<void>, host: string, port: number}>}
 */
export async function startExternalGateway() {
  if (PROTOCOL_ROUTES.length === 0) {
    console.warn('[external-gateway] 白名单为空 ⇒ 不启动(fail-closed)。');
    return null;
  }

  const portRaw = process.env.KANET_EXTERNAL_GATEWAY_PORT;
  const host = process.env.KANET_EXTERNAL_GATEWAY_HOST;

  if (!portRaw || !host) {
    console.warn(
      '[external-gateway] 未配置 KANET_EXTERNAL_GATEWAY_HOST / _PORT ⇒ 不启动。' +
        ' 🔴 这是 fail-closed: 没有默认对外绑定, 暴露必须是一次显式决定。',
    );
    return null;
  }

  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.warn(`[external-gateway] KANET_EXTERNAL_GATEWAY_PORT 非法(${portRaw}) ⇒ 不启动(fail-closed)。`);
    return null;
  }

  const app = Fastify({ logger: false });

  // 🔴 只注册白名单里的那几条 —— 【不调用 registerChatRoutes】。
  //    registerChatRoutes 里有 20 条路由(NWT 07:23 实测), 直接调它会把 /api/chat/send 等
  //    19 条一并暴露到外网 —— 那正是本设计要防的那件事。
  for (const r of PROTOCOL_ROUTES) {
    await r.register(app);
  }

  await app.listen({ port, host });
  console.log(
    `[external-gateway] listening on ${host}:${port} — 只暴露 ${PROTOCOL_ROUTES.length} 条协议面路由:\n` +
      PROTOCOL_ROUTES.map((r) => `  ${r.method} ${r.path}`).join('\n'),
  );

  return { close: () => app.close(), host, port };
}

/** 供测试/审查用: 白名单本身。🔴 只读 —— 改它等于改暴露面, 必须走审。 */
export function listProtocolRoutes() {
  return PROTOCOL_ROUTES.map((r) => ({ method: r.method, path: r.path, why: r.why }));
}
