// proto-fee-profile-caps.test.mjs — NWT 合入审 S1(J2 2026-09-20): 钉 feeProfile 六个结算 builder 的 cap 字面值。
//
// cap 的唯一来源是 kasia-console/scripts/proto-v0-template-anchors.json 的 feeProfile[kind].cap(经 loadFeeProfileCap 读取)。
// 此前只有"人工核"守着这六个数(批 6–8 合入审时 NWT 逐值核过)——JSON 里任何一个被悄悄改动, 现有测试都不会红, 而 cap 是"形状受限的损失上界"
// (Codex 账本1526 ④: 布局 / 常量 / fee 规则 / 签名形状一变即失效), 改它必须是一个【有意的、连同本测试一起改的、可审的】动作。
//
// 期望值出处(账本): market_seal 52M(主线已有) / close_commit 30M 与 convert_to_claim 52M(账本1514, NWT 按 F3' 推导, Bettor 裁定) /
//   claim_draw 50M(账本1521, NWT 推数) / withdraw 55M(NWT 推数, 账本1522/1526 引用) /
//   ticket_reclaim 1.0 KAS(账本1524/1525: 暂借占位, 不接线, 等 T-FEE-PRICING; 将来换成精确值时必须连同本测试一起改)。
// 1.0 KAS(GLOBAL_ABS_FEE_CAP_SOMPI)是 kind 无关的全局硬顶, 六个 cap 都不得超过它。
//
// Run: cd kasia-console && node src/lib/proto-fee-profile-caps.test.mjs

if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);   // proto-covenant-builder 的 encrypt 依赖, 占位值非真密钥

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// proto-covenant-builder → db/client.js 按 M0a 规矩拒绝在没有 DB_PATH 时默认连活库(这个拒绝是对的)。本测试不查任何表, 只需要 import 能过:
// 先给一个临时 DB_PATH, 再【动态】import(静态 import 会被提升到这行之前), 结束时清理。
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanet-fee-caps-test-'));
process.env.DB_PATH = path.join(tmpDir, 'console.db');
const { loadFeeProfileCap } = await import('./proto-covenant-builder.mjs');
const { GLOBAL_ABS_FEE_CAP_SOMPI } = await import('./proto-tx-assembly.mjs');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message.split('\n')[0]); } };

// 字面值——这是本测试的【独立来源】(不是从 JSON 读来的)。改这里就是改 cap, 必须走审。
const PINNED = Object.freeze({
  market_seal: 52_000_000n,
  close_commit: 30_000_000n,
  convert_to_claim: 52_000_000n,
  claim_draw: 50_000_000n,
  withdraw: 55_000_000n,
  ticket_reclaim: 100_000_000n,
});
const ANCHORS = new URL('../../scripts/proto-v0-template-anchors.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const raw = JSON.parse(fs.readFileSync(ANCHORS, 'utf8'));

for (const [kind, want] of Object.entries(PINNED)) {
  t(`cap ${kind} == ${want} sompi(${Number(want) / 1e8} KAS)——经生产读取函数 loadFeeProfileCap`, () => {
    assert.strictEqual(loadFeeProfileCap(kind), want, `feeProfile.${kind}.cap 变了: 现 ${loadFeeProfileCap(kind)} != 钉死的 ${want}。改 cap 必须走审并连同本测试一起改`);
  });
}

t('六个 kind 在 anchors JSON 里都存在(缺键 fail-loud, 不是读出 undefined 再被当成 0)', () => {
  for (const kind of Object.keys(PINNED)) {
    assert.ok(raw?.feeProfile?.[kind], `anchors JSON 缺 feeProfile.${kind}`);
    assert.ok(/^[0-9]+$/.test(String(raw.feeProfile[kind].cap)), `feeProfile.${kind}.cap 不是十进制整数串: ${raw.feeProfile[kind].cap}`);
  }
});

t('每个 kind 都带非空 _source(cap 的来源/推导不能丢, 否则日后没人知道 52M 是怎么来的)', () => {
  for (const kind of Object.keys(PINNED)) {
    const s = raw.feeProfile[kind]._source;
    assert.ok(typeof s === 'string' && s.trim().length > 0, `feeProfile.${kind}._source 缺失或为空`);
  }
});

t('六个 cap 都不超过全局硬顶 GLOBAL_ABS_FEE_CAP_SOMPI(1.0 KAS)', () => {
  assert.strictEqual(GLOBAL_ABS_FEE_CAP_SOMPI, 100_000_000n);
  for (const [kind, want] of Object.entries(PINNED)) assert.ok(want <= GLOBAL_ABS_FEE_CAP_SOMPI, `${kind} 钉死值 ${want} 超过全局硬顶`);
});

t('未知 kind ⇒ loadFeeProfileCap 抛错(不返回 undefined/0)', () => {
  assert.throws(() => loadFeeProfileCap('no_such_builder_kind'), /missing feeProfile\.no_such_builder_kind\.cap/);
});

try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows 上 sqlite 句柄可能还开着; 临时目录残留无害 */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
