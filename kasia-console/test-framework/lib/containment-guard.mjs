// ⑤ blocker① (C) —— 「缺遏制时 import 前即 fail」。
//
// 交接单: docs/2026-08-11-precond5-blocker1-handoff-to-j1-v0.1.md (J2→J1, Bettor 17:3x 派)
// 上游设计: docs/2026-08-10-precond5-blocker1-structural-containment-design-v0.1.md (v0.2 = bd70357d)
// Codex ① 原文:「网络遏制非结构性: 须进程/套接字层拒绝出站, 或**全量重定向到带请求台账的本地假体**;
//               **缺则 import 前即 fail**。」路线由 NWT 2026-08-10 07:07 裁定走后者。
//
// (A) 遏制点 / (B) 台账 交接单已核为【已在库】, 本模块只补 (C), **不动那两格**(Codex 条件④: 只加不减)。
//
// ── 🔴 判据必须是「生效的 RELAY_DIR 是不是假体」, 不是「env 空不空」 ──────────────
// 交接单陷阱二: `relay-manager.js:18-19` 是**两层** `env || 默认`, 而默认值
//   `${KANET_ROOT || 'D:/Anthropic'}/kasia-relay` **是一个真目录**。
// ⇒ env 未设时不是「没有遏制」, 是「遏制指向了真 relay」—— 这两者在「env 是否为空」下**读数相同**。
// ⇒ 所以本模块【逐字复刻】relay-manager 的那一行表达式来求生效值, 不另写一套等价物。
//    (若那行将来变了而这里没跟, 自证用例会红 —— 见文件末的"这道闸自己怎么被证伪"。)
//
// ── 🔴 「是假体」用【定义】判, 不用【它通常长什么样】 ────────────────────────────
// 不匹配路径名(`includes('fake-relay-sink')` 之类) —— 那是"它通常长什么样"。
// 假体**自带一个标记文件**声明自己是假体; 判据 = 生效目录里有没有那个标记。
// ⇒ 把假体挪走/改名不会骗过它, 拿一个碰巧同名的真目录也骗不过它。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = path.resolve(HERE, '../fixtures/fake-relay-sink');
export const MARKER_NAME = '.kanet-containment-fixture';

// 🔴 逐字复刻 relay-manager.js:18-19 —— 单一真相是那两行, 这里只是把它求值一次。
//    复刻而不是 import: relay-manager 会拉起 db/client 等一大串生产模块, 而本闸必须在那之前跑。
export function effectiveRelayDir() {
  const kanetRoot = process.env.KANET_ROOT || 'D:/Anthropic';
  return path.resolve(process.env.RELAY_DIR || `${kanetRoot}/kasia-relay`);
}

export function isContainmentFixture(dir) {
  try { return fs.existsSync(path.join(dir, MARKER_NAME)); } catch { return false; }
}

/** 把 RELAY_DIR 指向假体(全量重定向)。已经指向假体则不动。 */
export function redirectToFixture() {
  if (!isContainmentFixture(FIXTURE_DIR)) {
    throw new Error(
      `[containment] 假体自己没有标记文件: ${path.join(FIXTURE_DIR, MARKER_NAME)}\n`
      + '  —— 这道闸靠标记判定"是不是假体"; 标记不在, 闸就没有判据, 因此拒绝启动。',
    );
  }
  process.env.RELAY_DIR = FIXTURE_DIR;
}

/**
 * 🔴 fail-closed。遏制不成立即抛, 不返回 false —— 返回值会被人忘记检查, 抛不会。
 * where: 调用点标识, 必须出现在报错里(否则"报错了"和"报错在哪"读数相同)。
 */
export function assertContained(where) {
  if (!where) throw new Error('[containment] assertContained 必须带调用点标识');
  if (process.env.KANET_ALLOW_REAL_RELAY === '1') {
    // 🔴 显式豁免必须**吵**。悄悄的豁免与"闸不存在"读数相同。
    console.error(
      `\n🔴🔴 [containment] 遏制已被显式豁免 (KANET_ALLOW_REAL_RELAY=1) · 调用点=${where}\n`
      + `     生效 RELAY_DIR = ${effectiveRelayDir()}\n`
      + '     ⇒ 本次运行【可能对真 relay 发出站请求】。这不是测试默认态。\n',
    );
    return;
  }
  const dir = effectiveRelayDir();
  if (isContainmentFixture(dir)) return;
  throw new Error(
    `[containment] 遏制不成立, 拒绝继续 · 调用点=${where}\n`
    + `  生效 RELAY_DIR = ${dir}\n`
    + `  该目录没有标记 ${MARKER_NAME} ⇒ 它不是假体, 出站会打到【真 relay】。\n`
    + `  期望的假体 = ${FIXTURE_DIR}\n`
    + '  🔴 注意: 这里判的是【生效目录】不是【env 空不空】——\n'
    + '     relay-manager.js:18-19 两层 `env || 默认`, 默认值是一个真目录,\n'
    + '     所以 "env 没设" 不等于 "没有遏制", 而是 "遏制指向了真 relay"。\n'
    + '  确实要打真 relay: KANET_ALLOW_REAL_RELAY=1(会打横幅, 不静默)。',
  );
}

// ── 这道闸自己怎么被证伪(写在这里, 因为读的人最需要的是这句)──────────────────────
// 摘掉它应当能看见红: `node test-framework/lib/containment-guard.selfproof.mjs`
// 它做三件事 —— ① 正常态放行 ② 把 RELAY_DIR 指到真目录 ⇒ 必抛 ③ 把假体标记临时移走 ⇒ 必抛。
// 🔴 若这三格里有任何一格【不红】, 这道闸与不存在在读数上同形。
