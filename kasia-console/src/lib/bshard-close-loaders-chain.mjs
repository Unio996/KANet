// bshard-close-loaders-chain.mjs — Track B D4 relay-gate: relay-importable PURE chain loaders.
//
// 设计 (2026-06-23, 4-agent 对抗验全收敛, 见记忆 track-b-d4-relay-gate-design):
//   D4 no-bypass = (A) keyholder-must-be-enforcer: relay 签 close_attest 前【自己】跑 enforce, lib 跑进 relay 进程
//   (privkey 不出 + gate-sign 的 enforce 与持 key 同进程 = 零跨进程信任)。这些 loader 是 enforce 的链派生输入,
//   **全收 rpc-handle, 零 DB / 零 console 依赖**(DB 同节点可写 = 对手可伪 = vacuous; 唯一 trustless 源 = 链)。
//
// ╔═══════════════════════════════════════════════════════════════════════════════════════════╗
// ║ 🔴 meta-铁律 — Kaspa lockTime 两个单位域 (J2 实证 OracleStake_v1.sil + 件1 镜像, 钉死防再栽):  ║
// ║   LOCK_TIME_THRESHOLD = 500_000_000_000 (500e9)。 lockTime < 500e9 → DAA-score / ≥ 500e9 → ms-epoch。 ║
// ║   • 本 loader 的 created_daa / lockUntilDaa / resolutionDaa / beaconDaa = 【全 DAA-score 同域】(~5e8)。  ║
// ║   • bshard close CLTV deadline = 【ms-epoch】(~1.75e12, tx.time gate, *1000 那个) — 绝不串进本 loader。 ║
// ║   混用 = 拿 1.75e12 比 5e8 → 谓词恒 false → 全 oracle 排除 → 委员空 → liveness 死 (= 件1 坑镜像)。     ║
// ║   见记忆 [[silverscript-tx-time-milliseconds]]。                                                       ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════════╝

import { buildPoolMerkleTree } from '../services/pool-merkle-v06.mjs';   // 纯 (仅 blake2b), C2 复用

const DAA_DOMAIN_MAX = 500_000_000_000n;   // ≥ 此值 = ms-epoch 域 (非 DAA)。assert 用。

/**
 * DAA-score 域断言 — load-bearing 量串到别的单位域会静默 vacuous, fail-loud 挡死。
 * ⚠ 局限(Bettor 洞①): 纯层只能挡 ms-epoch(≥500e9)。**unix-ts 秒(~1.75e9)< 500e9 → 滑过**,
 *   而 bshard 存的 deadline 正是【秒】(见 [[silverscript-tx-time-milliseconds]]: 烤秒~1.75e9 闸才 *1000)。
 *   秒 与 DAA(~1e8) 在 <500e9 重叠带, 纯函数无法区分 → robust 守 = chain-tip-relative
 *   (resolutionDaa ≤ tipDaa, 见 assertResolutionDaaVsTip, chain-read 路必传 tipDaa)。
 *   input 契约(钉死): resolutionDaa 必 = 链读 resolution-block.daaScore, **绝非** 存的 unix-ts deadline。
 */
function assertDaaDomain(name, v) {
  const n = BigInt(v);
  if (n < 0n) throw new Error(`${name}=${n} 负值非法`);
  if (n >= DAA_DOMAIN_MAX) {
    throw new Error(`${name}=${n} ≥ 500e9 = 落进 ms-epoch 域 (疑似误用 close 的 unix-ts ms deadline; 本 loader 全 DAA-score 域, 见 meta-铁律)`);
  }
  return n;
}

/**
 * robust seconds-mixing 守 (Bettor 洞①修): enforce 在 market resolution 后跑 → 链 tip ≥ resolutionDaa 必成立。
 *   unix-ts 秒(~1.75e9) >> 真 DAA tip(~1e8) → resolutionDaa > tipDaa 触发 = 误把存的秒-deadline 当 DAA 被挡。
 *   chain-read 路【必传 tipDaa】(= rpc getVirtualDaaScore); 纯单测路 tipDaa 可省(仅得 ms-guard, 见 assertDaaDomain 局限)。
 */
