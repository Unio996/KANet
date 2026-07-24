#!/usr/bin/env node
// M0c-1 Path B pilot — reviewed key-handoff helper (MF2 步骤4, Codex v0.10 re-review)
// 设计: scratch/j2-reviewed-helper-design.txt(9步设计, Bettor+NWT+KANet-UI 三人红队 GREEN)
//       + docs/2026-07-23-m0c-1-pilot-activation-runbook.md §3.6
//
// 🔴 用途: Owner 批准 pilot 候选钱包地址后, 用这个 reviewed 路径做 encrypt+insert（取代
//   operator 手搓裸 SQL, MF2 步骤4明禁）。复用 tg-wallet.js:58-73 同一批 reviewed 函数
//   （crypto.js encrypt()/decrypt() + wallet.js addressFromMnemonic()）, 不新造加密逻辑。
//
// 🔴 密钥经手警告(operator 必读): mnemonic 从 stdin 读一行, 绝不作为 CLI 参数(shell
//   history/ps 可见)。喂入方式**绝不用** `echo "mnemonic" | node this.mjs` 这类喂法——
//   echo 那句本身就会把 mnemonic 写进 shell history + ps 进程表, 等于把暴露面从这个脚本
//   挪到了喂法上, 没堵住。必须用交互式 prompt（stdin 无重定向时脚本会阻塞等键盘输入,
//   不经 shell 参数/不经其他进程可见的中间步骤）或从受控管道（只有当前进程能读、读完
//   即失效）喂入, 不回显终端。
//
// 🔴 --db 默认目标(NWT 提醒, 显式标注非隐式 fallback): 本工具默认目标**就是生产
//   console.db**（跟 kasia-console/test-framework/ 下那些隔离 scratch DB 的 harness 相反,
//   那些工具是刻意隔离; 这个工具是刻意直写生产库——这是它的设计目的, 不是没想清楚的默认）。
//
// 用法 (operator 手跑, cwd 任意, mnemonic 从 stdin 交互式喂入):
//   node kasia-console/scripts/m0c1-pilot-custodial-insert.mjs insert \
//     --tg-user-id <pilot 专用唯一标识> --approved-address <Owner 批准的候选地址> \
//     --network <testnet-12> [--db <path, 默认生产 console.db>]
//   （运行后脚本等待 stdin 输入一行 mnemonic, 交互式喂入或受控管道, 不回显/不经 echo）

import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { encrypt, decrypt } from '../src/services/crypto.js';
import { addressFromMnemonic } from '../src/services/wallet.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB = resolve(join(__dir, '..', 'data', 'console.db'));

// 步骤② tg_user_id 占位符拒绝清单（精确匹配, 大小写不敏感）
const PLACEHOLDER_TG_USER_IDS = new Set(['blank', 'mark pilot', 'pilot', 'test', 'placeholder', 'todo', 'tbd', '']);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { out[a.slice(2)] = argv[i + 1]; i++; }
    else out._.push(a);
  }
  return out;
}

