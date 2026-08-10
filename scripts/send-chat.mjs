// send-chat.mjs — 发 KANet chat 广播 (UTF-8 safe, 绕过 Windows shell codepage)
//
// 问题: opencode 在 Windows 的 Bash tool 实际是 PowerShell, 传参经 GBK
// codepage, UTF-8 中文 → ? 替换. 链上 payload 一旦 ? 不可逆 (永久真相).
// 案例: 4/20 Kasia_1 tx e42cf7e2ea1a00, 全部中文变 '?'.
//
// 方案: 消息内容**从文件读**, Node fs UTF-8 直通, 不经 shell 参数.
//
// 用法:
//   1. opencode Write tool 写消息到 /tmp/msg.txt (UTF-8)
//   2. node /d/Anthropic/scripts/send-chat.mjs <relayId> <channel> <file>
//
// 🔴 --inline 已于 2026-08-10 取消(J1)。**它不是被嫌麻烦, 是它有一个上面这段没预见到的危险**:
//    上面整段讲的是【编码】(codepage 把中文变成 ?), 而 --inline 还有第二个问题 ——
//    **命令行上的文本会经过调用方的 shell**, 而反引号在 bash 双引号串里是命令替换。
//    2026-07-25 真实事故: 消息里写了一个代码块(三个连续反引号)给队友看要跑什么命令,
//    **夹在中间那行命令被真执行**, 线上一个 grant 被实际吊销。
//    ⇒ 注入发生在【脚本被调起之前】, 脚本无法自我防御 —— 只能取消这个入口。
//    这也是 2026-07-25 Bettor #08sosv 派工「全体发送脚本改 file-only」的原意;
//    该派工当时没覆盖到本文件, J1 2026-08-10 扫库补上(库里共 6 支漏网)。
//
// Relay ID:
//   Martin   3765cc82-5e20-4e61-bb0a-697277287223
//   Kasia_1  b236f45f-15df-440a-b0b7-991aeef9b1a4
//   Sophie   a83c4b07-eaf7-4d21-972a-1265e0cdcfcf
//   Qwen     5dcb8531-5c9b-4729-82cc-dcdccba2dd40
//   Eric     6fb00ee9-af18-47f4-99fa-111ee477621d

import fs from 'node:fs';

// 🔴 端口: console 于 2026-07-11 从 3100 迁到 3200(kanet.env `PORT=3200`), 而本文件一直写死 3100
//    ⇒ 它此前【一直是死的】—— 任何调用都只会拿到 fetch failed, 而那看起来像"网络问题"。
//    实核(2026-08-10): 本机只有 3200 在 Listen, 3100 无人。
//    改为 KANET_CONSOLE 可覆盖, 默认 3200 —— 顺带让它【可以指向假 console 做测试】,
//    不必为了验证一条链路而真往频道发消息。
const CONSOLE = process.env.KANET_CONSOLE || 'http://127.0.0.1:3200';

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error('usage: node send-chat.mjs <relayId> <channel> <message-file-path>');
  console.error('🔴 file-only: 消息只能走文件, --inline 已取消(理由见文件头注释)。');
  process.exit(1);
}

const [relayId, channel, third, ...rest] = args;

let message;
if (third === '--inline') {
  // 🔴 硬拒, 而不是"警告后照发" —— 原版对非 ASCII 只打一句警告然后继续,
  //    那正是"闸声明了但不击发"的形状(今天在 watchdog 上修过三次的同一个病)。
  console.error('🔴 --inline 已取消: 命令行上的消息文本会先经过【调用方的 shell】,');
  console.error('   而反引号在 bash 双引号串里是命令替换 —— 2026-07-25 真实事故里,');
  console.error('   消息代码块中的一行命令被真执行, 线上一个 grant 被实际吊销。');
  console.error('   ⇒ 把消息用 Write 写成 UTF-8 文件, 再传文件路径。');
  process.exit(2);
} else {
  const filePath = third;
  if (!fs.existsSync(filePath)) { console.error('文件不存在:', filePath); process.exit(2); }
  message = fs.readFileSync(filePath, 'utf8');
  if (!message.trim()) { console.error('文件为空:', filePath); process.exit(2); }
}

const body = JSON.stringify({ relayId, channel, message });
const t0 = Date.now();
try {
  // 🔴 fetch 必须带 timeout: 无界等待与"正在工作"在读数上完全相同。
  //    本仓已有实例(2026-07-14 legacyRefundBuilderTick 自锁, 夜间 285 次冻结),
  //    而 2026-08-10 我自己刚被同一形状咬过: 一个图形密码框在无人会话里没人点,
  //    ssh 就那么等满 90 秒 —— 它没报错, 它在等人。
  const res = await fetch(`${CONSOLE}/api/chat/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    signal: AbortSignal.timeout(15000),
    body,
  });
  const j = await res.json();
  const elapsed = Date.now() - t0;
  if (j.ok) {
    console.log(JSON.stringify({ ok: true, txId: j.txId, fee: j.fee, elapsed_ms: elapsed, bytes: Buffer.byteLength(message, 'utf8') }));
    process.exit(0);
  } else {
    console.log(JSON.stringify({ ok: false, error: j.error, elapsed_ms: elapsed }));
    process.exit(3);
  }
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e.message, elapsed_ms: Date.now() - t0 }));
  process.exit(4);
}