export function assertResolutionDaaVsTip(resolutionDaa, tipDaa) {
  const r = assertDaaDomain('resolutionDaa', resolutionDaa);
  const t = assertDaaDomain('tipDaa', tipDaa);
  if (r > t) {
    throw new Error(`resolutionDaa=${r} > chain tipDaa=${t} → resolutionDaa 非链上 daaScore (疑似误用 unix-ts 秒-deadline~1.75e9 当 DAA; enforce 在 resolution 后跑 tip 必 ≥ resolutionDaa)`);
  }
  return r;
}

/**
 * g(deadline) — (B) 方案的 canonical lockUntilDaa。relay 【自算, 绝不收 caller】。
 *   = resolutionDaa + cooldownN + margin。 单一确定值 → 一 oracle 对一 market 恰一个合格 stake 地址 → 零歧义。
 *   ⑤ determinism: margin 保证锁严格越过 enforcement 窗尾 (off-by-one, .sil L46 "含"语义 → 用 strict)。
 *   cooldownN 必 ≥ 最大 enforcement 延迟 (委员签 + cross-node 收集窗 + dispute_window)。
 *
 *   capital-efficiency 备选 (未来, 非 security): ceil_epoch(resolutionDaa) + standardLock → 一 bond 服该 epoch 全 market。
 *   现先用裸式。改此函数不碰 root 公式/covenant (纯 g() 选择)。
 */
export function canonicalLockUntilDaa(resolutionDaa, cooldownN, margin) {
  const r = assertDaaDomain('resolutionDaa', resolutionDaa);
  const c = BigInt(cooldownN);
  const m = BigInt(margin);
  if (c < 0n) throw new Error('cooldownN 非负');
  // Bettor 洞②: margin 必 ≥ 1 — 否则 g 产的 canonical lockUntilDaa = resolutionDaa+cooldownN,
  //   恰被 isEligibleOracleStake 的 strict `>` (lockUntilDaa <= resolutionDaa+cooldownN → false) 自拒 →
  //   该 oracle 永零权重 (self-reject)。strict 口径两函数对齐: margin≥1 保 g 产 stake 必过资格谓词。
  if (m < 1n) throw new Error('margin ≥ 1 必须 (否则 g(deadline) 产的 canonical lockUntilDaa 被 isEligibleOracleStake strict> 自拒)');
  return r + c + m;
}

/**
 * oracle stake 资格谓词 (assert 在【J1 loader】, 非 J2 relay-side gate — 职责划分)。
 *   合格 ⟺ created_daa ≤ beacon  AND  lockUntilDaa > resolutionDaa + cooldownN (严格 >, 防窗尾 race)
 *          AND amount ≥ minSompi。 全 DAA-score 域比较。
 *   不合格 = 该 member zero 权重 (确定性: 各节点同算 → 同排除, 非操纵向量)。
 */
export function isEligibleOracleStake(stake, ctx) {
  const createdDaa = assertDaaDomain('created_daa', stake.createdDaa);
  const lockUntilDaa = assertDaaDomain('lockUntilDaa', stake.lockUntilDaa);
  const beaconDaa = assertDaaDomain('beaconDaa', ctx.beaconDaa);
  // Bettor 洞①: ctx.tipDaa 提供时(chain-read 路必传)→ robust seconds-mixing 守(resolutionDaa ≤ tipDaa);
  //   纯单测路 tipDaa 省 → 仅 ms-guard(assertDaaDomain 局限, 见其注释)。
  const resolutionDaa = ctx.tipDaa != null
    ? assertResolutionDaaVsTip(ctx.resolutionDaa, ctx.tipDaa)
    : assertDaaDomain('resolutionDaa', ctx.resolutionDaa);
  const cooldownN = BigInt(ctx.cooldownN);
  const amount = BigInt(stake.amount || 0);
  const minSompi = BigInt(ctx.minSompi);

  if (createdDaa > beaconDaa) return false;                    // beacon 后创建 → 排除
  if (lockUntilDaa <= resolutionDaa + cooldownN) return false; // 严格 > : 锁未严格越过 enforcement 窗尾 → race → 排除
  if (amount < minSompi) return false;                         // 不足额 → 排除
  return true;
}

