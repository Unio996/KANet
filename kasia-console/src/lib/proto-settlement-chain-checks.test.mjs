// proto-settlement-chain-checks.test.mjs — C1: 各结算步骤 covenant 输入的链上【面值 + spk】断言正反向量(与 N-1 步骤① 同型; Bettor 转 Codex 新不变量)。
// 面值常量来源: simnet 全链六笔真实交易的输出面值(docs/provenance/2026-09-19-j2-fullchain-simnet/raw-onchain-fullchain-node-records.json)——covenant 输出恒为 20,000,000。
// 9-1 B 笔(v0.3.4 §19.3 步骤 4 / §19.6): M6 两个必填参数 expectedOutpoints / expectedCovenantIds + 类型化错误 SettlementChainCheckError(.code 闭集); 既有 16 处调用同笔更新(经 A() 补参), 消息正则未改。
// Run: cd kasia-console && node src/lib/proto-settlement-chain-checks.test.mjs
import fs from 'node:fs';

// 9-2b 清理(账本 1574/1584): F3 拆出无 DB 依赖的纯函数后, 本文件测的模块不再需要"起临时 DB 只为过 import 链"的 bootstrap(此前整段 execSync run-migrations + 子进程重入已删)。
// 下面这条守住它: 无 DB_PATH 的子进程里逐个真 import, 全部成功(将来谁又把 db/client 拖进这条 import 链, 这里立刻红)。
{
  const { spawnSync } = await import('node:child_process');
  const env = { ...process.env }; delete env.DB_PATH;
  for (const m of ["proto-settlement-chain-checks.mjs"]) {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('./' + m, import.meta.url).href)})`], { env, encoding: 'utf8' });
    if (r.status !== 0) { console.error('[FAIL] 无 DB_PATH 时 import ' + m + ' 失败: ' + (r.stderr || '').split('\n')[0]); process.exit(1); }
  }
}
const { assertSettlementInputValuesOnChain, EXPECTED_INPUT_VALUE_SOMPI, STEP_INPUT_ROLES, SettlementChainCheckError, chainCheckCodes } = await import('./proto-settlement-chain-checks.mjs');
const REAL = JSON.parse(fs.readFileSync(new URL('../../../docs/provenance/2026-09-19-j2-fullchain-simnet/raw-onchain-fullchain-node-records.json', import.meta.url), 'utf8'));

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const throws = (fn, re, code) => { let e = null; try { fn(); } catch (x) { e = x; } if (!e) throw new Error('应该throw, 却成功返回了'); if (!re.test(e.message)) throw new Error(`throw了但报文不对: ${e.message}`);
  // 9-1 B 笔: 每个抛出的错误都必须是类型化错误且 .code 在闭集内(现有三类 + 新增两类); 消息正则(C7)保持原样
  if (!(e instanceof SettlementChainCheckError)) throw new Error(`不是 SettlementChainCheckError: ${e.constructor && e.constructor.name}: ${e.message}`);
  if (!chainCheckCodes().includes(e.code)) throw new Error(`.code ${e.code} 不在闭集内`);
  if (code !== undefined && e.code !== code) throw new Error(`期望 .code=${code}, 实际 ${e.code}: ${e.message}`); };
const V = 20_000_000n;
const ROLES = Object.keys(EXPECTED_INPUT_VALUE_SOMPI);
const spkFor = (role) => 'aa20' + Buffer.from(role.padEnd(32, '_')).toString('hex') + '87'; // 各角色互不相同的 P2SH 形 spk(测试夹具, 非真实脚本)
const goodUtxos = () => Object.fromEntries(ROLES.map((r) => [r, { value: V, scriptPublicKeyHex: spkFor(r), outpoint: goodOps()[r], covenantId: goodCovs()[r] }]));
const goodSpks = () => Object.fromEntries(ROLES.map((r) => [r, spkFor(r)]));
// M6(9-1 B 笔): 每个角色的预期 outpoint 与预期 covenant id(ticket = null: 普通 P2SH 无 covenant; 其余 covenant 角色各给一个互不相同的 64 位 hex)
const hex32 = (label) => Buffer.from(label.padEnd(32, '_')).toString('hex');
const goodOps = () => Object.fromEntries(ROLES.map((r, i) => [r, { transactionId: hex32('tx-' + r), index: i }]));
const goodCovs = () => Object.fromEntries(ROLES.map((r) => [r, r === 'ticket' ? null : hex32('cov-' + r)]));
const goodUtxosFull = () => Object.fromEntries(ROLES.map((r) => [r, { value: V, scriptPublicKeyHex: spkFor(r), outpoint: goodOps()[r], covenantId: goodCovs()[r] }]));
// A(): 既有 16 处调用统一经它补上两个必填参数——既有用例的消息正则一字未改; 测'缺参'的新用例直接用 callRaw, 不经 A
const A = (o) => assertSettlementInputValuesOnChain({ expectedOutpoints: goodOps(), expectedCovenantIds: goodCovs(), ...o });

t('常量可追溯到真实链上交易: 全链六笔里所有带 covenant 的输出面值恒为 20,000,000, 与 EXPECTED_INPUT_VALUE_SOMPI 一致', () => {
  for (const k of ROLES) if (EXPECTED_INPUT_VALUE_SOMPI[k] !== V) throw new Error(`${k} 期望面值 ${EXPECTED_INPUT_VALUE_SOMPI[k]} != 20,000,000`);
  let covOutputs = 0;
  for (const [name, tx] of Object.entries(REAL.txs)) for (const o of tx.outputs.filter((x) => x.covenant)) { covOutputs++; if (Number(o.value) !== 20_000_000) throw new Error(`${name} 有 covenant 输出面值 ${o.value} != 20,000,000`); }
  if (covOutputs < 6) throw new Error(`真实记录里 covenant 输出只有 ${covOutputs} 个, 常量无从追溯`);
});
for (const step of Object.keys(STEP_INPUT_ROLES)) {
  t(`${step}: 输入角色(${STEP_INPUT_ROLES[step].join('/')})面值==20,000,000 且 spk==builder 假设值 ⇒ 通过; 字符串/BigInt/number 形态、0x 前缀/大写 spk 都通过`, () => {
    A({ step, chainUtxos: goodUtxos(), expectedSpks: goodSpks() });
    A({ step, chainUtxos: Object.fromEntries(ROLES.map((r) => [r, { value: String(V), scriptPublicKeyHex: '0x' + spkFor(r).toUpperCase(), outpoint: goodOps()[r], covenantId: goodCovs()[r] }])), expectedSpks: goodSpks() });
    A({ step, chainUtxos: Object.fromEntries(ROLES.map((r) => [r, { value: Number(V), scriptPublicKeyHex: spkFor(r), outpoint: goodOps()[r], covenantId: goodCovs()[r] }])), expectedSpks: Object.fromEntries(ROLES.map((r) => [r, '0x' + spkFor(r)])) });
  });
  for (const role of STEP_INPUT_ROLES[step]) {
    t(`${step}/${role}: 面值偏小(1000)/偏大(+1)/缺失/已花费/面值缺失 ⇒ ${role}_value_drift; spk 不符/链上 spk 缺失/假设 spk 缺失 ⇒ ${role}_spk_drift 或 fail-closed`, () => {
      const u = (over) => ({ ...goodUtxos(), [role]: over });
      const ok = goodUtxos()[role];
      throws(() => A({ step, chainUtxos: u({ ...ok, value: 1000n }), expectedSpks: goodSpks() }), new RegExp(`${role}_value_drift.*!=`));
      throws(() => A({ step, chainUtxos: u({ ...ok, value: V + 1n }), expectedSpks: goodSpks() }), new RegExp(`${role}_value_drift`));
      throws(() => A({ step, chainUtxos: u(undefined), expectedSpks: goodSpks() }), new RegExp(`${role}_value_drift.*查不到`));
      throws(() => A({ step, chainUtxos: u({ ...ok, spent: true }), expectedSpks: goodSpks() }), new RegExp(`${role}_value_drift.*已被花费`));
      throws(() => A({ step, chainUtxos: u({ scriptPublicKeyHex: spkFor(role) }), expectedSpks: goodSpks() }), new RegExp(`${role}_value_drift.*缺失`));
      throws(() => A({ step, chainUtxos: u({ ...ok, scriptPublicKeyHex: 'aa20' + '11'.repeat(32) + '87' }), expectedSpks: goodSpks() }), new RegExp(`${role}_spk_drift`));
      throws(() => A({ step, chainUtxos: u({ value: V }), expectedSpks: goodSpks() }), /链上 spk 缺失/);
      throws(() => A({ step, chainUtxos: goodUtxos(), expectedSpks: { ...goodSpks(), [role]: undefined } }), /缺少 builder 假设的 spk/);
    });
  }
}
t('未知步骤 / chainUtxos 缺失 / expectedSpks 缺失 ⇒ 拒绝', () => {
  throws(() => A({ step: 'nope', chainUtxos: goodUtxos(), expectedSpks: goodSpks() }), /未知步骤/);
  throws(() => A({ step: 'seal', chainUtxos: undefined, expectedSpks: goodSpks() }), /chainUtxos 缺失/);
  throws(() => A({ step: 'seal', chainUtxos: goodUtxos(), expectedSpks: undefined }), /expectedSpks 缺失/);
});
t('只核该步骤需要的角色: close_commit 不因 leaf/ticket 异常而拒(它们不是该步输入)', () => {
  A({ step: 'close_commit', chainUtxos: { rootClose: { value: V, scriptPublicKeyHex: spkFor('rootClose'), outpoint: goodOps().rootClose, covenantId: goodCovs().rootClose }, leaf: { value: 1n }, ticket: { value: 1n } }, expectedSpks: { rootClose: spkFor('rootClose') } });
});
t('覆盖范围(Bettor 转 Codex): close_commit/convert_to_claim/claim_draw/withdraw/ticket_reclaim 的每个 covenant 输入角色都在断言表里', () => {
  const need = { close_commit: ['rootClose'], convert_to_claim: ['rootClose', 'held'], claim_draw: ['rootClaim', 'ticket', 'held'], withdraw: ['claim', 'held'], ticket_reclaim: ['ticket'] };
  for (const [step, roles] of Object.entries(need)) if (JSON.stringify(STEP_INPUT_ROLES[step]) !== JSON.stringify(roles)) throw new Error(`${step} 的角色表 ${JSON.stringify(STEP_INPUT_ROLES[step])} != ${JSON.stringify(roles)}`);
});
// ══ 9-1 B 笔(v0.3.4 §19.3 步骤 4 / §19.6): M6 必填参数 + 类型化错误 ═══════════════════════════════════════════════════════
// 以上既有用例经 A() 补上了 M6 的两个必填参数(goodOps/goodCovs), 其原有的消息正则一字未改仍绿(C7)。以下是新增用例。
const CODES = chainCheckCodes();
const capture = (fn) => { let e = null; try { fn(); } catch (x) { e = x; } if (!e) throw new Error('应该throw, 却成功返回了'); return e; };
const callRaw = (o) => assertSettlementInputValuesOnChain(o);      // 不经 A(): 直接调, 用来测"缺参"

t('闭集: chainCheckCodes() = 每个角色 4 类(value_drift/spk_drift/outpoint_drift/covenant_class_mismatch) + chain_check_params_missing + chain_check_unknown_step', () => {
  if (CODES.length !== ROLES.length * 4 + 2) throw new Error(`闭集大小 ${CODES.length} != ${ROLES.length * 4 + 2}`);
  for (const r of ROLES) for (const k of ['value_drift', 'spk_drift', 'outpoint_drift', 'covenant_class_mismatch']) if (!CODES.includes(`${r}_${k}`)) throw new Error(`闭集缺 ${r}_${k}`);
  for (const c of ['chain_check_params_missing', 'chain_check_unknown_step']) if (!CODES.includes(c)) throw new Error(`闭集缺 ${c}`);
  if (!Object.isFrozen(CODES)) throw new Error('闭集必须是冻结的');
});

t('C6 ▲ M6 两个新参数必填、没有默认值: 缺 expectedOutpoints / 缺 expectedCovenantIds / 两个都缺(旧调用形状)⇒ SettlementChainCheckError(chain_check_params_missing)', () => {
  for (const step of Object.keys(STEP_INPUT_ROLES)) {
    const base = { step, chainUtxos: goodUtxos(), expectedSpks: goodSpks() };
    throws(() => callRaw({ ...base, expectedCovenantIds: goodCovs() }), /expectedOutpoints 缺失/, 'chain_check_params_missing');
    throws(() => callRaw({ ...base, expectedOutpoints: goodOps() }), /expectedCovenantIds 缺失/, 'chain_check_params_missing');
    throws(() => callRaw(base), /expectedOutpoints 缺失/, 'chain_check_params_missing');          // 旧调用形状 = 缺参必红, 不是静默放行
  }
});
t('C6b 预期 outpoint 逐角色缺失/格式不合法 ⇒ chain_check_params_missing(不是静默跳过这个角色)', () => {
  for (const step of Object.keys(STEP_INPUT_ROLES)) for (const role of STEP_INPUT_ROLES[step]) {
    const bad = (v) => { const o = goodOps(); if (v === 'DEL') delete o[role]; else o[role] = v; return o; };
    for (const v of ['DEL', null, {}, { transactionId: 'ab', index: 0 }, { transactionId: 'z'.repeat(64), index: 0 }, { transactionId: 'a'.repeat(64), index: -1 }, { transactionId: 'a'.repeat(64), index: 1.5 }, { transactionId: 'a'.repeat(64), index: '0' }]) {
      throws(() => A({ step, chainUtxos: goodUtxos(), expectedSpks: goodSpks(), expectedOutpoints: bad(v) }), /预期 outpoint/, 'chain_check_params_missing');
    }
  }
});
t('C6c 预期 covenant id 逐角色缺键/格式不合法 ⇒ chain_check_params_missing(null 是合法的"必须无 covenant", undefined/缺键不是)', () => {
  for (const step of Object.keys(STEP_INPUT_ROLES)) for (const role of STEP_INPUT_ROLES[step]) {
    const bad = (v) => { const o = goodCovs(); if (v === 'DEL') delete o[role]; else o[role] = v; return o; };
    for (const v of ['DEL', undefined, 'nothex', 'ab', 5, {}]) {
      throws(() => A({ step, chainUtxos: goodUtxos(), expectedSpks: goodSpks(), expectedCovenantIds: bad(v) }), /预期 covenant id/, 'chain_check_params_missing');
    }
  }
});

for (const step of Object.keys(STEP_INPUT_ROLES)) for (const role of STEP_INPUT_ROLES[step]) {
  t(`${step}/${role}: outpoint 不等 ⇒ ${role}_outpoint_drift(txid 不同 / index 不同 / 同 txid 不同 index[N-T1 同族] / 链上缺 outpoint); 大小写不敏感地相等则通过`, () => {
    const withOp = (op) => ({ ...goodUtxos(), [role]: { ...goodUtxos()[role], outpoint: op } });
    const want = goodOps()[role];
    const run = (chainUtxos) => A({ step, chainUtxos, expectedSpks: goodSpks() });
    const code = `${role}_outpoint_drift`;
    throws(() => run(withOp({ transactionId: 'f'.repeat(64), index: want.index })), new RegExp(`${code}.*!= 预期指针`), code);
    throws(() => run(withOp({ transactionId: want.transactionId, index: want.index + 1 })), new RegExp(code), code);
    throws(() => run(withOp({ transactionId: want.transactionId, index: 0 === want.index ? 7 : 0 })), new RegExp(code), code);     // 同 txid、另一个 index
    throws(() => run({ ...goodUtxos(), [role]: { value: V, scriptPublicKeyHex: spkFor(role), covenantId: goodCovs()[role] } }), new RegExp(`${code}.*缺 outpoint`), code);
    run(withOp({ transactionId: want.transactionId.toUpperCase(), index: want.index }));      // 大小写不敏感: 通过
  });
  t(`${step}/${role}: covenant 不符 ⇒ ${role}_covenant_class_mismatch(id 不同 / 期望有却无 / 期望无却有 / 链上缺 covenantId 键 / 链上 covenantId 格式坏); 相等(含大小写差异)则通过`, () => {
    const withCov = (c, del) => { const u = { ...goodUtxos()[role], covenantId: c }; if (del) delete u.covenantId; return { ...goodUtxos(), [role]: u }; };
    const run = (chainUtxos, expectedCovenantIds = goodCovs()) => A({ step, chainUtxos, expectedSpks: goodSpks(), expectedCovenantIds });
    const code = `${role}_covenant_class_mismatch`;
    const wantCov = goodCovs()[role];
    if (wantCov === null) {
      throws(() => run(withCov('a'.repeat(64))), new RegExp(`${code}.*必须无 covenant`), code);          // ticket: 链上被回报成 covenant
    } else {
      throws(() => run(withCov(null)), new RegExp(`${code}.*无`), code);                                  // 期望 covenant, 链上回 null
      throws(() => run(withCov('b'.repeat(64))), new RegExp(code), code);                                 // 同为 covenant 但 id 不同(相等, 不只是有/无)
      run(withCov(wantCov.toUpperCase()));                                                                 // 大小写不敏感: 通过
    }
    throws(() => run(withCov(undefined, true)), new RegExp(`${code}.*缺 covenantId 键`), code);           // 缺键 ≠ 无 covenant
    throws(() => run(withCov('nothex')), new RegExp(`${code}.*格式不合法`), code);
  });
}

t('面值不是整数(BigInt 无法解析)⇒ 类型化的 <role>_value_drift, 不是裸 SyntaxError 逃出闭集', () => {
  for (const bad of ['abc', '1.5', {}]) {
    const u = { ...goodUtxos() }; u.leaf = { ...goodUtxos().leaf, value: bad };
    throws(() => A({ step: 'seal', chainUtxos: u, expectedSpks: goodSpks() }), /leaf_value_drift.*不是整数/, 'leaf_value_drift');
  }
  // 空串: BigInt('') === 0n 不会抛(JS 语义), 走普通的"面值不等"分支——同样是类型化的 value_drift, 只是消息不同(0 != 20,000,000)
  { const u = { ...goodUtxos() }; u.leaf = { ...goodUtxos().leaf, value: '' };
    throws(() => A({ step: 'seal', chainUtxos: u, expectedSpks: goodSpks() }), /leaf_value_drift.*!=/, 'leaf_value_drift'); }
});
t('缺 builder 假设的 spk ⇒ code=chain_check_params_missing, 而消息仍含原标签 <role>_value_drift(C7: 文本不变, 机器标识在 .code)', () => {
  const e = capture(() => A({ step: 'seal', chainUtxos: goodUtxos(), expectedSpks: { ...goodSpks(), leaf: undefined } }));
  if (e.code !== 'chain_check_params_missing') throw new Error(`code=${e.code}`);
  if (!/leaf_value_drift/.test(e.message) || !/缺少 builder 假设的 spk/.test(e.message)) throw new Error(`消息标签变了: ${e.message}`);
});
t('C7 ▲ 每个抛出的错误都是 SettlementChainCheckError 且 .code ∈ 闭集, 携带 step/role; 消息仍含原标签(现有三类 + 新增两类都带 .code)', () => {
  const cases = [
    [() => A({ step: 'nope', chainUtxos: goodUtxos(), expectedSpks: goodSpks() }), 'chain_check_unknown_step', /未知步骤/, undefined],
    [() => A({ step: 'seal', chainUtxos: undefined, expectedSpks: goodSpks() }), 'chain_check_params_missing', /chainUtxos 缺失/, undefined],
    [() => A({ step: 'seal', chainUtxos: goodUtxos(), expectedSpks: undefined }), 'chain_check_params_missing', /expectedSpks 缺失/, undefined],
    [() => A({ step: 'seal', chainUtxos: { ...goodUtxos(), leaf: undefined }, expectedSpks: goodSpks() }), 'leaf_value_drift', /leaf_value_drift.*查不到/, 'leaf'],
    [() => A({ step: 'seal', chainUtxos: { ...goodUtxos(), leaf: { ...goodUtxos().leaf, spent: true } }, expectedSpks: goodSpks() }), 'leaf_value_drift', /leaf_value_drift.*已被花费/, 'leaf'],
    [() => A({ step: 'seal', chainUtxos: { ...goodUtxos(), leaf: { ...goodUtxos().leaf, value: 1n } }, expectedSpks: goodSpks() }), 'leaf_value_drift', /leaf_value_drift.*!=/, 'leaf'],
    [() => A({ step: 'seal', chainUtxos: { ...goodUtxos(), leaf: { ...goodUtxos().leaf, scriptPublicKeyHex: 'aa20' + '11'.repeat(32) + '87' } }, expectedSpks: goodSpks() }), 'leaf_spk_drift', /leaf_spk_drift/, 'leaf'],
    [() => A({ step: 'seal', chainUtxos: { ...goodUtxos(), leaf: { ...goodUtxos().leaf, scriptPublicKeyHex: undefined } }, expectedSpks: goodSpks() }), 'leaf_spk_drift', /链上 spk 缺失/, 'leaf'],
    [() => A({ step: 'seal', chainUtxos: { ...goodUtxos(), leaf: { ...goodUtxos().leaf, outpoint: { transactionId: 'e'.repeat(64), index: 9 } } }, expectedSpks: goodSpks() }), 'leaf_outpoint_drift', /leaf_outpoint_drift/, 'leaf'],
    [() => A({ step: 'seal', chainUtxos: { ...goodUtxos(), leaf: { ...goodUtxos().leaf, covenantId: null } }, expectedSpks: goodSpks() }), 'leaf_covenant_class_mismatch', /leaf_covenant_class_mismatch/, 'leaf'],
  ];
  for (const [fn, code, re, role] of cases) {
    const e = capture(fn);
    if (!(e instanceof SettlementChainCheckError)) throw new Error(`不是 SettlementChainCheckError: ${e && e.constructor && e.constructor.name}: ${e.message}`);
    if (e.code !== code) throw new Error(`期望 code=${code}, 实际 ${e.code}(${e.message.slice(0, 80)})`);
    if (!CODES.includes(e.code)) throw new Error(`code ${e.code} 不在闭集内`);
    if (!re.test(e.message)) throw new Error(`消息缺原标签 ${re}: ${e.message}`);
    if (e.step !== (code === 'chain_check_unknown_step' ? 'nope' : 'seal')) throw new Error(`step 字段不对: ${e.step}`);
    if (role !== undefined && e.role !== role) throw new Error(`role 字段不对: ${e.role}`);
  }
});
t('成功返回形状不变: { ok:true, checked:[该步角色…] }; 只核该步需要的角色(新参数里多给的别的角色被忽略)', () => {
  const r = A({ step: 'convert_to_claim', chainUtxos: goodUtxos(), expectedSpks: goodSpks() });
  if (JSON.stringify(r) !== JSON.stringify({ ok: true, checked: ['rootClose', 'held'] })) throw new Error(JSON.stringify(r));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
