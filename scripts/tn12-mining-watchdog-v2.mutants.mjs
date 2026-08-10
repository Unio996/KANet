import fs from 'node:fs';

const SP = process.argv[2];
const src = fs.readFileSync(new URL('./tn12-mining-watchdog-v2.ps1', import.meta.url), 'utf8');

// 每个变异都必须【确实改到了东西】。改不到而继续跑 = 拿原文当变异体测,
// 结果全绿, 而那个全绿会被读成"守卫是承重的"—— 恰好相反的结论。
// 🔴 两次写错都出在【空格数】上: `  {4}` 是 1+4=5 个空格, 缩进是 4 ⇒ 永不匹配。
//    我第一次把它误诊成 CRLF(这份工作树其实是 LF), 差点去修一个不存在的病。
function mutate(name, from, to) {
  const out = src.replace(from, to);
  if (out === src) throw new Error(`MUTATION-INERT: ${name} 没有改到任何东西 —— 不能据此下结论`);
  fs.writeFileSync(`${SP}/wd-${name}.ps1`, out);
  console.log(`${name}: 写出  (长度差 ${out.length - src.length})`);
}

// ① 拆掉「这一发没拉动 DAA ⇒ 停手」—— 楔死态该无限连发
mutate('mut1', / {6}elseif \(\$daaPost -le \$daaPre\) \{[\s\S]*?\n {6}\}\n/, '');
// ② off-by-one: -le 改 -lt ⇒ DAA 持平(楔死最典型的样子)被当成推进
mutate('mut2', '$daaPost -le $daaPre', '$daaPost -lt $daaPre');
// ③ 拆掉「读不到就不算成功」⇒ 未知被当成付了账
mutate('mut3', /      if \(\$null -eq \$daaPre -or \$null -eq \$daaPost\) \{[\s\S]*?\n      \}\n/, '      if ($false) {\n      }\n');
// ④ 预算闸永不触发
mutate('mut4', 'elseif ($pulseCount -ge $MAX_PULSES) {', 'elseif ($pulseCount -ge 999999) {');
// ⑤ tips 效力判据 off-by-one: -ge 改 -gt(漏掉持平)
mutate('mut5', '$tips -ge $pulseRefTips', '$tips -gt $pulseRefTips');
// ⑥ 去掉 uint64 强转 ⇒ 字符串比较, "9" -gt "10" 为真
mutate('mut6', 'try { $daaNow = [uint64]$health.virtualDaaScore } catch { $daaNow = $null }',
  'try { $daaNow = $health.virtualDaaScore } catch { $daaNow = $null }');
// ⑦ 🔴 把授权信号【接回循环顶部那个 $daaAdvancing】—— 即 Codex 抓到的原缺陷本身, 重新注入。
//    这一条是本组最重要的: 它检验的不是某个 off-by-one, 而是【那个自证回路会不会被人接回来】。
mutate('mut7', '$daaPost -le $daaPre', '-not $daaAdvancing');
// ⑧ 🔴 把结算窗挪到 Stop-Miner【之前】—— 常量原地不动、sleep 也还在, 只有【顺序】没了。
//    这正是"断言存在一个 sleep"抓不到而"断言顺序"能抓到的那种静默失效。
mutate('mut8',
  '      Start-Sleep -Milliseconds $DAA_SETTLE_MS\n      $daaPost = Get-DaaNow',
  '      $daaPost = Get-DaaNow\n      Start-Sleep -Milliseconds $DAA_SETTLE_MS');
// ⑨ 把结算窗改回"无校验直接吃 env"—— Codex 这一轮 MUST-FIX 的原缺陷本身
mutate('mut9', /^\$DAA_SETTLE_MS         = \$DAA_SETTLE_DEFAULT_MS$/m,
  '$DAA_SETTLE_MS         = if ($DAA_SETTLE_RAW) { [int]$DAA_SETTLE_RAW } else { $DAA_SETTLE_DEFAULT_MS }');
// ⑩ 下限闸放行 0/负数(只挡乱码) —— 最像"顺手简化"的那种削弱
mutate('mut10', '$parsed -lt $DAA_SETTLE_FLOOR_MS', '$parsed -lt -999999');
