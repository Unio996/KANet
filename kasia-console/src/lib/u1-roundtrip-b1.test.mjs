// round-trip 四件套 · **B-1 决定性格**(判据 `3b395e6c` §4)
//
// 判据原文要求: **变异真实 `unlockBshardRefund` 调用点**传错 start(helper 不动) ⇒ 至少一个指定测试
// **必须因正确原因变红**。可用 hermetic/mock RPC, 但必须**执行真实生产码**走完 continuation 构造
// 并**在 submit 前观察产物**。一票否决线: 只 grep 调用点、或再直调 helper ⇒ 不满足。
//
// 🔵 **本用例怎么做到"不是包壳"**: `connectRpc` 定义在 `p2sh.mjs:94` 内部(不可注入), 但它 `new RpcClient(...)`
//    用的是文件顶部 `import * as kaspa from 'kaspa-wasm'` 那个模块 ⇒ 用 **ESM loader 钩子**把 `kaspa-wasm`
//    换成「真模块 + 只替换 RpcClient」。**p2sh.mjs 一行未改**, 跑的就是生产码。
// 🔵 **观察点**: 假 RPC 的 `submitTransaction` **不广播**, 只截获 tx ⇒ 从 `outputs[pool_out_idx]` 读出
//    continuation 的 scriptPubKey ⇒ 与描述符推导的期望地址逐字节比。
// ⚠ 全程零广播、零真实密钥(一次性 privkey)、不连链。
import { readFileSync } from 'node:fs';
import assert from 'node:assert';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.KANET_ROOT || join(HERE, '..', '..', '..');
const RELAY_LIB = join(ROOT, 'kasia-relay', 'src', 'lib', 'p2sh.mjs');
const KASPA_JS = join(ROOT, 'kasia-relay', 'node_modules', 'kaspa-wasm', 'kaspa.js');
const HOOKS = join(HERE, 'u1-roundtrip-b1.hooks.mjs');

let captured = null;
globalThis.__FAKE_TXID_QUEUE__ = [];
globalThis.__FAKE_RPC_CLASS__ = class FakeRpcClient {
  async connect() { return true; }
  async disconnect() { return true; }
  // 按调用顺序发 UTXO（生产码先查 pool 再查 ticket，顺序确定）——
  // 这样 harness 不必自己算 P2SH 地址（`_addressFromRedeem` 未导出），生产码算出什么都接得住。
  async getUtxosByAddresses(addrs) {
    const addr = Array.isArray(addrs) ? addrs[0] : addrs;
    const txid = globalThis.__FAKE_TXID_QUEUE__.shift();
    if (!txid) return { entries: [] };
    return { entries: [{
      address: addr,
      outpoint: { transactionId: txid, index: 0 },
      amount: 10_000_000_000n,
      scriptPublicKey: globalThis.__SPK_FOR__(addr),
      blockDaaScore: 1n, isCoinbase: false,
    }] };
  }
  async submitTransaction({ transaction }) { captured = transaction; return { transactionId: 'FAKE_NOT_BROADCAST' }; }
};
register(pathToFileURL(HOOKS).href);
process.env.KASPA_RPC_URL = 'ws://127.0.0.1:59999';   // 假地址：真 RpcClient 会连不上；用得上说明是假的

const kaspa = await import(pathToFileURL(KASPA_JS).href);
const p2sh = await import(pathToFileURL(RELAY_LIB).href);
globalThis.__SPK_FOR__ = (a) => kaspa.payToAddressScript(new kaspa.Address(String(a)));

let pass = 0; let fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass += 1; console.log(`[PASS] ${name}`); }
  catch (e) { fail += 1; console.log(`[FAIL] ${name} — ${e.message}`); }
};

// 字段序逐字抄生产 `_serializeRootStateHex`，不是我编的
const STATE = { local_yes: '11', local_no: '22', count: '3', pool_value: '444', closed: '0', winningSide: '0', payoutRoot: 'ab'.repeat(32) };
const stateHex = p2sh._serializeRootStateHex(STATE);
// ⚠ 前缀是**合成 fixture 的**，不冒充生产模板字节（生产实测首字节是 0x6b，见
//    `scripts/tn12-redeem-prefix-census.cjs`）。本用例测的是**传播与断言**，不是模板身份识别，
//    所以这里只需要"一个长度为 1 的前缀"，且**长度由它自己派生**而不是写死。
const POOL_PREFIX_HEX = '51';
const POOL_REDEEM = POOL_PREFIX_HEX + stateHex + 'ff'.repeat(8);
const TICKET_REDEEM = '51' + stateHex + 'ee'.repeat(8);
const priv = new kaspa.PrivateKey('11'.repeat(32));
const ADDR = priv.toKeypair().toAddress(kaspa.NetworkType.Testnet).toString();
const NET = 'testnet-12';

