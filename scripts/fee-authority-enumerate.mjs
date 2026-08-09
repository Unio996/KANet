// (i) per-market fee authority -- mechanical per-entrypoint enumeration.
//
// WHY THIS IS A SCRIPT AND NOT A TABLE IN A DOC:
// DoD ④ says the acceptance must be mechanical and not depend on anyone remembering. A hand
// written table is correct exactly once -- on the day it is written -- and then silently rots
// as contracts are added. This repo already has 7 spine contracts while the assignment said
// "three versions", which is the rot in action.
//
// WHAT IT ANSWERS (DoD ③, the clause J2 forced):
//   For every entrypoint that can move money, WHERE is the per-market fee constrained?
//   An entrypoint that cannot point at a line is an entrypoint where the fee is unauthorized.
//
// 🔴 TWO DIFFERENT QUANTITIES WEAR THE WORD "fee" (2026-08-09 red-team MUST-FIX, MF-1):
//     MARKET fee rate   -> maker/oracle policy rate: brokerFeePct / oracleFeePct (basis points).
//                          THIS is what R-3 / (i) is about: does the MARKET's committed rate
//                          bind what the transaction may spend?
//     NETWORK fee        -> minerFee / maxChunkFee: the chain transaction fee paid to miners,
//                          a constant baked into each covenant instance. It is a DIFFERENT
//                          quantity (see memory reference-one-name-several-different-things).
//   An earlier version matched fee-ish params with /fee/i and then counted any `==` require as
//   "the market's rate binds the spend". That reported `require(outputs.value == stake - minerFee)`
//   -- a NETWORK-fee binding -- as market-rate authority, inflating the headline to 3 (really 4)
//   PER-MARKET(eq) when the true count for the market rate is 0. We now:
//     (a) classify each fee-ish ctor param into a family (market / network / unknown), and
//     (b) require, for PER-MARKET(eq), that ONE `==` require mechanically ties a MARKET-family
//         param to a spend primitive (tx.outputs[..].value) -- both sides present, not just `==`.
//
// 🔴 A reference is not a constraint, and a constraint is not an equality:
//     referenced          -> the value survives into the compiled redeem (affects P2SH)
//     require(range)      -> only sanity-checks the value against constants
//     require(equality)   -> actually binds what this transaction may spend
//   ...but "binds the spend" only counts toward MARKET authority when the equality ties the
//   MARKET rate (not minerFee) to tx.outputs value. minerFee equalities are reported as
//   NETWORK-FEE(eq): true, and real, but a different fact from "the market's rate is authorized".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// DIR resolution (MF-2): the spine contracts live in the repo at kasia-console/src/lib. Resolve
// that relative to THIS script so `node scripts/fee-authority-enumerate.mjs` works from a fresh
// checkout without env vars. FEE_ENUM_DIR still overrides (e.g. to point at a worktree copy).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.resolve(__dirname, '..', 'kasia-console', 'src', 'lib');
const DIR = process.env.FEE_ENUM_DIR || DEFAULT_DIR;
const FILE_RE = /^PoolSpine.*\.sil$/;

// Fee-ish ctor params are DISCOVERED from each contract's own signature, never hardcoded --
// v0.8 introduced maxChunkFee and v0.7.1 dropped minerFee entirely; a fixed list would have
// missed both.
const FEEISH = /fee/i;

// Spend primitive: the money actually leaving in an output. This is the "flow" side that a real
// binding must reference. (tx.inputs[..].value is money coming IN, not a spend, so it is excluded
// on purpose -- a bound on an input is not a bound on what this tx may pay out.)
const SPEND_RE = /tx\.outputs?\[[^\]]*\]\.value/;

// Family of a fee-ish param name. market = the maker/oracle POLICY rate (what (i) is about);
// network = the miner/chain transaction fee (a different quantity that must NOT count as market
// authority). unknown params are surfaced separately rather than silently folded either way.
function feeFamily(name) {
  if (/miner|chunk/i.test(name)) return 'network';           // minerFee, maxChunkFee, chunkMinerFee
  if (/pct$|bps$/i.test(name) || /(broker|oracle|maker).*fee/i.test(name)) return 'market'; // brokerFeePct, oracleFeePct
  return 'unknown';
}

