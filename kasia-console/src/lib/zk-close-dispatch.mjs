// zk-close-dispatch.mjs — 缺件③(J1tn, Bettor 2026-07-07 18:53 派工, T2b 生产线本体最后三缺件之一)。
//
// 填 bshard-settle-daemon.mjs 里 `dispatchUnlockZkClose: async () => { throw new Error('TODO...') }`
// 那个 stub(zkClosePhase2 既有接口契约, zk-close-builder.mjs 顶部注释): 消费 zk_continuation.proving
// (T2b(i) schema, status=='ready' 时才可调)里的 gate/guestPayoutRootHex, 组 2-input 调已注册的
// relay 命令 bshard_zk_close(kasia-relay/src/lib/p2sh.mjs unlockBshardZkClose)。
//
// 🔴 unlockBshardZkClose 对 CloseZkV2 byte-exact 有效性: 已由 J2+NWT 双独立核实确认(2026-07-07 20:46-20:49,
// 各自用互不相同哨兵值真实编译 CloseZkV2 实例逐字节核对 byte[1,214) state 区), 并固化成永久 regression guard
// (closezk-v2-mint.ctor-position.test.mjs commit c8540b56)——不需要 V2 镜像函数, 直接绑定使用。
//
// gate 的 sigScript/redeemScript(真实 Groth16 proof witness)本身没有被 zk-prove-worker.mjs 持久化
// (proving.gate 只存 address/outpointTxid/index/fundedAtMs)——本模块从 zk_prove_jobs.receipt_hex +
// proving.imageId/journalHash 三者(全部已持久化)用跟 buildAndFundGate 完全相同的 zk-sdk WASM 调用
// 确定性重新推出(纯函数, 非重新 prove, 零新增信任假设), 不需要改 J2 的 mint/prove-worker 文件。

/**
 * dispatchUnlockZkClose — zkClosePhase2 既有 ctx.dispatchUnlockZkClose({marketId, continuationOutpoint,
 *   attestedWinner}) 接口契约的真实实现(orderedBets/betsRoot 由 zk-close-builder.mjs 既有 gather 逻辑提供,
 *   本函数不用, 只用来满足调用签名——本函数自己的数据来源是 zk_continuation + zk_prove_jobs, 不是 caller
 *   传的这两项)。
 * @param {{marketId:string, continuationOutpoint:{txid:string,index:number}, attestedWinner:number}} args
 * @param {object} ctx {
 *   getMarket(marketId) → {metadata:string}|null,
 *   getDoneJob(marketId) → {receipt_hex:string}|null   (zk_prove_jobs WHERE market_id=? AND status='done' 最新一条),
 *   kaspaZk() → zk-sdk WASM module(ZkScriptBuilder.newR0 等, 同 zk-prove-worker.mjs kaspaZk() 用法),
 *   relayCall(cmd) → Promise<{txId?|txid?}>   (广播, 传输方式由调用方决定——本函数不关心 HTTP/in-process),
 * }
 * @returns {Promise<{ok:boolean, txid?:string, error?:string}>}
 */
export async function dispatchUnlockZkClose({ marketId, continuationOutpoint, attestedWinner }, ctx) {
  const market = ctx.getMarket(marketId);
  if (!market) return { ok: false, error: `market ${marketId} not found` };
  let meta;
  try { meta = JSON.parse(market.metadata || '{}'); } catch (e) { return { ok: false, error: `metadata parse fail: ${e.message}` }; }
  const zkCont = meta.zk_continuation;
  if (!zkCont) return { ok: false, error: 'zk_continuation missing (mint 未完成/未写入)' };

  const proving = zkCont.proving;
  if (!proving || proving.status !== 'ready') {
    return { ok: false, error: `proving.status=${proving?.status ?? 'undefined'} != ready — 未到可 dispatch 的时机(不是错误, tick 该 skip 等下一轮)` };
  }
  // schema 违反(T2b(i) 定的原子写入纪律说"status=ready时这些字段必然同时齐"——万一没齐, 这里就是那个
  // "违反了自己定的原子性假设"的地方, fail-closed 而非静默用 undefined 往下传)。
  if (!proving.gate || !proving.guestPayoutRootHex || !proving.imageId || !proving.journalHash) {
    return { ok: false, error: 'proving.status=ready 但 gate/guestPayoutRootHex/imageId/journalHash 任一缺失 — schema 原子性假设被违反, 拒绝 dispatch' };
  }

  const job = ctx.getDoneJob(marketId);
  if (!job?.receipt_hex) return { ok: false, error: 'zk_prove_jobs.receipt_hex missing for done job — 无法重建 gate witness' };

  // 确定性重建 gate 的 sigScript/redeemScript(纯函数, 跟 zk-prove-worker.mjs buildAndFundGate 完全相同调用,
  // 同一份 receipt+imageId+journalHash 输入 → 同一份输出, 非重新 prove/非新增信任假设)。
  let sigScript, redeemScript;
  try {
    const kaspa = ctx.kaspaZk();
    const builder = kaspa.ZkScriptBuilder.newR0({ flags: { covenantsEnabled: true } });
    builder.commitToGroth16WithFixedJournal(proving.imageId, proving.journalHash);
    ({ sigScript, redeemScript } = builder.finalizeWithGroth16FixedJournalProof(job.receipt_hex));
  } catch (e) { return { ok: false, error: `gate witness 重建 fail: ${e.message}` }; }

  // gate_suffix_hex = redeemScript 去掉 prefix(1B, 0x20=push32)+journal_hash(32B)剩下部分
  // (unlockBshardZkClose docstring 约定, zk-close-builder.mjs ZK_GATE 注释同款: prefix‖journal_hash(32B·变)‖suffix(800B))。
  const redeemBuf = Buffer.from(redeemScript, 'hex');
  if (redeemBuf.length <= 33) return { ok: false, error: `redeemScript 太短(${redeemBuf.length}B) — 无法切出 gate_suffix` };
  const gateSuffixHex = redeemBuf.subarray(33).toString('hex');

  const cmd = {
    type: 'bshard_zk_close',
    inputs: {
      closezk: {
        redeem_hex: zkCont.redeemHex,
        outpointTxid: continuationOutpoint.txid, index: continuationOutpoint.index,
        state: { attestedWinner, consolidated_pool: zkCont.valueSompi },
      },
      gate: { address: proving.gate.address, outpointTxid: proving.gate.outpointTxid, index: proving.gate.index, sig_script_hex: sigScript },
    },
    witness: { self_out_idx: 0, gate_suffix_hex: gateSuffixHex, guest_payout_root_hex: proving.guestPayoutRootHex },
    outputs: {},
  };
  let sj;
  try { sj = await ctx.relayCall(cmd); } catch (e) { return { ok: false, error: `relay dispatch fail: ${e.message}` }; }
  const txid = sj?.txId || sj?.txid;
  if (!txid) return { ok: false, error: `relay 响应无 txId: ${JSON.stringify(sj).slice(0, 200)}` };
  return { ok: true, txid };
}