async function runRefundAndCaptureContinuationSpk() {
  captured = null;
  globalThis.__FAKE_TXID_QUEUE__ = ['aa'.repeat(32), 'bb'.repeat(32)];
  const cmd = {
    // post-Fix: 命令必须携带 state_start。这里**照 builder 的方式派生**（模板前缀长度），
    // 而不是写一个字面量 —— 用例若自己写死 1，就又变成"夹具与实现共享同一个发明"。
    inputs: { pool: { redeem_hex: POOL_REDEEM, outpointTxid: 'aa'.repeat(32), state_start: POOL_PREFIX_HEX.length / 2 },
      ticket: { redeem_hex: TICKET_REDEEM, outpointTxid: 'bb'.repeat(32) } },
    outputs: { payout: { amountSompi: '500000000', address: ADDR },
      pool_continuation: { amountSompi: '500000000', state: STATE },
      change_address: ADDR },
    witness: { pool_out_idx: 0, payout_out_idx: 1, ticket_in_idx: 1, ticket_prefix_len: 0, ticket_suffix_len: 0 },
  };
  await p2sh.unlockBshardRefund({ wallet: { getPrivateKey: () => priv, getNetworkId: () => NET }, cmd, networkId: NET });
  assert.ok(captured, '假 RPC 没截获到 tx —— 生产码没走到 submit');
  return String(captured.outputs[cmd.witness.pool_out_idx].scriptPublicKey?.script
    ?? captured.outputs[cmd.witness.pool_out_idx].scriptPublicKey);
}
const spkOfAddress = (addr) => String(kaspa.payToAddressScript(new kaspa.Address(addr)).script
  ?? kaspa.payToAddressScript(new kaspa.Address(addr)));

await t('前置 · 未改动的生产码在 hermetic RPC 下跑到 submit 并被截获（证明不是包壳）', async () => {
  const spk = await runRefundAndCaptureContinuationSpk();
  assert.ok(spk && spk.length > 10, `没读到 continuation scriptPubKey: ${spk}`);
});

// 🔴 **决定性断言**：生产路径产出的 continuation 必须等于【描述符推导的期望】(多-entry ⇒ start=1)。
//    调用点若被变异成传错 start（如 0），这一格必红 —— 这正是 B-1 要证的"有人在观察那个调用点"。
await t('B-1 · 生产路径的 continuation == 描述符期望(start=1) ⇒ 调用点传错 start 必红', async () => {
  const got = await runRefundAndCaptureContinuationSpk();
  const wantAddr = p2sh._continuationAddress(POOL_REDEEM, stateHex, NET, 1);
  assert.strictEqual(got, spkOfAddress(wantAddr),
    '生产路径算出的 continuation 与 start=1 的期望不符 ⇒ 要么调用点传了别的 start, 要么 splice 口径变了');
});

// 对照臂：start=0 必须产出【不同】的 spk —— 否则上面那格对 start 是瞎的（坏时输出=已知答案）
await t('B-1 对照臂 · start=0 的期望与 start=1 【不同】(否则决定性断言对该参数不敏感)', async () => {
  const at1 = spkOfAddress(p2sh._continuationAddress(POOL_REDEEM, stateHex, NET, 1));
  const at0 = spkOfAddress(p2sh._continuationAddress(POOL_REDEEM, stateHex, NET, 0));
  assert.notStrictEqual(at1, at0, 'start=1 与 0 产出同一个 spk ⇒ 本用例无法察觉调用点传错 start');
});

// ── post-Fix 两道 fail-closed 闸（Codex Fix ④ + Bettor 18:18Z typed 绑定） ──────
const cmdWithPool = (poolExtra) => ({
  inputs: { pool: { redeem_hex: POOL_REDEEM, outpointTxid: 'aa'.repeat(32), ...poolExtra },
    ticket: { redeem_hex: TICKET_REDEEM, outpointTxid: 'bb'.repeat(32) } },
  outputs: { payout: { amountSompi: '500000000', address: ADDR },
    pool_continuation: { amountSompi: '500000000', state: STATE }, change_address: ADDR },
  witness: { pool_out_idx: 0, payout_out_idx: 1, ticket_in_idx: 1, ticket_prefix_len: 0, ticket_suffix_len: 0 },
});
const runWith = (cmd) => p2sh.unlockBshardRefund({
  wallet: { getPrivateKey: () => priv, getNetworkId: () => NET }, cmd, networkId: NET,
});

