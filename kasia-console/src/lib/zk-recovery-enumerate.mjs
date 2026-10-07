// zk-recovery-enumerate.mjs — 账本1867(Bettor 派工, 设计 docs/2026-10-05-j2-retire-sweep-tool-design-v0.1.md §3.2): 回收枚举器。
//
// 只读: 不发任何花钱命令。对每个终态 ZK 原生盘, 重算 KanetTokenClaim / KTT 代币 / PoolSideTicket 的 redeem(与铸造时同一批单源函数),
// 去链上找存活 UTXO, 再让 relay builder 以 dry_run 判年龄(builder 是年龄判定的单一实现, 这里不另写第二份)。
// 输出 { retirable, sweepable, notYet, skipped, liveSlotHolders } —— 脚本据此打印清单 / 受 --max N 约束地执行。
//
// 复用(第一原则): computeKanetTokenClaimArtifact / computeKttTokenArtifact / computePoolSideTicketArtifact(铸造同款)、
//   computePariMutuelPayout + deriveCloseFeeLeaves + getMarketBets(claim tick 同款, 重算赢家叶)、isNullifierBitSet/parseCloseZkV2State、
//   zk_recovery_params(铸造时回收参数, 优先于当前 env)、listUnfinishedZkNativeMarkets(名额占用者栏)。
// 注入: db / rc(relayCall) / p2sh(hex→地址) / env —— 本文件不 import DB 客户端、不碰 relay IPC(M0a: 新钱路模块须注入)。
import { computeKanetTokenClaimArtifact, computeKttTokenArtifact, computePoolSideTicketArtifact } from './pool-bshard-artifacts.mjs';
import { parseCloseZkV2State, isNullifierBitSet } from './closezk-v2-claim-builder.mjs';
import { computePariMutuelPayout } from './pool-shard-settle.mjs';
import { deriveCloseFeeLeaves } from '../services/bshard-close-voter.js';
import { getMarketBets } from './pool-bettor-sides-query.mjs';
import { currentRecoveryParams } from './zk-recovery-params.mjs';
import { listUnfinishedZkNativeMarkets, FINISHED_PROTOCOL_STATUSES, resolveMaxLiveMarkets } from './mainnet-no-kas-stake-gate.mjs';
import { blake2b } from '@noble/hashes/blake2b';

const hex32 = (s) => Buffer.from(blake2b(Buffer.from(s), { dkLen: 32 })).toString('hex');   // 同 pool-shard-register.mjs:126(shardPoolId 单源公式)
export const RECOVER_AGE_MARGIN_DAA = 1000;   // 枚举器的软余量(设计 §3.2): 年龄 < 门槛 + 余量 ⇒ notYet; relay builder 另有自己的 50 DAA 硬余量

/** 取盘的回收参数: 优先铸造时落盘的 zk_recovery_params, 没有(legacy 盘)回落当前 env 并标 source='env-fallback'。 */
export function resolveMarketRecoveryParams(meta, env = process.env) {
  const s = meta?.zk_recovery_params;
  if (s && /^[0-9a-f]{64}$/.test(String(s.sink_pk || '')) && Number(s.retire_daa) >= 1 && Number(s.sweep_daa) >= 1) {
    return { sinkPkHex: s.sink_pk, retireDaa: Number(s.retire_daa), sweepDaa: Number(s.sweep_daa), claimOutValueSompi: Number(s.claim_out_value_sompi), source: 'stamped' };
  }
  const c = currentRecoveryParams(env);
  if (!c) return null;
  return { sinkPkHex: c.sink_pk, retireDaa: c.retire_daa, sweepDaa: c.sweep_daa, claimOutValueSompi: c.claim_out_value_sompi, source: 'env-fallback' };
}

const parseMeta = (s) => { try { return JSON.parse(s || '{}') || {}; } catch { return null; } };
const isTerminalMarket = (row, meta) => FINISHED_PROTOCOL_STATUSES.includes(row.protocol_status) || meta?.zk_continuation?.exhausted === true;

async function factsList(rc, address) {
  const r = await rc({ type: 'get_address_utxos', address, facts: true });
  if (r?.ok !== true || r?.facts !== true || !Array.isArray(r.utxos)) throw new Error(`get_address_utxos facts 回执不合形: ${JSON.stringify(r).slice(0, 160)}`);
  if (r.truncated) throw new Error(`地址 ${address.slice(0, 18)}… 上 UTXO 过多(truncated) — 不猜`);
  return r.utxos;
}

