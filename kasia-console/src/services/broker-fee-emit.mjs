// broker-fee-emit.mjs — broker_fee_landed chain_event emitter (J2, 2026-06-28).
//
// Owner 主线: broker 佣金到账 DM 推送。consumer 侧 = tg-bot poller notifyLine 'broker_fee_landed' (KANet-UI d1f68dd1)。
// 本模块 = emit 侧。设计档: docs/2026-06-28-broker-fee-landed-emit-pass-spec.md。
//
// 诚实口径铁律 (Bettor 不超卖): DM 只在【链上 LANDED fee】触发·金额从 kaspa_tx_log.outputs_json 取·**禁 DB 估算**。
//   ∴ emit 不在 settle-submit 点 (那时 settle TX 刚提交·kaspa_tx_log 没 index) — 而是独立 post-index pass:
//   等 settle TX 进 kaspa_tx_log 再从 outputs_json 按 broker 地址取真金额 emit (镜像 path-b reconcile)。
//
// 幂等: pool_markets.metadata.broker_fee_landed_emitted_at 标记 (一盘一次·防重复 DM)。
// backfill-suppress (Bettor 采纳): 首次运行把【现存】completed 盘标记已 emit (不 emit DM)·只 deploy 后【新】settle
//   推 DM (历史佣金走 /earnings 汇总)。restart-safe: 一次性 backfill 由 sentinel chain_event 'broker_fee_emit_backfill' 守。
//
// DI 设计 (offline 可测): db + deriveBrokerAddress 注入·test 用 temp DB + stub deriver。
//
// 查漏补缺(2026-07-04, Owner 点破"多路并行没模块化"): 这个文件跟 lib/broker-fee-chain.mjs 曾各自
// 维护一份"在 kaspa_tx_log.outputs_json 里找给某地址的 output 金额"逻辑——收拢成 findAddressOutputSompi
// 单一权威, 这里只保留 emit 侧独有的东西(候选筛选/幂等标记/DM 事件写入)。

import { getIndexedTxOutputs } from '../lib/broker-fee-chain.mjs';
import { sqlite } from '../db/client.js';
// B线深化件1(2026-07-12, 设计 docs/2026-07-12-broker-fee-emit-package-live-switch-design.md v1.2,
// Owner"broker自动分发独立功能深化"直令+双审GO): live 切换到 package(notify层)——补落3自己点名的 gap
// (package 建好没 live 路径吃到)。deriveRoleFeeLeaves 用 kasia-console 自己的规范源(lib/fee-split.mjs,
// 已是 pool-shard-settle.mjs 等既有消费者用的那份);matchLandedFeeOutputs/emitLandedNotification 只在
// packages/fee-split/notify.mjs 存在(package 原生功能, 无 kasia-console 内部副本——单源两个家各司其职)。
import { deriveRoleFeeLeaves } from '../lib/fee-split.mjs';
import { matchLandedFeeOutputs, emitLandedNotification } from '../../../packages/fee-split/notify.mjs';
// 🔴 poolSompi 单源修正(NWT 红队 2026-07-12 7pori 实盘撞见, #hm0tdn 追加): 初版误用
// maker_stake_amount + Σ(pool_bettor_sides), 抄的是 pool-shard-settle.mjs ZK V2 consolidatedPool 惯例
// (含 maker/seed)——但 V1 bshard 真实结算(computeSettlePlan, bshard-auto-settler.mjs:112 注释"pool 基数=
// V1 口径 Σ注")的权威单源是 getMarketBets(pool-bettor-sides-query.mjs), 其注释明写"排 maker_stake/
// commingled 杂质" — 故意不含 maker 自己的 stake。两条惯例基数不同(V1 只算 bettor 注, ZK V2 含 seed),
// 混用 = 独立断言拿错基数, 触发假 CRITICAL mismatch(安全网接住不花错钱, 但断言本身算错)。改调用与
// computeSettlePlan 完全同源的 getMarketBets, 不再自己拼基数。
import { getMarketBets } from '../lib/pool-bettor-sides-query.mjs';