/** 从 stdin 读一行（交互式 prompt / 受控管道, 绝不经 CLI 参数）。 */
function readMnemonicFromStdin() {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, terminal: false });
    rl.question('候选 mnemonic (stdin, 不回显于日志): ', (line) => {
      rl.close();
      resolve(line.trim());
    });
  });
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (cmd !== 'insert') {
    console.error('用法: node m0c1-pilot-custodial-insert.mjs insert --tg-user-id <id> --approved-address <addr> --network <net> [--db <path>]');
    process.exit(1);
  }

  for (const req of ['tg-user-id', 'approved-address', 'network']) {
    if (!args[req]) { console.error(`缺 --${req}`); process.exit(1); }
  }

  // 步骤③(refinement 3): --network 硬 required（已在上面通用必填检查里覆盖, 不依赖任何
  // DB 列 default——tg_custodial_wallets.network 列即使有 DEFAULT, 这里也永远显式传值,
  // 不留隐式 fallback 空间, 同 relay.js:75 network||mainnet 老坑的反面教材）。
  // 🔴 NWT 红队发现 4：只做"非空"校验不够——wallet.js:4-11 getNetworkType() 对未识别值
  // `default: return NetworkType.Mainnet`，operator 把 --network 打成 "testnet12"（漏横杠）
  // 这类 typo 会静默落到 mainnet 派生地址（同 relay.js:75/CUSTODIAL_RELAY_ID 那类 footgun 家族），
  // 拿去跟 --approved-address（Owner 批的 testnet-12 地址）比对会在③直接失配（不算完全无害，
  // 但错误信息会误导成"候选值不对"而非"network 打错了"，且理论上万一 approved-address 恰好也是
  // 拼错网络下的巧合地址会绕过③）——必须在这里做白名单，未识别值直接拒绝退出，不进
  // getNetworkType 那个 mainnet-default 分支。
  const NETWORK_ALLOWLIST = new Set(['testnet-12']); // pilot 阶段只接受 testnet-12
  if (!NETWORK_ALLOWLIST.has(args.network)) {
    console.error(`--network=${args.network} 不在允许集合 {${[...NETWORK_ALLOWLIST].join(', ')}}（拒绝, 防止 wallet.js getNetworkType() 对未识别值默认落 mainnet 的 footgun）`);
    process.exit(1);
  }

  const tgUserId = String(args['tg-user-id']).trim();
  const approvedAddress = String(args['approved-address']).trim();
  const network = String(args.network).trim();

  // 步骤② tg_user_id 非空 + 非占位符
  if (!tgUserId || PLACEHOLDER_TG_USER_IDS.has(tgUserId.toLowerCase())) {
    console.error(`--tg-user-id 非法：不得为空或占位符字面量（拒绝清单: ${[...PLACEHOLDER_TG_USER_IDS].join('/')}）——须为专用唯一 pilot 标识`);
    process.exit(1);
  }
  if (!approvedAddress) { console.error('--approved-address 非法：不得为空'); process.exit(1); }

  const dbPath = args.db ? resolve(args.db) : DEFAULT_DB;
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // 步骤④ 重复检查（友好报错, 非安全边界——真防线是 tg_user_id PRIMARY KEY / kaspa_address
  // UNIQUE 约束本身, NWT 红队核实过：这条只是给 operator 更早、更明确的错误信息）。
  const existing = db.prepare('SELECT tg_user_id FROM tg_custodial_wallets WHERE tg_user_id = ?').get(tgUserId);
  if (existing) {
    console.error(`--tg-user-id=${tgUserId} 已存在于 tg_custodial_wallets，本工具只做首次插入（吊销/更新走其他流程，非本工具范围）`);
    db.close();
    process.exit(1);
  }

  // ① 读 mnemonic（stdin, 绝不进 argv/绝不 log）
  let mnemonic = await readMnemonicFromStdin();
  if (!mnemonic) { console.error('mnemonic 为空，abort'); db.close(); process.exit(1); }

  // ③ insert 前先 derive-compare（比 Codex 字面要求[仅 insert 后验]更早止损：候选值本身
  // 跟批准值对不上时，提早失败，不碰 DB——跟下面⑦是两层不同的验证目标，非重复）。
  let derivedAddress;
  try {
    derivedAddress = addressFromMnemonic(mnemonic, network);
  } catch (e) {
    mnemonic = ''; // 尽早丢引用（best-effort 零化, 步骤⑨）
    // 🔴 NWT 红队发现 5：e.message 在 kaspa-wasm 抛出的异常上恒为 undefined，用 String(e) 才有
    // 内容——实测验证过(多种非法输入场景): kaspa-wasm 的 Bip39/Bip32 异常文案只描述失败原因
    // (如 "Bip39 error"/"Bip32 -> BIP39: actual checksum(N) != expected checksum(M)"这类校验和
    // 数字), 从不回显原始输入的 mnemonic 词组本身——no-key-leak 在这条错误路径上成立(非假设,
    // 已实测多种非法输入验证过, 见 pilot-custodial-insert-regression.mjs 的 ILLEGAL-MNEMONIC 用例)。
    console.error('mnemonic 派生地址失败（格式非法？）: ' + String(e));
    db.close();
    process.exit(1);
  }
  if (derivedAddress !== approvedAddress) {
    mnemonic = ''; // 尽早丢引用
    console.error(`候选 mnemonic 派生地址(${derivedAddress}) != --approved-address(${approvedAddress})，abort，不碰 DB`);
    db.close();
    process.exit(1);
  }

  // ⑤ encrypt（reviewed 路径, 同 tg-wallet.js:62 的 crypto.js encrypt()——不新造加密逻辑）
  let mnemonicEnc;
  try {
    mnemonicEnc = encrypt(mnemonic);
  } catch (e) {
    mnemonic = '';
    console.error('encrypt 失败: ' + e.message);
    db.close();
    process.exit(1);
  }
  mnemonic = ''; // ⑨ 用完立即丢引用（best-effort：mnemonic 在 V8 堆里作为 string 存在这段
  // 时间无法真正 overwrite 零化——JS 语言限制, 非本工具实现缺陷。best-effort = 丢引用 +
  // 不缓存 + 不重用, 如实标注, 非"已零化"这种过度承诺）。

  const now = new Date().toISOString();
  db.prepare(`INSERT INTO tg_custodial_wallets (tg_user_id, kaspa_address, mnemonic_encrypted, network, created_at, updated_at)
    VALUES (?,?,?,?,?,?)`).run(tgUserId, approvedAddress, mnemonicEnc, network, now, now);

  // ⑦ insert 后 in-process readback 验证（Codex 字面要求。跟③目标不同：③挡"候选值本身
  // 对不对"，⑦挡"写进 DB 的那份加密副本解密回来还对不对"——同一个 better-sqlite3 db
  // handle（refinement 2, KANet-UI+Bettor）：not 另开 readonly 连接, 避免 WAL 可见性延迟
  // 让"刚写的行还没 checkpoint"被误判成"读不到"）。
  const row = db.prepare('SELECT mnemonic_encrypted FROM tg_custodial_wallets WHERE tg_user_id = ?').get(tgUserId);
  let readbackOk = false;
  if (row) {
    try {
      const decrypted = decrypt(row.mnemonic_encrypted);
      const readbackAddress = addressFromMnemonic(decrypted, network);
      readbackOk = readbackAddress === approvedAddress;
    } catch { readbackOk = false; }
  }

  if (!readbackOk) {
    // ⑧ readback 失败（理论不可达——③已经挡过同样的比对，⑦失败意味着 encrypt/decrypt 或
    // DB 写入本身出了问题，非候选值问题——纵深防御：自愈 DELETE，不留错误数据在生产库）。
    db.prepare('DELETE FROM tg_custodial_wallets WHERE tg_user_id = ?').run(tgUserId);
    console.error(`CRITICAL: readback 验证失败（tg_user_id=${tgUserId} 派生地址跟批准值不一致），已 DELETE 刚插入的行（自愈，不留错误数据）`);
    db.close();
    process.exit(1);
  }

  console.log(`插入成功: tg_user_id=${tgUserId} address=${approvedAddress} network=${network}`);
  console.log('readback 验证: PASS（解密后重新派生地址与批准值逐字符一致）');
  db.close();
}

main().catch((e) => { console.error(`[m0c1-pilot-custodial-insert] 失败: ${e.message}`); process.exit(1); });
