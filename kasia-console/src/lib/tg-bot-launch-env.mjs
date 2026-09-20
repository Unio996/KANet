// tg-bot-launch-env.mjs — CR-1: 电报 bot 启动器的主网 fail-closed 环境判定(纯函数, 无 I/O, 不 import 任何 DB / console 模块)。
// 设计: docs/2026-09-19-kanetui-cr1-cr2-tg-bot-mainnet-guards-change-spec-v0.1.md §1(NWT 审 → Bettor 批)。
//
//   resolveBotLaunchEnv(env) → { ok: true, consoleUrl, scrub: [键名...] }
//                            | { ok: false, problems: [ "描述(只含键名/期望/非密钥值)" ... ] }
//
// 🔴 problems 里【只有键名与非密钥值】(网络名、端口、URL 的 origin)——绝不回显 INGEST_SECRET / TELEGRAM_BOT_TOKEN / 任何 ADMIN_SECRET* 的值。
// 🔴 scrub = 要从 bot 进程环境里删掉的键名(只列 env 里【真的存在】的): bot 是 0-key / 0-custody 进程, 不需要 DB 加密密钥 / admin 密钥 /
//    密钥导出窗口; tg-bot-manager fork 时 { ...process.env } 会把它们全带进去。黑名单而非白名单——Windows 上删 SystemRoot 等系统变量可能让 DNS/TLS 行为异常。

const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

/** 只打印 URL 的 origin(协议+主机+端口), 绝不带 userinfo / 路径 / 查询——URL 里可能夹带凭据。解析不了 ⇒ 固定占位。 */
function safeOrigin(u) {
  try { const p = new URL(String(u)); return `${p.protocol}//${p.host}`; } catch { return '(unparseable)'; }
}

const SCRUB_EXACT = ['CONSOLE_ENCRYPTION_KEY', 'RELAY_KEY_EXPORT_ENABLED_UNTIL'];
const SCRUB_PATTERNS = [/^ADMIN_SECRET/];

export function resolveBotLaunchEnv(env) {
  const e = env || {};
  const problems = [];

  // a. 网络必须是 mainnet(网络名不是密钥, 可打印)
  if (e.KASPA_NETWORK !== 'mainnet') problems.push(`KASPA_NETWORK 必须为 mainnet(实际: ${nonEmpty(e.KASPA_NETWORK) ? e.KASPA_NETWORK : '(未设)'})`);

  // b. PORT 必须是 1–65535 的整数字符串(无前导零), 由它推导本机 console 地址
  let consoleUrl = null;
  if (typeof e.PORT === 'string' && /^[1-9][0-9]{0,4}$/.test(e.PORT) && Number(e.PORT) <= 65535) consoleUrl = `http://127.0.0.1:${e.PORT}`;
  else problems.push('PORT 缺失或非法');

  // c. CONSOLE_URL 若已设, 必须等于推导值(拦住继承来的 :3200 陈值; 拒绝任何"bot 指向非本机 console"的配置)
  if (consoleUrl && nonEmpty(e.CONSOLE_URL) && e.CONSOLE_URL.trim() !== consoleUrl) {
    problems.push(`CONSOLE_URL 与本机 console 端口不一致(实际: ${safeOrigin(e.CONSOLE_URL)})`);
  }

  // d/e. 只说缺, 不回显
  if (!nonEmpty(e.INGEST_SECRET)) problems.push('INGEST_SECRET 缺失');
  if (!nonEmpty(e.TELEGRAM_BOT_TOKEN)) problems.push('TELEGRAM_BOT_TOKEN 缺失');

  // f. 绕过最小额/软顶守卫的测试网开关, 主网环境里不得出现(runbook §8 的运行时第二道)
  if (Object.prototype.hasOwnProperty.call(e, 'KANET_TESTNET_NO_LIMITS')) problems.push('KANET_TESTNET_NO_LIMITS 不得出现在主网环境');

  if (problems.length) return { ok: false, problems };

  const scrub = Object.keys(e).filter((k) => SCRUB_EXACT.includes(k) || SCRUB_PATTERNS.some((re) => re.test(k)));
  return { ok: true, consoleUrl, scrub };
}
