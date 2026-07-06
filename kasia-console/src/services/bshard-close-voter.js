// bshard close_attest 自治-enforce voter daemon (Track B · production-trustless).
//
// 起因 (J2 verify-not-echo, 2026-06-22): bshard 命门③/④ enforce 现 driver-side/test-only — relay sign_input_for_settle
//   盲签 + enforceCommitteeSign 只 test driver/probe 调 → 恶意 settler 跳 enforce 直签任意 payoutRoot。
// 解 = 镜像 bettor-prediction-voter.js 的 handleTxSignReq (PB-S8-1 byzantine 防): 每委员 oracle 节点【自治】跑
//   enforceCloseAttest, 签前独立验 (命门①③④ + frozen_evidence 同源 + fix① 委员链锚 re-derive), PASS 才本节点 relay 签。
//   trust = honest-majority-of-委员节点; settler 远程伪造不了别节点 oracle 的 sig。
//   今天 x4kpq live: J1 :3300 手动 verify-then-sign = 本 daemon 的 proof-of-concept。
//
// 设计档: docs/2026-06-22-bshard-autonomous-enforce-daemon-design.md + docs/2026-06-22-bshard-enforce-in-daemon-interface.md
//
// ⚠ load-bearing 不变量 (Bettor 红队, daemon-在前不够 — §3 设计档):
//   (a) relay sign_input_for_settle (close_attest 类) 本地不可远程触发 (settler 远程够不到 relay)。
//   (b) 无 bypass: daemon 是本节点【唯一】call relay sign close_attest 的路, 且【每个】sign-request 必经 enforceCloseAttest。
//   → 这两条在 relay/console 层落 (本文件外); daemon 自身只保证它调的每个 sign 都先 enforce-PASS。
//
// 分工: J2 = 本 daemon 骨架 + transport + sig 收集 + (a)(b); J1 = enforceCloseAttest + verifyFrozenEvidence (lib).

import { blake2b } from '@noble/hashes/blake2b';
import { sqlite } from '../db/client.js';
import { sendCommandAsync } from './relay-manager.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRelayChainReader } from './relay-chain-reader.mjs';
import { fetchEndBlockHashCanonical, loadPoolSnapshot } from './pool-market-settler-v06.mjs';
import { listShards } from '../lib/shard-allocator.mjs';
import { compileSil, ctorBytes32, ctorInt } from '../lib/pool-bshard-artifacts.mjs';
import { isCommingledSpine } from '../lib/pool-commingle-detect.mjs';

const TICK_MS = 30_000;   // 30s tick (close_attest 时效性 > 普通 vote; settler 等 quorum)
let timer = null, running = false;

// C1 级2-B (anti-identity-swap): canonical silverc + PoolSide sil = 必与 register/relay 铸 ticket 同源 build
//   (记忆 silverc-build-determinism-pin: 跨节点必 pin 同一 silverc, 否则 bytecode 差→p2sh 差→false-BUST 杀 liveness)。
const SILVERC = process.env.SILVERC_PATH || 'D:/silverscript/target/release/silverc.exe';
const POOLSIDE_SIL = join(dirname(fileURLToPath(import.meta.url)), '../lib/PoolSide_v08_shard.sil');

// kaspa-wasm lazy-load (p2sh-from-redeem = pure crypto, no chain; mirrors pool-p2sh.mjs compileAndComputeP2SH).
let _kaspaWasm = null;
export async function ensureKaspaWasm() { if (!_kaspaWasm) _kaspaWasm = await import('kaspa-wasm'); return _kaspaWasm; }
// SYNC p2sh(redeemHex)->addr (enforce lib calls ctx.p2sh synchronously). ensureKaspaWasm() must run first.
function p2shFromRedeemSync(redeemHex, network) {
  if (!_kaspaWasm) throw new Error('p2shFromRedeemSync: kaspa-wasm not loaded (call ensureKaspaWasm first)');
  const { ScriptBuilder, addressFromScriptPublicKey } = _kaspaWasm;
  const bytes = new Uint8Array(Buffer.from(redeemHex, 'hex'));
  const spk = ScriptBuilder.fromScript(bytes).createPayToScriptHashScript();
  const addr = addressFromScriptPublicKey(spk, network);
  if (!addr) throw new Error('addressFromScriptPublicKey returned undefined');
  return addr.toString();
}
const _blake2bHex = (s) => Buffer.from(blake2b(Buffer.from(String(s)), { dkLen: 32 })).toString('hex');

