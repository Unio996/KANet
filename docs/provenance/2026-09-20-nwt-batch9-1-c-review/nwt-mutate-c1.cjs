const fs=require('fs'),cp=require('child_process');const F='src/lib/proto-settlement-c1.mjs';const orig=fs.readFileSync(F,'utf8');
const rep=(a,b)=>s=>{if(!s.includes(a))throw new Error('pattern not found: '+a.slice(0,60));return s.replace(a,b);};
const M=[
 ['NWT-c1 poison filter: drop spk!==relaySpk condition', rep("if (u.covenantId !== null || normHex(u.scriptPublicKey.scriptHex) !== relaySpk) { skippedPoisoned++; continue; }","if (u.covenantId !== null) { skippedPoisoned++; continue; }")],
 ['NWT-c2 poison filter: drop covenantId condition', rep("if (u.covenantId !== null || normHex(u.scriptPublicKey.scriptHex) !== relaySpk) { skippedPoisoned++; continue; }","if (normHex(u.scriptPublicKey.scriptHex) !== relaySpk) { skippedPoisoned++; continue; }")],
 ['NWT-c3 inflight key not lowercased', rep("opKey(String(o.transactionId).toLowerCase(), o.index)","opKey(String(o.transactionId), o.index)")],
 ['NWT-c4 saturated ignores truncated', rep("(skippedPoisoned > 0 || truncated ? 'saturated' : 'none')","(skippedPoisoned > 0 ? 'saturated' : 'none')")],
 ['NWT-c5 saturated ignores poisoned (truncated only)', rep("(skippedPoisoned > 0 || truncated ? 'saturated' : 'none')","(truncated ? 'saturated' : 'none')")],
 ['NWT-c6 grader counts same tick repeatedly', rep("if (tickId !== lastTick) { count += 1; lastTick = tickId; }","count += 1; lastTick = tickId;")],
 ['NWT-c7 grader onSuccess does not reset', rep("onSuccess() { count = 0; lastTick = undefined; },","onSuccess() { },")],
 ['NWT-c8 grader threshold off by one (>)', rep("count >= ticksToError ? 'error' : 'warn'","count > ticksToError ? 'error' : 'warn'")],
 ['NWT-c9 assertStepBudget: >= tick allowed at equality', rep("if (budgetMs >= tickIntervalMs) throw","if (budgetMs > tickIntervalMs) throw")],
 ['NWT-c10 assertStepBudget: lower bound 14999 ok', rep("if (budgetMs < MIN_STEP_BUDGET_MS) throw","if (budgetMs < MIN_STEP_BUDGET_MS - 1) throw")],
 ['NWT-c11 assertFactsIpcTimeout boundary 13000 allowed', rep("|| timeoutMs <= FACTS_RPC_WAIT_MS + FACTS_RPC_CALL_MS)","|| timeoutMs < FACTS_RPC_WAIT_MS + FACTS_RPC_CALL_MS)")],
 ['NWT-c12 duplicate expected outpoint across roles tolerated', rep("if (seenOutpoints.has(k)) throw F(","if (false) throw F(")],
 ['NWT-c13 classify: budget code treated non-transient', rep("const TRANSIENT_CODES = new Set(['facts_transport_error', 'facts_relay_error', 'facts_step_budget_exceeded']);","const TRANSIENT_CODES = new Set(['facts_transport_error', 'facts_relay_error']);")],
 ['NWT-c14 classify: echo_missing transient (should be immediate error)', rep("const TRANSIENT_CODES = new Set(['facts_transport_error', 'facts_relay_error', 'facts_step_budget_exceeded']);","const TRANSIENT_CODES = new Set(['facts_transport_error', 'facts_relay_error', 'facts_step_budget_exceeded', 'facts_echo_missing']);")],
 ['NWT-c15 fee chainParents hasCovenant hardcoded false', rep("hasCovenant: feeCandidate.covenantId !== null }","hasCovenant: false }")],
 ['NWT-c16 readItem: version range unchecked', rep("|| spk.version < 0 || spk.version > U16_MAX)","|| false)")],
 ['NWT-c17 readItem: amount > u64 allowed', rep("|| BigInt(it.amount) > U64_MAX) throw","|| false) throw")],
 ['NWT-c18 requested >8 allowed', rep("requested.length > FACTS_OUTPOINTS_MAX)","requested.length > 1000)")],
 ['NWT-c19 evidence: found count wrong (not a safety) -> skip', rep("found: results[i].found.length","found: 0")],
 ['NWT-c20 deadline timer ms halved (budget/2000 => fires early)', rep("}, budgetMs); });","}, 1); });")],
];
const out=[];for(const [n,fn] of M){let m;try{m=fn(orig);}catch(e){out.push('?? '+n+' :: '+e.message);continue;}fs.writeFileSync(F,m);const r=cp.spawnSync('node',['src/lib/proto-settlement-c1.test.mjs'],{encoding:'utf8',timeout:120000});const fails=(r.stdout.match(/\[FAIL\]/g)||[]).length;out.push((r.status===0?'SURVIVED ':'killed   ')+n+'  [FAIL lines='+fails+', exit='+r.status+']');}
fs.writeFileSync(F,orig);console.log(out.join('\n'));