// J1tn 2026-07-08 (§2.1 broker-fee-reconciler-design 启用件): 本模块此前写好但零调用点(index.js 从没
//   import 过) — Owner 直接指令"之前有这个模块没启用,查!"坐实。这里只做"接上一根已经焊好的线",
//   不改 brokerFeeLandedEmitTick 本体一个字。deriveBrokerAddress 用跟 pool.js:143 同源的
//   XOnlyPublicKey(pk).toAddress(network) 派生(逐字节同一算法,不新开一套)。
const TICK_MS = 5 * 60 * 1000;   // 同 broker-state-reconciler.js 既有 5min 档,同类只读链 cron 惯例
let _interval = null;
let _kaspaWasm = null;   // kaspa-wasm 全库只 dynamic import 一次(codebase 既有惯例, 非静态 import), 缓存复用

async function _tick() {
  try {
    if (!_kaspaWasm) _kaspaWasm = await import('kaspa-wasm');
    const deriveBrokerAddress = (brokerPkHex, network) => new _kaspaWasm.XOnlyPublicKey(brokerPkHex).toAddress(network).toString();
    brokerFeeLandedEmitTick(sqlite, deriveBrokerAddress, (msg) => console.log(msg));
  } catch (e) { console.error(`[broker-fee-emit] tick error: ${e.message}`); }
}

export function startBrokerFeeEmitCron() {
  if (_interval) return;
  console.log(`[broker-fee-emit] cron start, tick=${TICK_MS}ms`);
  _interval = setInterval(_tick, TICK_MS);
  setTimeout(_tick, 5000);   // startup pass (同 broker-buy-completion-watcher 等既有 cron 惯例, 不等第一个 tick 周期)
}
export function stopBrokerFeeEmitCron() { if (_interval) { clearInterval(_interval); _interval = null; } }

// ⚠ event_type 必【不以 'broker_' 开头】: migrate v83 trigger chain_events_txid_format_check 对 broker_* 事件
//   强制 txid=64-hex chain hash (禁 placeholder)。sentinel 是内部标记无真 txid → 用非 broker_ 前缀绕开 trigger。
const SENTINEL_EVENT = 'fee_emit_backfill_done';

/**
 * 一次性 backfill-suppress: 把现存 completed (broker_pk 非空·无 emit 标记) 盘标记已 emit (不 emit DM)。
 * 由 sentinel chain_event 守 → restart-safe·只跑一次。返回被抑制的盘数。
 */
export function ensureBackfillSuppressed(db) {
  const done = db.prepare(`SELECT 1 FROM chain_events WHERE event_type = '${SENTINEL_EVENT}' LIMIT 1`).get();
  if (done) return 0;
  const ts = new Date().toISOString();
  const res = db.prepare(`
    UPDATE pool_markets
       SET metadata = json_set(COALESCE(metadata, '{}'), '$.broker_fee_landed_emitted_at', ?)
     WHERE protocol_status = 'completed' AND broker_pk IS NOT NULL
       AND json_extract(COALESCE(metadata, '{}'), '$.broker_fee_landed_emitted_at') IS NULL
  `).run('backfill_suppressed:' + ts);
  db.prepare(`
    INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
    VALUES (lower(hex(randomblob(16))), ?, '${SENTINEL_EVENT}', NULL, NULL, ?, 'pool-settler', CURRENT_TIMESTAMP)
  `).run('broker_fee_emit_backfill:' + ts, JSON.stringify({
    suppressed: res.changes, at: ts,
    note: 'backfill-suppress: 现存 completed 盘标记已 emit (无 DM); 只 deploy 后新 settle emit; 历史走 /earnings',
  }));
  return res.changes;
}

/**
 * brokerFeeLandedEmitTick — scan completed markets, emit broker_fee_landed for those whose settle TX has
 *   landed in kaspa_tx_log with a broker fee output. 链验金额·幂等·非 DB 估。
 * @param {object}   db                   better-sqlite3 handle
 * @param {function} deriveBrokerAddress  (brokerPkHex, network) => kaspa address string (XOnlyPublicKey 派生·与 settle 同源)
 * @param {function} [log]                optional logger
 * @returns {{ backfillSuppressed:number, emitted:number, pendingIndex:number, noBrokerOutput:number, scanned:number }}
 */