/**
 * loadBettors (cross-shard) — bshard logical market auto-rolls into N shards (market_shards); each bettor row lives in
 *   pool_bettor_sides keyed by the SHARD market id. Union across all shards → complete loaded bettor set for the logical
 *   market. side_lock_daa = chain-anchored accepting-block daa (enforce C1 per-bettor guard; NULL → fail-loud in lib).
 *   No shards (non-(A) / fee-only market) → fall back to the logical id itself.
 * @returns {Array<{pk, direction, stake, side_lock_daa}>}
 */
export function loadBettorsCrossShard(logicalMarketId) {
  const shards = listShards(sqlite, logicalMarketId);
  const marketIds = shards.length ? shards.map(s => s.shard_market_id) : [logicalMarketId];
  const out = [];
  for (const mid of marketIds) {
    const rows = sqlite.prepare(
      `SELECT bettor_pk, direction, stake_amount, side_lock_daa FROM pool_bettor_sides WHERE market_id = ?`
    ).all(mid);
    for (const r of rows) {
      out.push({ pk: String(r.bettor_pk), direction: Number(r.direction), stake: String(r.stake_amount), side_lock_daa: r.side_lock_daa });
    }
  }
  return out;
}

/**
 * buildEnforceCtx — the E1 fix (NWT 红队 verdict 2291daa1): construct EVERY ctx hook enforceCloseAttest needs, so the
 *   autonomous path actually runs (placeholder ctx `{rcOn, myRelayId}` made the lib throw TypeError on ctx.myOracleKeys
 *   every tick → daemon never signed). All load-bearing axes are CHAIN-ANCHORED (not caller/settler-supplied):
 *     - myOracleKeys: [voterPk] (this node's real get_pubkey, daemon-resolved)
 *     - chainReader + fetchEndBlockHashCanonical: SPC-walk endBlock (anti-grinding committee seed) — NOT a req field
 *     - loadPoolSnapshot: pool_snapshots frozen @ create + on-chain maker/broker pk (committee re-derive)
 *     - loadBettors: cross-shard pool_bettor_sides w/ side_lock_daa (pari-mutuel + C1 chain-anchor)
 *     - db/p2sh/checkUtxoLanded: C1 level2-A cross-shard ShardLeaf re-build (anti-omission/anti-dir-tamper)
 *   level2-B (per-ticket anti-swap via deriveTicketAddr/silverc) is INTENTIONALLY not wired yet — it needs a canonical
 *   silverc pin byte-equal'd against real on-chain PoolSide tickets in a live (A)-model market (else a recompute drift
 *   would false-BUST a legit close → liveness death). Honest PARTIAL; see report. level2-A is the testable guard now.
 * @param {{id, name, address}} voter   host-local oracle relay
 * @param {{id, deadline_daa}} market   pool_markets v0.7 row (logical market)
 */
