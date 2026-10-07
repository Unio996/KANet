// recovery-builders.test.mjs — 账本1867: KanetTokenClaim.retire / PoolSideTicket.sweep 构造器的【不依赖链】护栏。
//   纯函数: _recoverySinkSpk(去向只能由 ctor 里烤的 sink_pk 派生) / _recoveryFee(≤ 合约上限) / _recoveryAge("绝不早于年龄", 边界两侧)。
//   结构断言: sequence 必须 = 年龄门槛(OpCheckSequenceVerify)、无 to/change_address 参数、命令三层注册、relay.mjs 有 case。
//   链上行为(合约入口真过 / 年龄前节点拒)见 docs/provenance/2026-10-07-j2-retire-sweep/(simnet 真广播)。
// Run: cd kasia-relay && node src/lib/recovery-builders.test.mjs     零 RPC 零 live。
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
process.env.KASPA_NETWORK ||= 'simnet';
const here = dirname(fileURLToPath(import.meta.url));
const P = await import('./p2sh.mjs');
const C = await import('./commands.mjs');
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };

const SINK = 'ab'.repeat(32);
const redeemWithSink = Buffer.concat([Buffer.from('6b20', 'hex'), Buffer.alloc(40, 0x11), Buffer.from(SINK, 'hex'), Buffer.alloc(10, 0x22)]).toString('hex');

await t('_recoverySinkSpk: 返回 P2PK spk(version 0, 20<pk>ac)', () => {
  const s = P._recoverySinkSpk(SINK, redeemWithSink, 'x');
  assert.strictEqual(Number(s.version), 0);
  assert.strictEqual(String(s.script), '20' + SINK + 'ac');
});
await t('_recoverySinkSpk: pk 不在 redeem 字节里 ⇒ 拒(防把钱导向合约之外的 pk)', () => {
  assert.throws(() => P._recoverySinkSpk('cd'.repeat(32), redeemWithSink, 'x'), /不在该 redeem 字节里/);
});
await t('_recoverySinkSpk: 非法/全零 pk ⇒ 拒', () => {
  assert.throws(() => P._recoverySinkSpk('zz', redeemWithSink, 'x'), /64 位/);
  assert.throws(() => P._recoverySinkSpk('00'.repeat(32), redeemWithSink, 'x'), /非全零/);
  assert.throws(() => P._recoverySinkSpk(undefined, redeemWithSink, 'x'), /64 位/);
});
await t('_recoveryFee: ≤ 合约上限 5,000,000; 超限 / ≤0 ⇒ 抛', () => {
  assert.strictEqual(P.RECOVERY_MAX_FEE_SOMPI, 5_000_000n);
  assert.strictEqual(P._recoveryFee(5_000_000, 1n, 'x'), 5_000_000n);
  assert.throws(() => P._recoveryFee(5_000_001, 1n, 'x'), /> 合约上限/);
  assert.throws(() => P._recoveryFee(0, 1n, 'x'), /≤ 0/);
  assert.throws(() => P._recoveryFee(undefined, 0n, 'x'), /≤ 0/);   // 站点默认未填实测值 ⇒ 不允许静默 0 费
  assert.strictEqual(P._recoveryFee(undefined, 777n, 'x'), 777n);
});
const floors = JSON.parse(readFileSync(join(here, '../../../docs/provenance/2026-10-07-j2-retire-sweep/measured_floors.json'), 'utf8'));
await t('RECOVERY_SITE_FEE_SOMPI: 冻结; ≥ 1.25× 节点实测下限(默认预算下) 且 ≤ 合约上限', () => {
  assert.ok(Object.isFrozen(P.RECOVERY_SITE_FEE_SOMPI));
  const F = P.RECOVERY_SITE_FEE_SOMPI, d = floors.at_default_budgets;
  assert.ok(F.claimRetire * 100n >= BigInt(d.claimRetire_floor_sompi) * 125n, 'claimRetire < 1.25×实测');
  assert.ok(F.ticketSweep * 100n >= BigInt(d.ticketSweep_floor_sompi) * 125n, 'ticketSweep < 1.25×实测');
  for (const k of ['claimRetire', 'ticketSweep']) assert.ok(F[k] > 0n && F[k] <= P.RECOVERY_MAX_FEE_SOMPI, k);
  assert.strictEqual(F.claimRetire, BigInt(floors.constants.claimRetire));
  assert.strictEqual(F.ticketSweep, BigInt(floors.constants.ticketSweep));
});
await t('RECOVERY_COMPUTE_BUDGET: 冻结; 默认预算 ≥ 2× simnet 实测最小可行, 且手续费证据是在这组预算下测的', () => {
  const B = P.RECOVERY_COMPUTE_BUDGET, m = floors.budget_min_working_simnet;
  assert.ok(Object.isFrozen(B));
  assert.ok(B.claim >= 2 * m.claim && B.token >= 2 * m.token && B.ticket >= 2 * m.ticket);
  assert.deepStrictEqual({ ...B }, floors.budget_default);
});
await t('旧预算(300/100)下的 retire 下限 4,787,600 距合约上限不足 5% ⇒ 默认不得回到 300', () => {
  assert.ok(P.RECOVERY_COMPUTE_BUDGET.claim < 300);
  assert.ok(BigInt(floors.at_budget_300_100_claim.claimRetire_floor_sompi) * 100n > P.RECOVERY_MAX_FEE_SOMPI * 95n);
});
await t('_recoveryAge: 门槛 − 1 / 门槛 / 门槛 + 余量 − 1 / 门槛 + 余量 的边界两侧', () => {
  const a = (age, margin = 50) => P._recoveryAge({ virtualDaa: 1000 + age, blockDaa: 1000, requiredDaa: 400, marginDaa: margin });
  assert.strictEqual(a(399).eligible, false);
  assert.strictEqual(a(400).eligible, false, '恰到门槛但无余量 ⇒ 仍拒(节点 tip 漂移)');
  assert.strictEqual(a(449).eligible, false);
  assert.strictEqual(a(450).eligible, true);
  assert.strictEqual(a(400, 0).eligible, true);
  assert.strictEqual(a(10_000).ageDaa, 10_000);
});
await t('_recoveryAge: 非法 required_daa / 非数 ⇒ 抛或不合格(不放行)', () => {
  assert.throws(() => P._recoveryAge({ virtualDaa: 10, blockDaa: 0, requiredDaa: 0 }), /非法/);
  assert.throws(() => P._recoveryAge({ virtualDaa: 10, blockDaa: 0, requiredDaa: 2 ** 33 }), /非法/);
  assert.strictEqual(P._recoveryAge({ virtualDaa: 'x', blockDaa: 0, requiredDaa: 5 }).eligible, false);
  assert.strictEqual(P._recoveryAge({ virtualDaa: 10, blockDaa: undefined, requiredDaa: 5 }).eligible, false);
});

