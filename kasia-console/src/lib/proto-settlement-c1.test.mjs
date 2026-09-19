// proto-settlement-c1.test.mjs — 批9 9-1 C 笔: C1 调用点模块(设计 v0.3.4 §19.1 / §19.3 / §19.5 的 E、C 两组)。
// 夹具【不手写】(S91-2): 条目由真实 kaspa-wasm UtxoEntryReference 生成, 回执由【真实 9-0 handler】(kasia-relay/src/lib/utxo-facts.mjs 的
//   handleGetAddressUtxos → parseFactsRequest → buildFactsResponse)现场产出; 错误回执也取自真实 handler 抛出的 FactsError 经 relay 外层 catch 的形状
//   ({error, phase:'execution'}, 无 ok 字段)。🟡 诚实边界: 这是"真实 relay 代码对合成 UTXO 集的真实输出", 不是"从真实节点录制的回执"(那需要再起一次
//   simnet, 放 9-4); 与真实节点观察的对齐由 E1b 承担——把 9-0 验收(facts-vs-node.json)里 4 条真实节点观察值重放进 handler, 经 C1 消费方规整后逐字段相等。
// 不做的事: 不连节点、不起 RpcClient、不碰 DB(本文件的临时库只为 import 链, 与 proto-settlement-chain-checks.test.mjs 同款)、零链上副作用。
// 9-1 F1 笔(NWT C 笔审 C-1..C-5 / E 笔审 E-2 与 E-1 的 C 侧): version===0、分级器按 key 分计数、预算/IPC 超时结构性校验 + 可注入定时器、fee 区间复核、evidence/定时器断言、classify 永不返回 null、chainParents 条目带 outpoint。
// 9-1 F4 笔(NWT F1 审 F1-1 / F1-2): requestFacts 收第三参 {timeoutMs: ipcTimeoutMs}(声明 == 交给被调方); timers 退出生产签名, 只在仅测试用的 verifyStepInputsOnChainWithTimers, 并有源码扫描。
// Run: cd kasia-console && node src/lib/proto-settlement-c1.test.mjs
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_C1_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_c1_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_C1_TEST_BOOTSTRAPPED: '1' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}
const kaspa = await import('kaspa-wasm');
const C1 = await import('./proto-settlement-c1.mjs');
const { assertFactsResponse, verifyStepInputsOnChain, verifyStepInputsOnChainWithTimers, filterFeeCandidates, withFeeParent, classifyC1Error, createTransportAlertGrader,
  assertStepBudget, assertFactsIpcTimeout, factsResponseCodes, FactsResponseError, FeeWindowError,
  MIN_STEP_BUDGET_MS, MIN_FACTS_IPC_TIMEOUT_MS } = C1;
const { STEP_INPUT_ROLES, EXPECTED_INPUT_VALUE_SOMPI, SettlementChainCheckError } = await import('./proto-settlement-chain-checks.mjs');
const { SIGNED_INPUT_CEILING_SOMPI } = await import('./proto-tx-assembly.mjs');
const RELAY = await import('../../../kasia-relay/src/lib/utxo-facts.mjs');
const { handleGetAddressUtxos } = RELAY;

