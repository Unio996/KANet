// Stair-step same-entity deadline auditor (Bettor r174 — R-COMPETITOR-BLIND-SPOT 第 4 案例 治本).
//
// 5/17 Bettor 推 Starmer May 31 YES @ $0.343 没 surface June 30 YES @ $0.69. 漏 logic:
// 同 entity 多 deadline 系列必 P(out Y2 | survive Y1) = (b - a) / (1 - a) 比对.
// 真实 Starmer 阶梯: May 19 9% / May 31 29% / June 30 69% / Dec 31 88.5%
//   conditional 6/1-6/30 = (0.69 - 0.29) / 0.71 = 56% ← Burnham 6/18 priced
//
// 本服务: 从 slug 提 entity_key + group + 算 conditional + flag mispricing + recommended pick.

const ENTITY_SLUG_PATTERNS = [
  // Maps slug regex → entity_key extractor
  { re: /^(starmer)-out-by-/i, key: m => 'starmer-out' },
  { re: /^(trump)-out-by-/i, key: m => 'trump-out' },
  { re: /^(biden)-out-by-/i, key: m => 'biden-out' },
  { re: /^(putin)-out-by-/i, key: m => 'putin-out' },
  { re: /^(iran)-([a-z-]+?)-by-/i, key: m => `iran-${m[2]}` },
  { re: /^(us)-x-iran-([a-z-]+?)-by-/i, key: m => `us-iran-${m[2]}` },
  // Generic: <entity>-by-YYYY-MM-DD → strip trailing date
  { re: /^([a-z0-9-]+?)-by-\d{4}/i, key: m => m[1] },
];

export function extractEntityKey(slug) {
  if (!slug) return null;
  const s = String(slug).toLowerCase();
  for (const p of ENTITY_SLUG_PATTERNS) {
    const m = s.match(p.re);
    if (m) return p.key(m);
  }
  return null;
}

/**
 * Group recs by entity_key, return stair-step audit for entities with >1 deadline.
 * Each entity result: {entity_key, deadlines: [{end_date, yes_price, ...}], conditional: [{from, to, days, prob}], mispricing_flags, recommended}
 */
export function buildStairStepAudit(recs) {
  const byEntity = {};
  for (const r of recs) {
    const ek = extractEntityKey(r.slug);
    if (!ek) continue;
    if (!byEntity[ek]) byEntity[ek] = [];
    byEntity[ek].push(r);
  }
  const audits = [];
  for (const [entity_key, list] of Object.entries(byEntity)) {
    if (list.length < 2) continue;
    // sort by end_date ascending
    const sorted = [...list].sort((a, b) => new Date(a.end_date) - new Date(b.end_date));
    const deadlines = sorted.map(r => ({
      id: r.id,
      slug: r.slug,
      end_date: r.end_date,
      yes_price: r.yes_price,
      side: r.decision,
    }));
    // conditional probabilities + mispricing flags
    const conditional = [];
    const flags = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i].yes_price;
      const b = sorted[i + 1].yes_price;
      const days = (new Date(sorted[i + 1].end_date) - new Date(sorted[i].end_date)) / 86400000;
      if (b < a) {
        flags.push({ type: 'arbitrage', from: sorted[i].end_date.slice(0, 10), to: sorted[i + 1].end_date.slice(0, 10), msg: `b<a violates monotonic time constraint (${b} < ${a})` });
        conditional.push({ from: sorted[i].end_date.slice(0, 10), to: sorted[i + 1].end_date.slice(0, 10), days: days.toFixed(0), prob: null, note: 'arbitrage' });
        continue;
      }
      const prob = (1 - a) > 0 ? (b - a) / (1 - a) : null;
      conditional.push({ from: sorted[i].end_date.slice(0, 10), to: sorted[i + 1].end_date.slice(0, 10), days: days.toFixed(0), prob: prob != null ? Number(prob.toFixed(3)) : null });
      if (prob != null && prob > 0.80) flags.push({ type: 'near_certain', from: sorted[i].end_date.slice(0, 10), to: sorted[i + 1].end_date.slice(0, 10), msg: `conditional ${(prob * 100).toFixed(0)}% near-certain — strong signal OR mispricing` });
      if (prob != null && prob < 0.05) flags.push({ type: 'near_impossible', from: sorted[i].end_date.slice(0, 10), to: sorted[i + 1].end_date.slice(0, 10), msg: `conditional ${(prob * 100).toFixed(1)}% near-impossible — strong signal OR mispricing` });
    }
    // recommended pick = highest conditional prob window (excluding flagged arbitrage)
    let recommended = null;
    let bestProb = -1;
    for (let i = 0; i < conditional.length; i++) {
      const c = conditional[i];
      if (c.prob != null && c.prob > bestProb) { bestProb = c.prob; recommended = { ...c, deadline_idx: i + 1, deadline: deadlines[i + 1] }; }
    }
    audits.push({ entity_key, count: deadlines.length, deadlines, conditional, mispricing_flags: flags, recommended });
  }
  return audits;
}
