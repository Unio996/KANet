// 账本1857: 预测市场页面的"主网不收 KAS / 筹码"渲染测试。
// 渲染真模板 (reply.view, 同 index.js 的 @fastify/view 配置), 分两种模式:
//   noKasMode=true  (主网 / KANET_NO_KAS_STAKE_MODE=1): 可见文案里 KAS 只许出现在"不收/不花/不需要 KAS"否定句里;
//                    不得出现任何会 403 的路由字面量; 下注只调 register-v07; 含「我的押注」; 无 proto 入口 / 水龙头 / 外部钱包流。
//   noKasMode=false (其它网络): 老文案仍在 (保证"非主网输出逐字节不变"的方向性回归; 逐字节对照见交件报告里的 before/after 渲染 diff)。
import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { Eta } from 'eta';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI_ROOT = process.env.KANET_UI_ROOT || dirname(fileURLToPath(import.meta.url));
const ROUTES_403 = [/\/market\/create(?!-v07)/, /\/bettor\/register(?!-v07)[`'"]/, /\/bettor\/register-v06/, /\/bettor\/register-external/, /register-v07\/(prep|confirm)/, /\/oracle\/deposit/];

async function render(noKasMode, page, extra = {}) {
  const f = Fastify();
  await f.register((await import('@fastify/view')).default, { engine: { eta: new Eta() }, root: UI_ROOT, viewExt: 'eta', defaultContext: { appName: 'K', noKasMode }, options: { useWith: true } });
  f.get('/x', (q, r) => r.view(page, { lang: 'zh', t: (k) => k, dir: 'ltr', langs: {}, _page: page, relayNodes: [], marketId: 'MKT1', ...extra }));
  const res = await f.inject('/x');
  await f.close();
  assert.equal(res.statusCode, 200, res.payload.slice(0, 200));
  return res.payload;
}
const strip = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ');
const kasLeft = (html) => (strip(html).replace(/(不收|不花你的|不花|不需要) ?KAS/g, ' ').match(/.{0,8}KAS.{0,8}/g) || []);

for (const [page, label] of [['predictions-list', 'list'], ['predictions-pool-detail', 'detail'], ['predictions-pool-create', 'create']]) {
  test(`no-KAS mode: ${label} page has no KAS stake wording and no 403-route reference`, async () => {
    const html = await render(true, page);
    assert.deepEqual(kasLeft(html), [], `visible KAS wording left on ${page}`);
    for (const re of ROUTES_403) assert.ok(!re.test(html), `${page} still references a 403 route: ${re}`);
    assert.ok(html.includes('window.KANET_NO_KAS = true'));
    assert.ok(!html.includes('市场（原型）'), 'proto-v0 nav entry must be hidden');
    assert.ok(!html.includes('/faucet'), 'faucet link must be hidden');
    assert.ok(!html.includes('小范围邀请制'), 'testnet banner must not show on mainnet');
  });
}
test('no-KAS mode: detail bets via register-v07 with stake_ktt and has 我的押注 block, no external-wallet flow', async () => {
  const html = await render(true, 'predictions-pool-detail');
  assert.ok(html.includes('/bettor/register-v07`'));
  assert.ok(html.includes('stake_ktt'));
  assert.ok(html.includes('pmMyPositions('));
  assert.ok(!html.includes('extPrep'));
  assert.ok(!html.includes('主持人本金'));
});
test('no-KAS mode: list has 我的押注, hides create entry; create page shows 盘口由系统同步 notice only', async () => {
  const list = await render(true, 'predictions-list');
  assert.ok(list.includes('pmMyPositions('));
  assert.ok(!list.includes('href="/predictions/pool/create"'));
  const create = await render(true, 'predictions-pool-create');
  assert.ok(create.includes('盘口由系统同步'));
  assert.ok(!create.includes('maker_stake_kas'));
});
test('non-mainnet (noKasMode=false): legacy KAS UI untouched, no new block, no flag script', async () => {
  const list = await render(false, 'predictions-list');
  assert.ok(list.includes('去领 KAS') && list.includes('+ 发起预测') && !list.includes('pmMyPositions') && !list.includes('KANET_NO_KAS'));
  const detail = await render(false, 'predictions-pool-detail');
  assert.ok(detail.includes('押多少 KAS') && detail.includes('/bettor/register`') && detail.includes('extPrep') && !detail.includes('pmMyPositions'));
  const create = await render(false, 'predictions-pool-create');
  assert.ok(create.includes('maker_stake_kas') && !create.includes('盘口由系统同步'));
});

