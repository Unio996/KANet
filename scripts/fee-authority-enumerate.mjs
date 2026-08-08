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
// 🔴 A reference is not a constraint, and a constraint is not an equality:
//     referenced          -> the value survives into the compiled redeem (affects P2SH)
//     require(range)      -> only sanity-checks the BAKED value against constants
//     require(equality)   -> actually binds what this transaction may spend
//   v0.7 is the cautionary case: minerFee IS referenced (so it is in the redeem) but only
//   range-checked, and only in ONE of three money-moving entrypoints. "It is in the redeem"
//   reads a lot like "every spending path is bound by it", and they are different facts.
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.FEE_ENUM_DIR || 'D:/kanet/kanet/kasia-console/src/lib';
const FILE_RE = /^PoolSpine.*\.sil$/;

// Fee-ish ctor params are DISCOVERED from each contract's own signature, never hardcoded --
// v0.8 introduced maxChunkFee and v0.7.1 dropped minerFee entirely; a fixed list would have
// missed both.
const FEEISH = /fee/i;

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

function classify(line) {
  if (!/\brequire\s*\(/.test(line)) return 'referenced';
  // equality against a computed spend is the only form that binds the transaction
  if (/==/.test(line)) return 'require-EQ';
  if (/[<>]=?/.test(line)) return 'require-RANGE';
  return 'require-other';
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
    if (/tx\.outputs?\[[^\]]*\]\.value/.test(code) && /[-+]\s*\d{4,}/.test(code)) {
      hits.push({ line: i + 1, text: code.trim().slice(0, 90) });
    }
  }
  return hits;
}

const files = fs.readdirSync(DIR).filter((f) => FILE_RE.test(f)).sort();
const report = [];

for (const f of files) {
  const src = fs.readFileSync(path.join(DIR, f), 'utf8');
  const { lines, ctorParams, eps } = parseContract(src);
  const feeParams = ctorParams.filter((p) => FEEISH.test(p));
  const entry = { contract: f, feeCtorParams: feeParams, entrypoints: [] };

  for (const ep of eps) {
    const found = [];
    for (const p of feeParams) {
      const re = new RegExp(`\\b${p}\\b`);
      for (let i = ep.start; i < ep.end; i++) {
        const raw = lines[i];
        if (!raw) continue;
        const code = raw.replace(/\/\/.*$/, '');       // comments are not constraints
        if (re.test(code)) found.push({ param: p, line: i + 1, kind: classify(code), text: code.trim().slice(0, 90) });
      }
    }
    const bound = found.filter((x) => x.kind === 'require-EQ');
    const ranged = found.filter((x) => x.kind === 'require-RANGE');
    const literal = detectLiteralFeeBound(lines, ep.start, ep.end);
    // Verdicts are ordered by how much authority the MARKET actually has over its own fee.
    const verdict = bound.length ? 'PER-MARKET(eq)'          // this market's committed rate binds the spend
      : ranged.length ? 'PER-MARKET(range)'                  // committed rate only sanity-checked
      : literal.length ? 'GLOBAL-LITERAL'                    // bounded, but by a constant, not by this market
      : found.length ? 'referenced-only'
      : 'NO-FEE-CONSTRAINT';
    entry.entrypoints.push({
      name: ep.name,
      lines: `${ep.start}-${ep.end}`,
      verdict,
      hits: found,
      literalBounds: literal,
    });
  }
  report.push(entry);
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const c of report) {
    console.log(`\n=== ${c.contract}   fee ctor params: ${c.feeCtorParams.join(', ') || '(none)'}`);
    for (const ep of c.entrypoints) {
      console.log(`  [${ep.verdict.padEnd(17)}] ${ep.name}  (lines ${ep.lines})`);
      for (const h of ep.hits) console.log(`        ${h.kind.padEnd(14)} :${h.line}  ${h.param}   ${h.text}`);
    }
  }
  // The DoD question is not "is there any check" but "does THIS market's committed rate bind
  // this spend". Only PER-MARKET(eq) answers yes; everything else is a different kind of gap:
  //   PER-MARKET(range) : the committed value is only sanity-checked, never tied to the spend
  //   GLOBAL-LITERAL    : the spend is bounded, but by a constant shared by every market
  //   NO-FEE-CONSTRAINT : nothing at all
  const holes = report.flatMap((c) =>
    c.entrypoints.filter((e) => e.verdict !== 'PER-MARKET(eq)')
      .map((e) => `${c.contract}::${e.name} -> ${e.verdict}`));
  console.log(`\n🔴 money-moving entrypoints where THIS MARKET's committed fee does not bind the spend: ${holes.length}`);
  for (const h of holes) console.log(`   ${h}`);
}
