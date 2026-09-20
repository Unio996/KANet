// launcher-import-probe.mjs — 测试辅助(非生产代码; 仅被 *-bot-launcher.test.mjs 引用)。
// 目的: 钉住启动器里 FATAL 之后的 `process.exit(1)` 语义(S3 NWT 审出的缺口)——删掉它, 只靠"后面某处碰巧崩了"仍会 exit 1, 老测试仍绿, 但配置齐全的非主网环境下 bot 会继续起、把主网 ingest secret 发出去。
// 手法: 模块解析钩子(module.register) + 预载脚本(封死 fetch), 全部落在临时目录:
//   · 每当解析到 tg-bot/bot.mjs 或 tg-bot/owner-bot.mjs, 同步 appendFileSync 一行 "IMPORT <specifier>" 到 PROBE_FILE(同步写 ⇒ 进程随后立刻退出也不丢);
//   · PROBE_STUB=fail|ok 时把 tg-bot-launch-env.mjs 换成桩: fail ⇒ {ok:false, problems, consoleUrl, scrub:[]}(失败裁决但带齐"成功形"字段, 让"失败后继续往下走"不会被 r.scrub 缺失的 TypeError 碰巧截断);
//     ok ⇒ 成功裁决(正向对照臂: 证明探针与桩真在工作, 否则"没看到 IMPORT"是空话)。
// 全局 fetch 被封死; 桩只在子进程里生效, 不改任何生产文件。
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HOOKS = `
import { appendFileSync } from 'node:fs';
const STUB_FAIL = 'export function resolveBotLaunchEnv(){return {ok:false,problems:["STUB-FAIL"],consoleUrl:"http://127.0.0.1:1",scrub:[]};}';
const STUB_OK = 'export function resolveBotLaunchEnv(){return {ok:true,problems:[],consoleUrl:"http://127.0.0.1:1",scrub:[]};}';
export async function resolve(specifier, context, nextResolve) {
  const mode = process.env.PROBE_STUB;
  if (/tg-bot-launch-env\\.mjs$/.test(specifier) && (mode === 'fail' || mode === 'ok')) {
    return { url: 'data:text/javascript,' + encodeURIComponent(mode === 'fail' ? STUB_FAIL : STUB_OK), shortCircuit: true };
  }
  if (/tg-bot[\\\\/](owner-)?bot\\.mjs$/.test(specifier)) appendFileSync(process.env.PROBE_FILE, 'IMPORT ' + specifier + '\\n');
  return nextResolve(specifier, context);
}
`;

export function makeImportProbe() {
  const dir = mkdtempSync(path.join(tmpdir(), 'launcher-probe-'));
  const hooksFile = path.join(dir, 'hooks.mjs');
  const registerFile = path.join(dir, 'register.mjs');
  const probeFile = path.join(dir, 'probe.log');
  writeFileSync(hooksFile, HOOKS);
  writeFileSync(registerFile, `import { register } from 'node:module';\nglobalThis.fetch = () => Promise.reject(new Error('blocked-by-test'));\nregister(${JSON.stringify(pathToFileURL(hooksFile).href)});\n`);
  writeFileSync(probeFile, '');
  return {
    dir,
    probeFile,
    /** spawn/spawnSync 用: node 参数前缀 + env 追加项。stub: undefined | 'fail' | 'ok' */
    nodeArgs: () => ['--import', pathToFileURL(registerFile).href],
    env: (stub) => ({ PROBE_FILE: probeFile, ...(stub ? { PROBE_STUB: stub } : {}) }),
    reset: () => writeFileSync(probeFile, ''),
    imports: () => (existsSync(probeFile) ? readFileSync(probeFile, 'utf8').split('\n').filter((l) => l.startsWith('IMPORT ')) : []),
    cleanup: () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } },
  };
}
