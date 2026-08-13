// pool-market-anchor-cp4.test.mjs — CP4 §4 身份锚 provenance 验收判据(Codex (222) 逐条)。
//
// 判据(COORD-LEDGER (222)/(224)):
//   ① 删生产 builder 的自由 `expectedRootTmplHashHex` + 无可注入 getter(调用方无法注入)
//   ② NULL/缺锚 fail-closed
//   ③ 候选 redeem 自算 hash 经任何额外/legacy 参传入**仍失败**
//   ④ 变异"命名 resolver 换成候选算 hash"**必红**(本文件出**断言**, 变异体在 .mutants.mjs 里打)
//   ⑤ 变异"省/改建市持久化"由 DB/集成测试**必红**(同上)
//   ⑥ write-once 在 **DB 层**测(非仅 prose)
//   ⑦ post-Fix B-1 对最终权威链重跑(见 u1-roundtrip-b1.test.mjs, 独立文件)
//
// fixture = **真 PoolRoot 编译制品** fixtures/poolroot-artifact.pinned.json(首字节 0x6b), 非合成。
// DB = 真 better-sqlite3 内存库(DI 只测试); 表 + write-once trigger 走**生产同一 DDL 单源**。
import { readFileSync } from 'node:fs';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { ctorBytes32 } from './pool-bshard-artifacts.mjs';
import {
  ROOT_TMPL_HASH_WRITE_ONCE_TRIGGER_SQL, ROOT_TMPL_HASH_CTOR_INDEX,
  getMarketRootAnchor, persistMarketRootAnchor, deriveRootAnchorFromGenesis, _blake2b32Hex,
} from './pool-market-anchor.mjs';
import { buildRefundCommand } from './pool-refund-builder.mjs';

const PINNED = JSON.parse(readFileSync(new URL('./fixtures/poolroot-artifact.pinned.json', import.meta.url), 'utf8'));
const REAL_ANCHOR = PINNED.rootTmplHashHex.toLowerCase();

let pass = 0; let fail = 0;
const t = (name, fn) => {
  try { fn(); pass += 1; console.log(`[PASS] ${name}`); }
  catch (e) { fail += 1; console.log(`[FAIL] ${name} — ${e.message}`); }
};

// ── 真库(生产同一 DDL 单源) ────────────────────────────────────────────────────
function freshDb() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE pool_markets (id TEXT PRIMARY KEY, fee_rules TEXT, root_tmpl_hash TEXT)');
  db.exec(ROOT_TMPL_HASH_WRITE_ONCE_TRIGGER_SQL);
  return db;
}
// 一个**忠实**的 computeMarketGenesis 产物形状: leafCtor[8] = ctorBytes32(rootTmplHash)(逐字节等于 rootTmplHash)。
function genFor(rootTmplHashHex, { breakBinding = false } = {}) {
  const leafCtor = new Array(14).fill(null).map((_, i) => ({ kind: 'int', data: i }));
  leafCtor[ROOT_TMPL_HASH_CTOR_INDEX] = ctorBytes32(breakBinding ? 'cd'.repeat(32) : rootTmplHashHex);
  return { rootTmplHash: rootTmplHashHex, leafCtor };
}

// ── 变异④ 的承重断言: 自洽的 rogue redeem(自己算出的 hash 自洽) + 库锚=真(不同) ⇒ 必被拒 ──
// 构造: 拿真 PoolRoot redeem, 翻**suffix 段**一个字节 ⇒ 长度不变、start 不变、但 prefix‖suffix hash 变。
const rogue = Buffer.from(PINNED.scriptHex, 'hex');
rogue[rogue.length - 1] ^= 0xff;                 // 末字节 = suffix 段(state 在 [start, start+len))
const ROGUE_HEX = rogue.toString('hex');
const ROGUE_SELF_HASH = _blake2b32Hex(Buffer.concat([
  rogue.subarray(0, PINNED.state_layout.start),
  rogue.subarray(PINNED.state_layout.start + PINNED.state_layout.len),
]));

const baseArgs = (db, over = {}) => ({
  witness: { poolOutIdx: 0, payoutOutIdx: 1, ticketInIdx: 1, ticket_prefix_len: 0, ticket_suffix_len: 0,
    ticket_prefix: Buffer.alloc(0), ticket_suffix: Buffer.alloc(0), bettorPk: 'aa'.repeat(32), stake: 100n },
  poolOutpointTxid: 'aa'.repeat(32), poolRedeemHex: PINNED.scriptHex,
  poolRootArtifact: { script: [...Buffer.from(PINNED.scriptHex, 'hex')], state_layout: PINNED.state_layout },
  db, marketId: 'mkt-ok',
  currentPoolState: { local_yes: '1', local_no: '2', count: '3', pool_value: '4', closed: '0', winningSide: '0', payoutRoot: 'ab'.repeat(32) },
  ticketOutpointTxid: 'bb'.repeat(32), ticketRedeemHex: '51' + 'ee'.repeat(8),
  ticketState: { bettorPk: 'aa'.repeat(32), direction: 1, stake: 100n, shardPoolId: 1 },
  poolValueSompi: 1000n, bettorAddress: 'kaspatest:qqx', poolContinuationState: { closed: 2 },
  changeAddress: 'kaspatest:qqx', ...over,
});

