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
import { collectCloseSigsV2, clearCloseRequest, markSubmittedV2, QUORUM } from '../lib/bshard-close-transport.mjs';
import { _splicePayoutV2CloseRedeem } from '../lib/bshard-close-enforce.mjs';
import { enqueueZkProveJob } from '../lib/zk-prove-enqueue.mjs';

const TICK_MS = 30_000;   // 30s tick (close_attest 时效性 > 普通 vote; settler 等 quorum)
let timer = null, running = false;

// C1 级2-B (anti-identity-swap): canonical silverc + PoolSide sil = 必与 register/relay 铸 ticket 同源 build
//   (记忆 silverc-build-determinism-pin: 跨节点必 pin 同一 silverc, 否则 bytecode 差→p2sh 差→false-BUST 杀 liveness)。
// 事故硬化(2026-07-08 backlog 调查, Bettor④指令): target/release/silverc.exe 会随任意 cargo build 原地漂移
// (07-07/07-08 两次事故的确切病灶——本文件是委员投票/enforce daemon, 编译 PayoutShard V1 家族合约必须 byte-exact),
// 改跟 pool-bshard-artifacts.mjs 已修的那行同一模式, 固定按族 pin 的已知良性 legacy 文件。
const SILVERC = process.env.SILVERC_LEGACY_PATH || 'D:/silverscript/versioned-builds/silverc-legacy-2c46231.exe';
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
    // side_lock_tx 加 (W2, J2 2026-07-07): canonicalBetOrder tiebreak 需要 (同 side_lock_daa 双注确定性打破)。
    //   只加 SELECT 列 + 透传, 不改现有字段/顺序, V1 enforceCloseAttest 不读它 (向后兼容, 零行为变化)。
    const rows = sqlite.prepare(
      `SELECT bettor_pk, direction, stake_amount, side_lock_daa, side_lock_tx FROM pool_bettor_sides WHERE market_id = ?`
    ).all(mid);
    for (const r of rows) {
      out.push({ pk: String(r.bettor_pk), direction: Number(r.direction), stake: String(r.stake_amount), side_lock_daa: r.side_lock_daa, side_lock_tx: r.side_lock_tx });
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
  // W2 blockhash_parity(J2 2026-07-07·Bettor 钉①): daemon 自己本地 market 行的 resolution_rule_spec, 供
  //   enforceCloseAttestV2/enforceCloseAttest 核心链的 judge_type 分支读 target_daa —— 绝不能从 signRequest/
  //   proposal 字段读(那是 settler 可控输入), 只信这个 daemon 自查的本地 DB 值(同 deadlineDaa 的信任级别)。
  let resolutionRuleSpec = null;
  try { resolutionRuleSpec = JSON.parse(market.resolution_rule_spec || '{}'); } catch { resolutionRuleSpec = null; }
  // W2 predicate-null 命门①(J2 2026-07-07·Bettor 批第3处窄修): 同 resolutionRuleSpec 一样, daemon 自查本地 market
  // 行的 market_metadata_hash, 供 predicate=null 市场的 hash-bind 比对基准(绝不从 signRequest 读)。
  const marketMetadataHash = market.market_metadata_hash ? String(market.market_metadata_hash).toLowerCase() : null;
  return {
    myOracleKeys: [String(voterPk).toLowerCase()],
    chainReader,
    deadlineDaa,
    resolutionRuleSpec,
    marketMetadataHash,
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
    // 🔴 fix (Bettor+NWT+J2 2026-07-08 22:2x, uqmp8 C1 anti-swap 首次真实场景误拒): 原实现只查 relay 的
    // check_utxo_landed(= live unspent UTXO 集), 对无 txid 的调用(level2-B per-ticket anti-swap, 823 行)
    // 是致命的——ticket UTXO 一旦被后续 tx 花掉(如 absorb 把整个 ShardLeaf 连同其上的 ticket 一并消费),
    // live-only 查询必返 false, 委员诚实拒签一个【曾经真实落链、只是现在花了】的合法 ticket。level2-A(738-743
    // 行注释)已经踩过同一个坑并改用 landed-in-history(readOutpointCreatedAddr), 但 level2-B 没跟着改——
    // 这次修 checkUtxoLanded 本身(共享给两处), 而非只改调用点, 避免"同族修复不同步"再发生同类坑。
    // 语义: txid 给定 → 精确匹配(原行为, 命门①chain-bound 那类用法不变); txid 缺省(level2-B 用法) →
    // live 查一次, 没有就退化到 kaspa_tx_log(indexer 从真块写, node-local 可信边界, 同 target_daa 那条口径)
    // 搜该地址是否曾出现在任一 tx 的 output 里, 与 spent 状态无关(landed-in-history, 不是"现在还在")。
    checkUtxoLanded: async (addr, txid) => {
      if (txid) {
        // 命门①chain-bound 等场景: 精确 txid 匹配, 行为完全不变(relay 抛错照样往外抛, errored≠refused
        // 的既有分流不受影响, 不因这次修复悄悄改变 retriable-vs-permanent 的既定语义)。
        const r = await sendCommandAsync(voter.id, { type: 'check_utxo_landed', address: addr, txid }, 15000);
        return !!(r?.landed || r?.found);
      }
      // 🔴 fix² (Bettor+KANet-UI catch 2026-07-08 22:4x): check_utxo_landed 的 relay 端命令 schema
      // (kasia-relay/src/lib/commands.mjs:136/202) 把 txid 定为必填字段——txid=null 时压根没有"live 查"
      // 这回事可发(发了就是 INVALID COMMAND, 不是"查了没找到"), 上一版试图先 live 再 fallback 是徒劳的
      // 空转。level2-B per-ticket anti-swap 用法(无具体已知 txid, 只问"这地址曾否出现在任一 output 里")
      // 直接查 kaspa_tx_log(landed-in-history, indexer 从真块写, node-local 可信边界), 不发不合法的 live 命令。
      const row = sqlite.prepare(`SELECT 1 FROM kaspa_tx_log WHERE outputs_json LIKE ? LIMIT 1`).get(`%"${addr}"%`);
      return !!row;
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

// W2 (J2 2026-07-07): enforceCloseAttestV2 (PayoutShardV2/ZK-native) 同款 fail-loud 加载, 同 loadEnforce 理由。
async function loadEnforceV2() {
  const m = await import('../lib/bshard-close-enforce.mjs');
  if (typeof m.enforceCloseAttestV2 !== 'function') {
    throw new Error('bshard-close-enforce.mjs 缺 enforceCloseAttestV2 export — W2 enforce lib 未 ship, 拒签');
  }
  return m.enforceCloseAttestV2;
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
      SELECT id, metadata, pool_merkle_root, broker_pk, deadline_daa, resolution_rule_spec, spine_p2sh, market_metadata_hash
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
    // (V1 payload 没有 attestedAtMs 字段/W2 概念——下方 V2 版本才是 uqmp8 fee-input churn 死锁的实际修复位置,
    // V1 这里维持原 root-only 语义不动, 避免在没有该字段的路径引入 undefined===undefined 误判。)
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
    // 🔴 fix (同下方 V2 同款坑, 2026-07-08 23:0x): chain_events.observed_at 是 TEXT NOT NULL 无 default,
    // 漏这一列会被 INSERT OR IGNORE 静默吞掉——signed++/console.log 仍打印成功但行没真的落地。V1/V2 是同一
    // 作者写的姊妹函数, 同一个 bug 存在于两处, 一并修(同族修复不同步的反面: 这次揪出来就两处一起补)。
    const insertResult = sqlite.prepare(`INSERT OR IGNORE INTO chain_events (txid, from_address, event_type, payload, observed_by, observed_at, is_public) VALUES (?, ?, 'bshard_close_sig', ?, ?, ?, 1)`)
      .run(synthTxid, voter.address, payload, voter.id, new Date().toISOString());
    // fail-closed 记账(同下方 V2 同款): changes===0 时必须查真实是否已存在(幂等 OK), 不能笼统当"签了"。
    if (insertResult.changes === 0) {
      const exists = sqlite.prepare('SELECT 1 FROM chain_events WHERE txid = ? AND event_type = ?').get(synthTxid, 'bshard_close_sig');
      if (!exists) return { errored: true, reason: `sig INSERT changes=0 且该 txid 查无此行 — 静默失败(非幂等重复), 不能计入 signed` };
    }
    console.log(`[bshard-close-voter] ✅ ${voter.name} 自治 enforce PASS (verdict=${verdict.verdict}) → 签 close_attest market=${market.id.slice(-8)}`);
    return { signed: true };
  } catch (e) {
    return { errored: true, reason: e.message };
  }
}

// ── W2 (J2 2026-07-07): PayoutShardV2 / ZK-native close_attest 自治-enforce (镜像 V1 骨架, 分派到 enforceCloseAttestV2) ──
// ⚠ 今天(2026-07-07)诚实标注: 这是 driver-driven 首证的一部分 (Bettor 裁定 (a)+结构化), 不挂进 startBshardCloseVoterCron
// 自动循环 — 由 3o6cs 一次性驱动脚本直接调用一次。①②③自治接线(含此 tick 挂进持续 cron)留后续任务, 不是今天范围。
export async function bshardCloseVoterV2Tick() {
  const voterRelays = sqlite.prepare(`SELECT id, name, address FROM relay_nodes WHERE is_oracle = 1`).all();
  if (!voterRelays.length) return { ok: true, voters: 0 };
  const enforceCloseAttestV2 = await loadEnforceV2();
  let signed = 0, skipped = 0, refused = 0, errored = 0;
  // pending V2 close-request: zk_native 市场(跟 V1 pending 查询互斥, 反向 filter) + collecting_sigs + metadata 带 bshard_close_request_v2。
  const pending = sqlite.prepare(`
    SELECT id, metadata, pool_merkle_root, broker_pk, deadline_daa, resolution_rule_spec, spine_p2sh, market_metadata_hash
    FROM pool_markets
    WHERE protocol_version = 'v0.7' AND protocol_status = 'collecting_sigs' AND metadata LIKE '%bshard_close_request_v2%'
      AND json_valid(resolution_rule_spec) = 1 AND json_extract(resolution_rule_spec, '$.zk_native') IS 1
  `).all();
  for (const market of pending) {
    let req;
    try { req = JSON.parse(market.metadata || '{}').bshard_close_request_v2; } catch { continue; }
    if (!req || !req.txSafeJson || !req.committee_pks) { skipped++; continue; }
    for (const voter of voterRelays) {
      const r = await processCloseRequestV2(voter, market, req, enforceCloseAttestV2);
      if (r.signed) signed++; else if (r.refused) refused++; else if (r.errored) errored++; else skipped++;
      // 观察性缺口修(J2 2026-07-08 22:1x, tick 汇总只有计数没有明细, uqmp8 首次真实场景卡住排查不了根因)——
      // 只加 log, 不改判定逻辑。refused/errored 才打(signed/skipped 是正常态, 不刷屏)。
      if (r.refused || r.errored) console.warn(`[bshard-close-voter-v2]   market=${market.id.slice(0,12)} voter=${voter.name || voter.id.slice(0,8)} ${r.refused ? 'REFUSED' : 'ERRORED'}: ${r.reason || '(no reason)'}`);
    }
  }
  console.log(`[bshard-close-voter-v2] tick: ${pending.length} pending | signed=${signed} refused=${refused} skipped=${skipped} errored=${errored}`);
  return { ok: true, pending: pending.length, signed, refused, skipped, errored };
}

// 镜像 processCloseRequest(V1), 差异: 分派 enforceCloseAttestV2 + 传 4 新字段 + 写独立 event_type 'bshard_close_sig_v2'
// (跟 V1 'bshard_close_sig' 结构隔离, collectCloseSigsV2 只读这个 type, 防跟 V1 sig 混淆)。
async function processCloseRequestV2(voter, market, req, enforceCloseAttestV2) {
  try {
    let voterPk;
    try { voterPk = String((await sendCommandAsync(voter.id, { type: 'get_pubkey' }))?.x_only_pubkey || '').toLowerCase(); } catch { return { errored: true }; }
    if (!voterPk || voterPk.length !== 64) return { skipped: true };
    const committeePks = (req.committee_pks || []).map(p => String(p).toLowerCase());
    if (committeePks.length && !committeePks.includes(voterPk)) return { skipped: true };

    // D1 dedup-by-MARKET (同 V1): 本 voter 对同 market 已签【某根】→ 拒签【不同根】。
    // 🔴 fix (Bettor+NWT 2026-07-08 23:2x, uqmp8 fee-input churn 死锁 #ba7z2c/#ba8vcr): payout_root 是
    // claimedPayoutRoot 的确定性函数(committee+bets+winner+fees), 跨 propose 轮次(仅 fee input 换新, root
    // 巧合不变)算出同一个值——旧 key(root-only)把"同根不同 image(不同 fee outpoint→不同 SighashType.All
    // preimage)"误判成幂等重复而 skip, 导致旧签名(对旧 image 算的)被 collectCloseSigsV2 收进新 image 广播,
    // 链上验签必败(script ran, but verification failed), 且 D1 永远拒绝重签 → 永久死锁(今晚实测坐实: 5 签
    // observed_at 全落在旧 attestedAtMs=1783465981208 那轮, 新 attestedAtMs=1783466801925 那轮零签)。
    // 改 (root, attestedAtMs) 复合 key: 同根同 attestedAtMs = 真幂等(同一次 propose 的重复 tick)→ skip;
    // 同根不同 attestedAtMs = image 换代(合法重签, 如本次 fee 现选)→ 放行往下真签; 不同根 = 保留原 equivocation
    // 拒签(防伪本义不变, NWT 红队过: 同委员对同 root 不同 attestedAtMs 签两次不算 equivocation, 对不同 root 仍挡)。
    const priorSigs = sqlite.prepare(`
      SELECT payload FROM chain_events WHERE event_type = 'bshard_close_sig_v2' AND from_address = ? AND payload LIKE ?
    `).all(voter.address, `%"market_id":"${market.id}"%`);
    for (const ps of priorSigs) {
      let pp; try { pp = JSON.parse(ps.payload); } catch { continue; }
      if (String(pp.payout_root) !== String(req.claimedPayoutRoot)) {
        return { refused: true, reason: `D1 equivocation(V2): 已对 market 签过不同 root ${String(pp.payout_root).slice(0, 10)}, 拒签 ${String(req.claimedPayoutRoot).slice(0, 10)}` };
      }
      if (String(pp.attestedAtMs) === String(req.new_attestedAtMs)) return { skipped: true };
      // 同根不同 attestedAtMs → 不 skip, 往下走真实重签(旧签名留档不删, 只是 D1 判定层面不再当它挡新 image)。
    }

    await ensureKaspaWasm();
    const ctx = buildEnforceCtx(voter, voterPk, market);
    if (Array.isArray(req.snapshot?.shards) && req.snapshot.shards.length) ctx.shards = req.snapshot.shards;
    const verdict = await enforceCloseAttestV2({
      ...req, committee_pk: voterPk, market_id: req.market_id || market.id,
      new_attestedWinner: req.new_attestedWinner, new_betsRoot: req.new_betsRoot,
      new_refundRoot: req.new_refundRoot, new_attestedAtMs: req.new_attestedAtMs,
    }, ctx);
    if (verdict?.skip) return { skipped: true };
    if (!verdict?.pass) return { refused: true, reason: verdict?.reason };

    // 命门① chain-bound (同 V1): psRedeemHex(V2 redeem) 真是【被签 PS input】的 redeem。
    try {
      const txObj = JSON.parse(req.txSafeJson);
      const psInputTxid = txObj?.inputs?.[req.input_index ?? 0]?.transactionId;
      if (!psInputTxid) return { errored: true, reason: '命门① chain-bound(V2): txSafeJson 无 PS input transactionId' };
      const psAddr = ctx.p2sh(req.psRedeemHex);
      const landed = await ctx.checkUtxoLanded(psAddr, psInputTxid);
      if (!landed) return { refused: true, reason: `命门① chain-bound(V2): p2sh(psRedeem)=${psAddr.slice(0, 16)} != 被签 PS input 链上地址` };
    } catch (e) {
      return { errored: true, reason: `命门① chain-bound(V2) check fail: ${e.message}` };
    }

    // C3 TOCTOU (同 V1)。
    const txToSign = req.txSafeJson;
    if (verdict.verifiedTxHash && _blake2bHex(txToSign) !== verdict.verifiedTxHash) {
      return { refused: true, reason: `C3 TOCTOU(V2): 要签 tx hash != enforce verifiedTxHash` };
    }

    let signature = verdict._signature;
    if (!signature) {
      const sj = await sendCommandAsync(voter.id, { type: 'sign_input_for_settle', tx_hex: txToSign, input_index: req.input_index ?? 0, safe_json: true });
      if (!sj?.signature) return { errored: true, reason: `sign_input_for_settle no sig(V2): ${JSON.stringify(sj).slice(0, 80)}` };
      signature = sj.signature;
    }

    const meta = req.committee_meta && req.committee_meta[voterPk] ? req.committee_meta[voterPk] : { idx: req.idx, siblings_hex: req.siblings_hex };
    const payload = JSON.stringify({
      t: 'bshard_close_sig_v2', market_id: market.id, committee_pk: voterPk, payout_root: req.claimedPayoutRoot,
      input_index: req.input_index ?? 0, idx: meta.idx, siblings_hex: meta.siblings_hex, signature, verdict: verdict.verdict,
      // W2 新增 4 字段回填(供 settler submit 时组装 witness, 委员已独立验过, 这里回传的是委员自己重算确认过的值):
      attestedWinner: req.new_attestedWinner, betsRoot: verdict.betsRootHex, refundRoot: verdict.refundRootHex, attestedAtMs: req.new_attestedAtMs,
    });
    // 🔴 fix (Bettor+NWT 2026-07-08 23:2x, #ba7z2c/#ba8vcr 3 处同 key 之②): synthTxid 必须带 attestedAtMs——
    // 否则同 root 跨 image 重签会撞同一个 txid(UNIQUE(txid,event_type)), INSERT OR IGNORE 静默丢弃新 image
    // 的签名(changes=0 但行"存在"是旧 image 那条, fail-closed accounting 会误判成幂等而不报错, 实则内容是
    // 旧 image 的、attestedAtMs 对不上)。加 attestedAtMs 前 8 位, 让每个 request 实例有自己独立的 sig 行空间。
    const synthTxid = `bshard_close_sig_v2:${voter.id.slice(0, 8)}:${market.id.slice(-6)}:${String(req.claimedPayoutRoot).slice(0, 8)}:${String(req.new_attestedAtMs).slice(-8)}`;
    // 🔴 fix (J2+NWT catch 2026-07-08 23:0x, uqmp8 首次真实 voter cron 运行: signed++ 计数打了但 chain_events
    // 零行落地): chain_events.observed_at 是 TEXT NOT NULL 无 default, 这条 INSERT 漏了这一列——INSERT OR IGNORE
    // 静默吞掉 NOT NULL 违规, tick 日志"✅ 签了"是假象, collectCloseSigsV2 永远查到 0 sigs, submit 永远 notReady。
    // 3o6cs 今晚早些时候的 5 条真实签名是我 driver 脚本手写的 7 列 INSERT(含 observed_at), 没踩这个坑——这条
    // 生产 cron 路径(bshardCloseVoterV2Tick)是今晚才第一次真实激活, 这个 bug 从写出来就在, 从未被真实执行过。
    const insertResult = sqlite.prepare(`INSERT OR IGNORE INTO chain_events (txid, from_address, event_type, payload, observed_by, observed_at, is_public) VALUES (?, ?, 'bshard_close_sig_v2', ?, ?, ?, 1)`)
      .run(synthTxid, voter.address, payload, voter.id, new Date().toISOString());
    // 🔴 fail-closed 记账 (Bettor 2026-07-08 23:0x): OR IGNORE 吞掉的不只是 NOT NULL 违规, 也吞 UNIQUE(txid,event_type)
    // 冲突(正常幂等重试场景)——changes===0 时不能笼统当"签了", 必须查真是否已经有这行(幂等 OK)还是真插入失败
    // (才是该报的错)。signed++ 只能锚定在"这行现在确实存在", 不能锚定在"INSERT 语句跑完没报错"。
    if (insertResult.changes === 0) {
      const exists = sqlite.prepare('SELECT 1 FROM chain_events WHERE txid = ? AND event_type = ?').get(synthTxid, 'bshard_close_sig_v2');
      if (!exists) return { errored: true, reason: `sig INSERT changes=0 且该 txid 查无此行 — 静默失败(非幂等重复), 不能计入 signed` };
      // exists=true: 幂等重试撞了自己上一轮已成功的行, 这不是错误, 正常 signed。
    }
    console.log(`[bshard-close-voter-v2] ✅ ${voter.name} 自治 enforce PASS (verdict=${verdict.verdict}) → 签 close_attest_v2 market=${market.id.slice(-8)}`);
    return { signed: true };
  } catch (e) {
    return { errored: true, reason: e.message };
  }
}

// ── 卡2② (2026-07-07 J2, Bettor GO): bshardCloseVoterV2Tick 挂进持续 cron (今晚之前只被一次性驱动脚本手调过一次,
// 见 kasia-console/scratch/_j2_3o6cs_close_attest_v2.mjs)。镜像 startBshardCloseVoterCron(V1) 结构, 零新签名逻辑
// (只是把已经今晚跑通+NWT审过的 bshardCloseVoterV2Tick 接上循环), 独立 kill switch 默认 OFF。
const VOTER_V2_ENABLED = process.env.BSHARD_CLOSE_VOTER_V2_ENABLED === '1';
let voterV2Timer = null;

export function startBshardCloseVoterV2Cron() {
  if (voterV2Timer) return;
  if (!VOTER_V2_ENABLED) {
    console.log('[bshard-close-voter-v2] cron NOT started — BSHARD_CLOSE_VOTER_V2_ENABLED!=1 (默认不自动签, 设=1 供受控 live e2e)');
    return;
  }
  setTimeout(() => { bshardCloseVoterV2Tick().catch(e => console.error('[bshard-close-voter-v2] startup tick:', e.message)); }, 5_000);
  voterV2Timer = setInterval(() => { bshardCloseVoterV2Tick().catch(e => console.error('[bshard-close-voter-v2] tick:', e.message)); }, TICK_MS);
  console.log(`[bshard-close-voter-v2] cron started (${TICK_MS / 1000}s tick) — BSHARD_CLOSE_VOTER_V2_ENABLED=1 (受控 live e2e 模式)`);
}
export function stopBshardCloseVoterV2Cron() { if (voterV2Timer) { clearInterval(voterV2Timer); voterV2Timer = null; } }

// ── 卡2③ (2026-07-07 J2, NWT CONDITIONAL GO → 4问答完, 唯一新造 money-path 代码): collect+broadcast 自治接线 ──
//   settler 侧组装+广播 close_attest_v2, 委托已审过的 relay 命令 'bshard_close_attest_v2' (kasia-relay/src/lib/p2sh.mjs:1969
//   unlockBshardCloseAttestV2, 今晚 0a358fa0 真实调用过) 做实际 covenant script 组装 — 本文件只编排数据(收集 sigs→
//   映射 committee 顺序→调命令→确认落链), 不重实现签名/covenant 逻辑(NWT 卡2③④'inline 禁晋升钉'满足条件)。
//   镜像今晚驱动脚本 _j2_3o6cs_close_attest_v2.mjs 步骤8 SUBMIT 段, 逐行对照抽出。

/**
 * buildCommitteeWitness — 纯函数(零 IO): 把 collectCloseSigsV2 收集到的 sigs 映射回 committee_pks 顺序的 witness 数组。
 *   committee slot 序 = SELECTION 序(不 sort) — 跟 relay 侧假设一致(p2sh.mjs:1981 committeePkHash/sig↔pk 配对/checkSig
 *   逐 slot 依赖原序)。抽成独立纯函数是为了 offline byte-exact test 能不碰 relay/DB 直接验证这段映射逻辑本身。
 */
export function buildCommitteeWitness(committeePks, committeeMeta, sigs) {
  return committeePks.map((pk) => {
    const s = sigs.find((x) => String(x.committee_pk).toLowerCase() === String(pk).toLowerCase());
    const cm = (committeeMeta && committeeMeta[pk]) || {};
    return { pk_hex: pk, sig_hex: s ? s.signature : '00', idx: s ? s.idx : cm.idx, siblings_hex: s ? s.siblings_hex : cm.siblings_hex };
  });
}

/** computeCommitteePkHash — 纯函数, 跟今晚驱动脚本 blake2b(concat(committeePks)) 完全一致算法 (今晚验证过落链值)。 */
export function computeCommitteePkHash(committeePks) {
  return Buffer.from(blake2b(Buffer.concat(committeePks.map((p) => Buffer.from(p, 'hex'))), { dkLen: 32 })).toString('hex');
}

/**
 * _deriveCloseFeeLeaves — 缺件①的 fee 政策边界(J1tn 2026-07-08, 显式声明非隐式假设):
 *   当前只支持"单一 broker fee leaf"这个最简政策(market.broker_pk + market.broker_fee_pct, 两者都是
 *   create-committed 的真实 pool_markets 列, 非本函数派生——今晚频道 broker fee 讨论用的就是这个市场专属
 *   值(1.9%), 不是 pool-shard-settle.mjs 的协议固定 FEE_CONFIG 常量)。oracle/node 份额(FEE_CONFIG 里的
 *   oracleBps/nodeBps)要不要也在 ZK-native 管线里发, 是团队还没定案的政策问题(委员链锚重算 vs 单一
 *   broker 简化模型, 两者取舍未拍板)——本函数不越权替团队做这个决定, 只覆盖已经明确讨论过的 broker 这一份。
 *   market 没配 broker_pk/broker_fee_pct=0 → 返回 null(zk_prove_jobs §4硬门⑤要求非空 fee_leaves, 现状下
 *   这类市场暂不进 ZK-native prove 管线, 不是本函数该静默造一个假 leaf 糊弄过去)。
 */
function _deriveCloseFeeLeaves(marketId, consolidatedPool) {
  const market = sqlite.prepare('SELECT broker_pk, broker_fee_pct FROM pool_markets WHERE id = ?').get(marketId);
  const bps = Number(market?.broker_fee_pct || 0);
  if (!market?.broker_pk || bps <= 0) return null;
  const amount = (BigInt(consolidatedPool) * BigInt(bps) / 10000n).toString();
  return [{ pk: String(market.broker_pk).toLowerCase(), amount, type: 'broker' }];
}

const SETTLER_RELAY_ID = process.env.BSHARD_SETTLER_RELAY_ID || null;   // 广播身份(付 fee input + 收找零), 显式配置非猜测。

/**
 * submitCloseAttestV2 — settler 侧组装+广播 close_attest_v2 (卡2③)。前置: collectCloseSigsV2 已 ready(≥QUORUM)。
 * @param {string} marketId
 * @param {object} req  bshard_close_request_v2(publishCloseRequestV2 存的那份, 含 closeInputs — 跟 propose 阶段委员
 *   enforce 过 hash 的【同一份】raw inputs, 不重新推导)。
 * @param {Array}  sigs collectCloseSigsV2 返回的 sigs 数组。
 * @param {{relayId?:string, changeAddress:string}} opts
 * @returns {Promise<{ok:boolean, txId?:string, psContAddress?:string, reason?:string}>}
 */
export async function submitCloseAttestV2(marketId, req, sigs, opts = {}) {
  const relayId = opts.relayId || SETTLER_RELAY_ID;
  if (!relayId) return { ok: false, reason: 'submitCloseAttestV2: no relayId (BSHARD_SETTLER_RELAY_ID unset)' };
  if (!opts.changeAddress) return { ok: false, reason: 'submitCloseAttestV2: changeAddress 必需' };
  if (!req?.closeInputs?.payoutshard || !req?.closeInputs?.fee) return { ok: false, reason: 'submitCloseAttestV2: req.closeInputs 缺失(旧格式 request, 无法 submit)' };
  const committeeWitness = buildCommitteeWitness(req.committee_pks, req.committee_meta, sigs);
  const committeePkHash = computeCommitteePkHash(req.committee_pks);
  let sj;
  try {
    sj = await sendCommandAsync(relayId, {
      type: 'bshard_close_attest_v2',
      inputs: req.closeInputs,
      witness: {
        self_out_idx: 0, new_payout_root: req.claimedPayoutRoot, new_attested_winner: req.new_attestedWinner,
        new_bets_root: req.new_betsRoot, new_refund_root: req.new_refundRoot, new_attested_at_ms: req.new_attestedAtMs,
        committee: committeeWitness, committee_pk_hash: committeePkHash,
      },
      outputs: { change_address: opts.changeAddress },
    }, 90_000);
  } catch (e) { return { ok: false, reason: `relay broadcast fail: ${e.message}` }; }
  const txId = sj?.txId || sj?.txid;
  if (!txId) return { ok: false, reason: `no txId in relay response: ${JSON.stringify(sj).slice(0, 200)}` };
  return { ok: true, txId, psContAddress: sj.psContAddress };
}

const SUBMIT_TICK_MS = 30_000;
let submitTimer = null, submitRunning = false;
const SUBMIT_V2_ENABLED = process.env.BSHARD_CLOSE_SUBMIT_V2_ENABLED === '1';

export function startBshardCloseSubmitV2Cron() {
  if (submitTimer) return;
  if (!SUBMIT_V2_ENABLED) {
    console.log('[bshard-close-submit-v2] cron NOT started — BSHARD_CLOSE_SUBMIT_V2_ENABLED!=1 (唯一新造 money-path tick, 默认不自动广播)');
    return;
  }
  setTimeout(() => { bshardCloseSubmitV2Tick().catch(e => console.error('[bshard-close-submit-v2] startup tick:', e.message)); }, 5_000);
  submitTimer = setInterval(() => { bshardCloseSubmitV2Tick().catch(e => console.error('[bshard-close-submit-v2] tick:', e.message)); }, SUBMIT_TICK_MS);
  console.log(`[bshard-close-submit-v2] cron started (${SUBMIT_TICK_MS / 1000}s tick) — BSHARD_CLOSE_SUBMIT_V2_ENABLED=1 (受控 live e2e 模式)`);
}
export function stopBshardCloseSubmitV2Cron() { if (submitTimer) { clearInterval(submitTimer); submitTimer = null; } }

/**
 * _persistAttestedPsState — 事故修复(2026-07-08, pxvml首次实战门①撞到): close_attest_v2 广播+确认
 *   landed 后, 此前【没有任何代码】把 attest 写入的新状态(closed 0→1 + payoutRoot/attestedWinner/
 *   attestedAtMs/betsRootBaked/refundRootBaked)持久化回 payout_shards 表——跟今晚 absorb 那次(J2 修复
 *   1ffe32db)同一根问题的第 4 次现身(NWT #22 命名扩大范围)。复用 _splicePayoutV2CloseRedeem
 *   (bshard-close-enforce.mjs, D2 铁律 byte-exact 已验的单一拼接实现, 不新写一套 offset 逻辑)在
 *   attest 前的 psRedeemHex 上原位写入 5 个新值, 新 outpoint = attest txId:0(self_out_idx 恒 0, 本
 *   witness 结构固定)。写失败不影响 attest 本身已落链的事实(try/catch, 只 log 不 throw, 镜像
 *   _tryEnqueueZkProve 同款"钱路已成立, 记账失败不倒灌回钱路状态"纪律)。
 */
function _persistAttestedPsState(marketId, req, txId) {
  try {
    const preRedeemHex = req.closeInputs.payoutshard.redeem_hex;
    const spliced = _splicePayoutV2CloseRedeem(preRedeemHex, {
      newPayoutRootHex: req.claimedPayoutRoot, newAttestedWinner: req.new_attestedWinner,
      newBetsRootHex: req.new_betsRoot, newRefundRootHex: req.new_refundRoot, newAttestedAtMs: req.new_attestedAtMs,
    });
    sqlite.prepare('UPDATE payout_shards SET payout_redeem_hex = ?, payout_ps_outpoint = ? WHERE logical_market_id = ?')
      .run(spliced, `${txId}:0`, marketId);
    console.log(`[bshard-close-submit-v2] ✅ market=${marketId.slice(-8)} payout_shards 状态持久化(closed=1, outpoint=${txId}:0)`);
  } catch (e) {
    console.error(`[bshard-close-submit-v2] 🔴 market=${marketId.slice(-8)} payout_shards 状态持久化 FAILED (attest 本身已落链, 不受影响, 但下游 zk_handoff 会读到 stale 值): ${e.message}`);
  }
}

/**
 * _tryEnqueueZkProve — 缺件①落地口(J1tn): close_attest_v2 确认 LANDED 后调用, 自动 enqueue 进 zk_prove_jobs
 *   (缺件②·zk-prove-worker.mjs 轮询消费)。**失败不影响 close_attest_v2 本身的已落链状态**——attest 是钱路
 *   已完成的既定事实(closed 0→1 已经落链), enqueue 只是"排队等 ZK 结算"这个下游步骤, enqueue 失败(比如
 *   Σleaf 不守恒/市场未配置 broker fee)应该被看见(alert)而不是让整个 tick 或已经成立的 attest 状态受影响。
 */
function _tryEnqueueZkProve(market, req) {
  try {
    const attestValues = {
      newPayoutRootHex: req.claimedPayoutRoot, newAttestedWinner: req.new_attestedWinner,
      newBetsRootHex: req.new_betsRoot, newRefundRootHex: req.new_refundRoot, newAttestedAtMs: req.new_attestedAtMs,
    };
    // consolidatedPool 还没从链上读出来(readPayoutShardV2AttestedState 在 enqueueZkProveJob 内部才做那步)——
    // 这里只需要它算 broker fee 金额, 用 req.closeInputs.payoutshard.state.consolidated_pool(跟 D2-V2 binding
    // 已核实过的同一个 propose 阶段值, 委员签名时已验过这个字段没被 driver 篡改)。
    const consolidatedPool = req.closeInputs.payoutshard.state.consolidated_pool;
    const feeLeaves = _deriveCloseFeeLeaves(market.id, consolidatedPool);
    if (!feeLeaves) {
      console.log(`[bshard-close-submit-v2] market=${market.id.slice(-8)} 未配置 broker_pk/broker_fee_pct — 暂不支持 ZK-native prove enqueue(§4硬门⑤要求非空fee_leaves), 跳过`);
      return;
    }
    const r = enqueueZkProveJob(sqlite, market.id, req.closeInputs.payoutshard.redeem_hex, attestValues, feeLeaves);
    if (r.skipped) console.log(`[bshard-close-submit-v2] market=${market.id.slice(-8)} zk-prove enqueue skipped: ${r.skipped}`);
    else console.log(`[bshard-close-submit-v2] ✅ market=${market.id.slice(-8)} zk_prove_jobs enqueued jobId=${r.jobId}`);
  } catch (e) {
    console.error(`[bshard-close-submit-v2] 🔴 market=${market.id.slice(-8)} zk-prove enqueue FAILED (attest 本身已落链, 不受影响): ${e.message}`);
  }
}

async function _pollLanded(address, txid, attempts = 15, intervalMs = 2_000) {
  for (let i = 0; i < attempts; i++) {
    try {
      const chk = await sendCommandAsync(SETTLER_RELAY_ID, { type: 'check_utxo_landed', address, txid }, 15_000);
      if (chk?.landed || chk?.found) return true;
    } catch { /* transient, retry */ }
    if (i < attempts - 1) await new Promise((res) => setTimeout(res, intervalMs));
  }
  return false;
}

export async function bshardCloseSubmitV2Tick() {
  if (submitRunning) return { skipped: true };
  submitRunning = true;
  try {
    const pending = sqlite.prepare(`
      SELECT id, metadata FROM pool_markets
      WHERE protocol_version = 'v0.7' AND protocol_status = 'collecting_sigs' AND metadata LIKE '%bshard_close_request_v2%'
    `).all();
    let submitted = 0, notReady = 0, failed = 0, errored = 0, resumed = 0;
    for (const market of pending) {
      let req;
      try { req = JSON.parse(market.metadata || '{}').bshard_close_request_v2; } catch { errored++; continue; }
      if (!req || !req.claimedPayoutRoot || !req.closeInputs) { errored++; continue; }

      // 崩溃恢复分支(NWT tree-diff 终审发现, 2026-07-07): 上一轮已经 broadcast 成功过(txId 已持久化)但
      // landed-check 窗口内没确认——只查这一笔具体 txId 的现状, 不重新走 collect+submit(不会又构造+广播一笔新 tx)。
      const pendingTx = req.bshard_close_submit_v2_pending_txid;
      if (pendingTx?.txid) {
        const landedNow = await _pollLanded(pendingTx.psContAddress, pendingTx.txid, 1, 0);
        if (landedNow) {
          _persistAttestedPsState(market.id, req, pendingTx.txid);
          clearCloseRequest(market.id, 'attested_v2');
          _tryEnqueueZkProve(market, req);
          submitted++;
          console.log(`[bshard-close-submit-v2] ✅ (resumed) market=${market.id.slice(-8)} close_attest_v2 LANDED txId=${pendingTx.txid}`);
        } else {
          resumed++;
          console.log(`[bshard-close-submit-v2] market=${market.id.slice(-8)} 上轮已 submit(txId=${String(pendingTx.txid).slice(0,12)}) 仍未 landed — 本轮只查不重 broadcast`);
        }
        continue;
      }

      const { ready, sigs } = collectCloseSigsV2(market.id, req.claimedPayoutRoot, req.new_attestedAtMs);
      if (!ready) { notReady++; continue; }
      if (!SETTLER_RELAY_ID) { errored++; console.error('[bshard-close-submit-v2] BSHARD_SETTLER_RELAY_ID unset — 无法 submit'); continue; }
      let changeAddress;
      try { changeAddress = (await sendCommandAsync(SETTLER_RELAY_ID, { type: 'get_pubkey' }))?.address; } catch (e) { errored++; console.error(`[bshard-close-submit-v2] get_pubkey fail: ${e.message}`); continue; }
      if (!changeAddress) { errored++; continue; }
      const r = await submitCloseAttestV2(market.id, req, sigs, { relayId: SETTLER_RELAY_ID, changeAddress });
      if (!r.ok) { failed++; console.warn(`[bshard-close-submit-v2] market=${market.id.slice(-8)} submit fail: ${r.reason}`); continue; }
      // 持久化 txId(NWT 修复要求): 广播成功即写, 不等 landed-check 窗口结束——否则窗口内 false-negative(RPC 瞬时
      // 延迟)会导致下轮 tick 重新走 collect+submit, 真广播了第二笔 tx(NO TX NO STATE 之外的另一类问题: 不是钱丢了,
      // 是同一市场可能产生多笔冲突 broadcast, 且若第一笔其实已经 landed, market 会永久卡在 collecting_sigs 没人发现)。
      markSubmittedV2(market.id, r.txId, r.psContAddress);
      // NO TX NO STATE CHANGE (CLAUDE.md 第零条 bis): 广播成功不等于落链——必须确认 landed 才推进 status/清 request,
      // 否则 broadcast 声称成功但 tx 被节点拒绝/mempool 丢弃时, DB 会乐观地记成"已提交"而链上其实什么都没发生。
      const landedOk = await _pollLanded(r.psContAddress, r.txId);
      if (!landedOk) { failed++; console.warn(`[bshard-close-submit-v2] market=${market.id.slice(-8)} txId=${r.txId} broadcast OK 但等待窗口内未确认 landed — txId 已持久化(bshard_close_submit_v2_pending_txid), 下轮 tick 只查这一笔, 不重复 broadcast`); continue; }
      _persistAttestedPsState(market.id, req, r.txId);
      clearCloseRequest(market.id, 'attested_v2');   // 独立 status 值, 跟 V1 completed/refunding 区分——后续链条(zk_handoff)接手。
      _tryEnqueueZkProve(market, req);
      submitted++;
      console.log(`[bshard-close-submit-v2] ✅ market=${market.id.slice(-8)} close_attest_v2 LANDED txId=${r.txId}`);
    }
    if (submitted || failed || errored || resumed) console.log(`[bshard-close-submit-v2] tick: ${pending.length} pending | submitted=${submitted} notReady=${notReady} failed=${failed} errored=${errored} resumed=${resumed}`);
    return { ok: true, pending: pending.length, submitted, notReady, failed, errored, resumed };
  } finally { submitRunning = false; }
}
