// proto-settlement-pointers.mjs — 批9 9-1 D 笔: 结算各步"预期输入指针"模块(设计 v0.3.4 §18.1 S10 八格表 / §19.2)。
//
// 做什么: 给定 (step, marketId), 从两张意图表(proto_bet_intents / proto_settlement_intents)里已 landed 的产出交易的 prepared_tx_json 推算该步每个 covenant 输入的
//   【预期 outpoint】与【预期 covenantId】, 交给 C 笔的 verifyStepInputsOnChain 去链上取证并断言相等(M6)。指针只是"预期"(§18.1 不变量 4):
//   DB 被本机写者改错 ⇒ C1 报 missing / outpoint_drift / covenant_class_mismatch ⇒ 该步 fail-closed, 不会花错 UTXO。
//
// 八格(步骤·角色 → 来源): 1 seal·leaf / 2 seal·held ← 最新 landed append 的输出 0 / 2; 3 close_commit·rootClose ← seal 意图输出 0;
//   4 convert_to_claim·rootClose ← close_commit(intent step='resolve')输出 0; 5 convert_to_claim·held ← seal 输出 1;
//   6 claim_draw·rootClaim / 7 claim_draw·held ← convert_to_claim 输出 0 / 1; 8 claim_draw·ticket ← 赢家那一条下注的 landed append 输出 1(无 covenant)。
//
// 🔴 读取纪律(§18.1 不变量 1, NWT N91-2 在本仓 wasm 上实测):
//   ① `deserializeFromSafeJSON` 沿用 JSON 自带的 id、【不重算】⇒ 必须 `finalize()` 后再与 submitted_txid 比对, 否则"txid 一致"是空判据;
//   ② 只从 finalize() 之后的交易对象读, 且只读【被 txid 覆盖】的字段: 输出的面值 / spk / covenantId / authorizingInput、输入的 previousOutpoint;
//      明确不读 inputs[].utxo、signatureScript、computeBudget、sigOpCount(改了 id 不变——测试 P9c 钉死)。
// 🔴 genesis 组输出(append 的 KTT、seal 的 RootClose 与代币、convert_to_claim 的 RootClaim 与代币)的 covenantId 另用 kaspa.covenantId(authorizing 输入 outpoint, [该输出]) 独立重算并要求相等:
//   目的是【校验 builder 的 genesis 派生没有 bug】(多一个独立来源, 成本≈0), 不是防 DB 篡改(txid 已经绑了)。续约输出(append 的 leaf、close_commit 的 RootClose)没有派生, 不做重算。
//
// 纯读: 只读 DB(db 注入)、不碰 RPC、不碰私钥、不写任何东西。kaspa 由调用方注入(本文件不 import kaspa-wasm)。9-1 仍无生产调用方。
// 🟢 (F3, NWT D-2) import 本模块【不再打开默认库】: 导入图里没有 db/client.js(deriveWinnerBet 住在 proto-winner-bet.mjs、encodeLeafStateBytes 住在 proto-leaf-state-encode.mjs)——
//   测试用子进程在【无 DB_PATH】下真 import 它来证明(而不是只扫本文件的 import 行)。

import { computeTicketGenesisArtifact } from './proto-covenant-builder.mjs';
import { deriveWinnerBet } from './proto-winner-bet.mjs';   // 9-1 F3: 不碰 DB 的文件(原来经 proto-settlement-inputs.mjs 会带上 db/client.js)
import { REGISTER_APPEND_LEAF_CONT_OUT_INDEX, REGISTER_APPEND_TICKET_OUT_INDEX, REGISTER_APPEND_TOK_OUT_INDEX } from './proto-tx-assembly.mjs';
import {
  MARKET_SEAL_ROOTCLOSE_OUT_INDEX, MARKET_SEAL_TOKEN_OUT_INDEX, MARKET_SEAL_LEAF_IN_INDEX, MARKET_SEAL_HELD_IN_INDEX,
  CLOSE_COMMIT_ROOTCLOSE_OUT_INDEX, CLOSE_COMMIT_ROOTCLOSE_IN_INDEX,
  CONVERT_TO_CLAIM_CLAIM_OUT_INDEX, CONVERT_TO_CLAIM_TOKEN_OUT_INDEX, CONVERT_TO_CLAIM_ROOTCLOSE_IN_INDEX, CONVERT_TO_CLAIM_HELD_IN_INDEX,
} from './proto-tx-assembly-settlement.mjs';