/** selfCovId(= CloseZkV2 续约链的 covenant id)来源优先级: 盘上 zk_self_cov_id → 活续约 UTXO facts → 调用方覆盖。 */
async function resolveSelfCovId({ meta, marketId, rc, p2sh, covIdOverrides }) {
  if (/^[0-9a-f]{64}$/.test(String(meta.zk_self_cov_id || ''))) return { covId: meta.zk_self_cov_id, via: 'stamped' };
  const zc = meta.zk_continuation;
  if (zc && zc.exhausted !== true && zc.redeemHex && zc.outpoint?.txid) {
    const addr = await p2sh(zc.redeemHex);
    const hit = (await factsList(rc, addr)).find((u) => u.outpoint.transactionId === zc.outpoint.txid && Number(u.outpoint.index) === Number(zc.outpoint.index));
    if (hit?.covenantId) return { covId: hit.covenantId, via: 'live-continuation' };
  }
  const o = covIdOverrides?.[marketId];
  if (/^[0-9a-f]{64}$/.test(String(o || ''))) return { covId: o, via: 'operator-override' };
  return null;
}

/** 已被领走的叶子(= 存在 claim/token UTXO 的候选): exhausted ⇒ 全部; 否则 nullifier 位已置位者。 */
function claimedLeaves(marketId, meta, db) {
  const zc = meta.zk_continuation;
  if (zc.poolAtZkCloseSompi == null) return { error: 'missing_snapshot' };
  let state = null;
  if (zc.exhausted !== true) { try { state = parseCloseZkV2State(zc.redeemHex, { expectedClosed: 2 }); } catch (e) { return { error: `bad_state(${e.message})` }; } }
  const winner = state ? state.attestedWinner : zc.attestedWinner;
  const { bets } = getMarketBets(marketId, db);
  const feeLeaves = deriveCloseFeeLeaves(marketId, zc.poolAtZkCloseSompi) || [];
  const pm = computePariMutuelPayout({ bettors: bets, winningDirection: Number(winner), poolTotalSompi: zc.poolAtZkCloseSompi, feeLeaves });
  if (pm.degenerate) return { error: `degenerate(${pm.reason})` };
  const out = [];
  pm.payoutLeaves.forEach((l, i) => { if (zc.exhausted === true || isNullifierBitSet(state, i)) out.push({ index: i, pk: l.pk, amount: BigInt(l.amount) }); });
  return { leaves: out };
}

/**
 * @param {object} o
 * @param {{prepare:Function}} o.db
 * @param {(cmd:object)=>Promise<object>} o.rc relay IPC
 * @param {(redeemHex:string)=>Promise<string>|string} o.p2sh
 * @param {{tokenTmplHash:string, claimTmplHash?:string}} o.tmpl readZkTemplateHashes() 的成功结果
 * @param {object} [o.env]
 * @param {Record<string,string>} [o.covIdOverrides] marketId → 64hex(运维手填)
 * @param {boolean} [o.dryRunProbe=true] 对每个候选让 relay builder dry_run 取年龄(false ⇒ 只列清单不判年龄)
 * @param {string[]} [o.onlyMarkets]
 * @param {number} [o.marginDaa] 软余量(默认 RECOVER_AGE_MARGIN_DAA=1000): age < 门槛 + 余量 ⇒ notYet
 */
