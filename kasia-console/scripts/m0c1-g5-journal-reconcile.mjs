// J2 2026-07-25 — G5 journal reconcile: 处理 G5 real_chain smoke 留下的未终结(prepared/
// submitted/ambiguous)记录。设计: 团队三方深审定案（2026-07-25 频道, Bettor 拍板 + NWT/KANet-UI
// 挖出 capability.js 层的响应歧义, 见 g5-pilot-custodial-real-chain-smoke.mjs 头部注释同一批背景）。
//
// 两种 reconcile 路径, 处理方式刻意不对称:
//   ①有 txId(submitted 但落链轮询没确认到 / 进程在轮询完成前被杀): **全自动**——
//     checkUtxoLanded(payee, txId, minDepth=20), landed 就写 'landed', 没 landed 就原样保留
//     ambiguous(不强行下结论, 报告"还没到, 再等等")。这条自动化安全, 因为 checkUtxoLanded 是
//     确定性的链上查询, 不是启发式猜测。
//   ②无 txId(POST 从没拿到过 txId——网关拒绝/网络异常/进程在发出 fetch 之前就被杀): **绝不自动
//     下结论**（Bettor 2026-07-25 拍板: "别用 auto-heuristic, 呈证据+人工判"）。本脚本只做两件事:
//     a) 呈证据——直连 RPC 查 candidate 钱包当前 UTXO outpoint 集合, 跟 journal 里记录的
//        prepared_utxo_snapshot 逐一比对(是否有快照里的 outpoint 现在消失了), 外加 gate⑦ 记录的
//        run 前后余额信号(相等=强信号但非确定证据, 不等=需要更细查)。
//     b) 接受操作者的显式判定（--verdict spent|not-spent, 不是交互式 y/n 打字——同 candidate-file
//        流程那次"不给交互式终端打字机会"的纪律, 判定必须作为可审计的 CLI 参数留痕）, 写终态：
//        spent → 'reconciled_spent_no_txid'（仍计入预算）; not-spent → 'failed'（不计入预算,
//        释放这条对 gate⑦ 的阻塞）。
//
// 🔴 B5 加固(2026-07-25, Codex RESPONSE-20260725-G5-V2-COMMITTED-PARTIAL-CODEX-REVIEW B5,
// team 三方审 GREEN): 原版 --note 只是自由文本, 没有绑定任何可验证证据、没有记录谁批准、没有
// 复核——一次判断失误或被攻陷的 operator 就能凭空释放预算(not-spent 分支)。改成:
//   - 两种 verdict 都必须 --evidence-file <可读文件>(判定依据的证据, digest 记入 journal 可
//     审计, 文件本身不内嵌保持 journal 体积小)。
//   - not-spent(释放预算, 风险最高)必须 --approver-1/--approver-2 两个不同的已知身份(白名单
//     ALLOWED_APPROVER_NAMES, 硬拒同一人填两遍/拒绝白名单外的姓名)。
//   - spent(不释放预算, 只是把 ambiguous 归档成"确认真花了")保持单人, 但也要 --approver-1
//     在白名单内(判定人身份留痕)。
//   - 诚实局限: 这不是密码学意义上的双人授权(没有签名, approver 姓名是白名单内的自由声明字段),
//     是本地单机 CLI 工具能做到的最大化审计留痕, 不包装成比实际更强的机制。
//
// 用法:
//   列出所有未 reconcile 记录:
//     node m0c1-g5-journal-reconcile.mjs list
//   自动核对某条有 txId 的记录:
//     node m0c1-g5-journal-reconcile.mjs check <journal_id>
//   呈证据(无 txId 记录, 只读不改):
//     node m0c1-g5-journal-reconcile.mjs evidence <journal_id>
//   写入人工判定(无 txId 记录, 唯一改状态的入口):
//     node m0c1-g5-journal-reconcile.mjs resolve <journal_id> --verdict spent \
//       --evidence-file <path> --approver-1 <name> [--approver-1-note "<text>"]
//     node m0c1-g5-journal-reconcile.mjs resolve <journal_id> --verdict not-spent \
//       --evidence-file <path> \
//       --approver-1 <name> [--approver-1-note "<text>"] \
//       --approver-2 <name> [--approver-2-note "<text>"]   # 必须跟 approver-1 不同

import { readFileSync, writeFileSync, renameSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getRepoRoot } from '../src/lib/repo-root.mjs';