function parseContract(src) {
  const lines = src.split(/\r?\n/);

  // ctor: from `contract X(` to the matching `) {`
  let ctorStart = lines.findIndex((l) => /^\s*contract\s+\w+\s*\(/.test(l));
  const ctorParams = [];
  if (ctorStart >= 0) {
    for (let i = ctorStart; i < lines.length; i++) {
      if (/^\s*\)\s*\{/.test(lines[i])) break;
      const m = lines[i].match(/^\s*(?:int|byte\[\d*\]|sig)\s+(\w+)/);
      if (m) ctorParams.push(m[1]);
    }
  }

  // entrypoints and their line ranges
  const eps = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*entrypoint\s+function\s+(\w+)/);
    if (m) eps.push({ name: m[1], start: i + 1 });
  }
  for (let i = 0; i < eps.length; i++) {
    eps[i].end = i + 1 < eps.length ? eps[i + 1].start - 1 : lines.length;
  }
  return { lines, ctorParams, eps };
}

// Locate a binary comparison operator at bracket depth 0. Returns { op, lhs, rhs } or null.
// This is a small structured parse (not a bare line regex) so that "== binds the spend" can be
// proved by looking at the two SIDES of the equality, not merely by the presence of "==" anywhere
// on the line (the MF-1 defect: `require(minerFee == cap)` and `require(outputs.value == x)` were
// indistinguishable to the old classifier).
function splitTopLevelComparison(expr) {
  // Longest operators first so `>=`/`<=`/`==`/`!=` win over `>`/`<`.
  const ops = ['==', '!=', '>=', '<=', '>', '<'];
  let depth = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0) {
      for (const op of ops) {
        if (expr.startsWith(op, i)) {
          // avoid mis-reading the '=' of '>=','<=','==','!=' as a shorter op: ops-first order + a
          // guard that a bare '>'/'<' is not actually the head of '>='/'<='.
          if ((op === '>' || op === '<') && expr[i + 1] === '=') continue;
          return { op, lhs: expr.slice(0, i), rhs: expr.slice(i + op.length) };
        }
      }
    }
  }
  return null;
}

// Extract the argument expression of a single-line require(...). Returns null if the line is not
// a well-formed single-line require (multi-line requires are not used in these contracts).
function requireArg(code) {
  const m = code.match(/\brequire\s*\((.*)\)\s*;?\s*$/);
  return m ? m[1] : null;
}

