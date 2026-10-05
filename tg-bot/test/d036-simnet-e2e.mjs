// d036-simnet-e2e.mjs — D-036 电报主网预测市场接线的 simnet 真数据 e2e(不是单测): 真 bot.mjs handler 管线(bot.handleUpdate) + 真 console(simnet) + 假 Telegram 传输。
// 阶段(PHASE): ro = 只读冒烟(可对主网 console 跑, 只 GET); bet = 4 个市场的下注计划 + 触顶 429; notify = 收盘后跑开奖通知 poller + /mybets, 并按计划核对。
// 下注计划(m1..m4 按市场 id 里的毫秒时间戳升序; 约定 4 个盘都判 YES; ZK_BET_MAX_PER_PK_DAY=3):
//   m1: A YES 单笔(1 笔下注, 赢)         m2: A YES + B YES(单边赢, 多笔)
//   m3: A YES + B NO(普通: A 赢 B 输)    m4: B NO 单笔(全押输方 ⇒ 无人押中)
//   最后 A 再押 m4 ⇒ A 已用满 3 笔 ⇒ 服务端 429 bet_cap_pk_day ⇒ 礼貌文案 + 重置时间
// 用法(从 tg-bot/ 目录): SIM_URL=http://127.0.0.1:3298 ADDR_A=kaspasim:… ADDR_B=kaspasim:… E2E_DIR=<固定目录> PHASE=ro|bet|notify node test/d036-simnet-e2e.mjs
// 🔴 harness-only: simnet 地址前缀是 kaspasim:, 而 /link 在 KASPA_NETWORK=mainnet 下只收 kaspa: ⇒ 用 PM.setLinkedAddr 直接预置绑定(等价 /link 成功后的状态)。
// 🔴 bet 阶段会在 simnet 上真下注(网关代付), 只许对 simnet console 跑。
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SIM = process.env.SIM_URL; const ADDR_A = process.env.ADDR_A; const ADDR_B = process.env.ADDR_B; const PHASE = process.env.PHASE || 'bet';
if (!SIM || !ADDR_A || !ADDR_B || !/127\.0\.0\.1|localhost/.test(SIM)) { console.error('need SIM_URL (localhost), ADDR_A, ADDR_B'); process.exit(2); }
const dir = process.env.E2E_DIR || mkdtempSync(join(tmpdir(), 'd036-e2e-'));
mkdirSync(dir, { recursive: true });
process.env.TELEGRAM_BOT_TOKEN = '123456:FAKE-e2e'; process.env.TELEGRAM_BOT_USERNAME = 'KANET_Broker_bot';
process.env.KASPA_NETWORK = 'mainnet'; process.env.CONSOLE_URL = SIM; process.env.INGEST_SECRET = process.env.INGEST_SECRET || 'e2e-dummy';
process.env.TG_BOT_STATE_FILE = join(dir, '_state.json'); process.env.TG_BOT_BET_CAP_FILE = join(dir, '_bet_cap.json');
process.env.TG_BET_MAX_PER_USER_DAY = process.env.TG_BET_MAX_PER_USER_DAY || '5';
console.log('state dir', dir);

