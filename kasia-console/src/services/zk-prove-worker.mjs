// zk-prove-worker.mjs — 缺件②(Bettor 2026-07-07 18:54 派工, T2b 生产线本体最后三缺件之一)。
//
// 轮询 zk_prove_jobs(既有幂等锁表, migrate v180)→ 组 GuestInput → spawn RISC0 host(真 Groth16 proving,
// ~4min)→ 独立重算 journalHash 交叉核对(不只信 rust 侧吐的 journal_digest)→ 用隔离 ZK-enabled WASM build
// 铸 gate script → relay 注资 gate UTXO → 原子 UPDATE 写 zk_continuation.proving = ready(T2b(i) schema)。
//
// 复用今天真实资产,零重造:
//   - RISC0 host 二进制用法: zk-payout-guest/host/src/main.rs(cargo run --release -- input.json output_base)
//   - gate 铸造逻辑: kasia-console/scratch/_j2_3o6cs_gate_mint.mjs(隔离 WASM ZkScriptBuilder, 今晚真实用过)
//   - journalHash 公式: zk-close-builder.mjs computeJournalHash(betsRoot,payoutRoot,winner), 非重算法
//
// NWT 18:59 pre-review 三问(动手前已确认, 全部采纳):
//   ①running 布尔互斥(proving ~4min, 比系统里其它 tick 长得多, tick overlap 风险比 submit/voter tick 更现实)
//   ②spawn 必须异步(await 'exit'/'close' 事件), 绝不用 execSync/spawnSync(会卡死整个 console 进程 4 分钟)
//   ③失败态双写: zk_prove_jobs.status=failed(job 队列记账)+ updateProvingFailed(schema 侧同步可见,
//     J1 的 dispatchUnlockZkClose 只读 schema 这边的 proving.status, 漏了这步他看不出 proving 已经死了)
//
// kill switch 默认 OFF(照搬 BSHARD_CLOSE_SUBMIT_V2_ENABLED 等今晚同款模式)。

import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { sqlite } from '../db/client.js';
import { sendCommandAsync } from './relay-manager.js';
import { computeJournalHash } from '../lib/zk-close-builder.mjs';
import { updateProvingReady, updateProvingFailed } from '../lib/closezk-v2-mint.mjs';

const _require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const GUEST_HOST_DIR = process.env.ZK_PAYOUT_GUEST_HOST_DIR || join(HERE, '..', '..', '..', 'zk-payout-guest', 'host');
const ZKSDK_WASM_PATH = process.env.ZKSDK_WASM_PATH || 'D:/rusty-kaspa-zksdk-isolated/wasm/nodejs/kaspa/kaspa.js';
const SCRATCH_DIR = process.env.ZK_PROVE_WORKER_SCRATCH_DIR || join(HERE, '..', '..', 'scratch', 'zk-prove-worker');
const SETTLER_RELAY_ID = process.env.BSHARD_SETTLER_RELAY_ID || null;   // 同 bshard-close-voter.js 复用同一个显式配置, 非猜测
const GATE_FUND_SOMPI = Number(process.env.ZK_GATE_FUND_SOMPI || 100_000_000);   // 1 KAS, dust 量级注资
const PROVE_TIMEOUT_MS = Number(process.env.ZK_PROVE_TIMEOUT_MS || 15 * 60_000);   // 真实 proving ~4min, 留 15min 上限防挂死

let _kaspaZk = null;
function kaspaZk() { if (!_kaspaZk) _kaspaZk = _require(ZKSDK_WASM_PATH); return _kaspaZk; }

/**
 * spawnCargoProve — 异步执行 RISC0 host 出证(NWT pre-review②: 绝不同步阻塞)。
 * @param {string} inputJsonPath
 * @param {string} outputBasename
 * @returns {Promise<{summary:object, receiptHex:string}>}
 */
