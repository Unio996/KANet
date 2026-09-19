// proto-settlement-chain-checks.test.mjs — C1: 各结算步骤 covenant 输入的链上【面值 + spk】断言正反向量(与 N-1 步骤① 同型; Bettor 转 Codex 新不变量)。
// 面值常量来源: simnet 全链六笔真实交易的输出面值(docs/provenance/2026-09-19-j2-fullchain-simnet/raw-onchain-fullchain-node-records.json)——covenant 输出恒为 20,000,000。
// Run: cd kasia-console && node src/lib/proto-settlement-chain-checks.test.mjs
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_CHAIN_CHECKS_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_chain_checks_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_CHAIN_CHECKS_TEST_BOOTSTRAPPED: '1' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}
const { assertSettlementInputValuesOnChain, EXPECTED_INPUT_VALUE_SOMPI, STEP_INPUT_ROLES } = await import('./proto-settlement-chain-checks.mjs');
const REAL = JSON.parse(fs.readFileSync(new URL('../../../docs/provenance/2026-09-19-j2-fullchain-simnet/raw-onchain-fullchain-node-records.json', import.meta.url), 'utf8'));

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const throws = (fn, re) => { let e = null; try { fn(); } catch (x) { e = x; } if (!e) throw new Error('应该throw, 却成功返回了'); if (!re.test(e.message)) throw new Error(`throw了但报文不对: ${e.message}`); };
const V = 20_000_000n;
const ROLES = Object.keys(EXPECTED_INPUT_VALUE_SOMPI);
const spkFor = (role) => 'aa20' + Buffer.from(role.padEnd(32, '_')).toString('hex') + '87'; // 各角色互不相同的 P2SH 形 spk(测试夹具, 非真实脚本)
const goodUtxos = () => Object.fromEntries(ROLES.map((r) => [r, { value: V, scriptPublicKeyHex: spkFor(r) }]));
const goodSpks = () => Object.fromEntries(ROLES.map((r) => [r, spkFor(r)]));

