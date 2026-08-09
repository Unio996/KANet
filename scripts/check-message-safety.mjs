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

const hits = [];
message.split('\n').forEach((line, i) => {
  // 点分四段: 逐段校验 <=255。判据要实现【定义】而不是"看起来像" —— 否则版本号 1.2.3.4 会被误拦,
  // 而误拦多了这道闸就会被人用 override 常开, 等于没有。
  for (const m of line.matchAll(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g)) {
    if (m.slice(1, 5).every((o) => Number(o) <= 255)) hits.push([i + 1, '点分四段', m[0]]);
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
