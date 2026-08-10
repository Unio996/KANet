#!/usr/bin/env node
/**
 * payout_ps_addr 一次性回填(§2 of docs/2026-08-09-zk-settle-writer-fix-design-v0.1.md)
 *
 * 背景: payout_ps_addr 是 write-once 陈列, 而 consolidation/close 一路 splice redeem 却漏刷它
 * ⇒ K-18 §3.3 coherence gate step(d) 拿当前 redeem 比 genesis addr ⇒ 必不等 ⇒ 拦住结算。
 * 写方已修(唯一入口 payout-shard-persist.mjs) —— 那只防【未来】漂移; **存量漂移要靠本脚本**。
 *
 * 🔴 方向性硬约束(设计 §2.2, 不能反): 只准把 addr 改成 p2sh(redeem), **绝不准**改 redeem 去迁就 addr。
 *    链上真金就在 p2sh(redeem) 派生的地址上(2026-08-09 两个独立源各自复算: 60,473.9 / 60,474.1,
 *    且 genesis 地址余额全为 0)⇒ redeem 是链上真相, addr 是落后的那个。
 *    反过来改 redeem = 把一份已落链的权威字节改坏 = 伪造。
 *
 * 🔴 默认 dry-run。写入要显式 PS_ADDR_BACKFILL_CONFIRMED=1。
 *
 * 用法:
 *   node scripts/backfill-payout-ps-addr.mjs                       # dry-run, 零写入
 *   PS_ADDR_BACKFILL_CONFIRMED=1 node scripts/backfill-payout-ps-addr.mjs
 * 环境:
 *   PS_ADDR_BACKFILL_DB     console.db 绝对路径(必填, 不猜)
 *   KASPA_NETWORK           默认 testnet-12
 *   KASPA_RPC_URL           默认 ws://127.0.0.1:17210
 *   PS_ADDR_BACKFILL_NO_CHAIN=1   跳过链上确认 ⇒ 🔴 只允许离线自测, 与真实回填互斥(见下)
 *   PS_ADDR_BACKFILL_ONLY=<完整 logical_market_id>
 *                           canary: 本次只处理这一个盘。**精确匹配, 不支持后缀。**
 *                           匹配 0 行 ⇒ 大声报错 exit(既不跑全量也不静默跑空)。
 *                           枚举与计数始终是全量 —— 见下方过滤器处的注释, 那个位置是承重的。
 *   PS_ADDR_BACKFILL_ALL=1  🔴 显式 opt-in 才允许【写入】多于一个盘。
 *                           CONFIRMED=1 而 ONLY 与 ALL 都没设 ⇒ **拒跑**(不是静默跑全量)。
 *                           理由见下方那道闸的注释: 默认值出错时不报错, 所以默认不许是"全量"。
 *
 * 🔴 写入侧的组合只有两种合法形态:
 *     canary : PS_ADDR_BACKFILL_ONLY=<完整 id>  PS_ADDR_BACKFILL_CONFIRMED=1
 *     全量   : PS_ADDR_BACKFILL_ALL=1           PS_ADDR_BACKFILL_CONFIRMED=1
 *   两者同时设 = 意图矛盾 ⇒ 拒跑。dry-run(不设 CONFIRMED)不受这道闸影响, 照旧全量出报告。
 */
import fsx from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { assertPayoutShardCoherence } from '../kasia-console/src/lib/bshard-payout-family-coherence.mjs';
import { verifyRedeemMatchesChainObservedOutput } from '../kasia-console/src/lib/pool-shard-settle.mjs';

const NETWORK = process.env.KASPA_NETWORK || 'testnet-12';
const RPC_URL = process.env.KASPA_RPC_URL || 'ws://127.0.0.1:17210';
const CONFIRMED = process.env.PS_ADDR_BACKFILL_CONFIRMED === '1';
const NO_CHAIN = process.env.PS_ADDR_BACKFILL_NO_CHAIN === '1';
// canary 过滤器 (Bettor 2026-08-09 14:01 派工 A, NWT 审): 只处理一个 logical_market_id。
// 🔴 只接受【完整 id 精确匹配】—— 不做后缀/模糊匹配。理由: 后缀若意外命中两个盘, 就会回填一个
//    没打算动的市场, 而 canary 存在的全部意义正是"这一跑只碰这一个"。宁可让操作者多贴一次全 id。
const ONLY = process.env.PS_ADDR_BACKFILL_ONLY || null;
// 全量 opt-in (Bettor 2026-08-09 15:46 荐加, NWT 审): 见下方那道 fail-closed 闸。
const ALL = process.env.PS_ADDR_BACKFILL_ALL === '1';