export async function enumerateRecovery(o) {
  const { db, rc, p2sh, tmpl, env = process.env, covIdOverrides = {}, dryRunProbe = true, onlyMarkets = null, marginDaa = RECOVER_AGE_MARGIN_DAA } = o;
  const res = { retirable: [], sweepable: [], notYet: [], skipped: [], liveSlotHolders: [], cap: resolveMaxLiveMarkets(env), marginDaa };
  const skip = (marketId, kind, reason, extra = {}) => res.skipped.push({ market_id: marketId, kind, reason, ...extra });
  try { res.liveSlotHolders = listUnfinishedZkNativeMarkets(db).map((m) => ({ id: m.id, protocol_status: m.protocol_status })); } catch (e) { res.liveSlotError = e.message; }

  const rows = db.prepare(`SELECT id, protocol_status, metadata, created_at FROM pool_markets WHERE json_valid(resolution_rule_spec) AND json_extract(resolution_rule_spec, '$.zk_native') = 1 AND protocol_status != 'shard_internal'`).all();
  const bump = (item, probe) => {
    if (probe) { item.age = { ageDaa: probe.ageDaa, requiredDaa: probe.requiredDaa }; item.eligible = probe.eligible && probe.ageDaa >= probe.requiredDaa + marginDaa; }
    return item;
  };

  for (const row of rows) {
    if (onlyMarkets && !onlyMarkets.some((m) => row.id.endsWith(m) || row.id === m)) continue;
    const meta = parseMeta(row.metadata);
    if (!meta) { skip(row.id, 'market', 'bad_metadata'); continue; }
    const terminal = isTerminalMarket(row, meta);
    const params = resolveMarketRecoveryParams(meta, env);
    if (!params) { skip(row.id, 'market', 'no_params(盘上无 zk_recovery_params 且 env 不全)'); continue; }

    // ── claims ──
    if (meta.zk_continuation) {
      try {
        if (!terminal && !(meta.zk_continuation.poolAtZkCloseSompi != null)) { skip(row.id, 'claim', 'market_not_terminal'); }
        else {
          const cl = claimedLeaves(row.id, meta, db);
          if (cl.error) skip(row.id, 'claim', cl.error);
          else if (!cl.leaves.length) { /* 还没人领: 无 claim UTXO */ }
          else {
            const sc = await resolveSelfCovId({ meta, marketId: row.id, rc, p2sh, covIdOverrides });
            if (!sc) skip(row.id, 'claim', `need_cov_id(${cl.leaves.length} 个已领叶, 盘上无 zk_self_cov_id 且续约已耗尽; 用 --cov-id ${row.id.slice(-8)}=<64hex> 手填)`);
            else {
              for (const leaf of cl.leaves) {
                const base = { market_id: row.id, kind: 'claim', leaf_index: leaf.index, bettor_pk: leaf.pk, amount: leaf.amount.toString(), params_source: params.source, cov_id_via: sc.via };
                try {
                  const claimArt = computeKanetTokenClaimArtifact({ marketCovIdHex: sc.covId, winnerPkHex: leaf.pk, amount: leaf.amount, tokenTmplHashHex: tmpl.tokenTmplHash, sinkPkHex: params.sinkPkHex, retireDaa: params.retireDaa });
                  if (tmpl.claimTmplHash && claimArt.templateHashHex.toLowerCase() !== String(tmpl.claimTmplHash).toLowerCase()) { skip(row.id, 'claim', 'claim_tmpl_hash_mismatch(盘上参数与当前合约/env 的模板 hash 对不上)', { leaf_index: leaf.index }); continue; }
                  const claimAddr = await p2sh(claimArt.script.toString('hex'));
                  const claimUtxos = await factsList(rc, claimAddr);
                  if (!claimUtxos.length) { skip(row.id, 'claim', 'gone(该叶的 claim UTXO 已不存在: 已回收或从未铸出)', { leaf_index: leaf.index }); continue; }
                  for (const cu of claimUtxos) {
                    if (!cu.covenantId) { skip(row.id, 'claim', 'claim_utxo_no_covenant', { leaf_index: leaf.index }); continue; }
                    const ktt = computeKttTokenArtifact({ amount: Number(leaf.amount), ownerCovIdHex: cu.covenantId });
                    const tokUtxos = await factsList(rc, await p2sh(ktt.script.toString('hex')));
                    if (tokUtxos.length !== 1) { skip(row.id, 'claim', `token_utxo_count=${tokUtxos.length}(期望恰 1) — 不猜`, { leaf_index: leaf.index }); continue; }
                    const tu = tokUtxos[0];
                    const item = { ...base, claim: { outpoint: cu.outpoint, value: cu.amount, covenantId: cu.covenantId, redeemHex: claimArt.script.toString('hex') }, token: { outpoint: tu.outpoint, value: tu.amount, covenantId: tu.covenantId, redeemHex: ktt.script.toString('hex') },
                      retire_daa: params.retireDaa, sink_pk_hex: params.sinkPkHex, sum_in_sompi: (BigInt(cu.amount) + BigInt(tu.amount)).toString(),
                      witness: { tok_prefix_hex: ktt.templatePrefix.toString('hex'), tok_suffix_hex: ktt.templateSuffix.toString('hex'), claim_entry_abi: claimArt.entryAbi, token_entry_abi: { dispatch_tag: ktt.entryAbi.dispatch_tag, state_field_count: ktt.stateFieldCount } } };
                    if (dryRunProbe) {
                      const p = await rc(buildRetireCommand(item, { dry_run: true }));
                      if (p?.ok !== true) { skip(row.id, 'claim', `probe_failed(${String(p?.error || JSON.stringify(p)).slice(0, 140)})`, { leaf_index: leaf.index }); continue; }
                      bump(item, p);
                    }
                    (dryRunProbe && !item.eligible ? res.notYet : res.retirable).push(item);
                  }
                } catch (e) { skip(row.id, 'claim', `error(${String(e.message).slice(0, 160)})`, { leaf_index: leaf.index }); }
              }
            }
          }
        }
      } catch (e) { skip(row.id, 'claim', `error(${String(e.message).slice(0, 160)})`); }
    }

    // ── tickets: 该(逻辑)盘名下各分片的 bettor sides ──
    const shards = db.prepare('SELECT shard_market_id, shard_index FROM market_shards WHERE logical_market_id = ?').all(row.id);
    if (!shards.length) continue;
    if (!terminal) { skip(row.id, 'ticket', `market_not_terminal(${shards.length} 个分片的票留在原地, 不扫结算期内的票)`); continue; }
    for (const sh of shards) {
      const sides = db.prepare('SELECT bettor_pk, direction, stake_amount, side_lock_tx FROM pool_bettor_sides WHERE market_id = ?').all(sh.shard_market_id);
      for (const s of sides) {
        const base = { market_id: row.id, kind: 'ticket', shard_index: sh.shard_index, bettor_pk: s.bettor_pk, direction: s.direction, stake: s.stake_amount, params_source: params.source };
        try {
          const art = computePoolSideTicketArtifact({ bettorPk: s.bettor_pk, direction: Number(s.direction), stake: Number(s.stake_amount), shardPoolId: hex32(`${row.id}-shard-${sh.shard_index}`), sinkPkHex: params.sinkPkHex, sweepDaa: params.sweepDaa });
          const utxos = await factsList(rc, await p2sh(art.script.toString('hex')));
          if (!utxos.length) { skip(row.id, 'ticket', 'gone(票 UTXO 已不存在)', { bettor_pk: s.bettor_pk }); continue; }
          for (const tu of utxos) {
            const item = { ...base, ticket: { outpoint: tu.outpoint, value: tu.amount, redeemHex: art.script.toString('hex') }, sweep_daa: params.sweepDaa, sink_pk_hex: params.sinkPkHex, sum_in_sompi: String(tu.amount), witness: { sweep_entry_abi: art.entryAbi } };
            if (dryRunProbe) {
              const p = await rc(buildSweepCommand(item, { dry_run: true }));
              if (p?.ok !== true) { skip(row.id, 'ticket', `probe_failed(${String(p?.error || JSON.stringify(p)).slice(0, 140)})`, { bettor_pk: s.bettor_pk }); continue; }
              bump(item, p);
            }
            (dryRunProbe && !item.eligible ? res.notYet : res.sweepable).push(item);
          }
        } catch (e) { skip(row.id, 'ticket', `error(${String(e.message).slice(0, 160)})`, { bettor_pk: s.bettor_pk }); }
      }
    }
  }
  return res;
}

