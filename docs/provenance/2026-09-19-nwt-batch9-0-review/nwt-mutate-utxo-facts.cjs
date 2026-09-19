const fs = require('fs'), cp = require('child_process');
const F = 'src/lib/utxo-facts.mjs';
const orig = fs.readFileSync(F, 'utf8');
const muts = [
  ['NWT-a sort ascending (O1 direction)', s => s.replace("return a.amount > b.amount ? -1 : 1;", "return a.amount > b.amount ? 1 : -1;")],
  ['NWT-b drop covenantId sentinel', s => s.replace("if (!inner || typeof inner !== 'object' || !('covenantId' in inner)) {", "if (false) {")],
  ['NWT-c drop echo facts:true', s => s.replace("const base = { ok: true, facts: true, factsVersion: FACTS_VERSION, form: req.form };", "const base = { ok: true, factsVersion: FACTS_VERSION, form: req.form };")],
  ['NWT-d drop factsVersion echo', s => s.replace("const base = { ok: true, facts: true, factsVersion: FACTS_VERSION, form: req.form };", "const base = { ok: true, facts: true, form: req.form };")],
  ['NWT-e outpoints form ignores index (txid-only match)', s => s.replace("const wanted = new Map(req.outpoints.map((o) => [`${o.transactionId}:${o.index}`, o]));", "const wanted = new Map(req.outpoints.map((o) => [`${o.transactionId}:`, o]));").replace("const k = `${key.txid}:${key.index}`;\n      if (wanted.has(k) && !hit.has(k)) hit.set(k, { e, key });", "const k = `${key.txid}:`;\n      if (wanted.has(k) && !hit.has(k)) hit.set(k, { e, key });").replace("const h = hit.get(`${o.transactionId}:${o.index}`);", "const h = hit.get(`${o.transactionId}:`);")],
  ['NWT-f outpoints form: no filtering (return all entries as found)', s => s.replace("if (wanted.has(k) && !hit.has(k)) hit.set(k, { e, key });", "if (!hit.has(k)) hit.set(k, { e, key });")],
  ['NWT-g Number instead of BigInt for amount', s => s.replace("amount = BigInt(e.amount);", "amount = BigInt(Number(e.amount));")],
  ['NWT-h drop facts_params_without_facts', s => s.replace("throw new FactsError('facts_params_without_facts', 'outpoints/minAmount/maxAmount 只在 facts:true 时有意义');", "/* removed */")],
  ['NWT-i truncate BEFORE filter (list)', s => s.replace("const keyed = [];\n  for (const e of all) {", "const keyed = [];\n  for (const e of all.slice(0, FACTS_LIST_MAX)) {")],
  ['NWT-j C1-style: outpoints form silently falls to list when outpoints present', s => s.replace("if (req.form === 'outpoints') {", "if (false) {")],
  ['NWT-k facts !== true -> !cmd.facts (truthy)', s => s.replace("if (cmd.facts !== true) {", "if (!cmd.facts) {")],
  ['NWT-l pmt accept <=0', s => s.replace("if (!Number.isSafeInteger(pmt) || pmt <= 0) {", "if (!Number.isFinite(pmt)) {")],
  ['NWT-m observedAtMs before read', s => s.replace("const info = await rpc.getBlockDagInfo();\n  const observedAtMs = nowMs();", "const observedAtMs = nowMs();\n  const info = await rpc.getBlockDagInfo();")],
  ['NWT-n drop tiebreak index', s => s.replace("return a.index - b.index;", "return 0;")],
  ['NWT-o covenantId missing => null instead of error (M1 revert)', s => s.replace("if (!inner || typeof inner !== 'object' || !('covenantId' in inner)) {\n    throw new FactsError('covenant_id_field_missing', '条目 entry 上没有 covenantId 字段(该 kaspa-wasm 构建不暴露它, 拒绝把它当成\"无 covenant\")');\n  }", "")],
  ['NWT-p missing list omitted (drop `missing`)', s => s.replace("return { ...base, found, missing };", "return { ...base, found };")],
  ['NWT-q FACTS_RPC_WAIT_MS=20000', s => s.replace("export const FACTS_RPC_WAIT_MS = 8000;", "export const FACTS_RPC_WAIT_MS = 20000;")],
];
const out = [];
for (const [name, fn] of muts) {
  const m = fn(orig);
  if (m === orig) { out.push(`?? NOOP (pattern not found): ${name}`); continue; }
  fs.writeFileSync(F, m);
  const r = cp.spawnSync('node', ['src/lib/utxo-facts.test.mjs'], { encoding: 'utf8' });
  const fails = (r.stdout.match(/\[FAIL\] ([^ ]+)/g) || []).map(x => x.replace('[FAIL] ', ''));
  out.push(`${r.status === 0 ? 'SURVIVED' : 'killed  '} ${name}${fails.length ? '  -> ' + fails.join(',') : ''}`);
}
fs.writeFileSync(F, orig);
console.log(out.join('\n'));
