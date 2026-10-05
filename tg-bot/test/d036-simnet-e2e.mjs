// d036-simnet-e2e.mjs — D-036 电报主网预测市场接线的 simnet 真数据 e2e(不是单测): 真 bot.mjs handler 管线(bot.handleUpdate) + 真 console(simnet) + 假 Telegram 传输。
// 流程(分阶段, 由 PHASE 选): bet = 列表→2 个用户各押→(服务端上限)429; notify = 开奖后跑开奖通知 poller + /mybets。
// 用法(从 tg-bot/ 目录, NODE_PATH 指向有 grammy 的 node_modules):
//   SIM_URL=http://127.0.0.1:3298 ADDR_A=kaspasim:… ADDR_B=kaspasim:… PHASE=bet|notify node test/d036-simnet-e2e.mjs
// 🔴 harness-only: simnet 地址前缀是 kaspasim:, 而 /link 在 KASPA_NETWORK=mainnet 下只收 kaspa: ⇒ 这里用 PM.setLinkedAddr 直接预置绑定(等价于 /link 成功后的状态)。
// 🔴 会在 simnet 上真下注(网关代付), 只许对 simnet console 跑。
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SIM = process.env.SIM_URL; const ADDR_A = process.env.ADDR_A; const ADDR_B = process.env.ADDR_B; const PHASE = process.env.PHASE || 'bet';
if (!SIM || !ADDR_A || !ADDR_B || !/127\.0\.0\.1|localhost/.test(SIM)) { console.error('need SIM_URL (localhost), ADDR_A, ADDR_B'); process.exit(2); }
const dir = process.env.E2E_DIR || mkdtempSync(join(tmpdir(), 'd036-e2e-'));
process.env.TELEGRAM_BOT_TOKEN = '123456:FAKE-e2e'; process.env.TELEGRAM_BOT_USERNAME = 'KANET_Broker_bot';
process.env.KASPA_NETWORK = 'mainnet'; process.env.CONSOLE_URL = SIM; process.env.INGEST_SECRET = process.env.INGEST_SECRET || 'e2e-dummy';
process.env.TG_BOT_STATE_FILE = join(dir, '_state.json'); process.env.TG_BOT_BET_CAP_FILE = join(dir, '_bet_cap.json');
process.env.TG_BET_MAX_PER_USER_DAY = process.env.TG_BET_MAX_PER_USER_DAY || '5';
console.log('state dir', dir);