const HEX64 = /^[0-9a-f]{64}$/;
const STEPS = Object.freeze(['seal', 'close_commit', 'convert_to_claim', 'claim_draw']);

/** 指针失败: `.code` 取闭集(pointerCodes()); 另带 `.step` / `.role` / `.detail`。任何失败 ⇒ 该步不构造、不推进状态(NO TX NO STATE)。 */
export class PointerError extends Error {
  constructor(code, detail, { step, role } = {}) {
    super(`${code}: ${detail}`);
    this.name = 'PointerError';
    this.code = code;
    this.detail = detail;
    this.step = step;
    this.role = role;
  }
}

export function pointerCodes() {
  return Object.freeze([
    'pointer_dependency_not_landed', 'pointer_tx_missing', 'pointer_tx_malformed', 'pointer_txid_mismatch', 'pointer_output_missing',
    'pointer_lineage_mismatch', 'pointer_covenant_inconsistent', 'pointer_winner_ambiguous', 'pointer_ticket_inconsistent',
  ]);
}

const P = (code, detail, ctx) => new PointerError(code, detail, ctx);
const lc = (s) => String(s ?? '').toLowerCase();
const noPrefix = (h) => lc(h).replace(/^0x/, '');

// ── 产出交易的装载: 反序列化 → finalize() 重算 id → 与 submitted_txid 比对 → 只抽取被 txid 覆盖的字段(纯数据), 随后立刻 free wasm 对象 ──
function loadProducedTx({ kaspa, row, label, ctx }) {
  // 调用方的 SQL 已只取 status='landed' 的行(下面各 latest*/landed* 查询), 所以"不是 landed"在这里表现为"没有行"。
  if (!row) throw P('pointer_dependency_not_landed', `${label}: 没有 landed 的意图行(前置步骤尚未落链, 或该行还停在 pending/prepared/submitted/ambiguous)`, ctx);
  if (typeof row.prepared_tx_json !== 'string' || !row.prepared_tx_json.trim()) throw P('pointer_tx_missing', `${label}: prepared_tx_json 为空`, ctx);
  const sub = lc(row.submitted_txid);
  if (!HEX64.test(sub)) throw P('pointer_txid_mismatch', `${label}: submitted_txid 缺失或不是 64 位 hex(landed 行必须有)`, ctx);
  // 真写入方形状(9-4 simnet 实测 + relay covenant-broadcast-relay.mjs ingestPhase 的 `txJson: JSON.stringify([txJson])`): prepared_tx_json = 只含【1 个 safe-JSON 字符串】的数组,
  //   不是裸交易对象串。裸对象串(手写夹具/旧形)照旧接受; 数组则必须恰 1 个字符串元素——covenant 广播恒为单笔, 多笔/空/非串一律 malformed(不猜取哪一笔)。
  let txText = row.prepared_tx_json;
  let outer; try { outer = JSON.parse(txText); } catch { outer = undefined; }             // 非 JSON ⇒ 留给下面 deserialize 报 malformed(保持"不是合法 JSON"语义)
  if (Array.isArray(outer)) {
    if (outer.length !== 1 || typeof outer[0] !== 'string') throw P('pointer_tx_malformed', `${label}: prepared_tx_json 是数组但不是"恰 1 个 safe-JSON 字符串"(长度 ${outer.length}, 元素类型 ${outer.map((x) => typeof x).join(',') || '无'})`, ctx);
    txText = outer[0];
  }
  let tx;
  try { tx = kaspa.Transaction.deserializeFromSafeJSON(txText); } catch (e) { throw P('pointer_tx_malformed', `${label}: prepared_tx_json 反序列化失败: ${e && e.message ? e.message : e}`, ctx); }
  try {
    try { tx.finalize(); } catch (e) { throw P('pointer_tx_malformed', `${label}: finalize() 失败: ${e && e.message ? e.message : e}`, ctx); }
    const id = lc(tx.id);
    if (id !== sub) throw P('pointer_txid_mismatch', `${label}: finalize() 重算的 id(${id.slice(0, 16)}…) != submitted_txid(${sub.slice(0, 16)}…)——prepared_tx_json 与记账的 txid 不是同一笔交易`, ctx);
    const inputs = tx.inputs.map((i) => ({ txid: lc(i.previousOutpoint.transactionId), index: Number(i.previousOutpoint.index) }));
    const outputs = tx.outputs.map((o, i) => {
      const cov = o.covenant;                                                   // 无 covenant 的输出 ⇒ undefined
      let covenantId = null, authorizingInput = null, genesisId = null;
      if (cov) {
        covenantId = lc(cov.covenantId);
        authorizingInput = Number(cov.authorizingInput);
        const auth = inputs[authorizingInput];
        if (auth) {
          // (F3, NWT D-1) 每个 covenant 输出造一个 TransactionOutput 用于独立重算——显式 free(不靠 GC / FinalizationRegistry; 控制台是长驻进程, wasm 线性内存是反复吃亏的资源)
          const probe = new kaspa.TransactionOutput(o.value, o.scriptPublicKey);
          try { genesisId = lc(kaspa.covenantId({ transactionId: auth.txid, index: auth.index }, [{ index: i, output: probe }])); } catch { genesisId = null; } finally { try { probe.free(); } catch { /* 已释放 */ } }
        }
      }
      return { value: o.value, spkHex: noPrefix(o.scriptPublicKey.script), covenantId, authorizingInput, genesisId };
    });
    return { id, inputs, outputs, rowKey: row.intent_key };
  } finally {
    try { tx.free(); } catch { /* 已释放 */ }
  }
}

