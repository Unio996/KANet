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

import { verifyBettorsCompleteFromChain, reDeriveCommittee } from '../src/lib/bshard-close-enforce.mjs';
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

  console.log('\n=== A2: D2 root-from-signed-tx (静态坐实 — enforce 不 parse 被签 txSafeJson 输出根) ===');
  const src = readFileSync(ENFORCE_SRC, 'utf8');
  // D2 断言: txSafeJson 在 enforce 仅用于 hash (verifiedTxHash), 从不 parse 取 close_attest 输出 commit 的根。
  const usesTxSafeJson = (src.match(/txSafeJson/g) || []).length;
  const parsesTxOutputs = /JSON\.parse\([^)]*txSafeJson|txSafeJson[^;\n]*\.(outputs|output|tx)/.test(src);
  const comparesClaimedScalar = /reDerivedRoot\s*!==\s*String\(claimedPayoutRoot\)/.test(src);
  console.log(`  txSafeJson 出现 ${usesTxSafeJson} 次; parse-outputs=${parsesTxOutputs}; 比 caller 标量 claimedPayoutRoot=${comparesClaimedScalar}`);
  if (comparesClaimedScalar && !parsesTxOutputs) {
    HOLE('enforce 只比 reDerivedRoot==claimedPayoutRoot(caller 标量), 从不 parse txSafeJson 输出根 → settler 给对的标量+恶意 tx 根 → 签偷池 tx。修=从被签 txSafeJson 反解 sighash 覆盖的输出根验。');
  } else if (parsesTxOutputs) {
    TEETH('enforce 已 parse txSafeJson 输出根验 (D2 修已落)。');
  } else {
    console.log('  ?? D2 静态特征变了, 人工复核 L130/L136。');
  }

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

  console.log(`\nRESULT: ${teeth} TEETH(修后正确), ${holes} HOLE(待修)。`);
  console.log(holes > 0
    ? '⛔ 仍有 HOLE — 这些 case 现在【攻击得手】, 是 J1/J2 修的验收靶。修后重跑本档应全 TEETH。'
    : '✅ 全 TEETH — 命门修后正确拒, 攻击无牙。');
  process.exit(0);   // 红队靶档: 不以 hole 为失败(它本就该现 hole), 用于修前/修后对照。
})();