// ═══════════════ 判据⑥: write-once 在 DB 层 ═══════════════
t('⑥ write-once(DB 层) · NULL→值 允许一次', () => {
  const db = freshDb();
  db.prepare('INSERT INTO pool_markets (id) VALUES (?)').run('m');
  const r = persistMarketRootAnchor(db, 'm', genFor(REAL_ANCHOR));
  assert.strictEqual(r.anchor, REAL_ANCHOR);
  assert.strictEqual(getMarketRootAnchor(db, 'm'), REAL_ANCHOR);
});
t('⑥ write-once(DB 层) · 已有值改写 ⇒ RAISE(ABORT) 抛', () => {
  const db = freshDb();
  db.prepare('INSERT INTO pool_markets (id, root_tmpl_hash) VALUES (?, ?)').run('m', REAL_ANCHOR);
  assert.throws(() => db.prepare('UPDATE pool_markets SET root_tmpl_hash = ? WHERE id = ?').run('cd'.repeat(32), 'm'),
    /write-once/, '已有锚被改写 = write-once 没生效');
});
t('⑥ write-once(DB 层) · 等值 UPDATE 放行(settler 整行 UPDATE 不误伤)', () => {
  const db = freshDb();
  db.prepare('INSERT INTO pool_markets (id, root_tmpl_hash) VALUES (?, ?)').run('m', REAL_ANCHOR);
  assert.doesNotThrow(() => db.prepare('UPDATE pool_markets SET root_tmpl_hash = ? WHERE id = ?').run(REAL_ANCHOR, 'm'));
});

// ═══════════════ MUST1 结构绑定: 持久化的必须是"烤进 ctor 的确切值" ═══════════════
t('MUST1 · persist 消费 leafCtor[8] 的确切字节 ⇒ getMarketRootAnchor 回读一致', () => {
  const db = freshDb();
  db.prepare('INSERT INTO pool_markets (id) VALUES (?)').run('m');
  persistMarketRootAnchor(db, 'm', genFor(REAL_ANCHOR));
  assert.strictEqual(getMarketRootAnchor(db, 'm'), REAL_ANCHOR);
});
t('MUST1 · rootTmplHash 与 leafCtor[8] 烤死字节不符 ⇒ 拒持久化(证不了绑定)', () => {
  assert.throws(() => deriveRootAnchorFromGenesis(genFor(REAL_ANCHOR, { breakBinding: true })),
    /绑定|烤进/, '一个证明不了"那次构造"绑定的值被放行 ⇒ MUST1 空转');
});
t('MUST1 · 缺 leafCtor ⇒ 拒(无法证明绑定)', () => {
  assert.throws(() => deriveRootAnchorFromGenesis({ rootTmplHash: REAL_ANCHOR }), /leafCtor/);
});
t('⑤(集成) · 建市持久化后, builder 用同一 marketId 认证通过(端到端 persist→resolver→builder)', () => {
  const db = freshDb();
  db.prepare('INSERT INTO pool_markets (id) VALUES (?)').run('mkt-ok');
  persistMarketRootAnchor(db, 'mkt-ok', genFor(REAL_ANCHOR));   // 建市写入点
  const cmd = buildRefundCommand(baseArgs(db));                  // 退款消费 resolver
  assert.strictEqual(cmd.type, 'bshard_refund_cancelled');
  assert.strictEqual(cmd.inputs.pool.state_start, PINNED.state_layout.start);
});

// ═══════════════ 判据②: NULL/缺锚 fail-closed ═══════════════
t('② fail-closed · root_tmpl_hash NULL(老市场) ⇒ resolver 抛', () => {
  const db = freshDb();
  db.prepare('INSERT INTO pool_markets (id) VALUES (?)').run('m');
  assert.throws(() => getMarketRootAnchor(db, 'm'), /NULL|fail-closed/);
});
t('② fail-closed · marketId 查不到 ⇒ resolver 抛', () => {
  assert.throws(() => getMarketRootAnchor(freshDb(), 'nope'), /不存在|fail-closed/);
});
t('② fail-closed · builder 遇 NULL 锚市场 ⇒ 拒(不默认不回落)', () => {
  const db = freshDb();
  db.prepare('INSERT INTO pool_markets (id) VALUES (?)').run('mkt-ok');    // 无锚
  assert.throws(() => buildRefundCommand(baseArgs(db)), /NULL|fail-closed/);
});

