#!/usr/bin/env node
/**
 * 频道消息发送前的机械闸 —— 拦【基础设施坐标】。
 *
 * 为什么是机械闸而不是纪律(2026-08-09 当天的实测, 不是设想):
 *   sanitize 披露纪律        ⇒ 四个人全败, 无一当场自觉发现
 *   "别发基础设施坐标"       ⇒ 两人几乎同时标出, 而【其中一人在标它的那条消息正文里又犯了一次】
 *                              ⇒ 链上于是有了两份, 而不是一份
 * 🔨 判据: **拦截点放在人这一侧就会漏, 连【正在专心处理这件事的人】也会漏。**
 *
 * dev-coord 频道是【链上明文, 永久且公开】—— 发出去撤不回, 也删不掉。
 *
 * 🔴 它为什么住在 scripts/ 而不是 scratch/:
 *   我最初把这道闸写进了 gitignored 的 `scratch/j1-send-one.sh`。而我同一天刚提交
 *   `check-deployed-drift.mjs`, 专治"承重的东西住在 git 之外、没人知道它陈了或没了"。
 *   **把一道安全闸放进 scratch 就是同一个病** —— 那棵树被清理/重装, 闸就没了, 而不会有任何提示。
 *
 * 用法: node scripts/check-message-safety.mjs <payload.json>   (payload.message 是正文)
 * 退出: 0=干净  9=命中(不发)  2=用法错
 */
import fsx from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('用法: node scripts/check-message-safety.mjs <payload.json>'); process.exit(2); }

let message;
try { message = JSON.parse(fsx.readFileSync(file, 'utf8')).message; }
catch (e) { console.error('🔴 读不出 payload.message: ' + e.message); process.exit(2); }
if (typeof message !== 'string') { console.error('🔴 payload.message 不是字符串'); process.exit(2); }

// 🔵 零信息地址放行(本闸第一次真用就撞到, 而它是按本闸自己的原则修的):
// 我写完这道闸之后, 第一条被它拦下的消息是【我自己在讲探针 RPC】的那条, 命中 `127.0.0.1`。
// 环回地址不泄露任何拓扑 —— 拦它保护不了任何东西, 只制造噪音。而这个闸的注释自己写着
// "爱喊狼的闸会被人常开 override, 等于没有" ⇒ 按那条原则, 该放行的必须放行。
// ⚠ 只放行【确实零信息】的那几类。Tailscale/CGNAT(100.64.0.0/10)、私网、公网一律照拦 ——
//   今天真泄露的正是 CGNAT 那一类, 放宽到"所有非公网可路由"就等于把闸拆了。
function isZeroInfoAddr(o) {
  if (o[0] === 127) return true;                        // 环回
  if (o[0] === 0 && o[1] === 0 && o[2] === 0 && o[3] === 0) return true;      // 0.0.0.0
  if (o.every((x) => x === 255)) return true;           // 广播
  return false;
}

const hits = [];
message.split('\n').forEach((line, i) => {
  // 点分四段: 逐段校验 <=255。
  // 🔴 更正我自己写过两遍的一句: 我说过"版本号不会被误拦"。**四段版本号会被拦。**
  //   我当时只测了三段的 `1.2.3`(它确实放行), 然后把结论推广成了"版本号" —— 而
  //   `1.2.3.4` 与一个 IP 在【语法上无法区分】, 没有任何按定义的判法能分开它们。
  //   ⇒ 拦是对的安全默认(宁可让人加 override, 不可让坐标溜过去); 错的是我那句断言。
  //   实测四例: 127.0.0.1 放 · 0.0.0.0 放 · 100.99.x.x 拦 · 192.168.x.x 拦 · 1.2.3.4 拦。
  for (const m of line.matchAll(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g)) {
    const octets = m.slice(1, 5).map(Number);
    if (!octets.every((o) => o <= 255)) continue;
    if (isZeroInfoAddr(octets)) continue;
    hits.push([i + 1, '点分四段', m[0]]);
  }
  // user@host: @ 前要有用户名(排除 @J1 这类点名), @ 后要含点(排除 @中文名)
  for (const m of line.matchAll(/\b[A-Za-z0-9_.-]{2,}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g)) {
    hits.push([i + 1, 'user@host', m[0]]);
  }
});

if (!hits.length) { console.log('坐标硬闸: ✅ 0 处'); process.exit(0); }
console.error(`🔴 坐标硬闸拦下 ${hits.length} 处 —— 未发送。本频道上链且永久, 发了撤不回。`);
for (const [ln, kind, txt] of hits) console.error(`   行 ${ln} [${kind}]: ${txt}`);
console.error('   改法: 正文用占位符(如 <挖矿机>), 具体值放本地 env / kanet.env / scratch/。');
console.error('   ⚠ 连【举报泄露的那条消息】本身也要用占位符 —— 今天正是在这一步又泄了一次。');
console.error('   若确实不是基础设施坐标: J1_ALLOW_INFRA_ADDR=1 重跑。');
process.exit(9);
