// 🔴 file-only: 本脚本【只接受一个 UTF-8 文件路径】, 拒绝在命令行上接收消息文本。
//    这是 2026-07-25 Bettor #08sosv 派工「全体发送脚本改 file-only」的落实 ——
//    该派工至今没有覆盖到本文件(J1 2026-08-10 扫出库里 6 支漏网, 本文件是其中之一)。
//
// 🔴 为什么不是"小心点用就行": **注入发生在【调用方的 shell】里, 脚本拿到文本时已经晚了。**
//    2026-07-25 真实事故: 消息里为了给队友看要跑什么, 写了一个代码块(三个连续的反引号),
//    而反引号在 bash 双引号串里就是命令替换 ⇒ **夹在中间那行命令被真执行**,
//    线上一个 grant 被实际吊销。⇒ 脚本【无法】自我防御, 只能取消这个入口。
//
// 用法: node <本脚本> <消息文件路径>
//   消息用 Write 写成 UTF-8 文件再传路径; 不要用 echo / printf / node -e 去生成它 ——
//   那几步同样会让文本经过 shell(2026-08-07 与 08-10 我各栽过一次)。
import { readFileSync as _readMsgFile } from 'node:fs';

const _p = process.argv[2];
if (!_p) {
  console.error('用法: node ' + process.argv[1] + ' <消息文件路径>');
  console.error('🔴 本脚本不接收命令行上的消息文本(file-only) —— 理由见文件头注释。');
  process.exit(2);
}
let msg;
try { msg = _readMsgFile(_p, 'utf8'); }
catch (e) {
  console.error('读不到消息文件: ' + _p + ' — ' + e.message);
  console.error('🔴 若你传的是【消息文本本身】: 本脚本已改为 file-only, 这个入口被取消了(不是路径打错)。');
  console.error('   把消息用 Write 写成 UTF-8 文件, 再传文件路径。理由见文件头注释。');
  process.exit(2);
}
if (!msg.trim()) { console.error('消息文件是空的: ' + _p); process.exit(2); }
// 🔴 端口: console 于 2026-07-11 从 3100 迁到 3200(kanet.env `PORT=3200`), 而本文件一直写死 3100
//    ⇒ 它此前【一直是死的】—— 任何调用都只会拿到 fetch failed, 而那看起来像"网络问题"。
//    实核(2026-08-10): 本机只有 3200 在 Listen, 3100 无人。
//    改为 KANET_CONSOLE 可覆盖, 默认 3200 —— 顺带让它【可以指向假 console 做测试】,
//    不必为了验证一条链路而真往频道发消息。
const CONSOLE = process.env.KANET_CONSOLE || 'http://127.0.0.1:3200';
// 🔴 fetch 必须带 timeout: 无界等待与"正在工作"在读数上完全相同。
//    本仓已有实例(2026-07-14 legacyRefundBuilderTick 自锁, 夜间 285 次冻结),
//    而 2026-08-10 我自己刚被同一个形状咬过一次: 一个图形密码框在无人会话里没人点,
//    ssh 就那么等满 90 秒 —— 它没报错, 它在等人。
const res = await fetch(CONSOLE + '/api/chat/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  signal: AbortSignal.timeout(15000),
  body: JSON.stringify({
    relayId: 'a83c4b07-eaf7-4d21-972a-1265e0cdcfcf',
    channel: 'kanet-public',
    message: msg,
  }),
});
console.log(JSON.stringify(await res.json()));
