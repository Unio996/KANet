// mutate-f4.mjs — 9-1 F4 笔(NWT F1 笔审 F1-1 / F1-2)对 proto-settlement-c1.mjs 的变异对照(J2 2026-09-20)。
// 由 F1 笔的 mutate-f1.mjs 演化而来(80 个旧变异全部保留, 仅 M-22 的锚点因 requestFacts 多了第三参而更新), F4 新增 G-xx。
// 由 C 笔的 mutate-c.mjs 演化而来: 因 F1 改了签名/结构而失配的旧变异锚点已更新(名称沿用 M-xx), F1 新增的变异编号 F-xx。
// 分两批跑(--part=1 / --part=2, 各自还原并核 sha256), 避免单次超过 10 分钟上限。
// 逐个破坏 kasia-console/src/lib/proto-settlement-c1.mjs, 跑 proto-settlement-c1.test.mjs, 期望每个变异至少一条 [FAIL](或进程异常退出)。
// 每个变异的锚点必须恰好命中 1 次(否则报 [ERR ]: 变异脚本与源码不同步); 每次 finally 还原并核对 sha256。
// 为省时间: 脚本自己建一次已迁移的临时库, 用 _PROTO_C1_TEST_BOOTSTRAPPED=1 + DB_PATH 直接跑测试(与测试文件自己的 bootstrap 走同一段之后的代码)。
// 运行: node docs/provenance/2026-09-20-j2-batch9-1-c-c1-module/mutate-c.mjs <worktree 根绝对路径>
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync, execSync } from 'node:child_process';

