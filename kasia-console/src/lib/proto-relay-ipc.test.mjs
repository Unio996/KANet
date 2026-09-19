// proto-relay-ipc.test.mjs — 唯一受控出口 sendProtoCommand/protoSendCmd 回归(账本1440/1441,
// considered amendment #8)。真实断言: 白名单/relayId锁死/驱动闸(读写分离)/PROTO_RELAY_ID配置态。
// Run: cd kasia-console && node src/lib/proto-relay-ipc.test.mjs

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_RELAY_IPC_TEST_BOOTSTRAPPED) {
  // 本文件需要 PROTO_RELAY_ID 在【首次 import proto-relay-guard.mjs】之前就已配置(ESM 模块级常量,
  // 一次求值全进程冻结)——用子进程固定这个时序, 同 proto-driver.test.mjs/proto-relay-guard.test.mjs
  // 既有手法。PROTO_RELAY_ID 未配置的分支单独用另一个子进程测(见下方⑤), 不能在这个进程里测(常量已冻结)。
  // proto-relay-guard.mjs 间接 import db/client.js, 需要真实 DB_PATH(M0a 门), 即使本文件不碰任何表。
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_proto_relay_ipc_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, _PROTO_RELAY_IPC_TEST_BOOTSTRAPPED: '1', PROTO_RELAY_ID: 'ipc-test-relay', DB_PATH: tmpDb },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sendProtoCommand, protoSendCmd, PROTO_COMMAND_ALLOWLIST } = await import('./proto-relay-ipc.mjs');

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };

await t('①非白名单命令类型被拒(throw, 不发出任何 IPC)', async () => {
  let threw = null;
  try { await sendProtoCommand('transfer', { target: 'x', amount: 1 }); } catch (e) { threw = e; }
  if (!threw || !/not in allowlist/.test(threw.message)) throw new Error(`应该 throw allowlist 错误, 实际 ${threw && threw.message}`);
});

await t('②payload 携带 relay_id 字段(即使值为 undefined)一律被拒, 不生效', async () => {
  let threw = null;
  try { await sendProtoCommand('get_address_utxos', { address: 'kaspa:x', relay_id: undefined }); } catch (e) { threw = e; }
  if (!threw || !/carry '(relay_id|relayId)'/.test(threw.message)) throw new Error(`应该 throw relay_id 覆盖错误, 实际 ${threw && threw.message}`);
});

await t('②b payload 携带 relayId(驼峰) 同样被拒', async () => {
  let threw = null;
  try { await sendProtoCommand('get_address_utxos', { address: 'kaspa:x', relayId: 'someone-elses-relay' }); } catch (e) { threw = e; }
  if (!threw || !/carry '(relay_id|relayId)'/.test(threw.message)) throw new Error(`应该 throw relay_id 覆盖错误, 实际 ${threw && threw.message}`);
});

await t('②c(账本1442①) payload 携带 type 字段被拒——防止已过检查的 type 参数被 payload.type 覆盖', async () => {
  let threw = null;
  try { await sendProtoCommand('get_address_utxos', { address: 'kaspa:x', type: 'transfer' }); } catch (e) { threw = e; }
  if (!threw || !/'type'/.test(threw.message)) throw new Error(`应该 throw type 覆盖错误, 实际 ${threw && threw.message}`);
});

await t('②d(账本1442①) payload.type 即使是白名单内的另一条命令也一样被拒——不能靠"同样在白名单里"放行', async () => {
  let threw = null;
  try { await sendProtoCommand('get_mempool_entry', { txid: 'a'.repeat(64), type: 'get_address_utxos' }); } catch (e) { threw = e; }
  if (!threw || !/'type'/.test(threw.message)) throw new Error(`应该 throw type 覆盖错误, 实际 ${threw && threw.message}`);
});

await t('②e(账本1442②) origin 恒为 internal(五值fail-closed闸认可的值, 不是自造的proto)——用注入的假 sendCommandAsync 断言真正收到的第4个实参(不管调用方怎么传都不生效)', async () => {
  let capturedArgs = null;
  const fakeSendCommandAsync = (...args) => { capturedArgs = args; return Promise.resolve({ ok: true }); };
  await sendProtoCommand('get_address_utxos', { address: 'kaspa:x' }, { _sendCommandAsyncForTest: fakeSendCommandAsync });
  if (!capturedArgs) throw new Error('假 sendCommandAsync 没有被调用');
  const [relayIdArg, cmdArg, , originArg] = capturedArgs;
  if (relayIdArg !== 'ipc-test-relay') throw new Error(`relayId 应该是 PROTO_RELAY_ID(实际 ${relayIdArg})`);
  if (cmdArg.type !== 'get_address_utxos') throw new Error(`真正发出的 type 不对: ${cmdArg.type}`);
  if (originArg !== 'internal') throw new Error(`origin 应该恒为 'internal'(实际 ${originArg})`);
});

