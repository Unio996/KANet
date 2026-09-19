// handshake-accept.test.mjs — 握手开关笔一(只搬不改行为)的对照测试。
// 设计: docs/2026-09-20-bettor-relay-handshake-auto-accept-switch-design-v0.1.md §7.1 / §8.2 / §8.4。
//
// 方法: BEFORE = 抽取前 relay.mjs(338f2496)里 doAcceptHandshake + _acceptedPeers 的【逐字原文】(test-fixtures/handshake-extract/…BEFORE-338f2496.txt),
//        用 new Function 在同样的桩下求值; AFTER = createHandshakeAcceptor。两边跑同一组场景, 逐条比对【全部外部调用轨迹】
//        (log 行 / fetch URL / acceptHandshake / sendKaspa / ingestHandshake / ingestTx 的参数与顺序 + 每次调用的返回或抛出)——
//        轨迹不同 = 行为变了。另加一条机械断言: 模块函数体经"缩进两格 + consoleUrl→CONSOLE_URL"还原后与 BEFORE 原文逐字相同(只搬没改)。
// 笔二追加: 入口开关(默认关)。BEFORE/AFTER 对照证明的是【开启态】行为不变——所以对照段先把 RELAY_HANDSHAKE_AUTO_ACCEPT 置 '1'; 关闭态另有 V2c 段(末尾)。
// 单文件跑: node src/lib/handshake-accept.test.mjs (不读钱包、不连节点、不碰网络; 全部依赖是桩)。
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandshakeAcceptor } from './handshake-accept.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RELAY_ROOT = path.resolve(HERE, '..', '..');
const BEFORE_TXT = fs.readFileSync(path.join(RELAY_ROOT, 'test-fixtures', 'handshake-extract', 'doAcceptHandshake.BEFORE-338f2496.txt'), 'utf8');
const MODULE_SRC = fs.readFileSync(path.join(HERE, 'handshake-accept.mjs'), 'utf8');
const RELAY_SRC = fs.readFileSync(path.join(RELAY_ROOT, 'src', 'relay.mjs'), 'utf8');

const SAVED_ENV = process.env.RELAY_HANDSHAKE_AUTO_ACCEPT;
process.env.RELAY_HANDSHAKE_AUTO_ACCEPT = '1';   // 对照段 = 开启态
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };

// ── BEFORE / AFTER 工厂(同一组桩签名) ─────────────────────────────────────────────────────────────────────────────
const buildBefore = (deps) => {
  const fn = new Function('log', 'fetch', 'acceptHandshake', 'sendKaspa', 'ingestHandshake', 'ingestTx', 'CONSOLE_URL', 'localAddress',
    BEFORE_TXT + '\nreturn doAcceptHandshake;');
  return fn(deps.log, deps.fetch, deps.acceptHandshake, deps.sendKaspa, deps.ingestHandshake, deps.ingestTx, deps.consoleUrl, deps.localAddress);
};
const buildAfter = (deps) => createHandshakeAcceptor(deps);

// ── 桩 + 轨迹录制 ───────────────────────────────────────────────────────────────────────────────────────────────────
const LOCAL = 'kaspatest:qlocalxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const P1 = 'kaspatest:qpeer1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const P2 = 'kaspatest:qpeer2xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const ser = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? 'BIG:' + x : x instanceof Error ? 'ERR:' + x.message : x === undefined ? '__undef__' : x));