/** 由枚举项构造 relay 命令(dry_run 与真执行共用同一函数, 脚本不手拼)。 */
export function buildRetireCommand(item, { dry_run = false } = {}) {
  return {
    type: 'zk_claim_retire', sink_pk_hex: item.sink_pk_hex, retire_daa: item.retire_daa, ...(dry_run ? { dry_run: true } : {}),
    inputs: {
      claim: { redeem_hex: item.claim.redeemHex, outpointTxid: item.claim.outpoint.transactionId, index: Number(item.claim.outpoint.index) },
      token: { redeem_hex: item.token.redeemHex, outpointTxid: item.token.outpoint.transactionId, index: Number(item.token.outpoint.index) },
    },
    witness: { retire_dispatch_tag_hex: item.witness.claim_entry_abi.dispatch_tag, tok_prefix_hex: item.witness.tok_prefix_hex, tok_suffix_hex: item.witness.tok_suffix_hex,
      token_transfer_dispatch_tag_hex: item.witness.token_entry_abi.dispatch_tag, token_transfer_state_field_count: item.witness.token_entry_abi.state_field_count },
  };
}
export function buildSweepCommand(item, { dry_run = false } = {}) {
  return {
    type: 'zk_ticket_sweep', sink_pk_hex: item.sink_pk_hex, sweep_daa: item.sweep_daa, ...(dry_run ? { dry_run: true } : {}),
    inputs: { ticket: { redeem_hex: item.ticket.redeemHex, outpointTxid: item.ticket.outpoint.transactionId, index: Number(item.ticket.outpoint.index) } },
    witness: { sweep_dispatch_tag_hex: item.witness.sweep_entry_abi.dispatch_tag },
  };
}