const outAt = (tx, idx, label, ctx) => {
  const o = tx.outputs[idx];
  if (!o) throw P('pointer_output_missing', `${label}: 输出[${idx}] 不存在(共 ${tx.outputs.length} 个输出)`, ctx);
  return o;
};
// genesis 组输出: covenantId 必须存在, 且等于 kaspa.covenantId 独立重算的值(校验 builder 的 genesis 派生)
function genesisCovenantId(o, label, ctx) {
  if (o.covenantId === null) throw P('pointer_covenant_inconsistent', `${label}: 该输出没有 covenant 绑定(应为 genesis 组输出)`, ctx);
  if (o.genesisId === null || o.genesisId !== o.covenantId) throw P('pointer_covenant_inconsistent', `${label}: 输出里的 covenantId(${o.covenantId.slice(0, 16)}…) != 由 authorizing 输入 outpoint 独立重算的 genesis id(${o.genesisId ? o.genesisId.slice(0, 16) + '…' : '重算失败'})`, ctx);
  return o.covenantId;
}
const spends = (tx, idx, want) => { const i = tx.inputs[idx]; return !!i && i.txid === want.transactionId && i.index === want.index; };
const opOf = (txid, index) => ({ transactionId: txid, index });
const fmt = (o) => `${o.transactionId.slice(0, 12)}…:${o.index}`;