// script: 各桩的行为脚本(按调用顺序取值; 用尽后取最后一个)。值可以是 {ret} 或 {throw}。
function makeStubs(script, consoleUrl) {
  const trace = [];
  const pick = (name) => {
    const arr = script[name] || [{ ret: undefined }];
    const i = (pick.n[name] = (pick.n[name] ?? -1) + 1);
    return arr[Math.min(i, arr.length - 1)];
  };
  pick.n = {};
  const rec = (name, args, res) => trace.push(name + ' ' + ser(args) + ' => ' + ser(res));
  const wrapAsync = (name) => async (...args) => {
    const a = pick(name);
    if (a.throw) { rec(name, args, { threw: a.throw }); throw new Error(a.throw); }
    rec(name, args, { ret: a.ret }); return a.ret;
  };
  const wrapSync = (name) => (...args) => {
    const a = pick(name);
    if (a.throw) { rec(name, args, { threw: a.throw }); throw new Error(a.throw); }
    rec(name, args, { ret: a.ret }); return a.ret;
  };
  // fetch: 返回带 json() 的响应; 脚本项 {json} / {throw} / {jsonThrow}
  const fetch = async (url) => {
    const a = pick('fetch');
    if (a.throw) { rec('fetch', [url], { threw: a.throw }); throw new Error(a.throw); }
    rec('fetch', [url], { json: a.json ?? null, jsonThrow: a.jsonThrow ?? null });
    return { json: async () => { if (a.jsonThrow) throw new Error(a.jsonThrow); return a.json; } };
  };
  const log = (...args) => trace.push('log ' + ser(args));
  return { trace, deps: { log, fetch, acceptHandshake: wrapAsync('acceptHandshake'), sendKaspa: wrapAsync('sendKaspa'), ingestHandshake: wrapSync('ingestHandshake'), ingestTx: wrapSync('ingestTx'), consoleUrl, localAddress: LOCAL } };
}

// 跑一个场景: peers 依次调用; 返回整条轨迹(含每次调用的 resolve 值/抛出)。Date.now 固定, 保证 traceId 可比。
async function runScenario(build, { script, consoleUrl, peers }) {
  const realNow = Date.now; Date.now = () => 1_700_000_000_000;
  try {
    const { trace, deps } = makeStubs(script, consoleUrl);
    const acc = build(deps);
    for (const p of peers) {
      let out;
      try { out = { ret: await acc(p) }; } catch (e) { out = { threw: e?.message || String(e) }; }
      trace.push('CALL-DONE ' + p.slice(-6) + ' ' + ser(out));
    }
    return trace;
  } finally { Date.now = realNow; }
}