await t('Fix④ · 缺 state_start ⇒ 生产码【抛】且未走到 submit（不静默回落默认）', async () => {
  captured = null;
  globalThis.__FAKE_TXID_QUEUE__ = ['aa'.repeat(32), 'bb'.repeat(32)];
  await assert.rejects(() => runWith(cmdWithPool({})), /state_start 缺失/, '缺失竟未抛 ⇒ 回落默认那条路还在');
  assert.strictEqual(captured, null, '抛之前不该已经走到 submit');
});

await t('Fix④-bis · 显式传 null 也必须抛（=== undefined 会被它穿透, splice 把 null 当 0）', async () => {
  captured = null;
  globalThis.__FAKE_TXID_QUEUE__ = ['aa'.repeat(32), 'bb'.repeat(32)];
  await assert.rejects(() => runWith(cmdWithPool({ state_start: null })), /state_start 缺失/,
    'null 穿透 ⇒ 正是这道闸要防的失败从闸底下走过去（@J1tn 19:09Z 抓）');
});

await t('Fix⑤ · state_start 与本 typed 路径的族不符 ⇒ 抛', async () => {
  captured = null;
  globalThis.__FAKE_TXID_QUEUE__ = ['aa'.repeat(32), 'bb'.repeat(32)];
  await assert.rejects(() => runWith(cmdWithPool({ state_start: 0 })), /不符/,
    '不符的 offset 被放行 ⇒ 错 offset = 语法合法但资金锁死的 continuation');
});

// ── 权威产生步（builder 侧）—— Codex ⑦ 要的决定性变异打的就是这里 ────────────────
// 🔴 没有这两格，针对"权威怎么来的"那几行的变异就【无人观察】。
const { buildRefundCommand } = await import('./pool-refund-builder.mjs');
// CP4 §4 (2026-08-13): 锚不再是自由参数, 而是 builder 自持 resolver 从 pool_markets.root_tmpl_hash 查。
// 🔵 本文件是 post-Fix B-1 回归(判据⑦), 只需证 builder 端到端走 resolver ⇒ 用**轻量 fake db**(DI 只测试),
//    resolver 的**逻辑**(NULL/缺锚/hex 校验)照样真跑, 只把存储换掉。真 sqlite 的 write-once DB 层证据在
//    pool-market-anchor-cp4.test.mjs(判据⑥, 那里必须真库), 本文件不再引 better-sqlite3(不扩 M0a 面)。
// 🔴 真 PoolRoot 编译制品(非合成) —— Codex (200) 要件。字节来自真编 PoolRoot.sil, 首字节 0x6b 与链上普查一致。
const PINNED = JSON.parse(readFileSync(new URL('./fixtures/poolroot-artifact.pinned.json', import.meta.url), 'utf8'));
const ANCHOR_TABLE = { 'mkt-ok': PINNED.rootTmplHashHex, 'mkt-wrong': 'ab'.repeat(32), 'mkt-null': null };
// getMarketRootAnchor 只发一种查询(SELECT root_tmpl_hash AS anchor WHERE id=?) ⇒ fake 按 marketId 返回对应行形状。
const ANCHOR_DB = { prepare: () => ({ get: (id) => (id in ANCHOR_TABLE ? { anchor: ANCHOR_TABLE[id] } : undefined) }) };
const refundArgs = (over = {}) => ({
  witness: { poolOutIdx: 0, payoutOutIdx: 1, ticketInIdx: 1, ticket_prefix_len: 0, ticket_suffix_len: 0,
    ticket_prefix: Buffer.alloc(0), ticket_suffix: Buffer.alloc(0), bettorPk: 'aa'.repeat(32), stake: 100n },
  poolOutpointTxid: 'aa'.repeat(32), poolRedeemHex: PINNED.scriptHex,
    // ⚠ script 必须是**普通数组**——真 compileSil 出的就是数组, 传 Buffer 会被 Array.isArray 守卫拦下(我先踩了一次)
  poolRootArtifact: { script: [...Buffer.from(PINNED.scriptHex, 'hex')], state_layout: PINNED.state_layout },
  db: ANCHOR_DB, marketId: 'mkt-ok',
  currentPoolState: STATE, ticketOutpointTxid: 'bb'.repeat(32), ticketRedeemHex: TICKET_REDEEM,
  ticketState: { bettorPk: 'aa'.repeat(32), direction: 1, stake: 100n, shardPoolId: 1 },
  poolValueSompi: 1000n, bettorAddress: ADDR, poolContinuationState: { ...STATE, closed: 2 },
  changeAddress: ADDR, ...over,
});

await t('权威步 · state_start 取自【编译器吐出的 state_layout.start】(零跳, 非前缀反推)', () => {
  const cmd = buildRefundCommand(refundArgs());
  assert.strictEqual(cmd.inputs.pool.state_start, PINNED.state_layout.start,
    'builder 写进命令的值必须等于编译器给的 state_layout.start —— 那才是权威');
});