// ═══════════════ 判据①: 删自由参 + 无可注入 getter ═══════════════
t('① 无注入 · builder 签名不含 expectedRootTmplHashHex 解构参(结构上删掉)', () => {
  const src = readFileSync(new URL('./pool-refund-builder.mjs', import.meta.url), 'utf8');
  const sig = src.slice(src.indexOf('export function buildRefundCommand('));
  const destructure = sig.slice(0, sig.indexOf('})') + 1);
  assert.ok(!/\bexpectedRootTmplHashHex\b/.test(destructure),
    'buildRefundCommand 的解构参里仍有 expectedRootTmplHashHex ⇒ 调用方还能注入');
  assert.ok(!/\bgetter\b|\banchorResolver\b|\bresolve\w*:/i.test(destructure),
    '解构参里出现可注入的 getter/resolver ⇒ MUST2 未满足');
});
t('① 无注入 · 传一个多余的 expectedRootTmplHashHex 被完全忽略(有效锚仍从库来)', () => {
  const db = freshDb();
  db.prepare('INSERT INTO pool_markets (id) VALUES (?)').run('mkt-ok');
  persistMarketRootAnchor(db, 'mkt-ok', genFor(REAL_ANCHOR));
  // 喂一个"能让 rogue 自洽"的假锚当额外参 —— 因为 redeem 是真的、库锚是真的, 依然通过(额外参无效)。
  const cmd = buildRefundCommand(baseArgs(db, { expectedRootTmplHashHex: ROGUE_SELF_HASH }));
  assert.strictEqual(cmd.type, 'bshard_refund_cancelled');
});

// ═══════════════ 判据③: 候选自算 hash 经 legacy 参传入仍失败 ═══════════════
t('③ 候选自算 · rogue redeem + 自算 hash 经 legacy 参 expectedRootTmplHashHex 传入 ⇒ 仍拒(库锚说了算)', () => {
  const db = freshDb();
  db.prepare('INSERT INTO pool_markets (id) VALUES (?)').run('mkt-ok');
  persistMarketRootAnchor(db, 'mkt-ok', genFor(REAL_ANCHOR));
  assert.throws(() => buildRefundCommand(baseArgs(db, {
    poolRedeemHex: ROGUE_HEX,
    poolRootArtifact: { script: [...rogue], state_layout: PINNED.state_layout },
    expectedRootTmplHashHex: ROGUE_SELF_HASH,   // legacy 参: 被忽略
  })), /模板认证失败/, 'rogue 自算 hash 从 legacy 参喂进去竟能过 ⇒ 循环白验又回来了');
});

// ═══════════════ 判据④/⑤ 的**承重断言**(变异体在 .mutants.mjs 里打, 这里出会被它翻红的断言) ═══
t('④ 承重 · 自洽 rogue redeem, 库锚=真(不同) ⇒ 必拒【resolver 换成候选自算 hash 时此格必翻红】', () => {
  const db = freshDb();
  db.prepare('INSERT INTO pool_markets (id) VALUES (?)').run('mkt-ok');
  persistMarketRootAnchor(db, 'mkt-ok', genFor(REAL_ANCHOR));
  // rogue 自己 prefix‖suffix hash 自洽; 但库里存的是真锚(REAL_ANCHOR != ROGUE_SELF_HASH) ⇒ 正确码拒。
  // 若把 `getMarketRootAnchor(db,marketId)` 变异成 `actualTmplHash`(自算), rogue 就会 hash==hash 自洽通过 ⇒ 此格红。
  assert.notStrictEqual(REAL_ANCHOR, ROGUE_SELF_HASH, '前提: rogue 自算 hash 必须 != 真锚, 否则本格对变异④不敏感');
  assert.throws(() => buildRefundCommand(baseArgs(db, {
    poolRedeemHex: ROGUE_HEX,
    poolRootArtifact: { script: [...rogue], state_layout: PINNED.state_layout },
  })), /模板认证失败/);
});
t('⑤ 承重 · persist 后回读非空【省/改建市持久化时此格必翻红】', () => {
  const db = freshDb();
  db.prepare('INSERT INTO pool_markets (id) VALUES (?)').run('m');
  persistMarketRootAnchor(db, 'm', genFor(REAL_ANCHOR));
  const row = db.prepare('SELECT root_tmpl_hash FROM pool_markets WHERE id = ?').get('m');
  assert.strictEqual(row.root_tmpl_hash, REAL_ANCHOR, 'persist 没把锚写进库 ⇒ 建市持久化被省/改');
});

console.log(`\n${fail === 0 ? '✅' : '🔴'} pool-market-anchor-cp4: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exitCode = 1;