t('常量可追溯到真实链上交易: 全链六笔里所有带 covenant 的输出面值恒为 20,000,000, 与 EXPECTED_INPUT_VALUE_SOMPI 一致', () => {
  for (const k of ROLES) if (EXPECTED_INPUT_VALUE_SOMPI[k] !== V) throw new Error(`${k} 期望面值 ${EXPECTED_INPUT_VALUE_SOMPI[k]} != 20,000,000`);
  let covOutputs = 0;
  for (const [name, tx] of Object.entries(REAL.txs)) for (const o of tx.outputs.filter((x) => x.covenant)) { covOutputs++; if (Number(o.value) !== 20_000_000) throw new Error(`${name} 有 covenant 输出面值 ${o.value} != 20,000,000`); }
  if (covOutputs < 6) throw new Error(`真实记录里 covenant 输出只有 ${covOutputs} 个, 常量无从追溯`);
});
for (const step of Object.keys(STEP_INPUT_ROLES)) {
  t(`${step}: 输入角色(${STEP_INPUT_ROLES[step].join('/')})面值==20,000,000 且 spk==builder 假设值 ⇒ 通过; 字符串/BigInt/number 形态、0x 前缀/大写 spk 都通过`, () => {
    assertSettlementInputValuesOnChain({ step, chainUtxos: goodUtxos(), expectedSpks: goodSpks() });
    assertSettlementInputValuesOnChain({ step, chainUtxos: Object.fromEntries(ROLES.map((r) => [r, { value: String(V), scriptPublicKeyHex: '0x' + spkFor(r).toUpperCase() }])), expectedSpks: goodSpks() });
    assertSettlementInputValuesOnChain({ step, chainUtxos: Object.fromEntries(ROLES.map((r) => [r, { value: Number(V), scriptPublicKeyHex: spkFor(r) }])), expectedSpks: Object.fromEntries(ROLES.map((r) => [r, '0x' + spkFor(r)])) });
  });
  for (const role of STEP_INPUT_ROLES[step]) {
    t(`${step}/${role}: 面值偏小(1000)/偏大(+1)/缺失/已花费/面值缺失 ⇒ ${role}_value_drift; spk 不符/链上 spk 缺失/假设 spk 缺失 ⇒ ${role}_spk_drift 或 fail-closed`, () => {
      const u = (over) => ({ ...goodUtxos(), [role]: over });
      const ok = { value: V, scriptPublicKeyHex: spkFor(role) };
      throws(() => assertSettlementInputValuesOnChain({ step, chainUtxos: u({ ...ok, value: 1000n }), expectedSpks: goodSpks() }), new RegExp(`${role}_value_drift.*!=`));
      throws(() => assertSettlementInputValuesOnChain({ step, chainUtxos: u({ ...ok, value: V + 1n }), expectedSpks: goodSpks() }), new RegExp(`${role}_value_drift`));
      throws(() => assertSettlementInputValuesOnChain({ step, chainUtxos: u(undefined), expectedSpks: goodSpks() }), new RegExp(`${role}_value_drift.*查不到`));
      throws(() => assertSettlementInputValuesOnChain({ step, chainUtxos: u({ ...ok, spent: true }), expectedSpks: goodSpks() }), new RegExp(`${role}_value_drift.*已被花费`));
      throws(() => assertSettlementInputValuesOnChain({ step, chainUtxos: u({ scriptPublicKeyHex: spkFor(role) }), expectedSpks: goodSpks() }), new RegExp(`${role}_value_drift.*缺失`));
      throws(() => assertSettlementInputValuesOnChain({ step, chainUtxos: u({ ...ok, scriptPublicKeyHex: 'aa20' + '11'.repeat(32) + '87' }), expectedSpks: goodSpks() }), new RegExp(`${role}_spk_drift`));
      throws(() => assertSettlementInputValuesOnChain({ step, chainUtxos: u({ value: V }), expectedSpks: goodSpks() }), /链上 spk 缺失/);
      throws(() => assertSettlementInputValuesOnChain({ step, chainUtxos: goodUtxos(), expectedSpks: { ...goodSpks(), [role]: undefined } }), /缺少 builder 假设的 spk/);
    });
  }
}
t('未知步骤 / chainUtxos 缺失 / expectedSpks 缺失 ⇒ 拒绝', () => {
  throws(() => assertSettlementInputValuesOnChain({ step: 'nope', chainUtxos: goodUtxos(), expectedSpks: goodSpks() }), /未知步骤/);
  throws(() => assertSettlementInputValuesOnChain({ step: 'seal', chainUtxos: undefined, expectedSpks: goodSpks() }), /chainUtxos 缺失/);
  throws(() => assertSettlementInputValuesOnChain({ step: 'seal', chainUtxos: goodUtxos(), expectedSpks: undefined }), /expectedSpks 缺失/);
});
t('只核该步骤需要的角色: close_commit 不因 leaf/ticket 异常而拒(它们不是该步输入)', () => {
  assertSettlementInputValuesOnChain({ step: 'close_commit', chainUtxos: { rootClose: { value: V, scriptPublicKeyHex: spkFor('rootClose') }, leaf: { value: 1n }, ticket: { value: 1n } }, expectedSpks: { rootClose: spkFor('rootClose') } });
});
t('覆盖范围(Bettor 转 Codex): close_commit/convert_to_claim/claim_draw/withdraw/ticket_reclaim 的每个 covenant 输入角色都在断言表里', () => {
  const need = { close_commit: ['rootClose'], convert_to_claim: ['rootClose', 'held'], claim_draw: ['rootClaim', 'ticket', 'held'], withdraw: ['claim', 'held'], ticket_reclaim: ['ticket'] };
  for (const [step, roles] of Object.entries(need)) if (JSON.stringify(STEP_INPUT_ROLES[step]) !== JSON.stringify(roles)) throw new Error(`${step} 的角色表 ${JSON.stringify(STEP_INPUT_ROLES[step])} != ${JSON.stringify(roles)}`);
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