export function brokerFeeLandedEmitTick(db, deriveBrokerAddress, log = () => {}) {
  const backfillSuppressed = ensureBackfillSuppressed(db);

  // 候选: broker_pk·尚未 emit (无 metadata 标记), 且满足以下两条落地形态之一——
  //   V1/legacy: protocol_status='completed' + settle_txid (单笔 settle tx, broker fee 是其次级 output)。
  //   ZK-native: zk_continuation.exhausted=1 (bshard-settle-daemon.mjs:520 completed/settle_txid 这两个字段
  //     ZK 路径从不写, closezk-v2-mint.mjs:advanceZkContinuationAfterSpend 只推进 zk_continuation——0 行根因,
  //     见 2026-07-10 频道排查+docs/2026-07-09-zk-autonomy-three-parts-design.md)。ZK 路 broker fee 是独立
  //     一笔 claim tx(feeLeaves 之一, 跟 winner payout 分开广播), 下方按 metadata.zk_escape_audit[] 逐笔核对。
  const candidates = db.prepare(`
    SELECT id, broker_pk, settle_txid, spine_p2sh, resolution_rule_spec, metadata, fee_rules, maker_stake_amount
      FROM pool_markets
     WHERE broker_pk IS NOT NULL
       AND json_extract(COALESCE(metadata, '{}'), '$.broker_fee_landed_emitted_at') IS NULL
       AND (
         (protocol_status = 'completed' AND settle_txid IS NOT NULL)
         OR json_extract(COALESCE(metadata, '{}'), '$.zk_continuation.exhausted') = 1
       )
  `).all();

  let emitted = 0, pendingIndex = 0, noBrokerOutput = 0, packageFallback = 0;
  for (const m of candidates) {
    const network = String(m.spine_p2sh || '').startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
    let brokerAddress;
    // 🔴 broker_pk 传【as-stored】(不 lowercase) — 与 settle 路 L1681 `XOnlyPublicKey(market.broker_pk).toAddress`
    //   逐字节同源·保证派生地址 == settle TX broker output 地址 (case-normalize 会与 settle 不一致→漏 output)。
    try { brokerAddress = deriveBrokerAddress(String(m.broker_pk), network); }
    catch (e) { log(`[broker-fee-emit] broker pk→addr fail market=${m.id.slice(0, 12)}: ${e.message}`); noBrokerOutput++; continue; }
    if (!brokerAddress) { noBrokerOutput++; continue; }

    // 落地 txid 解析: V1 = 单笔 settle_txid(既有逻辑不变); ZK-native = settle_txid 为空, 从
    //   metadata.zk_escape_audit[] 里 entry==='claim' 的每笔 txid 里找 outputs 命中 broker 地址的那笔
    //   (跟 V1 同一套"按地址匹配"原语, 只是候选 txid 从"1笔"变成"逐笔扫 claim 列表")。
    let landedTxid = null, outs = null;
    if (m.settle_txid) {
      // settle TX indexed? (NO TX NO STATE: 没 index 就不 emit·下 tick 重试)
      // 共享原语(lib/broker-fee-chain.mjs::getIndexedTxOutputs) — 这里跟 earnings endpoint 曾各写
      // 一份等价的 raw SQL + JSON.parse, 收拢成一份(Owner 点破"多路并行"后的整顿第一刀)。
      outs = getIndexedTxOutputs(m.settle_txid, db);
      if (!outs || !outs.length) { pendingIndex++; continue; }
      landedTxid = m.settle_txid;
    } else {
      let meta; try { meta = JSON.parse(m.metadata || '{}'); } catch { meta = {}; }
      const claimTxids = (meta.zk_escape_audit || []).filter(e => e && e.entry === 'claim').map(e => e.txid);
      let anyUnindexed = false;
      for (const txid of claimTxids) {
        const candOuts = getIndexedTxOutputs(txid, db);
        if (!candOuts) { anyUnindexed = true; continue; }
        if (candOuts.some(o => o && o.address === brokerAddress)) { outs = candOuts; landedTxid = txid; break; }
      }
      if (!landedTxid) {
        if (anyUnindexed) { pendingIndex++; continue; }   // 还有 claim tx 未 index — 下 tick 重试
        // 全部 claim tx 已 index, 没有一笔付给 broker(= broker_fee_pct=0/无 broker leaf) — 终态标记, 不再每 tick 空扫。
        markEmitted(db, m.id, { skipped: 'no_broker_output_zk' });
        noBrokerOutput++;
        log(`[broker-fee-emit] market=${m.id.slice(0, 12)} (zk-native) 全部 claim tx 已 index 但无 broker output (addr=${brokerAddress.slice(0, 16)}) → 标记跳过`);
        continue;
      }
    }

    // 按【地址】匹配 broker output (fee 常是次级 output·非 to_address 列 — reference-verify-covenant-multiout-distribution)。
    let idx = outs.findIndex(o => o && o.address === brokerAddress);
    // 🔴 threaded-claim fallback(Owner 直令修 notify 层, fw9kk 实盘撞见 #hnppoc.2 后续): 上面的
    //   outs 来自 m.settle_txid(= close_txid)——V1/legacy 老架构里 close tx 自带全部 payout output,
    //   但 bshard "threaded claim" 架构下 close_txid 只做 covenant closed 0→1(零 payout output),
    //   真正打款在【每个 payout leaf 各自独立的 claim tx】里(settleMarketLive 逐笔广播)。close tx
    //   里找不到 broker output ≠ broker 没收到钱, 只是这次 outs 来源覆盖不到那笔 tx。降级前先查
    //   metadata.settle_evidence.winner_details(settleMarketLive 写入的逐 leaf pk→{amount,txId}明细,
    //   已链验 received===true 才计入)——命中则改用那笔真实 claim tx 的 output 作为 outs/landedTxid,
    //   非瞎猜金额(仍是链读值, 只是从另一份已验证的链读结果里取, 同 NO-TX-NO-STATE 纪律)。
    if (idx < 0 && m.settle_txid) {
      let meta2; try { meta2 = JSON.parse(m.metadata || '{}'); } catch { meta2 = {}; }
      const winnerDetails = meta2.settle_evidence?.winner_details;
      const brokerClaim = Array.isArray(winnerDetails)
        ? winnerDetails.find(w => w && String(w.pk).toLowerCase() === String(m.broker_pk).toLowerCase())
        : null;
      if (brokerClaim && brokerClaim.txId && Number.isFinite(Number(brokerClaim.amount)) && Number(brokerClaim.amount) > 0) {
        // 🔴 加固(Bettor 批, NWT 原'received字段'建议被真实数据形状证伪 #hnppoc.2 后续——winner_details
        //   条目形状={pk,amount,txId}, 没有 received 字段, received 只用于【构造前】filter 不进条目本身,
        //   照字面查会让条件永假、fallback 永死): 不直接信 metadata 报的 amount, 对 claim txid 独立走
        //   getIndexedTxOutputs 现读链上真实 output——跟 V1 直查 settle_txid 同款验证动作, 只是验证对象
        //   换成这笔独立 claim tx。链锚验证严格强于任何 DB 字段, metadata 只提供"该查哪笔 tx"的路由信息。
        const claimOuts = getIndexedTxOutputs(brokerClaim.txId, db);
        if (!claimOuts) {
          pendingIndex++;
          log(`[broker-fee-emit] market=${m.id.slice(0, 12)} claim tx ${String(brokerClaim.txId).slice(0, 12)} 未 index, 下 tick 重试`);
          continue;
        }
        const claimIdx = claimOuts.findIndex(o => o && o.address === brokerAddress);
        if (claimIdx >= 0 && String(claimOuts[claimIdx].amount_sompi) === String(brokerClaim.amount)) {
          outs = claimOuts;
          landedTxid = brokerClaim.txId;
          idx = claimIdx;
          log(`[broker-fee-emit] market=${m.id.slice(0, 12)} close_txid 无 broker output, 从 claim tx ${String(brokerClaim.txId).slice(0, 12)} 链上独立核对到真实 output(threaded-claim 架构, 非 V1 单 tx)`);
        } else {
          log(`[broker-fee-emit] market=${m.id.slice(0, 12)} 🔴 CRITICAL claim tx ${String(brokerClaim.txId).slice(0, 12)} 链上核对不吻合 metadata 声称值(claimIdx=${claimIdx}, 声称amount=${brokerClaim.amount}) — 不信 metadata, 降级走既有 no_broker_output 路`);
        }
      }
    }
    if (idx < 0) {
      // broker fee 没单独 output (=0 / below-floor / 无 broker) — 标记已 emit 防每 tick 重扫·不 emit 幻象。
      markEmitted(db, m.id, { skipped: 'no_broker_output' });
      noBrokerOutput++;
      log(`[broker-fee-emit] market=${m.id.slice(0, 12)} settle_txid=${String(landedTxid).slice(0, 12)} 无 broker output (addr=${brokerAddress.slice(0, 16)}) → 标记跳过`);
      continue;
    }

    const feeSompi = Number(outs[idx].amount_sompi || 0);
    if (!Number.isFinite(feeSompi) || feeSompi <= 0) { markEmitted(db, m.id, { skipped: 'zero_fee' }); noBrokerOutput++; continue; }

    // §2.2(金额精确核对)暂缓落码(J1tn 2026-07-08 撞到真复杂度, 诚实标注不硬写):
    //   真实 broker fee 公式在 pool-market-settler.js:computePoolPayouts() —— brokerFeePct 是【调用方传入
    //   的参数】(非固定读某一列, market.broker_fee_pct 只是其中一种传法) + 有 minBrokerFee 底价 floor
    //   (MIN_BROKER_FEE_SOMPI, 薄池场景会把 floor 值顶到比 pct 算出来的高)。要精确复现"这次结算实际用的
    //   期望值", 必须完整重建 computePoolPayouts 的 participants/winner/minerFee 等全部输入调用它本体,
    //   不是"pool × bps / 10000"这一行能糊弄的——写一个简化公式进钱路告警系统, 算出来的"期望值"本身就
    //   可能是错的, 会制造比"没有这层检查"更糟的假警报噪音。排非阻塞待办, 需要跟 settle domain owner
    //   (J2)对齐"复用 computePoolPayouts 本体需要重建哪些输入"这条再往下写, 不猜公式硬上。
    let marketTitle = m.id;
    try { const spec = JSON.parse(m.resolution_rule_spec || '{}'); marketTitle = spec.title || spec.question || m.id; } catch {}

    // B线深化件1(package live 切换, 设计 v1.2 §2.1/§2.2 分族): onLanded 复用旧 payload 形状字节不变
    //   (byte-equal 护栏, fee-single-source.test.mjs 守), 只加 verification 新字段(纯附加, Bettor 注1 MUST)。
    const onLanded = (notif) => {
      const feeSompiOut = Number(notif.amountSompi);
      const payload = JSON.stringify({
        t: 'broker_fee_landed',
        market_id: m.id,
        broker_pk: String(m.broker_pk).toLowerCase(),
        broker_address: notif.address,
        fee_sompi: feeSompiOut,             // 🔴 链验真金额 (kaspa_tx_log.outputs_json)·非 DB 估
        settle_txid: notif.txid || landedTxid,
        output_index: notif.outputIndex,
        market_title: marketTitle,
        landed_at: new Date().toISOString(),
        verification: onLanded._verification,   // 'independent'(§2.1 fee_rules 真断言) | 'discovered'(§2.2 discover-then-trust, vacuous-pass 诚实标注)
      });
      // 🔴 txid = landedTxid (真 64-hex chain hash·满足 v83 trigger broker_* 禁 placeholder)。UNIQUE(txid,event_type) 防竞态重 emit。
      db.prepare(`
        INSERT OR IGNORE INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
        VALUES (lower(hex(randomblob(16))), ?, 'broker_fee_landed', ?, ?, ?, 'pool-settler', CURRENT_TIMESTAMP)
      `).run(String(notif.txid || landedTxid), m.spine_p2sh || null, notif.address, payload);
      markEmitted(db, m.id, { emitted_fee_sompi: feeSompiOut, settle_txid: notif.txid || landedTxid, verification: onLanded._verification });
      emitted++;
      log(`[broker-fee-emit] 💰 market=${m.id.slice(0, 12)} broker fee ${(feeSompiOut / 1e8).toFixed(4)} KAS LANDED (tx ${String(notif.txid || landedTxid).slice(0, 12)} out#${notif.outputIndex}, verification=${onLanded._verification}) → broker_fee_landed emit`);
    };

    // 🔴 旧路径 fallback(Bettor §4 MUST, 失败降级): package 路径任何异常/不可信 match(mismatch/unmatched)
    //   都不阻断 broker 到账通知——退回既有直写(byte-equal 于切换前), 只是走的是"备用网", 记一次 fallback。
    const legacyDirectEmit = () => {
      const payload = JSON.stringify({
        t: 'broker_fee_landed', market_id: m.id, broker_pk: String(m.broker_pk).toLowerCase(),
        broker_address: brokerAddress, fee_sompi: feeSompi, settle_txid: landedTxid, output_index: idx,
        market_title: marketTitle, landed_at: new Date().toISOString(), verification: 'discovered',
      });
      db.prepare(`
        INSERT OR IGNORE INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
        VALUES (lower(hex(randomblob(16))), ?, 'broker_fee_landed', ?, ?, ?, 'pool-settler', CURRENT_TIMESTAMP)
      `).run(String(landedTxid), m.spine_p2sh || null, brokerAddress, payload);
      markEmitted(db, m.id, { emitted_fee_sompi: feeSompi, settle_txid: landedTxid, verification: 'discovered', fallback: true });
      emitted++;
      packageFallback++;
      log(`[broker-fee-emit] 💰 market=${m.id.slice(0, 12)} broker fee ${(feeSompi / 1e8).toFixed(4)} KAS LANDED (tx ${String(landedTxid).slice(0, 12)} out#${idx}, FALLBACK 直写路径) → broker_fee_landed emit`);
    };

    let usedFallback = false;
    try {
      // 分族判据钉死(Bettor 注3 MUST + NWT 核实吻合): fee_rules 非空 且(resolution_rule_spec 非 zk_native) →
      //   §2.1 独立断言族;否则(存量 V1 legacy / ZK 市场,绝大多数现存候选)→ §2.2 discover-then-trust 族。
      let isZkNative = false;
      try { isZkNative = JSON.parse(m.resolution_rule_spec || '{}')?.zk_native === true; } catch {}
      const feeRules = (m.fee_rules && !isZkNative) ? JSON.parse(m.fee_rules) : null;

      let feeLeaves, leafAddresses, verification;
      if (feeRules) {
        // §2.1: poolSompi 独立链读(同结算时口径)——单源 getMarketBets(与 computeSettlePlan 完全同源
        //   同基数, 见文件头 import 注释), 非自拼 maker_stake_amount+sides(V1 真实基数不含 maker)。
        const { poolSompi: poolSompiStr } = getMarketBets(m.id, db);
        const derived = deriveRoleFeeLeaves(feeRules, poolSompiStr);
        const brokerLeaf = derived.feeLeaves.find(l => l.type === 'broker');
        if (!brokerLeaf) throw new Error(`fee_rules 无 broker leaf(bps=0/角色缺席) 但已发现链上 broker output — 结构不一致, 降级`);
        feeLeaves = [brokerLeaf];
        leafAddresses = [brokerAddress];   // brokerLeaf.pk 应 == m.broker_pk(同源派生), 复用已算好的 brokerAddress 不重复派生
        verification = 'independent';
      } else {
        // §2.2: 把"发现值"当"期望值"喂给 package(结构性必 matched, 断言 vacuous — Bettor 注1 已诚实标注)。
        // lint-allow-chain-amount-precision: feeSompi 是 sompi 整数(kaspa_tx_log 链读, 已 Number() 化非 KAS
        //   小数), 本 amount 字段是 package feeLeaves 内部数据结构(非直发 wallet API 的 chain TX 广播字段)——
        //   KI-30 真正守的是 KAS 小数 17-decimal 浮点误差, sompi 整数无此风险(Bettor r181 场景不适用)。
        feeLeaves = [{ pk: String(m.broker_pk).toLowerCase(), amount: String(feeSompi), type: 'broker' }];
        leafAddresses = [brokerAddress];
        verification = 'discovered';
      }

      const outputsForMatch = outs.map(o => ({ address: o && o.address, amount: String((o && o.amount_sompi) || 0), txid: landedTxid }));
      const matchResults = matchLandedFeeOutputs(outputsForMatch, feeLeaves, leafAddresses);
      const brokerResult = matchResults[0];
      if (brokerResult.state === 'matched') {
        onLanded._verification = verification;
        const n = emitLandedNotification([brokerResult], { onLanded });
        if (n !== 1) throw new Error(`emitLandedNotification 预期投递1条实投${n}条`);
      } else {
        // mismatch/unmatched 只应在 §2.1(独立断言)族出现(§2.2 结构性必过) — 真实完整性告警, 大声记录后降级。
        log(`[broker-fee-emit] 🔴 CRITICAL market=${m.id.slice(0, 12)} package 断言 ${brokerResult.state}(verification=${verification}) — 期望 leaf=${JSON.stringify(feeLeaves[0])} vs 链上发现 fee_sompi=${feeSompi} — 降级 fallback 直写(不阻断 broker 到账通知, 需人工核 fee_rules/bps 配置)`);
        usedFallback = true;
        legacyDirectEmit();
      }
    } catch (e) {
      log(`[broker-fee-emit] ⚠ market=${m.id.slice(0, 12)} package 路径异常(${e.message}) → fallback 直写`);
      usedFallback = true;
      legacyDirectEmit();
    }
    recordSunsetTracking(db, { fellBack: usedFallback });
  }

  if (backfillSuppressed || emitted || noBrokerOutput) {
    log(`[broker-fee-emit] tick: backfillSuppressed=${backfillSuppressed} scanned=${candidates.length} emitted=${emitted} pendingIndex=${pendingIndex} noBrokerOutput=${noBrokerOutput} packageFallback=${packageFallback}`);
  }
  return { backfillSuppressed, emitted, pendingIndex, noBrokerOutput, packageFallback, scanned: candidates.length };
}

