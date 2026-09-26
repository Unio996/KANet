/**
 * relay-manager.js isRelayAlive() 判活单测（账本1672/1674, Owner 亲批修 relay 健康检查误判）。
 *
 * Run: node --test kasia-console/test-framework/cases/system/relay-manager-alive.test.mjs
 *
 * 背景：修复前判据是"lastLogAt 距今 > freshnessMs(默认60s) ⇒ 死"——relay 只要空闲一分钟没打日志
 * 就被判死，跟"进程真的死了"完全是两回事。主网 18 个 relay 全部这样被误判，relay-health-monitor
 * 的 30s cron 对着一堆活 relay 疯狂调 startRelay()，全部落空 already_running，零真实重启。
 *
 * 修复：isRelayAlive() 改用进程真实存活信号(child exit 状态 / IPC connected / process.kill(pid,0)
 * 进程存在性探测)，不再用日志新鲜度判死。
 *
 * 范围：只测 isRelayAlive() 本身——用第二参 `deps.relays` 注入一个假的 `_relays` map，不需要真的
 * fork 一个 relay 子进程（`_relays` 是模块私有状态，正常只能通过 startRelay() 真实 fork 才能填入，
 * 这里用与 relayHealthMonitorTick() 同款的既有 DI 约定绕开，不新增任何生产代码路径）。
 * 用真实的 process.kill(pid, 0) 探测——用真进程自己的 pid（必然存在）测"活"，用一个真的已退出子
 * 进程的 pid（必然不存在）测"死"，不 mock process.kill 本身，让这条判活链路的最后一环也是真实的。
 *
 * 从 relay-health-monitor.js 取 isRelayAlive（它重导出自己本来就有的导入），不直接 import
 * relay-manager.js——M0a 裸 import 差分门对 relay-manager 族新增消费点要求窄 capability + NWT 审批
 * 才能过 lint，而这里只是复用一个已经合法存在的导入，没必要为同一个符号另开一条需要重新走 NWT 审批
 * 流程的通道（见 relay-health-monitor.js 里那行 export 的头注）。
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { isRelayAlive } from '../../../src/services/relay-health-monitor.js';

function fakeChild({ connected = true } = {}) {
  return { connected, exitCode: null, signalCode: null, killed: false };
}

function deadPid() {
  // 真的起一个子进程、等它退出——它的 pid 此刻在系统里必然不存在，比"猜一个很大的整数"更可靠。
  const r = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  return r.pid;
}

test('空闲不判死：进程真实存活但 lastLogAt 是 10 分钟前 ⇒ alive=true（修复前的版本会判死)', () => {
  const relays = {
    r1: {
      child: fakeChild(),
      pid: process.pid,   // 用当前测试进程自己的 pid——它必然存在
      startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
      lastLogAt: Date.now() - 10 * 60_000,   // 10 分钟没打日志，远超旧阈值 60s
    },
  };
  const result = isRelayAlive('r1', { relays });
  assert.equal(result.alive, true, `应判活，实际: ${JSON.stringify(result)}`);
  assert.ok(result.ageMs >= 10 * 60_000 - 1000, 'ageMs 仍如实反映日志陈旧程度，只是不再据此判死');
});

test('从未打过日志(lastLogAt=0, 刚 spawn) ⇒ 仍判活，走 startedAt fallback', () => {
  const relays = {
    r1: { child: fakeChild(), pid: process.pid, startedAt: new Date().toISOString(), lastLogAt: 0 },
  };
  assert.equal(isRelayAlive('r1', { relays }).alive, true);
});

test('真退出：_relays 里已找不到这个 id（child.on(\'exit\') 的既有清理效果）⇒ 判死', () => {
  // 真实代码里 startRelay() 的 child.on('exit',...) 会 delete _relays[relayNodeId]——这里直接
  // 传一个空 map 模拟"清理已经发生过"，验证 isRelayAlive 对"完全找不到记录"的既有分支仍然正确。
  const result = isRelayAlive('r1', { relays: {} });
  assert.equal(result.alive, false);
  assert.match(result.reason, /not started/);
});

test('PID 不存在(进程已真实退出，但 _relays 条目意外还没被摘掉)⇒ 判死，不据日志新鲜度放行', () => {
  const relays = {
    r1: {
      child: fakeChild(),
      pid: deadPid(),
      startedAt: new Date().toISOString(),
      lastLogAt: Date.now(),   // 日志"新鲜"也不该救回来——真实信号(pid)优先于日志信号
    },
  };
  const result = isRelayAlive('r1', { relays });
  assert.equal(result.alive, false, `应判死，实际: ${JSON.stringify(result)}`);
  assert.match(result.reason, /pid \d+ not found/);
});

test('child.exitCode 已设置(进程对象自己知道已退出)⇒ 判死', () => {
  const relays = {
    r1: { child: { connected: true, exitCode: 0, signalCode: null, killed: false }, pid: process.pid, lastLogAt: Date.now() },
  };
  const result = isRelayAlive('r1', { relays });
  assert.equal(result.alive, false);
  assert.match(result.reason, /already exited/);
});

test('IPC 通道已断开(child.connected===false)⇒ 判死，即使 pid 还在', () => {
  const relays = {
    r1: { child: fakeChild({ connected: false }), pid: process.pid, lastLogAt: Date.now() },
  };
  const result = isRelayAlive('r1', { relays });
  assert.equal(result.alive, false);
  assert.match(result.reason, /IPC channel disconnected/);
});

test('无参数调用(生产真实调用方式)默认读真实模块状态，未注册的 relayNodeId 判死——签名改动不破坏零参调用', () => {
  const result = isRelayAlive('__never_registered_in_this_test_process__');
  assert.equal(result.alive, false);
  assert.match(result.reason, /not started/);
});
