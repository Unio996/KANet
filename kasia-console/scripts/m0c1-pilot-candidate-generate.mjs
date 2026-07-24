#!/usr/bin/env node
// M0c-1 Path B pilot — candidate mnemonic 生成器（Codex MSG-124 整改 A+B 合并方案）
// 设计: scratch/j2-msg124-rectification-design.txt（三人红队 GREEN 批落码）
//
// 🔴 用途: §3 offline 候选阶段（Owner go 前）生成候选 mnemonic + 派生地址, 生成后**立即**
//   （同一 tick, 不经任何中间 console.log/写盘）加密落盘。彻底不给"人在终端交互式打字喂入
//   mnemonic"这个选项——候选 mnemonic 全程只以"加密静态文件"或"进程内存"两种形态存在,
//   从没有明文经过终端/stdout/剪贴板/log。这是从根上消灭"stdin 交互式输入回显"问题的方案,
//   而非试图去隐藏终端 echo（那条路走不通, readline terminal:false 不禁 echo）。
//
// 用法:
//   node kasia-console/scripts/m0c1-pilot-candidate-generate.mjs generate \
//     --label <pilot 候选标识> --network <testnet-12> [--candidate-dir <dir, 默认 scratch/>]
//   node kasia-console/scripts/m0c1-pilot-candidate-generate.mjs revoke --candidate-file <path>
//     （no-go/abort 路径：单纯 shred 候选文件, 不碰 DB——这个阶段还没到 insert, DB 层面本来
//      就没东西可清, 见 MF2 步骤3）

import { writeFileSync, unlinkSync, existsSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encrypt } from '../src/services/crypto.js';
import { generateMnemonic, addressFromMnemonic } from '../src/services/wallet.js';
import { currentKeyFingerprint } from '../src/services/crypto.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CANDIDATE_DIR = resolve(join(__dir, '..', '..', 'scratch'));
const NETWORK_ALLOWLIST = new Set(['testnet-12']); // pilot 阶段只接受 testnet-12

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { out[a.slice(2)] = argv[i + 1]; i++; }
    else out._.push(a);
  }
  return out;
}

/** best-effort shred：覆写随机字节再 unlink。文件系统层面真删除受限于底层存储介质
 * （SSD 场景下"覆写"未必物理生效——同 mnemonic 变量零化的诚实标注, 非绝对物理擦除保证）。 */
function shredFile(path) {
  try {
    if (!existsSync(path)) return;
    const size = statSync(path).size;
    writeFileSync(path, randomBytes(Math.max(size, 64)));
    unlinkSync(path);
  } catch (e) {
    console.error(`shred 失败（best-effort, 非阻塞）: ${e.message}`);
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (cmd === 'revoke') {
    if (!args['candidate-file']) { console.error('缺 --candidate-file'); process.exit(1); }
    const p = resolve(args['candidate-file']);
    if (!existsSync(p)) { console.error(`候选文件不存在: ${p}（可能已被 shred, 无需重复操作）`); process.exit(1); }
    shredFile(p);
    console.log(`候选文件已 shred（no-go/abort, 未碰任何 DB）: ${p}`);
    return;
  }

  if (cmd !== 'generate') {
    console.error('用法: generate --label <id> --network <net> [--candidate-dir <dir>] | revoke --candidate-file <path>');
    process.exit(1);
  }

  for (const req of ['label', 'network']) {
    if (!args[req]) { console.error(`缺 --${req}`); process.exit(1); }
  }
  if (!NETWORK_ALLOWLIST.has(args.network)) {
    console.error(`--network=${args.network} 不在允许集合 {${[...NETWORK_ALLOWLIST].join(', ')}}（拒绝, 同 insert helper 的白名单纪律)`);
    process.exit(1);
  }
  const label = String(args.label).trim();
  if (!label) { console.error('--label 不得为空'); process.exit(1); }

  // ① 生成（CSPRNG）② 派生地址 ③ 立即加密（同一 tick，中间零 console.log/写盘）
  let mnemonic = generateMnemonic();
  const address = addressFromMnemonic(mnemonic, args.network);
  const mnemonicEnc = encrypt(mnemonic);
  mnemonic = ''; // 用完立即丢引用（best-effort 零化，同 insert helper 纪律）

  const candidateDir = args['candidate-dir'] ? resolve(args['candidate-dir']) : DEFAULT_CANDIDATE_DIR;
  const fileName = `pilot-candidate-${label}-${Date.now()}.enc.json`;
  const candidatePath = join(candidateDir, fileName);
  writeFileSync(candidatePath, JSON.stringify({
    label,
    address,
    network: args.network,
    mnemonic_encrypted: mnemonicEnc,
    key_fingerprint: currentKeyFingerprint(), // 供 insert helper 早期 sanity check：候选加密时
    // 用的 key 指纹, 跟 insert 时 helper 自己的 key 指纹不一致 = 两次调用用了不同 key, 提早报错
    // 而非等 decrypt 因 auth tag 不符而失败（诊断信息更清楚, 非安全边界本身——真安全边界是
    // AES-GCM 的 auth tag 校验, 这条只是给出更友好的错误定位）。
    created_at: new Date().toISOString(),
  }, null, 2));

  // stdout 只打印 address（供 operator 转给 Owner 审批）+ 候选文件路径 + key 指纹（供人工
  // 核对）——从不打印/log mnemonic 明文，一次都不。
  console.log(`候选生成完成:`);
  console.log(`  label=${label} network=${args.network}`);
  console.log(`  address=${address}`);
  console.log(`  candidate_file=${candidatePath}`);
  console.log(`  key_fingerprint=${currentKeyFingerprint()}`);
  console.log(`（mnemonic 已加密落盘, 从未打印/log 明文。Owner 审批候选地址后, 用同一份候选文件走 insert helper。若 no-go, 用 revoke 子命令 shred 这份候选文件。）`);
}

main().catch((e) => { console.error(`[m0c1-pilot-candidate-generate] 失败: ${e.message}`); process.exit(1); });