// Analyze one code line for how it constrains `param`. Returns:
//   { kind: 'referenced' | 'require-EQ' | 'require-RANGE' | 'require-other',
//     bindsSpend: bool }   // bindsSpend == equality ties `param` to a spend primitive
// bindsSpend requires: op '==', a spend primitive on ONE side, and `param` on the OTHER side.
function analyzeLine(code, param) {
  const paramRe = new RegExp(`\\b${param}\\b`);
  if (!paramRe.test(code)) return null;
  if (!/\brequire\s*\(/.test(code)) return { kind: 'referenced', bindsSpend: false };
  const arg = requireArg(code);
  const cmp = arg ? splitTopLevelComparison(arg) : null;
  if (!cmp) {
    // a require we cannot parse into a comparison: fall back conservatively.
    if (/==/.test(code)) return { kind: 'require-EQ', bindsSpend: false };
    if (/[<>]=?/.test(code)) return { kind: 'require-RANGE', bindsSpend: false };
    return { kind: 'require-other', bindsSpend: false };
  }
  if (cmp.op === '==') {
    const spendL = SPEND_RE.test(cmp.lhs), spendR = SPEND_RE.test(cmp.rhs);
    const parL = paramRe.test(cmp.lhs), parR = paramRe.test(cmp.rhs);
    // both sides present, on OPPOSITE sides of the equality => the market/network value binds spend.
    const bindsSpend = (spendL && parR) || (spendR && parL);
    return { kind: 'require-EQ', bindsSpend };
  }
  if (cmp.op === '!=') return { kind: 'require-other', bindsSpend: false };
  return { kind: 'require-RANGE', bindsSpend: false };
}

// 🔴 An entrypoint with no ctor-fee reference is NOT necessarily unconstrained -- it may bound
// the fee against hardcoded GLOBAL literals instead. v0.7's refund does exactly that:
//     require(tx.outputs[0].value <= makerStakeAmount - 50000);
//     require(tx.outputs[0].value >= makerStakeAmount - 100000000);
// Reporting that as "NO-FEE-CONSTRAINT" would be false and would send a reader hunting for a
// missing check that is actually present. The real defect is subtler and is the whole point of
// (i): the fee IS bounded, but by a GLOBAL constant rather than by THIS market's committed
// rate. Distinguishing the two is the difference between "add a check" and "the authority
// model is wrong", which are very different pieces of work.
function detectLiteralFeeBound(lines, start, end) {
  const hits = [];
  for (let i = start; i < end; i++) {
    const code = (lines[i] || '').replace(/\/\/.*$/, '');
    if (!/\brequire\s*\(/.test(code)) continue;
    // a spend-shaped comparison against a bare numeric literal
    if (SPEND_RE.test(code) && /[-+]\s*\d{4,}/.test(code)) {
      hits.push({ line: i + 1, text: code.trim().slice(0, 90) });
    }
  }
  return hits;
}

const files = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => FILE_RE.test(f)).sort()
  : [];
if (!fs.existsSync(DIR)) {
  console.error(`FEE_ENUM_DIR / default dir does not exist: ${DIR}`);
  console.error(`Set FEE_ENUM_DIR to a directory containing PoolSpine*.sil (e.g. a worktree's kasia-console/src/lib).`);
  process.exit(2);
}
if (files.length === 0) {
  console.error(`No PoolSpine*.sil files under: ${DIR}`);
  process.exit(2);
}
const report = [];

for (const f of files) {
  const src = fs.readFileSync(path.join(DIR, f), 'utf8');
  const { lines, ctorParams, eps } = parseContract(src);
  const feeParams = ctorParams.filter((p) => FEEISH.test(p));
  const paramFamily = Object.fromEntries(feeParams.map((p) => [p, feeFamily(p)]));
  const entry = {
    contract: f,
    feeCtorParams: feeParams,
    marketRateParams: feeParams.filter((p) => paramFamily[p] === 'market'),
    networkFeeParams: feeParams.filter((p) => paramFamily[p] === 'network'),
    unknownFeeParams: feeParams.filter((p) => paramFamily[p] === 'unknown'),
    entrypoints: [],
  };

  for (const ep of eps) {
    const found = [];
    for (const p of feeParams) {
      for (let i = ep.start; i < ep.end; i++) {
        const raw = lines[i];
        if (!raw) continue;
        const code = raw.replace(/\/\/.*$/, '');       // comments are not constraints
        const a = analyzeLine(code, p);
        if (a) found.push({ param: p, family: paramFamily[p], line: i + 1, kind: a.kind, bindsSpend: a.bindsSpend, text: code.trim().slice(0, 90) });
      }
    }
    const market = found.filter((x) => x.family === 'market');
    const network = found.filter((x) => x.family === 'network');
    // MARKET-authority verdict: the DoD ③ question is specifically about the market's committed
    // rate, so ONLY market-family hits move the verdict. Network-fee bindings are reported
    // alongside (networkFee) but never counted as PER-MARKET.
    const marketBound = market.filter((x) => x.kind === 'require-EQ' && x.bindsSpend);
    const marketRanged = market.filter((x) => x.kind === 'require-RANGE');
    const literal = detectLiteralFeeBound(lines, ep.start, ep.end);
    // Verdicts are ordered by how much authority the MARKET actually has over its own fee.
    const verdict = marketBound.length ? 'PER-MARKET(eq)'      // this market's committed rate binds the spend
      : marketRanged.length ? 'PER-MARKET(range)'              // committed rate only sanity-checked
      : literal.length ? 'GLOBAL-LITERAL'                      // bounded, but by a constant, not by this market
      : market.length ? 'referenced-only'                      // market rate referenced but never required
      : 'NO-FEE-CONSTRAINT';                                   // no MARKET-rate handling at all
    entry.entrypoints.push({
      name: ep.name,
      lines: `${ep.start}-${ep.end}`,
      verdict,
      hits: found,
      // network-fee findings, reported but explicitly NOT counted toward market authority
      networkFee: network.map((x) => ({
        param: x.param, line: x.line,
        role: x.kind === 'require-EQ' && x.bindsSpend ? 'NETWORK-FEE(eq-binds-spend)'
          : x.kind === 'require-EQ' ? 'NETWORK-FEE(eq)'
          : x.kind === 'require-RANGE' ? 'NETWORK-FEE(range)'
          : x.kind === 'referenced' ? 'NETWORK-FEE(referenced)'
          : 'NETWORK-FEE(other)',
        text: x.text,
      })),
      literalBounds: literal,
    });
  }
  report.push(entry);
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const c of report) {
    console.log(`\n=== ${c.contract}`);
    console.log(`    market-rate params: ${c.marketRateParams.join(', ') || '(none)'}   network-fee params: ${c.networkFeeParams.join(', ') || '(none)'}${c.unknownFeeParams.length ? `   unknown: ${c.unknownFeeParams.join(', ')}` : ''}`);
    for (const ep of c.entrypoints) {
      console.log(`  [${ep.verdict.padEnd(17)}] ${ep.name}  (lines ${ep.lines})`);
      for (const h of ep.hits.filter((x) => x.family === 'market')) console.log(`        ${h.kind.padEnd(14)} :${h.line}  ${h.param}   ${h.text}`);
      for (const n of ep.networkFee) console.log(`        ${n.role.padEnd(30)} :${n.line}  ${n.param}   ${n.text}`);
    }
  }
  // The DoD question is not "is there any check" but "does THIS MARKET's committed rate bind
  // this spend". Only PER-MARKET(eq) answers yes; everything else is a different kind of gap:
  //   PER-MARKET(range) : the committed value is only sanity-checked, never tied to the spend
  //   GLOBAL-LITERAL    : the spend is bounded, but by a constant shared by every market
  //   NO-FEE-CONSTRAINT : nothing at all for the MARKET rate (a minerFee binding may still exist)
  const allEps = report.flatMap((c) => c.entrypoints.map((e) => ({ c: c.contract, e })));
  const perMarketEq = allEps.filter(({ e }) => e.verdict === 'PER-MARKET(eq)');
  const holes = allEps.filter(({ e }) => e.verdict !== 'PER-MARKET(eq)')
    .map(({ c, e }) => `${c}::${e.name} -> ${e.verdict}`);
  const networkEq = allEps.filter(({ e }) => e.networkFee.some((n) => n.role.startsWith('NETWORK-FEE(eq')));

  console.log(`\n================ SUMMARY (market fee rate = brokerFeePct / oracleFeePct) ================`);
  console.log(`total money-moving entrypoints: ${allEps.length}`);
  console.log(`PER-MARKET(eq) -- market's committed rate binds the spend: ${perMarketEq.length}`);
  for (const { c, e } of perMarketEq) console.log(`   ${c}::${e.name}`);
  console.log(`\n🔴 entrypoints where THIS MARKET's committed rate does NOT bind the spend: ${holes.length}/${allEps.length}`);
  for (const h of holes) console.log(`   ${h}`);
  console.log(`\nℹ NETWORK-FEE(eq) bindings (minerFee etc. tied to spend -- REAL, but NOT market-rate authority): ${networkEq.length}`);
  for (const { c, e } of networkEq) console.log(`   ${c}::${e.name}`);
}
