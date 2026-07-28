// external-gateway.mjs — 对外网关: 一个【独立的】Fastify 实例, 只服务协议面白名单里的路由。
//
// 🔴 为什么是独立实例, 而不是"主实例 + 一道鉴权闸"(NWT 07:12 设计 · Bettor 07:13 批):
//    单实例加闸 ⇒ 一条【没人分类过 / 以后新加】的路由是否安全, 取决于那道闸有没有覆盖它,
//    而"覆盖"这件事没有任何机制保证 —— 它靠人记得。
//    独立实例 ⇒ 不在白名单上的路由在这个实例上【根本不存在】: 是【连不上】, 不是【被拒】。
//    ⇒ 那条老规矩: 取消危险动作, 而不是给危险动作加一道闸。
//
// 🔴 而它同时把"可达与鉴权必须同一个变更"从【纪律】变成【结构】:
//    这个对外监听口只有在白名单非空且 HOST/PORT 都显式配置时才被创建
//    ⇒ 造不出"开了口而清单还没写"的中间态。
//
// 🔴 白名单现在有【两条】(2026-07-28 加 broker onboard · 设计 v0.2 三方审毕):
//      GET  /api/public/channel/:name/messages   读链上已公开的消息(只读)
//      POST /api/kanet-broker/onboard           外部程序自助登记成为 broker(🔴 第一个对外的【写入口】)
//    deny 侧最不能漏的几条(J2 点名 + Bettor 07:15 裁), 它们【不在这里注册】, 因此从这个口连不到:
//      POST /api/agent/create              铸身份
//      POST /api/relay/:id/publish-card    让我们的 relay 花我们的币发链上 TX
//      POST /api/chat/send                 用【我们的钥匙】替调用方说话
//    🔵 而 onboard 曾被质疑"它也在铸身份"(它当时会写 identities.trust_level='recommended',
//      而那在 Agent 消息闸上是 120/时 + 多两档 authority ⇒ 匿名自助提权)。
//      ✅ 该质疑【已被前置改动消解】: onboard 自 2026-07-28 起不再写 identities ——
//      🔴 而这个前置是【硬前置】不是顺序建议: 若哪天有人把那段写回去, 本条就必须同时下架。
//
// 🔴 控制面(现有 console)【行为零改动】: 仍绑 127.0.0.1, 且本版【不加 bearer】——
//    实测每一个内部调用方都不带 Authorization 头, 加它 = 装载那一刻全部 401(含协调频道本身)。
//    控制面本版的安全前提就是"继续绑回环"那一条, 而它没动。(NWT 07:25 · Bettor 07:26 裁)
import Fastify from 'fastify';
import { registerPublicChannelReadRoute } from '../api/chat.js';
import { registerBrokerOnboardRoute } from '../api/kanet-broker.js';

// ── 资源控制(设计 docs/2026-07-28-broker-onboard-gateway-exposure-supplement.md v0.2 §六) ──
// 🔴 分轴: 【资源按口 · 契约按路由】。这三样全部做在【实例级】覆盖该口全部路由 ——
//   而不是只给 onboard: 同一个口上另一条路由若没有上限, 这个口的天花板就由它决定。
//   (初版只给了 onboard ⇒ NWT MUST-FIX: "保护了一条路由, 而攻击面是一个口"。)
const GW_BODY_LIMIT_BYTES = 8 * 1024;
// 两档限频: 写入面(onboard)与读频道面分开 —— 只给一档会让【本来就要给外面用】的读接口吃写入面的紧额度。
const GW_RATE_WRITE = { limit: 10, windowMs: 60 * 60 * 1000 };   // 注册对一个正当用户是"一辈子一次"的动作
const GW_RATE_READ = { limit: 120, windowMs: 60 * 60 * 1000 };   // 读公开频道: 给外面用的, 不能按写入面卡
const GW_MAX_INFLIGHT = 4;
// 🔴 note-2(设计 §六): 这是【内存】计数 ⇒ 进程重启即清零。
//   它挡的是【持续刷】, 不是【总量配额】—— 额度可以靠等一次重启重置。这一句必须留在码里, 不是文档里。
const _rateBuckets = new Map();   // key = ip + '|' + tier → number[](窗口内的时间戳)
let _inFlight = 0;

