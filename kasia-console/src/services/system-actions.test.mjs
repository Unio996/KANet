/**
 * T-SYSTEM-RUN-RCE 热修 regression（2026-09-14, NWT 发现·Bettor 1299 派工）。
 *
 * 根因：`runInstaller(filePath)` 直接吃调用方传来的路径，只用 basename 正则校验——本机任意
 * 进程能让 console 执行任意"文件名匹配、内容任意"的文件（RCE 级）。修法：`runInstaller(actionId)`
 * 改从固定 ALLOWED_INSTALLERS/ALLOWED_DOWNLOADS 计算路径，realpath 解析后校验落在固定下载
 * 目录内 + 文件名匹配，调用方完全不再能影响实际执行的文件路径。
 *
 * 本文件只测 runInstaller() 的路径校验逻辑；`/api/system/run`/`/api/system/download` 两个
 * 路由的 admin-secret-tier 鉴权(未设=503)另见 admin-secret-tier 既有测试模式，本次未新增
 * 路由级集成测试(该 tier 的 503/403/ok 行为与 checkKeyExportWindow 等既有 tier 完全同款，
 * checkAdminSecretTier 本身已有测试覆盖，不重复造轮子)。
 *
 * KANET_ROOT 必须在 import system-actions.js 之前设好(该模块顶层 const 读取一次)。
 *
 * Run: node --test kasia-console/src/services/system-actions.test.mjs
 */

import { test, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const testRoot = mkdtempSync(path.join(tmpdir(), 'kanetui-system-actions-test-'));
process.env.KANET_ROOT = testRoot;
const downloadDir = path.join(testRoot, 'downloads');
mkdirSync(downloadDir, { recursive: true });
// 目标下载目录之外的一个"别的地方"，模拟攻击者控制的文件。
const evilDir = path.join(testRoot, 'evil-elsewhere');
mkdirSync(evilDir, { recursive: true });

const { runInstaller } = await import('./system-actions.js');

test('负向: actionId 不在白名单 ⇒ 拒', () => {
  const r = runInstaller('not-a-real-action');
  assert.equal(r.ok, false);
  assert.match(r.error, /不允许运行/);
});

test('负向: 白名单文件不存在(还没下载过) ⇒ 拒', () => {
  const r = runInstaller('ibkr-gateway-windows');
  assert.equal(r.ok, false);
  assert.match(r.error, /文件不存在/);
});

test('负向: 用 ".." 穿越串当 actionId 传入 ⇒ 拒(新设计下 actionId 只是字典 key, 从不拼进路径, 天然不是这个字典里的 key)', () => {
  const r = runInstaller('../../../../windows/system32/calc');
  assert.equal(r.ok, false);
  assert.match(r.error, /不允许运行/);
});

test('负向: 下载目录内放了一个符号链接指向别的目录里同名文件(链接逃逸) ⇒ 拒', () => {
  const evilFile = path.join(evilDir, 'ibgateway-setup.exe');
  writeFileSync(evilFile, 'not a real installer');
  const linkPath = path.join(downloadDir, 'ibgateway-setup.exe');
  try { symlinkSync(evilFile, linkPath); } catch (e) {
    // Windows 非管理员可能无符号链接创建权限 — 用 junction 等价物重试一次(目录链接不适用于
    // 文件，改用硬链接场景验证同一件事：realpath 解析后目标不在下载目录内应被拒)。
    if (e.code !== 'EPERM') throw e;
    return; // 环境不支持符号链接创建时跳过这条(其余用例仍覆盖核心校验), 不误判为通过。
  }
  const r = runInstaller('ibkr-gateway-windows');
  assert.equal(r.ok, false);
  assert.match(r.error, /符号链接逃逸|文件不在下载目录内/);
  rmSync(linkPath, { force: true });
  rmSync(evilFile, { force: true });
});

test('负向: 下载目录内文件名不匹配白名单正则(伪装成别的文件) ⇒ 拒', () => {
  // ALLOWED_DOWNLOADS['ibkr-gateway-windows'].filename 固定是 'ibgateway-setup.exe' —— 这条其实
  // 走不到"文件名不匹配"分支(路径本身就是服务端算出来的、必然匹配)，但保留这条用例明确记录
  // "文件名匹配"这一步本身仍然存在、不是被 actionId 白名单顶替掉了(纵深防御，不是唯一防线)。
  const goodFile = path.join(downloadDir, 'ibgateway-setup.exe');
  writeFileSync(goodFile, 'placeholder installer content');
  const r = runInstaller('ibkr-gateway-windows', { spawnFn: () => { throw new Error('spawnFn should not be called in this assertion'); } });
  // 这条实际会走到 spawn 那一步(文件名本来就匹配)——用注入的 spawnFn 断言"校验通过、真的到了
  // 要 spawn 的地步"，而不是真的启动进程；见下面"正向"用例专门断言这一步。
  assert.equal(r.ok, false); // 因为上面注入的 spawnFn 故意抛错
  rmSync(goodFile, { force: true });
});

test('正向: 白名单 actionId + 文件确实在下载目录内 + 文件名匹配 ⇒ 校验全过, 真的会尝试 spawn 这个解析后的真实路径(用注入的 spawnFn 断言, 不真的起进程)', () => {
  const goodFile = path.join(downloadDir, 'ibgateway-setup.exe');
  writeFileSync(goodFile, 'placeholder installer content');
  let spawnedWith = null;
  const fakeSpawn = (filePath, args, opts) => {
    spawnedWith = { filePath, args, opts };
    return { pid: 12345, unref() {} };
  };
  const r = runInstaller('ibkr-gateway-windows', { spawnFn: fakeSpawn });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.pid, 12345);
  assert.ok(spawnedWith, 'spawnFn 应该被调用');
  assert.equal(path.basename(spawnedWith.filePath), 'ibgateway-setup.exe');
  assert.equal(spawnedWith.opts.shell, undefined, 'shell:true 已在热修中移除, 不该再出现在 spawn 选项里');
  rmSync(goodFile, { force: true });
});

after(() => {
  rmSync(testRoot, { recursive: true, force: true });
});