// B5: not-spent 释放预算风险最高, 双人复核的姓名字段收窄到已知身份白名单(NWT 2026-07-25 提:
// 纯字符串比对 approver1 !== approver2 挡不住大小写/空格/昵称变体绕过, 白名单同时解决"防同一人
// 填两遍"和"防打错字/写假名"两个问题)。
const ALLOWED_APPROVER_NAMES = new Set(['Bettor', 'NWT', 'KANet-UI', 'Owner']);

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 🔴 这类"每个文件硬编码往上跳几层"的 bug 这轮连撞两次(health.js/本文件), 改用 getRepoRoot()
// 共享 helper(向上 walk 找 .git 目录, 不需要硬编码深度)根治整类问题(Bettor+KANet-UI+NWT 三方
// 独立收敛到同一个修法, 2026-07-25 定案)。
const ROOT = getRepoRoot(HERE); // D:/kanet-tn12
const NETWORK = 'testnet-12';
const JOURNAL_DIR = path.join(ROOT, 'scratch/g5-journal');
const UNRECONCILED_STATES = ['prepared', 'submitted', 'ambiguous'];

// B4(2026-07-25): tmp 孤儿(G5 fsync 已落盘但 crash 打断了 rename, 见
// g5-pilot-custodial-real-chain-smoke.mjs journalWriteAtomic 头部注释)按 id 定位——文件名
// 还没转正成 `<id>.json`, 只能扫描匹配 `.tmp-<id>-*` 前缀。
function findJournalFile(journalId) {
  const canonical = path.join(JOURNAL_DIR, `${journalId}.json`);
  if (existsSync(canonical)) return { full: canonical, isOrphan: false };
  if (existsSync(JOURNAL_DIR)) {
    const prefix = `.tmp-${journalId}-`;
    const orphan = readdirSync(JOURNAL_DIR).find((f) => f.startsWith(prefix));
    if (orphan) return { full: path.join(JOURNAL_DIR, orphan), isOrphan: true };
  }
  return null;
}

function loadJournal(journalId) {
  const found = findJournalFile(journalId);
  if (!found) { console.error(`journal 不存在(既非 <id>.json 也非 tmp 孤儿文件): ${journalId}`); process.exit(1); }
  return { full: found.full, isOrphan: found.isOrphan, entry: JSON.parse(readFileSync(found.full, 'utf8')) };
}

