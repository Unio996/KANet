// Bettor red-team attack-cases — Track B enforce lib @ 8f633291 (2026-06-22).
// 目的: 把红队 finding 做成【可执行证据】, 证明命门有牙/无牙 (verify-not-echo, "有牙非 vacuous" 方法论)。
// 每个 attack-case 双跑: 【修前=hole 真 pass(攻击得手)】vs【修后应=真 refuse】。修后回来重跑同档即验修。
//
// 覆盖:
//   A1 — C1 级2-B silent-skip (我新抓): canTicket=false 时 anti-identity-swap 被跳过仍返 ok:true。
//        对照 = J1 c1-complete-set-test T4 (有 deriveTicketAddr → BUST)。本档去掉 ticket primitive → 现 ok:true (hole)。
//   A2 — D2 root-from-signed-tx (NWT+我, 最承重): 这是【设计断言】不是单元可注入(enforce 现根本不读 txSafeJson 输出),
//        故 A2 以【静态断言】坐实: enforce 源码对 txSafeJson 只取 hash 不 parse 输出根 → claimedPayoutRoot 与被签根无绑定。
//
// ⚠ 这些是 OFFLINE 逻辑/静态证据 (mock chain / 源码扫描), 非 live 链上。E1 闭+(A)-model live 后我+NWT 跑真链 e2e。

import { verifyBettorsCompleteFromChain, reDeriveCommittee, verifyClosePayoutRootBinding } from '../src/lib/bshard-close-enforce.mjs';
import { buildPoolMerkleTree } from '../src/services/pool-merkle-v06.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const _DIR = dirname(fileURLToPath(import.meta.url));
const ENFORCE_SRC = join(_DIR, '../src/lib/bshard-close-enforce.mjs');

let teeth = 0, holes = 0;
const TEETH = (m) => { teeth++; console.log('  🦷 TEETH (修后正确拒):', m); };
const HOLE  = (m) => { holes++; console.log('  🕳  HOLE  (修前得手, 待修):', m); };

const MID = 'logical-market-X';
// 同 J1 T4 anti-swap 场景: shard1 真 bettor=cc(NO,150), settler 换成 zz(NO,150) — 聚合不变, zz 链上无 ticket。
const shards = () => ([
  { shard_index: 0, shard_market_id: 's0', shard_redeem_hex: 'aa'.repeat(40), current_leaf_outpoint: 'tx0:0',
    current_leaf_state: JSON.stringify({ local_yes: 300, local_no: 0, count: 2, pool_value: 300 }) },
  { shard_index: 1, shard_market_id: 's1', shard_redeem_hex: 'bb'.repeat(40), current_leaf_outpoint: 'tx1:0',
    current_leaf_state: JSON.stringify({ local_yes: 0, local_no: 150, count: 1, pool_value: 150 }) },
]);
const swapRows = { s0: [{ bettor_pk: 'aa', direction: 0, stake_amount: 100 }, { bettor_pk: 'bb', direction: 0, stake_amount: 200 }],
                   s1: [{ bettor_pk: 'zz', direction: 1, stake_amount: 150 }] };   // zz substituted for cc
const swapLoaded = [{ pk: 'aa', direction: 0, stake: 100 }, { pk: 'bb', direction: 0, stake: 200 }, { pk: 'zz', direction: 1, stake: 150 }];
const onChainTickets = new Set(['aa:0:100', 'bb:0:200', 'cc:1:150']);   // real cc on-chain; zz never registered

function mockDb(rows, hasPS = false) {
  return { prepare(sql) {
    if (/FROM market_shards/.test(sql)) return { all: () => shards() };
    if (/FROM payout_shards/.test(sql)) return { get: () => (hasPS ? { x: 1 } : undefined) };
    if (/FROM pool_bettor_sides/.test(sql)) return { all: (mid) => rows[mid] || [] };
    return { all: () => [], get: () => undefined };
  } };
}
// 级2-A primitives ONLY (p2sh + checkUtxoLanded). NO deriveTicketAddr, NO silverc → canTicket=false。
function ctxNoTicketPrimitive() {
  return {
    db: mockDb(swapRows),
    p2sh: (redeem) => 'L:' + String(redeem).slice(0, 12),
    checkUtxoLanded: async (addr) => String(addr).startsWith('L:'),   // leaf landed; tickets unknowable (no addr derivation)
    // deriveTicketAddr 故意缺 / silverc 故意缺 = 模拟 J2 wire 时只给级2-A primitive 漏级2-B primitive
  };
}
// 完整 primitives (= J1 T4) — anti-swap 应 BUST。
function ctxFullPrimitive() {
  return {
    db: mockDb(swapRows),
    p2sh: (redeem) => 'L:' + String(redeem).slice(0, 12),
    deriveTicketAddr: ({ bettorPk, direction, stake }) => 't:' + `${bettorPk}:${direction}:${stake}`,
    checkUtxoLanded: async (addr) => {
      if (String(addr).startsWith('L:')) return true;
      if (String(addr).startsWith('t:')) return onChainTickets.has(String(addr).slice(2));
      return false;
    },
  };
}