/**
 * C2 membership — caller 给 member pk-list (不可信) → 验 buildPoolMerkleTree(pks) == 链读 poolMerkleRoot。
 *   毒 list (注入假 oracle / 漏诚实成员 / 改序) → built root ≠ chain root → reject。membership trustless,
 *   不需全局 indexer (chainPoolMerkleRoot 必来自链上 PS ctor 直读, 见 loadPoolMerkleRootFromChain)。
 */
export function validateMembershipAgainstChainRoot(memberPks, chainPoolMerkleRoot) {
  if (!Array.isArray(memberPks) || memberPks.length === 0) {
    return { ok: false, reason: 'C2: empty member list' };
  }
  const built = buildPoolMerkleTree(memberPks.map(p => String(p).toLowerCase()));
  const builtRoot = (built.root?.toString ? built.root.toString('hex') : String(built.root)).toLowerCase();
  const wantRoot = String(chainPoolMerkleRoot || '').toLowerCase();
  if (builtRoot !== wantRoot) {
    return { ok: false, reason: `C2: buildPoolMerkleTree ${builtRoot.slice(0, 16)} != chain poolMerkleRoot ${wantRoot.slice(0, 16)} (毒 list / 漏成员 / 改序)` };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 以下 = rpc-handle 依赖的链读 loader。骨架 + grounded 方案注释; 实现待 [下个 focused session] 完成:
//   破 pool-shard-settle 透传非纯链 + probe-pin poolMerkleRoot offset + cov_id tracer + level2-A 对接 + live e2e。
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * deadline-derived 确定性 beacon (抗 grinding, NOT caller-passed)。
 *   = getBlockAtDaa 首块 daa ≥ resolutionDaa (rpc-listener.mjs getBlockAtDaa 走 selected-parent-chain = 跨节点确定)。
 *   返 { beaconDaa, endBlockHash } — committee seed (deriveCommitteeSeed) + 资格谓词 created_daa≤beacon 用。
 * @param {object} rpc - relay connectRpc handle (注入)
 */
export async function deriveBeacon(rpc, resolutionDaa) {
  assertDaaDomain('resolutionDaa', resolutionDaa);
  // TODO[impl]: const block = await getBlockAtDaa(rpc, Number(resolutionDaa));
  //   return { beaconDaa: BigInt(block.daaScore), endBlockHash: block.hash };
  throw new Error('deriveBeacon: TODO impl — wire rpc getBlockAtDaa(首块 daa≥resolutionDaa)');
}

/**
 * cov_id / spk ← RPC 解析【被签 input 的 outpoint】(非 caller-embed tx.utxo)。
 *   self-defeating 兜底: 假 utxo → sighash mismatch → 网络拒; 但主防 = relay 自 RPC 解析真链 UTXO。
 *   返 { covId, spkHex, redeemHex? }。
 * @param {object} rpc - relay connectRpc handle
 * @param {{transactionId:string, index:number}} outpoint - 被签 PS input 的 outpoint
 */
export async function resolveCovIdFromInput(rpc, outpoint) {
  // TODO[impl]: getUtxosByOutpoints / getUtxosByAddresses 解析该 outpoint 的链上 UTXO entry,
  //   读 entry.covenantId (consensus metadata, 链真相不可伪) + scriptPublicKey。
  throw new Error('resolveCovIdFromInput: TODO impl — RPC 解析 outpoint→entry.covenantId/spk');
}

/**
 * poolMerkleRoot + predicate_commit ← 被签 close_attest PS UTXO 的 on-chain redeem ctor (零 DB)。
 *   码确认 PayoutShard.sil L35-44: ctor param1 = poolMerkleRoot, param2 = predicate_commit, 无 market_id。
 *   predicate_commit @ byte-offset 518 (J2 probe). poolMerkleRoot offset 待 probe-pin (在 518 之前)。
 * @param {string} psRedeemHex - 该 PS input 的 redeem (经 resolveCovIdFromInput 链锚 + p2sh(redeem)==链上 addr 验)
 */
export function readPoolMerkleRootFromPsRedeem(psRedeemHex) {
  const PREDICATE_COMMIT_OFFSET = 518;
  // TODO[probe-pin]: poolMerkleRoot 的 byte offset (param1, 在 predicate_commit@518 之前)。
  //   probe 法同 predicate_commit: compile PayoutShard.sil 两 poolMerkleRoot 值 diff first-occurrence。
  const POOL_MERKLE_ROOT_OFFSET = null; // ← PROBE 待定
  if (POOL_MERKLE_ROOT_OFFSET == null) {
    throw new Error('readPoolMerkleRootFromPsRedeem: TODO probe-pin poolMerkleRoot offset (PayoutShard redeem)');
  }
  return {
    poolMerkleRoot: psRedeemHex.slice(POOL_MERKLE_ROOT_OFFSET * 2, (POOL_MERKLE_ROOT_OFFSET + 32) * 2),
    predicateCommit: psRedeemHex.slice(PREDICATE_COMMIT_OFFSET * 2, (PREDICATE_COMMIT_OFFSET + 32) * 2),
  };
}

/**
 * stake (B): per member pk, relay 自算 canonical lockUntilDaa → 派生 OracleStake 地址 → 查恰一地址 chain amount = 权重。
 *   绝不收 caller lockUntilDaa。无 canonical-地址 qualifying UTXO = zero 权重 (确定性排出)。
 *   返 [{ pk, amount(BigInt, 0=不合格) }] for stake-weighted selectCommittee。
 * @param {object} rpc - relay connectRpc handle
 * @param {string[]} memberPks - C2-validated member pk-list
 * @param {{resolutionDaa, beaconDaa, cooldownN, margin, minSompi, networkId}} ctx - 全 DAA-score 域
 */
export async function loadOracleStakesFromChain(rpc, memberPks, ctx) {
  const lockUntilDaa = canonicalLockUntilDaa(ctx.resolutionDaa, ctx.cooldownN, ctx.margin);
  const out = [];
  for (const pk of memberPks) {
    // TODO[impl]: const { computeStakeP2SH_v1, ORACLE_STAKE_MIN_SOMPI } = await import('./oracle-stake-v1.mjs');
    //   const addr = await computeStakeP2SH_v1({ stakerPkX: pk, lockUntilDaa, networkId: ctx.networkId });
    //   const { entries } = await rpc.getUtxosByAddresses([addr]);
    //   找 entry: 取 createdDaa=entry.blockDaaScore, amount=entry.amount;
    //   合格 = isEligibleOracleStake({createdDaa, lockUntilDaa, amount}, {...ctx, minSompi: ORACLE_STAKE_MIN_SOMPI})
    //   out.push({ pk, amount: 合格 ? amount : 0n });
    void pk; void lockUntilDaa;
    throw new Error('loadOracleStakesFromChain: TODO impl — computeStakeP2SH_v1 + getUtxosByAddresses + isEligibleOracleStake');
  }
  return out;
}

/**
 * bettors 完整集 ← 链上 PoolSide ticket 枚举 (level2-A, J2 已做)。
 *   per-bettor 链锚: side_lock_daa (accept-block daa, DAA-score 域) <= deadline_daa (越界 bet 排)。
 *   完整-集: 从链上 bshard ShardLeaf (pool_value/count/tickets) 重建 == loaded (防 settler 漏 bettor 改 pari-mutuel)。
 * @param {object} rpc - relay connectRpc handle
 */
export async function loadBettorsFromChain(rpc, marketAnchor, ctx) {
  // TODO[impl]: 对接 J2 level2-A ticket 枚举; 返 [{ pk, stake, side, side_lock_daa }]。
  throw new Error('loadBettorsFromChain: TODO impl — 对接 level2-A 链上 ticket 枚举');
}