const ROOT = process.argv[2];
const PART = (process.argv.find((a) => a.startsWith('--part=')) || '--part=0').slice(7);   // 0 = 全部
const target = `${ROOT}/kasia-console/src/lib/proto-settlement-c1.mjs`;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const orig = fs.readFileSync(target), origSha = sha(orig), text = orig.toString('utf8');
const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_c1_mut_${process.pid}.db`;
try { fs.unlinkSync(tmpDb); } catch {}
execSync('node scripts/run-migrations.mjs', { cwd: `${ROOT}/kasia-console`, env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
const runTest = () => spawnSync(process.execPath, ['src/lib/proto-settlement-c1.test.mjs'], { cwd: `${ROOT}/kasia-console`, encoding: 'utf8', timeout: 240000, env: { ...process.env, DB_PATH: tmpDb, _PROTO_C1_TEST_BOOTSTRAPPED: '1' } });

const ASK_O = "p: ask(address, { facts: true, outpoints: requested }, { form: 'outpoints', requested }) });";
const muts = [
  // ── assertFactsResponse(§19.1) ──
  ['M-01 ▲ #2 用 res.ok === false 判错误回执(真实错误回执无 ok 字段 ⇒ 漏判)', "if (res.error !== undefined) {", "if (res.ok === false) {"],
  ['M-02 ▲ #3 ok 不再严格 === true(只拒 false)', "if (res.ok !== true) throw F('facts_not_ok'", "if (res.ok === false) throw F('facts_not_ok'"],
  ['M-03 ▲ #4 拆掉 facts 回声检查(旧 relay 静默忽略 facts)', "if (res.facts !== true) throw F('facts_echo_missing'", "if (false) throw F('facts_echo_missing'"],
  ['M-04 ▲ #4 factsVersion 只判缺失、不判等于 1', 'if (res.factsVersion !== FACTS_VERSION_EXPECTED) throw', 'if (res.factsVersion === undefined) throw'],
  ['M-05 ▲ #5 拆掉 form 一致检查', "if (res.form !== form) throw F('facts_form_mismatch'", "if (false) throw F('facts_form_mismatch'"],
  ['M-06 #6 形态 O 带 truncated 不再拒', "if ('truncated' in res) throw", 'if (false) throw'],
  ['M-07 ▲ #7 拆掉条目 covenantId 键检查(缺键当 null——9-0 起就在防的)', "if (!('covenantId' in it)) throw", 'if (false) throw'],
  ['M-08 #7 拆掉条目 scriptHex 键检查', "if (!('scriptHex' in spk)) throw", 'if (false) throw'],
  ['M-09 #7 amount 不再限 ≤ u64', '|| BigInt(it.amount) > U64_MAX) throw', '|| false) throw'],
  ['M-10 #7 version 不再限 ≤ 65535', '|| spk.version > U16_MAX) throw', '|| false) throw'],
  ['M-11 #7 txid/covenantId 的 hex 接受大写(relay 输出恒小写, 大写即异常)', "const HEX64 = /^[0-9a-f]{64}$/;", "const HEX64 = /^[0-9a-fA-F]{64}$/;"],
  ['M-12 #7 scriptHex 接受大写', "const HEX_EVEN = /^(?:[0-9a-f]{2})+$/;", "const HEX_EVEN = /^(?:[0-9a-fA-F]{2})+$/;"],
  ['M-13 ▲ #8 匹配键去掉 index(同 txid 任意 index 都算"在请求里"——N-T1 同族)', "if (!want.has(k)) throw F('facts_set_mismatch', `${label} 含请求之外的 outpoint ${k}`);", "if (!want.has(k) && ![...want].some((w) => w.split(':')[0] === k.split(':')[0])) throw F('facts_set_mismatch', `${label} 含请求之外的 outpoint ${k}`);"],
  ['M-14 #8 拆掉重复检查', "if (seen.has(k)) throw F('facts_set_mismatch'", "if (false) throw F('facts_set_mismatch'"],
  ['M-15 #8 拆掉"遗漏"检查(found∪missing 缺一项也放行)', 'if (seen.size !== want.size) throw', 'if (false) throw'],
  ['M-16 ▲ E13 requested 重复不再是编程错误', "if (keys.has(k)) throw F('facts_requested_invalid'", "if (false) throw F('facts_requested_invalid'"],
  ['M-17 E13 requested 数量上限失效', 'requested.length > FACTS_OUTPOINTS_MAX', 'requested.length > 1000'],
  ['M-18 #6 形态 L 的 truncated 不再核 boolean', "typeof res.truncated !== 'boolean'", 'false'],
  ['M-19 ▲ E2 relay 错误回执的 error/phase 原文不再保留', '{ relayError: e, relayPhase: res.phase }', '{}'],
  // ── verifyStepInputsOnChain(§19.3) ──
  ['M-20 ▲ E10 去掉传输错误的 try/catch(裸 Error 逃出, N91-1)', ".catch((e) => { throw F('facts_transport_error', e?.message ?? String(e), { cause: e }); })", '.catch((e) => { throw e; })'],
  ['M-21 ▲ C4 每步总预算的定时器不再 reject(超预算无限等)', "timer = timers.setTimeout(() => reject(F('facts_step_budget_exceeded', ", "timer = timers.setTimeout(() => void (F('facts_step_budget_exceeded', "],
  ['M-22 ▲ C11 请求串行发出(4×13s 最坏 52s 的活性问题, N91-4)', "const ask = (address, payload, req) => Promise.resolve()\n    .then(() => requestFacts(address, payload, { timeoutMs: ipcTimeoutMs }))", "let _chain = Promise.resolve();\n  const ask = (address, payload, req) => (_chain = _chain.then(() => requestFacts(address, payload, { timeoutMs: ipcTimeoutMs })))"],
  ['M-23 ▲ C2 角色输入改走形态 L(200 条窗口, 撒 dust 可挤掉目标——N1)', ASK_O, "p: ask(address, { facts: true, minAmount: '0' }, { form: 'list' }).then((r) => ({ ...r, found: r.utxos, missing: [] })) });"],
  ['M-24 ▲ C8 某个形态 O 请求失败被吞成"全 missing"(不再整步 fail-closed 于该请求本身)', ASK_O, ASK_O.replace(' });', ".catch(() => ({ form: 'outpoints', found: [], missing: requested })) });")],
  ['M-25 ▲ C8 fee 形态 L 请求失败被吞成空列表', "p: ask(relayAddress, feePayload, { form: 'list' }) });", "p: ask(relayAddress, feePayload, { form: 'list' }).catch(() => ({ form: 'list', utxos: [], truncated: false })) });"],
  ['M-26 ▲ 不再调用 M6 断言(spk/covenant/outpoint/value 全不核)', 'assertSettlementInputValuesOnChain({ step, chainUtxos, expectedSpks, expectedOutpoints, expectedCovenantIds });', 'void 0;'],
  ['M-27 ▲ chainUtxos 的 spk 取自"预期"而非链上事实(spk 错的用例放行)', 'scriptPublicKeyHex: it.scriptPublicKey.scriptHex, covenantId: it.covenantId, outpoint: it.outpoint }', 'scriptPublicKeyHex: normHex(expectedSpks[role]), covenantId: it.covenantId, outpoint: it.outpoint }'],
  ['M-28 ▲ chainParents.hasCovenant 写死 false(mass plurality 取常量而非链上事实)', 'hasCovenant: u.covenantId !== null, outpoint:', 'hasCovenant: false, outpoint:'],
  ['M-29 chainParents.spkLen 取字符数而非字节数', 'spkLen: u.scriptPublicKeyHex.length / 2,', 'spkLen: u.scriptPublicKeyHex.length,'],
  ['M-30 两个角色预期 outpoint 相同不再拒', 'if (seenOutpoints.has(k)) throw F(', 'if (false) throw F('],
  ['M-31 fee 请求不带 maxAmount(不排除超签名上限的候选)', ', maxAmount: SIGNED_INPUT_CEILING_SOMPI.toString() };', ' };'],
  ['M-32 fee 请求不带 minAmount(窗口被"小到不够用"的 UTXO 占位)', 'minAmount: feeMinAmount.toString(), ', ''],
  // ── fee 候选(§19.3 步骤 6) ──
  ['M-33 ▲ C5 不再跳过 covenantId != null 的毒化候选', "if (u.covenantId !== null || u.scriptPublicKey.version !== 0 || normHex(u.scriptPublicKey.scriptHex) !== relaySpk) { skippedPoisoned++; continue; }", "if (u.scriptPublicKey.version !== 0 || normHex(u.scriptPublicKey.scriptHex) !== relaySpk) { skippedPoisoned++; continue; }"],
  ['M-34 ▲ C9 不再排除我方在途产出', "if (inflight.has(opKey(u.outpoint.transactionId, u.outpoint.index))) { skippedInflight++; continue; }", "if (false) { skippedInflight++; continue; }"],
  ['M-35 在途排除对 txid 大小写敏感', 'opKey(String(o.transactionId).toLowerCase(), o.index)', 'opKey(String(o.transactionId), o.index)'],
  ['M-36 ▲ C9 无干净候选一律报 none(不区分 saturated)', "(skippedPoisoned > 0 || skippedOutOfRange > 0 || truncated ? 'saturated' : 'none')", "'none'"],
  ['M-37 ▲ C9 跳过毒化候选不写 fee_candidate_poisoned_skipped 事件', 'if (skippedPoisoned > 0) events.push(', 'if (false) events.push('],
  ['M-38 ▲ C9 饱和时不写 settlement_fee_window_saturated 事件', "if (status === 'saturated') events.push(", 'if (false) events.push('],
  ['M-39 ▲ C9 饱和不再抛 FeeWindowError(带着空候选返回成功)', "if (fee.status === 'saturated') throw new FeeWindowError(", "if (false) throw new FeeWindowError("],
  ['M-40 C9 空窗口的 FeeWindowError.code 串成 fee_window_saturated', "if (fee.status === 'none') throw new FeeWindowError('no_suitable_fee_utxo'", "if (fee.status === 'none') throw new FeeWindowError('fee_window_saturated'"],
  ['M-41 ▲ chainParents 的 fee 项 hasCovenant 写死 false(不取自形态 L 条目)', 'hasCovenant: feeCandidate.covenantId !== null, outpoint:', 'hasCovenant: false, outpoint:'],
  // ── 报警分级(§19.3 步骤 7) ──
  ['M-42 ▲ C10 同一 tick 内的重试也累计', 'if (tickId !== st.lastTick) { st.count += 1; st.lastTick = tickId; }', 'st.count += 1; st.lastTick = tickId;'],
  ['M-43 ▲ C10 成功不清零', "onSuccess(key) { needKey(key, 'onSuccess'); states.delete(key); },", "onSuccess(key) { needKey(key, 'onSuccess'); },"],
  ['M-44 ▲ C10 版本错位类被当成瞬时类(首次只 warn)', "const TRANSIENT_CODES = new Set(['facts_transport_error', 'facts_relay_error', 'facts_step_budget_exceeded']);", "const TRANSIENT_CODES = new Set(['facts_transport_error', 'facts_relay_error', 'facts_step_budget_exceeded', 'facts_echo_missing']);"],
  ['M-45 C10 升级阈值差一(> 而非 >=)', "level: st.count >= ticksToError ? 'error' : 'warn'", "level: st.count > ticksToError ? 'error' : 'warn'"],
  ['M-46 ▲ C3 传输错误混报成 settlement_chain_fact_drift', "return { eventType: 'settlement_facts_transport_error', transient: TRANSIENT_CODES.has(code), code };", "return { eventType: 'settlement_chain_fact_drift', transient: TRANSIENT_CODES.has(code), code };"],
  // ── 预算/超时常量(§18.2) ──
  ['M-47 ▲ C11 预算等于 tick 间隔也放行', 'if (budgetMs >= tickIntervalMs) throw', 'if (budgetMs > tickIntervalMs) throw'],
  ['M-48 C11 预算下界失效', 'if (budgetMs < MIN_STEP_BUDGET_MS) throw', 'if (budgetMs < 1000) throw'],
  ['M-49 C11 MIN_STEP_BUDGET_MS 被改小到 13000(= relay 侧总预算, 无余量)', 'export const MIN_STEP_BUDGET_MS = 15000;', 'export const MIN_STEP_BUDGET_MS = 13000;'],
  ['M-50 模块边界: 引入对 process.env 的读取', 'const U32_MAX = 4294967295;', 'const U32_MAX = 4294967295; const _envProbe = process.env.HOME;'],
  // ══ F1 新增 ══
  ['F-01 ▲ C-1 角色条目的 version 检查整个拆掉(同脚本 version=1 被当成目标)', 'if (it && it.scriptPublicKey.version !== 0) {', 'if (false) {'],
  ['F-02 C-1 角色条目 version 检查放宽(version=1 放行)', 'if (it && it.scriptPublicKey.version !== 0) {', 'if (it && it.scriptPublicKey.version > 1) {'],
  ['F-03 ▲ C-1 fee 候选不再按 version 跳过', "|| u.scriptPublicKey.version !== 0 || normHex(u.scriptPublicKey.scriptHex) !== relaySpk) { skippedPoisoned++; continue; }", "|| normHex(u.scriptPublicKey.scriptHex) !== relaySpk) { skippedPoisoned++; continue; }"],
  ['F-04 ▲ C-4 不再复核 fee 下限(信 relay 的过滤)', 'if (u.amount < feeMinAmount || u.amount > SIGNED_INPUT_CEILING_SOMPI) { skippedOutOfRange++; continue; }', 'if (u.amount > SIGNED_INPUT_CEILING_SOMPI) { skippedOutOfRange++; continue; }'],
  ['F-05 ▲ C-4 不再复核 fee 上限(签名输入上限)', 'if (u.amount < feeMinAmount || u.amount > SIGNED_INPUT_CEILING_SOMPI) { skippedOutOfRange++; continue; }', 'if (u.amount < feeMinAmount) { skippedOutOfRange++; continue; }'],
  ['F-06 C-4 下限边界差一(< 改 <=: 恰等于下限的被误拒)', 'u.amount < feeMinAmount || u.amount > SIGNED_INPUT_CEILING_SOMPI', 'u.amount <= feeMinAmount || u.amount > SIGNED_INPUT_CEILING_SOMPI'],
  ['F-07 C-4 上限边界差一(> 改 >=: 恰等于上限的被误拒)', 'u.amount < feeMinAmount || u.amount > SIGNED_INPUT_CEILING_SOMPI', 'u.amount < feeMinAmount || u.amount >= SIGNED_INPUT_CEILING_SOMPI'],
  ['F-08 ▲ C-4 越界候选不计入 saturated 判据', "(skippedPoisoned > 0 || skippedOutOfRange > 0 || truncated ? 'saturated' : 'none')", "(skippedPoisoned > 0 || truncated ? 'saturated' : 'none')"],
  ['F-09 C-4 越界跳过不写事件', 'if (skippedOutOfRange > 0) events.push(', 'if (false) events.push('],
  ['F-10 ▲ C-4 verify 不再把 feeMinAmount 传给过滤(区间复核形同虚设)', 'relaySpkHex, feeMinAmount, inflightOutpoints });', 'relaySpkHex, feeMinAmount: 0n, inflightOutpoints });'],
  ['F-11 C-4 filterFeeCandidates 的 feeMinAmount 不再必填', "if (typeof feeMinAmount !== 'bigint' || feeMinAmount < 0n) throw new TypeError('filterFeeCandidates:", "if (false) throw new TypeError('filterFeeCandidates:"],
  ['F-12 ▲ C-2 一个 key 的成功清掉所有 key 的计数(NWT 实测的全局掩盖)', "onSuccess(key) { needKey(key, 'onSuccess'); states.delete(key); },", "onSuccess(key) { needKey(key, 'onSuccess'); states.clear(); },"],
  ['F-13 ▲ C-2 onFailure 的 key 不再必填', "      needKey(key, 'onFailure');\n", ''],
  ['F-14 C-2 onSuccess 的 key 不再必填', "onSuccess(key) { needKey(key, 'onSuccess'); states.delete(key); },", 'onSuccess(key) { states.delete(key); },'],
  ['F-15 C-2 所有 key 共用一个计数(退回全局单计数)', 'const st = states.get(key) || { count: 0, lastTick: undefined };', "const st = states.get('_all') || { count: 0, lastTick: undefined };"],
  ['F-16 ▲ C-3 入口不再调 assertStepBudget(预算下界/tick 上限不核)', 'assertStepBudget(budgetMs, tickIntervalMs);            // 每次调用都核: 预算 ≥ 15 s 且 < tick 间隔', 'void 0;'],
  ['F-17 ▲ C-3 入口不再调 assertFactsIpcTimeout', 'assertFactsIpcTimeout(ipcTimeoutMs);                   // 每次调用都核: IPC 超时 ≥ 15000', 'void 0;'],
  ['F-19 C-3 ipcTimeoutMs 不再必填', "if (!Number.isFinite(ipcTimeoutMs)) throw new TypeError('verifyStepInputsOnChain: ipcTimeoutMs 必填", "if (false) throw new TypeError('verifyStepInputsOnChain: ipcTimeoutMs 必填"],
  ['F-20 ▲ C-5 预算定时器成功/失败后不再清除', 'finally { timers.clearTimeout(timer); }', 'finally { void timer; }'],
  ['F-21 C-5 预算定时器用错时长(2×budgetMs)', '用尽`)), budgetMs); });', '用尽`)), budgetMs * 2); });'],
  ['F-22 C-5 evidence.found 计数被改', 'found: results[i].found.length, missing: results[i].missing.length }', 'found: results[i].found.length + 1, missing: results[i].missing.length }'],
  ['F-23 C-5 evidence.listed 计数被改', 'listed: results[i].utxos.length, truncated: results[i].truncated }', 'listed: results[i].utxos.length + 1, truncated: results[i].truncated }'],
  ['F-24 C-5 evidence.requested 计数被改', 'requested: t.requested.length, found:', 'requested: t.requested.length + 1, found:'],
  ['F-25 ▲ E-2 无法识别的错误又返回 null', "return { eventType: 'settlement_c1_programming_error', transient: false, code: code ?? 'unrecognized_error' };", 'return null;'],
  ['F-26 E-2 无法识别的错误丢掉原 code(chain_parents_mismatch 不可见)', "code: code ?? 'unrecognized_error' };", "code: 'unrecognized_error' };"],
  ['F-27 ▲ E-1 C 侧: 角色条目的 chainParents 不再带 outpoint', ', outpoint: { txid: u.outpoint.transactionId, index: u.outpoint.index } };', ' };'],
  ['F-28 E-1 C 侧: 角色条目的 outpoint.index 恒为 0', 'index: u.outpoint.index } };', 'index: 0 } };'],
  ['F-29 ▲ E-1 C 侧: withFeeParent 的 fee 项不带 outpoint', ', outpoint: { txid: feeCandidate.txid, index: feeCandidate.vout } } };', ' } };'],
  ['F-30 E-1 C 侧: withFeeParent 的 fee.outpoint.index 恒为 0', 'index: feeCandidate.vout } } };', 'index: 0 } } };'],
  ['F-31 E-1 C 侧: withFeeParent 不再校验候选 txid 形状', "|| typeof feeCandidate.txid !== 'string' || !HEX64.test(feeCandidate.txid) ||", '||'],
  // ══ F4 新增 ══
  ['G-01 ▲ F1-1 requestFacts 不再收第三参(声明 ≠ 实际无从核对)', 'requestFacts(address, payload, { timeoutMs: ipcTimeoutMs }))', 'requestFacts(address, payload))'],
  ['G-02 ▲ F1-1 第三参的值取成 budgetMs 而不是声明的 ipcTimeoutMs', '{ timeoutMs: ipcTimeoutMs }))', '{ timeoutMs: budgetMs }))'],
  ['G-03 F1-1 第三参的值写死 15000(与声明脱钩)', '{ timeoutMs: ipcTimeoutMs }))', '{ timeoutMs: 15000 }))'],
  ['G-04 F1-1 第三参的键名错(timeout 而非 timeoutMs)', '{ timeoutMs: ipcTimeoutMs }))', '{ timeout: ipcTimeoutMs }))'],
  ['G-05 ▲ F1-2 生产入口不再拒绝 timers 键', "if (opts && typeof opts === 'object' && Object.prototype.hasOwnProperty.call(opts, 'timers')) {", 'if (false) {'],
  ['G-06 ▲ F1-2 生产入口既不拒 timers 键、又采用调用方注入的 timers(永不触发的 setTimeout 让每步总预算失效; 两层保护同时失效才可达)', [["if (opts && typeof opts === 'object' && Object.prototype.hasOwnProperty.call(opts, 'timers')) {", 'if (false) {'], ["return verifyCore(opts, { setTimeout, clearTimeout });", "return verifyCore(opts, (opts && opts.timers) || { setTimeout, clearTimeout });"]]],
  ['G-07 ▲ F1-2(NWT f22)测试专用入口不再校验 clearTimeout', "if (!timers || typeof timers.setTimeout !== 'function' || typeof timers.clearTimeout !== 'function') throw new TypeError('verifyStepInputsOnChainWithTimers:", "if (!timers || typeof timers.setTimeout !== 'function') throw new TypeError('verifyStepInputsOnChainWithTimers:"],
  ['G-08 F1-2 测试专用入口不再校验 setTimeout', "if (!timers || typeof timers.setTimeout !== 'function' || typeof timers.clearTimeout !== 'function') throw new TypeError('verifyStepInputsOnChainWithTimers:", "if (!timers || typeof timers.clearTimeout !== 'function') throw new TypeError('verifyStepInputsOnChainWithTimers:"],
  ['G-09 F1-2 测试专用入口完全不校验 timers', "if (!timers || typeof timers.setTimeout !== 'function' || typeof timers.clearTimeout !== 'function') throw new TypeError('verifyStepInputsOnChainWithTimers:", "if (false) throw new TypeError('verifyStepInputsOnChainWithTimers:"],
  ['G-10 F1-2 测试专用入口忽略注入的 timers(改用全局)', 'return verifyCore(opts, timers);', 'return verifyCore(opts, { setTimeout, clearTimeout });'],
];

const partOf = (i) => (PART === '0' ? true : (PART === '1' ? i % 2 === 0 : i % 2 === 1));
const selected = muts.filter((_, i) => partOf(i));
let allRed = true;
try {
  const base = runTest();
  console.log('基线(未变异):', (base.stdout || '').split('\n').filter((l) => /passed, \d+ failed/.test(l)).pop(), `exit=${base.status}`);
  if (base.status !== 0) allRed = false;
  for (const [name, find, repl] of selected) {
    // find 可以是 [[find, repl], …](多锚点变异, 依次应用; 每个锚点都须恰命中 1 次)
    const pairs = Array.isArray(find) ? find : [[find, repl]];
    let cur = text, badAnchor = false;
    for (const [f1, r1] of pairs) {
      const c = cur.split(f1).length - 1;
      if (c !== 1) { console.log(`[ERR ] ${name}: 变异锚点命中 ${c} 次(需要恰 1 次)——变异脚本与源码不同步: ${f1.slice(0, 60)}`); allRed = false; badAnchor = true; break; }
      cur = cur.replace(f1, () => r1);
    }
    if (badAnchor) continue;
    fs.writeFileSync(target, cur);
    const r = runTest();
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const failed = out.split('\n').filter((l) => l.startsWith('[FAIL]'));
    const red = failed.length > 0 || r.status !== 0;
    if (!red) allRed = false;
    const firstName = failed[0] ? failed[0].replace(/^\[FAIL\]\s*/, '').split(/[ ⇒:]/)[0] : '';
    console.log(`${red ? '[RED ]' : '[GREEN⚠ 变异存活!]'} ${name}  →  ${failed.length} 条 FAIL${failed.length ? `(首条: ${firstName})` : ''}${failed.length === 0 && r.status !== 0 ? `(进程异常退出 exit=${r.status})` : ''}`);
    fs.writeFileSync(target, orig);
  }
} finally {
  fs.writeFileSync(target, orig);
  try { fs.unlinkSync(tmpDb); } catch {}
  console.log(sha(fs.readFileSync(target)) === origSha ? `[RESTORED] proto-settlement-c1.mjs 已还原, sha256 ${origSha.slice(0, 16)}… 一致` : '[!!! 还原失败 !!!]');
}
console.log(allRed ? '\n全部变异均被测试抓到' : '\n⚠ 有变异存活或锚点失配, 见上');
process.exit(allRed ? 0 : 1);
