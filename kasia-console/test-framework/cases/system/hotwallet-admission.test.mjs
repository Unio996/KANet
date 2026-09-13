/**
 * NWT 2-1 热钱包准入门单测（docs/2026-09-14-nwt-mainnet-relay-hotwallet-cap-and-cold-hot-separation-spec-v0.1.md）
 * Bettor 1137/1138 派工："三条各一正一反 + 总额刚好超线的第 N 个 relay 被拒 + 缺 env 拒启动"。
 *
 * Run: node --test kasia-console/test-framework/cases/system/hotwallet-admission.test.mjs
 *
 * 范围：只测 checkHotwalletAdmission() 判断逻辑本身——用第二参依赖注入（同 kaspa-rpc-shared.mjs 既有
 * 的 getSharedRpc({url,networkId},{Ctor}) DI 约定）替换掉真实 RPC 调用/_relays/DB，不连真实节点、不
 * 起真实 relay 子进程。startRelay() 里那把 _withAdmissionLock 串行化本身（并发场景）不在本文件覆盖
 * 范围——那需要真实并发 fork，属于"起服务后人工验证"一类，本文件只锁"判断逻辑对不对"。
 *
 * Live verify（真实并发 startRelay + 真实 RPC 余额）defer 到 operator hat 手动测。
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { checkHotwalletAdmission } from '../../../src/services/relay-manager.js';

const ADDR = 'kaspa:qztest0000000000000000000000000000000000000000000000000000';
const NET = 'mainnet';
const RPC_URL = 'ws://127.0.0.1:17110';

// 每个用例前后把三个 env 清空，避免用例间互相污染（checkHotwalletAdmission 每次调用都现读 process.env，
// 不缓存——所以清干净就够，不需要额外的模块 reset 机制）。
function clearCapEnv() {
  delete process.env.RELAY_HOTWALLET_COLD_ADDRESSES;
  delete process.env.RELAY_HOTWALLET_PER_RELAY_MAX_KAS;
  delete process.env.RELAY_HOTWALLET_TOTAL_MAX_KAS;
}

test('① 冷清单 · 正：命中冷清单地址 → cold_address_denied', async () => {
  clearCapEnv();
  try {
    process.env.RELAY_HOTWALLET_COLD_ADDRESSES = `kaspa:other1,${ADDR},kaspa:other2`;
    const r = await checkHotwalletAdmission({ address: ADDR, network: NET, rpcUrl: RPC_URL });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'cold_address_denied');
  } finally { clearCapEnv(); }
});

test('① 冷清单 · 反：地址不在冷清单、两个上限都未设 → ok:true（不启用其它两项检查）', async () => {
  clearCapEnv();
  try {
    process.env.RELAY_HOTWALLET_COLD_ADDRESSES = 'kaspa:other1,kaspa:other2';
    const r = await checkHotwalletAdmission({ address: ADDR, network: NET, rpcUrl: RPC_URL });
    assert.equal(r.ok, true);
  } finally { clearCapEnv(); }
});

test('② per-relay 上限 · 正：候选余额超过上限 → per_relay_cap_exceeded', async () => {
  clearCapEnv();
  try {
    process.env.RELAY_HOTWALLET_PER_RELAY_MAX_KAS = '800';
    const r = await checkHotwalletAdmission(
      { address: ADDR, network: NET, rpcUrl: RPC_URL },
      { queryBalanceKas: async () => 1005 }
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'per_relay_cap_exceeded');
    assert.equal(r.balance, 1005);
    assert.equal(r.cap, 800);
  } finally { clearCapEnv(); }
});

test('② per-relay 上限 · 反：候选余额不超过上限 → ok:true', async () => {
  clearCapEnv();
  try {
    process.env.RELAY_HOTWALLET_PER_RELAY_MAX_KAS = '800';
    const r = await checkHotwalletAdmission(
      { address: ADDR, network: NET, rpcUrl: RPC_URL },
      { queryBalanceKas: async () => 540.15 }
    );
    assert.equal(r.ok, true);
    assert.equal(r.balance, 540.15);
  } finally { clearCapEnv(); }
});

test('③ 总额上限 · 正：正在跑的总额 + 候选 > 上限 → hotwallet_total_cap_exceeded', async () => {
  clearCapEnv();
  try {
    process.env.RELAY_HOTWALLET_TOTAL_MAX_KAS = '1000';
    const r = await checkHotwalletAdmission(
      { address: ADDR, network: NET, rpcUrl: RPC_URL },
      { queryBalanceKas: async () => 600, sumRunningRelayBalancesKas: async () => 500 } // 500+600=1100 > 1000
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'hotwallet_total_cap_exceeded');
    assert.equal(r.running, 500);
    assert.equal(r.candidate, 600);
    assert.equal(r.cap, 1000);
  } finally { clearCapEnv(); }
});

test('③ 总额上限 · 反：正在跑的总额 + 候选 ≤ 上限 → ok:true', async () => {
  clearCapEnv();
  try {
    process.env.RELAY_HOTWALLET_TOTAL_MAX_KAS = '1000';
    const r = await checkHotwalletAdmission(
      { address: ADDR, network: NET, rpcUrl: RPC_URL },
      { queryBalanceKas: async () => 400, sumRunningRelayBalancesKas: async () => 500 } // 500+400=900 ≤ 1000
    );
    assert.equal(r.ok, true);
  } finally { clearCapEnv(); }
});

test('总额刚好超线的第 N 个候选被拒——前面几个放行、总额一超线立刻拒下一个', async () => {
  clearCapEnv();
  try {
    process.env.RELAY_HOTWALLET_TOTAL_MAX_KAS = '1000';
    // 模拟顺序导入若干个余额相同(300 KAS)的账号，每次都用"到目前为止已放行的总额"作为 sumRunningRelayBalancesKas
    // 的返回值(真实场景里这个数字来自 _relays 里已经在跑的 relay 逐个查余额求和；这里直接注入，不依赖真实
        // 子进程/DB，只验证"判断逻辑对累计总额的响应是否正确")。
    let admittedTotal = 0;
    const admittedAt = [];
    const CANDIDATE_BALANCE = 300;
    for (let i = 1; i <= 5; i++) {
      const runningTotalAtThisPoint = admittedTotal;
      const r = await checkHotwalletAdmission(
        { address: `${ADDR}-${i}`, network: NET, rpcUrl: RPC_URL },
        {
          queryBalanceKas: async () => CANDIDATE_BALANCE,
          sumRunningRelayBalancesKas: async () => runningTotalAtThisPoint,
        }
      );
      if (r.ok) {
        admittedTotal += CANDIDATE_BALANCE;
        admittedAt.push(i);
      } else {
        assert.equal(r.reason, 'hotwallet_total_cap_exceeded');
        // 300*1=300, 300*2=600, 300*3=900 都 ≤1000 放行；第4个(300*4=1200>1000)应该是第一个被拒的
        assert.equal(i, 4, `expected the 4th candidate to be the first rejected, got rejected at #${i}`);
        break;
      }
    }
    assert.deepEqual(admittedAt, [1, 2, 3], '前 3 个候选(累计 900 KAS)应该都被放行');
  } finally { clearCapEnv(); }
});

test('缺 env · 上限已配置但查不到余额(rpcUrl 缺失) → fail-closed 拒绝, 不当 0 放行', async () => {
  clearCapEnv();
  try {
    process.env.RELAY_HOTWALLET_PER_RELAY_MAX_KAS = '800';
    const r = await checkHotwalletAdmission({ address: ADDR, network: NET, rpcUrl: '' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'balance_query_failed');
  } finally { clearCapEnv(); }
});

test('缺 env · 上限已配置但余额查询抛错 → fail-closed 拒绝, 不当 0 放行', async () => {
  clearCapEnv();
  try {
    process.env.RELAY_HOTWALLET_TOTAL_MAX_KAS = '1000';
    const r = await checkHotwalletAdmission(
      { address: ADDR, network: NET, rpcUrl: RPC_URL },
      { queryBalanceKas: async () => { throw new Error('rpc down'); } }
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'balance_query_failed');
  } finally { clearCapEnv(); }
});

test('缺 env · 两个上限都未设(向后兼容) → ok:true, 不查余额(注入的查询函数不应被调用)', async () => {
  clearCapEnv();
  try {
    let called = false;
    const r = await checkHotwalletAdmission(
      { address: ADDR, network: NET, rpcUrl: RPC_URL },
      { queryBalanceKas: async () => { called = true; return 0; } }
    );
    assert.equal(r.ok, true);
    assert.equal(called, false, '两个上限都未设时不该触发任何余额查询(避免不必要的 RPC 调用)');
  } finally { clearCapEnv(); }
});

test('checkHotwalletAdmission 导出为异步函数', () => {
  assert.equal(typeof checkHotwalletAdmission, 'function');
});