const src = readFileSync(join(here, 'p2sh.mjs'), 'utf8');
const sec = src.slice(src.indexOf('export async function unlockClaimRetire'));
await t('构造器: 年龄门 sequence = 门槛(OpCheckSequenceVerify) — retire 的 claim 输入、sweep 的票输入', () => {
  assert.match(sec, /sequence: BigInt\(retireDaa\), sigOpCount: 0, computeBudget: CB_CLAIM/);
  assert.match(sec, /sequence: BigInt\(sweepDaa\), sigOpCount: 0, computeBudget: Number\(cmd\.compute_budget/);
});
await t('构造器: 无 to / change_address 参数(去向不可被调用方指定); 输出 spk 只来自 _recoverySinkSpk', () => {
  const body = sec.slice(0, sec.indexOf('// ── 回收脚本用的两个只读'));
  assert.ok(!/cmd\.to\b|change_address|cmd\.outputs/.test(body), '回收构造器不应读取 to/change_address/outputs');
  assert.strictEqual((body.match(/new TransactionOutput\(/g) || []).length, 2, 'retire 与 sweep 各恰一个输出');
  assert.strictEqual((body.match(/_recoverySinkSpk\(/g) || []).length, 2);
});
await t('构造器: live 路径在年龄不合格时抛(绝不早于年龄), dry_run 才放行回 eligible:false', () => {
  assert.strictEqual((sec.match(/if \(!age\.eligible && !cmd\.dry_run\) throw/g) || []).length, 2);
});
await t('构造器: 无钱包 — 回收 builder 不引用 wallet / getPrivateKey / createInputSignature', () => {
  const body = sec.slice(0, sec.indexOf('// ── 回收脚本用的两个只读'));
  assert.ok(!/wallet|getPrivateKey|createInputSignature/.test(body));
});
await t('命令三层注册(enum + required + field types) + relay.mjs case', () => {
  for (const [name, val, ageField] of [['ZK_CLAIM_RETIRE', 'zk_claim_retire', 'retire_daa'], ['ZK_TICKET_SWEEP', 'zk_ticket_sweep', 'sweep_daa']]) {
    assert.strictEqual(C.COMMAND_TYPES[name], val);
    assert.ok(C.COMMAND_PAYLOAD_SCHEMA[val].includes(ageField) && C.COMMAND_PAYLOAD_SCHEMA[val].includes('sink_pk_hex'));
    assert.ok(C.validateCommandPayload({ type: val, witness: {}, inputs: {}, sink_pk_hex: SINK, [ageField]: 400 }).valid);
    assert.ok(!C.validateCommandPayload({ type: val, witness: {}, inputs: {}, [ageField]: 400 }).valid, 'sink_pk_hex 缺 ⇒ 拒');
    assert.ok(!C.validateCommandPayload({ type: val, witness: {}, inputs: {}, sink_pk_hex: SINK }).valid, `${ageField} 缺 ⇒ 拒`);
  }
  const rl = readFileSync(join(here, '../relay.mjs'), 'utf8');
  assert.match(rl, /case 'zk_claim_retire': \{[\s\S]*?unlockClaimRetire\(\{ cmd, networkId/);
  assert.match(rl, /case 'zk_ticket_sweep': \{[\s\S]*?unlockTicketSweep\(\{ cmd, networkId/);
});
await t('回收命令不在 READONLY_ALLOWLIST(会花钱 ⇒ 不得被当只读放行)', () => {
  const au = readFileSync(join(here, 'authorize.mjs'), 'utf8');
  assert.ok(!/zk_claim_retire|zk_ticket_sweep|ZK_CLAIM_RETIRE|ZK_TICKET_SWEEP/.test(au));
});
console.log(`\n${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