// 🔴🔴 fail-closed 默认: 【写入】时"处理多于一个盘"必须显式 opt-in。
//  为什么它比"起跑前 grep 一下过滤器还在不在"强(那是 J2 原来的建议, 已被这条取代):
//    grep 是 runbook 的一步 —— **会被忘**, 而忘了不报错。这条是代码里的不变量 —— 忘不了。
//  🔴 它盖的【只有一个】失效模式, 别读大(Bettor + NWT 2026-08-09 15:51 同时指出我原注释自指):
//    ✅ 盖: **过滤器在场, 但 ONLY 忘了设 / 变量名拼错** ⇒ CONFIRMED=1 拒跑, 不静默回填全部 13
//         (含占 ~93% 金额的 9jaty)。
//    🔴 【盖不了】: 过滤器整段被 revert / stash / 或有人在没有这段代码的旧检出上跑 ——
//         **因为这道 guard 自己就在那段代码里**: 它没了, guard 也没了, 脚本回到"默认全量"。
//         那一格由**另外两件**盖, 不由本 guard 盖:
//           · `git commit`(本文件已提交 ⇒ 工作树里被挪走也能恢复出带过滤器的版本)
//           · 起跑前 `grep -c PS_ADDR_BACKFILL_ONLY <本文件>` 非 0 才开跑
//             (它查的是【起跑那一刻的实际文件】, 与在哪个检出上无关 ⇒ 正好补 commit 的盲区)
//  🔵 只管写入侧: dry-run(不设 CONFIRMED)照旧全量出报告 —— 那正是我们判断分集用的东西。
if (CONFIRMED && !ONLY && !ALL) {
  console.error('🔴 拒绝: CONFIRMED=1 但既没有 PS_ADDR_BACKFILL_ONLY=<完整 market id>, 也没有 PS_ADDR_BACKFILL_ALL=1。');
  console.error('   "回填全部 divergent 盘"必须【显式 opt-in】—— 它不是默认行为, 因为默认值出错时不报错。');
  console.error('   · canary(推荐): PS_ADDR_BACKFILL_ONLY=<完整 id> PS_ADDR_BACKFILL_CONFIRMED=1 …');
  console.error('   · 全量:          PS_ADDR_BACKFILL_ALL=1      PS_ADDR_BACKFILL_CONFIRMED=1 …');
  process.exit(2);
}
// 两个一起设 = 意图矛盾(既说"只这一个"又说"全部")。不猜哪个优先, 停下让人说清。
if (ONLY && ALL) {
  console.error('🔴 拒绝: PS_ADDR_BACKFILL_ONLY 与 PS_ADDR_BACKFILL_ALL 同时设置 —— 意图矛盾, 不替你选。');
  process.exit(2);
}

// 🔴 fail-closed: 生产回填【必须】过链上确认。跳过探链只为离线自测存在, 所以它与写入互斥 ——
// 否则这个开关本身就成了"绕过安全核心、把 gate 的真报警消音"的那条路, 而 §2.4 正是要堵它。
if (CONFIRMED && NO_CHAIN) {
  console.error('🔴 拒绝: PS_ADDR_BACKFILL_NO_CHAIN=1 与真实回填互斥 —— 链上确认是本回填的安全核心, 不是可选项。');
  process.exit(2);
}

const DB_PATH = process.env.PS_ADDR_BACKFILL_DB;
if (!DB_PATH) { console.error('🔴 需要 PS_ADDR_BACKFILL_DB=<console.db 绝对路径> — 不猜路径。'); process.exit(2); }
if (!fsx.existsSync(DB_PATH)) { console.error('🔴 DB 不存在: ' + DB_PATH); process.exit(2); }