const OK_TX = { txId: 'aa'.repeat(32), fee: '0.0001' };
const SCENARIOS = {
  'S1 主路径: 有 console, 关系未建 ⇒ 接受 + 两条入库': { consoleUrl: 'http://console.local', peers: [P1], script: { fetch: [{ json: { status: 'none' } }], acceptHandshake: [{ ret: { to: P1, amount: '0.2', payload: 'PAY' } }], sendKaspa: [{ ret: OK_TX }] } },
  'S2 同一 peer 第二次 ⇒ 内存去重(不再 fetch / 不再发)': { consoleUrl: 'http://console.local', peers: [P1, P1], script: { fetch: [{ json: { status: 'none' } }], acceptHandshake: [{ ret: { to: P1, amount: '0.2', payload: 'PAY' } }], sendKaspa: [{ ret: OK_TX }] } },
  'S3a DB 已 accepted ⇒ 跳过并记内存; 之后再来走内存去重': { consoleUrl: 'http://console.local', peers: [P1, P1], script: { fetch: [{ json: { status: 'accepted' } }] } },
  'S3b DB 已 active ⇒ 跳过': { consoleUrl: 'http://console.local', peers: [P1], script: { fetch: [{ json: { status: 'active' } }] } },
  'S3c DB 已 confirmed ⇒ 跳过': { consoleUrl: 'http://console.local', peers: [P1], script: { fetch: [{ json: { status: 'confirmed' } }] } },
  'S4 DB 状态 pending(不在跳过集合) ⇒ 照常接受': { consoleUrl: 'http://console.local', peers: [P1], script: { fetch: [{ json: { status: 'pending' } }], acceptHandshake: [{ ret: { to: P1, amount: '0.2', payload: 'PAY' } }], sendKaspa: [{ ret: OK_TX }] } },
  'S5a fetch 抛错 ⇒ 吞掉, 继续接受': { consoleUrl: 'http://console.local', peers: [P1], script: { fetch: [{ throw: 'ECONNREFUSED' }], acceptHandshake: [{ ret: { to: P1, amount: '0.2', payload: 'PAY' } }], sendKaspa: [{ ret: OK_TX }] } },
  'S5b json() 抛错 ⇒ 吞掉, 继续接受': { consoleUrl: 'http://console.local', peers: [P1], script: { fetch: [{ jsonThrow: 'bad json' }], acceptHandshake: [{ ret: { to: P1, amount: '0.2', payload: 'PAY' } }], sendKaspa: [{ ret: OK_TX }] } },
  'S5c 响应体无 status 字段 ⇒ 不跳过': { consoleUrl: 'http://console.local', peers: [P1], script: { fetch: [{ json: {} }], acceptHandshake: [{ ret: { to: P1, amount: '0.2', payload: 'PAY' } }], sendKaspa: [{ ret: OK_TX }] } },
  'S6 无 console(CONSOLE_URL 空) ⇒ 不 fetch, 直接接受': { consoleUrl: '', peers: [P1], script: { acceptHandshake: [{ ret: { to: P1, amount: '0.2', payload: 'PAY' } }], sendKaspa: [{ ret: OK_TX }] } },
  'S7a draft 为 null ⇒ "Accept draft failed", 不入内存(再来一次会重试)': { consoleUrl: '', peers: [P1, P1], script: { acceptHandshake: [{ ret: null }] } },
  'S7b draft 无 payload ⇒ 同上': { consoleUrl: '', peers: [P1, P1], script: { acceptHandshake: [{ ret: { to: P1, amount: '0.2' } }] } },
  'S8 acceptHandshake 抛 ⇒ 错误行, 不发不入库; 再来重试': { consoleUrl: '', peers: [P1, P1], script: { acceptHandshake: [{ throw: 'encrypt failed' }] } },
  'S9 sendKaspa 抛 ⇒ 错误行, 不入内存不入库(NO TX NO STATE); 再来重试': { consoleUrl: '', peers: [P1, P1], script: { acceptHandshake: [{ ret: { to: P1, amount: '0.2', payload: 'PAY' } }], sendKaspa: [{ throw: 'broadcast failed' }] } },
  'S10 sendKaspa 返回裸字符串(无 txId) ⇒ 日志打字符串, traceId 走 Date.now, ingestHandshake txid 为 undefined': { consoleUrl: '', peers: [P1], script: { acceptHandshake: [{ ret: { to: P1, amount: '0.2', payload: 'PAY' } }], sendKaspa: [{ ret: 'raw-string-result' }] } },
  'S11 ingestHandshake 抛 ⇒ 被外层 try 捕获记错误行, 但此前已入内存(再来走内存去重), ingestTx 没调': { consoleUrl: '', peers: [P1, P1], script: { acceptHandshake: [{ ret: { to: P1, amount: '0.2', payload: 'PAY' } }], sendKaspa: [{ ret: OK_TX }], ingestHandshake: [{ throw: 'db locked' }] } },
  'S12 两个不同 peer 互不影响(去重按 peer)': { consoleUrl: '', peers: [P1, P2, P1, P2], script: { acceptHandshake: [{ ret: { to: P1, amount: '0.2', payload: 'PAY1' } }, { ret: { to: P2, amount: '0.2', payload: 'PAY2' } }], sendKaspa: [{ ret: OK_TX }, { ret: { txId: 'bb'.repeat(32), fee: '0.0002' } }] } },
  'S13 首次失败后重试成功(sendKaspa 先抛后成)': { consoleUrl: 'http://console.local', peers: [P1, P1, P1], script: { fetch: [{ json: { status: 'none' } }], acceptHandshake: [{ ret: { to: P1, amount: '0.2', payload: 'PAY' } }], sendKaspa: [{ throw: 'busy' }, { ret: OK_TX }] } },
};

// ── 对照: 每个场景 BEFORE 轨迹 == AFTER 轨迹, 且轨迹非空/含预期关键行(防"两边都空"的空比较) ──────────────────────────
const EXPECT_MARK = {
  'S1': ['acceptHandshake', 'sendKaspa', 'ingestHandshake', 'ingestTx', 'HANDSHAKE ACCEPTED TX:'],
  'S2': ['already accepted (memory)'],
  'S3a': ['in DB, skipping', 'already accepted (memory)'],
  'S7a': ['Accept draft failed:'],
  'S8': ['HANDSHAKE ACCEPT ERROR:'],
  'S9': ['HANDSHAKE ACCEPT ERROR:'],
  'S11': ['HANDSHAKE ACCEPT ERROR:', 'already accepted (memory)'],
};
for (const [name, sc] of Object.entries(SCENARIOS)) {
  await t(`${name}: BEFORE 与 AFTER 的外部调用轨迹逐条相同`, async () => {
    const b = await runScenario(buildBefore, sc);
    const a = await runScenario(buildAfter, sc);
    assert.ok(b.length >= 3, 'BEFORE 轨迹过短(空比较?): ' + b.length);
    assert.deepStrictEqual(a, b);
    const key = name.split(' ')[0];
    for (const m of EXPECT_MARK[key] || []) assert.ok(b.some((l) => l.includes(m)), `BEFORE 轨迹里应含 ${m}(否则场景没走到预期路径)`);
  });
}

