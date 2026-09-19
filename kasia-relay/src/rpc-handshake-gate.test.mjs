// rpc-handshake-gate.test.mjs — V2 / V3 / V4 / V10(设计 v0.4): rpc-listener 的两个落点(实时 processHandshake / 追赶 catchUpHistory 第 1 段)的行为驱动。
//
// 怎么驱动: rpc-listener.mjs 顶层会读网络配置并起监听, 且 processHandshake / catchUpHistory 是未导出的内部函数, import 它没法调用它们。
//   本测试从【当前磁盘上的 rpc-listener.mjs】按"顶层函数起、列 0 的 `}` 止"逐字截出这两个函数的原文, 用 new Function + with(Proxy) 在桩环境里求值——
//   求的是真实源码文本, 不是复制品: 谁删掉 / 挪动 / 写反守卫, 这里直接红。未桩化的自由变量会立刻抛 ReferenceError(新增依赖不会静默过)。
//   开启态对照: BEFORE = 基线 6635ff89 里这两个函数的逐字原文(test-fixtures/handshake-switch/, 由 extract-before-fixtures.mjs 程序化截取)。
// 单文件跑: node src/rpc-handshake-gate.test.mjs (不连节点、不碰网络、不读钱包; 只 import 纯函数模块 handshake-switch.mjs)。
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handshakeAutoAcceptEnabled } from './lib/handshake-switch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(HERE, '..', 'test-fixtures', 'handshake-switch');
const BASE = '6635ff89';
const RL_SRC = fs.readFileSync(path.join(HERE, 'rpc-listener.mjs'), 'utf8');
const before = (n) => fs.readFileSync(path.join(FX, `${n}.BEFORE-${BASE}.txt`), 'utf8');

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const K = 'RELAY_HANDSHAKE_AUTO_ACCEPT';