const require = createRequire(import.meta.url);
// 内置 node:sqlite 而非 better-sqlite3: scripts/ 下新增裸依赖会撞 M0a gate 的 R-M0A-BARE-IMPORT-DIFF,
// 且运维脚本不该为一次只读枚举拖进 kasia-console 的 node_modules。API 面(prepare/get/all/run)一致。
const sqlite = new DatabaseSync(DB_PATH, { readOnly: !CONFIRMED });

// p2sh: 与 gate step(d) 同款算法 + 同网络。**不复制第二份实现** —— 回填算出的 addr 与 gate 算出的
// 必须逐字相同, 否则"回填完了 gate 还是不过"会变成一个查不出来的坑。
const CANDIDATES = [process.env.KASPA_WASM_PATH, 'kaspa-wasm',
  'D:/kanet/kanet/shared/vendor/kaspa-wasm', 'D:/kanet-tn12/shared/vendor/kaspa-wasm'].filter(Boolean);
let _k = null;
for (const c of CANDIDATES) { try { const m = require(c); if (m && m.ScriptBuilder) { _k = m; break; } } catch { /* 试下一个 */ } }
if (!_k) { console.error('🔴 kaspa-wasm 未解析到 — 设 KASPA_WASM_PATH。'); process.exit(2); }
const p2sh = (redeemHex) => _k.addressFromScriptPublicKey(
  _k.ScriptBuilder.fromScript(new Uint8Array(Buffer.from(redeemHex, 'hex'))).createPayToScriptHashScript(), NETWORK).toString();

// ---- §2.1 自己枚举 divergent, 不接受任何外部给的数字 ----
const rows = sqlite.prepare('SELECT * FROM payout_shards').all();
const divergent = [];
const unreadable = [];
for (const r of rows) {
  if (!r.payout_redeem_hex) { unreadable.push({ r, why: 'payout_redeem_hex 为空' }); continue; }
  let derived;
  try { derived = p2sh(r.payout_redeem_hex); }
  catch (e) { unreadable.push({ r, why: 'p2sh 失败: ' + e.message }); continue; }
  if (derived !== r.payout_ps_addr) divergent.push({ r, derived });
}
console.log(`[backfill] 全表 ${rows.length} 行 · divergent ${divergent.length} 行 · 无法判定 ${unreadable.length} 行 · network=${NETWORK}`);
// 🔴 无法判定的必须单独喊出来: 它们既不在"要修"里也不在"已好"里, 而沉默会让人把它们读成后者。
for (const u of unreadable) console.log(`   ⚠ 无法判定 ${String(u.r.logical_market_id).slice(-8)}: ${u.why}`);

// ---- canary 过滤器: 【必须在上面那行计数之后】────────────────────────────────────────────
// 🔴 位置是承重的, 不是风格问题: 前置②那道已商定的闸读的就是上面打印的 `divergent N 行`
//    (判据: "分集不再是 13/9/4 就停下报")。若把过滤器塞进 §2.1 的枚举里, 那个计数会跟着过滤
//    一起变小 ⇒ 闸永远"看起来对", 而它在 canary 那一跑里已经【自动失效且看不出来】。
//    ⇒ 枚举与报告始终是全量; 过滤只决定【这一跑动谁】。
const targets = ONLY ? divergent.filter(({ r }) => r.logical_market_id === ONLY) : divergent;
if (ONLY) {
  if (targets.length === 0) {
    // 🔴 fail-loud: 设了过滤却一个都没匹配 = 操作者的意图没有被执行。这时【既不能跑全量】
    //    (那是最坏况: 想跑 1 个结果跑了 13 个), 也不能静默跑空(那会被读成"没什么要修的")。
    console.error(`🔴 PS_ADDR_BACKFILL_ONLY='${ONLY}' 匹配 0 行 divergent ⇒ 中止, 不回填任何东西。`);
    console.error(`   注意: 只接受【完整 logical_market_id 精确匹配】, 不支持后缀。当前 divergent 的完整 id:`);
    for (const { r } of divergent) console.error(`     ${r.logical_market_id}`);
    process.exit(2);
  }
  if (targets.length > 1) {
    // 结构上到不了(id 是主键式唯一), 但若哪天成立, "canary 只碰一个"就已经不成立了 ⇒ 宁可停。
    console.error(`🔴 PS_ADDR_BACKFILL_ONLY='${ONLY}' 匹配到 ${targets.length} 行 ⇒ 中止(canary 必须恰好一个)。`);
    process.exit(2);
  }
  console.log(`[backfill] 🎯 canary 模式: 只处理 ${ONLY} —— 其余 ${divergent.length - 1} 行本次【不碰】`);
}