export function buildEnforceCtx(voter, voterPk, market) {
  const network = String(voter.address || '').startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
  const chainReader = createRelayChainReader(voter.id);
  const deadlineDaa = (market.deadline_daa != null && Number.isFinite(Number(market.deadline_daa))) ? Number(market.deadline_daa) : null;
  return {
    myOracleKeys: [String(voterPk).toLowerCase()],
    chainReader,
    deadlineDaa,
    db: sqlite,
    // lib passes the result straight into deriveCommitteeSeed(marketId, endBlockHash, root) → must return the HASH STRING.
    fetchEndBlockHashCanonical: async (reader, daa) => {
      const r = await fetchEndBlockHashCanonical(reader, daa);
      return r.hash;
    },
    // adapter: settler-v06 loadPoolSnapshot returns parallel pool_pks/pool_stakes → lib wants members[{pk_hex,stake_sompi}]
    //   + chain-anchored maker_pk/broker_pk (committee exclude) + deadline_daa.
    loadPoolSnapshot: async (marketId) => {
      const snap = loadPoolSnapshot(marketId);
      const mrow = sqlite.prepare('SELECT maker_pk, broker_pk, deadline_daa FROM pool_markets WHERE id = ?').get(marketId);
      return {
        pool_merkle_root: snap.pool_merkle_root,
        members: snap.pool_pks.map((pk, i) => ({ pk_hex: String(pk).toLowerCase(), stake_sompi: snap.pool_stakes[i] })),
        maker_pk: mrow?.maker_pk ? String(mrow.maker_pk).toLowerCase() : null,
        broker_pk: mrow?.broker_pk ? String(mrow.broker_pk).toLowerCase() : null,
        deadline_daa: mrow?.deadline_daa != null ? Number(mrow.deadline_daa) : deadlineDaa,
      };
    },
    loadBettors: async (marketId) => loadBettorsCrossShard(marketId),
    // C1 level2-A chain-anchor primitives.
    p2sh: (redeemHex) => p2shFromRedeemSync(redeemHex, network),
    checkUtxoLanded: async (addr, txid) => {
      const r = await sendCommandAsync(voter.id, { type: 'check_utxo_landed', address: addr, txid: txid || undefined }, 15000);
      return !!(r?.landed || r?.found);
    },
    // readOutpointCreatedAddr (J2, level2-A landed-in-history enabler, 对齐 NWT enforce 17ad3f4c 接口):
    //   读 outpoint 的【创建-tx output 地址】(含 spent leaf, 解 consolidate spend ShardLeaf→PS 后 level2-A leaf-landed 失败)。
    //   源 = kaspa_tx_log (v60 indexer outputs_json, voter 节点订阅同链自写=跨节点 byte-deterministic 链锚, TN12 无 getTransaction)。
    //   level2-A 用: readOutpointCreatedAddr(leaf_outpoint) == p2sh(spliceLeafState(shard_redeem=genesis, state)) (绑 genesis lineage)。null=fail-loud。
    readOutpointCreatedAddr: async (outpoint) => {
      const [txid, idxStr] = String(outpoint).split(':');
      const row = sqlite.prepare('SELECT outputs_json FROM kaspa_tx_log WHERE tx_id = ?').get(String(txid));
      if (!row?.outputs_json) return null;
      try { const outs = JSON.parse(row.outputs_json); const o = outs[Number(idxStr)]; return o ? o.address : null; } catch { return null; }
    },
    // C1 级2-B (anti-identity-swap): explicit deriveTicketAddr (NWT 红队建议: 只认显式 hook, 不靠 silverc-fallback 自动触发)。
    //   = Bettor live-proved 路 (market fy1yk-s0, _bettor_ticket_byteeq.mjs: compileSil([pk,dir,stake,shardPoolId])→p2sh
    //   == 链上 15 个 0.2KAS dust ticket UTXO, byte-equal 实证)。register 的 z32 第4 ctor 只为抽 state-excluded 模板;
    //   真 ticket State 第4 字段是 shardPoolId, compileSil 烤 shardPoolId 复现真地址 (silverc 同源 pin 前提)。
    //   喂 swap 过的 (dir/pk/stake) → 算出地址链上不存在 → check_utxo_landed false → BUST。
    deriveTicketAddr: ({ bettorPk, direction, stake, shardPoolId }) => {
      const redeem = Buffer.from(compileSil(POOLSIDE_SIL, [
        ctorBytes32(String(bettorPk)), ctorInt(Number(direction)), ctorInt(Number(stake)), ctorBytes32(String(shardPoolId)),
      ], SILVERC).script).toString('hex');
      return p2shFromRedeemSync(redeem, network);
    },
  };
}

// J1 的 enforceCloseAttest (lib, 2291daa1 已 ship)。E1 闭后 daemon 注入全 ctx hook (buildEnforceCtx)。
//   fail-loud: 真 lib 缺失 → 不静默回退 driver-side enforceCommitteeSign placeholder (那正是 Track B 要替掉的盲签自签路 —
//   静默回退 = 假"自治"绿)。lib 缺 = 配置错, 抛, 不签。
async function loadEnforce() {
  const m = await import('../lib/bshard-close-enforce.mjs');
  if (typeof m.enforceCloseAttest !== 'function') {
    throw new Error('bshard-close-enforce.mjs 缺 enforceCloseAttest export — Track B enforce lib 未 ship, 拒签 (不回退 driver-side 盲签)');
  }
  return m.enforceCloseAttest;
}