// ── DB 查询(都是只读; 排序与 proto-leaf-state.mjs 的 deriveLeafOutpoint/deriveHeldKttOutpoint 完全一致: landed_at DESC, rowid DESC) ──
const latestLandedAppend = (db, marketId) => db.prepare(`
  SELECT pbi.intent_key, pbi.status, pbi.submitted_txid, pbi.prepared_tx_json FROM proto_bet_intents pbi
  JOIN proto_bets pb ON pb.id = pbi.bet_id
  WHERE pb.market_id = ? AND pbi.step = 'append' AND pbi.status = 'landed'
  ORDER BY pbi.landed_at DESC, pbi.rowid DESC LIMIT 1`).get(marketId);
const landedAppendOfBet = (db, betId) => db.prepare(`
  SELECT intent_key, status, submitted_txid, prepared_tx_json FROM proto_bet_intents
  WHERE bet_id = ? AND step = 'append' AND status = 'landed'
  ORDER BY landed_at DESC, rowid DESC LIMIT 1`).get(betId);
// convert_to_claim / claim_draw 的意图挂在 claim 主体下(intent 模块的 STEP_SUBJECT_TYPE), 不是 market——按 market 找赢 claim 行再按 ('claim', claimId) 找意图(9-2b 离线端到端暴露: 原先按 ('market', marketId) 找, 永远找不到)。
const landedClaimSettlement = (db, marketId, step) => {
  const claim = db.prepare("SELECT id FROM proto_claims WHERE market_id = ? AND side = 'win' ORDER BY rowid DESC LIMIT 1").get(marketId);
  if (!claim) return undefined;
  return db.prepare(`
    SELECT intent_key, status, submitted_txid, prepared_tx_json FROM proto_settlement_intents
    WHERE subject_type = 'claim' AND subject_id = ? AND step = ? AND status = 'landed'
    ORDER BY rowid DESC LIMIT 1`).get(claim.id, step);
};
const landedSettlement = (db, marketId, step) => db.prepare(`
  SELECT intent_key, status, submitted_txid, prepared_tx_json FROM proto_settlement_intents
  WHERE subject_type = 'market' AND subject_id = ? AND step = ? AND status = 'landed'
  ORDER BY rowid DESC LIMIT 1`).get(marketId, step);

/**
 * @param {object} o
 * @param {'seal'|'close_commit'|'convert_to_claim'|'claim_draw'} o.step
 * @param {string} o.marketId  32 字节 hex
 * @param {object} o.db  只读用途的 better-sqlite3 句柄(注入; 本模块不 import 它)
 * @param {object} o.kaspa  kaspa-wasm(注入; Transaction.deserializeFromSafeJSON / covenantId / TransactionOutput)
 * @returns {{roles: Record<string,{outpoint:{transactionId:string,index:number}, expectedCovenantId:string|null, source:'append'|'genesis'|'settlement'|'bet', producedBy:{table:string,key:string}}>}}
 *   角色键与 STEP_INPUT_ROLES[step] 一致(不含 fee)。任何失败抛 PointerError。
 */
