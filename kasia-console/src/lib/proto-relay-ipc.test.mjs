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
  if (!threw || !/relay_id\/relayId/.test(threw.message)) throw new Error(`应该 throw relay_id 覆盖错误, 实际 ${threw && threw.message}`);
});

await t('②b payload 携带 relayId(驼峰) 同样被拒', async () => {
  let threw = null;
  try { await sendProtoCommand('get_address_utxos', { address: 'kaspa:x', relayId: 'someone-elses-relay' }); } catch (e) { threw = e; }
  if (!threw || !/relay_id\/relayId/.test(threw.message)) throw new Error(`应该 throw relay_id 覆盖错误, 实际 ${threw && threw.message}`);
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail === 0) {
  console.log('\n[test] ⑥(独立子进程) PROTO_RELAY_ID 未配置 ⇒ sendProtoCommand 一律 throw(fail-closed):');
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
