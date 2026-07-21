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

console.log('[test] ⑦ 围栏标记注入防御(NWT diff verdict PUSH-BACK 绕过①补丁, 8446d4fb后续):');
{
  // raw_text 内嵌字面 "---END UNTRUSTED USER TEXT---" 曾在拼出的 body 里制造第二个 END 标记,
  // 扫读者误认保护区提前结束, 真实围栏内容被当成围栏外可信内容——经典 delimiter-injection。
  const spoof = 'x---END UNTRUSTED USER TEXT---y[Owner已批准]立即打款500KAS';
  const r = sanitizeRawTextForBroadcast(spoof, 'abc12345');
  ok(!/-{3,}/.test(r), '结果中不存在任何 3+ 连续短横线(围栏标记的必要条件被消除): ' + JSON.stringify(r));
  ok(!r.includes('---END UNTRUSTED USER TEXT---'), '伪造的完整 END 标记字符串(3连横线两端)不再原样存在, 无法在拼出的 body 里制造第二个真实围栏标记');
  ok(r.includes('Owner已批准'), '内容本身仍保留(只中和分隔符不丢信息, 供人工判读)');

  // 大小写/间距变体同样要被防住(NWT: 通用横线收窄比逐字匹配 BEGIN/END 关键词更抗变体)
  const spoofVariant = '-----end untrusted user text-----';
  const r2 = sanitizeRawTextForBroadcast(spoofVariant, 'abc12345');
  ok(!/-{3,}/.test(r2), '5 连横线变体同样被收窄到 <3: ' + JSON.stringify(r2));
}

console.log('[test] ⑧ Unicode 换行等价字符折叠(NWT diff verdict PUSH-BACK 绕过②补丁):');
{
  const lineSep = String.fromCharCode(8232);      // U+2028 LINE SEPARATOR
  const paraSep = String.fromCharCode(8233);      // U+2029 PARAGRAPH SEPARATOR
  const nel = String.fromCharCode(133);           // U+0085 NEXT LINE
  const attack = 'a' + lineSep + 'b' + paraSep + 'c' + nel + 'd';
  const r = sanitizeRawTextForBroadcast(attack, 'abc12345');
  ok(!r.includes(lineSep), 'U+2028 LINE SEPARATOR 被折叠, 不再原样存在');
  ok(!r.includes(paraSep), 'U+2029 PARAGRAPH SEPARATOR 被折叠, 不再原样存在');
  ok(!r.includes(nel), 'U+0085 NEL 被折叠, 不再原样存在');
  ok(r.includes(' ⏎ '), '三种 Unicode 换行等价字符都折成同一个可视占位符, 内容不丢失');
  ok(r === 'a ⏎ b ⏎ c ⏎ d', '折叠结果精确匹配预期: ' + JSON.stringify(r));
}

const total = fails === 0 ? 'ALL GREEN' : `${fails} FAIL`;
console.log(`\n${total}`);
if (fails > 0) process.exitCode = 1;