export function resolveStepPointers({ step, marketId, db, kaspa }) {
  if (!STEPS.includes(step)) throw new TypeError(`resolveStepPointers: 未知步骤 ${step}(支持 ${STEPS.join('/')})`);
  if (typeof marketId !== 'string' || !HEX64.test(marketId)) throw new TypeError('resolveStepPointers: marketId 必须是 64 位小写 hex');
  if (!db || typeof db.prepare !== 'function') throw new TypeError('resolveStepPointers: db 必填(注入)');
  if (!kaspa || !kaspa.Transaction || typeof kaspa.covenantId !== 'function' || typeof kaspa.TransactionOutput !== 'function') throw new TypeError('resolveStepPointers: kaspa 必填(注入 kaspa-wasm)');
  const ctx = (role) => ({ step, role });
  const market = db.prepare('SELECT id, shardleaf_txid, shardleaf_vout, shardleaf_cov_id FROM proto_markets WHERE id = ?').get(marketId);
  if (!market) throw P('pointer_dependency_not_landed', `市场 ${marketId.slice(0, 12)}… 不存在`, ctx());

  // ── 格 1 / 2: 最新 landed 的 append(无 append ⇒ leaf 退回 genesis; held 无) ──
  const appendRow = latestLandedAppend(db, marketId);
  const shardCovId = lc(market.shardleaf_cov_id);
  let leaf, held, appendTx = null;
  if (appendRow) {
    appendTx = loadProducedTx({ kaspa, row: appendRow, label: 'append 意图', ctx: ctx('leaf') });
    const lo = outAt(appendTx, REGISTER_APPEND_LEAF_CONT_OUT_INDEX, 'append 意图·leaf 续约输出', ctx('leaf'));
    if (lo.covenantId === null || lo.covenantId !== shardCovId) {
      throw P('pointer_covenant_inconsistent', `append 输出[${REGISTER_APPEND_LEAF_CONT_OUT_INDEX}] 的 covenantId(${lo.covenantId ? lo.covenantId.slice(0, 16) + '…' : '无'}) != proto_markets.shardleaf_cov_id(${shardCovId.slice(0, 16)}…): leaf 续约必须沿用同一个 covenant id`, ctx('leaf'));
    }
    const ho = outAt(appendTx, REGISTER_APPEND_TOK_OUT_INDEX, 'append 意图·合并 KTT 输出', ctx('held'));
    leaf = { outpoint: opOf(appendTx.id, REGISTER_APPEND_LEAF_CONT_OUT_INDEX), expectedCovenantId: lo.covenantId, source: 'append', producedBy: { table: 'proto_bet_intents', key: appendRow.intent_key } };
    held = { outpoint: opOf(appendTx.id, REGISTER_APPEND_TOK_OUT_INDEX), expectedCovenantId: genesisCovenantId(ho, 'append 输出[2](合并 KTT, genesis 组)', ctx('held')), source: 'append', producedBy: { table: 'proto_bet_intents', key: appendRow.intent_key } };
  } else {
    if (!market.shardleaf_txid || !HEX64.test(lc(market.shardleaf_txid)) || !HEX64.test(shardCovId)) {
      throw P('pointer_dependency_not_landed', '没有任何 landed 的 append, 且 proto_markets 里没有可用的 genesis leaf 指针(shardleaf_txid / shardleaf_cov_id): 创世未落链', ctx('leaf'));
    }
    leaf = { outpoint: opOf(lc(market.shardleaf_txid), Number(market.shardleaf_vout)), expectedCovenantId: shardCovId, source: 'genesis', producedBy: { table: 'proto_markets', key: marketId } };
    held = null;
  }
  if (step === 'seal') {
    if (!held) throw P('pointer_dependency_not_landed', '没有任何 landed 的 append ⇒ 没有合并 KTT(seal 必须转出 held)', ctx('held'));
    return { roles: { leaf, held } };
  }
  if (!held) throw P('pointer_dependency_not_landed', '没有任何 landed 的 append, 却在 seal 之后的步骤取指针', ctx('held'));

  // ── 格 3 / 5(与 seal 的谱系): seal 意图 landed ──
  const sealRow = landedSettlement(db, marketId, 'seal');
  const S = loadProducedTx({ kaspa, row: sealRow, label: 'seal 意图', ctx: ctx('rootClose') });
  if (!spends(S, MARKET_SEAL_LEAF_IN_INDEX, leaf.outpoint) || !spends(S, MARKET_SEAL_HELD_IN_INDEX, held.outpoint)) {
    throw P('pointer_lineage_mismatch', `seal 交易的输入[${MARKET_SEAL_LEAF_IN_INDEX}]/[${MARKET_SEAL_HELD_IN_INDEX}] 没有花掉最新 append 的输出 leaf(${fmt(leaf.outpoint)}) / held(${fmt(held.outpoint)})`, ctx('rootClose'));
  }
  const sealRc = outAt(S, MARKET_SEAL_ROOTCLOSE_OUT_INDEX, 'seal 意图·RootClose 输出', ctx('rootClose'));
  const sealTok = outAt(S, MARKET_SEAL_TOKEN_OUT_INDEX, 'seal 意图·代币输出', ctx('held'));
  const cell3 = { outpoint: opOf(S.id, MARKET_SEAL_ROOTCLOSE_OUT_INDEX), expectedCovenantId: genesisCovenantId(sealRc, 'seal 输出[0](RootClose, genesis 组)', ctx('rootClose')), source: 'settlement', producedBy: { table: 'proto_settlement_intents', key: S.rowKey } };
  const cell5 = { outpoint: opOf(S.id, MARKET_SEAL_TOKEN_OUT_INDEX), expectedCovenantId: genesisCovenantId(sealTok, 'seal 输出[1](代币, genesis 组)', ctx('held')), source: 'settlement', producedBy: { table: 'proto_settlement_intents', key: S.rowKey } };
  if (step === 'close_commit') return { roles: { rootClose: cell3 } };

  // ── 格 4: close_commit(intent step='resolve')landed; 谱系 = 它的输入 0 花掉 seal 输出 0; covenantId 必须与格 3 相等(续约保持 id) ──
  const ccRow = landedSettlement(db, marketId, 'resolve');
  const CC = loadProducedTx({ kaspa, row: ccRow, label: 'close_commit(resolve)意图', ctx: ctx('rootClose') });
  if (!spends(CC, CLOSE_COMMIT_ROOTCLOSE_IN_INDEX, cell3.outpoint)) {
    throw P('pointer_lineage_mismatch', `close_commit 交易的输入[${CLOSE_COMMIT_ROOTCLOSE_IN_INDEX}] 没有花掉 seal 的 RootClose 输出(${fmt(cell3.outpoint)})`, ctx('rootClose'));
  }
  const ccRc = outAt(CC, CLOSE_COMMIT_ROOTCLOSE_OUT_INDEX, 'close_commit 意图·RootClose 续约输出', ctx('rootClose'));
  if (ccRc.covenantId === null || ccRc.covenantId !== cell3.expectedCovenantId) {
    throw P('pointer_covenant_inconsistent', `close_commit 输出[${CLOSE_COMMIT_ROOTCLOSE_OUT_INDEX}] 的 covenantId(${ccRc.covenantId ? ccRc.covenantId.slice(0, 16) + '…' : '无'}) != seal 输出[0] 的 covenantId(${cell3.expectedCovenantId.slice(0, 16)}…): RootClose 续约必须保持 covenant id`, ctx('rootClose'));
  }
  const cell4 = { outpoint: opOf(CC.id, CLOSE_COMMIT_ROOTCLOSE_OUT_INDEX), expectedCovenantId: ccRc.covenantId, source: 'settlement', producedBy: { table: 'proto_settlement_intents', key: CC.rowKey } };
  if (step === 'convert_to_claim') return { roles: { rootClose: cell4, held: cell5 } };

  // ── 格 6 / 7: convert_to_claim 意图 landed; 谱系 = 输入 0 花掉 close_commit 输出 0、输入 1 花掉 seal 输出 1 ──
  const v = landedClaimSettlement(db, marketId, 'convert_to_claim');
  const V = loadProducedTx({ kaspa, row: v, label: 'convert_to_claim 意图', ctx: ctx('rootClaim') });
  if (!spends(V, CONVERT_TO_CLAIM_ROOTCLOSE_IN_INDEX, cell4.outpoint) || !spends(V, CONVERT_TO_CLAIM_HELD_IN_INDEX, cell5.outpoint)) {
    throw P('pointer_lineage_mismatch', `convert_to_claim 交易的输入[${CONVERT_TO_CLAIM_ROOTCLOSE_IN_INDEX}]/[${CONVERT_TO_CLAIM_HELD_IN_INDEX}] 没有花掉 close_commit 输出(${fmt(cell4.outpoint)}) / seal 代币输出(${fmt(cell5.outpoint)})`, ctx('rootClaim'));
  }
  const vClaim = outAt(V, CONVERT_TO_CLAIM_CLAIM_OUT_INDEX, 'convert_to_claim 意图·RootClaim 输出', ctx('rootClaim'));
  const vTok = outAt(V, CONVERT_TO_CLAIM_TOKEN_OUT_INDEX, 'convert_to_claim 意图·代币输出', ctx('held'));
  const cell6 = { outpoint: opOf(V.id, CONVERT_TO_CLAIM_CLAIM_OUT_INDEX), expectedCovenantId: genesisCovenantId(vClaim, 'convert_to_claim 输出[0](RootClaim, genesis 组)', ctx('rootClaim')), source: 'settlement', producedBy: { table: 'proto_settlement_intents', key: V.rowKey } };
  const cell7 = { outpoint: opOf(V.id, CONVERT_TO_CLAIM_TOKEN_OUT_INDEX), expectedCovenantId: genesisCovenantId(vTok, 'convert_to_claim 输出[1](代币, genesis 组)', ctx('held')), source: 'settlement', producedBy: { table: 'proto_settlement_intents', key: V.rowKey } };

  // ── 格 8: 赢家那一条下注的 landed append 意图的输出 1(v0.3.4 NWT N91-3: 与其余 7 格同一信任模型, 不直接信 proto_bets.ticket_txid/ticket_vout 这两个未验证的原始列; 用它们只做交叉核对) ──
  let w;
  try { w = deriveWinnerBet(marketId, { db }); } catch (e) { throw P('pointer_winner_ambiguous', e && e.message ? e.message : String(e), ctx('ticket')); }
  const bet = w.winner;
  const betRow = db.prepare('SELECT ticket_txid, ticket_vout FROM proto_bets WHERE id = ?').get(bet.id);
  const tRow = landedAppendOfBet(db, bet.id);
  const T = loadProducedTx({ kaspa, row: tRow, label: `赢家下注 ${bet.id} 的 append 意图`, ctx: ctx('ticket') });
  const tOut = outAt(T, REGISTER_APPEND_TICKET_OUT_INDEX, 'append 意图·ticket 输出', ctx('ticket'));
  const bad = (what) => P('pointer_ticket_inconsistent', `赢家票 ${bet.id}: ${what}`, ctx('ticket'));
  if (!betRow || lc(betRow.ticket_txid) !== T.id) throw bad(`proto_bets.ticket_txid(${lc(betRow && betRow.ticket_txid).slice(0, 12)}…) != landed append 意图的 submitted_txid(${T.id.slice(0, 12)}…)`);
  if (Number(betRow.ticket_vout) !== REGISTER_APPEND_TICKET_OUT_INDEX) throw bad(`proto_bets.ticket_vout(${betRow.ticket_vout}) != ${REGISTER_APPEND_TICKET_OUT_INDEX}`);
  if (tOut.covenantId !== null) throw bad('ticket 输出带 covenant(应为无 covenant 的普通 P2SH)');
  const wantSpk = noPrefix(computeTicketGenesisArtifact({ bettorPk: lc(bet.bettor_pk), direction: Number(bet.side), stake: Number(bet.stake), shardPoolId: marketId }).scriptPubKeyHex);
  if (tOut.spkHex !== wantSpk) throw bad('ticket 输出的 spk != 由 (bettorPk, side, stake, marketId) 现算的 ticket spk');
  const cell8 = { outpoint: opOf(T.id, REGISTER_APPEND_TICKET_OUT_INDEX), expectedCovenantId: null, source: 'bet', producedBy: { table: 'proto_bet_intents', key: T.rowKey } };
  return { roles: { rootClaim: cell6, ticket: cell8, held: cell7 } };
}