// ---- getUtxos: 直连本机节点的只读查询 ----
// 设计稿写的是"经 relay(Console 不碰链)"。本脚本不是 Console 请求路径, 也没有 relay 会话上下文, 而
// bshard-settle-daemon.mjs:77-83 这个生产结算组件本身就是直连 RPC 取 utxo。⇒ 沿用同款, 且只读。
// 这一条我显式标出来供复核反对, 不埋在实现里。
let _rpc = null;
async function getUtxos(addr) {
  if (!_rpc) {
    _rpc = new _k.RpcClient({ url: RPC_URL, encoding: _k.Encoding.Borsh, networkId: NETWORK });
    await _rpc.connect({});
  }
  const { entries } = await _rpc.getUtxosByAddresses([new _k.Address(addr)]);
  return entries || [];
}

function logEvent(type, marketId, payload) {
  if (!CONFIRMED) return;   // dry-run 不写任何东西, 事件也不写
  try {
    sqlite.prepare(`INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', ?, 'backfill-payout-ps-addr', ?, ?, ?, datetime('now'))`)
      .run(randomUUID(), type, type.includes('skipped') || type.includes('still_failing') ? 'error' : 'info',
        `${type} market=${String(marketId).slice(-8)}`, JSON.stringify(payload));
  } catch (e) { console.error('   events 落账失败(non-fatal): ' + e.message); }
}

/**
 * 🔴 严格解析 payout_ps_outpoint(Codex RED / MUST-FIX, 2026-08-09) —— 这条是我自己写进去的洞。
 *
 * 原实现: `const idx = Number(parts[1]); ... Number.isFinite(idx) ? idx : 0`
 * ⇒ 畸形 outpoint 【全部静默变成 output 0】:
 *     'txid'      ⇒ parts[1]=undefined ⇒ NaN ⇒ 回落 0
 *     'txid:'     ⇒ Number('')===0     ⇒ 【看起来合法】的 0
 *     'txid:foo'  ⇒ NaN ⇒ 回落 0        'txid:-1' / 'txid:1.5' ⇒ 原样通过
 * 🔴 危险链: 畸形 ⇒ 被替换成 index 0 ⇒ 若该 txid 的 output0 恰好 == p2sh(当前 redeem)
 *    ⇒ verifier 对着【一个我没在核的 outpoint】给出确认 ⇒ 回填在假权威上写 addr
 *    ⇒ **这正是 §2.4 存在的理由本身: 用改数据把 gate 的真报警消音。**
 * 🔵 当前暴露面 = 0(@J2 实测 722 行全良构), 但写侧 schema 是裸 TEXT 无 CHECK, 而回填是单向写
 *    ⇒ 零暴露不降低必修性。
 *
 * 纪律: **绝不默认 0**。判不了就判不了, 单列、不探链、不写。
 */
const MAX_OUTPUT_INDEX = 65535;   // 理智上界; 越界一律拒, 不猜
function parseOutpoint(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, reason: '为空或非字符串' };
  if (raw !== raw.trim()) return { ok: false, reason: '首尾有空白' };
  const parts = raw.split(':');
  if (parts.length < 2) return { ok: false, reason: '缺少分隔符(没有 index)' };
  if (parts.length > 2) return { ok: false, reason: `分隔符过多(${parts.length - 1} 个)` };
  const [txid, idxStr] = parts;
  if (!/^[0-9a-fA-F]{64}$/.test(txid)) return { ok: false, reason: 'txid 不是 64 位十六进制' };
  // 只接受无前导零的非负十进制整数: 挡掉 '' / '-1' / '1.5' / '1e0' / ' 1' / '01'
  if (!/^(0|[1-9][0-9]*)$/.test(idxStr)) return { ok: false, reason: `index 非法('${idxStr}')` };
  const index = Number(idxStr);
  if (!Number.isSafeInteger(index) || index > MAX_OUTPUT_INDEX) return { ok: false, reason: `index 越界(${idxStr})` };
  return { ok: true, txid: txid.toLowerCase(), index };
}