export function spawnCargoProve(inputJsonPath, outputBasename) {
  return new Promise((resolve, reject) => {
    // 不用 shell:true(Node DEP0190 警告 + 非必要注入面——args 全部本函数自己拼的路径, shell 包装纯增风险无收益)。
    const child = spawn('cargo', ['run', '--release', '--', inputJsonPath, outputBasename], { cwd: GUEST_HOST_DIR });
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`spawnCargoProve: timeout after ${PROVE_TIMEOUT_MS}ms, killed`)); }, PROVE_TIMEOUT_MS);
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`spawnCargoProve: spawn error: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`spawnCargoProve: cargo run exited ${code}: ${stderr.slice(-800)}`));
      try {
        const summary = JSON.parse(readFileSync(`${outputBasename}.summary.json`, 'utf8'));
        const receiptHex = readFileSync(`${outputBasename}.hex`, 'utf8').trim();
        resolve({ summary, receiptHex });
      } catch (e) { reject(new Error(`spawnCargoProve: cargo run exited 0 but output files unreadable: ${e.message}`)); }
    });
  });
}

/**
 * buildAndFundGate — 铸 gate script(隔离 ZK-enabled WASM, 今晚 _j2_3o6cs_gate_mint.mjs 同款逻辑提炼)+ 注资。
 * @returns {Promise<{gateAddr:string, sigScript:string, redeemScript:string, outpointTxid:string, index:number, fundedAtMs:number}>}
 */
export async function buildAndFundGate(imageIdHex, journalDigestHex, receiptHex, relayId) {
  const kaspa = kaspaZk();
  const builder = kaspa.ZkScriptBuilder.newR0({ flags: { covenantsEnabled: true } });
  builder.commitToGroth16WithFixedJournal(imageIdHex, journalDigestHex);
  const finalized = builder.finalizeWithGroth16FixedJournalProof(receiptHex);
  const { sigScript, redeemScript } = finalized;
  const spk = kaspa.payToScriptHashScript(new Uint8Array(Buffer.from(redeemScript, 'hex')));
  const gateAddr = kaspa.addressFromScriptPublicKey(spk, 'testnet-12').toString();

  const kasAmount = GATE_FUND_SOMPI / 1e8;
  const tr = await sendCommandAsync(relayId, { type: 'transfer', target: gateAddr, amount: Number(kasAmount.toFixed(8)) }, 90_000);
  const outpointTxid = tr?.txId || tr?.txid;
  if (!outpointTxid) throw new Error(`buildAndFundGate: transfer no txId: ${JSON.stringify(tr).slice(0, 200)}`);

  let landedOk = false;
  for (let i = 0; i < 15 && !landedOk; i++) {
    try { const chk = await sendCommandAsync(relayId, { type: 'check_utxo_landed', address: gateAddr, txid: outpointTxid }, 15_000); landedOk = !!(chk?.landed || chk?.found); } catch { /* transient, retry */ }
    if (!landedOk) await new Promise((res) => setTimeout(res, 2_000));
  }
  if (!landedOk) throw new Error(`buildAndFundGate: gate funding tx ${outpointTxid} broadcast OK but not landed within wait window`);

  return { gateAddr, sigScript, redeemScript, outpointTxid, index: 0, fundedAtMs: Date.now() };
}

const TICK_MS = 30_000;
let timer = null, running = false;
const ENABLED = process.env.ZK_PROVE_WORKER_ENABLED === '1';

export function startZkProveWorkerCron() {
  if (timer) return;
  if (!ENABLED) { console.log('[zk-prove-worker] cron NOT started — ZK_PROVE_WORKER_ENABLED!=1 (真实 RISC0 proving + 真 KAS 注资, 默认不自动跑)'); return; }
  setTimeout(() => { zkProveWorkerTick().catch((e) => console.error('[zk-prove-worker] startup tick:', e.message)); }, 5_000);
  timer = setInterval(() => { zkProveWorkerTick().catch((e) => console.error('[zk-prove-worker] tick:', e.message)); }, TICK_MS);
  console.log(`[zk-prove-worker] cron started (${TICK_MS / 1000}s tick) — ZK_PROVE_WORKER_ENABLED=1`);
}
export function stopZkProveWorkerCron() { if (timer) { clearInterval(timer); timer = null; } }

export async function zkProveWorkerTick() {
  if (running) return { skipped: true };   // NWT pre-review①: proving ~4min, running mutex 防 tick overlap
  running = true;
  try {
    // 原子 claim: 同 zk-prove-server.mjs /zk-prove/poll 同款 transaction 内 SELECT+UPDATE, 防并发轮询取到同一行。
    const job = sqlite.transaction(() => {
      const row = sqlite.prepare("SELECT * FROM zk_prove_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1").get();
      if (!row) return null;
      sqlite.prepare("UPDATE zk_prove_jobs SET status = 'in_progress', updated_at = datetime('now') WHERE id = ? AND status = 'pending'").run(row.id);
      return sqlite.prepare('SELECT * FROM zk_prove_jobs WHERE id = ?').get(row.id);
    })();
    if (!job) return { ok: true, pending: 0 };
    if (!SETTLER_RELAY_ID) { _fail(job, 'BSHARD_SETTLER_RELAY_ID unset — 无法注资 gate'); return { ok: false }; }

    let orderedBets, betsRootHex;
    try { orderedBets = JSON.parse(job.ordered_bets_json); betsRootHex = job.bets_root_hex; } catch (e) { _fail(job, `ordered_bets_json parse fail: ${e.message}`); return { ok: false }; }

    mkdirSync(SCRATCH_DIR, { recursive: true });
    const runId = randomUUID().slice(0, 8);
    const inputPath = join(SCRATCH_DIR, `job${job.id}-${runId}-input.json`);
    const outputBase = join(SCRATCH_DIR, `job${job.id}-${runId}-out`);

    // 🔴 fail-closed guard(NWT 19:09 review 问出的真缺口: 之前只在注释里"声称"enqueue 侧保证非空, 代码里
    //   零运行时校验——这就是"沿用口头承诺非结构性保证"同一形状的坑, 今晚已经因为这个模式撞过好几次了)。
    //   §4 硬门⑤ mint 政策(禁 bps-fallback)在这里补上真实拦截: fee_leaves 空 = 直接拒绝, 不浪费 4 分钟
    //   proving 时间去跑一个已知会撞 main.rs L152-156 断裂分支的输入。**完整 Σleaf 守恒验证(driver 侧独立
    //   重算 pari-mutuel 逐笔金额跟 guest 一致)仍然是缺件①(J1 enqueue 域)的职责**——本函数拿不到
    //   winner 侧每笔精确 payout 金额(guest 才算, 受托 ZK 保密), 只能做"非空"这一层最基础的输入面校验,
    //   不是完整替代 §4 硬门⑤ 的 Σleaf == consolidated_pool 断言。
    const feeLeavesRaw = JSON.parse(job.fee_leaves_json || '[]');
    if (!Array.isArray(feeLeavesRaw) || feeLeavesRaw.length === 0) {
      _fail(job, 'fee_leaves 为空数组 — §4 硬门⑤禁 bps-fallback: enqueue 侧(缺件①)必须显式提供完整 fee_leaves, 拒绝在空 fee_leaves 上浪费 proving 时间');
      return { ok: false };
    }

    // GuestInput 形状照抄 zk-payout-guest/host/src/main.rs 的 Bet/FeeLeafIn/GuestInput struct, 非重发明。
    const guestInput = {
      bettors: orderedBets.map((b) => ({ pk: Array.from(Buffer.from(b.pk, 'hex')), stake: Number(b.stake), direction: Number(b.direction) })),
      winning_direction: Number(job.attested_winner),
      pool_total_sompi: job.pool_total_sompi != null ? Number(job.pool_total_sompi) : null,
      fee_bps: 0,   // 硬门⑤: 禁 bps-fallback, 生产路径永远走显式 fee_leaves, fee_bps 恒 0
      fee_leaves: feeLeavesRaw.map((f) => ({ pk: Array.from(Buffer.from(f.pk, 'hex')), amount: Number(f.amount) })),
    };
    writeFileSync(inputPath, JSON.stringify(guestInput));

    console.log(`[zk-prove-worker] job=${job.id} market=${job.market_id.slice(-8)} proving started (~4min)...`);
    let summary, receiptHex;
    try {
      ({ summary, receiptHex } = await spawnCargoProve(inputPath, outputBase));
    } catch (e) { _fail(job, `RISC0 proving fail: ${e.message}`); return { ok: false }; }

    // verify-value-source: 独立重算 journalHash, 不只信 rust 侧吐的 journal_digest(NWT 认可这条是本方案自己想到的)。
    const recomputedJournalHash = computeJournalHash(summary.bets_root_hex, summary.payout_root_hex, summary.attested_winner);
    if (recomputedJournalHash !== summary.journal_digest) {
      _fail(job, `journalHash 交叉核对不一致: recomputed=${recomputedJournalHash} rust侧=${summary.journal_digest} — 拒绝往下铸 gate`);
      return { ok: false };
    }
    if (betsRootHex && summary.bets_root_hex !== betsRootHex) {
      _fail(job, `guest 算出的 bets_root(${summary.bets_root_hex}) != enqueue 时的 betsRootHex(${betsRootHex}) — 输入数据不一致, 拒绝`);
      return { ok: false };
    }

    let gate;
    try {
      gate = await buildAndFundGate(summary.image_id, summary.journal_digest, receiptHex, SETTLER_RELAY_ID);
    } catch (e) { _fail(job, `gate 铸造/注资 fail: ${e.message}`); return { ok: false }; }

    updateProvingReady(job.market_id, {
      guestPayoutRootHex: summary.payout_root_hex, journalHash: recomputedJournalHash, imageId: summary.image_id,
      gate: { address: gate.gateAddr, outpointTxid: gate.outpointTxid, index: gate.index, fundedAtMs: gate.fundedAtMs },
    });
    sqlite.prepare("UPDATE zk_prove_jobs SET status = 'done', receipt_hex = ?, journal_digest_hex = ?, updated_at = datetime('now') WHERE id = ?")
      .run(receiptHex, recomputedJournalHash, job.id);
    console.log(`[zk-prove-worker] ✅ job=${job.id} market=${job.market_id.slice(-8)} proving.status=ready gate=${gate.gateAddr.slice(0, 20)}`);
    return { ok: true, jobId: job.id, marketId: job.market_id };
  } finally { running = false; }
}

function _fail(job, reason) {
  console.error(`[zk-prove-worker] ❌ job=${job.id} market=${job.market_id.slice(-8)}: ${reason}`);
  sqlite.prepare("UPDATE zk_prove_jobs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?").run(reason, job.id);
  try { updateProvingFailed(job.market_id, reason); } catch (e) { console.error(`[zk-prove-worker] updateProvingFailed also failed: ${e.message}`); }
  try {
    sqlite.prepare(`INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', 'zk_prove_worker_fail', 'zk-prove-worker', 'error', ?, ?, datetime('now'))`)
      .run(randomUUID(), `zk-prove-worker job=${job.id} market=${job.market_id} failed: ${reason}`, JSON.stringify({ jobId: job.id, marketId: job.market_id, reason }));
  } catch (e) { console.error(`[zk-prove-worker] events insert fail (non-fatal): ${e.message}`); }
}