// 终态写入永远落到规范 `<id>.json` 名——若源是 tmp 孤儿, 顺带补完那次被 crash 打断的 rename
// (旧孤儿文件随后删掉, 不留两份)。
function writeJournalAtomic(srcFull, entry, isOrphan) {
  const canonical = path.join(JOURNAL_DIR, `${entry.id}.json`);
  const tmp = canonical + `.tmp-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(entry, null, 2));
  renameSync(tmp, canonical);
  if (isOrphan && srcFull !== canonical) {
    try { unlinkSync(srcFull); }
    catch (e) { console.error(`[reconcile] 警告: 旧 tmp 孤儿文件清理失败(不影响本次 resolve 已经成功, 但会留两份, 建议人工清理): ${srcFull} — ${e.message}`); }
  }
}

function listUnreconciled() {
  if (!existsSync(JOURNAL_DIR)) { console.log('(无 journal 目录, 无记录)'); return; }
  // B4(2026-07-25): tmp 孤儿(crash 打断了 rename)一并列出, 不能让它们对 list 隐身——否则
  // operator 永远不知道有条记录卡着, gate⑦ 却会拦(见 sumSpentKasAndFindAmbiguous 同款逻辑)。
  const rows = readdirSync(JOURNAL_DIR)
    .filter((f) => (f.endsWith('.json') && !f.startsWith('.tmp-')) || f.startsWith('.tmp-'))
    .map((f) => ({ file: f, isOrphan: f.startsWith('.tmp-'), entry: JSON.parse(readFileSync(path.join(JOURNAL_DIR, f), 'utf8')) }))
    .filter((r) => UNRECONCILED_STATES.includes(r.entry.state));
  if (rows.length === 0) { console.log('无未 reconcile 记录。'); return; }
  for (const r of rows) {
    const tag = r.isOrphan ? '(tmp 孤儿, rename 未完成)' : '';
    console.log(`${r.entry.id}  state=${r.entry.state}${tag}  amount=${r.entry.amount_kas}KAS  txId=${r.entry.txId || '(无)'}  created_at=${r.entry.created_at}`);
  }
}

async function withRpc(fn) {
  const kaspa = await import(pathToFileURL(path.resolve(ROOT, 'kasia-relay/node_modules/kaspa-wasm/kaspa.js')).href);
  const { RpcClient, Encoding } = kaspa;
  const rpcUrl = process.env.KASPA_RPC_URL;
  if (!rpcUrl || rpcUrl.includes('127.0.0.1:1')) { console.error('未设 KASPA_RPC_URL(或误继承死端口)'); process.exit(1); }
  const rpc = new RpcClient({ url: rpcUrl, encoding: Encoding.Borsh, networkId: NETWORK });
  try {
    await Promise.race([rpc.connect({}), new Promise((_, rej) => setTimeout(() => rej(new Error('RPC connect timeout')), 8000))]);
    return await fn(rpc, kaspa);
  } finally { try { await rpc.disconnect(); } catch {} }
}

// ── ①有 txId: 全自动 checkUtxoLanded ──
async function autoCheck(journalId) {
  const { full, isOrphan, entry } = loadJournal(journalId);
  if (!UNRECONCILED_STATES.includes(entry.state)) { console.log(`journal ${journalId} 已是终态(${entry.state}), 无需 reconcile。`); return; }
  if (!entry.txId) { console.log(`journal ${journalId} 无 txId, 走 'evidence'+'resolve' 流程, 不是 'check'。`); return; }
  const { checkUtxoLanded } = await import(pathToFileURL(path.join(ROOT, 'kasia-relay/src/lib/p2sh.mjs')).href);
  const r = await checkUtxoLanded(entry.payee_address, entry.txId, NETWORK, 20);
  if (r.landed) {
    writeJournalAtomic(full, { ...entry, state: 'landed', landed_depth: r.depth, reconciled_at: new Date().toISOString() }, isOrphan);
    console.log(`journal ${journalId} → landed(depth=${r.depth})。已释放对 gate⑦ 的阻塞。`);
  } else {
    console.log(`journal ${journalId} txId=${entry.txId} 仍未确认落地(depth=${r.depth ?? '未知'}), 保持 ambiguous, 不下结论, 稍后重跑本命令再查。`);
  }
}

// ── ②无 txId: 只呈证据, 不下结论 ──
async function showEvidence(journalId) {
  const { entry } = loadJournal(journalId);
  if (entry.txId) { console.log(`journal ${journalId} 有 txId(${entry.txId}), 用 'check' 命令(全自动), 不是 'evidence'。`); return; }
  const snapshot = entry.prepared_utxo_snapshot || [];
  const currentOutpoints = await withRpc(async (rpc, kaspa) => {
    const { entries } = await rpc.getUtxosByAddresses([new kaspa.Address(entry.candidate_address)]);
    return (entries || []).map((e) => {
      const op = e.outpoint ?? e.utxoEntry?.outpoint;
      return op ? `${op.transactionId}:${op.index}` : null;
    }).filter(Boolean).sort();
  });
  const missing = snapshot.filter((op) => !currentOutpoints.includes(op));
  const added = currentOutpoints.filter((op) => !snapshot.includes(op));
  console.log(`\n=== journal ${journalId} 证据(供人工判定, 本命令不下结论) ===`);
  console.log(`candidate 地址: ${entry.candidate_address}`);
  console.log(`journal 记录金额: ${entry.amount_kas} KAS`);
  console.log(`journal 创建时间: ${entry.created_at}`);
  console.log(`响应记录: ${entry.response_note || '(无, 可能是 fetch() 本身异常, 从没拿到响应)'}`);
  console.log(`\nprepared 时 UTXO 快照: ${snapshot.length} 条`);
  console.log(`现在 UTXO 集合: ${currentOutpoints.length} 条`);
  console.log(`快照里现在消失的 outpoint(可能已被花掉): ${missing.length ? missing.join(', ') : '(无)'}`);
  console.log(`现在多出的 outpoint(可能是找零/新收款): ${added.length ? added.join(', ') : '(无)'}`);
  if (missing.length === 0) {
    console.log(`\n信号: 快照里的 UTXO 全部原样还在 → 强信号指向"没有从这个钱包发生任何花费"(非确定证据, 人工判定前请自行核实是否有其他解释)。`);
  } else {
    console.log(`\n信号: 有 ${missing.length} 条快照里的 outpoint 现在消失了 → 这个钱包确实发生过花费, 但不能仅凭这个断定这笔花费就是本条 journal 记录的那次(pilot 钱包按设计单一用途, 交叉污染概率低, 但仍需人工确认)。`);
  }
  console.log(`\n判定后请跑: node m0c1-g5-journal-reconcile.mjs resolve ${journalId} --verdict spent|not-spent --note "<依据摘要>"\n`);
}

// ── 写入人工判定(唯一改无 txId 记录状态的入口) ── B5: evidence-file + approver 白名单加固
function resolve(journalId, verdict, opts) {
  if (!['spent', 'not-spent'].includes(verdict)) { console.error(`--verdict 必须是 spent 或 not-spent, 收到: ${verdict}`); process.exit(1); }

  const { evidenceFile, approver1, approver1Note, approver2, approver2Note } = opts;
  if (!evidenceFile || !existsSync(evidenceFile)) { console.error(`--evidence-file 必传且必须是可读文件(判定依据的证据, digest 记入 journal 可审计)`); process.exit(1); }
  const evidenceDigest = createHash('sha256').update(readFileSync(evidenceFile)).digest('hex');

  let approvers;
  if (verdict === 'not-spent') {
    // 释放预算, 风险最高——双人复核, 姓名必须在白名单内且互不相同
    if (!approver1 || !approver2) { console.error(`not-spent 判定必须提供 --approver-1 和 --approver-2 两个不同的批准人(释放预算需双人复核)`); process.exit(1); }
    if (!ALLOWED_APPROVER_NAMES.has(approver1) || !ALLOWED_APPROVER_NAMES.has(approver2)) {
      console.error(`--approver-1/--approver-2 必须是已知身份之一(${[...ALLOWED_APPROVER_NAMES].join('/')}), 收到: ${approver1} / ${approver2}`); process.exit(1);
    }
    if (approver1 === approver2) { console.error(`--approver-1 和 --approver-2 不能是同一人(双人复核要求两个独立视角)`); process.exit(1); }
    approvers = [
      { name: approver1, note: approver1Note || '', at: new Date().toISOString() },
      { name: approver2, note: approver2Note || '', at: new Date().toISOString() },
    ];
  } else {
    // spent: 不释放预算, 风险低——单人, 但身份仍须在白名单内(判定人留痕)
    if (!approver1) { console.error(`spent 判定必须提供 --approver-1(判定人身份留痕)`); process.exit(1); }
    if (!ALLOWED_APPROVER_NAMES.has(approver1)) { console.error(`--approver-1 必须是已知身份之一(${[...ALLOWED_APPROVER_NAMES].join('/')}), 收到: ${approver1}`); process.exit(1); }
    approvers = [{ name: approver1, note: approver1Note || '', at: new Date().toISOString() }];
  }

  const { full, isOrphan, entry } = loadJournal(journalId);
  if (entry.txId) { console.error(`journal ${journalId} 有 txId, 应该用 'check'(全自动), 不该走人工 'resolve'。`); process.exit(1); }
  if (!UNRECONCILED_STATES.includes(entry.state)) { console.log(`journal ${journalId} 已是终态(${entry.state}), 无需 resolve。`); return; }
  const newState = verdict === 'spent' ? 'reconciled_spent_no_txid' : 'failed';
  writeJournalAtomic(full, {
    ...entry, state: newState, reconciled_at: new Date().toISOString(), reconciled_verdict: verdict,
    reconciled_evidence: { evidence_file: evidenceFile, evidence_digest: evidenceDigest },
    reconciled_approvers: approvers,
  }, isOrphan);
  console.log(`journal ${journalId} → ${newState}(判定: ${verdict}, 批准人: ${approvers.map((a) => a.name).join('+')}, 证据digest: ${evidenceDigest.slice(0, 16)}...)。已释放对 gate⑦ 的阻塞。`);
}

async function main() {
  const [cmd, arg2, ...rest] = process.argv.slice(2);
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) { flags[rest[i].slice(2)] = rest[i + 1]; i++; }
  }
  if (cmd === 'list') { listUnreconciled(); return; }
  if (cmd === 'check') { if (!arg2) { console.error('用法: check <journal_id>'); process.exit(1); } await autoCheck(arg2); return; }
  if (cmd === 'evidence') { if (!arg2) { console.error('用法: evidence <journal_id>'); process.exit(1); } await showEvidence(arg2); return; }
  if (cmd === 'resolve') {
    if (!arg2) { console.error('用法: resolve <journal_id> --verdict spent|not-spent --evidence-file <path> --approver-1 <name> [--approver-2 <name>]'); process.exit(1); }
    resolve(arg2, flags.verdict, {
      evidenceFile: flags['evidence-file'],
      approver1: flags['approver-1'], approver1Note: flags['approver-1-note'],
      approver2: flags['approver-2'], approver2Note: flags['approver-2-note'],
    });
    return;
  }
  console.error('用法: list | check <id> | evidence <id> | resolve <id> --verdict spent|not-spent --evidence-file <path> --approver-1 <name> [--approver-2 <name>]');
  process.exit(1);
}

main().catch((e) => { console.error('[reconcile] 异常:', e.stack || e.message); process.exit(1); });