await t('②f(账本1442②) protoSendCmd 的 origin 参数即使传入非法值也不影响 sendProtoCommand 收到的 opts(protoSendCmd 根本不转发它)', async () => {
  // protoSendCmd 自己没有暴露 _sendCommandAsyncForTest 注入点(它是给已测试过的状态机文件用的适配层,
  // 不需要重复这条底层不变量的验证)——这里验证的是"它不会把 origin 参数错误地转发进 opts 对象"这条
  // 结构性质本身: 传入的 timeoutMs 必须原样透传(证明 opts 对象是真的在构造, 不是被吞掉), 而调用不会
  // 因为 origin 参数的存在报错或行为异常(即它被安静忽略, 不是被当成 opts 的一部分误用)。
  let threw = null;
  try { await protoSendCmd('ignored-relay', { type: 'get_address_utxos', address: 'kaspa:x' }, 12345, 'this-should-be-ignored'); }
  catch (e) { threw = e; } // 期望到达真实 sendCommandAsync 那一步再因为没有真relay而reject('Relay not running'), 不是在参数处理阶段就出错
  if (!threw || !/Relay not running/.test(threw.message)) throw new Error(`应该在真实 sendCommandAsync 层面失败(证明前面的处理没有因 origin 参数出岔子), 实际 ${threw && threw.message}`);
});

await t('③驱动关闭(PROTO_DRIVER_ENABLED 未设)时: covenant_broadcast(write) 被拒, 四条 read 命令全部放行到发送这一步(用 fail 的 sendCommandAsync 探测——到达说明没被闸拦, 不是真的发出成功)', async () => {
  delete process.env.PROTO_DRIVER_ENABLED;
  let threwWrite = null;
  try { await sendProtoCommand('covenant_broadcast', { tx_json: '{}', sign_input_indices: [0], expected_txid: 'a'.repeat(64) }); }
  catch (e) { threwWrite = e; }
  if (!threwWrite || !/proto_driver_disabled/.test(threwWrite.message)) throw new Error(`covenant_broadcast 应该被闸拒, 实际 ${threwWrite && threwWrite.message}`);

  for (const [type, payload] of [
    ['get_address_utxos', { address: 'kaspa:x' }],
    ['get_mempool_entry', { txid: 'a'.repeat(64) }],
    ['check_utxo_landed', { address: 'kaspa:x', txid: 'a'.repeat(64), minDepth: 1 }],
  ]) {
    let threwRead = null;
    try { await sendProtoCommand(type, payload); } catch (e) { threwRead = e; }
    // relay-manager 的真实 sendCommandAsync 在没有真实 relay 子进程时会 reject('Relay not running')——
    // 这正是我们想看到的: 说明请求已经越过了 proto_driver_disabled 这道闸, 卡在"没有真relay"这个
    // 无关的下游原因, 证明 read 命令没被驱动关闭闸挡住。
    if (!threwRead || /proto_driver_disabled/.test(threwRead.message)) {
      throw new Error(`${type} 不该被 proto_driver_disabled 闸挡住(实际: ${threwRead ? threwRead.message : '未抛错'})`);
    }
  }
});

await t('④白名单里标 write 的命令恰好只有 covenant_broadcast 一条(源码级断言, 防未来加写命令漏加闸)', () => {
  const writes = Object.entries(PROTO_COMMAND_ALLOWLIST).filter(([, mode]) => mode === 'write').map(([type]) => type);
  if (writes.length !== 1 || writes[0] !== 'covenant_broadcast') {
    throw new Error(`期望恰好 ['covenant_broadcast'], 实际 ${JSON.stringify(writes)}`);
  }
});

await t('⑤protoSendCmd 适配旧签名 sendCmd(relayId, cmd, timeoutMs, origin)——relayId 参数被忽略(不影响锁死行为), type/payload 正确拆分透传', async () => {
  let threw = null;
  try { await protoSendCmd('someone-elses-relay-id-that-should-be-ignored', { type: 'transfer', target: 'x' }, 5000, 'test'); }
  catch (e) { threw = e; }
  if (!threw || !/not in allowlist/.test(threw.message)) throw new Error(`应该按 type='transfer' 走白名单拒绝, 实际 ${threw && threw.message}`);
});