await t('对照臂: 关键行确实进了轨迹(S1: 两条入库参数完整; traceId 含 txid; amount 恒 0.2; localAddress 透传)', async () => {
  const tr = await runScenario(buildAfter, SCENARIOS['S1 主路径: 有 console, 关系未建 ⇒ 接受 + 两条入库']);
  const j = tr.join('\n');
  assert.ok(j.includes('fetch ["http://console.local/api/relation/status?local=' + encodeURIComponent(LOCAL) + '&peer=' + encodeURIComponent(P1) + '"]'), 'fetch URL');
  assert.ok(j.includes('handshake:' + OK_TX.txId), 'ingestTx traceId');
  assert.ok(j.includes('"amount":"0.2"'), 'ingestTx amount');
  assert.ok(j.includes('"remoteAddress":"' + P1 + '"'), 'ingestHandshake remoteAddress');
});
await t('S10 的 traceId 用固定 Date.now(证明 Date.now 桩生效, 轨迹可比)', async () => {
  const tr = await runScenario(buildAfter, SCENARIOS['S10 sendKaspa 返回裸字符串(无 txId) ⇒ 日志打字符串, traceId 走 Date.now, ingestHandshake txid 为 undefined']);
  assert.ok(tr.join('\n').includes('handshake:1700000000000'));
});

// ── 实例隔离(工厂闭包): 两个 acceptor 不共享去重状态; 同一实例内共享 ─────────────────────────────────────────────
await t('工厂实例隔离: acceptor A 记住的 peer, acceptor B 仍会接受(去重 Set 在闭包里, 不是模块级)', async () => {
  const sc = SCENARIOS['S6 无 console(CONSOLE_URL 空) ⇒ 不 fetch, 直接接受'];
  const mk = () => makeStubs(sc.script, '');
  const A = mk(), B = mk();
  const a = buildAfter(A.deps), b = buildAfter(B.deps);
  await a(P1); await a(P1); await b(P1);
  assert.strictEqual(A.trace.filter((l) => l.startsWith('sendKaspa')).length, 1, 'A 只发一次');
  assert.strictEqual(B.trace.filter((l) => l.startsWith('sendKaspa')).length, 1, 'B 独立再发一次');
});