// ⚠ opt-in gate (default OFF). E1 已闭 (ctx 全 wire 含 C1 级2-B deriveTicketAddr, Bettor live byte-equal 实证), daemon
//   逻辑可跑。但 Track B 整体仍待【live e2e 实证】才能宣称 production-trustless:
//   - D2/C2: J1 逻辑层闭 (86523223/f4d2a7ee, NWT 11 TEETH 红队验), 但尚未在【活 (A)-model 自治 settle】端到端跑过。
//   - D4 (relay-gate no-bypass): relay sign 端点仍可被 daemon 外路触发 — 仍开 (relay-side 下一块)。
//   ∴ 默认不在 boot 自动签 (避免命门未端到端验证时被恶意 settler 利用)。BSHARD_CLOSE_VOTER_ENABLED=1 显式 opt-in
//   供【受控 live e2e】(Bettor 起活 (A) 市场 → cron ON → Bettor/NWT co-verify settle 落链)。镜像 BETTOR_REFUND_CLAIM_ENABLED gate。
const VOTER_ENABLED = process.env.BSHARD_CLOSE_VOTER_ENABLED === '1';

export function startBshardCloseVoterCron() {
  if (timer) return;
  if (!VOTER_ENABLED) {
    console.log('[bshard-close-voter] cron NOT started — BSHARD_CLOSE_VOTER_ENABLED!=1 (Track B 待 live e2e 实证 + D4 relay-gate 未闭, 默认不自动签; 设=1 供受控 live e2e)');
    return;
  }
  setTimeout(() => { bshardCloseVoterTick().catch(e => console.error('[bshard-close-voter] startup tick:', e.message)); }, 5_000);
  timer = setInterval(() => { bshardCloseVoterTick().catch(e => console.error('[bshard-close-voter] tick:', e.message)); }, TICK_MS);
  console.log(`[bshard-close-voter] cron started (${TICK_MS / 1000}s tick) — BSHARD_CLOSE_VOTER_ENABLED=1 (受控 live e2e 模式)`);
}
export function stopBshardCloseVoterCron() { if (timer) { clearInterval(timer); timer = null; } }

export async function bshardCloseVoterTick() {
  if (running) return { skipped: true };
  running = true;
  try {
    const voterRelays = sqlite.prepare(`SELECT id, name, address FROM relay_nodes WHERE is_oracle = 1`).all();
    if (!voterRelays.length) return { ok: true, voters: 0 };
    const enforceCloseAttest = await loadEnforce();
    let signed = 0, skipped = 0, refused = 0, errored = 0, commingledSkipped = 0;
    // pending close-request: v0.7 市场 status='collecting_sigs' + metadata.bshard_close_request 存在 + deadline 内。
    // 防御性 guard(2026-07-06 NWT 横扫④，Bettor 拍板"即使当前靠 VOTER_ENABLED 默认 OFF + publishCloseRequest()
    // 零调用点两道间接 gate 挡住，也要补"): ZK-native(resolution_rule_spec.zk_native===true)市场该走
    // W2 扩展的 close_attest(26 参，多签 4 个新字段)，不该被这条经典 22 参 close_attest 的自治签路径捡到。
    // json_valid() 短路防畸形 JSON 让整条 SELECT 抛异常(同 ANTI-PATTERNS 规则54 教训)。
    const pending = sqlite.prepare(`
      SELECT id, metadata, pool_merkle_root, broker_pk, deadline_daa, resolution_rule_spec, spine_p2sh
      FROM pool_markets
      WHERE protocol_version = 'v0.7' AND protocol_status = 'collecting_sigs' AND metadata LIKE '%bshard_close_request%'
        AND (json_valid(resolution_rule_spec) = 0 OR json_extract(resolution_rule_spec, '$.zk_native') IS NOT 1)
    `).all();
    for (const market of pending) {
      // FINDING-2 (NWT) 自治结算闸: commingled-spine 盘禁自治 close (单源 isCommingledSpine, J1 pool-commingle-detect).
      //   pre-fix v0.7 markets 的 spine_p2sh 被 >1 市场共享 (market_id 没烤进 redeem) → close_attest 可能花到【别市场】
      //   同址 spine UTXO (跨市场替换)。委员绝不自治签这类 close (隔离不在链上, 全靠链下 settler = 不可信)。
      //   ⚠ 只闸自治 settle/payout 路; refund 是 outpoint-precise 独立路, 不在此处 (J1 decoupling, 别 orphan 退款)。
      //   belt-and-suspenders: 现 VOTER_ENABLED 默认 OFF → 防御纵深, 为 Track B 启用铺路。
      if (isCommingledSpine(market.spine_p2sh, sqlite)) {
        commingledSkipped++;
        console.warn(`[bshard-close-voter] ⛔ FINDING-2 commingled spine market=${market.id.slice(-8)} spine=${String(market.spine_p2sh).slice(0,20)} → 禁自治 close (跨市场替换风险)`);
        continue;
      }
      let req;
      try { req = JSON.parse(market.metadata || '{}').bshard_close_request; } catch { continue; }
      if (!req || !req.txSafeJson || !req.committee_pks) { skipped++; continue; }
      for (const voter of voterRelays) {
        const r = await processCloseRequest(voter, market, req, enforceCloseAttest);
        if (r.signed) signed++; else if (r.refused) refused++; else if (r.errored) errored++; else skipped++;
      }
    }
    if (signed || refused || errored || commingledSkipped) console.log(`[bshard-close-voter] tick: ${pending.length} pending | signed=${signed} refused=${refused} skipped=${skipped} commingledSkipped=${commingledSkipped} errored=${errored}`);
    return { ok: true, pending: pending.length, signed, refused, skipped, commingledSkipped, errored };
  } finally { running = false; }
}