await t('⑥(账本1444, NWT复核抓到)8个Object.prototype自带属性名当type一律被拒(原型链洞), mock sendCommandAsync从未被调用', async () => {
  const dangerous = ['toString', 'constructor', '__proto__', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString'];
  for (const type of dangerous) {
    let called = false;
    const fakeSendCommandAsync = () => { called = true; return Promise.resolve({ ok: true }); };
    let threw = null;
    try { await sendProtoCommand(type, { x: 1 }, { _sendCommandAsyncForTest: fakeSendCommandAsync }); }
    catch (e) { threw = e; }
    if (!threw || !/not in allowlist/.test(threw.message)) throw new Error(`type='${type}' 应该被拒(原型链继承属性不是自有属性), 实际 ${threw && threw.message}`);
    if (called) throw new Error(`type='${type}' 时假 sendCommandAsync 竟然被调用了(原型链洞未堵住)`);
  }
});

await t('⑥b(账本1444卫生项) payload 是数组时被拒', async () => {
  let threw = null;
  try { await sendProtoCommand('get_address_utxos', ['not', 'an', 'object']); } catch (e) { threw = e; }
  if (!threw || !/must not be an array/.test(threw.message)) throw new Error(`应该 throw 数组拒绝错误, 实际 ${threw && threw.message}`);
});

// ══ 批9 9-0(J2 2026-09-19, 设计 v0.3.1 §12.11⑨⑩)——白名单新增一条 read: get_past_median_time(R2) ══════════════
// 以下四条是【新增用例】, 既有用例①–⑥b 一条未改(用例③④是 9-2a 出口分闸的红旗锚点, 见设计 §3.8)。
const relayLib = (f) => import(new URL(`../../../kasia-relay/src/lib/${f}`, import.meta.url).href);
const { COMMAND_TYPES, COMMAND_PAYLOAD_SCHEMA, COMMAND_FIELD_TYPES, isValidCommandType } = await relayLib('commands.mjs');
const { READONLY_ALLOWLIST } = await relayLib('authorize.mjs');
const RELAY_SRC = fs.readFileSync(new URL('../../../kasia-relay/src/relay.mjs', import.meta.url), 'utf8');
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// 6f6f9901(9-0 基线)时的白名单原样——差分基准, 不可变
const BASELINE_ALLOWLIST = Object.freeze({ covenant_broadcast: 'write', get_address_utxos: 'read', get_mempool_entry: 'read', check_utxo_landed: 'read' });

await t('批9-0-a PROTO_COMMAND_ALLOWLIST 对基线表做差分: 恰多一项, 且该项是 get_past_median_time:read; 原有四项的读写标记一字未变; 表仍是冻结的', () => {
  const now = Object.entries(PROTO_COMMAND_ALLOWLIST);
  const added = now.filter(([k]) => !has(BASELINE_ALLOWLIST, k));
  if (added.length !== 1 || added[0][0] !== 'get_past_median_time' || added[0][1] !== 'read') throw new Error(`期望恰多 [get_past_median_time, read], 实际多了 ${JSON.stringify(added)}`);
  for (const [k, mode] of Object.entries(BASELINE_ALLOWLIST)) if (PROTO_COMMAND_ALLOWLIST[k] !== mode) throw new Error(`基线项 ${k} 的标记变了: ${mode} → ${PROTO_COMMAND_ALLOWLIST[k]}`);
  if (now.length !== Object.keys(BASELINE_ALLOWLIST).length + 1) throw new Error(`条数不对: ${now.length}`);
  if (!Object.isFrozen(PROTO_COMMAND_ALLOWLIST)) throw new Error('白名单必须是 Object.freeze 的');
});

// 登记面枚举: 一个 proto 允许命令要在 relay 侧齐全登记, 否则 arm 后被静默拒/被 validator 拒。read 命令共 6 处:
//   ① console 允许表(本表)  ② commands.mjs COMMAND_TYPES  ③ COMMAND_PAYLOAD_SCHEMA  ④ COMMAND_FIELD_TYPES
//   ⑤ authorize.mjs READONLY_ALLOWLIST  ⑥ relay.mjs 的 `case '<type>':` handler
const registrationGaps = (type, mode, { table = PROTO_COMMAND_ALLOWLIST } = {}) => {
  const gaps = [];
  if (!has(table, type)) gaps.push('①console允许表');
  if (!isValidCommandType(type)) gaps.push('②COMMAND_TYPES');
  if (!has(COMMAND_PAYLOAD_SCHEMA, type)) gaps.push('③COMMAND_PAYLOAD_SCHEMA');
  if (!has(COMMAND_FIELD_TYPES, type)) gaps.push('④COMMAND_FIELD_TYPES');
  if (mode === 'read' && !READONLY_ALLOWLIST.has(type)) gaps.push('⑤READONLY_ALLOWLIST');
  if (mode === 'write' && READONLY_ALLOWLIST.has(type)) gaps.push('⑤write命令不得进READONLY_ALLOWLIST(会豁免信封)');
  if (!RELAY_SRC.includes(`case '${type}':`)) gaps.push('⑥relay.mjs handler');
  return gaps;
};
await t('批9-0-b 登记面枚举: 白名单里每一条命令在 relay 侧齐全登记(read 命令六处齐全, write 命令不得进 READONLY_ALLOWLIST); 新命令 get_past_median_time 六处齐全', () => {
  const bad = [];
  for (const [type, mode] of Object.entries(PROTO_COMMAND_ALLOWLIST)) { const g = registrationGaps(type, mode); if (g.length) bad.push(`${type}: ${g.join(', ')}`); }
  if (bad.length) throw new Error(`登记缺口: ${bad.join(' | ')}`);
  if (COMMAND_TYPES.GET_PAST_MEDIAN_TIME !== 'get_past_median_time') throw new Error('COMMAND_TYPES.GET_PAST_MEDIAN_TIME 不对');
});
await t('批9-0-b2【枚举器自证】枚举器不是空判据: 一个只登记了一半的假命令必被逐处指出缺口(去掉 ⑤ 就会漏报 arm 后被静默拒的那一类)', () => {
  const g = registrationGaps('not_a_registered_cmd', 'read', { table: { not_a_registered_cmd: 'read' } });
  const want = ['②COMMAND_TYPES', '③COMMAND_PAYLOAD_SCHEMA', '④COMMAND_FIELD_TYPES', '⑤READONLY_ALLOWLIST', '⑥relay.mjs handler'];
  if (JSON.stringify(g) !== JSON.stringify(want)) throw new Error(`期望 ${JSON.stringify(want)}, 实际 ${JSON.stringify(g)}`);
  const g2 = registrationGaps('get_past_median_time', 'read', { table: {} });   // 换一张缺它的表 ⇒ ① 缺
  if (JSON.stringify(g2) !== JSON.stringify(['①console允许表'])) throw new Error(`期望只缺①, 实际 ${JSON.stringify(g2)}`);
});
await t('批9-0-c get_past_median_time 是 read: PROTO_DRIVER_ENABLED 未设时不被驱动闸挡(越过闸卡在"没有真 relay"这个无关下游), 与另外三条 read 同待遇', async () => {
  delete process.env.PROTO_DRIVER_ENABLED;
  let threw = null;
  try { await sendProtoCommand('get_past_median_time', {}); } catch (e) { threw = e; }
  if (!threw || /proto_driver_disabled/.test(threw.message)) throw new Error(`不该被 proto_driver_disabled 挡住(实际: ${threw ? threw.message : '未抛错'})`);
  if (!/Relay not running/.test(threw.message)) throw new Error(`应卡在真实 sendCommandAsync 的 Relay not running, 实际 ${threw.message}`);
});
await t('批9-0-d facts 形态的 get_address_utxos 走同一个出口: payload(facts/outpoints/minAmount/maxAmount)原样透传、type 恒为显式参数、origin 恒 internal(出口不改写, 也不因这几个新字段放宽任何检查)', async () => {
  const seen = [];
  const fake = (relayId, cmd, timeoutMs, origin) => { seen.push({ relayId, cmd, origin }); return Promise.resolve({ ok: true }); };
  const payload = { address: 'kaspa:x', facts: true, outpoints: [{ transactionId: 'a'.repeat(64), index: 3 }] };
  await sendProtoCommand('get_address_utxos', payload, { _sendCommandAsyncForTest: fake });
  await sendProtoCommand('get_address_utxos', { address: 'kaspa:x', facts: true, minAmount: '1', maxAmount: '2' }, { _sendCommandAsyncForTest: fake });
  if (seen.length !== 2) throw new Error(`应发出 2 次, 实际 ${seen.length}`);
  if (JSON.stringify(seen[0].cmd) !== JSON.stringify({ ...payload, type: 'get_address_utxos' })) throw new Error(`payload 被改写: ${JSON.stringify(seen[0].cmd)}`);
  if (seen[1].cmd.minAmount !== '1' || seen[1].cmd.maxAmount !== '2' || seen[1].cmd.facts !== true) throw new Error('list 形态字段丢失');
  if (seen.some((s) => s.origin !== 'internal' || s.relayId !== 'ipc-test-relay')) throw new Error(`origin/relayId 被改: ${JSON.stringify(seen.map((s) => [s.relayId, s.origin]))}`);
  // 出口对 payload 里夹带 type 的既有保护对这些新字段同样有效
  let threw = null;
  try { await sendProtoCommand('get_address_utxos', { address: 'x', facts: true, type: 'covenant_broadcast' }, { _sendCommandAsyncForTest: fake }); } catch (e) { threw = e; }
  if (!threw || !/must not carry 'type'/.test(threw.message)) throw new Error(`payload 夹带 type 应被拒, 实际 ${threw && threw.message}`);
});

// ══ 批9 9-2a(J2 2026-09-20, 设计 §3.8 / §19.1)——出口按 intent_key 前缀分闸 ═════════════════════════════════════════════
// 以下全是【新增用例】; 既有用例①–⑥b 与 9-0 五项一字未改, 其中③④仍是红旗锚点(旧开关行为不变)。
const { isValidSettlementIntentKey, PROTO_SETTLEMENT_EXIT_STEP_SUBJECT } = await import('./proto-relay-ipc.mjs');
const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const PAIRS = [['seal', 'market'], ['resolve', 'market'], ['convert_to_claim', 'claim'], ['claim_draw', 'claim']];
const K = (subject, step, suffix = '') => 'settle:' + subject + ':' + UUID + ':' + step + suffix;
const A_KEYS = PAIRS.flatMap(([step, subject]) => ['', '#2', '#10', '#99'].map((sfx) => K(subject, step, sfx)));
const B_KEYS = [
  K('claim', 'withdraw'), K('ticket', 'reclaim'), K('market', 'reclaim'), K('claim', 'reclaim'), K('ticket', 'seal'),     // 批9 排除的步骤 / 主体
  K('market', 'convert_to_claim'), K('claim', 'seal'), K('market', 'claim_draw'), K('claim', 'resolve'),                 // 配对错
  K('market', 'seal').replace(UUID, UUID.toUpperCase()), K('market', 'seal').replace(UUID, 'not-a-uuid'), K('market', 'seal').replace(UUID, ''),
  K('market', 'seal').replace(UUID, '{' + UUID + '}'), K('market', 'seal').replace(UUID, UUID.replace(/-/g, '')),
  K('market', 'seal', '#1'), K('market', 'seal', '#0'), K('market', 'seal', '#01'), K('market', 'seal', '#a'), K('market', 'seal', '#٢'), K('market', 'seal', '#2 '), K('market', 'seal', '#'), K('market', 'seal', '#2#3'), K('market', 'seal', '#-2'),
  K('market', 'seal') + '\n', K('market', 'seal') + ' ', K('market', 'seal') + ':extra', K('market', 'seal') + '\u0000',
  K('market', 'SEAL'), K('MARKET', 'seal'), 'settle:', 'settle:market', 'settle:market:' + UUID,
];
const C_KEYS = [undefined, 'genesis:' + UUID, 'genesis:' + UUID + '#2', 'proto-bet:' + UUID + ':append', 'xsettle:market:' + UUID + ':seal', 'Settle:market:' + UUID + ':seal', 'SETTLE:market:' + UUID + ':seal', 'settle', ' ' + K('market', 'seal'), '', 'x'];
const S9B_KEYS = [() => new String(K('market', 'seal')), () => [K('market', 'seal')], () => 123, () => ({}), () => null, () => true, () => new String('genesis:' + UUID)];

const setEnv = (pde, psde) => {
  if (pde === undefined) delete process.env.PROTO_DRIVER_ENABLED; else process.env.PROTO_DRIVER_ENABLED = pde;
  if (psde === undefined) delete process.env.PROTO_SETTLEMENT_DRIVER_ENABLED; else process.env.PROTO_SETTLEMENT_DRIVER_ENABLED = psde;
};
const CELLS = [['0', '0'], ['1', '0'], ['0', '1'], ['1', '1']];
const attempt = async (type, payload) => {
  const seen = [];
  const fake = (relayId, cmd, timeoutMs, origin) => { seen.push(cmd); return Promise.resolve({ ok: true }); };
  try { await sendProtoCommand(type, payload, { _sendCommandAsyncForTest: fake }); return { sent: seen[0] || null, err: null }; }
  catch (e) { return { sent: null, err: e.message }; }
};
const bcast = (key) => (key === undefined ? { tx_json: '{}', sign_input_indices: [0], expected_txid: 'a'.repeat(64) } : { tx_json: '{}', sign_input_indices: [0], expected_txid: 'a'.repeat(64), intent_key: key });
const ERR = { A: /proto_settlement_driver_disabled/, B: /proto_settlement_intent_key_invalid/, C: /proto_driver_disabled/, S: /proto_intent_key_not_string/ };
const label = (k) => (typeof k === 'string' ? JSON.stringify(k).slice(0, 70) : String(k));
const savedEnv = { pde: process.env.PROTO_DRIVER_ENABLED, psde: process.env.PROTO_SETTLEMENT_DRIVER_ENABLED };

await t('9-2a 三个拒绝串两两互不为子串(否则"两闸互换"的变异看不出); 也不含对方的名字', () => {
  const names = ['proto_driver_disabled', 'proto_settlement_driver_disabled', 'proto_settlement_intent_key_invalid', 'proto_intent_key_not_string'];
  for (const a of names) for (const b of names) if (a !== b && a.includes(b)) throw new Error(a + ' 含 ' + b);
});
await t('9-2a A 类(合法 settle: 键, ' + A_KEYS.length + ' 条) × 4 格: 仅 PSDE=1 放行(与 PDE 无关); 其余拒 proto_settlement_driver_disabled', async () => {
  for (const key of A_KEYS) for (const [pde, psde] of CELLS) {
    setEnv(pde, psde);
    const r = await attempt('covenant_broadcast', bcast(key));
    if (psde === '1') { if (r.err || !r.sent || r.sent.intent_key !== key) throw new Error('应放行且原样透传 ' + label(key) + ' cell=' + pde + psde + ' :: ' + r.err); }
    else if (!r.err || !ERR.A.test(r.err) || ERR.C.test(r.err)) throw new Error('应拒 proto_settlement_driver_disabled ' + label(key) + ' cell=' + pde + psde + ' :: ' + r.err);
  }
});
await t('9-2a B 类(settle: 开头但格式不合法, ' + B_KEYS.length + ' 条; 含批9排除的 withdraw/reclaim/ticket) × 4 格: 一律拒 proto_settlement_intent_key_invalid(不回落旧开关, 即使两开关全开)', async () => {
  for (const key of B_KEYS) for (const [pde, psde] of CELLS) {
    setEnv(pde, psde);
    const r = await attempt('covenant_broadcast', bcast(key));
    if (!r.err || !ERR.B.test(r.err) || r.sent) throw new Error('应拒 proto_settlement_intent_key_invalid ' + label(key) + ' cell=' + pde + psde + ' :: ' + (r.err || '放行了'));
  }
});
await t('9-2a C 类(其它: 缺失 / genesis: / proto-bet: / xsettle: / Settle: / settle 无冒号 / 首部空白 …, ' + C_KEYS.length + ' 条) × 4 格: 仅 PDE=1 放行(与 PSDE 无关: PSDE=1 而 PDE=0 仍拒); 其余拒 proto_driver_disabled', async () => {
  for (const key of C_KEYS) for (const [pde, psde] of CELLS) {
    setEnv(pde, psde);
    const r = await attempt('covenant_broadcast', bcast(key));
    if (pde === '1') { if (r.err || !r.sent || r.sent.intent_key !== key) throw new Error('应放行 ' + label(key) + ' cell=' + pde + psde + ' :: ' + r.err); }
    else if (!r.err || !ERR.C.test(r.err) || ERR.A.test(r.err)) throw new Error('应拒 proto_driver_disabled ' + label(key) + ' cell=' + pde + psde + ' :: ' + r.err);
  }
});
await t('9-2a S9-b: 自有 intent_key 存在且不是原始 string(String 对象 / 数组 / 数字 / 对象 / null / true) ⇒ 4 格一律拒 proto_intent_key_not_string(不走旧开关)', async () => {
  for (const mk of S9B_KEYS) for (const [pde, psde] of CELLS) {
    setEnv(pde, psde);
    const r = await attempt('covenant_broadcast', bcast(mk()));
    if (!r.err || !ERR.S.test(r.err) || r.sent) throw new Error('应拒 proto_intent_key_not_string cell=' + pde + psde + ' :: ' + (r.err || '放行了'));
  }
});
await t('9-2a read 命令 × 4 格: 全放行, 不受任何一把 write 闸约束(即使带一个非法 settle: 键)', async () => {
  for (const [pde, psde] of CELLS) {
    setEnv(pde, psde);
    for (const type of ['get_address_utxos', 'get_mempool_entry', 'check_utxo_landed', 'get_past_median_time']) {
      const r = await attempt(type, { address: 'kaspa:x', intent_key: K('claim', 'withdraw') });
      if (r.err || !r.sent) throw new Error(type + ' 应放行 cell=' + pde + psde + ' :: ' + r.err);
    }
  }
});
await t('9-2a 开关只认字面 \'1\': PSDE / PDE 取 \'on\' \'true\' \'0\' \' 1\' \'\' 都等于关', async () => {
  for (const v of ['on', 'true', '0', ' 1', '', '01']) {
    setEnv('1', v); let r = await attempt('covenant_broadcast', bcast(K('market', 'seal')));
    if (!r.err || !ERR.A.test(r.err)) throw new Error('PSDE=' + JSON.stringify(v) + ' 应等于关 :: ' + r.err);
    setEnv(v, '1'); r = await attempt('covenant_broadcast', bcast('genesis:' + UUID));
    if (!r.err || !ERR.C.test(r.err)) throw new Error('PDE=' + JSON.stringify(v) + ' 应等于关 :: ' + r.err);
  }
});
await t('9-2a 每次调用读 env: 同一进程内 PSDE 0→1→0 立即生效', async () => {
  setEnv('0', '0'); if (!(await attempt('covenant_broadcast', bcast(K('market', 'seal')))).err) throw new Error('0 应拒');
  setEnv('0', '1'); if ((await attempt('covenant_broadcast', bcast(K('market', 'seal')))).err) throw new Error('1 应放行');
  setEnv('0', '0'); if (!(await attempt('covenant_broadcast', bcast(K('market', 'seal')))).err) throw new Error('再 0 应拒');
});
await t('9-2a 快照(闸与发送同一份): 访问器 intent_key 每读换值 ⇒ 只被读 1 次, 闸判定的值 == 发出去的值(两个方向)', async () => {
  const VA = K('market', 'seal');
  // 方向 1: 第一次读是合法 settle:, 之后是 genesis: —— 闸按 A 类判(PSDE=1 PDE=0 放行), 发出去的必须也是 VA
  setEnv('0', '1'); let n = 0;
  let r = await attempt('covenant_broadcast', { tx_json: '{}', get intent_key() { return n++ === 0 ? VA : 'genesis:' + UUID; } });
  if (r.err || r.sent.intent_key !== VA || n !== 1) throw new Error('方向1: sent=' + (r.sent && r.sent.intent_key) + ' reads=' + n + ' err=' + r.err);
  // 方向 2: 第一次读是 genesis:, 之后是合法 settle: —— 闸按 C 类判(PDE=1 PSDE=0 放行), 发出去的必须也是 genesis:
  setEnv('1', '0'); n = 0;
  r = await attempt('covenant_broadcast', { tx_json: '{}', get intent_key() { return n++ === 0 ? 'genesis:' + UUID : VA; } });
  if (r.err || r.sent.intent_key !== 'genesis:' + UUID || n !== 1) throw new Error('方向2: sent=' + (r.sent && r.sent.intent_key) + ' reads=' + n + ' err=' + r.err);
  // 方向 3: 第一次读是合法 settle:、PSDE=0 ⇒ 必须拒(不能因第二次读到别的值而放行)
  setEnv('1', '0'); n = 0;
  r = await attempt('covenant_broadcast', { tx_json: '{}', get intent_key() { return n++ === 0 ? VA : 'genesis:' + UUID; } });
  if (!r.err || !ERR.A.test(r.err)) throw new Error('方向3 应拒 A: ' + r.err);
});
await t('9-2a 快照: Proxy payload(get 陷阱每读换值)同样只读 1 次、判定值 == 发送值', async () => {
  const VA = K('claim', 'claim_draw'); let reads = 0;
  const p = new Proxy({}, {
    ownKeys: () => ['tx_json', 'intent_key'],
    getOwnPropertyDescriptor: (tg, k) => (k === 'tx_json' || k === 'intent_key' ? { enumerable: true, configurable: true, writable: true, value: undefined } : undefined),
    get: (tg, k) => (k === 'intent_key' ? (reads++ === 0 ? VA : 'genesis:' + UUID) : k === 'tx_json' ? '{}' : undefined),
  });
  setEnv('0', '1');
  const r = await attempt('covenant_broadcast', p);
  if (r.err || r.sent.intent_key !== VA || reads !== 1) throw new Error('sent=' + (r.sent && r.sent.intent_key) + ' reads=' + reads + ' err=' + r.err);
});
await t('9-2a 快照: 原型链上继承的 intent_key 不会被复制进快照 ⇒ 按"缺失"(C 类)判, 且发送里也没有它', async () => {
  const proto = { intent_key: K('market', 'seal') };
  const payload = Object.assign(Object.create(proto), { tx_json: '{}' });
  setEnv('0', '1'); let r = await attempt('covenant_broadcast', payload);
  if (!r.err || !ERR.C.test(r.err)) throw new Error('PDE=0 PSDE=1 应按 C 类拒: ' + r.err);
  setEnv('1', '0'); r = await attempt('covenant_broadcast', payload);
  if (r.err || 'intent_key' in r.sent) throw new Error('应放行且不带 intent_key: ' + r.err + ' ' + JSON.stringify(r.sent));
});
await t('9-2a 源码结构: 快照恰一处 { ...payload, type }, 两处发送都用 out; 出口 import 仍只有 proto-relay-guard(零新 import)', () => {
  const src = fs.readFileSync(new URL('./proto-relay-ipc.mjs', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if ((src.match(/\{\s*\.\.\.payload,\s*type\s*\}/g) || []).length !== 1) throw new Error('快照应恰一处');
  if ((src.match(/PROTO_RELAY_ID,\s*out,\s*timeoutMs,\s*'internal'/g) || []).length !== 2) throw new Error('两处发送都应用 out');
  const imports = src.match(/^\s*import\s.*$/gm) || [];
  if (imports.length !== 1 || !/proto-relay-guard\.mjs/.test(imports[0]) || /await import\(/.test(src.replace("await import('../services/relay-manager.js')", ''))) throw new Error('import 变了: ' + JSON.stringify(imports));
});
await t('9-2a 漂移测试: 出口的 S9 与 proto-settlement-intent 的键生成器一致——批9 四个配对产出的键(含 #2 / #10)全部通过; withdraw / reclaim / ticket 产出的键被拒; 出口配对表恰是批9 四步', async () => {
  const SI = await import('./proto-settlement-intent.mjs');
  const { randomUUID } = await import('node:crypto');
  const ok = [], bad = [];
  for (const subject of SI.SETTLEMENT_SUBJECT_TYPES) for (const step of SI.SETTLEMENT_STEPS) {
    for (const attempt of [1, 2, 10]) {
      let key; try { key = SI.settlementIntentKeyFor(subject, randomUUID(), step, attempt); } catch { continue; }   // 非法配对生成器自己就拒
      (PROTO_SETTLEMENT_EXIT_STEP_SUBJECT[step] === subject ? ok : bad).push([key, subject, step]);
    }
  }
  if (ok.length !== 12) throw new Error('批9 配对产出应 12 条(4 步 × 3 attempt), 实得 ' + ok.length);
  for (const [key, subject, step] of ok) if (!isValidSettlementIntentKey(key)) throw new Error('批9 键应通过: ' + key);
  const badSteps = new Set(bad.map(([, , step]) => step));
  if (JSON.stringify([...badSteps].sort()) !== JSON.stringify(['reclaim', 'withdraw'])) throw new Error('被排除的步骤应恰为 withdraw / reclaim, 实得 ' + JSON.stringify([...badSteps]));
  for (const [key] of bad) if (isValidSettlementIntentKey(key)) throw new Error('排除步骤的键不该通过: ' + key);
  if (JSON.stringify(Object.keys(PROTO_SETTLEMENT_EXIT_STEP_SUBJECT).sort()) !== JSON.stringify(['claim_draw', 'convert_to_claim', 'resolve', 'seal'])) throw new Error('出口配对表应恰是批9 四步');
  if (!Object.isFrozen(PROTO_SETTLEMENT_EXIT_STEP_SUBJECT)) throw new Error('配对表应冻结');
});
await t('9-2a 校验函数纯度: 非字符串输入 ⇒ false 不抛; 正则无状态(连续调用结果稳定)', () => {
  for (const v of [undefined, null, 1, {}, [], new String(K('market', 'seal'))]) if (isValidSettlementIntentKey(v) !== false) throw new Error('非字符串应 false');
  for (let i = 0; i < 5; i++) if (!isValidSettlementIntentKey(K('market', 'seal'))) throw new Error('第 ' + i + ' 次应稳定为 true');
});
setEnv(savedEnv.pde, savedEnv.psde);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail === 0) {
  console.log('\n[test] ⑦(独立子进程) PROTO_RELAY_ID 未配置 ⇒ sendProtoCommand 一律 throw(fail-closed):');
  const tmpDb2 = `${process.env.TEMP || '/tmp'}/_j2_proto_relay_ipc_unconfigured_${process.pid}.db`;
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb2 }, stdio: 'pipe' });
  const r2 = spawnSync(process.execPath, ['--input-type=module', '-e', `
    delete process.env.PROTO_RELAY_ID;
    const { sendProtoCommand } = await import('./src/lib/proto-relay-ipc.mjs');
    try {
      await sendProtoCommand('get_address_utxos', { address: 'kaspa:x' });
      console.log('FAIL: did not throw');
      process.exitCode = 1;
    } catch (e) {
      if (/PROTO_RELAY_ID not configured/.test(e.message)) { console.log('PASS'); process.exitCode = 0; }
      else { console.log('FAIL: wrong error: ' + e.message); process.exitCode = 1; }
    }
  `], { cwd: process.cwd(), env: { ...process.env, PROTO_RELAY_ID: '', DB_PATH: tmpDb2 }, encoding: 'utf8' });
  try { fs.unlinkSync(tmpDb2); } catch {}
  console.log(r2.stdout?.trim() || r2.stderr);
  process.exitCode = r2.status === 0 ? 0 : 1;
} else {
  process.exitCode = 1;
}