// ── 机械"只搬不改"断言 ────────────────────────────────────────────────────────────────────────────────────────────
await t('只搬不改(笔二后): 去掉入口守卫块后, 模块函数体(去缩进两格, consoleUrl→CONSOLE_URL)与 BEFORE 原文里 doAcceptHandshake 逐字相同——除守卫外一字未动', () => {
  const start = MODULE_SRC.indexOf('  return async function doAcceptHandshake(peer) {');
  const end = MODULE_SRC.lastIndexOf('  };\n}');
  assert.ok(start > 0 && end > start, '模块结构锚点');
  const GUARD = "    // 开关(落点 4): poll() 每 tick 都会再命中同一 pending_incoming 会话, 所以日志按 peer 去重; 关闭态不查 console 去重、不 acceptHandshake、不 sendKaspa。\n"
    + '    if (!handshakeAutoAcceptEnabled()) {\n'
    + '      logDisabledOnce(peer, `HANDSHAKE auto-accept disabled (poll) — left pending for ${peer.slice(-12)}`);\n'
    + '      return;\n'
    + '    }\n';
  const fnSrc = MODULE_SRC.slice(start, end + '  }'.length);
  assert.strictEqual(fnSrc.split(GUARD).length - 1, 1, '守卫块应恰一处且形状固定');
  const bodyM = fnSrc.replace(GUARD, '').split('\n').map((l) => l.replace(/^ {2}/, '')).join('\n')
    .replace('return async function doAcceptHandshake(peer) {', 'async function doAcceptHandshake(peer) {')
    .replace(/consoleUrl/g, 'CONSOLE_URL');
  const fnStart = BEFORE_TXT.indexOf('async function doAcceptHandshake(peer) {');
  const bodyB = BEFORE_TXT.slice(fnStart).replace(/\s+$/, '');
  assert.strictEqual(bodyM.replace(/\s+$/, ''), bodyB);
  // 去重 Set 声明行也逐字保留
  assert.ok(MODULE_SRC.includes('const _acceptedPeers = new Set(); // dedup: only accept handshake from each address once'));
  assert.ok(BEFORE_TXT.includes('const _acceptedPeers = new Set(); // dedup: only accept handshake from each address once'));
});
await t('模块只 import 纯函数模块 handshake-switch.mjs(依赖仍全由注入; 不直接读 process.env)', () => {
  const imports = MODULE_SRC.match(/^\s*import\s.*$/gm) || [];
  assert.strictEqual(imports.length, 1, 'import 条数: ' + imports.length);
  assert.ok(/from\s+'\.\/handshake-switch\.mjs'/.test(imports[0]), '唯一 import 应是 ./handshake-switch.mjs');
  assert.ok(!/\bprocess\.env\b/.test(MODULE_SRC.replace(/\/\/.*$/gm, '')), '模块不直接读 env(读取集中在 handshake-switch.mjs)');
});
await t('relay.mjs: 恰一处工厂调用、恰一处 import; 原函数与 _acceptedPeers 已不在 relay.mjs; poll 仍调 doAcceptHandshake', () => {
  const code = RELAY_SRC.replace(/\/\/.*$/gm, '');
  assert.strictEqual((code.match(/createHandshakeAcceptor\(/g) || []).length, 1, '工厂调用数');
  assert.strictEqual((code.match(/import\s*\{\s*createHandshakeAcceptor\s*\}\s*from\s*['"]\.\/lib\/handshake-accept\.mjs['"]/g) || []).length, 1, 'import 数');
  assert.ok(!/_acceptedPeers/.test(code), '_acceptedPeers 仍在 relay.mjs');
  assert.ok(!/function\s+doAcceptHandshake\b/.test(code), '函数定义仍在 relay.mjs');
  assert.strictEqual((code.match(/await\s+doAcceptHandshake\(/g) || []).length, 1, 'poll 调用点');
  // 注入的七个依赖一个不少
  const call = code.slice(code.indexOf('createHandshakeAcceptor({'), code.indexOf('});', code.indexOf('createHandshakeAcceptor({')) + 3);
  for (const k of ['acceptHandshake', 'sendKaspa', 'fetch', 'log', 'ingestHandshake', 'ingestTx', 'consoleUrl: CONSOLE_URL', 'localAddress']) assert.ok(call.includes(k), '注入缺 ' + k);
});
await t('抽取前 relay.mjs 的 doAcceptHandshake 只有一个调用点(poll)——抽取不漏调用方(BEFORE 原文里只定义、不含调用)', () => {
  assert.ok(!/await\s+doAcceptHandshake\(/.test(BEFORE_TXT), 'BEFORE 夹具区间里不该含调用点');
});

// ══ V2c(设计 v0.4 §6.1 / §7.4 / §8.3): 关闭态——零调用 + 每 peer 一行 + 日志上限 ═══════════════════════════════════════════════
const OPEN_SCRIPT = { fetch: [{ json: { status: 'none' } }], acceptHandshake: [{ ret: { to: P1, amount: '0.2', payload: 'PAY' } }], sendKaspa: [{ ret: OK_TX }] };
const withEnv = async (val, fn) => {
  const prev = process.env.RELAY_HANDSHAKE_AUTO_ACCEPT;
  if (val === undefined) delete process.env.RELAY_HANDSHAKE_AUTO_ACCEPT; else process.env.RELAY_HANDSHAKE_AUTO_ACCEPT = val;
  try { return await fn(); } finally { if (prev === undefined) delete process.env.RELAY_HANDSHAKE_AUTO_ACCEPT; else process.env.RELAY_HANDSHAKE_AUTO_ACCEPT = prev; }
};
const externalCalls = (trace) => trace.filter((l) => /^(fetch|acceptHandshake|sendKaspa|ingestHandshake|ingestTx) /.test(l));
const logLines = (trace) => trace.filter((l) => l.startsWith('log '));

for (const [label, val] of [['未设', undefined], ["'0'", '0'], ["'on'", 'on'], ["'true'", 'true'], ["' 1'", ' 1'], ["'1\\n'", '1\n'], ["''", '']]) {
  await t(`V2c 关闭态(${label}): doAcceptHandshake 零 fetch / 零 acceptHandshake / 零 sendKaspa / 零 ingest; 恰一行 "HANDSHAKE auto-accept disabled (poll)"`, async () => {
    await withEnv(val, async () => {
      const { trace, deps } = makeStubs(OPEN_SCRIPT, 'http://console.local');
      const acc = buildAfter(deps);
      await acc(P1);
      assert.deepStrictEqual(externalCalls(trace), [], '关闭态出现外部调用: ' + externalCalls(trace).join(' | '));
      const logs = logLines(trace);
      assert.strictEqual(logs.length, 1, '日志行数 ' + logs.length);
      assert.ok(logs[0].includes('HANDSHAKE auto-accept disabled (poll) — left pending for ' + P1.slice(-12)), logs[0]);
    });
  });
}
await t('V2c 同一 peer 连续 3 个 tick ⇒ 只 1 行(每 peer 每进程一次); 换 peer 各得 1 行; 全程零外部调用', async () => {
  await withEnv(undefined, async () => {
    const { trace, deps } = makeStubs(OPEN_SCRIPT, 'http://console.local');
    const acc = buildAfter(deps);
    await acc(P1); await acc(P1); await acc(P1);
    assert.strictEqual(logLines(trace).length, 1, '3 tick 应 1 行, 实得 ' + logLines(trace).length);
    await acc(P2); await acc(P2);
    assert.strictEqual(logLines(trace).length, 2, '第二个 peer 再 1 行');
    assert.deepStrictEqual(externalCalls(trace), []);
  });
});
await t('V2c 日志上限(§8.3): 1000 个不同 peer 各 1 行; 第 1001 个起恰一行 "suppressing further disabled-peer logs" 后静默; 上限只限日志, 不影响"零调用"', async () => {
  await withEnv(undefined, async () => {
    const { trace, deps } = makeStubs(OPEN_SCRIPT, 'http://console.local');
    const acc = buildAfter(deps);
    for (let i = 0; i < 1005; i++) await acc('kaspatest:qpeer' + String(i).padStart(6, '0') + 'x'.repeat(40));
    const logs = logLines(trace);
    assert.strictEqual(logs.filter((l) => l.includes('left pending for')).length, 1000, '前 1000 个 peer 各 1 行');
    assert.strictEqual(logs.filter((l) => l.includes('suppressing further disabled-peer logs')).length, 1, '上限提示恰一行');
    assert.strictEqual(logs.length, 1001, '总日志行 = 1000 + 1(其后静默)');
    assert.deepStrictEqual(externalCalls(trace), []);
  });
});
await t('V2c 阳性对照 + 每次调用读: 同一 acceptor 关闭态被拒后, env 置 \'1\' 即接受(不记内存: 关闭期间没有把 peer 记成"已接受"); sendKaspa 恰 1 次', async () => {
  const { trace, deps } = makeStubs(OPEN_SCRIPT, 'http://console.local');
  const acc = buildAfter(deps);
  await withEnv(undefined, () => acc(P1));
  assert.deepStrictEqual(externalCalls(trace), []);
  await withEnv('1', () => acc(P1));
  assert.strictEqual(trace.filter((l) => l.startsWith('sendKaspa ')).length, 1, '开启后应恰发 1 次');
  assert.strictEqual(trace.filter((l) => l.startsWith('acceptHandshake ')).length, 1);
});

if (SAVED_ENV === undefined) delete process.env.RELAY_HANDSHAKE_AUTO_ACCEPT; else process.env.RELAY_HANDSHAKE_AUTO_ACCEPT = SAVED_ENV;
console.log(`\nhandshake-accept.test: ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
