/**
 * Parse a Polymarket-style resolution rule into structured fields.
 *
 * Heuristic / regex-based — no LLM, no network. For ambiguous rules,
 * downstream estimator handles nuance via LLM.
 *
 * Output schema:
 *   yesConditions: string[]      — sentences that trigger YES
 *   disqualifiers: string[]      — sentences with explicit "will not qualify" markers
 *   embeddedFacts: string[]      — content of e.g. parens (often dates / events)
 *   resolutionSources: string[]  — who decides
 *   timeWindow: string|null      — date / time expressions found
 */

const EG_RE = /\(\s*e\.g\.\s*([^)]+)\)/gi;
const DATE_RE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/g;
const TIME_RE = /\d{1,2}:\d{2}\s*(?:AM|PM)\s*(?:ET|EST|UTC|GMT|PT|PST)?/gi;

const DISQ_MARKERS = [
  /will not qualify/i,
  /will not count/i,
  /does not count/i,
  /do not constitute/i,
  /not include/i,
  /explicitly temporary/i,
];

const YES_MARKERS = [
  /resolve to ["']?Yes["']?\s+if/i,
  /will be considered to have been established if/i,
  /qualifying agreement/i,
];

export function parseRule(ruleText) {
  if (!ruleText || typeof ruleText !== 'string') {
    return { yesConditions: [], disqualifiers: [], embeddedFacts: [], resolutionSources: [], timeWindow: null };
  }

  const sentences = ruleText.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);

  const disqualifiers = sentences.filter(s => DISQ_MARKERS.some(re => re.test(s)));
  const yesConditions = sentences.filter(s => YES_MARKERS.some(re => re.test(s)));

  const embeddedFacts = [];
  let m;
  while ((m = EG_RE.exec(ruleText)) !== null) {
    embeddedFacts.push(m[1].trim());
  }

  const resolutionSources = [];
  if (/official information from the governments of/i.test(ruleText)) {
    resolutionSources.push('official government information');
  }
  if (/consensus of credible reporting/i.test(ruleText)) {
    resolutionSources.push('consensus of credible reporting');
  }

  const dates = ruleText.match(DATE_RE) || [];
  const times = ruleText.match(TIME_RE) || [];
  const merged = [...dates, ...times];
  const timeWindow = merged.length ? merged.join(' / ') : null;

  return { yesConditions, disqualifiers, embeddedFacts, resolutionSources, timeWindow };
}

/** Extract latest date from embedded facts — used for info-gap calc. */
export function latestEmbeddedDate(parsed) {
  if (!parsed?.embeddedFacts?.length) return null;
  const dates = parsed.embeddedFacts
    .map(f => {
      const m = f.match(DATE_RE);
      return m ? new Date(m[m.length - 1]) : null;
    })
    .filter(d => d && !Number.isNaN(d.getTime()));
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map(d => d.getTime())));
}