const report = [];
const malformed = [];
for (const { r, derived } of targets) {
  const marketId = r.logical_market_id;
  const parsed = parseOutpoint(r.payout_ps_outpoint);
  if (!parsed.ok) {
    // fail-closed 且【不探链】: 连"要核哪个 outpoint"都不知道时, 任何链上确认都是在核别的东西。
    console.log(`   🔴 MALFORMED ${String(marketId).slice(-8)} — payout_ps_outpoint ${parsed.reason} ⇒ 不探链、不回填、DB 逐字节不动`);
    malformed.push({ marketId, raw: r.payout_ps_outpoint, reason: parsed.reason });
    report.push({ marketId, family: r.covenant_family, oldAddr: r.payout_ps_addr, derived, chainOk: 'malformed' });
    if (CONFIRMED) logEvent('payout_ps_addr_backfill_skipped', marketId, { marketId, reason: 'malformed_outpoint', detail: parsed.reason, raw: r.payout_ps_outpoint });
    continue;
  }
  const txid = parsed.txid;
  const idx = parsed.index;
  let chainOk = null;   // null = 未探(仅离线自测); true/false = 探过
  if (!NO_CHAIN) {
    // §2.4: 复用既有原语, 不新写探链逻辑。命中 = 链上真金确实在 p2sh(redeem) 派生的地址上。
    try {
      chainOk = await verifyRedeemMatchesChainObservedOutput({
        db: sqlite, p2sh, candidateRedeemHex: r.payout_redeem_hex,
        // idx 已过严格解析 —— 这里【不再】有任何回落默认值。喂给 verifier 的就是库里那个精确 outpoint。
        outpointTxid: txid, outpointIdx: idx, getUtxos,
      });
    } catch (e) { chainOk = false; console.log(`   ⚠ ${String(marketId).slice(-8)} 链上确认异常(按未命中处理): ${e.message}`); }
  }
  report.push({ marketId, family: r.covenant_family, oldAddr: r.payout_ps_addr, derived, chainOk });

  if (!CONFIRMED) continue;
  if (chainOk !== true) {
    // fail-closed: 链上没替我们背书 redeem 权威 ⇒ 不改, 不猜。
    // 盲改会把 addr 对齐到一份可能是坏的 redeem —— 那等于【用改数据把 gate 的真报警消音】。
    console.log(`   ⏭ SKIP ${String(marketId).slice(-8)} — chain_unconfirmed, 不回填(交人工)`);
    logEvent('payout_ps_addr_backfill_skipped', marketId, { marketId, reason: 'chain_unconfirmed', derived, oldAddr: r.payout_ps_addr });
    continue;
  }
  // 乐观并发保护(§2.3): 把旧 addr 放进 WHERE —— 若这一刻写方刚好刷过它, 不命中、不误写。
  // 用 IS 而非 = : 旧值可能是 NULL, 而 `= NULL` 恒不命中, 会把这些行静默漏掉。
  const info = sqlite.prepare('UPDATE payout_shards SET payout_ps_addr = ? WHERE logical_market_id = ? AND payout_ps_addr IS ?')
    .run(derived, marketId, r.payout_ps_addr);
  if (info.changes !== 1) {
    console.log(`   ⏭ SKIP ${String(marketId).slice(-8)} — 乐观并发未命中(期间被别人改过), 不覆盖`);
    logEvent('payout_ps_addr_backfill_skipped', marketId, { marketId, reason: 'concurrent_modification', derived });
    continue;
  }
  // §2.5 逐盘: 直接调既有 gate 函数断言 —— 不复制判据。回填完 gate 仍不过 = 该盘还有别的不自洽。
  const after = sqlite.prepare('SELECT * FROM payout_shards WHERE logical_market_id = ?').get(marketId);
  const gate = assertPayoutShardCoherence(after, { p2sh, tier: 'full' });
  if (gate.ok) {
    console.log(`   ✅ ${String(marketId).slice(-8)} 回填并通过 gate`);
    logEvent('payout_ps_addr_backfilled', marketId, { marketId, derived, oldAddr: r.payout_ps_addr, provenance: 'chain_confirmed' });
  } else {
    console.log(`   🔴 ${String(marketId).slice(-8)} 回填后 gate 仍不过 (failedStep=${gate.failedStep}) — 记录, 不吞, 交人工`);
    logEvent('payout_ps_addr_backfill_gate_still_failing', marketId, { marketId, derived, failedStep: gate.failedStep, reason: gate.reason });
  }
}

