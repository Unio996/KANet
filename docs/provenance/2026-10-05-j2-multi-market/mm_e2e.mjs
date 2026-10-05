// mm_e2e.mjs — 账本1855 simnet 验收: 现成 pool-market-seeder(Polymarket gamma 镜像 → create-v07, 不收 KAS 模式)同时养 3 个 ZK 原生盘;
// 2 个下注人(stake_ktt, 零转账)在 3 个盘上各下一对(A=方向0 1e9, B=方向1 2e9); 3 个盘一起走 7 个自治 tick 直到最后一个 claim。
// 并发保险: 在第一个盘进入 collecting_sigs(close 提交费 UTXO 已创建、尚未花)时, 从 settler relay 发一笔"干扰转账"(0.29 KAS 自转, 恰好让 relay 选币器
// 的"最小够用 UTXO"落在 0.5 KAS 的 close 费 UTXO 上 —— 即 S3 btduw 的机制)。pos: pin 开 ⇒ 3 盘全部走完; neg(ZK_FEE_PINS_DISABLED=1): 复现卡死的 close。
// 用法: node mm_e2e.mjs <pos|neg>   (需: simnet kaspad + 矿工 + mm_stubs.mjs + mm console(start_console_mm.sh <tag>) 已起)
import { readFileSync, writeFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { http, relays, kaspa, rpcConnect, sleep, log, daa, cmd } from '../2026-10-05-j2-strict-zero/szlib.mjs';

const TAG = process.argv[2] || 'pos'; const NEG = TAG === 'neg';
const OUT = 'D:/kanet-tn12/scratch/_j2_mm';
const CONSOLE_LOG = `${OUT}/console.${TAG}.log`;
const WT = 'D:/kanet-tn12/scratch/_j2_wt_mm';
const Db = createRequire('D:/kanet-tn12/kasia-console/')('better-sqlite3');
const db = new Db(`${OUT}/console.mm.${TAG}.db`, { readonly: true });
const results = { tag: TAG, startedAt: new Date().toISOString(), asserts: [], txs: [], notes: [], markets: {} };
let fails = 0;
const ok = (c, l) => { results.asserts.push({ ok: !!c, label: l }); if (c) log('  ✅', l); else { log('  ❌', l); fails++; } };
const dump = () => writeFileSync(`${OUT}/mm_e2e_result.${TAG}.json`, JSON.stringify(results, (k, v) => typeof v === 'bigint' ? String(v) : v, 1));
const rpc = await rpcConnect();
const W = { maker: relays.maker, settler: relays.settler, fee: relays.fee, bettorA: relays.bettorA, bettorB: relays.bettorB };
const addrToName = Object.fromEntries(Object.entries(W).map(([n, r]) => [r.address, n]));
const bal = async (n) => BigInt((await rpc.getBalanceByAddress({ address: W[n].address })).balance);
const snapBal = async () => Object.fromEntries(await Promise.all(Object.keys(W).map(async (n) => [n, await bal(n)])));
const snapUtxos = async () => { const m = new Map(); for (const [n, r] of Object.entries(W)) { const { entries } = await rpc.getUtxosByAddresses([new kaspa.Address(r.address)]); for (const e of entries) m.set(`${e.outpoint.transactionId}:${e.outpoint.index}`, { value: BigInt(e.amount), addr: r.address }); } return m; };
const marketRows = () => db.prepare("SELECT id, protocol_status, outcome_condition_id, outcome_market_source, broker_relay_id, spine_p2sh, resolution_rule_spec, metadata, created_at FROM pool_markets").all();
const unfinished = () => { const done = new Set(['completed', 'refunded', 'cancelled', 'expired', 'shard_internal']); return marketRows().filter((m) => { if (done.has(m.protocol_status)) return false; try { if (JSON.parse(m.resolution_rule_spec).zk_native !== true) return false; } catch { return false; } let ex = false; try { ex = JSON.parse(m.metadata || '{}')?.zk_continuation?.exhausted === true; } catch {} return !ex; }); };

// ── 0. 前置: 钱包静默快照 + 库里没有未完结的 zk 盘 ──
let utxos0, startHash;
for (let t = 0; t < 30; t++) {
  const a = await snapUtxos(); const info0 = await rpc.getBlockDagInfo(); const b = await snapUtxos();
  const same = a.size === b.size && [...a].every(([k, v]) => b.has(k) && b.get(k).value === v.value);
  if (same) { utxos0 = b; startHash = info0.sink; break; }
  await sleep(4000);
}
if (!utxos0) throw new Error('钱包 UTXO 一直在变, 拒绝开始');
results.startHash = startHash;
const bal0 = Object.fromEntries(Object.keys(W).map((n) => [n, [...utxos0.values()].filter((u) => u.addr === W[n].address).reduce((x, u) => x + u.value, 0n)]));
results.bal0 = Object.fromEntries(Object.entries(bal0).map(([k, v]) => [k, String(v)]));
log('balances before (KAS):', Object.fromEntries(Object.entries(bal0).map(([k, v]) => [k, Number(v) / 1e8])));
const logOffset0 = statSync(CONSOLE_LOG).size;
const preIds = new Set(marketRows().map((m) => m.id));
ok(unfinished().length === 0, '前置: 库里没有未完结的 zk_native 盘(live=0)');

// ── 1. 放种子器: arm gamma 桩 ⇒ 现成 pool-market-seeder 自己建盘(目标 3, 每 tick 1 个) ──
const tArm = Date.now();
await fetch('http://127.0.0.1:3399/arm', { method: 'POST' });
log('gamma stub armed; waiting for seeder to create 3 markets (cap ZK_MAX_LIVE_MARKETS=3)…');
let created = []; let maxLive = 0;
while (Date.now() - tArm < 10 * 60_000) {
  created = marketRows().filter((m) => !preIds.has(m.id)).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  maxLive = Math.max(maxLive, unfinished().length);
  if (created.length >= 3) break;
  await sleep(3000);
}
ok(created.length === 3, `种子器建出 3 个盘(${created.length}, 用时 ${Math.round((Date.now() - tArm) / 1000)}s)`);
if (created.length < 3) { dump(); process.exit(2); }
ok(maxLive >= 3, `同时在跑(未完结)的 ZK 原生盘峰值 = ${maxLive}(≥3)`);
for (const m of created) {
  const spec = JSON.parse(m.resolution_rule_spec);
  ok(spec.zk_native === true && m.spine_p2sh == null && m.outcome_market_source === 'polymarket' && /^0x[0-9a-f]{64}$/.test(m.outcome_condition_id || '') && m.broker_relay_id === W.maker.id,
    `盘 ${m.id.slice(-8)}: zk_native=true, 无 spine, polymarket 镜像(cond ${String(m.outcome_condition_id).slice(0, 10)}…), broker 塌到 maker(未配 GATEWAY_RELAY_ID)`);
  results.markets[m.id] = { short: m.id.slice(-8), cond: m.outcome_condition_id, createdAt: m.created_at };
}
const balAfterCreate = await snapBal();
ok(balAfterCreate.maker === bal0.maker && balAfterCreate.bettorA === bal0.bettorA && balAfterCreate.bettorB === bal0.bettorB, '建 3 个盘后: maker/下注人钱包余额逐 sompi 不变(建盘不转账)');
// 上限: 已 3/3 ⇒ API 再建 ⇒ 409 live_market_cap_reached
{ const g = await http('POST', '/api/pool/market/create-v07', { maker_relay_id: W.maker.id, outcome_side: 'YES', outcome_end_date: new Date(Date.now() + 3_600_000).toISOString(), resolution_rule_spec: JSON.stringify({ title: 'cap probe', resolution_criteria: 'x', data_source_canonical: 'kaspa-simnet:blockhash_parity@1', judge_type: 'blockhash_parity' }), pool_merkle_root: 'auto' });
  ok(g.status === 409 && g.code === 'live_market_cap_reached' && g.live === 3 && g.cap === 3, `3/3 在跑时再 create-v07 ⇒ 409 live_market_cap_reached(live=${g.live}, cap=${g.cap})`); }

// ── 2. 两个下注人在 3 个盘上各下一对(stake_ktt, 零转账) ──
const bets = [['bettorA', 0, 1_000_000_000], ['bettorB', 1, 2_000_000_000]];
results.bets = [];
for (const m of created) for (const [who, dir, units] of bets) {
  const t0 = Date.now();
  const r = await http('POST', `/api/pool/market/${m.id}/bettor/register-v07`, { bettor_relay_id: W[who].id, direction: dir, stake_ktt: units });
  log(m.id.slice(-8), who, `dir=${dir} stake_ktt=${units} (${Date.now() - t0}ms) =>`, JSON.stringify(r).slice(0, 220));
  results.bets.push({ market: m.id, who, dir, units, status: r.status, ms: Date.now() - t0, ok: r.ok === true });
  ok(r.ok === true && r.no_kas_stake === true, `${m.id.slice(-8)} ${who} register-v07 stake_ktt=${units} ⇒ 200 no_kas_stake`);
  ok((await bal(who)) === bal0[who], `${m.id.slice(-8)} ${who} 钱包余额逐 sompi 不变`);
  if (!r.ok) { dump(); process.exit(3); }
}

// ── 3. 等 3 个盘走完自治 tick; 第一个盘进 collecting_sigs 时注入干扰转账 ──
const readNew = () => { const size = statSync(CONSOLE_LOG).size; const fd = openSync(CONSOLE_LOG, 'r'); const buf = Buffer.alloc(size - logOffset0); readSync(fd, buf, 0, buf.length, logOffset0); closeSync(fd); return buf.toString('utf8'); };
const shorts = created.map((m) => m.id.slice(-8));
const claimRe = (s) => new RegExp(`market=\\S*${s} claim idx=(\\d+) pk=([0-9a-f]+) payout=(\\d+) txId=([0-9a-f]{64})( \\(last, exhausted\\))?`, 'g');
let chaos = null; let text = ''; const t0w = Date.now(); let lastPrint = 0; let allDone = false; let stuckSince = null;
const HARD = (NEG ? 55 : 120) * 60_000;
while (Date.now() - t0w < HARD) {
  text = readNew();
  if (!chaos) {
    const collecting = marketRows().filter((m) => !preIds.has(m.id) && m.protocol_status === 'collecting_sigs' && /bshard_close_request_v2/.test(m.metadata || ''));
    if (collecting.length) {
      const fees = collecting.map((m) => { const f = JSON.parse(m.metadata).bshard_close_request_v2.closeInputs.fee; return { market: m.id.slice(-8), txid: f.outpointTxid, index: f.index }; });
      const { entries } = await rpc.getUtxosByAddresses([new kaspa.Address(W.settler.address)]);
      const near = entries.map((e) => BigInt(e.amount)).filter((v) => v >= 40_000_000n && v <= 60_000_000n).sort((a, b) => (a < b ? -1 : 1)).map(String);
      const r = await cmd('settler', { type: 'transfer', target: W.settler.address, amount: 0.29 });
      chaos = { atMs: Date.now() - t0w, collecting: collecting.map((m) => m.id.slice(-8)), feeOutpoints: fees, settlerUtxosNear0_5KAS: near, resp: r, txId: r.txId || r.tx_id || null };
      // neg 模式: 同一 relay 上可能还有别的 0.5 KAS UTXO 先被"最小够用"选中——连续干扰(≤8 笔)直到 close 费 UTXO 被吃掉或次数用尽, 才算复现(pos 模式只打一笔: 有 pin 就该完好)
      if (NEG) { chaos.rounds = [{ txId: chaos.txId }]; for (let i = 0; i < 8; i++) {
        await sleep(6000);
        const { entries: e2 } = await rpc.getUtxosByAddresses([new kaspa.Address(W.settler.address)]); const have = new Set(e2.map((e) => `${e.outpoint.transactionId}:${e.outpoint.index}`));
        const eaten = fees.filter((f) => !have.has(`${f.txid}:${f.index}`)); if (eaten.length) { chaos.feeEaten = eaten; break; }
        const rr = await cmd('settler', { type: 'transfer', target: W.settler.address, amount: 0.29 }); chaos.rounds.push({ txId: rr.txId || null, resp: rr.ok === false ? rr : undefined });
      } }
      results.chaos = chaos; log('CHAOS transfer injected while', chaos.collecting.join(','), 'collecting_sigs =>', JSON.stringify(r).slice(0, 200), 'fee outpoints', JSON.stringify(fees));
    }
  }
  const per = shorts.map((s) => ({ s, claims: [...text.matchAll(claimRe(s))] }));
  const exhausted = per.filter((p) => p.claims.some((m) => m[5])).length;
  if (NEG) {
    const stuck = shorts.filter((s) => marketRows().find((m) => m.id.endsWith(s))?.protocol_status === 'collecting_sigs' && (text.match(new RegExp(`market=${s} submit fail`, 'g')) || []).length >= 2);
    if (stuck.length && stuckSince === null) stuckSince = Date.now();
    if (stuckSince !== null && (Date.now() - stuckSince > 8 * 60_000 || exhausted + stuck.length >= 3 && Date.now() - stuckSince > 3 * 60_000)) { results.stuck = stuck; break; }
  } else if (exhausted === 3) { allDone = true; break; }
  if (Date.now() - lastPrint > 120_000) {
    lastPrint = Date.now();
    log(`waiting… ${Math.round((Date.now() - t0w) / 1000)}s daa=${await daa(rpc)} claims/market=${per.map((p) => p.claims.length).join('/')} exhausted=${exhausted} status=${shorts.map((s) => marketRows().find((m) => m.id.endsWith(s))?.protocol_status).join(',')}`);
  }
  await sleep(4000);
}
writeFileSync(`${OUT}/mm_console_slice.${TAG}.log`, text);
results.consoleLines = text.split('\n').filter((l) => shorts.some((s) => l.includes(s)) || /fee-pins|PIN_UTXO|UNPIN_UTXO|pool-seeder/.test(l)).slice(-400);
ok(chaos && chaos.txId, `干扰转账已上链提交(txid ${chaos?.txId})`);
const pinLines = text.split('\n').filter((l) => /\bPIN_UTXO\b/.test(l) && !/UNPIN/.test(l));
const unpinLines = text.split('\n').filter((l) => /\bUNPIN_UTXO\b/.test(l));
results.pinLineCount = pinLines.length; results.unpinLineCount = unpinLines.length;
if (NEG) {
  ok(pinLines.length === 0, `neg: pin 关闭 ⇒ relay 日志里没有 PIN_UTXO 行(${pinLines.length})`);
  const stuck = results.stuck || [];
  ok(stuck.length >= 1, `neg: 复现卡死的 close — 盘 ${stuck.join(',') || '(无)'} 停在 collecting_sigs 且 submit 反复失败`);
  const failLines = text.split('\n').filter((l) => /submit fail|UTXO not found|not found|missing/i.test(l) && shorts.some((s) => l.includes(s))).slice(0, 6);
  results.stuckEvidence = failLines; failLines.forEach((l) => log('  ·', l.slice(0, 260)));
  results.finishedAt = new Date().toISOString(); results.failures = fails; dump(); log(fails ? `\n${fails} FAIL` : '\nALL PASS(neg: 卡死已复现)'); process.exit(fails ? 1 : 0);
}
ok(allDone, `3 个盘全部走到最后一个 claim(exhausted)(${Math.round((Date.now() - t0w) / 1000)}s)`);
ok(pinLines.length >= 3 && unpinLines.length >= 3, `pin 证据: relay 日志 PIN_UTXO ${pinLines.length} 行 / UNPIN_UTXO ${unpinLines.length} 行(≥3 / ≥3: 每盘 close 费钉住 + 落链后解钉)`);
if (!allDone) { dump(); process.exit(4); }
await sleep(15000);

// ── 4. 钱包余额 + 链上逐笔归类(同严格零 e2e) ──
const bal1 = await snapBal();
results.bal1 = Object.fromEntries(Object.entries(bal1).map(([k, v]) => [k, String(v)]));
ok(bal1.bettorA === bal0.bettorA, `A. bettorA 余额逐 sompi 相同(${bal0.bettorA} → ${bal1.bettorA})`);
ok(bal1.bettorB === bal0.bettorB, `A. bettorB 余额逐 sompi 相同(${bal0.bettorB} → ${bal1.bettorB})`);
const accepted = new Set();
{ let startFrom = startHash;
  for (let i = 0; i < 400; i++) {
    const r = await rpc.getVirtualChainFromBlock({ startHash: startFrom, includeAcceptedTransactionIds: true });
    for (const a of r.acceptedTransactionIds || []) for (const t of a.acceptedTransactionIds || []) accepted.add(t);
    const added = r.addedChainBlockHashes || []; if (!added.length) break; startFrom = added[added.length - 1]; if (added.length < 100) break;
  } }
const txById = new Map(); const outMap = new Map();
{ let low = startHash;
  for (let pages = 0; pages < 600; pages++) {
    const r = await rpc.getBlocks({ lowHash: low, includeBlocks: true, includeTransactions: true });
    const blocks = r.blocks || []; if (blocks.length < 2) break;
    for (const b of blocks) {
      for (const tx of b.transactions || []) {
        const id = tx.verboseData?.transactionId; if (!id || txById.has(id) || !accepted.has(id)) continue;
        txById.set(id, tx); tx.outputs.forEach((o, i) => outMap.set(`${id}:${i}`, { value: BigInt(o.value), addr: o.verboseData?.scriptPublicKeyAddress, cov: o.covenant?.covenantId ?? null }));
      }
      low = b.header.hash;
    }
  } }
log('scanned accepted txs in window:', txById.size, 'of accepted ids', accepted.size);
const spentBy = new Map(); for (const [id, tx] of txById) for (const inp of tx.inputs) spentBy.set(`${inp.previousOutpoint.transactionId}:${inp.previousOutpoint.index}`, id);
const lookup = (k) => outMap.get(k) ?? utxos0.get(k) ?? null;
const perWallet = Object.fromEntries(Object.keys(W).map((n) => [n, { fee: 0n, covLocked: 0n, covReleased: 0n, outOther: 0n, delta: 0n, txs: 0 }]));
let unknownInputs = 0; const touchedBettors = []; let chaosFee = 0n;
for (const [id, tx] of txById) {
  if (tx.inputs.length && /^0+$/.test(tx.inputs[0].previousOutpoint.transactionId)) continue;
  let inAll = 0n, inW = {}, inCov = 0n;
  for (const inp of tx.inputs) { const p = lookup(`${inp.previousOutpoint.transactionId}:${inp.previousOutpoint.index}`); if (!p) { unknownInputs++; continue; } inAll += p.value; const wn = addrToName[p.addr]; if (wn) inW[wn] = (inW[wn] || 0n) + p.value; else inCov += p.value; }
  let outAll = 0n, outW = {}, outCov = 0n, outOther = 0n;
  tx.outputs.forEach((o) => { const v = BigInt(o.value); outAll += v; const a = o.verboseData?.scriptPublicKeyAddress; const wn = addrToName[a]; if (wn) outW[wn] = (outW[wn] || 0n) + v; else if (a && a.startsWith('kaspasim:p')) outCov += v; else outOther += v; });
  const touching = new Set([...Object.keys(inW), ...Object.keys(outW)]); if (!touching.size) continue;
  const fee = inAll - outAll; const funders = Object.keys(inW);
  for (const wn of touching) { const p = perWallet[wn]; p.txs++; p.delta += (outW[wn] || 0n) - (inW[wn] || 0n); }
  const owner = funders.length === 1 ? funders[0] : (funders.length === 0 && touching.size === 1 ? [...touching][0] : null);
  if (!owner) results.notes.push(`tx ${id} 无法唯一归属(出资 ${funders.length}, 触碰 ${touching.size})`); else { const p = perWallet[owner]; p.fee += fee; p.covLocked += outCov; p.covReleased += inCov; p.outOther += outOther; }
  if (touching.has('bettorA') || touching.has('bettorB')) touchedBettors.push(id);
  if (id === chaos.txId) chaosFee = fee;
  results.txs.push({ txid: id, funders, owner, fee: String(fee), covIn: String(inCov), covOut: String(outCov), toWallets: Object.fromEntries(Object.entries(outW).map(([k, v]) => [k, String(v)])), toOther: String(outOther), nOut: tx.outputs.length });
}
ok(unknownInputs === 0, `B. 窗口内所有被接受交易的输入面值都能溯源(未知输入 ${unknownInputs})`);
ok(touchedBettors.length === 0, `A. 窗口内没有任何被接受的交易触碰下注人钱包(${touchedBettors.length})`);
let sysFee = 0n, sysLocked = 0n, sysDelta = 0n;
for (const wn of ['maker', 'settler', 'fee']) {
  const p = perWallet[wn]; const dBal = bal1[wn] - bal0[wn];
  ok(p.delta === dBal, `B. ${wn}: 逐笔重算 Δ(${p.delta}) == 余额差(${dBal}) sompi`);
  ok(p.delta === -(p.fee + p.covLocked - p.covReleased), `B. ${wn}: Δ == −(手续费 ${p.fee} + 净锁进 covenant ${p.covLocked - p.covReleased}) 逐 sompi 成立`);
  ok(p.outOther === 0n, `B. ${wn}: 落到第三方 P2PK 地址的输出 = ${p.outOther}(须为 0)`);
  sysFee += p.fee; sysLocked += p.covLocked - p.covReleased; sysDelta += dBal;
  results[`wallet_${wn}`] = { deltaSompi: String(dBal), feeSompi: String(p.fee), netCovLockedSompi: String(p.covLocked - p.covReleased), nTxs: p.txs };
}
ok(sysDelta === -(sysFee + sysLocked), `B. 系统钱包合计 Δ(${sysDelta}) == −(手续费 ${sysFee} + 净锁 covenant ${sysLocked})`);
let liveCov = 0n; for (const [k, o] of outMap) { if (!o.addr || !o.addr.startsWith('kaspasim:p') || spentBy.has(k)) continue; const rec = results.txs.find((t) => t.txid === k.split(':')[0]); if (rec) liveCov += o.value; }
results.cost = { totalFeesSompi: String(sysFee), chaosTxFeeSompi: String(chaosFee), netLockedSompi: String(sysLocked), liveCovenantSompi: String(liveCov), perMarketFeesSompi: String((sysFee - chaosFee) / 3n), perMarketNetLockedSompi: String(sysLocked / 3n), perMarketTotalSompi: String(((sysFee - chaosFee) + sysLocked) / 3n), markets: 3 };
log('per-market cost (fees + locked): fees', Number((sysFee - chaosFee) / 3n) / 1e8, 'KAS + locked', Number(sysLocked / 3n) / 1e8, 'KAS = ', Number(((sysFee - chaosFee) + sysLocked) / 3n) / 1e8, 'KAS (干扰转账费', Number(chaosFee) / 1e8, 'KAS 已剔除)');

// ── 5. C. 每个盘的 claim: KTT 地址重算 + 赢家(按桩: 偶数 cond ⇒ YES ⇒ bettorA; 奇数 ⇒ NO ⇒ bettorB)拿到的是 KTT ──
const envTxt = readFileSync(`${OUT}/env.mm.${TAG}.simnet`, 'utf8'); for (const l of envTxt.split('\n')) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) process.env[m[1]] = m[2]; }
process.env.DB_PATH = `${OUT}/_artifacts_probe.db`;
const imp = (p) => import(pathToFileURL(`${WT}/kasia-console/src/${p}`).href);
const { computeKttTokenArtifact, computeKanetTokenClaimArtifact } = await imp('lib/pool-bshard-artifacts.mjs');
const p2shAddr = (redeemHex) => kaspa.addressFromScriptPublicKey(kaspa.ScriptBuilder.fromScript(new Uint8Array(Buffer.from(redeemHex, 'hex'))).createPayToScriptHashScript(), 'simnet').toString();
const nameByPrefix = (pre) => Object.entries(W).map(([n, r]) => [n, r.xonly]).find(([, x]) => x.startsWith(pre));
const unspent = async (addr, txid, idx) => { const { entries } = await rpc.getUtxosByAddresses([new kaspa.Address(addr)]); return entries.some((e) => e.outpoint.transactionId === txid && Number(e.outpoint.index) === idx); };
for (const m of created) {
  const s = m.id.slice(-8); const claims = [...text.matchAll(claimRe(s))].map((x) => ({ idx: Number(x[1]), pkPrefix: x[2], payout: BigInt(x[3]), txid: x[4], last: !!x[5] }));
  const condIdx = parseInt(String(m.outcome_condition_id).slice(2, 4), 16); const winner = condIdx % 2 === 0 ? 'bettorA' : 'bettorB';
  let marketCov = null, total = 0n; const winnersSeen = new Set(); results.markets[m.id].claims = [];
  for (const c of claims) {
    const tx = txById.get(c.txid); if (!tx) { ok(false, `C. ${s} claim ${c.txid.slice(0, 12)} 窗口内找不到`); continue; }
    const covOuts = tx.outputs.map((o, i) => ({ i, cov: o.covenant?.covenantId ?? null, addr: o.verboseData?.scriptPublicKeyAddress }));
    const claimIdx = c.last ? 0 : 1, tokIdx = c.last ? 1 : 2; if (!c.last && !marketCov) marketCov = covOuts[0].cov;
    const who = nameByPrefix(c.pkPrefix); if (!who) { ok(false, `C. ${s} idx=${c.idx} pk=${c.pkPrefix} 非已知钱包`); continue; }
    if (!marketCov) { ok(false, `C. ${s} 取不到市场 covenant id`); continue; }
    const claimArt = computeKanetTokenClaimArtifact({ marketCovIdHex: marketCov, winnerPkHex: who[1], amount: c.payout, tokenTmplHashHex: process.env.ZK_TOKEN_TMPL_HASH });
    const ktt = computeKttTokenArtifact({ amount: Number(c.payout), ownerCovIdHex: covOuts[claimIdx].cov });
    const okAddr = covOuts[claimIdx].addr === p2shAddr(claimArt.script.toString('hex')) && covOuts[tokIdx].addr === p2shAddr(ktt.script.toString('hex'));
    const live = (await unspent(covOuts[claimIdx].addr, c.txid, claimIdx)) && (await unspent(covOuts[tokIdx].addr, c.txid, tokIdx));
    const toWallet = tx.outputs.filter((o) => { const n = addrToName[o.verboseData?.scriptPublicKeyAddress]; return n && n !== 'settler' && n !== 'fee'; });
    ok(okAddr && live && toWallet.length === 0, `C. ${s} claim idx=${c.idx} → ${who[0]}: claim_out/tok_out 地址 == 重算的 KanetTokenClaim/KTT 地址, 仍是链上未花 UTXO, 无输出落到赢家/下注人钱包`);
    total += c.payout; winnersSeen.add(who[0]); results.markets[m.id].claims.push({ idx: c.idx, who: who[0], payout: String(c.payout), txid: c.txid });
  }
  ok(total === 3_000_000_000n, `C. ${s}: 全部 claim 的 KTT 总量 == 池总额 3000000000(实 ${total})`);
  ok(winnersSeen.has(winner), `C. ${s}: UMA 桩判 ${condIdx % 2 === 0 ? 'YES' : 'NO'} ⇒ 赢家 ${winner} 收到 KTT claim(受益人 ${[...winnersSeen].join(',')})`);
}
// ── 6. 账本1857: /api/pool/my-positions 对 ZK 原生盘的赢/输 + 已到账筹码(UI 截图取数口径) ──
results.myPositions = {};
for (const who of ['bettorA', 'bettorB']) {
  const r = await http('GET', `/api/pool/my-positions?linked_addr=${encodeURIComponent(W[who].address)}`);
  results.myPositions[who] = r.positions;
  ok(r.ok === true && Array.isArray(r.positions), `my-positions(${who}) 200`);
  for (const m of created) {
    const row = (r.positions || []).find((p) => p.logical_market_id === m.id);
    const condIdx = parseInt(String(m.outcome_condition_id).slice(2, 4), 16); const winnerWho = condIdx % 2 === 0 ? 'bettorA' : 'bettorB';
    const mine = results.markets[m.id].claims.filter((c) => c.who === who).reduce((x, c) => x + BigInt(c.payout), 0n);
    if (!row) { ok(false, `my-positions(${who}) 缺 ${m.id.slice(-8)}`); continue; }
    if (who === winnerWho) ok(row.zk_native === true && row.did_win === true && row.actual_payout_chain_verified === true && row.actual_payout_units === String(mine) && mine > 0n, `my-positions ${who} @${m.id.slice(-8)}: 赢 ${row.actual_payout_units} 筹码(== 链上 claim 合计 ${mine}), chain_verified`);
    else ok(row.did_win === false && row.actual_payout_kas === null, `my-positions ${who} @${m.id.slice(-8)}: 输(did_win=false)`);
  }
}
results.finishedAt = new Date().toISOString(); results.failures = fails; dump();
log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
