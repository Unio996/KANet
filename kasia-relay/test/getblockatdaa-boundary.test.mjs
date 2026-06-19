// getblockatdaa-boundary.test.mjs — J1 #266/#268 (a)+(b) stuck-settle boundary seam 单元测 (Bettor r807 批)
// 用法: node kasia-relay/test/getblockatdaa-boundary.test.mjs
//
// 守边界缝修: (a) getBlockAtDaa backward walk 的 resolved-flag + throw 条件; (b) settler guard race-margin.
// 注: (a) 测【复刻 rpc-listener.mjs getBlockAtDaa backward 段的 exact 逻辑】(resolved + throw 条件), 钉死
// 边界行为防回归。real impl 是真相源, 改 rpc-listener 那段必同步改本测。

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ FAIL ${name}`); } }

// ── 复刻 (a) backward walk 逻辑 (== rpc-listener.mjs getBlockAtDaa L202-230) ──
// chain: 数组 [tip, tip-1, ...], 每个 = { hash, daaScore, selectedParentHash }. getBlock 按 hash 查.
function backwardWalk(chain, deadlineDaa, MAX_WALK) {
  const byHash = new Map(chain.map(b => [b.hash, b]));
  let cursor = chain[0].hash; // sink = tip
  let lastEligible = null, resolved = false, steps = 0;
  for (let i = 0; i < MAX_WALK; i++) {
    steps++;
    const blk = byHash.get(cursor);
    const hash = blk?.hash, daa = Number(blk?.daaScore || 0), sp = blk?.selectedParentHash;
    if (!hash || !daa) throw new Error(`malformed block at ${cursor}`);
    if (daa >= deadlineDaa) {
      lastEligible = { hash, daaScore: daa };
      if (!sp || sp === '0'.repeat(64)) { resolved = true; break; } // genesis
      cursor = sp; continue;
    }
    resolved = true; break; // crossed
  }
  if (!resolved && lastEligible && lastEligible.daaScore > deadlineDaa) {
    const e = new Error(`exhausted MAX_WALK=${MAX_WALK} w/o crossing deadlineDaa=${deadlineDaa} (deepest daa=${lastEligible.daaScore} > deadline=too-new)`);
    e.code = 'CAP_NO_CROSS'; throw e;
  }
  if (!lastEligible) { const e = new Error('no SPC block crossing (future deadline)'); e.code = 'FUTURE'; throw e; }
  return lastEligible;
}

// 建合成 SPC 链: tip..tip-depth, daa 严格递减 (= SPC daaScore 严格递增, J2 r800), 最老块 sp=zeros (genesis)
function makeChain(tipDaa, depth, genesisAtBottom) {
  const c = [];
  for (let i = 0; i <= depth; i++) {
    const isGenesis = genesisAtBottom && i === depth;
    c.push({ hash: `h${tipDaa - i}`, daaScore: tipDaa - i, selectedParentHash: isGenesis ? '0'.repeat(64) : `h${tipDaa - i - 1}` });
  }
  return c;
}

const TIP = 1_000_000, MAX_WALK = 50000;

console.log('=== (a) getBlockAtDaa boundary (resolved-flag + throw) ===');
// 链够深 (60000 块), 非 genesis
const deepChain = makeChain(TIP, 60000, false);

// Δ=49999: deadline=TIP-49999. crossing 在 49999-back(daa=deadline). walk 到 49999-back(最后一迭代)daa==deadline → return (不 throw)
try { const r = backwardWalk(deepChain, TIP - 49999, MAX_WALK); ok('Δ=49999 → return endBlock(daa==deadline)', r.daaScore === TIP - 49999); }
catch (e) { ok('Δ=49999 → return (不 throw)', false); console.log('    误 throw:', e.code); }

// Δ=50000: deadline=TIP-50000. crossing 在 50000-back(够不到). walk 最深 49999-back(daa=deadline+1>deadline) → throw CAP_NO_CROSS
try { backwardWalk(deepChain, TIP - 50000, MAX_WALK); ok('Δ=50000 → throw (返错块前拦住)', false); }
catch (e) { ok('Δ=50000 → throw CAP_NO_CROSS', e.code === 'CAP_NO_CROSS'); }

// Δ=30000 (窗口内): crossing 在 30000-back, walk 见 30001-back(daa<deadline) → cross resolved → return 对块
try { const r = backwardWalk(deepChain, TIP - 30000, MAX_WALK); ok('Δ=30000 (窗口内) → return 正确 crossing', r.daaScore === TIP - 30000); }
catch (e) { ok('Δ=30000 → return', false); }

// genesis: 浅链(深 100, 底=genesis), deadline 比 genesis 还老 → walk 到 genesis 都 >=deadline → resolved(genesis) return 最老块
const genChain = makeChain(TIP, 100, true);
try { const r = backwardWalk(genChain, TIP - 200, MAX_WALK); ok('genesis 市场(deadline 老于链) → return 最老块 不 throw', r.daaScore === TIP - 100); }
catch (e) { ok('genesis → return 不 throw', false); console.log('    误 throw:', e.code); }

// future deadline: deadline 比 tip 还新 → 第一块就 daa<deadline → cross resolved 但 lastEligible=null → FUTURE throw
try { backwardWalk(deepChain, TIP + 100, MAX_WALK); ok('future deadline → throw FUTURE', false); }
catch (e) { ok('future deadline → throw FUTURE(链没到)', e.code === 'FUTURE'); }

console.log('\n=== (b) settler guard race-margin (Δ > MAX_WALK − MARGIN → refund) ===');
const SAFETY_MARGIN = 100, REFUND_THRESHOLD = MAX_WALK - SAFETY_MARGIN; // 49900
const guardRefund = (delta) => delta > REFUND_THRESHOLD;
ok('Δ=49901 → guard refund (>49900)', guardRefund(49901) === true);
ok('Δ=50000 → guard refund (边界带退)', guardRefund(50000) === true);
ok('Δ=49900 → 不退(==阈值, 走采样)', guardRefund(49900) === false);
ok('Δ=30000 → 不退(安全, 走采样)', guardRefund(30000) === false);
// 双封: guard 退 Δ>49900; getBlockAtDaa 对 Δ<=49999 正确(Δ=49999 return). 重叠区 [49901,49999] guard 先退=不依赖 (a). (a) 是 margin 算漏的兜底.
ok('双封不漏: guard 阈值 49900 < getBlockAtDaa 安全上限 49999 (有重叠余量)', REFUND_THRESHOLD < 49999);

console.log(`\n=== boundary 测: ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
