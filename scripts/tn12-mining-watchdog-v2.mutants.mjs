import fs from 'node:fs';

const SP = process.argv[2];
const src = fs.readFileSync(new URL('./tn12-mining-watchdog-v2.ps1', import.meta.url), 'utf8');

// 每个变异都必须【确实改到了东西】。改不到而继续跑 = 拿原文当变异体测,
// 结果全绿, 而那个全绿会被读成"守卫是承重的"—— 恰好相反的结论。
function mutate(name, from, to) {
  const out = typeof from === 'string' ? src.replace(from, to) : src.replace(from, to);
  if (out === src) throw new Error(`MUTATION-INERT: ${name} 没有改到任何东西 —— 不能据此下结论`);
  const p = `${SP}/wd-${name}.ps1`;
  fs.writeFileSync(p, out);
  console.log(`${name}: 写出 ${p}  (长度差 ${out.length - src.length})`);
}

// ① 拆掉「DAA 未推进 ⇒ 抑制脉冲」那一支(楔死保护)
// 🔴 两次写错都出在【空格数】上, 记下来: `  {4}` 是 1+4=5 个空格, 而缩进是 4 ⇒ 永不匹配。
//    我第一次把它误诊成 CRLF(这份工作树其实是 LF), 差点去修一个不存在的病 ——
//    MUTATION-INERT 那道守卫是唯一拦住我的东西, 否则我会拿原文当变异体测出一片全绿。
mutate('mut1', / {4}elseif \(-not \$daaAdvancing\) \{[\s\S]*?\n {4}\}\n/, '');
// ② 让预算闸永不触发
mutate('mut2', 'elseif ($pulseCount -ge $MAX_PULSES) {', 'elseif ($pulseCount -ge 999999) {');
// ③ 效力判据 off-by-one: -ge 改 -gt(tips 与参考值相等时漏判)
mutate('mut3', '$tips -ge $pulseRefTips', '$tips -gt $pulseRefTips');
// ④ 把 UNKNOWN 塌成"在推进"(默认动作改成会动作的那个 —— 正是 feedback_default-action-must-be-the-non-spending-one)
mutate('mut4', /  if \(\$null -eq \$daaNow -or \$null -eq \$prevDaa\) \{ \$daaAdvancing = \$null \}/,
  '  if ($null -eq $daaNow -or $null -eq $prevDaa) { $daaAdvancing = $true }');