async function processCloseRequest(voter, market, req, enforceCloseAttest) {
  try {
    // 1. 本节点是该 close 的委员? get_pubkey (真 pk, 不信 req.committee_pks) — req.committee_pks 只当便宜预筛, enforce 内
    //    fix① 链锚 re-derive 委员才是真判定 (D3 闭, NWT 坐实)。
    let voterPk;
    try { voterPk = String((await sendCommandAsync(voter.id, { type: 'get_pubkey' }))?.x_only_pubkey || '').toLowerCase(); } catch { return { errored: true }; }
    if (!voterPk || voterPk.length !== 64) return { skipped: true };
    const committeePks = (req.committee_pks || []).map(p => String(p).toLowerCase());
    if (committeePks.length && !committeePks.includes(voterPk)) return { skipped: true };   // 预筛: settler 都没把我列为委员 → not-my-business

    // 2. D1 dedup-by-MARKET (NWT 红队, equivocation 防御纵深): 本 voter 对同 market 已签【某根】→ 拒签【不同根】(等价
    //    repeat→idempotent skip)。比旧 (market,root) dedup 严: 旧 key 允许同节点对同市场签两个不同根。
    const priorSigs = sqlite.prepare(`
      SELECT payload FROM chain_events WHERE event_type = 'bshard_close_sig' AND from_address = ? AND payload LIKE ?
    `).all(voter.address, `%"market_id":"${market.id}"%`);
    for (const ps of priorSigs) {
      let pp; try { pp = JSON.parse(ps.payload); } catch { continue; }
      if (String(pp.payout_root) === String(req.claimedPayoutRoot)) return { skipped: true };   // 已签同根 → 幂等
      return { refused: true, reason: `D1 equivocation: 已对 market 签过不同 root ${String(pp.payout_root).slice(0, 10)}, 拒签 ${String(req.claimedPayoutRoot).slice(0, 10)}` };
    }

    // 3. E1 — 建全 ctx hook (链锚) 后自治 enforce (J1 lib: 命门①③④ + frozen_evidence 同源 + fix① 委员链锚 re-derive)。
    await ensureKaspaWasm();   // p2sh sync hook 依赖 (C1 level2-A + 命门① chain-bound 都用)。
    const ctx = buildEnforceCtx(voter, voterPk, market);
    // cross-node hint (J1 94cfef67): 若 req 带 snapshot.shards, 喂 ctx.shards (lib verifyBettorsCompleteFromChain 优先它,
    //   否则回退 listShards(ctx.db))。本地 :3200 委员有 market_shards → db 回退即可; ctx.shards 支持跨节点委员(无本地分片表)。
    //   ⚠ snapshot 只指路: lib 仍链锚验每片 leaf p2sh==landed + per-ticket landed + PS-pool, 不信 snapshot 的数。
    if (Array.isArray(req.snapshot?.shards) && req.snapshot.shards.length) ctx.shards = req.snapshot.shards;
    const verdict = await enforceCloseAttest({ ...req, committee_pk: voterPk, market_id: req.market_id || market.id }, ctx);
    if (verdict?.skip) return { skipped: true };   // enforce 判定本节点非委员 (链锚 re-derive)
    if (!verdict?.pass) {
      // abstain-not-guess: 弃签不广播 (settler 偷不了; liveness 兜底 = quorum-timeout-refund 在 settler 侧)。
      return { refused: true, reason: verdict?.reason };
    }

    // 3b. 命门① chain-bound (enforce lib L78-79 委托 daemon): enforce 从 req.psRedeemHex offset-518 读 commit, 但没验
    //     psRedeemHex 真是【被签 PS input】的 redeem。daemon 验 p2sh(psRedeemHex)==被签 input[input_index] 的链上地址,
    //     否则 settler 给一个 offset-518 自洽但与真 input 无关的假 redeem → 绕过命门①。
    try {
      const txObj = JSON.parse(req.txSafeJson);
      const psInputTxid = txObj?.inputs?.[req.input_index ?? 0]?.transactionId;
      if (!psInputTxid) return { errored: true, reason: '命门① chain-bound: txSafeJson 无 PS input transactionId' };
      const psAddr = ctx.p2sh(req.psRedeemHex);
      const landed = await ctx.checkUtxoLanded(psAddr, psInputTxid);
      if (!landed) return { refused: true, reason: `命门① chain-bound: p2sh(psRedeem)=${psAddr.slice(0, 16)} != 被签 PS input ${String(psInputTxid).slice(0, 12)} 链上地址 (假/不绑链 redeem)` };
    } catch (e) {
      return { errored: true, reason: `命门① chain-bound check fail: ${e.message}` };
    }

    // 4. C3 TOCTOU assert (NWT 红队): daemon 签前必验【它要签的 tx 的 hash】== enforce 验过的 verifiedTxHash, 否则 enforce
    //    验了 tx-A 却签了 tx-B = enforce 被绕。daemon 签的是 req.txSafeJson; enforce hash 的也是 signRequest.txSafeJson → 应一致。
    const txToSign = req.txSafeJson;
    if (verdict.verifiedTxHash && _blake2bHex(txToSign) !== verdict.verifiedTxHash) {
      return { refused: true, reason: `C3 TOCTOU: 要签 tx hash ${_blake2bHex(txToSign).slice(0, 12)} != enforce verifiedTxHash ${String(verdict.verifiedTxHash).slice(0, 12)}` };
    }

    // 5. PASS → 本节点 relay 签。真 enforceCloseAttest 不顺手签 (它纯验); placeholder 路径才带 _signature。
    let signature = verdict._signature;
    if (!signature) {
      const sj = await sendCommandAsync(voter.id, { type: 'sign_input_for_settle', tx_hex: txToSign, input_index: req.input_index ?? 0, safe_json: true });
      if (!sj?.signature) return { errored: true, reason: `sign_input_for_settle no sig: ${JSON.stringify(sj).slice(0, 80)}` };
      signature = sj.signature;
    }

    // 6. 写 sig 进 chain_events 'bshard_close_sig' (settler collectCloseSigs 收 ≥4 → submit close_attest)。
    //    committee_meta: 各委员在 pool tree 位置不同 → settler 注入 per-pk {idx, siblings_hex}; daemon 按 voterPk 取。
    const meta = req.committee_meta && req.committee_meta[voterPk] ? req.committee_meta[voterPk] : { idx: req.idx, siblings_hex: req.siblings_hex };
    const payload = JSON.stringify({ t: 'bshard_close_sig', market_id: market.id, committee_pk: voterPk, payout_root: req.claimedPayoutRoot, input_index: req.input_index ?? 0, idx: meta.idx, siblings_hex: meta.siblings_hex, signature, verdict: verdict.verdict });
    const synthTxid = `bshard_close_sig:${voter.id.slice(0, 8)}:${market.id.slice(-6)}:${String(req.claimedPayoutRoot).slice(0, 8)}`;
    sqlite.prepare(`INSERT OR IGNORE INTO chain_events (txid, from_address, event_type, payload, observed_by, is_public) VALUES (?, ?, 'bshard_close_sig', ?, ?, 1)`)
      .run(synthTxid, voter.address, payload, voter.id);
    console.log(`[bshard-close-voter] ✅ ${voter.name} 自治 enforce PASS (verdict=${verdict.verdict}) → 签 close_attest market=${market.id.slice(-8)}`);
    return { signed: true };
  } catch (e) {
    return { errored: true, reason: e.message };
  }
}