let pass = 0, fail = 0;
let unhandled = 0;
process.on('unhandledRejection', () => { unhandled++; });
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 记录式 + 缩放式定时器(可注入 verifyStepInputsOnChain): 记录每次 setTimeout/clearTimeout; scale>1 时把 ms 缩小(20000ms 预算 ÷500 = 40ms 真实), 让"超预算"用例不必真等 20 秒。 */
function recTimers(scale = 1) {
  const log = { set: [], cleared: [] };
  return { log, setTimeout: (fn, ms) => { const id = setTimeout(fn, ms / scale); log.set.push({ id, ms }); return id; }, clearTimeout: (id) => { log.cleared.push(id); return clearTimeout(id); } };
}
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || 'eq'}: 期望 ${String(b)}, 实际 ${String(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const jeq = (a, b, m) => { const x = JSON.stringify(a, (_, v) => (typeof v === 'bigint' ? `${v}n` : v)); const y = JSON.stringify(b, (_, v) => (typeof v === 'bigint' ? `${v}n` : v)); if (x !== y) throw new Error(`${m || 'jeq'}:\n  ${x}\n  != ${y}`); };
async function rejects(fn, klass, code, re) {
  let e = null;
  try { await fn(); } catch (x) { e = x; }
  if (!e) throw new Error(`应该抛 ${klass.name}(${code}), 实际成功返回`);
  if (!(e instanceof klass)) throw new Error(`应该是 ${klass.name}, 实际 ${e && e.constructor && e.constructor.name}: ${e && e.message}`);
  if (e.code !== code) throw new Error(`期望 code=${code}, 实际 ${e.code}: ${e.message}`);
  if (re && !re.test(e.message)) throw new Error(`报文不符 ${re}: ${e.message}`);
  return e;
}
const throwsSync = (fn, klass, code) => { let e = null; try { fn(); } catch (x) { e = x; } if (!e) throw new Error(`应该抛 ${code}`); if (!(e instanceof klass) || e.code !== code) throw new Error(`期望 ${klass.name}/${code}, 实际 ${e.constructor.name}/${e.code}: ${e.message}`); return e; };

// ── 夹具(条目由真实 kaspa-wasm 生成; 与 kasia-relay/src/lib/utxo-facts.test.mjs 的 realRef/realEntry 同款) ────────────────────────────────
const NET = 'simnet';
const RELAY_SPK = '20' + 'cd'.repeat(32) + 'ac';                                                    // 普通 P2PK 形状(relay 自己的 fee 输入)
const spkOf = (role) => 'aa20' + Buffer.from(role.padEnd(32, '_')).toString('hex') + '87';          // 各角色互不相同的 P2SH 形 spk(夹具, 非真实脚本)
const txidOf = (label) => Buffer.from(label.padEnd(32, '_').slice(0, 32)).toString('hex');           // 64 位小写 hex
const covOf = (role) => Buffer.from('cov-' + role).toString('hex').padEnd(64, '0');
const addrOf = (spkHex) => kaspa.addressFromScriptPublicKey(new kaspa.ScriptPublicKey(0, spkHex), NET).toString();

function realRef({ txidHex, index, amount, spkHex, version = 0 }) {
  const spk = new kaspa.ScriptPublicKey(version, spkHex);
  const outpoint = { transactionId: txidHex, index };
  return new kaspa.Transaction({
    version: 1, lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
    inputs: [{ previousOutpoint: outpoint, signatureScript: '', sequence: 0n, sigOpCount: 0, computeBudget: 0, utxo: { outpoint, amount, scriptPublicKey: spk, blockDaaScore: 4335n } }],
    outputs: [new kaspa.TransactionOutput(1000n, spk)],
  }).inputs[0].utxo;                                                                                  // 真实 UtxoEntryReference
}
function realEntry({ txidHex, index = 0, amount = 20000000n, spkHex, covenantIdHex = null, version = 0 }) {
  const ref = realRef({ txidHex, index, amount, spkHex, version });
  if (covenantIdHex === null) return ref;
  const inner = ref.entry;                                                                            // getter 每次返回新克隆, 无法就地改 ⇒ 换成设置过 covenantId 的真实 UtxoEntry
  inner.covenantId = new kaspa.Hash(covenantIdHex);
  return Object.create(ref, { entry: { value: inner, enumerable: true } });
}

// 假 relay: 请求经【真实 9-0 handler】; handler 抛的 FactsError 经 relay 外层 catch 变成 {error, phase:'execution'}(无 ok)。
function makeRelay(byAddr, { delayMs = 0, override } = {}) {
  const calls = [];
  const requestFacts = async (address, payload, opts) => {
    calls.push({ address, payload, opts, t: Date.now() });
    if (override) { const o = await override(address, payload, calls.length); if (o !== undefined) return o.res; }
    if (delayMs) await sleep(delayMs);
    try {
      return await handleGetAddressUtxos({
        cmd: { type: 'get_address_utxos', address, ...payload },
        getSharedRpc: async () => ({ getUtxosByAddresses: async () => ({ entries: byAddr[address] || [] }) }),
        legacyGetAddressUtxos: async () => [{ outpoint: { transactionId: txidOf('legacy'), index: 0 }, amount: '1' }],
        getNetworkId: () => NET,
      });
    } catch (e) { return { error: e.message, phase: 'execution' }; }
  };
  return { requestFacts, calls };
}

const FEE_DEFAULT = () => [
  realEntry({ txidHex: txidOf('fee-small'), index: 0, amount: 25000000n, spkHex: RELAY_SPK }),      // 低于 minAmount(30M): 真实 handler 过滤掉
  realEntry({ txidHex: txidOf('fee-a'), index: 0, amount: 40000000n, spkHex: RELAY_SPK }),
  realEntry({ txidHex: txidOf('fee-b'), index: 1, amount: 90000000n, spkHex: RELAY_SPK }),
  realEntry({ txidHex: txidOf('fee-huge'), index: 0, amount: 150000000n, spkHex: RELAY_SPK }),     // 高于 maxAmount(1.0 KAS 签名上限): 真实 handler 过滤掉
];
const FEE_MIN = 30000000n;

function scenario(step, { fee = FEE_DEFAULT, noise = true } = {}) {
  const roles = STEP_INPUT_ROLES[step];
  const pointers = { roles: {} };
  const byAddr = {};
  const expectedSpks = {};
  const where = {};
  roles.forEach((role, i) => {
    const op = { transactionId: txidOf(`tx-${step}-${role}`), index: i };
    const cov = role === 'ticket' ? null : covOf(role);
    pointers.roles[role] = { outpoint: op, expectedCovenantId: cov };
    expectedSpks[role] = spkOf(role);
    const a = addrOf(spkOf(role));
    (byAddr[a] ||= []);
    where[role] = { addr: a, idx: byAddr[a].length };
    byAddr[a].push(realEntry({ txidHex: op.transactionId, index: op.index, amount: EXPECTED_INPUT_VALUE_SOMPI[role], spkHex: spkOf(role), covenantIdHex: cov }));
    if (noise) {   // 同 txid 另一个 index、同 spk 同面值的诱饵(N-T1 同族): 形态 O 按 txid:index 精确, 不该被当成目标
      byAddr[a].push(realEntry({ txidHex: op.transactionId, index: op.index + 7, amount: EXPECTED_INPUT_VALUE_SOMPI[role], spkHex: spkOf(role), covenantIdHex: cov }));
    }
  });
  byAddr[addrOf(RELAY_SPK)] = fee();
  return { step, roles, pointers, byAddr, expectedSpks, where };
}
const argsOf = (sc, relay, over = {}) => ({
  step: sc.step, pointers: sc.pointers, expectedSpks: sc.expectedSpks, network: NET, requestFacts: relay.requestFacts, kaspa,
  relaySpkHex: RELAY_SPK, feeMinAmount: FEE_MIN, inflightOutpoints: [], budgetMs: 20000, tickIntervalMs: 60000, ipcTimeoutMs: 20000, ...over,
});
// F4: timers 不能经生产入口传入——带 timers 的调用走仅测试用的 verifyStepInputsOnChainWithTimers
const callVerify = (a) => { const { timers, ...rest } = a; return timers ? verifyStepInputsOnChainWithTimers(rest, timers) : verifyStepInputsOnChain(rest); };
const run = (step, { relayOpts, over, scOpts } = {}) => { const sc = scenario(step, scOpts); const relay = makeRelay(sc.byAddr, relayOpts); return { sc, relay, p: () => callVerify(argsOf(sc, relay, over)) }; };
const withEntry = (sc, role, entry) => { const { addr, idx } = sc.where[role]; const byAddr = { ...sc.byAddr, [addr]: sc.byAddr[addr].slice() }; if (entry === null) byAddr[addr].splice(idx, 1); else byAddr[addr][idx] = entry; return { ...sc, byAddr }; };
const targetEntry = (sc, role, over = {}) => { const p = sc.pointers.roles[role]; return realEntry({ txidHex: p.outpoint.transactionId, index: p.outpoint.index, amount: EXPECTED_INPUT_VALUE_SOMPI[role], spkHex: spkOf(role), covenantIdHex: p.expectedCovenantId, ...over }); };

// ── E 组: assertFactsResponse ───────────────────────────────────────────────────────────────────────────────────────
const E_ADDR_SPK = spkOf('e-role');
const E_T = txidOf('e-tx');
const E_ENTRIES = [
  realEntry({ txidHex: E_T, index: 0, amount: 20000000n, spkHex: E_ADDR_SPK, covenantIdHex: covOf('e0') }),
  realEntry({ txidHex: E_T, index: 1, amount: 20000000n, spkHex: E_ADDR_SPK, covenantIdHex: covOf('e1') }),
  realEntry({ txidHex: E_T, index: 2, amount: 100000000n, spkHex: E_ADDR_SPK }),
];
const E_BY = { [addrOf(E_ADDR_SPK)]: E_ENTRIES };
const E_REQ = [{ transactionId: E_T, index: 0 }, { transactionId: E_T, index: 1 }, { transactionId: E_T, index: 5 }];   // index 5 不存在 ⇒ missing
const eO = async () => makeRelay(E_BY).requestFacts(addrOf(E_ADDR_SPK), { facts: true, outpoints: E_REQ });
const eL = async () => makeRelay(E_BY).requestFacts(addrOf(E_ADDR_SPK), { facts: true, minAmount: '0', maxAmount: '200000000' });
const clone = (x) => structuredClone(x);
const RO = await eO();        // 真实 handler 产出的形态 O / 形态 L 回执(各测试 clone 后再变异)
const RL = await eL();
const O = { form: 'outpoints', requested: E_REQ };
const L = { form: 'list' };
const rejE = (fn, code) => rejects(async () => fn(), FactsResponseError, code);

await t('E1 形态 O 与形态 L 各一个 ok 路径(回执由真实 9-0 handler 对真实 wasm 条目产出): 规整后字段正确, covenantId 键齐全', async () => {
  const o = assertFactsResponse(await eO(), O);
  eq(o.found.length, 2); jeq(o.missing, [{ transactionId: E_T, index: 5 }]);
  eq(o.found[0].amount, 20000000n); eq(o.found[0].covenantId, covOf('e0')); eq(o.found[0].scriptPublicKey.scriptHex, E_ADDR_SPK); eq(o.found[0].scriptPublicKey.version, 0);
  const l = assertFactsResponse(await eL(), L);
  eq(l.utxos.length, 3); eq(l.truncated, false);
  eq(l.utxos[0].amount, 100000000n); eq(l.utxos[0].covenantId, null);                     // 面值降序, 普通 P2SH 的 covenantId 键在且为 null
});
await t('E1b 与真实节点观察对齐: 9-0 验收 facts-vs-node.json 的 4 条真实节点 UTXO 重放进真实 handler, 经消费方规整后逐字段等于当时记录的 S1_relay', async () => {
  const J = JSON.parse(fs.readFileSync(new URL('../../../docs/provenance/2026-09-19-j2-batch9-0-facts-vs-node/facts-vs-node.json', import.meta.url), 'utf8'));
  eq(J.rows.length, 4);
  const byAddr = {}; const requested = [];
  for (const r of J.rows) {
    const [txid, idx] = r.key.split(':');
    (byAddr.A ||= []).push(realEntry({ txidHex: txid, index: Number(idx), amount: BigInt(r.S1_relay.amount), spkHex: r.S1_relay.scriptHex, covenantIdHex: r.S1_relay.covenantId }));
    requested.push({ transactionId: txid, index: Number(idx) });
  }
  const res = assertFactsResponse(await makeRelay(byAddr).requestFacts('A', { facts: true, outpoints: requested }), { form: 'outpoints', requested });
  eq(res.found.length, 4); eq(res.missing.length, 0);
  res.found.forEach((it, i) => jeq({ key: `${it.outpoint.transactionId}:${it.outpoint.index}`, amount: it.amount.toString(), version: it.scriptPublicKey.version, scriptHex: it.scriptPublicKey.scriptHex, covenantId: it.covenantId }, J.rows[i].S1_relay, `row ${i}`));
});
await t('E2 ▲ 真实错误回执 {error, phase:"execution"}(无 ok 字段, 由真实 handler 对非法请求产出)⇒ facts_relay_error, 原文原样保留', async () => {
  const bad = await makeRelay(E_BY).requestFacts(addrOf(E_ADDR_SPK), { facts: true, outpoints: [] });          // parseFactsRequest 抛 FactsError → 外层 catch 形状
  ok(bad.ok === undefined && typeof bad.error === 'string' && bad.phase === 'execution', `真实错误回执形状不符: ${JSON.stringify(bad)}`);
  const e = await rejE(() => assertFactsResponse(bad, O), 'facts_relay_error');
  eq(e.relayError, bad.error); eq(e.relayPhase, 'execution');
  ok(e.detail.includes(bad.error), 'detail 必须带 relay 原文');
  await rejE(() => assertFactsResponse({ error: { code: 'x' }, phase: 'execution' }, O), 'facts_relay_error');   // 非字符串 error 也拒
});
await t('E3 ▲ ok 必须严格 === true: undefined / 1 / "true" / false 各拒 ⇒ facts_not_ok', async () => {
  for (const v of [undefined, 1, 'true', false, null]) { const r = clone(await eO()); if (v === undefined) delete r.ok; else r.ok = v; await rejE(() => assertFactsResponse(r, O), 'facts_not_ok'); }
});
await t('E4 ▲ 回声: facts 缺失/不是 true ⇒ facts_echo_missing; factsVersion 为 0 / 2 / "1" / 缺失 ⇒ facts_version_mismatch', async () => {
  for (const v of [undefined, false, 'true', 1]) { const r = clone(await eO()); if (v === undefined) delete r.facts; else r.facts = v; await rejE(() => assertFactsResponse(r, O), 'facts_echo_missing'); }
  for (const v of [0, 2, '1', undefined]) { const r = clone(await eO()); if (v === undefined) delete r.factsVersion; else r.factsVersion = v; await rejE(() => assertFactsResponse(r, O), 'facts_version_mismatch'); }
});
await t('E5 ▲ form 与请求不符 ⇒ facts_form_mismatch(O 回执配 L 请求, L 回执配 O 请求)', async () => {
  await rejE(() => assertFactsResponse(clone(RO), L), 'facts_form_mismatch');
  await rejE(() => assertFactsResponse(clone(RL), O), 'facts_form_mismatch');
});
await t('E6 形态 O 带 truncated(哪怕 false)/ found 非数组 / missing 非数组; 形态 L 的 truncated 非 boolean / utxos 非数组 ⇒ facts_shape_invalid', async () => {
  const o = () => clone(RO); const l = () => clone(RL);
  { const r = o(); r.truncated = false; await rejE(() => assertFactsResponse(r, O), 'facts_shape_invalid'); }
  { const r = o(); r.found = {}; await rejE(() => assertFactsResponse(r, O), 'facts_shape_invalid'); }
  { const r = o(); delete r.missing; await rejE(() => assertFactsResponse(r, O), 'facts_shape_invalid'); }
  { const r = l(); r.truncated = 'no'; await rejE(() => assertFactsResponse(r, L), 'facts_shape_invalid'); }
  { const r = l(); delete r.truncated; await rejE(() => assertFactsResponse(r, L), 'facts_shape_invalid'); }
  { const r = l(); r.utxos = null; await rejE(() => assertFactsResponse(r, L), 'facts_shape_invalid'); }
  for (const bad of [null, undefined, [], 'x', 5]) await rejE(() => assertFactsResponse(bad, O), 'facts_shape_invalid');
});
await t('E7 ▲ 条目缺键 ⇒ facts_item_key_missing(缺 covenantId 键 / 缺 scriptHex / 缺 scriptPublicKey / 缺 outpoint / 缺 amount); 两种形态都查', async () => {
  for (const [name, mut] of [['covenantId', (i) => delete i.covenantId], ['scriptHex', (i) => delete i.scriptPublicKey.scriptHex], ['scriptPublicKey', (i) => delete i.scriptPublicKey], ['outpoint', (i) => delete i.outpoint], ['amount', (i) => delete i.amount]]) {
    { const r = clone(RO); mut(r.found[0]); await rejE(() => assertFactsResponse(r, O), 'facts_item_key_missing'); }
    { const r = clone(RL); mut(r.utxos[0]); await rejE(() => assertFactsResponse(r, L), 'facts_item_key_missing'); }
    void name;
  }
});
await t('E12 条目格式范围 ⇒ facts_shape_invalid(index 超 uint32 / 负 / 小数; version 超 65535; amount 超 u64 / 非十进制 / 是 number; hex 大写 / 奇数长度; covenantId 大写 / 63 位 / undefined 值)', async () => {
  const cases = [
    (i) => { i.outpoint.index = 4294967296; }, (i) => { i.outpoint.index = -1; }, (i) => { i.outpoint.index = 1.5; },
    (i) => { i.scriptPublicKey.version = 65536; }, (i) => { i.scriptPublicKey.version = -1; },
    (i) => { i.amount = '18446744073709551616'; }, (i) => { i.amount = 'abc'; }, (i) => { i.amount = 20000000; }, (i) => { i.amount = '007'; },
    (i) => { i.scriptPublicKey.scriptHex = i.scriptPublicKey.scriptHex.toUpperCase(); }, (i) => { i.scriptPublicKey.scriptHex = 'abc'; }, (i) => { i.scriptPublicKey.scriptHex = ''; },
    (i) => { i.outpoint.transactionId = i.outpoint.transactionId.toUpperCase(); },
    (i) => { i.covenantId = covOf('e0').toUpperCase(); }, (i) => { i.covenantId = covOf('e0').slice(1); }, (i) => { i.covenantId = undefined; },
  ];
  for (const mut of cases) {
    { const r = clone(RO); mut(r.found[0]); await rejE(() => assertFactsResponse(r, O), 'facts_shape_invalid'); }
    { const r = clone(RL); mut(r.utxos[0]); await rejE(() => assertFactsResponse(r, L), 'facts_shape_invalid'); }
  }
  { const r = clone(RO); r.missing[0].index = 4294967296; await rejE(() => assertFactsResponse(r, O), 'facts_shape_invalid'); }
  { const r = clone(RO); r.missing[0].transactionId = 'zz'; await rejE(() => assertFactsResponse(r, O), 'facts_shape_invalid'); }
});
await t('E8 ▲ found∪missing 必须按 txid:index 精确等于请求 ⇒ facts_set_mismatch(缺一项 / 多一项 / 重复 / 同 txid 不同 index[N-T1 同族] / 同时在 found 与 missing)', async () => {
  const o = () => clone(RO);
  { const r = o(); r.missing = []; await rejE(() => assertFactsResponse(r, O), 'facts_set_mismatch'); }                              // 缺一项
  { const r = o(); r.missing.push({ transactionId: txidOf('other'), index: 0 }); await rejE(() => assertFactsResponse(r, O), 'facts_set_mismatch'); }   // 请求之外
  { const r = o(); r.found.push(clone(r.found[0])); await rejE(() => assertFactsResponse(r, O), 'facts_set_mismatch'); }            // 重复
  { const r = o(); r.found[0].outpoint.index = 2; await rejE(() => assertFactsResponse(r, O), 'facts_set_mismatch'); }               // 同 txid 但 index 2 不在请求里(index 0 也就漏了)
  { const r = o(); r.missing.push({ transactionId: E_T, index: 0 }); await rejE(() => assertFactsResponse(r, O), 'facts_set_mismatch'); }   // 同时在 found 与 missing
  { const r = o(); [r.found[0].outpoint.index, r.found[1].outpoint.index] = [1, 0]; assertFactsResponse(r, O); }                     // 顺序/互换只要集合相等仍通过(不依赖顺序)
});
await t('E9 旧 relay 模拟(真实 handler 的旧路径: 忽略 facts, 只回 {ok:true, utxos:[{outpoint,amount}]})⇒ facts_echo_missing', async () => {
  const old = await handleGetAddressUtxos({ cmd: { type: 'get_address_utxos', address: 'A' }, getSharedRpc: async () => { throw new Error('unused'); }, legacyGetAddressUtxos: async () => [{ outpoint: { transactionId: txidOf('legacy'), index: 0 }, amount: '1' }], getNetworkId: () => NET });
  jeq(Object.keys(old), ['ok', 'utxos']);
  await rejE(() => assertFactsResponse(old, O), 'facts_echo_missing');
  await rejE(() => assertFactsResponse(old, L), 'facts_echo_missing');
});
await t('E11 relay 回 {}(sendCommandAsync 在回执缺 result 时 resolve {})⇒ facts_not_ok', async () => { await rejE(() => assertFactsResponse({}, O), 'facts_not_ok'); });
await t('E13 requested 自身有问题是调用方 bug ⇒ facts_requested_invalid, 且先于回执判定(回执是垃圾也一样)', async () => {
  const d = E_REQ[0];
  for (const req of [{ form: 'outpoints', requested: [d, d] }, { form: 'outpoints', requested: [] }, { form: 'outpoints', requested: undefined },
    { form: 'outpoints', requested: Array.from({ length: 9 }, (_, i) => ({ transactionId: E_T, index: i })) },
    { form: 'outpoints', requested: [{ transactionId: 'AB', index: 0 }] }, { form: 'outpoints', requested: [{ transactionId: E_T, index: -1 }] },
    { form: 'nope' }, {}, undefined]) {
    await rejE(() => assertFactsResponse(clone(RO), req), 'facts_requested_invalid');
    await rejE(() => assertFactsResponse(null, req), 'facts_requested_invalid');
  }
});
await t('闭集: factsResponseCodes() = 设计 §19.1 的 10 个 + facts_step_budget_exceeded(超出设计文字); 冻结; 抛出的每个 FactsResponseError 的 code 都在其中', async () => {
  const codes = factsResponseCodes();
  eq(codes.length, 11); ok(Object.isFrozen(codes), '必须冻结');
  for (const c of ['facts_shape_invalid', 'facts_relay_error', 'facts_not_ok', 'facts_echo_missing', 'facts_version_mismatch', 'facts_form_mismatch', 'facts_item_key_missing', 'facts_set_mismatch', 'facts_transport_error', 'facts_requested_invalid', 'facts_step_budget_exceeded']) ok(codes.includes(c), `缺 ${c}`);
  for (const bad of [null, {}, { error: 'x' }, { ok: true }, { ok: true, facts: true }]) { try { assertFactsResponse(bad, O); } catch (e) { ok(e instanceof FactsResponseError && codes.includes(e.code), `${e.code} 不在闭集`); } }
});

// ── C 组: verifyStepInputsOnChain ───────────────────────────────────────────────────────────────────────────────────
const ALL_STEPS = Object.keys(STEP_INPUT_ROLES);
await t('C1 正向: 每个步骤(6 个)全过; 每个角色地址恰一次形态 O(带精确 outpoints)+ 一次形态 L(fee, minAmount/maxAmount 为十进制字符串); chainParents 来自经断言的链上事实', async () => {
  for (const step of ALL_STEPS) {
    const { sc, relay, p } = run(step);
    const r = await p();
    const addrs = new Set(sc.roles.map((role) => sc.where[role].addr));
    const oCalls = relay.calls.filter((c) => c.payload.outpoints); const lCalls = relay.calls.filter((c) => !c.payload.outpoints);
    eq(oCalls.length, addrs.size, `${step}: 形态 O 次数`); eq(lCalls.length, 1, `${step}: 形态 L 次数`); eq(relay.calls.length, addrs.size + 1);
    for (const c of oCalls) { eq(c.payload.facts, true); ok(c.payload.minAmount === undefined && c.payload.maxAmount === undefined, 'O 不得带区间'); }
    eq(lCalls[0].address, addrOf(RELAY_SPK)); eq(lCalls[0].payload.minAmount, FEE_MIN.toString()); eq(lCalls[0].payload.maxAmount, SIGNED_INPUT_CEILING_SOMPI.toString());
    for (const role of sc.roles) {
      const want = sc.pointers.roles[role];
      eq(r.chainUtxos[role].outpoint.transactionId, want.outpoint.transactionId); eq(r.chainUtxos[role].outpoint.index, want.outpoint.index);
      eq(r.chainUtxos[role].value, EXPECTED_INPUT_VALUE_SOMPI[role]); eq(r.chainUtxos[role].spent, false);
      jeq(r.chainParents[role], { value: EXPECTED_INPUT_VALUE_SOMPI[role], spkLen: spkOf(role).length / 2, hasCovenant: want.expectedCovenantId !== null, outpoint: { txid: want.outpoint.transactionId, index: want.outpoint.index } }, `${step}/${role} chainParents`);
    }
    jeq(Object.keys(r.chainParents), sc.roles);
    eq(r.fee.status, 'ok'); ok(r.fee.candidates.length === 2, `fee 候选应只剩两个干净的(40M、90M), 实际 ${r.fee.candidates.length}`);
    jeq(r.fee.candidates.map((c) => c.value).sort(), [40000000n, 90000000n]);          // 25M 被 minAmount、150M 被 maxAmount 在【真实 handler】里过滤
  }
});
const CELLS = [['seal', 'leaf'], ['seal', 'held'], ['close_commit', 'rootClose'], ['convert_to_claim', 'rootClose'], ['convert_to_claim', 'held'], ['claim_draw', 'rootClaim'], ['claim_draw', 'ticket'], ['claim_draw', 'held']];
await t('C1 ▲ 8 个 S10 格 × 负向(缺失 / 面值偏低 / 偏高 / 只有同 spk 同面值同 txid 的诱饵 outpoint / spk 错 / covenant 分类错)= 逐格断言精确 code, 全部 fail-closed', async () => {
  let n = 0;
  for (const [step, role] of CELLS) {
    const sc0 = scenario(step);
    const runOn = (sc) => verifyStepInputsOnChain(argsOf(sc, makeRelay(sc.byAddr)));
    const V = EXPECTED_INPUT_VALUE_SOMPI[role];
    const cov = sc0.pointers.roles[role].expectedCovenantId;
    const chk = async (label, sc, code, re) => { await rejects(() => runOn(sc), SettlementChainCheckError, code, re); n++; void label; };
    await chk('缺失', withEntry(sc0, role, null), `${role}_value_drift`, /查不到/);
    await chk('面值偏低', withEntry(sc0, role, targetEntry(sc0, role, { amount: V - 1n })), `${role}_value_drift`);
    await chk('面值偏高', withEntry(sc0, role, targetEntry(sc0, role, { amount: V + 1n })), `${role}_value_drift`);
    // 目标 outpoint 不在, 但同 txid 另一 index、同 spk 同面值的诱饵在(noise 已放): 不得被当成目标
    await chk('诱饵', withEntry(sc0, role, null), `${role}_value_drift`, /查不到/);
    await chk('spk 错', withEntry(sc0, role, targetEntry(sc0, role, { spkHex: spkOf('zz-other') })), `${role}_spk_drift`);
    if (cov === null) await chk('期望无 covenant 却有', withEntry(sc0, role, targetEntry(sc0, role, { covenantIdHex: covOf('evil') })), `${role}_covenant_class_mismatch`);
    else {
      await chk('期望 covenant 却无', withEntry(sc0, role, targetEntry(sc0, role, { covenantIdHex: null })), `${role}_covenant_class_mismatch`);
      await chk('covenant id 不同', withEntry(sc0, role, targetEntry(sc0, role, { covenantIdHex: covOf('evil') })), `${role}_covenant_class_mismatch`);
    }
  }
  ok(n >= 32, `负向用例数 ${n} < 32`);
});
await t('C2 ▲ 角色输入必须走形态 O(按 outpoint 精确), 不走形态 L: 地址上撒 250 个面值更高的 dust(形态 L 的 200 条窗口会把目标挤出去)仍能取到目标; 形态 L 只发给 relay 的 fee 地址', async () => {
  const sc = scenario('seal');
  const leafAddr = sc.where.leaf.addr;
  for (let i = 0; i < 250; i++) sc.byAddr[leafAddr].push(realEntry({ txidHex: txidOf(`dust-${i}`), index: 0, amount: 30000000n, spkHex: spkOf('leaf') }));
  const relay = makeRelay(sc.byAddr);
  const r = await verifyStepInputsOnChain(argsOf(sc, relay));
  eq(r.chainUtxos.leaf.value, EXPECTED_INPUT_VALUE_SOMPI.leaf);
  for (const c of relay.calls) if (c.address !== addrOf(RELAY_SPK)) ok(Array.isArray(c.payload.outpoints) && c.payload.minAmount === undefined, `角色地址收到了非形态 O 的请求: ${JSON.stringify(c.payload)}`);
});
await t('C3 传输/relay 错误 ⇒ verify 抛错(不返回任何半成品 ⇒ 驱动不推进意图状态); 分类为 settlement_facts_transport_error, 不混报成 settlement_chain_fact_drift', async () => {
  for (const [label, override, code] of [
    ['reject 超时', () => { throw new Error('Relay command timeout after 15s'); }, 'facts_transport_error'],
    ['reject 无 relay', () => Promise.reject(new Error('Relay not running')), 'facts_transport_error'],
    ['relay 错误回执', () => ({ res: { error: 'facts_rpc_timeout: getUtxosByAddresses 超过 5000ms 未返回', phase: 'execution' } }), 'facts_relay_error'],
    ['relay 回 {}', () => ({ res: {} }), 'facts_not_ok'],
  ]) {
    const { p } = run('convert_to_claim', { relayOpts: { override } });
    const e = await rejects(p, FactsResponseError, code); const c = classifyC1Error(e);
    eq(c.eventType, 'settlement_facts_transport_error', label); ok(c.eventType !== 'settlement_chain_fact_drift', label);
  }
  // 对照: 真正的链上事实缺失是 SettlementChainCheckError/*_value_drift ⇒ settlement_chain_fact_drift(与上面的传输类不同类)
  const sc = withEntry(scenario('seal'), 'leaf', null);
  const e = await rejects(() => verifyStepInputsOnChain(argsOf(sc, makeRelay(sc.byAddr))), SettlementChainCheckError, 'leaf_value_drift');
  eq(classifyC1Error(e).eventType, 'settlement_chain_fact_drift');
});
await t('E10 ▲ requestFacts 抛 "Relay command timeout after 15s" / "Relay not running"(reject, 含同步 throw)⇒ facts_transport_error, .detail 带原 message; 不是裸 Error 逃出', async () => {
  for (const [override, msg] of [[async () => { throw new Error('Relay command timeout after 15s'); }, /timeout after 15s/], [() => Promise.reject(new Error('Relay not running')), /Relay not running/], [() => { throw new TypeError('sync boom'); }, /sync boom/]]) {
    const { p } = run('seal', { relayOpts: { override } });
    const e = await rejects(p, FactsResponseError, 'facts_transport_error'); ok(msg.test(e.detail), `detail 丢了原 message: ${e.detail}`);
  }
});
await t('C4 每步总预算超出 ⇒ facts_step_budget_exceeded(本 tick 放弃、不返回), 且计时器已清、晚到的回执不产生 unhandledRejection; 预算内正常完成不受影响', async () => {
  const before = unhandled;
  const t0 = Date.now();
  const tm = recTimers(500);                                                                           // 20000ms 预算缩放成 40ms 真实(F1: 定时器可注入, 不必真等 20 秒)
  const { p } = run('seal', { relayOpts: { delayMs: 400 }, over: { timers: tm } });
  const e = await rejects(p, FactsResponseError, 'facts_step_budget_exceeded');
  ok(Date.now() - t0 < 300, `应在预算附近放弃, 实际 ${Date.now() - t0}ms`); eq(classifyC1Error(e).transient, true);
  await sleep(600);                                                                                    // 让晚到的回执落地
  eq(unhandled, before, '晚到的回执/失败不得变成 unhandledRejection');
  await run('seal', { relayOpts: { delayMs: 20 } }).p();                                               // 预算内正常完成(真实定时器)
});
await t('C5 fee 选取跳过毒化候选: 形态 L 返回里混入 covenantId != null 的 relay-P2PK UTXO 与外来 spk 的条目 ⇒ 被跳过(不是中止、不回落), 事件 fee_candidate_poisoned_skipped {count}', async () => {
  const fee = () => [
    realEntry({ txidHex: txidOf('poison-1'), index: 0, amount: 50000000n, spkHex: RELAY_SPK, covenantIdHex: covOf('p1') }),    // 第三方给 relay 地址造的 covenant 绑定 UTXO
    realEntry({ txidHex: txidOf('poison-2'), index: 0, amount: 60000000n, spkHex: RELAY_SPK, covenantIdHex: covOf('p2') }),
    realEntry({ txidHex: txidOf('foreign'), index: 0, amount: 70000000n, spkHex: 'aa20' + 'ff'.repeat(32) + '87' }),          // spk ≠ relay P2PK
    realEntry({ txidHex: txidOf('clean'), index: 0, amount: 40000000n, spkHex: RELAY_SPK }),
  ];
  const { p } = run('close_commit', { scOpts: { fee } });
  const r = await p();
  eq(r.fee.candidates.length, 1); eq(r.fee.candidates[0].txid, txidOf('clean')); eq(r.fee.skippedPoisoned, 3);
  jeq(r.events, [{ eventType: 'fee_candidate_poisoned_skipped', level: 'warn', payload: { count: 3 } }]);
});
await t('C8 ▲ 并发请求中任一个失败 ⇒ 整步 fail-closed(claim_draw 的 3 个形态 O 与 1 个形态 L 各失败一次, 每次都必须抛、不返回)', async () => {
  const sc = scenario('claim_draw');
  for (let k = 1; k <= 4; k++) {
    const relay = makeRelay(sc.byAddr, { override: (a, pl, n) => (n === k ? { res: { error: 'facts_rpc_timeout', phase: 'execution' } } : undefined) });
    await rejects(() => verifyStepInputsOnChain(argsOf(sc, relay)), FactsResponseError, 'facts_relay_error');
    eq(relay.calls.length, 4, `第 ${k} 个失败时 4 个请求应都已并发发出`);
  }
});
const feeSc = (fee) => ({ scOpts: { fee } });
await t('C9 fee 窗口: 全被毒化跳过 ⇒ FeeWindowError(fee_window_saturated)带 error 级 settlement_fee_window_saturated 与 warn 级 fee_candidate_poisoned_skipped; 空窗口 ⇒ no_suitable_fee_utxo(无饱和报警); 我方在途产出被排除; minAmount 生效', async () => {
  const poison = (n) => () => Array.from({ length: n }, (_, i) => realEntry({ txidHex: txidOf(`pz-${i}`), index: 0, amount: 50000000n, spkHex: RELAY_SPK, covenantIdHex: covOf('pz') }));
  { const e = await rejects(run('seal', feeSc(poison(3))).p, FeeWindowError, 'fee_window_saturated');
    const ev = e.events.map((x) => `${x.eventType}/${x.level}`); jeq(ev, ['fee_candidate_poisoned_skipped/warn', 'settlement_fee_window_saturated/error']); eq(e.events[0].payload.count, 3);
    eq(classifyC1Error(e).eventType, 'settlement_fee_window_saturated'); }
  { const e = await rejects(run('seal', feeSc(() => [])).p, FeeWindowError, 'no_suitable_fee_utxo'); eq(e.events.length, 0); eq(classifyC1Error(e).eventType, 'settlement_no_suitable_fee_utxo'); }
  { const e = await rejects(run('seal', feeSc(() => [realEntry({ txidHex: txidOf('tiny'), index: 0, amount: 1000n, spkHex: RELAY_SPK })])).p, FeeWindowError, 'no_suitable_fee_utxo'); void e; }   // minAmount(30M)把它挡在窗口外
  { // 在途: 唯一干净候选是我方在途意图的产出 ⇒ 排除, 而且不是 saturated
    const only = () => [realEntry({ txidHex: txidOf('mine'), index: 1, amount: 40000000n, spkHex: RELAY_SPK })];
    const e = await rejects(run('seal', { ...feeSc(only), over: { inflightOutpoints: [{ transactionId: txidOf('mine'), index: 1 }] } }).p, FeeWindowError, 'no_suitable_fee_utxo'); eq(e.fee.skippedInflight, 1);
    const r = await run('seal', { ...feeSc(only), over: { inflightOutpoints: [{ transactionId: txidOf('mine'), index: 0 }] } }).p(); eq(r.fee.candidates.length, 1);   // 同 txid 别的 index 不算
  }
  { // 窗口被截断且全是毒化: 250 个 covenant 绑定的候选 ⇒ 真实 handler 截断到 200, truncated=true ⇒ saturated
    const e = await rejects(run('seal', feeSc(poison(250))).p, FeeWindowError, 'fee_window_saturated'); eq(e.fee.truncated, true); eq(e.fee.skippedPoisoned, 200);
  }
  { // 一个干净的排在 250 个更大面值的毒化之后被挤出窗口(已知残余 §19.3: 成本 ≈ 200 KAS): 这里断言它确实被报 saturated 而不是悄悄 none
    const many = () => [...poison(250)(), realEntry({ txidHex: txidOf('lost'), index: 0, amount: 40000000n, spkHex: RELAY_SPK })];
    await rejects(run('seal', feeSc(many)).p, FeeWindowError, 'fee_window_saturated');
  }
});
await t('C11 ▲ 并发: claim_draw 的 3 次形态 O + 1 次形态 L 同时发出——每次 250ms, 总耗时 < 600ms(串行 ≥ 1000ms); 预算/超时常量断言', async () => {
  const { relay, p } = run('claim_draw', { relayOpts: { delayMs: 250 } });
  const t0 = Date.now(); await p(); const dt = Date.now() - t0;
  eq(relay.calls.length, 4); ok(dt < 600, `疑似串行: 总耗时 ${dt}ms`);
  const starts = relay.calls.map((c) => c.t); ok(Math.max(...starts) - Math.min(...starts) < 150, `四个请求的发出时刻应几乎同时: ${starts.map((x) => x - starts[0])}`);
  eq(MIN_STEP_BUDGET_MS, 15000); eq(MIN_FACTS_IPC_TIMEOUT_MS, 15000);
  ok(MIN_STEP_BUDGET_MS >= RELAY.FACTS_RPC_WAIT_MS + RELAY.FACTS_RPC_CALL_MS + 1000, '预算下界须含余量');
  eq(assertStepBudget(15000, 30000), true); eq(assertStepBudget(20000, 30000), true);
  for (const [b, tk] of [[14999, 30000], [30000, 30000], [40000, 30000], [NaN, 30000], [20000, Infinity]]) { let e = null; try { assertStepBudget(b, tk); } catch (x) { e = x; } ok(e, `assertStepBudget(${b}, ${tk}) 应抛`); }
  eq(assertFactsIpcTimeout(15000), true); eq(assertFactsIpcTimeout(20000), true);
  for (const bad of [13000, 14999, 8000, NaN, undefined]) { let e = null; try { assertFactsIpcTimeout(bad); } catch (x) { e = x; } ok(e, `assertFactsIpcTimeout(${bad}) 应抛`); }
});
await t('镜像常量与 relay 侧(9-0)逐项相等: FACTS_VERSION / FACTS_OUTPOINTS_MAX / FACTS_RPC_WAIT_MS / FACTS_RPC_CALL_MS; SIGNED_INPUT_CEILING 与 maxAmount 请求值一致', async () => {
  eq(C1.FACTS_VERSION_EXPECTED, RELAY.FACTS_VERSION); eq(C1.FACTS_OUTPOINTS_MAX, RELAY.FACTS_OUTPOINTS_MAX);
  eq(C1.FACTS_RPC_WAIT_MS, RELAY.FACTS_RPC_WAIT_MS); eq(C1.FACTS_RPC_CALL_MS, RELAY.FACTS_RPC_CALL_MS);
  const relaySrc = fs.readFileSync(new URL('../../../kasia-relay/src/lib/covenant-broadcast.mjs', import.meta.url), 'utf8');
  ok(/export const SIGNED_INPUT_CEILING_SOMPI\s*=\s*100_000_000n;/.test(relaySrc), 'relay 侧 SIGNED_INPUT_CEILING_SOMPI 不是 100_000_000n(两侧必须一致)');
  eq(SIGNED_INPUT_CEILING_SOMPI, 100000000n);
});
await t('C10 ▲ 传输错误分级: 瞬时类首次 warn、连续 3 个【不同 tick】升 error(同一 tick 内重试不算)、成功清零; facts_echo_missing / facts_version_mismatch 首次即 error(不进计数); 漂移永远 error 且事件类型不同', async () => {
  const T = () => new FactsResponseError('facts_transport_error', 'Relay command timeout after 15s');
  const R = () => new FactsResponseError('facts_relay_error', 'x');
  const g = createTransportAlertGrader(); const K = 'settle:market:aa:seal';
  const lv = (e, tick) => g.onFailure(e, tick, K).level;
  eq(lv(T(), 1), 'warn'); eq(lv(T(), 1), 'warn'); eq(lv(R(), 1), 'warn'); eq(g.consecutiveTicks(K), 1);      // 同一 tick 内重试不累计
  eq(lv(T(), 2), 'warn'); eq(g.consecutiveTicks(K), 2);
  eq(lv(R(), 3), 'error'); eq(g.consecutiveTicks(K), 3);                                                     // 第 3 个不同 tick ⇒ error
  eq(lv(T(), 4), 'error');
  g.onSuccess(K); eq(g.consecutiveTicks(K), 0); eq(lv(T(), 5), 'warn');                                      // 成功清零
  for (const code of ['facts_echo_missing', 'facts_version_mismatch']) { const g2 = createTransportAlertGrader(); const a = g2.onFailure(new FactsResponseError(code, 'x'), 1, K); eq(a.level, 'error'); eq(a.eventType, 'settlement_facts_transport_error'); eq(g2.consecutiveTicks(K), 0); }
  for (const code of ['facts_shape_invalid', 'facts_form_mismatch', 'facts_item_key_missing', 'facts_set_mismatch', 'facts_not_ok']) eq(createTransportAlertGrader().onFailure(new FactsResponseError(code, 'x'), 1, K).level, 'error', code);
  const d = createTransportAlertGrader().onFailure(new SettlementChainCheckError('leaf_value_drift', 'x', { step: 'seal', role: 'leaf' }), 1, K);
  eq(d.level, 'error'); eq(d.eventType, 'settlement_chain_fact_drift');
  for (const c of ['chain_check_params_missing', 'chain_check_unknown_step']) eq(classifyC1Error(new SettlementChainCheckError(c, 'x')).eventType, 'settlement_c1_programming_error', c);
  eq(classifyC1Error(new FactsResponseError('facts_requested_invalid', 'x')).eventType, 'settlement_c1_programming_error');
  eq(classifyC1Error(new Error('unknown')).eventType, 'settlement_c1_programming_error');                    // F1: 无法识别 ⇒ programming_error, 不再是 null
  let e = null; try { g.onFailure(T(), undefined, K); } catch (x) { e = x; } ok(e instanceof TypeError, 'tickId 必填');
  for (const bad of [0, -1, 1.5]) { let x = null; try { createTransportAlertGrader({ ticksToError: bad }); } catch (y) { x = y; } ok(x, `ticksToError=${bad} 应抛`); }
});
await t('chainParents 的 fee 项来自形态 L 条目的事实(不是常量): withFeeParent 补 {value, spkLen, hasCovenant}; 缺字段 ⇒ TypeError', async () => {
  const r = await run('seal').p();
  const cand = r.fee.candidates[0];
  const cp = withFeeParent(r.chainParents, cand);
  jeq(cp.fee, { value: cand.value, spkLen: RELAY_SPK.length / 2, hasCovenant: false, outpoint: { txid: cand.txid, index: cand.vout } });
  jeq(Object.keys(cp), ['leaf', 'held', 'fee']); ok(!('fee' in r.chainParents), '不得就地修改入参');
  jeq(withFeeParent(r.chainParents, { ...cand, covenantId: covOf('x') }).fee.hasCovenant, true);              // hasCovenant 由条目的 covenantId 得出
  for (const bad of [null, {}, { value: 1n, spkLen: 34 }, { value: 1, spkLen: 34, covenantId: null }, { value: 1n, spkLen: 34, covenantId: null }]) { let e = null; try { withFeeParent(r.chainParents, bad); } catch (x) { e = x; } ok(e instanceof TypeError, `坏候选应 TypeError: ${JSON.stringify(bad, (_, v) => (typeof v === 'bigint' ? String(v) : v))}`); }
});
await t('调用方错误全部类型化且不发请求: 未知步骤 / 指针缺角色 / 预期 spk 缺失 / 两个角色预期 outpoint 相同 / requestFacts 非函数 / budgetMs·feeMinAmount 缺失(无默认值)', async () => {
  const sc = scenario('seal'); const relay = makeRelay(sc.byAddr); const A = (o = {}) => argsOf(sc, relay, o);
  await rejects(() => verifyStepInputsOnChain(A({ step: 'nope' })), SettlementChainCheckError, 'chain_check_unknown_step');
  await rejects(() => verifyStepInputsOnChain(A({ pointers: { roles: { leaf: sc.pointers.roles.leaf } } })), SettlementChainCheckError, 'chain_check_params_missing', /held/);
  await rejects(() => verifyStepInputsOnChain(A({ pointers: undefined })), SettlementChainCheckError, 'chain_check_params_missing');
  await rejects(() => verifyStepInputsOnChain(A({ expectedSpks: { leaf: spkOf('leaf') } })), SettlementChainCheckError, 'chain_check_params_missing', /held/);
  await rejects(() => verifyStepInputsOnChain(A({ pointers: { roles: { leaf: sc.pointers.roles.leaf, held: { ...sc.pointers.roles.held, outpoint: sc.pointers.roles.leaf.outpoint } } } })), FactsResponseError, 'facts_requested_invalid');
  for (const over of [{ requestFacts: undefined }, { budgetMs: undefined }, { budgetMs: 0 }, { tickIntervalMs: undefined }, { ipcTimeoutMs: undefined }, { feeMinAmount: undefined }, { feeMinAmount: 5 }, { kaspa: undefined }, { network: '' }]) {
    let e = null; try { await verifyStepInputsOnChain(A(over)); } catch (x) { e = x; } ok(e instanceof TypeError, `${Object.keys(over)[0]} 缺失/非法应 TypeError, 实际 ${e && e.constructor.name}`);
  }
  eq(relay.calls.length, 0, '以上调用方错误都发生在发请求之前');
});
await t('指针缺 expectedCovenantId 键(undefined)⇒ 走到 M6 层被拒为 chain_check_params_missing(没有默认值, 不会静默当"无 covenant")', async () => {
  const sc = scenario('seal'); const pts = { roles: { leaf: { outpoint: sc.pointers.roles.leaf.outpoint }, held: sc.pointers.roles.held } };
  await rejects(() => verifyStepInputsOnChain(argsOf(sc, makeRelay(sc.byAddr), { pointers: pts })), SettlementChainCheckError, 'chain_check_params_missing');
});
await t('filterFeeCandidates 纯函数: 三种 status(ok / saturated / none)与事件; relaySpkHex 缺失 ⇒ TypeError', async () => {
  const it = (n, cov = null, spk = RELAY_SPK) => ({ outpoint: { transactionId: txidOf(`f${n}`), index: 0 }, amount: 40000000n, scriptPublicKey: { version: 0, scriptHex: spk }, covenantId: cov });
  eq(filterFeeCandidates({ utxos: [it(1)], truncated: false, relaySpkHex: RELAY_SPK, feeMinAmount: FEE_MIN }).status, 'ok');
  eq(filterFeeCandidates({ utxos: [it(1, covOf('a'))], truncated: false, relaySpkHex: '0x' + RELAY_SPK.toUpperCase(), feeMinAmount: FEE_MIN }).status, 'saturated');   // relaySpkHex 大小写/0x 宽容
  eq(filterFeeCandidates({ utxos: [], truncated: true, relaySpkHex: RELAY_SPK, feeMinAmount: FEE_MIN }).status, 'saturated');                                          // 窗口被截断而我们一个也没拿到
  eq(filterFeeCandidates({ utxos: [], truncated: false, relaySpkHex: RELAY_SPK, feeMinAmount: FEE_MIN }).status, 'none');
  eq(filterFeeCandidates({ utxos: [it(1)], truncated: false, relaySpkHex: RELAY_SPK, feeMinAmount: FEE_MIN, inflightOutpoints: [{ transactionId: txidOf('f1').toUpperCase(), index: 0 }] }).status, 'none');   // 在途按小写比对
  let e = null; try { filterFeeCandidates({ utxos: [], truncated: false, feeMinAmount: FEE_MIN }); } catch (x) { e = x; } ok(e instanceof TypeError);
});
// ══ 9-1 F1 笔(NWT C 笔审 C-1..C-5 / E 笔审 E-2 与 E-1 的 C 侧) ══════════════════════════════════════════════════════════════
const feeRelayAddr = () => addrOf(RELAY_SPK);
await t('C-1 ▲ spk 身份是 (version, script): 角色条目同脚本但 version=1 ⇒ <role>_spk_drift(每个 S10 格; 消息指明 version), 不是"同一个 UTXO 类"', async () => {
  for (const [step, role] of CELLS) {
    const sc0 = scenario(step);
    const e = await rejects(() => verifyStepInputsOnChain(argsOf(sc0, makeRelay(withEntry(sc0, role, targetEntry(sc0, role, { version: 1 })).byAddr))), SettlementChainCheckError, `${role}_spk_drift`, /version=1 != 0/);
    eq(e.step, step); eq(e.role, role);
    // 对照臂: version=0 的同一条目通过(证明拒绝的是 version 而不是别的)
    await verifyStepInputsOnChain(argsOf(sc0, makeRelay(withEntry(sc0, role, targetEntry(sc0, role, { version: 0 })).byAddr)));
  }
});
await t('C-1 ▲ fee 候选同脚本但 version=1 ⇒ 按毒化跳过(计数 + 事件), 干净候选照常被选; 全是 version=1 ⇒ saturated', async () => {
  const mixed = () => [
    realEntry({ txidHex: txidOf('fv1'), index: 0, amount: 50000000n, spkHex: RELAY_SPK, version: 1 }),
    realEntry({ txidHex: txidOf('fv0'), index: 0, amount: 40000000n, spkHex: RELAY_SPK }),
  ];
  const r = await run('close_commit', { scOpts: { fee: mixed } }).p();
  eq(r.fee.candidates.length, 1); eq(r.fee.candidates[0].txid, txidOf('fv0')); eq(r.fee.skippedPoisoned, 1);
  jeq(r.events, [{ eventType: 'fee_candidate_poisoned_skipped', level: 'warn', payload: { count: 1 } }]);
  const allV1 = () => [realEntry({ txidHex: txidOf('fv1'), index: 0, amount: 50000000n, spkHex: RELAY_SPK, version: 1 })];
  await rejects(run('close_commit', { scOpts: { fee: allV1 } }).p, FeeWindowError, 'fee_window_saturated');
});
await t('C-4 ▲ 消费方复核 fee 区间(不信 relay 的过滤): 行为异常的 relay 返回了 < feeMinAmount 或 > 签名输入上限的候选 ⇒ 跳过并计入 skippedOutOfRange + 事件 fee_candidate_out_of_range_skipped; 全越界 ⇒ saturated; 边界值(恰等于下限/上限)放行', async () => {
  // 行为异常的 relay: 对 fee 地址的形态 L 请求无视 minAmount/maxAmount(按 0..u64max 回)
  const badRelay = (byAddr) => { const inner = makeRelay(byAddr); return { calls: inner.calls, requestFacts: (address, payload) => inner.requestFacts(address, address === feeRelayAddr() ? { ...payload, minAmount: '0', maxAmount: '18446744073709551615' } : payload) }; };
  const fee = () => [
    realEntry({ txidHex: txidOf('lo'), index: 0, amount: FEE_MIN - 1n, spkHex: RELAY_SPK }),          // 低于下限 1
    realEntry({ txidHex: txidOf('eqmin'), index: 0, amount: FEE_MIN, spkHex: RELAY_SPK }),            // 恰等于下限: 放行
    realEntry({ txidHex: txidOf('eqmax'), index: 0, amount: SIGNED_INPUT_CEILING_SOMPI, spkHex: RELAY_SPK }),   // 恰等于上限: 放行
    realEntry({ txidHex: txidOf('hi'), index: 0, amount: SIGNED_INPUT_CEILING_SOMPI + 1n, spkHex: RELAY_SPK }), // 高于上限 1
  ];
  const sc = scenario('close_commit', { fee }); const relay = badRelay(sc.byAddr);
  const r = await verifyStepInputsOnChain(argsOf(sc, relay));
  jeq(r.fee.candidates.map((c) => c.txid).sort(), [txidOf('eqmax'), txidOf('eqmin')].sort()); eq(r.fee.skippedOutOfRange, 2); eq(r.fee.skippedPoisoned, 0);
  jeq(r.events, [{ eventType: 'fee_candidate_out_of_range_skipped', level: 'warn', payload: { count: 2 } }]);
  const allBad = () => [realEntry({ txidHex: txidOf('lo2'), index: 0, amount: 1n, spkHex: RELAY_SPK }), realEntry({ txidHex: txidOf('hi2'), index: 0, amount: SIGNED_INPUT_CEILING_SOMPI * 5n, spkHex: RELAY_SPK })];
  const sc2 = scenario('close_commit', { fee: allBad });
  const e = await rejects(() => verifyStepInputsOnChain(argsOf(sc2, badRelay(sc2.byAddr))), FeeWindowError, 'fee_window_saturated');
  jeq(e.events.map((x) => x.eventType), ['fee_candidate_out_of_range_skipped', 'settlement_fee_window_saturated']); eq(e.fee.skippedOutOfRange, 2);
  // 纯函数层: feeMinAmount 必填
  let te = null; try { filterFeeCandidates({ utxos: [], truncated: false, relaySpkHex: RELAY_SPK }); } catch (x) { te = x; } ok(te instanceof TypeError && /feeMinAmount/.test(te.message), 'feeMinAmount 必填');
});
await t('C-5 evidence 的计数守着: 每个 O 请求 {requested, found, missing}、L 请求 {listed, truncated}(由真实 handler 的回执得出)', async () => {
  const { sc, p } = run('seal'); const r = await p();
  const addrs = sc.roles.map((role) => sc.where[role].addr);
  jeq(r.evidence.map((x) => x.form), ['outpoints', 'outpoints', 'list']);
  r.evidence.slice(0, 2).forEach((x, i) => jeq(x, { form: 'outpoints', address: addrs[i], requested: 1, found: 1, missing: 0 }, `O[${i}]`));
  jeq(r.evidence[2], { form: 'list', address: feeRelayAddr(), listed: 2, truncated: false }, 'L');           // 25M/150M 被真实 handler 的区间过滤, 剩 40M/90M
  // 有 missing 的形态: 诱饵之外目标不在 ⇒ 抛错, 不产出 evidence; 而 evidence 的 missing 计数由 assertFactsResponse 的输出决定(下面直接验)
  const res = assertFactsResponse(await makeRelay(E_BY).requestFacts(addrOf(E_ADDR_SPK), { facts: true, outpoints: E_REQ }), O);
  eq(res.found.length, 2); eq(res.missing.length, 1);
});
await t('C-5 总预算定时器: 成功 / 失败 / 超预算 三条路径都恰设一次(ms=budgetMs)且都被清除(记录式定时器); 真实定时器下成功返回后没有遗留的 Timeout 资源', async () => {
  const one = async (mkRun, expectCode) => {
    const tm = recTimers(500); const { p } = mkRun(tm);
    if (expectCode) await rejects(p, FactsResponseError, expectCode); else await p();
    eq(tm.log.set.length, 1, '恰设一次'); eq(tm.log.set[0].ms, 20000, 'ms = budgetMs'); ok(tm.log.cleared.includes(tm.log.set[0].id), '定时器必须被清除');
  };
  await one((tm) => run('seal', { over: { timers: tm } }));                                                                                    // 成功
  await one((tm) => run('seal', { relayOpts: { override: () => ({ res: { error: 'x', phase: 'execution' } }) }, over: { timers: tm } }), 'facts_relay_error');   // 快速失败
  await one((tm) => run('seal', { relayOpts: { delayMs: 400 }, over: { timers: tm } }), 'facts_step_budget_exceeded');                         // 超预算(缩放后 40ms 触发)
  await sleep(500);
  const active = () => process.getActiveResourcesInfo().filter((x) => x === 'Timeout').length;
  const before = active(); await run('seal').p(); const after = active();                                                                     // 真实定时器, 20s 预算
  ok(after <= before, `成功返回后遗留了 ${after - before} 个 Timeout(预算定时器未清?)`);
});
await t('C-2 ▲ 分级器按意图 key 分计数: A 每个 tick 都瞬时失败、B 每个 tick 都成功 ⇒ A 在第 3 个 tick 升 error(全局单计数会被 B 的成功清零而永远 warn——NWT 实测); key 必填', async () => {
  const g = createTransportAlertGrader();
  const A = 'settle:market:aa:seal', B = 'settle:market:bb:seal';
  const T = () => new FactsResponseError('facts_transport_error', 'Relay command timeout after 15s');
  const levels = [];
  for (let tick = 1; tick <= 6; tick++) { levels.push(g.onFailure(T(), tick, A).level); g.onSuccess(B); }
  jeq(levels, ['warn', 'warn', 'error', 'error', 'error', 'error']); eq(g.consecutiveTicks(A), 6); eq(g.consecutiveTicks(B), 0);
  g.onSuccess(A); eq(g.consecutiveTicks(A), 0, '只清 A 自己');
  // 两个 key 各自独立累计, 互不影响
  const g2 = createTransportAlertGrader();
  eq(g2.onFailure(T(), 1, A).level, 'warn'); eq(g2.onFailure(T(), 1, B).level, 'warn'); eq(g2.onFailure(T(), 2, A).level, 'warn'); eq(g2.onFailure(T(), 2, B).level, 'warn');
  eq(g2.onFailure(T(), 3, A).level, 'error'); eq(g2.consecutiveTicks(B), 2, 'B 的计数不受 A 影响');
  for (const bad of [undefined, null, '', 5]) {
    let e1 = null, e2 = null; try { g.onFailure(T(), 1, bad); } catch (x) { e1 = x; } try { g.onSuccess(bad); } catch (x) { e2 = x; }
    ok(e1 instanceof TypeError && e2 instanceof TypeError, `key=${String(bad)} 必须 TypeError`);
  }
});
await t('C-3 ▲ 预算 / IPC 超时的约束是结构性的(入口每次都校验, 漏传即拒、不可能忘调): tickIntervalMs / ipcTimeoutMs 必填; 预算 < 15s、≥ tick 间隔、IPC 超时 < 15s 各 ⇒ RangeError; 都发生在发请求之前', async () => {
  const sc = scenario('seal'); const relay = makeRelay(sc.byAddr); const A = (o) => () => verifyStepInputsOnChain(argsOf(sc, relay, o));
  for (const o of [{ tickIntervalMs: undefined }, { ipcTimeoutMs: undefined }, { tickIntervalMs: NaN }, { ipcTimeoutMs: 'x' }]) {
    let e = null; try { await A(o)(); } catch (x) { e = x; } ok(e instanceof TypeError, `${JSON.stringify(Object.keys(o))} 缺失应 TypeError, 实际 ${e && e.constructor.name}`);
  }
  for (const o of [{ budgetMs: 14999 }, { budgetMs: 60000 }, { budgetMs: 60001 }, { ipcTimeoutMs: 14999 }, { ipcTimeoutMs: 13000 }, { tickIntervalMs: 20000 }]) {
    let e = null; try { await A(o)(); } catch (x) { e = x; } ok(e instanceof RangeError, `${JSON.stringify(o)} 应 RangeError, 实际 ${e && e.constructor.name}`);
  }
  eq(relay.calls.length, 0, '校验先于任何请求');
  await A({ budgetMs: 15000, tickIntervalMs: 15001, ipcTimeoutMs: 15000 })();                                     // 恰在边界内: 通过
});
await t('E-2 classifyC1Error 永不返回 null: builder 侧的 chain_parents_mismatch(按 err.code 识别, 不 import builder)与一切无法识别的错误(TypeError / RangeError / 普通 Error / 非 Error)都归 settlement_c1_programming_error(error 级、非瞬时)——驱动不得把它当瞬时故障重试', async () => {
  const cp = Object.assign(new Error('close_commit: chain_parents_mismatch — fee: ...'), { code: 'chain_parents_mismatch', step: 'close_commit', role: 'fee' });
  for (const err of [cp, new TypeError('x'), new RangeError('x'), new Error('boom'), 'a string', undefined, null, { code: 'weird' }]) {
    const c = classifyC1Error(err);
    ok(c && c.eventType === 'settlement_c1_programming_error' && c.transient === false, `${String(err && err.message || err)}: ${JSON.stringify(c)}`);
    const g = createTransportAlertGrader(); eq(g.onFailure(err, 1, 'k').level, 'error');
  }
  eq(classifyC1Error(cp).code, 'chain_parents_mismatch');
  // 已识别的类别不受影响
  eq(classifyC1Error(new FactsResponseError('facts_transport_error', 'x')).eventType, 'settlement_facts_transport_error');
  eq(classifyC1Error(new SettlementChainCheckError('leaf_value_drift', 'x')).eventType, 'settlement_chain_fact_drift');
});
await t('E-1(C 侧) ▲ chainParents 的每个条目带 outpoint {txid,index}: 角色项取自经 M6 断言的链上条目(= 指针), fee 项取自所选 fee 候选; withFeeParent 的候选缺 txid/vout ⇒ TypeError', async () => {
  for (const step of ALL_STEPS) {
    const { sc, p } = run(step); const r = await p();
    for (const role of sc.roles) jeq(r.chainParents[role].outpoint, { txid: sc.pointers.roles[role].outpoint.transactionId, index: sc.pointers.roles[role].outpoint.index }, `${step}/${role}`);
    for (const cand of r.fee.candidates) {
      const cp = withFeeParent(r.chainParents, cand);
      jeq(cp.fee.outpoint, { txid: cand.txid, index: cand.vout }); ok(cand.txid !== undefined && cand.vout !== undefined);
    }
    ok(r.fee.candidates.length > 1 && withFeeParent(r.chainParents, r.fee.candidates[0]).fee.outpoint.txid !== withFeeParent(r.chainParents, r.fee.candidates[1]).fee.outpoint.txid, '不同候选的 outpoint 必须不同(否则绑定形同虚设)');
  }
  const r = await run('seal').p(); const cand = r.fee.candidates[0];
  for (const bad of [{ ...cand, txid: undefined }, { ...cand, txid: 'ABC' }, { ...cand, txid: cand.txid.toUpperCase() }, { ...cand, vout: undefined }, { ...cand, vout: -1 }, { ...cand, vout: 1.5 }]) {
    let e = null; try { withFeeParent(r.chainParents, bad); } catch (x) { e = x; } ok(e instanceof TypeError, `坏候选应 TypeError: ${JSON.stringify({ txid: bad.txid, vout: bad.vout })}`);
  }
});
// ══ 9-1 F4 笔(NWT F1 审 F1-1 / F1-2) ═══════════════════════════════════════════════════════════════════════════════════
await t('F1-1 ▲ 校验过的 IPC 超时交给被调方: 每个 requestFacts 调用(形态 O 与形态 L)收到第三参 {timeoutMs: ipcTimeoutMs}, 值 == 驱动声明的数(换几个不同的声明值都跟着变); 缺它的话"声明 ≠ 实际"无从核对', async () => {
  for (const ipc of [15000, 20000, 17123]) {
    for (const step of ALL_STEPS) {
      const { relay, p } = run(step, { over: { ipcTimeoutMs: ipc } }); await p();
      ok(relay.calls.length >= 2, `${step}: 应至少 1 次 O + 1 次 L`);
      for (const c of relay.calls) jeq(c.opts, { timeoutMs: ipc }, `${step}/${c.payload.outpoints ? 'O' : 'L'}: 第三参`);
    }
  }
});
await t('F1-2 ▲ 生产入口不接受 timers(一个永不触发的 setTimeout 就能让每步总预算失效): 带 timers 键(任何值, 含 undefined 与"永不触发"版)⇒ TypeError 且不发请求; 不带则正常', async () => {
  const sc = scenario('seal'); const relay = makeRelay(sc.byAddr);
  const neverFires = { setTimeout: () => 0, clearTimeout: () => {} };
  for (const tm of [neverFires, { setTimeout, clearTimeout }, undefined, null, 5]) {
    let e = null; try { await verifyStepInputsOnChain({ ...argsOf(sc, relay), timers: tm }); } catch (x) { e = x; }
    ok(e instanceof TypeError && /生产入口不接受 timers/.test(e.message), `timers=${String(tm && Object.keys(tm))} 应被生产入口拒: ${e && e.message}`);
  }
  eq(relay.calls.length, 0, '拒绝先于任何请求');
  await verifyStepInputsOnChain(argsOf(sc, relay));                                                        // 不带 timers: 正常
});
await t('F1-2 ▲(NWT f22)仅测试用入口校验注入的 timers 形状: 缺 clearTimeout / 缺 setTimeout / 非对象 / null ⇒ TypeError(且先于任何请求); 形状对则正常, 定时器真被用到', async () => {
  const sc = scenario('seal'); const relay = makeRelay(sc.byAddr); const base = argsOf(sc, relay);
  for (const bad of [{ setTimeout }, { clearTimeout }, {}, null, undefined, 5, { setTimeout: 1, clearTimeout: 2 }]) {
    let e = null; try { await verifyStepInputsOnChainWithTimers(base, bad); } catch (x) { e = x; } ok(e instanceof TypeError && /timers 须带/.test(e.message), `timers=${JSON.stringify(bad === undefined ? 'undefined' : bad)} 应 TypeError: ${e && e.message}`);
  }
  eq(relay.calls.length, 0);
  const tm = recTimers(1); await verifyStepInputsOnChainWithTimers(base, tm);
  eq(tm.log.set.length, 1, '注入的定时器必须被用到'); ok(tm.log.cleared.includes(tm.log.set[0].id));
});
await t('F1-2 ▲ 源码扫描(共享扫描器, NWT F2-1 修正版): 仅测试用的 verifyStepInputsOnChainWithTimers 只准被测试引用——整个仓库的非测试源码(含 src/data、scripts、ts/mts/tsx; 排除只按仓库根相对路径)里出现该标识符即违规(除定义它的 c1 模块自己); 动态拼接是文本扫描的已知边界', async () => {
  const { findReferencesInNonTestSources } = await import('../../test-fixtures/source-scan/scan-non-test-sources.mjs');
  const bad = findReferencesInNonTestSources(/verifyStepInputsOnChainWithTimers/, { exceptRel: ['kasia-console/src/lib/proto-settlement-c1.mjs'] });
  if (bad.length) throw new Error(`非测试源码引用了仅测试用的入口: ${bad.join(', ')}`);
});
await t('模块边界(M0a 精神): 源码(去注释)不 import 任何 relay 通道 / DB / kaspa-wasm、不读 process.env、不含 sendCommand; 只 import chain-checks 与 tx-assembly', async () => {
  const src = fs.readFileSync(new URL('./proto-settlement-c1.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const bad = [/relay-manager/, /proto-relay-ipc/, /better-sqlite3/, /db\/client/, /from\s+['"]kaspa-wasm['"]/, /import\s*\(\s*['"]kaspa-wasm/, /\bprocess\.env\b/, /\bsendCommand/, /\bprotoSendCmd\b/, /\bsqlite\b/];
  jeq(bad.filter((re) => re.test(src)).map(String), []);
  const imports = [...src.matchAll(/^import\s.*from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]).sort();
  jeq(imports, ['./proto-settlement-chain-checks.mjs', './proto-tx-assembly.mjs']);
});
await t('全程无 unhandledRejection(超时放弃 / 并发快速失败后其余请求晚到)', async () => { await sleep(200); eq(unhandled, 0); });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