const botmod = await import('../bot.mjs');
const { bot } = botmod;
const PM = await import('../prediction-menu.mjs');
const sent = [];   // {chat, text, kb}
bot.api.config.use(async (_prev, method, payload) => {
  if (method === 'sendMessage') { sent.push({ chat: String(payload.chat_id), text: payload.text, kb: payload.reply_markup }); return { ok: true, result: { message_id: sent.length, date: 0, chat: { id: payload.chat_id, type: 'private' }, text: payload.text } }; }
  if (method === 'editMessageText' || method === 'answerCallbackQuery') return { ok: true, result: true };
  return { ok: true, result: true };
});
bot.botInfo = { id: 1, is_bot: true, first_name: 'KANet', username: 'KANET_Broker_bot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false, can_join_groups: true };

let uid = 0;
const U = { A: 1001, B: 1002 };
const msgUpdate = (from, text) => ({ update_id: ++uid, message: { message_id: uid, date: 0, chat: { id: from, type: 'private' }, from: { id: from, is_bot: false, first_name: 'u' + from, language_code: 'zh' }, text, ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] } : {}) } });
const cbUpdate = (from, data) => ({ update_id: ++uid, callback_query: { id: String(uid), from: { id: from, is_bot: false, first_name: 'u' + from, language_code: 'zh' }, chat_instance: 'x', data, message: { message_id: 1, date: 0, chat: { id: from, type: 'private' }, text: 'x' } } });
async function say(from, text) { const n = sent.length; await bot.handleUpdate(msgUpdate(from, text)); return sent.slice(n); }
async function tap(from, data) { const n = sent.length; await bot.handleUpdate(cbUpdate(from, data)); return sent.slice(n); }
let pass = 0, fail = 0;
const check = (name, cond, detail) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail ? ` (${String(detail).slice(0, 300)})` : ''}`); fail++; } };
const show = (label, msgs) => { for (const m of msgs) console.log(`    [${label}] ${m.text.replace(/\n/g, ' ⏎ ').slice(0, 220)}`); };

PM.setLinkedAddr(String(U.A), ADDR_A); PM.setLinkedAddr(String(U.B), ADDR_B);   // harness-only: 等价 /link 成功后的状态
const betBtns = (msgs) => msgs.flatMap((m) => (m.kb?.inline_keyboard || []).flat());

if (PHASE === 'ro') {   // 只读冒烟(可对真主网 console 跑: 只 GET, 不下注): 列表 + 详情 + /mybets
  let r = await say(U.A, '/bet'); show('A /bet', r);
  const lb = betBtns(r).filter((b) => b.callback_data?.startsWith('pm:m:'));
  check('/bet 列出可押盘', lb.length >= 1);
  if (lb.length) { r = await tap(U.A, lb[0].callback_data); show('A 详情', r); check('详情有 YES/NO 按钮', betBtns(r).length === 2); }
  r = await say(U.A, '/mybets'); show('A /mybets', r);
}

if (PHASE === 'bet') {
  let r = await say(U.A, '/bet'); show('A /bet', r);
  const listBtns = betBtns(r).filter((b) => b.callback_data?.startsWith('pm:m:'));
  check('/bet 列出 ≥1 个可押盘(来自 pool 路由)', listBtns.length >= 1, JSON.stringify(r.map((x) => x.text)));
  const mid = listBtns[0].callback_data.slice('pm:m:'.length);
  console.log('    market under test:', mid);
  r = await tap(U.A, `pm:m:${mid}`); show('A 详情', r);
  const yn = betBtns(r).map((b) => b.callback_data);
  check('详情页有 YES/NO 押注按钮', yn.includes(`pm:b:${mid}:0`) && yn.includes(`pm:b:${mid}:1`), yn.join(','));
  // A 押 YES 2 筹码
  r = await tap(U.A, `pm:b:${mid}:0`); show('A 点YES', r);
  r = await say(U.A, '2'); show('A 回2', r);
  check('A 押注成功(真 register-v07, 网关代付)', r.some((m) => /押注成功/.test(m.text)), r.map((m) => m.text));
  // B 押 NO 3 筹码
  r = await tap(U.B, `pm:b:${mid}:1`); show('B 点NO', r);
  r = await say(U.B, '3'); show('B 回3', r);
  check('B 押注成功', r.some((m) => /押注成功/.test(m.text)), r.map((m) => m.text));
  // 我的押注(押注中)
  r = await say(U.A, '/mybets'); show('A /mybets', r);
  check('A /mybets 列出本盘, 2 筹码, 押注中', r.some((m) => m.text.includes('2 筹码') && /押注中|等开奖/.test(m.text)), r.map((m) => m.text));
  // 开奖通知 poller 第 1 轮: 只播种, 不发
  const n0 = sent.length; await botmod.pollSettleResultsMainnet();
  check('通知 poller 首轮只播种, 不发消息', sent.length === n0);
  // 触顶: 继续押同一盘直到服务端 429(需 console 配 ZK_BET_MAX_PER_PK_DAY, 默认 5; harness 设 2 更快)
  let hit = null;
  for (let i = 0; i < 6 && !hit; i++) {
    await tap(U.A, `pm:b:${mid}:0`); const rr = await say(U.A, '1'); show(`A 追加#${i + 1}`, rr);
    if (rr.some((m) => /名额已满|上限/.test(m.text))) hit = rr;
  }
  check('触顶后礼貌拒绝("明天再来")且带重置时间', !!hit && hit.some((m) => /明天再来/.test(m.text) && /UTC/.test(m.text)), hit && hit.map((m) => m.text));
  console.log(JSON.stringify({ phase: 'bet', market: mid, dir: dir }));
}

if (PHASE === 'notify') {
  // 需要上一阶段的 E2E_DIR(同一份 state, 里面有 __seeded__ 标记)
  let r;
  const n0 = sent.length; await botmod.pollSettleResultsMainnet();
  const got = sent.slice(n0); got.forEach((m) => console.log(`    [通知→${m.chat}] ${m.text.replace(/\n/g, ' ⏎ ')}`));
  check('开奖后 A 收到 赢/输 通知(按盘去重)', got.some((m) => m.chat === String(U.A) && /已开奖/.test(m.text)));
  check('开奖后 B 收到 赢/输 通知', got.some((m) => m.chat === String(U.B) && /已开奖/.test(m.text)));
  const n1 = sent.length; await botmod.pollSettleResultsMainnet();
  check('再轮询一次: 不重复通知(同一盘 result/paid 已见)', sent.length === n1);
  for (const [name, id] of Object.entries(U)) { r = await say(id, '/mybets'); show(`${name} /mybets`, r); }
}
console.log(`\nd036 e2e [${PHASE}]: ${pass} pass / ${fail} fail`);
process.exitCode = fail ? 1 : 0;