await t('§4 身份 · 库锚(marketId)对不上这份 redeem ⇒ builder 拒(跨边界比对是这一步的全部意义)', () => {
  assert.throws(() => buildRefundCommand(refundArgs({ marketId: 'mkt-wrong' })),
    /模板认证失败/, '库里存的锚不属于这份 redeem 也能过 ⇒ 认证退化成走过场');
});

await t('§4 身份 · 老市场 root_tmpl_hash NULL ⇒ builder fail-closed(不默认不回落)', () => {
  assert.throws(() => buildRefundCommand(refundArgs({ marketId: 'mkt-null' })),
    /NULL|fail-closed/, 'NULL 锚被放行 = 未绑锚的老市场也能退款 ⇒ §4 形同虚设');
});

await t('§4 身份 · marketId 查不到 ⇒ builder fail-closed', () => {
  assert.throws(() => buildRefundCommand(refundArgs({ marketId: 'nope' })),
    /不存在|fail-closed/, '查不到的 marketId 被放行 ⇒ 锚可绕过');
});

await t('§4 身份 · suffix 段被改 ⇒ builder 拒(原方案只绑前缀+总长, 这一格是 J1 (205) 补的)', () => {
  const tampered = Buffer.from(PINNED.scriptHex, 'hex');
  tampered[tampered.length - 1] ^= 0xff;   // 只动最后一字节 = suffix 段
  assert.throws(() => buildRefundCommand(refundArgs({ poolRedeemHex: tampered.toString('hex') })),
    /模板认证失败/, 'suffix 异的 redeem 若能过, 就要靠远处的 UTXO 匹配才报错');
});

// 🔴 Codex 66d5f287 点名的第一条闭合变异 / @J1tn (211)(212) 抓我【设计里写了没落】的那格:
//    喂【票腿】制品必须被拒。我在 §6 设计里点名要这格, 然后没落 —— 同一个病(写下结论没贯彻)。
const PS_PINNED = JSON.parse(readFileSync(new URL('./fixtures/poolside-artifact.pinned.json', import.meta.url), 'utf8'));

await t('换票腿① · 票腿 psArtifact(prefix/suffix 形状, 无 script) ⇒ 拒', () => {
  assert.throws(() => buildRefundCommand(refundArgs({ poolRootArtifact: { templatePrefix: Buffer.alloc(1), templateSuffix: Buffer.alloc(1), templateHashHex: 'ab'.repeat(32) } })), /required/);
});

await t('换票腿② · 真 PoolSide 编译制品 + 池腿 redeem ⇒ 拒(长度就对不上: 票腿 96B vs 池腿 2315B)', () => {
  assert.throws(() => buildRefundCommand(refundArgs({
    poolRootArtifact: { script: [...Buffer.from(PS_PINNED.scriptHex, 'hex')], state_layout: PS_PINNED.state_layout },
  })), /长度/);
});

await t('换票腿③ · 【自洽的票腿整套】(票制品+票 redeem) 仍必须被池腿烤死 hash 拒', () => {
  // 这一格才是承重的: ①②靠形状/长度就拦下了, 而③里票腿自己内部完全自洽 ——
  // 拦住它的只能是【池腿那个烤死锚】。锚要是没绑住腿, 这格就会绿。
  assert.throws(() => buildRefundCommand(refundArgs({
    poolRootArtifact: { script: [...Buffer.from(PS_PINNED.scriptHex, 'hex')], state_layout: PS_PINNED.state_layout },
    poolRedeemHex: PS_PINNED.scriptHex,
  })), /模板认证失败|不符/);
});

await t('实测注 · 两腿 state_layout.start 【不相等】(池=1 票=0) ⇒ 绑错腿不会静默', () => {
  assert.notStrictEqual(PINNED.state_layout.start, PS_PINNED.state_layout.start,
    '若两者相等, 绑错腿就是【语法合法、资金锁死、全程不报错】那一族; 实测不等, 族断言会喊');
});
await t('fail-closed · 缺 poolRootArtifact ⇒ 拒(不默认)', () => {
  assert.throws(() => buildRefundCommand(refundArgs({ poolRootArtifact: undefined })), /required/);
});

await t('fail-closed · redeem 总长与模板不符 ⇒ 拒', () => {
  assert.throws(() => buildRefundCommand(refundArgs({ poolRedeemHex: PINNED.scriptHex + 'ff' })), /长度/);
});
console.log(`\n${fail === 0 ? '✅' : '🔴'} u1-roundtrip-b1: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exitCode = 1;