const botmod = await import('../bot.mjs');
const { bot } = botmod;
const PM = await import('../prediction-menu.mjs');
const sent = [];   // {chat, text, kb}
const transcript = [];
bot.api.config.use(async (_prev, method, payload) => {
  if (method === 'sendMessage') { sent.push({ chat: String(payload.chat_id), text: payload.text, kb: payload.reply_markup }); return { ok: true, result: { message_id: sent.length, date: 0, chat: { id: payload.chat_id, type: 'private' }, text: payload.text } }; }
  return { ok: true, result: true };
});
bot.botInfo = { id: 1, is_bot: true, first_name: 'KANet', username: 'KANET_Broker_bot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false };

let uid = 0;
const U = { A: 1001, B: 1002 };
const NAME = { 1001: 'A', 1002: 'B' };
const msgUpdate = (from, text) => ({ update_id: ++uid, message: { message_id: uid, date: 0, chat: { id: from, type: 'private' }, from: { id: from, is_bot: false, first_name: 'u' + from, language_code: 'zh' }, text, ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] } : {}) } });
const cbUpdate = (from, data) => ({ update_id: ++uid, callback_query: { id: String(uid), from: { id: from, is_bot: false, first_name: 'u' + from, language_code: 'zh' }, chat_instance: 'x', data, message: { message_id: 1, date: 0, chat: { id: from, type: 'private' }, text: 'x' } } });
const log = (who, kind, input, out) => { transcript.push(`[${who}] ${kind} ${input}`); for (const m of out) transcript.push(`    ← ${m.text.replace(/\n/g, '\n      ')}`); };
async function say(from, text) { const n = sent.length; await bot.handleUpdate(msgUpdate(from, text)); const o = sent.slice(n); log(NAME[from], 'SAY', text, o); return o; }
async function tap(from, data) { const n = sent.length; await bot.handleUpdate(cbUpdate(from, data)); const o = sent.slice(n); log(NAME[from], 'TAP', data, o); return o; }
let pass = 0, fail = 0;
const check = (name, cond, detail) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail ? ` (${String(detail).slice(0, 400)})` : ''}`); fail++; } };
const betBtns = (msgs) => msgs.flatMap((m) => (m.kb?.inline_keyboard || []).flat());
const msOf = (id) => Number((id.match(/-(\d{10,})-/) || [])[1] || 0);
const save = (name) => writeFileSync(join(dir, name), transcript.join('\n') + '\n');
PM.setLinkedAddr(String(U.A), ADDR_A); PM.setLinkedAddr(String(U.B), ADDR_B);   // harness-only
const planFile = join(dir, 'plan.json');

async function placeBet(who, mid, dir01, chips) {
  await tap(U[who], `pm:b:${mid}:${dir01}`);
  return say(U[who], String(chips));
}
const ok = (o) => o.some((m) => /押注成功/.test(m.text));

if (PHASE === 'ro') {
  let r = await say(U.A, '/bet');
  const lb = betBtns(r).filter((b) => b.callback_data?.startsWith('pm:m:'));
  check('/bet 列出可押盘', lb.length >= 1);
  if (lb.length) { r = await tap(U.A, lb[0].callback_data); check('详情有 YES/NO 按钮', betBtns(r).length === 2); }
  await say(U.A, '/mybets');
}

if (PHASE === 'bet') {
  let r = await say(U.A, '/bet');
  const ids = betBtns(r).filter((b) => b.callback_data?.startsWith('pm:m:')).map((b) => b.callback_data.slice(5)).sort((a, b) => msOf(a) - msOf(b));
  check('/bet 列出 4 个可押盘', ids.length === 4, ids.join(','));
  if (ids.length < 4) { save('transcript-bet.txt'); process.exitCode = 1; throw new Error('need 4 open markets'); }
  const [m1, m2, m3, m4] = ids;
  writeFileSync(planFile, JSON.stringify({ m1, m2, m3, m4 }, null, 1));
  console.log('    plan:', JSON.stringify({ m1, m2, m3, m4 }));
  r = await tap(U.A, `pm:m:${m1}`);
  check('详情页有 YES/NO 押注按钮', betBtns(r).length === 2);
  check('m1 A YES 1 筹码 成功', ok(await placeBet('A', m1, 0, 1)));
  check('m2 A YES 2 筹码 成功', ok(await placeBet('A', m2, 0, 2)));
  check('m2 B YES 3 筹码 成功', ok(await placeBet('B', m2, 0, 3)));
  check('m3 A YES 2 筹码 成功', ok(await placeBet('A', m3, 0, 2)));
  check('m3 B NO 4 筹码 成功', ok(await placeBet('B', m3, 1, 4)));
  check('m4 B NO 2 筹码 成功(全押输方 ⇒ 无人押中)', ok(await placeBet('B', m4, 1, 2)));
  // 触顶: A 第 4 笔 ⇒ 服务端 429
  await tap(U.A, `pm:b:${m4}:0`);
  const hit = await say(U.A, '1');
  check('A 第 4 笔触服务端每日上限 ⇒ 礼貌文案 + 重置时间, 且没花东西', hit.some((m) => /明天再来/.test(m.text) && /UTC/.test(m.text) && /没有花任何东西/.test(m.text)), hit.map((m) => m.text));
  for (const w of ['A', 'B']) { const o = await say(U[w], '/mybets'); check(`${w} /mybets 列出押注中`, o.some((m) => /押注中|等开奖/.test(m.text)), o.map((m) => m.text)); }
  const n0 = sent.length; await botmod.pollSettleResultsMainnet();
  check('通知 poller 首轮只播种, 不发消息', sent.length === n0);
  save('transcript-bet.txt');
}

if (PHASE === 'notify') {
  const plan = JSON.parse(readFileSync(planFile, 'utf8'));
  const n0 = sent.length; await botmod.pollSettleResultsMainnet();
  const got = sent.slice(n0); got.forEach((m) => { transcript.push(`[poller → ${m.chat === String(U.A) ? 'A' : 'B'}] ${m.text.replace(/\n/g, '\n      ')}`); console.log(`    [通知→${m.chat === String(U.A) ? 'A' : 'B'}] ${m.text.replace(/\n/g, ' ⏎ ')}`); });
  const toA = got.filter((m) => m.chat === String(U.A)).map((m) => m.text), toB = got.filter((m) => m.chat === String(U.B)).map((m) => m.text);
  const noWin = (xs) => xs.filter((x) => /本场无人押中，市场已结束，没有派奖/.test(x));
  const winN = (xs) => xs.filter((x) => /你押的 .* 赢了/.test(x)), loseN = (xs) => xs.filter((x) => /这次没赢/.test(x));
  const paidN = (xs) => xs.filter((x) => /已记账/.test(x));
  check('A: 3 盘赢 ⇒ 3 条"赢了"通知, 无输/无人押中通知', winN(toA).length === 3 && loseN(toA).length === 0 && noWin(toA).length === 0, toA.join(' | '));
  check('B: m2 赢 / m3 输 / m4 无人押中 ⇒ 1 赢 + 1 普通输 + 1 无人押中', winN(toB).length === 1 && loseN(toB).length === 1 && noWin(toB).length === 1, toB.join(' | '));
  check('已到账的盘各有一条"已记账"通知(赢家)', paidN(toA).length >= 1 || paidN(toB).length >= 1);
  const n1 = sent.length; await botmod.pollSettleResultsMainnet();
  check('再轮询: 不重复通知', sent.length === n1);
  for (const w of ['A', 'B']) {
    const o = await say(U[w], '/mybets'); const txt = o.map((m) => m.text).join('\n');
    console.log(`    [${w} /mybets]\n${txt.split('\n').map((l) => '      ' + l).join('\n')}`);
    if (w === 'A') check('A /mybets: 3 盘均"已记账"赢, 无"输"', (txt.match(/已记账/g) || []).length === 3 && !/ 输/.test(txt), txt);
    if (w === 'B') check('B /mybets: 含 赢(已记账) / 输 / 输（本场无人押中，没有派奖）', /已记账/.test(txt) && /· 输（本场无人押中，没有派奖）/.test(txt) && /· 输\s*$/m.test(txt), txt);
  }
  // m4 不再可押: 点进去应说明白(无人押中 → 终态 completed 的盘不是"无人下注取消")
  const d = await tap(U.B, `pm:m:${plan.m4}`);
  check('m4 详情: 不是"没找到", 是"不再收押注"', d.some((m) => /不收押注|不再收押注/.test(m.text)), d.map((m) => m.text));
  save('transcript-notify.txt');
}
console.log(`\nd036 e2e [${PHASE}]: ${pass} pass / ${fail} fail`);
process.exitCode = fail ? 1 : 0;