function markEmitted(db, marketId, extra) {
  const stamp = JSON.stringify({ at: new Date().toISOString(), ...extra });
  db.prepare(`
    UPDATE pool_markets
       SET metadata = json_set(COALESCE(metadata, '{}'), '$.broker_fee_landed_emitted_at', ?)
     WHERE id = ?
  `).run(stamp, marketId);
}

// 🔴 Bettor 注2(MUST, 双路径日落条件, 设计 v1.2 §4): fallback 安全网若无限期保留 = drift 温床(规则55族)。
//   连续 20 笔 或 首次连胜起 7 天(取先到者)live emit 全走 package 路径、零次 fallback → sunsetReady=true,
//   大声 log 提醒立 follow-up 卡删除 legacyDirectEmit()。任一次 fallback 触发即清零连胜(不允许"凑够20笔里混几次
//   fallback"蒙混过关)。持久化用既有 config_entries k/v(monitor-service.js 同款 upsert 惯例, 非新表)。
export function recordSunsetTracking(db, { fellBack }) {
  const now = new Date().toISOString();
  const existing = db.prepare(`SELECT id, value_plain_hint FROM config_entries WHERE key = ? AND category = ?`).get('package_path_streak', 'broker_fee_emit');
  let state = { consecutiveSuccess: 0, fallbackCount: 0, firstSuccessAt: null, sunsetReady: false };
  if (existing) { try { state = { ...state, ...JSON.parse(existing.value_plain_hint) }; } catch {} }
  if (fellBack) {
    state.consecutiveSuccess = 0;
    state.firstSuccessAt = null;
    state.fallbackCount = (state.fallbackCount || 0) + 1;
    state.sunsetReady = false;
  } else {
    if (!state.firstSuccessAt) state.firstSuccessAt = now;
    state.consecutiveSuccess = (state.consecutiveSuccess || 0) + 1;
    const daysSinceFirst = (Date.now() - new Date(state.firstSuccessAt).getTime()) / 86400000;
    state.sunsetReady = state.consecutiveSuccess >= 20 || daysSinceFirst >= 7;
  }
  state.updatedAt = now;
  const val = JSON.stringify(state);
  if (existing) db.prepare(`UPDATE config_entries SET value_plain_hint = ?, updated_at = ? WHERE id = ?`).run(val, now, existing.id);
  else db.prepare(`INSERT INTO config_entries (id, key, category, value_plain_hint, is_sensitive, updated_at, created_at) VALUES (lower(hex(randomblob(16))), 'package_path_streak', 'broker_fee_emit', ?, 0, ?, ?)`).run(val, now, now);
  if (state.sunsetReady) {
    console.warn(`[broker-fee-emit] 🔔 日落触发器命中(连续${state.consecutiveSuccess}笔零fallback) — Bettor 注2 MUST: 该立 follow-up 卡删除 legacyDirectEmit() 直写分支, 停止双路径共存`);
  }
  return state;
}