function extractFn(src, name) {
  const m = new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`, 'm').exec(src);
  if (!m) throw new Error('找不到函数 ' + name);
  const end = src.indexOf('\n}\n', m.index);
  if (end < 0) throw new Error('找不到函数结尾 ' + name);
  return src.slice(m.index, end + 3);
}
function loadFn(text, name, stubs) {
  const src = text.replace(/^export\s+/, '');
  const scope = new Proxy(stubs, {
    has: (_t, k) => typeof k === 'string',
    get: (tgt, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (Object.prototype.hasOwnProperty.call(tgt, k)) return tgt[k];
      if (k in globalThis) return globalThis[k];
      throw new ReferenceError('未桩化的自由变量: ' + String(k));
    },
  });
  return new Function('__scope', 'with (__scope) {\n' + src + '\nreturn ' + name + ';\n}')(scope);
}
const ser = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? 'BIG:' + x : x instanceof Error ? 'ERR:' + x.message : x === undefined ? '__undef__' : x));

const ME = 'kaspatest:qmeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const PEER = 'kaspatest:qpeerrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr';
const TX = 'ab'.repeat(32);
const OUT = { txId: 'cd'.repeat(32), fee: '0.0001' };
const DRAFT = { to: PEER, amount: '0.2', payload: 'PAY' };

// ── 环境构造: 全部桩都进同一条 trace ─────────────────────────────────────────────────────────────────────────────
function mkEnv(cfg = {}) {
  const trace = [];
  const rec = (name, args, res) => trace.push(name + ' ' + ser(args) + (res === undefined ? '' : ' => ' + ser(res)));
  const env = {
    PREFIX_HEX: { HANDSHAKE: 'ab' },
    _myPrivateKeyHex: '00'.repeat(32), _myAddress: ME, KASPA_NETWORK: 'testnet-12',
    CONSOLE_URL: cfg.consoleUrl ?? 'http://console.local',
    _blocklist: new Set(cfg.blocked ? [PEER] : []),
    _handshakeAccepted: new Set(cfg.memAccepted ? [PEER] : []),
    _seen: new Set(),
    log: (...a) => trace.push('log ' + ser(a)),
    decrypt: async () => { if (cfg.decryptThrow) throw new Error('bad ciphertext'); return JSON.stringify({ alias: 'alias1' }); },
    ingestTx: (o) => rec('ingestTx', [o]),
    ingestMessage: (o) => rec('ingestMessage', [o]),
    ingestHandshake: (o) => rec('ingestHandshake', [o]),
    markSeen: (x) => rec('markSeen', [x]),
    acceptHandshake: async (o) => { if (cfg.accept === 'throw') { rec('acceptHandshake', [o], { threw: 'enc fail' }); throw new Error('enc fail'); } const r = cfg.accept === 'null' ? null : DRAFT; rec('acceptHandshake', [o], r); return r; },
    sendKaspa: async (o) => { if (cfg.send === 'throw') { rec('sendKaspa', [o], { threw: 'broadcast fail' }); throw new Error('broadcast fail'); } rec('sendKaspa', [o], OUT); return OUT; },
    getAIReply: async (...a) => { rec('getAIReply', [a[0], a[2]], 'hello'); return 'hello'; },
    sendMessage: async (o) => { rec('sendMessage', [o], DRAFT); return DRAFT; },
    isValidKaspaAddress: () => true,
    replyToMessage: async (...a) => { rec('replyToMessage', a); },
    processComm: async (...a) => { rec('processComm', a); },
    handshakeAutoAcceptEnabled,
    fetch: async (url, opts) => {
      trace.push('fetch ' + url + (opts?.method ? ' ' + opts.method : ''));
      const R = (o) => ({ ok: true, status: 200, json: async () => o });
      if (url.includes('/api/relation/status')) return R({ status: cfg.relStatus ?? 'none' });
      if (url.includes('create_and_claim')) { if (cfg.claim === 'throw') throw new Error('claim unreachable'); return R({ claimed: cfg.claim !== 'not' }); }
      if (url.includes('pending-handshakes?claim=')) { if (cfg.hsClaimThrow) throw new Error('claim unreachable'); const id = url.split('claim=')[1]; return R({ claimed: cfg.hsClaimed ? cfg.hsClaimed[id] !== false : true }); }
      if (url.includes('/ingest/pending-handshakes?')) return R({ handshakes: cfg.handshakes ?? [] });
      if (url.includes('unreplied-messages')) return R({ messages: cfg.messages ?? [] });
      if (url.includes('/ingest/event')) return R({});
      return { ok: false, status: 404, json: async () => ({}) };
    },
  };
  return { env, trace };
}
const withEnv = async (val, fn) => {
  const prev = process.env[K];
  if (val === undefined) delete process.env[K]; else process.env[K] = val;
  try { return await fn(); } finally { if (prev === undefined) delete process.env[K]; else process.env[K] = prev; }
};
const cnt = (trace, prefix) => trace.filter((l) => l.startsWith(prefix)).length;
const fetches = (trace) => trace.filter((l) => l.startsWith('fetch '));

async function runPH(fnText, cfg, envVal) {
  const { env, trace } = mkEnv(cfg);
  const fn = loadFn(fnText, 'processHandshake', env);
  await withEnv(envVal, async () => { try { await fn(TX, 'abcd', cfg.noSender ? null : PEER); trace.push('CALL-DONE'); } catch (e) { trace.push('CALL-THREW ' + e.message); } });
  return { trace, env };
}
async function runCU(fnText, cfg, envVal) {
  const { env, trace } = mkEnv(cfg);
  const fn = loadFn(fnText, 'catchUpHistory', env);
  await withEnv(envVal, async () => { try { await fn(); trace.push('CALL-DONE'); } catch (e) { trace.push('CALL-THREW ' + e.message); } });
  return { trace, env };
}
const PH_NOW = extractFn(RL_SRC, 'processHandshake');
const CU_NOW = extractFn(RL_SRC, 'catchUpHistory');
const PH_BEFORE = before('processHandshake');
const CU_BEFORE = before('catchUpHistory');

// ══ processHandshake ═════════════════════════════════════════════════════════════════════════════════════════════════
const PH_SCEN = {
  'P1 正常接受(有 console, claim 成功, 含问候)': {},
  'P2 无 console': { consoleUrl: '' },
  'P3 claim 返回 claimed=false ⇒ 不发, 不 markSeen': { claim: 'not' },
  'P4 claim 接口抛错 ⇒ fail-safe 继续接受': { claim: 'throw' },
  'P5 acceptHandshake 返回 null(无草稿)': { accept: 'null' },
  'P6 sendKaspa 抛错 ⇒ 外层 catch + 上报 ingest/event': { send: 'throw' },
  'P7 黑名单发送方 ⇒ markSeen 后 return': { blocked: true },
  'P8 内存去重命中': { memAccepted: true },
  'P9 DB 去重命中(active)': { relStatus: 'active' },
  'P10 无发送方地址': { noSender: true },
  'P11 解密失败 ⇒ 外层 catch': { decryptThrow: true },
};
// step 4 之前就 return / 抛出的场景: 开关关闭时与开启时逐字相同(闸在 step 4 之后 ⇒ 这些路径根本没走到闸)
const PRE_GATE = new Set(['P7', 'P8', 'P9', 'P10', 'P11']);

for (const [name, cfg] of Object.entries(PH_SCEN)) {
  await t(`V4 processHandshake ${name}: 开启态(env='1') 与基线原文的全部外部调用轨迹逐条相同`, async () => {
    const a = await runPH(PH_NOW, cfg, '1');
    const b = await runPH(PH_BEFORE, cfg, '1');
    assert.ok(b.trace.length >= 3, 'BEFORE 轨迹过短(空比较?): ' + b.trace.length);
    const MARK = { P10: 'no sender address', P11: 'HANDSHAKE processing failed', P7: 'BLOCKED', P8: 'memory dedup', P9: 'DB dedup', P5: 'accept draft failed', P3: 'claim failed', P6: 'HANDSHAKE processing failed' }[name.split(' ')[0]];
    if (MARK) assert.ok(b.trace.some((l) => l.includes(MARK)), 'BEFORE 轨迹应含 ' + MARK + '(否则场景没走到预期路径)');
    assert.deepStrictEqual(a.trace, b.trace);
  });
}
await t('V4 阳性对照: P1 开启态 sendKaspa 恰 2 次(握手接受 + 问候)、acceptHandshake 1 次、markSeen 1 次、ingestHandshake 1 次、_handshakeAccepted 记住 peer', async () => {
  const { trace, env } = await runPH(PH_NOW, {}, '1');
  assert.strictEqual(cnt(trace, 'acceptHandshake '), 1); assert.strictEqual(cnt(trace, 'sendKaspa '), 2);
  assert.strictEqual(cnt(trace, 'markSeen '), 1); assert.strictEqual(cnt(trace, 'ingestHandshake '), 1);
  assert.ok(env._handshakeAccepted.has(PEER));
});

const NOT_OPEN = [['未设', undefined], ["'0'", '0'], ["'on'", 'on'], ["'true'", 'true'], ["' 1'", ' 1'], ["''", '']];
for (const [label, val] of NOT_OPEN) {
  await t(`V2 processHandshake 关闭态(${label}) P1: ingestTx 与 ingestMessage 各 1 次(登记不变); 零 claim fetch / 零 acceptHandshake / 零 sendKaspa / 零 markSeen / 零 ingestHandshake / 零问候; 恰一行 disabled`, async () => {
    const { trace, env } = await runPH(PH_NOW, {}, val);
    assert.strictEqual(cnt(trace, 'ingestTx '), 1, 'ingestTx'); assert.strictEqual(cnt(trace, 'ingestMessage '), 1, 'ingestMessage');
    assert.strictEqual(fetches(trace).filter((l) => l.includes('create_and_claim') || l.includes('pending-handshakes')).length, 0, 'claim fetch');
    for (const p of ['acceptHandshake ', 'sendKaspa ', 'markSeen ', 'ingestHandshake ', 'getAIReply ', 'sendMessage ']) assert.strictEqual(cnt(trace, p), 0, p);
    assert.strictEqual(env._handshakeAccepted.size, 0);
    const dis = trace.filter((l) => l.startsWith('log ') && l.includes('HANDSHAKE auto-accept disabled — left pending for'));
    assert.strictEqual(dis.length, 1, 'disabled 行数 ' + dis.length);
    assert.ok(dis[0].includes(PEER.slice(-12)));
    assert.ok(!trace.some((l) => l.includes('auto-accepting handshake...')), '不该进入 auto-accepting');
    assert.strictEqual(trace[trace.length - 1], 'CALL-DONE');
  });
}
for (const [name, cfg] of Object.entries(PH_SCEN)) {
  const key = name.split(' ')[0];
  if (PRE_GATE.has(key)) {
    await t(`V2 processHandshake 关闭态 ${name}: 闸之前就退出的路径与开启态逐字相同(闸位置在 step 4 之后)`, async () => {
      const off = await runPH(PH_NOW, cfg, undefined);
      const on = await runPH(PH_NOW, cfg, '1');
      assert.deepStrictEqual(off.trace, on.trace);
      assert.ok(!off.trace.some((l) => l.includes('auto-accept disabled')), '闸之前的路径不该打 disabled');
    });
  } else {
    await t(`V2 processHandshake 关闭态 ${name}: 到 step 4 为止与基线原文逐条相同, 其后只多一行 disabled 且没有任何 claim / 发送(闸紧挨 step 4 之后)`, async () => {
      const off = await runPH(PH_NOW, cfg, undefined);
      const base = await runPH(PH_BEFORE, cfg, undefined);
      const mark = (tr) => tr.findIndex((l) => l.includes('HANDSHAKE step 4 ingestMessage ok'));
      const k = mark(base.trace); assert.ok(k > 0 && mark(off.trace) === k, 'step 4 位置');
      assert.deepStrictEqual(off.trace.slice(0, k + 1), base.trace.slice(0, k + 1));
      assert.strictEqual(off.trace.length, k + 3, '其后应恰为 disabled 行 + CALL-DONE: ' + off.trace.slice(k + 1).join(' | '));
      assert.ok(off.trace[k + 1].includes('HANDSHAKE auto-accept disabled — left pending for'));
      assert.strictEqual(off.trace[k + 2], 'CALL-DONE');
    });
  }
}

// ══ catchUpHistory ═══════════════════════════════════════════════════════════════════════════════════════════════════
const HS = [{ id: 'hs1aaaaaaaa', remoteAddress: PEER, traceId: 'tr1', txid: 'aa'.repeat(32), theirAlias: 'al' }, { id: 'hs2bbbbbbbb', remoteAddress: PEER.replace('qpeer', 'qpee2'), traceId: 'tr2' }];
const MSG = [{ remoteAddress: PEER, message: 'hello there', txid: 'ee'.repeat(32), traceId: 'mt1' }];
const CU_SCEN = {
  'C1 两条 pending: 第一条 claim 成功并接受, 第二条已被别人 claim; 另有 1 条待回复消息': { handshakes: HS, hsClaimed: { hs2bbbbbbbb: false }, messages: MSG },
  'C2 claim 接口抛错 ⇒ 跳过': { handshakes: HS, hsClaimThrow: true, messages: MSG },
  'C3 acceptHandshake 抛错 ⇒ 上报 catchup_handshake_failed': { handshakes: [HS[0]], accept: 'throw' },
  'C4 pending 为空、无消息': { handshakes: [], messages: [] },
  'C5 无 CONSOLE_URL ⇒ 整个追赶跳过': { consoleUrl: '', handshakes: HS },
};
for (const [name, cfg] of Object.entries(CU_SCEN)) {
  await t(`V4 catchUpHistory ${name}: 开启态(env='1') 与基线原文的全部外部调用轨迹逐条相同`, async () => {
    const a = await runCU(CU_NOW, cfg, '1');
    const b = await runCU(CU_BEFORE, cfg, '1');
    assert.ok(b.trace.length >= 2, 'BEFORE 轨迹过短');
    assert.deepStrictEqual(a.trace, b.trace);
  });
}
await t('V4 阳性对照: C1 开启态 acceptHandshake / sendKaspa 各恰 1 次, 汇总行 "1 handshakes accepted"(不含 DISABLED 字样的 handshakes 段)', async () => {
  const { trace } = await runCU(CU_NOW, CU_SCEN['C1 两条 pending: 第一条 claim 成功并接受, 第二条已被别人 claim; 另有 1 条待回复消息'], '1');
  assert.strictEqual(cnt(trace, 'acceptHandshake '), 1); assert.strictEqual(cnt(trace, 'sendKaspa '), 1);
  const done = trace.filter((l) => l.startsWith('log ') && l.includes('catch-up done:'));
  assert.strictEqual(done.length, 1);
  assert.ok(done[0].includes('1 handshakes accepted, 1 messages replied'), done[0]);
  assert.ok(!done[0].includes('handshakes: DISABLED'));
});

for (const [label, val] of NOT_OPEN) {
  await t(`V3/V10 catchUpHistory 关闭态(${label}) C1: 零 pending 查询 / 零 claim / 零 acceptHandshake / 零 sendKaspa / 零 ingest / 零 markSeen(握手); 一行 "catch-up handshakes: DISABLED"; 汇总行含 "handshakes: DISABLED" 且不含 "0 handshakes accepted"`, async () => {
    const { trace } = await runCU(CU_NOW, CU_SCEN['C1 两条 pending: 第一条 claim 成功并接受, 第二条已被别人 claim; 另有 1 条待回复消息'], val);
    assert.strictEqual(fetches(trace).filter((l) => l.includes('pending-handshakes')).length, 0, 'pending-handshakes fetch');
    for (const p of ['acceptHandshake ', 'sendKaspa ', 'ingestTx ', 'ingestHandshake ']) assert.strictEqual(cnt(trace, p), 0, p);
    assert.strictEqual(trace.filter((l) => l.startsWith('markSeen ') && l.includes(HS[0].txid)).length, 0, '握手 txid 不该 markSeen');
    const d = trace.filter((l) => l.startsWith('log ') && l.includes('catch-up handshakes: DISABLED'));
    assert.strictEqual(d.length, 1, 'DISABLED 行数 ' + d.length);
    const done = trace.filter((l) => l.startsWith('log ') && l.includes('catch-up done:'));
    assert.strictEqual(done.length, 1);
    assert.ok(done[0].includes('handshakes: DISABLED'), done[0]);
    assert.ok(!done[0].includes('0 handshakes accepted'), '不能打 0(0 在"关了"与"全失败了"下逐字相同)');
  });
}
await t('V3 第 2 / 3 段行为不变: 关闭态(握手段跳过)与基线(pending 为空)相比, 消息回复段与历史 comm 段的调用与日志逐条相同; 且 replyToMessage 确实被调(非空比较)', async () => {
  const cfg = { handshakes: HS, messages: MSG };
  const off = await runCU(CU_NOW, cfg, undefined);
  const base = await runCU(CU_BEFORE, { ...cfg, handshakes: [] }, undefined);
  const seg = (tr) => tr.filter((l) => /unreplied-messages|replyToMessage|catch-up: replying|catch-up comm: DISABLED|markSeen /.test(l));
  assert.ok(seg(base.trace).some((l) => l.startsWith('replyToMessage ')), '基线的第 2 段应触发 replyToMessage');
  assert.deepStrictEqual(seg(off.trace), seg(base.trace));
});
await t('V3 关闭态 CONSOLE_URL 为空: 仍是原来的 "catch-up: no CONSOLE_URL, skipping"(闸在其后, 不改这条早退)', async () => {
  const off = await runCU(CU_NOW, CU_SCEN['C5 无 CONSOLE_URL ⇒ 整个追赶跳过'], undefined);
  const base = await runCU(CU_BEFORE, CU_SCEN['C5 无 CONSOLE_URL ⇒ 整个追赶跳过'], undefined);
  assert.deepStrictEqual(off.trace, base.trace);
});
await t('V3 关闭态每次追赶都只留一行 DISABLED(不累计、不依赖 pending 数)', async () => {
  for (const cfg of [CU_SCEN['C4 pending 为空、无消息'], CU_SCEN['C1 两条 pending: 第一条 claim 成功并接受, 第二条已被别人 claim; 另有 1 条待回复消息']]) {
    const { trace } = await runCU(CU_NOW, cfg, undefined);
    assert.strictEqual(trace.filter((l) => l.includes('catch-up handshakes: DISABLED')).length, 1);
  }
});

// ══ 提取器自检: 提到的确是真函数, 且含预期守卫(防"提取了个空壳")═════════════════════════════════════════════════
await t('提取自检: 两个函数文本非空、含各自的守卫子句与 acceptHandshake 调用; BEFORE 原文里没有守卫', () => {
  assert.ok(PH_NOW.length > 3000 && CU_NOW.length > 5000);
  assert.ok(/handshakeAutoAcceptEnabled\(\)/.test(PH_NOW) && /handshakeAutoAcceptEnabled\(\)/.test(CU_NOW));
  assert.ok(!/handshakeAutoAcceptEnabled/.test(PH_BEFORE) && !/handshakeAutoAcceptEnabled/.test(CU_BEFORE));
  assert.ok(/acceptHandshake\(/.test(PH_NOW) && /acceptHandshake\(/.test(CU_NOW));
});
await t('未桩化自由变量会立刻报错(不是静默 undefined): 求值环境对未知标识符抛 ReferenceError', async () => {
  const { env } = mkEnv({});
  const fn = loadFn('async function probe() { return __definitely_not_a_stub__; }', 'probe', env);
  await assert.rejects(() => fn(), /未桩化的自由变量/);
});

console.log(`\nrpc-handshake-gate.test: ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