// 账本1857 follow-up (Bettor review e668ce6b)
const markup = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
for (const page of ['predictions-list', 'predictions-pool-detail', 'predictions-pool-create']) {
  test('no-KAS mode: ' + page + ' markup has no testnet wording', async () => {
    const html = markup(await render(true, page));
    assert.deepEqual(html.match(/.{0,20}(testnet|测试网|kaspatest).{0,20}/gi) || [], []);
  });
}
test('no-KAS mode: sidebar links to /predictions and hides 我的市场; non-mainnet unchanged', async () => {
  const on = await render(true, 'predictions-list');
  assert.ok(on.includes('href="/predictions"') && markup(on).includes('看市场') && !on.includes('href="/my-markets"'));
  const off = await render(false, 'predictions-list');
  assert.ok(off.includes('href="/my-markets"') && !markup(off).includes('看市场'));
});
test('no-KAS mode: stake_ktt is built with BigInt (no float precision loss)', async () => {
  const html = await render(true, 'predictions-pool-detail');
  assert.ok(html.includes('BigInt(_n) * 100000000n'));
  assert.ok(!html.includes('Math.round(Number(this.bet.stakeKas)) * 100000000'));
});
test('no-KAS mode: my-positions block reads ZK-native fields (pending / landed / pool_known)', async () => {
  const html = await render(true, 'predictions-pool-detail');
  for (const k of ['zk_native', 'payout_pending_units', 'pool_known', '赢 · 待记账', '赢 · 金额待定']) assert.ok(html.includes(k), k);
});
test('no-KAS mode: detail hides TG box + UMA mapping badge, maps attested_v2, lights timeline, real sig count; non-mainnet keeps old', async () => {
  const on = await render(true, 'predictions-pool-detail');
  assert.ok(!on.includes('去 TG 押注 →') && !on.includes('立即押注'));
  assert.ok(!on.includes('x-text="mappingBadge().label"'));
  assert.ok(on.includes("attested_v2: this.zkExhausted() ? '已全部记账' : '已开奖'"));
  assert.ok(on.includes("attested_v2: 'completed'") && on.includes('sigCountReal()') && on.includes("startsWith('pending_')"));
  const off = await render(false, 'predictions-pool-detail');
  assert.ok(off.includes('去 TG 押注 →') && off.includes('x-text="mappingBadge().label"') && off.includes('已签人数') && !off.includes('zkExhausted') && !off.includes('sigCountReal'));
});
test('no-KAS mode: 链上进度 raw strings mapped, vote card hidden on ZK-native; non-mainnet keeps old', async () => {
  const on = await render(true, 'predictions-pool-detail');
  assert.ok(on.includes("' && !zkNative()'") === false && on.includes('!isSettled() && !zkNative()'));
  assert.ok(on.includes('return this.statusLabel();') && on.includes("bshard_close_sig_v2: '委员签名（收盘）'") && on.includes('已全部记账. 所有赢家的筹码已记在各自地址名下'));
  const off = await render(false, 'predictions-pool-detail');
  assert.ok(!off.includes('zkNative') && !off.includes('this.statusLabel();') && off.includes('return st;'));
});
test('no-KAS mode: wording says chips are RECORDED on-chain (not paid/arrived at an address); non-mainnet detail has none of the new words', async () => {
  for (const page of ['predictions-list', 'predictions-pool-detail']) {
    const on = await render(true, page);
    assert.ok(on.includes('已记账') && on.includes('待记账') && on.includes('记账中'), page);
    assert.ok(!/赢 · 到账|赢 · 待领|赢 · 待发放|筹码已到账|已领完/.test(on), page);
  }
  const off = await render(false, 'predictions-pool-detail');
  assert.ok(!off.includes('已记账') && !off.includes('已全部记账'));
});
test('no-KAS mode: cancelled market hint says no-bets (not refunded); non-mainnet unchanged', async () => {
  const on = await render(true, 'predictions-pool-detail');
  assert.ok(on.includes("this.cancelHint()") && on.includes('该市场无人下注，到期已取消。') && on.includes("md.cancel_reason === 'no_bets'"));
  const off = await render(false, 'predictions-pool-detail');
  assert.ok(!off.includes('cancelHint') && off.includes("return '已退款.'"));
});
test('no-KAS mode: verifying ZK market says 已截止·等开奖 (no oracle-vote wording); non-mainnet unchanged', async () => {
  const on = await render(true, 'predictions-pool-detail');
  assert.ok(on.includes("verifying: this.zkNative() ? '已截止 · 等开奖'") && on.includes("st === 'verifying' && this.zkNative()") && on.includes('已截止，等待开奖结果。'));
  const off = await render(false, 'predictions-pool-detail');
  assert.ok(!off.includes('已截止') && off.includes("verifying: '等仲裁人投票'"));
});
test('no-KAS mode: no-winners market copy (hint / badge / my-positions row); non-mainnet unchanged', async () => {
  const on = await render(true, 'predictions-pool-detail');
  assert.ok(on.includes('本场无人押中，市场已结束，没有派奖。') && on.includes('已结束 · 无人押中') && on.includes('metadata.no_winners === true') && on.includes('输 · 本场无人押中，没有派奖'));
  const off = await render(false, 'predictions-pool-detail');
  assert.ok(!off.includes('noWinners') && !off.includes('无人押中'));
});
test('no-KAS mode: completed no-winners market never shows 已全部记账 / settled-result card; neutral badge; non-mainnet unchanged', async () => {
  const on = await render(true, 'predictions-pool-detail');
  assert.ok(on.includes("isSettled() && !zkNative()") && on.includes("if (this.noWinners()) return 'bg-warm-200 text-ink-600'"));
  // noWinners() 判断先于 completed/已记账 相关分支: 状态标签与阶段提示里它都排在前面
  assert.ok(on.indexOf("if (this.noWinners()) return '已结束 · 无人押中'") < on.indexOf('completed: '));
  assert.ok(on.indexOf("if (this.noWinners()) return '本场无人押中") < on.indexOf("if (st === 'completed') return"));
  const off = await render(false, 'predictions-pool-detail');
  assert.ok(!off.includes('&& !zkNative()'));
});