console.log('\n' + (CONFIRMED ? '=== 回填结果 ===' : '=== DRY-RUN(零写入) ==='));
for (const x of report) {
  const chainWord = x.chainOk === 'malformed' ? '🔴outpoint畸形(未探)' : x.chainOk === null ? '未探' : x.chainOk ? '确认' : '未命中';
  console.log(`  ${String(x.marketId).slice(-8)}  family=${x.family}  chain=${chainWord}`);
  console.log(`      stored  : ${x.oldAddr}`);
  console.log(`      derived : ${x.derived}`);
}
if (malformed.length) {
  // 单列且醒目: 畸形行既不在"已回填"里也不在"链上未命中"里, 混在一起会让人以为它们只是差个确认。
  console.log(`
🔴 payout_ps_outpoint 畸形 ${malformed.length} 行 —— 这些【永远不会被本脚本回填】, 需人工判定:`);
  for (const m of malformed) console.log(`   ${String(m.marketId).slice(-8)}  ${m.reason}  raw=${JSON.stringify(m.raw)}`);
}
if (!CONFIRMED) {
  console.log(`\n⚠ 这是 dry-run: 上面 ${report.length} 行【一行都没写】。人工过完这份报告再设 PS_ADDR_BACKFILL_CONFIRMED=1。`);
} else {
  // §2.5 全局: 重跑枚举, 应为空(幂等 + 完备的双重确认)
  const left = sqlite.prepare('SELECT * FROM payout_shards').all()
    .filter((r) => { try { return r.payout_redeem_hex && p2sh(r.payout_redeem_hex) !== r.payout_ps_addr; } catch { return true; } });
  if (!ONLY) {
    console.log(`\n全局重枚举: 剩余 divergent = ${left.length} ` + (left.length ? '🔴 非空 — 有盘没被修好(见上面的 SKIP / gate 记录)' : '✅ 空'));
  } else {
    // 🔴 canary 下这道检查的【期望值变了】, 必须跟着改, 否则它每次都打红字。
    //    不改的话: 只跑 1 个盘 ⇒ left 必然剩 12 ⇒ "🔴 非空 — 有盘没被修好" ⇒ 一次成功的 canary
    //    会以一条读起来像失败的红字收尾。而"预期内的红"用不了几次就会被当成背景噪音。
    // 🔴 两个问题必须【分开数】, 不能压进同一个减法:
    //    「目标盘修好没有」与「有没有碰别人」是独立的两件事, 而 canary 被 SKIP 是【预期内的正常结果】
    //    (那 4 个 chain=未命中 的盘就该 SKIP)。若把 expected 写成 divergent−1, 就等于默认目标一定被修好
    //    ⇒ 一次【正确的 SKIP】会打出"这一跑动了不该动的盘"这种指控式假警报。
    //    (这个 bug 是阴性臂跑出来的 —— 阳性臂全绿, 只跑阳性会把它交出去。)
    const canaryLeft = left.some((r) => r.logical_market_id === ONLY);
    const restLeft = left.length - (canaryLeft ? 1 : 0);
    const expectedRest = divergent.length - 1;   // 其余 N−1 个本次没动 ⇒ 应原样还在
    console.log(`\ncanary 重枚举: 目标盘 ${canaryLeft
      ? '🔴 仍 divergent — 没修好(若上面是 chain_unconfirmed SKIP, 这是【预期内】, 不是故障)'
      : '✅ 已不再 divergent'}`);
    console.log(`               其余: 剩余 ${restLeft}, 预期 ${expectedRest} ` +
      (restLeft === expectedRest ? '✅ 相符(未碰其他盘)' : '🔴 不符 — 这一跑动了不该动的盘, 或期间有别人在写'));
  }
}
if (_rpc) { try { await _rpc.disconnect(); } catch { /* 关连接失败不影响已完成的回填 */ } }
sqlite.close();
