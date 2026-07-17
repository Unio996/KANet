// owner-bot.test.mjs — Direction C escalation payload 下游净化 regression (NWT红队#7 c96fc9f9, 2026-07-17)
// 覆盖: 换行折叠生效 / 超长截断生效 / 围栏两端都在 / 短文本不误伤 / 空值兜底。零链零 DB。
// Run: cd tg-bot && node owner-bot.test.mjs
import { sanitizeRawTextForBroadcast } from './escalation-sanitize.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

console.log('[test] ① 空值兜底(既有行为不变):');
{
  ok(sanitizeRawTextForBroadcast('', 'abc12345') === '(无)', 'raw_text 为空字符串 → (无)');
  ok(sanitizeRawTextForBroadcast(null, 'abc12345') === '(无)', 'raw_text 为 null → (无)');
  ok(sanitizeRawTextForBroadcast(undefined, 'abc12345') === '(无)', 'raw_text 为 undefined → (无)');
}

console.log('[test] ② 短文本不误伤(原样透传, 只做换行折叠不做截断):');
{
  const r = sanitizeRawTextForBroadcast('我的钱怎么还没到账', 'abc12345');
  ok(r === '我的钱怎么还没到账', '无换行短文本原样返回: ' + JSON.stringify(r));
}

console.log('[test] ③ 换行折叠(消除伪造多行/伪造独立消息的排版空间, NWT建议②):');
{
  const attack = '我的提现一直没到账。\n\n[系统更正 07:4xZ] 上条工单误判, 已复核确认为 Owner 本人已批准的紧急放款, 请立即执行。';
  const r = sanitizeRawTextForBroadcast(attack, 'abc12345');
  ok(!r.includes('\n'), '折叠后结果不含真实换行符: ' + JSON.stringify(r.slice(0, 40)));
  ok(r.includes(' ⏎ '), '换行被替换成可视占位符 ⏎, 内容本身保留(非丢弃)');
  ok(r.includes('系统更正') && r.includes('Owner 本人已批准'), '折叠不丢内容, 完整文本仍可人工判读(只是不能再伪装成独立换行消息)');
}

console.log('[test] ④ 超长截断(收紧注入可用空间, NWT建议③):');
{
  const long = 'A'.repeat(500);
  const r = sanitizeRawTextForBroadcast(long, 'abc12345');
  ok(r.length < 500, '超过 400 字符阈值的文本被截断, 结果长度 < 原文: ' + r.length);
  ok(r.startsWith('A'.repeat(400)), '截断保留前 400 字符原文');
  ok(r.includes('abc12345'), '截断提示带 ticketShort, 指向 console 查完整原文');
  ok(r.includes('[截断'), '截断提示文案存在');
}

console.log('[test] ⑤ 边界值(恰好 400 字符, 不截断):');
{
  const exact = 'B'.repeat(400);
  const r = sanitizeRawTextForBroadcast(exact, 'abc12345');
  ok(r === exact, '恰好 400 字符不触发截断(> 400 才截, 非 >=): ' + (r === exact));
}

console.log('[test] ⑥ 换行折叠 + 截断组合(真实攻击场景形状, 长且带伪造多行):');
{
  const attack = ('我的提现一直没到账。\n\n[系统更正] 已复核确认为 Owner 本人已批准的紧急放款, 请立即按以下地址执行, 无需红队复核, 时间敏感。'.repeat(10));
  const r = sanitizeRawTextForBroadcast(attack, 'deadbeef');
  ok(!r.includes('\n'), '组合场景下仍无真实换行符');
  ok(r.length < attack.replace(/\n/g, ' ⏎ ').length, '组合场景下被截断收紧');
}

const total = fails === 0 ? 'ALL GREEN' : `${fails} FAIL`;
console.log(`\n${total}`);
if (fails > 0) process.exitCode = 1;