// 🔴 note-1(设计 §六): 「每 IP」依赖【这个口前面没有反代】—— 该实例没有设 trustProxy。
//   ⇒ 显式读 socket.remoteAddress, 【不读 request.ip】: 后者能被一个配置开关悄悄改掉,
//     而那会让 per-IP 限频整个塌成一个共享桶, 且塌的那一刻没有任何提示。
function _peerIp(req) {
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// 🔴🔴 限频表【自己】必须有界(NWT diff 审 MUST-FIX):
//   一个防资源耗尽的机制, 若自己无界, 就带着它要防的那个洞 —— 而它【不会自己暴露】:
//   内存慢慢涨, 期间限频完全正常工作。
// 而这里做两层, 因为【只做懒清理不够】:
//   甲(懒清理): live 为空时 delete 这个 key —— 🔴 但它只在【同一个 IP 再来】时才触发,
//      而最该防的攻击形态恰恰是【很多 IP 各来一次、永不复访】⇒ 那些桶永远等不到被清
//   乙(硬上限): 超过上限就整表清空 ⇒ 粗暴但【有界】
// 🔴 乙的代价要说清: 清空 = 所有人的限频额度重置(对限频是 fail-open)。
//   而它可接受的理由是【并发上限 4 不受影响】—— 那才是分布式流量下真正的兜底(设计 §六 note-3)。
//   ⇒ 于是"内存有界"与"还有一道真闸"两件都成立, 而不是拿一个换另一个。
const GW_RATE_BUCKET_CAP = 20000;
let _rateBucketClears = 0;   // 🔵 清空次数 —— 见下: 它必须有出口, 否则"它有没有在涨"没人知道

function _rateLimited(ip, tier, cfg, now) {
  const key = ip + '|' + tier;
  const arr = _rateBuckets.get(key) || [];
  const cutoff = now - cfg.windowMs;
  let i = 0;
  while (i < arr.length && arr[i] <= cutoff) i++;   // 滑窗: 丢掉过期的
  const live = i > 0 ? arr.slice(i) : arr;
  if (live.length >= cfg.limit) {
    _rateBuckets.set(key, live);
    return Math.ceil((live[0] + cfg.windowMs - now) / 1000);   // Retry-After 秒
  }
  live.push(now);
  _rateBuckets.set(key, live);
  if (_rateBuckets.size > GW_RATE_BUCKET_CAP) {
    // 🔴 先只删【确定没信息】的桶: 窗口内一条记录都不剩的那些(甲)。
    const maxWindow = Math.max(GW_RATE_WRITE.windowMs, GW_RATE_READ.windowMs);
    for (const [k, v] of _rateBuckets) {
      if (v.length === 0 || v[v.length - 1] <= now - maxWindow) _rateBuckets.delete(k);
    }
    // 🔴 清完仍超上限 ⇒ 说明是【大量活跃来源】而不是垃圾堆积 ⇒ 整表清空保住内存(乙)。
    if (_rateBuckets.size > GW_RATE_BUCKET_CAP) {
      _rateBuckets.clear();
      _rateBucketClears++;
      // 🔴 它必须【喊】: 否则"限频表被清空过"这件事没有任何出口, 而清空期间限频是失效的。
      //   带累计数 ⇒ 一次与一直在发生读数不同(本仓: 只报成功数的计数器在两种世界里读数相同)。
      console.warn(
        `[external-gateway] 🔴 限频表超过 ${GW_RATE_BUCKET_CAP} 个桶 ⇒ 已整表清空(累计第 ${_rateBucketClears} 次)。` +
          ' 清空期间【每 IP 限频失效】, 而并发上限仍在 —— 若这行反复出现, 说明该口正在被大量不同来源打。',
      );
    }
  }
  return 0;
}

/**
 * 协议面白名单 —— 唯一真相源。
 * 🔴 每一项必须写明【为什么它是协议面】, 判据用 docs/KANet-Positioning.md:78 那四条原文,
 *    不自创分类: 「不运营任何业务。不撮合交易, 不托管资金, 不设定价格, 不审核参与者。」
 *
 * 🔴 这份清单是【公开信息】, 不是内部知识 (NWT 提 · Bettor 2026-07-28 裁 · 落账在码不在频道):
 *    本仓 origin 是公开 GitHub 仓库 ⇒ 本文件入库即发布 ⇒ 谁都读得到这个口开了哪条路由。
 *    ⇒ 安全性必须完全来自【不在清单上的路由在这个实例上不存在】这一条结构事实,
 *      而【不能】有任何一格依赖"外面的人不知道我们开了什么" —— 半年后读到这里的人别搞反。
 */
const PROTOCOL_ROUTES = Object.freeze([
  Object.freeze({
    method: 'GET',
    path: '/api/public/channel/:name/messages',
    register: registerPublicChannelReadRoute,
    why: '读链上已公开的消息。不撮合·不托管·不定价·不审核参与者(无任何我们发放的凭证)。',
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/kanet-broker/onboard',
    register: registerBrokerOnboardRoute,
    // 🔴 why 订正(NWT §③ MUST-FIX B): 上面那条的自述【对本条不成立】, 必须各写各的。
    //   加了本条之后, 这个口【开始接收参与者】、且在调用方提供 token 时【托管一份第三方密钥】
    //   ⇒ 若沿用"不托管·不审核参与者"那句, 它当场变假, 而全仓别处还在引它当这个口的定性。
    why:
      '外部程序自助登记成为 broker。逐条对齐 KANet-Positioning.md:78:' +
      ' 不撮合(它只写一行登记, 不参与任何撮合)· 不定价(它不设任何价格)·' +
      ' 不审核参与者(无许可: 谁提交谁登记, 没有人工批准这一步 —— 而正因如此它不发放任何凭证);' +
      ' 🔴 而【不托管】这一条对本路由【不成立】: 调用方若提供 bot_token, 我们会加密托管它' +
      '(那是他自己的第三方通知渠道密钥, 不是资金)。这一句必须留着 —— 它是这个口性质变化的那一格。',
    // 🔵 而 NWT 曾据"本口 deny 铸身份"反对过本条(模块头把 POST /api/agent/create 列为 deny 例子):
    //   ✅ 该反对【已被前置改动消解】—— onboard 在 2026-07-28 之后【不再写 identities】,
    //     它不再是"铸身份"的一种形态。写在这里, 否则下一个人会以为我们无视了那条反对。
  }),
]);

/**
 * 启动对外网关。
 *
 * 🔴🔴 本函数【从不抛】—— 这是它自己的属性, 不是每个调用点各自记得包 try/catch 的结果。
 *    (放在调用点 ⇒ 下一个人再加一处调用就没了 —— J2 07:40)
 *    而实现方式【不是逐个 catch 已知失败】: 那是列举, 而列举永远证不了完整
 *    ("我们有三道 fail-closed"会让人以为覆盖是完整的, 而完整性从没被证明过 —— Bettor 07:41)。
 *    ⇒ 整块包住: 任何不是【明确成功】的路径, 一律降级为「网关不启动 + 一条刺眼的日志」, console 继续。
 *    ⇒ 与白名单那条同一个原理: default-deny 可以被证明完整, 逐条列举不能。
 *
 * @returns {Promise<null|{close: () => Promise<void>, host: string, port: number}>}
 */
export async function startExternalGateway() {
  // 🔴🔴 "从不抛"不够 —— 还必须【从不卡】(J2 07:46)。
  //    index.js 里它是顶层 await, 而 relay / tg-bot / broker / cron 全在它【之后】启动。
  //    ⇒ 它若卡住(不抛, 只是永不 resolve), 那些一个都起不来;
  //      而 console 自己的 HTTP 在更早一行就已经在监听 ⇒ 【进程活着、端口通、而整个栈没起来】。
  //    ⇒ 这正是今晚那一族最贵的形态: 每一步看起来都成功, 而要发生的事没发生。
  //    ⇒ 所以给它一个硬上界: 超时 ⇒ 与其它任何"不是明确成功"的路径同样降级。
  const START_TIMEOUT_MS = Number(process.env.KANET_EXTERNAL_GATEWAY_START_TIMEOUT_MS) || 8000;
  // 🔴 race 不取消输的那一方(J2 07:53): 超时后 _start() 仍在跑, 它可能【随后】把端口开起来
  //    ⇒ 我们宣布没启动, 而口是开着的 —— 对一个安全相关的监听口这是最坏的一种。
  //    ⇒ 用一个共享 state 让两边都能收尾: 外层置 cancelled + 尽力关; 内层 listen 之后自查。
  const state = { cancelled: false, app: null };
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(_TIMED_OUT), START_TIMEOUT_MS);
  });
  try {
    const r = await Promise.race([_start(state), timeout]);
    if (r === _TIMED_OUT) {
      state.cancelled = true;
      // 🔴 这里【不许】调 state.app.close() —— 实测: 对一个【还没 listen】的 fastify 实例调 close(),
      //    之后它的 listen 仍会成功, 而第二次 close() 不再关掉那个新开的 socket ⇒ 口反而留下了。
      //    ⇒ 收尾唯一有效的位置是【listen 成功之后】那一处(见 _start 里的迟到检查)。
      //    ⇒ 而超时能赢 race, 恰恰意味着 listen 还没完成 ⇒ 此刻本来也没有口要关。
      console.error(
        `[external-gateway] 🔴 启动超过 ${START_TIMEOUT_MS}ms 仍未完成 ⇒ 放弃, console 继续跑。` +
          ' (卡住而不是抛 —— 例如 HOST 是个解析不了的主机名。不给上界的话, 它后面的 relay/bot/cron 全起不来。)',
      );
      return null;
    }
    return r;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 超时哨兵 —— 用 Symbol 保证它不可能与 _start() 的任何正常返回值相等。 */
const _TIMED_OUT = Symbol('external-gateway-start-timeout');

async function _start(state) {
  let app = null;

  /**
   * 统一的降级出口: 收掉可能已经半开的实例, 打一条日志, 返回 null。
   *
   * 🔴 而【级别要分开】: "未配置"是装载第一步之后的【正常状态】(码装上了、env 还没配)。
   *    若它每次启动都走 error 级别, 人会学会忽略这一行 —— 然后【真失败时长得一模一样】。
   *    ⇒ 正常态走 info, 异常态走 error。这是"别让正常的东西喊得跟出事一样"。
   * @param {string} msg
   * @param {{expected?: boolean}} [opt] expected=true ⇒ 这是预期内的不启动, 不是故障
   */
  const abort = async (msg, opt) => {
    if (app) {
      try { await app.close(); } catch { /* 已经半开着也要尽量收 */ }
    }
    if (opt && opt.expected) console.log(msg);
    else console.error(msg);
    return null;
  };

  try {
    if (PROTOCOL_ROUTES.length === 0) {
      return await abort('[external-gateway] 🔴 白名单为空 ⇒ 不启动(fail-closed)。');
    }

    const portRaw = process.env.KANET_EXTERNAL_GATEWAY_PORT;
    const host = process.env.KANET_EXTERNAL_GATEWAY_HOST;

    // 🔴 没有默认对外绑定 —— 暴露必须是一次显式配置决定。
    //    env 未配 = 本模块被调用了、而一个端口都不监听 ⇒ 装载后行为零变化。
    if (!portRaw || !host) {
      return await abort(
        '[external-gateway] 未配置 KANET_EXTERNAL_GATEWAY_HOST / _PORT ⇒ 不启动(fail-closed)。' +
          ' 🔴 这不是错误: 没有配置就没有对外口。',
      );
    }

    const port = Number(portRaw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return await abort(`[external-gateway] 🔴 KANET_EXTERNAL_GATEWAY_PORT 非法(${portRaw}) ⇒ 不启动。`);
    }

    // 🔴 exposeHeadRoutes:false —— fastify 默认会为每条 GET 自动加一条 HEAD。
    //    那会让下面"实际注册的 === 白名单"这条判据【永远对不上】, 于是只能放宽成"包含",
    //    而放宽之后它就挡不住"多注册了一条"这件事。⇒ 关掉它, 让判据保持【精确相等】。
    // 🔴 bodyLimit 实例级(设计 §六): 不设就吃 Fastify 默认 1 MiB, 而这个口的请求体是几百字节量级。
    //   判据不是"设了", 是【超限必须回 413】而不是被静默截断。
    app = Fastify({ logger: false, exposeHeadRoutes: false, bodyLimit: GW_BODY_LIMIT_BYTES });
    state.app = app; // 🔴 让外层在超时时也能关掉它

    // ── 资源控制钩子(实例级, 覆盖该口全部路由) ──
    // 🔴 用 onRequest 而不是 preHandler: 后者在【路由匹配 + body 解析之后】才跑, 而限频与并发
    //   属于"在花任何代价之前就该判"的那一类。onRequest 是最早的钩子, 同样免费。
    app.addHook('onRequest', (req, reply, done) => {
      const ip = _peerIp(req);
      const isWrite = req.method !== 'GET' && req.method !== 'HEAD';
      const tier = isWrite ? 'w' : 'r';
      const retryAfter = _rateLimited(ip, tier, isWrite ? GW_RATE_WRITE : GW_RATE_READ, Date.now());
      if (retryAfter > 0) {
        reply.header('Retry-After', String(retryAfter));
        reply.code(429).send({ error: 'rate limited', retry_after_seconds: retryAfter });
        return;   // 🔴 不 done() ⇒ 请求在这里终结, 且【还没有】占用 in-flight 槽位
      }
      if (_inFlight >= GW_MAX_INFLIGHT) {
        // 🔴 立即拒绝, 【不排队】—— 排队会把"拒绝"变成"更长的占用", 那正是要防的东西。
        reply.header('Retry-After', '1');
        reply.code(503).send({ error: 'gateway busy', retry_after_seconds: 1 });
        return;
      }
      _inFlight++;
      // 🔴🔴 计数器【不能泄漏】(NWT 落码警告): 若只在正常响应时减, 而客户端在那最长 8 秒里断开
      //   是【常态不是边角】⇒ 几个中途断开的请求就永久吃掉槽位 ⇒ 之后恒 503,
      //   而【恒 503】与【正在被攻击】读数完全相同。
      //   ⇒ 减计数挂在【请求终结的所有出口】上, 并用一次性闸保证恰好减一次。
      let released = false;
      const release = () => { if (!released) { released = true; _inFlight--; } };
      reply.raw.on('finish', release);   // 正常响应写完
      reply.raw.on('close', release);    // 连接关闭(含客户端中途 abort / 异常)
      req.raw.on('aborted', release);    // 客户端显式中止
      done();
    });

    // 🔴🔴 白名单从【文档】变成【闸】(J2 07:37 residual ①):
    //    PROTOCOL_ROUTES 里的 method/path 本来只是描述 —— 没有任何东西保证 r.register()
    //    实际注册上去的就是它们。于是白名单可以【在自己不知情的情况下变宽】, 而它长得像一份权威清单。
    const actuallyRegistered = [];
    app.addHook('onRoute', (r) => {
      const methods = Array.isArray(r.method) ? r.method : [r.method];
      for (const m of methods) actuallyRegistered.push(`${m} ${r.url}`);
    });

    // 🔴 只注册白名单里的那几条 —— 【不调用 registerChatRoutes】。
    //    它里面有 20 条路由(NWT 07:23 实测), 调它会把 /api/chat/send 等 19 条一并暴露到外网。
    for (const r of PROTOCOL_ROUTES) {
      await r.register(app);
    }

    const declared = PROTOCOL_ROUTES.map((r) => `${r.method} ${r.path}`).sort();
    const actual = actuallyRegistered.slice().sort();
    if (declared.length !== actual.length || declared.some((d, i) => d !== actual[i])) {
      return await abort(
        '[external-gateway] 🔴 实际注册的路由与白名单不一致 ⇒ 【不启动】(fail-closed)。\n' +
          `  白名单声明: ${JSON.stringify(declared)}\n` +
          `  实际注册的: ${JSON.stringify(actual)}\n` +
          '  ⇒ 差集里的每一条都是【没有被审过就要对外暴露】的东西。',
      );
    }

    await app.listen({ port, host });

    // 🔴 迟到检查: 外层可能已经超时并宣布没启动 ⇒ 那就【不许】把这个口留着。
    if (state.cancelled) {
      try { await app.close(); } catch { /* 尽力 */ }
      console.error(`[external-gateway] 🔴 监听在超时【之后】才成功 ⇒ 已关掉它。绝不留一个我们说它没开、而它开着的口。`);
      return null;
    }

    console.log(
      `[external-gateway] listening on ${host}:${port} — 只暴露 ${PROTOCOL_ROUTES.length} 条协议面路由:\n` +
        PROTOCOL_ROUTES.map((r) => `  ${r.method} ${r.path}`).join('\n'),
    );
    const started = app;
    return { close: () => started.close(), host, port };
  } catch (e) {
    // 🔴 兜底: 不区分是哪一种失败(端口被占 / 路由冲突 / 权限 / 将来新增的任何一种)。
    //    列举失败情形永远证不了完整; 而"不是明确成功就一律不启动"可以。
    return await abort(
      '[external-gateway] 🔴 启动过程中出现未预期失败 ⇒ 网关【不启动】, 而 console 继续跑。' +
        ` 原因: ${e && e.code ? e.code + ' ' : ''}${e && e.message ? e.message : String(e)}`,
    );
  }
}

/** 供测试/审查用: 白名单本身。🔴 只读 —— 改它等于改暴露面, 必须走审。 */
export function listProtocolRoutes() {
  return PROTOCOL_ROUTES.map((r) => ({ method: r.method, path: r.path, why: r.why }));
}
