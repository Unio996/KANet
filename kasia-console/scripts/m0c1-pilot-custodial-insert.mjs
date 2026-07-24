#!/usr/bin/env node
// M0c-1 Path B pilot — reviewed key-handoff helper (Codex MSG-124 终审整改 A+B+C+D)
// 设计: scratch/j2-msg124-rectification-design.txt(三人红队 GREEN 批落码)
//       + scratch/j2-reviewed-helper-design.txt(上一轮 9 步基础设计)
//       + docs/2026-07-23-m0c-1-pilot-activation-runbook.md §3.6
//
// 🔴 用途: Owner 批准 pilot 候选钱包地址后, 用这个 reviewed 路径做 encrypt+insert（取代
//   operator 手搓裸 SQL）。复用 tg-wallet.js:58-73 同一批 reviewed 函数（crypto.js
//   encrypt()/decrypt() + wallet.js addressFromMnemonic()）, 不新造加密逻辑。
//
// 🔴 A+B 整改(取代上一轮 stdin 方案): mnemonic 不再从 stdin 交互式读入——readline
//   terminal:false 不禁终端 echo, 上一轮"不回显"是 over-claim。改为读一份由
//   m0c1-pilot-candidate-generate.mjs 生成的**加密候选文件**（--candidate-file）。彻底不
//   给"人在终端打字喂入明文 mnemonic"这个选项, 而非试图隐藏它——候选 mnemonic 全程只以
//   "加密静态文件"或"进程内存"两种形态存在。
//
// 🔴 C 整改: --db 无默认值, 硬 required（防 helper 写错 DB 自读自过却与 live Console 不同
//   一份数据）。启动打印 CONSOLE_ENCRYPTION_KEY 指纹（sha256 前 8 hex）供 operator 跟 live
//   Console 启动日志的指纹人工核对（早期低成本 sanity check, 非权威证明——权威证明是
//   runbook §4.5 live 转账）。
//
// 🔴 D 整改: INSERT + readback 验证包进同一个 better-sqlite3 db.transaction()——事务内
//   throw 触发引擎自动 ROLLBACK, 取代原来"INSERT→SELECT→条件 DELETE"三条独立语句之间的
//   crash 残留窗口。
//
// 🔴 候选文件 shred 时机（NWT 红队钉死, 三档且仅这三档才 shred）:
//   ① 事务 commit 成功后（insert 成了, 候选没用了）
//   ② genuine mismatch（候选内容本身跟批准值对不上, 或 readback 校验真失败——候选本身坏了）
//   ③ 显式 revoke（no-go, 见 candidate-generate.mjs 的 revoke 子命令）
//   **绝不**在 transient infra 失败（DB locked / 非 mismatch 原因的事务 abort）时 shred——
//   那种情况可重试, shred 了 operator 就再也拿不到这份候选了（本文件的插入失败路径细分
//   处理见下方 catch 块）。
//
// 用法 (operator 手跑, cwd 任意):
//   node kasia-console/scripts/m0c1-pilot-custodial-insert.mjs insert \
//     --candidate-file <m0c1-pilot-candidate-generate.mjs 生成的加密候选文件路径> \
//     --tg-user-id <pilot 专用唯一标识> --approved-address <Owner 批准的候选地址> \
//     --network <testnet-12> --db <canonical live console.db 路径, 无默认值>

