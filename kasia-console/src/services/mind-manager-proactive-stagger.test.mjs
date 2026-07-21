// mind-manager-proactive-stagger.test.mjs — regression guard for the "dead staggerMs" bug
// (J2, 2026-07-13, Bettor #jadgup 第三源: 31 agent proactive/reflection setInterval 撞死代码错峰,
// 撞出 13:51 105s 假死, 疑似历史 2983 次看门狗误报常年主凶)。
//
// 根因: staggerMs = ri*25000 (line ~791) 只被下方两个 one-time "首次触发" setTimeout(startup)
// 用到, 常驻 setInterval 的启动延迟(recurring proactive/reflection loop)长期只用纯随机抖动,
// 完全没接 staggerMs——DB 实测全部 31 relay 的 proactive_interval_minutes/evolution_interval_hours
// 清一色相同值, 随机抖动一旦聚簇就因周期相同而永久锁死, 每轮准点重演。
//
// 无 fake-timer 工具(sinon/jest 均未在本项目使用), 且这是"变量算出来但没接线"这一类结构性 bug——
// 最直接、最不会漂移的回归防线是**静态验证源码文本**: 断言常驻 setInterval 的两处启动延迟表达式
// 确实引用了 staggerMs(不能只留在 one-time trigger 那两处)。若未来有人不小心把这行改回纯随机,
// 这个测试会先炸, 不用等下次 105s 假死才发现。
import fs from 'fs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

const src = fs.readFileSync(new URL('./mind-manager.js', import.meta.url), 'utf8');

console.log('[test] proactive/reflection 常驻 setInterval 启动延迟必须引用 staggerMs(死代码回归防线):');
{
  // 抓两处"setTimeout(() => { setInterval(...) }, <delay>)"结构里, 紧跟在 setInterval(...}, <period>);
  // 之后的那个外层 setTimeout 的第二个参数(启动延迟表达式)。
  const recurringDelayBlocks = [...src.matchAll(/}, (?:proactiveMs|reflectMs)\);\s*\n\s*}, ([^;]+);/g)];
  ok(recurringDelayBlocks.length === 2, `找到 2 处常驻 setInterval 外层启动延迟(proactive+reflection), 实际=${recurringDelayBlocks.length}`);
  for (const m of recurringDelayBlocks) {
    ok(m[1].includes('staggerMs'), `启动延迟表达式含 staggerMs: "${m[1].trim()}"`);
  }
}

console.log('[test] one-time startup trigger(首次 proactive/reflection)仍保留 staggerMs(确认没有连带删错):');
{
  const startupTriggers = [...src.matchAll(/}, (\d+_\d+ \+ staggerMs \+ Math\.random\(\) \* \d+_\d+)\);/g)];
  ok(startupTriggers.length >= 2, `one-time startup trigger 仍含 staggerMs 的处数 ≥2, 实际=${startupTriggers.length}`);
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — staggerMs 死代码 bug 已在常驻循环补线, one-time trigger 未受影响'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