(async () => {
  console.log('=== A1: C1 级2-B silent-skip (anti-identity-swap vacuous when ticket primitive absent) ===');
  console.log('  场景: settler 把真 bettor cc(NO,150) 换成等额 sybil zz(NO,150) — 聚合(Σyes/no/count/pool)全不变。');

  // A1-control: 完整 primitive → 级2-B 应抓 (有牙)
  const ctrl = await verifyBettorsCompleteFromChain(MID, swapLoaded, ctxFullPrimitive());
  if (ctrl.ok === false && /anti-swap|ticket/.test(ctrl.reason || '')) TEETH(`完整 primitive 下 identity-swap 被拒: ${ctrl.reason}`);
  else HOLE(`完整 primitive 下竟未拒 (ok=${ctrl.ok}) — 级2-B 本身坏了`);

  // A1-attack: 缺 ticket primitive → 现码静默跳过级2-B → ok:true (swap 得手)
  const atk = await verifyBettorsCompleteFromChain(MID, swapLoaded, ctxNoTicketPrimitive());
  console.log(`  缺 ticket primitive 结果: ok=${atk.ok} perTicketVerified=${atk.perTicketVerified} reason=${atk.reason || '-'}`);
  if (atk.ok === true && atk.perTicketVerified === false) {
    HOLE('缺 deriveTicketAddr/silverc → 级2-B 静默跳过 → identity-swap 通过 (ok:true, perTicketVerified:false) = false-GREEN。修=对齐级2-A fail-loud。');
  } else if (atk.ok === false) {
    TEETH(`缺 ticket primitive 已 fail-loud 拒 (修已落): ${atk.reason}`);
  } else {
    console.log('  ?? 非预期: ', JSON.stringify(atk));
  }

  console.log('\n=== A2: D2 root-from-signed-tx (功能注入靶 — verifyClosePayoutRootBinding 真绑被签 tx commit 的根) ===');
  // J1 86523223 落 verifyClosePayoutRootBinding(从被签 txSafeJson 反解 covenant continuation output 的 P2SH spk 验根)。
  // 我【独立功能注入】(非静态扫): 自举学到 expectedSpk → 造 匹配/错根/decoy txSafeJson 喂进去验 BUST/PASS。零 wasm/零内部 import。
  const PSREDEEM = 'aa'.repeat(600);            // dummy PS redeem (够长 ≥ rootOff+33; 测绑定逻辑非真 redeem 内容)
  const RROOT = 'bb'.repeat(32);               // re-derived (诚实) root
  // 自举: 喂一个 dummy-spk covenant output → 函数返 expectedSpk (它内部从 PSREDEEM+RROOT 算的 = 真绑值)
  const boot = verifyClosePayoutRootBinding({ txSafeJson: JSON.stringify({ version: 1, outputs: [{ covenant: { covenantId: 'cc' }, scriptPublicKey: 'deadbeef' }] }), psRedeemHex: PSREDEEM, reDerivedRoot: RROOT });
  const EXP = boot.expectedSpk;
  if (!EXP) { console.log('  ?? 学不到 expectedSpk, 人工复核 verifyClosePayoutRootBinding'); }
  else {
    // A2-control (TEETH): continuation output spk == expectedSpk(诚实根) → 应 ok:true
    const ctl = verifyClosePayoutRootBinding({ txSafeJson: JSON.stringify({ version: 1, outputs: [{ covenant: { covenantId: 'cc' }, scriptPublicKey: EXP }, { scriptPublicKey: 'change00' }] }), psRedeemHex: PSREDEEM, reDerivedRoot: RROOT });
    if (ctl.ok === true) TEETH(`D2-control: 诚实根 continuation output 验过 (matchedOutputs=${ctl.matchedOutputs})`);
    else HOLE(`D2-control 竟拒(诚实根): ${ctl.reason} — 绑定逻辑坏`);
    // A2-attack-1 (TEETH): settler 给【匹配 claimedPayoutRoot 标量】但 continuation output commit 别的根(spk!=expected) → 必 BUST
    const atk1 = verifyClosePayoutRootBinding({ txSafeJson: JSON.stringify({ version: 1, outputs: [{ covenant: { covenantId: 'cc' }, scriptPublicKey: '0000aa20' + 'ff'.repeat(32) + '87' }] }), psRedeemHex: PSREDEEM, reDerivedRoot: RROOT });
    if (atk1.ok === false && /D2 REJECT/.test(atk1.reason || '')) TEETH(`D2-attack 偷根: 被签 tx commit 恶意根 → BUST (${atk1.reason.slice(0, 40)}..)`);
    else HOLE(`D2-attack 偷根竟通过 (ok=${atk1.ok}) — settler 偷池`);
    // A2-attack-2 decoy (TEETH): 加一个【诚实根】cov-out 当幌子 + 一个【恶意根】cov-out → anti-decoy 全须对 → 必 BUST
    const atk2 = verifyClosePayoutRootBinding({ txSafeJson: JSON.stringify({ version: 1, outputs: [{ covenant: { covenantId: 'cc' }, scriptPublicKey: EXP }, { covenant: { covenantId: 'dd' }, scriptPublicKey: '0000aa20' + 'ee'.repeat(32) + '87' }] }), psRedeemHex: PSREDEEM, reDerivedRoot: RROOT });
    if (atk2.ok === false) TEETH(`D2-decoy: 诚实根 cov-out 当幌子 + 恶意根 cov-out → anti-decoy 全须对 → BUST`);
    else HOLE(`D2-decoy 竟通过 — anti-decoy(全 cov-out 须对)没起作用`);
    // A2-attack-3 (TEETH): 零 covenant continuation output (settler 抹掉 cov-out) → 非合法 close_attest → 必 BUST
    const atk3 = verifyClosePayoutRootBinding({ txSafeJson: JSON.stringify({ version: 1, outputs: [{ scriptPublicKey: 'change00' }] }), psRedeemHex: PSREDEEM, reDerivedRoot: RROOT });
    if (atk3.ok === false && /covenant continuation/.test(atk3.reason || '')) TEETH(`D2-no-cov-out: 无 covenant continuation → BUST`);
    else HOLE(`D2-no-cov-out 竟通过 (ok=${atk3.ok})`);
  }

  console.log('\n=== A4: D2 version-gate NaN-bypass (Bettor 补 NWT version-gate 残口) ===');
  // NWT 抓 version-gate(L91 Number(version)<1 拒 v0, malleability-safe 依赖 version>=1)。我补: Number(undefined)=NaN, NaN<1=false
  //   → version【缺失/非数字】绕过 gate。settler 全控 txSafeJson → 省 version → 若 deserializeFromSafeJSON 默认 v0 则 move-binding 复活。
  //   修(J1, NWT 自己'别靠别处 BUST'铁律) = !(Number(version)>=1) 拒 NaN/缺失/0。修前: 省略/NaN ok:true(HOLE); 修后: 全 BUST。
  const vboot = verifyClosePayoutRootBinding({ txSafeJson: JSON.stringify({ version: 1, outputs: [{ covenant: { covenantId: 'cc' }, scriptPublicKey: 'x' }] }), psRedeemHex: PSREDEEM, reDerivedRoot: RROOT });
  const VEXP = vboot.expectedSpk;
  // v0 (NWT case) → 必 BUST
  const v0 = verifyClosePayoutRootBinding({ txSafeJson: JSON.stringify({ version: 0, outputs: [{ covenant: { covenantId: 'cc' }, scriptPublicKey: VEXP }] }), psRedeemHex: PSREDEEM, reDerivedRoot: RROOT });
  if (v0.ok === false && /version/.test(v0.reason || '')) TEETH(`version=0 → BUST (NWT gate): ${v0.reason.slice(0, 36)}..`);
  else HOLE(`version=0 竟通过 — NWT version-gate 坏`);
  // version 省略 → NaN-bypass (我补): 修前 ok:true=HOLE
  const vNone = verifyClosePayoutRootBinding({ txSafeJson: JSON.stringify({ outputs: [{ covenant: { covenantId: 'cc' }, scriptPublicKey: VEXP }] }), psRedeemHex: PSREDEEM, reDerivedRoot: RROOT });
  if (vNone.ok === false) TEETH(`version 缺失 → BUST (NaN-gate 修已落)`);
  else HOLE(`version 缺失 → ok:true = NaN 绕过 version-gate (move-binding malleability 风险)。修=!(Number(version)>=1)`);
  // version="abc" (NaN) → 同 bypass
  const vNan = verifyClosePayoutRootBinding({ txSafeJson: JSON.stringify({ version: 'abc', outputs: [{ covenant: { covenantId: 'cc' }, scriptPublicKey: VEXP }] }), psRedeemHex: PSREDEEM, reDerivedRoot: RROOT });
  if (vNan.ok === false) TEETH(`version='abc'(NaN) → BUST (NaN-gate 修已落)`);
  else HOLE(`version='abc'(NaN) → ok:true = NaN 绕过 version-gate`);

  console.log('\n=== A3: C2 anchor 软 (reDeriveCommittee 接受自洽 sybil snapshot, 即便链上真根不同) ===');
  console.log('  场景: settler 控 loadPoolSnapshot → 供 {honest 6 + sybil 2, root=buildPoolMerkleTree(全集)}。');
  const _root = (pks) => { const t = buildPoolMerkleTree(pks); return (t.root?.toString ? t.root.toString('hex') : String(t.root)).toLowerCase(); };
  const mk = (n, stake) => ({ pk_hex: (n.repeat(64)).slice(0, 64), stake_sompi: String(stake) });
  const honestMembers = [mk('1', 100), mk('2', 100), mk('3', 100), mk('4', 100), mk('5', 100), mk('6', 100)];
  const sybilMembers = [...honestMembers, mk('a', 100000), mk('b', 100000)];   // 2 high-stake sybils
  const honestRoot = _root(honestMembers.map(m => m.pk_hex));
  const sybilRoot = _root(sybilMembers.map(m => m.pk_hex));
  // mock ctx: endBlockHash 固定(determinism); 关键 = 同时给 onChainPoolMerkleRoot=honestRoot, 但 snapshot.root=sybilRoot。
  const a3ctx = (snapMembers, snapRoot) => ({
    loadPoolSnapshot: async () => ({ pool_merkle_root: snapRoot, members: snapMembers, maker_pk: null, broker_pk: null, deadline_daa: 1000 }),
    onChainPoolMerkleRoot: honestRoot,                       // 链上真根 (诚实集) — 修后 reDeriveCommittee 应 pin 到它
    fetchEndBlockHashCanonical: async () => 'cc'.repeat(32),  // 固定 endBlockHash (anti-grinding mock)
    chainReader: {}, deadlineDaa: 1000,
    loadBettors: async () => [],   // J1 2026-06-23: reDeriveCommittee bettor-exclude 现 mandatory (NWT fail-loud), A3 测 C2 无 bettor → 空集 graceful (A3 意图/sybil-TEETH 不变)
  });
  // control: honest snapshot (root==onChain) → 应正常 re-derive
  try {
    const cH = await reDeriveCommittee('mkt-A3', a3ctx(honestMembers, honestRoot));
    TEETH(`honest snapshot 正常 re-derive (委员 ${cH.length} 名, root==链上)`);
  } catch (e) { HOLE(`honest snapshot 竟抛: ${e.message}`); }
  // attack: sybil snapshot (self-consistent sybilRoot) but onChain=honestRoot
  try {
    const cS = await reDeriveCommittee('mkt-A3', a3ctx(sybilMembers, sybilRoot));
    const hasSybil = cS.some(pk => pk.startsWith('a') || pk.startsWith('b'));
    HOLE(`sybil snapshot 自洽(root=buildPoolMerkleTree(sybil集)) 通过 reDeriveCommittee【虽然链上真根=honestRoot 不同】→ 委员=${cS.length} 名${hasSybil ? ', 含 sybil!' : ''}。修=snap.pool_merkle_root 必 == ctx.onChainPoolMerkleRoot 否则 throw。`);
  } catch (e) {
    if (/链上|onChain|on-chain|!=/.test(e.message)) TEETH(`sybil snapshot 被拒(root != 链上真根): ${e.message}`);
    else HOLE(`sybil snapshot 抛了但非链锚原因(可能 C2 internal-consistency 或缺 module): ${e.message}`);
  }

  console.log('\n=== A5/A6: omit-shard 攻击两变体 (J1 cross-node PS-pool 锚 94cfef67, NWT 点的) ===');
  // J1 PS-pool 锚: verifyBettorsCompleteFromChain 验 ctx.psConsolidatedPool == psSeed(20M) + Σloaded。
  //   变体①(漏【已 consolidate】片): psConsolidatedPool 含被漏片 → != seed+loadPool → BUST(有牙)。
  //   变体②(提前 close 子集, 漏【未 consolidate】片): psConsolidatedPool 与 loadPool 都不含 → 自洽 → PASS(真残留, 待 lineage 锚)。
  const SEED = 20000000n;                       // PS_SEED 固定 (register)
  const KAS = 100000000n;
  // 诚实场景: 3 真片 (s0: a0 YES + b0 NO, s1: a1 YES + c1 YES, s2[被漏]: 2 NO)。每注 1 KAS。
  // ⚠ sh.bettors 必填(否则 级2-B per-ticket 0 行假 BUST = 误判残留被锚, NWT 警告的坑)。
  const mkShard = (idx, bets) => ({
    shard_index: idx, shard_market_id: `s${idx}`, shard_redeem_hex: (String(idx).repeat(2)).repeat(20),
    current_leaf_outpoint: `tx${idx}:0`, shard_pool_id: 'sp'.repeat(16),
    current_leaf_state: {
      local_yes: Number(bets.filter(b => b.direction === 0).reduce((s, b) => s + BigInt(b.stake), 0n)),
      local_no: Number(bets.filter(b => b.direction === 1).reduce((s, b) => s + BigInt(b.stake), 0n)),
      count: bets.length, pool_value: Number(bets.reduce((s, b) => s + BigInt(b.stake), 0n)),
    },
    bettors: bets,
  });
  const s0bets = [{ pk: 'a0', direction: 0, stake: KAS.toString() }, { pk: 'b0', direction: 1, stake: KAS.toString() }];
  const s1bets = [{ pk: 'a1', direction: 0, stake: KAS.toString() }, { pk: 'c1', direction: 0, stake: KAS.toString() }];
  // 子集快照 = s0,s1 (漏 s2)。loaded 配子集 (4 注, Σ4 KAS, count 4, yes 3 no 1 == snapSubset 聚合)。
  const snapSubset = [mkShard(0, s0bets), mkShard(1, s1bets)];
  const loadedSubset = [...s0bets, ...s1bets];
  // 诚实链: 子集片 leaf + 子集 bettor 的 ticket 都 landed (settler 没碰子集, 只是【整片漏 s2】)。
  const honestTickets = new Set(loadedSubset.map(b => `${b.pk}:${b.direction}:${b.stake}`));
  const omitCtx = (psConsolidatedPool) => ({
    shards: snapSubset,
    p2sh: (redeem) => 'L:' + String(redeem).slice(0, 10),
    checkUtxoLanded: async (addr) => {
      if (String(addr).startsWith('L:')) return true;                       // 子集 leaf landed
      if (String(addr).startsWith('t:')) return honestTickets.has(String(addr).slice(2));  // 子集 ticket landed
      return false;
    },
    deriveTicketAddr: ({ bettorPk, direction, stake }) => 't:' + `${bettorPk}:${direction}:${stake}`,
    psConsolidatedPool, psSeed: SEED.toString(),
  });
  // 变体① — psConsolidatedPool 含被漏片 s2 (它【已 consolidate】): seed + (s0+s1+s2)=seed+6KAS, 但 loadPool=4KAS → BUST
  const v1pool = (SEED + 6n*KAS).toString();
  const r5 = await verifyBettorsCompleteFromChain('mkt-omit', loadedSubset, omitCtx(v1pool));
  if (r5.ok === false && /PS-pool|consolidated_pool|omit/.test(r5.reason || '')) TEETH(`变体①(漏已-consolidate 片)→ PS-pool 锚 BUST: ${r5.reason.slice(0, 50)}..`);
  else HOLE(`变体① 竟未 BUST (ok=${r5.ok}) — PS-pool 锚没起作用`);
  // 变体② — psConsolidatedPool 只含子集 s0,s1 (s2【未 consolidate】, 提前 close): seed+4KAS == seed+loadPool → 自洽 PASS
  const v2pool = (SEED + 4n*KAS).toString();
  const r6 = await verifyBettorsCompleteFromChain('mkt-omit', loadedSubset, omitCtx(v2pool));
  if (r6.ok === true) HOLE(`变体②(提前 close 子集+漏未-consolidate 片)→ 自洽 PASS = 真残留(诚实标, 待 PS cov_id lineage 片集枚举锚)`);
  else TEETH(`变体② 已被拒(lineage 锚已落?): ${r6.reason}`);

  console.log(`\nRESULT: ${teeth} TEETH(修后正确), ${holes} HOLE(待修)。`);
  console.log(holes > 0
    ? '⛔ 仍有 HOLE — 这些 case 现在【攻击得手】, 是 J1/J2 修的验收靶。修后重跑本档应全 TEETH。'
    : '✅ 全 TEETH — 命门修后正确拒, 攻击无牙。');
  process.exit(0);   // 红队靶档: 不以 hole 为失败(它本就该现 hole), 用于修前/修后对照。
})();