import { readFileSync, writeFileSync, unlinkSync, existsSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { encrypt, decrypt, currentKeyFingerprint } from '../src/services/crypto.js';
import { addressFromMnemonic } from '../src/services/wallet.js';

// 步骤② tg_user_id 占位符拒绝清单（精确匹配, 大小写不敏感）
const PLACEHOLDER_TG_USER_IDS = new Set(['blank', 'mark pilot', 'pilot', 'test', 'placeholder', 'todo', 'tbd', '']);
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

/** best-effort shred：覆写随机字节再 unlink（同 candidate-generate.mjs 的诚实标注：SSD
 * 场景下"覆写"未必物理生效, 非绝对物理擦除保证）。 */
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

  if (cmd !== 'insert') {
    console.error('用法: node m0c1-pilot-custodial-insert.mjs insert --candidate-file <path> --tg-user-id <id> --approved-address <addr> --network <net> --db <path>');
    process.exit(1);
  }

  for (const req of ['candidate-file', 'tg-user-id', 'approved-address', 'network', 'db']) {
    if (!args[req]) { console.error(`缺 --${req}`); process.exit(1); }
  }

  if (!NETWORK_ALLOWLIST.has(args.network)) {
    console.error(`--network=${args.network} 不在允许集合 {${[...NETWORK_ALLOWLIST].join(', ')}}（拒绝, 防止 wallet.js getNetworkType() 对未识别值默认落 mainnet 的 footgun）`);
    process.exit(1);
  }

  const tgUserId = String(args['tg-user-id']).trim();
  const approvedAddress = String(args['approved-address']).trim();
  const network = String(args.network).trim();
  const candidatePath = resolve(args['candidate-file']);

  if (!tgUserId || PLACEHOLDER_TG_USER_IDS.has(tgUserId.toLowerCase())) {
    console.error(`--tg-user-id 非法：不得为空或占位符字面量（拒绝清单: ${[...PLACEHOLDER_TG_USER_IDS].join('/')}）——须为专用唯一 pilot 标识`);
    process.exit(1);
  }
  if (!approvedAddress) { console.error('--approved-address 非法：不得为空'); process.exit(1); }

  // C 整改：--db 硬 required（上面通用必填检查已覆盖），无默认值——helper 原来的默认路径
  // 只是自己猜的, 猜错时会成功写"另一个 DB"、自己读回来也能验证通过(因为读写的是同一个
  // 错误 DB), 但 live Console 实际用的是不同文件, pilot 钱包对 live Console 不可见。
  const dbPath = resolve(args.db);
  if (!existsSync(dbPath)) {
    console.error(`--db 指向的文件不存在: ${dbPath}（这不是"帮你新建一个"的场景——canonical DB 应该已经存在, 路径打错比新建更可能是真相）`);
    process.exit(1);
  }

  // C 整改：启动打印 key 指纹（供 operator 跟 live Console 启动日志人工核对, 早期低成本
  // sanity check, 非权威证明）。
  console.log(`[insert] CONSOLE_ENCRYPTION_KEY fingerprint: ${currentKeyFingerprint()}`);

  if (!existsSync(candidatePath)) {
    console.error(`候选文件不存在: ${candidatePath}`);
    process.exit(1);
  }
  let candidate;
  try {
    candidate = JSON.parse(readFileSync(candidatePath, 'utf8'));
  } catch (e) {
    console.error(`候选文件解析失败（非法 JSON？未 shred 它——文件本身可能有问题, 需要人工排查非自动清理）: ${e.message}`);
    process.exit(1);
  }

  // 早期 sanity check：候选文件记录的 key 指纹跟这次 insert 用的 key 指纹不一致 = 两次调用
  // 用了不同 CONSOLE_ENCRYPTION_KEY，提早报错、给出清楚诊断，而非等 decrypt 因 AES-GCM
  // auth tag 不符而失败（那条错误信息不会直接告诉 operator"是 key 不一致"这个根因）。
  // 这不是安全边界本身（真安全边界是下面的 auth tag 校验），只是更友好的早失败诊断。
  if (candidate.key_fingerprint && candidate.key_fingerprint !== currentKeyFingerprint()) {
    console.error(`候选文件的 key_fingerprint(${candidate.key_fingerprint}) != 本次 insert 的 key fingerprint(${currentKeyFingerprint()})——两次调用用了不同 CONSOLE_ENCRYPTION_KEY，候选文件本身没坏，不 shred，请用正确的 key 重跑`);
    process.exit(1); // 非 shred：这是 transient/配置问题，非候选本身坏了
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // 步骤④ 重复检查（友好报错, 非安全边界——真防线是 tg_user_id PRIMARY KEY / kaspa_address
  // UNIQUE 约束本身）。
  const existing = db.prepare('SELECT tg_user_id FROM tg_custodial_wallets WHERE tg_user_id = ?').get(tgUserId);
  if (existing) {
    console.error(`--tg-user-id=${tgUserId} 已存在于 tg_custodial_wallets，本工具只做首次插入（吊销/更新走其他流程，非本工具范围）`);
    db.close();
    process.exit(1); // 非 shred：候选本身没坏, 只是这个 tg_user_id 已经用过了
  }

  // ① 从候选文件解密（取代 stdin）② 候选文件里的 address 字段跟 --approved-address 先比对一次
  if (candidate.address !== approvedAddress) {
    db.close();
    shredFile(candidatePath); // genuine mismatch：候选文件本身跟批准值对不上
    console.error(`候选文件记录的 address(${candidate.address}) != --approved-address(${approvedAddress})，abort，候选文件已 shred，不碰 DB`);
    process.exit(1);
  }

  let mnemonic;
  try {
    mnemonic = decrypt(candidate.mnemonic_encrypted);
  } catch (e) {
    db.close();
    // decrypt 失败（AES-GCM auth tag 不符）= 候选文件内容被篡改或损坏，genuine mismatch
    shredFile(candidatePath);
    console.error(`候选文件解密失败（内容被篡改或损坏？）: ${String(e)}——候选文件已 shred`);
    process.exit(1);
  }

  // ③ 交叉验证：重新派生地址跟 --approved-address 比对（不只信候选文件里存的 address 字段，
  // 双重防线——防 candidate 文件本身被篡改成"address 字段对但 mnemonic 不对"这种不一致）。
  let derivedAddress;
  try {
    derivedAddress = addressFromMnemonic(mnemonic, network);
  } catch (e) {
    mnemonic = ''; // 尽早丢引用（best-effort 零化）
    db.close();
    shredFile(candidatePath); // 解密出的内容派生不出地址 = 候选本身坏了
    console.error(`候选 mnemonic 派生地址失败（格式非法？）: ${String(e)}——候选文件已 shred`);
    process.exit(1);
  }
  if (derivedAddress !== approvedAddress) {
    mnemonic = '';
    db.close();
    shredFile(candidatePath); // 重新派生的地址跟批准值不一致 = genuine mismatch
    console.error(`候选 mnemonic 重新派生地址(${derivedAddress}) != --approved-address(${approvedAddress})，abort，候选文件已 shred，不碰 DB`);
    process.exit(1);
  }

  // ⑤ encrypt（reviewed 路径, 复用候选文件里已经加密过的密文——同一个 CONSOLE_ENCRYPTION_KEY
  // 加密, 已经过上面的 key 指纹一致性检查 + auth tag 校验证明可信, 不需要重新加密一遍多做
  // 无意义的重复工作, 减少 mnemonic 明文在内存里被处理的次数）。
  const mnemonicEnc = candidate.mnemonic_encrypted;

  // D 整改：⑥INSERT + ⑦readback 验证包进同一个 better-sqlite3 db.transaction()——事务内
  // 任何未捕获异常都会让整个事务自动 ROLLBACK（better-sqlite3 文档化行为, 非自定义逻辑），
  // 取代原来"INSERT→SELECT→条件 DELETE"三条独立语句之间的 crash 残留窗口。
  const now = new Date().toISOString();
  const insertAndVerify = db.transaction(() => {
    // Codex MSG-125 E 项：pilot 钱包建行时显式设 access_mode='capability_only'（durable 隔离
    // 判据，非留 default 'normal'）——legacy tg-wallet.js /send 查出行后按这一列 fail-closed
    // 拒绝，不依赖 process.env.PILOT_WALLET_ADDRESSES 这个 env allowlist（env 缺失/畸形/重启
    // 未加载时 fail-open 的老坑，见 migrate.js v193 注释）。
    db.prepare(`INSERT INTO tg_custodial_wallets (tg_user_id, kaspa_address, mnemonic_encrypted, network, access_mode, created_at, updated_at)
      VALUES (?,?,?,?,'capability_only',?,?)`).run(tgUserId, approvedAddress, mnemonicEnc, network, now, now);
    // 同一个 db handle 读回（refinement, KANet-UI+Bettor）：not 另开连接, 避免 WAL 可见性
    // 延迟让"刚写的行还没 checkpoint"被误判成"读不到"。
    const row = db.prepare('SELECT mnemonic_encrypted FROM tg_custodial_wallets WHERE tg_user_id = ?').get(tgUserId);
    const decrypted = decrypt(row.mnemonic_encrypted);
    const readbackAddress = addressFromMnemonic(decrypted, network);
    // Codex MSG-125 D 项(fault-injection 测试挂钩)：test-only 注入点, 只在显式设置的测试专用
    // env 变量下触发——production-inert（env 未设时零行为改变, 不加任何 production 分支开销:
    // 下面这行本身就是一次布尔求值 + 短路, 没有 env 时走的还是原来那条 readbackAddress 比较）。
    // 用途：证明"INSERT 后、readback 验证前故意抛异常"这条无法自然构造的路径（pre-check③跟
    // 事务内这个 check 用同一份数据, 结构上不会出现"pre-check 过了事务内又失败"的自然场景）
    // 真的会让整个事务原子回滚, 零残留行——而非只是"理论上应该会"。绝不在生产环境设这个 env。
    const forceInjectedFailure = process.env.M0C1_INSERT_TEST_FORCE_READBACK_FAIL === '1';
    if (readbackAddress !== approvedAddress || forceInjectedFailure) {
      // 这个 throw 会让整个事务(INSERT+SELECT)自动回滚——不会有半插入状态残留。
      const reason = forceInjectedFailure ? 'TEST_INJECTED_FAILURE(M0C1_INSERT_TEST_FORCE_READBACK_FAIL=1)' : `readback 派生地址(${readbackAddress}) != approvedAddress(${approvedAddress})`;
      throw new Error(`READBACK_MISMATCH: ${reason}`);
    }
  });

  mnemonic = ''; // ⑨ 用完立即丢引用（best-effort：mnemonic 在 V8 堆里作为 string 存在这段
  // 时间无法真正 overwrite 零化——JS 语言限制, 非本工具实现缺陷。best-effort = 丢引用 +
  // 不缓存 + 不重用, 如实标注, 非"已零化"这种过度承诺）。

  try {
    insertAndVerify();
  } catch (e) {
    db.close();
    if (/^READBACK_MISMATCH:/.test(e.message)) {
      // genuine mismatch：readback 校验真失败（理论不可达——上面③已经挡过同样的比对，走到
      // 这里意味着 encrypt/decrypt 或 DB 写入本身出了问题，非候选值问题）——shred（NWT 规则②）。
      shredFile(candidatePath);
      console.error(`CRITICAL: ${e.message}（事务已自动回滚, 无残留行；候选文件已 shred, 因为这是候选本身/加密链路真出问题, 非可重试的 infra 故障）`);
      process.exit(1);
    }
    // transient infra 失败（DB locked / 磁盘满 / 其他非 mismatch 原因的事务 abort）——
    // **不 shred**（NWT 规则：这类失败可重试, shred 了 operator 就再也拿不到候选了）。
    console.error(`insert 事务失败（非候选值问题, 疑似 transient infra 故障——候选文件未 shred, 可重试）: ${e.message}`);
    process.exit(1);
  }

  // 事务 commit 成功（NWT 规则①）：候选没用了, shred。
  shredFile(candidatePath);
  db.close();
  console.log(`插入成功: tg_user_id=${tgUserId} address=${approvedAddress} network=${network}`);
  console.log('readback 验证: PASS（同一事务内解密后重新派生地址与批准值逐字符一致）');
  console.log(`候选文件已 shred: ${candidatePath}`);
  console.log('⚠ helper 自身验证只证内部一致性（自己写的自己能读回来），不证明 live Console 进程能用同一 DB/同一 key 读到这行——权威证明见 runbook §4.5 live 转账。');
}

main().catch((e) => { console.error(`[m0c1-pilot-custodial-insert] 失败: ${e.message}`); process.exit(1); });
