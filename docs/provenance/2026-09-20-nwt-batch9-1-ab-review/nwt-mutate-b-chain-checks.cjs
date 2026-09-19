const fs=require('fs'),cp=require('child_process');const F='src/lib/proto-settlement-chain-checks.mjs';const orig=fs.readFileSync(F,'utf8');
const rep=(a,b)=>s=>{if(!s.includes(a))throw new Error('pattern not found: '+a.slice(0,50));return s.replace(a,b);};
const M=[
 ['NWT-b1 outpoint: compare txid only (index ignored)', rep("|| Number(gotOp.index) !== wantOp.index) {","|| false) {")],
 ['NWT-b2 outpoint: compare index only (txid ignored)', rep("if (String(gotOp.transactionId).toLowerCase() !== String(wantOp.transactionId).toLowerCase() ||","if (false ||")],
 ['NWT-b3 outpoint check removed', rep("if (String(gotOp.transactionId).toLowerCase() !== String(wantOp.transactionId).toLowerCase() || Number(gotOp.index) !== wantOp.index) {","if (false) {")],
 ['NWT-b4 covenant: null expected accepts any', rep("const covOk = wantCov === null ? gotCov === null :","const covOk = wantCov === null ? true :")],
 ['NWT-b5 covenant: only has/none, not equality', rep("(gotCov !== null && gotCov.toLowerCase() === wantCov.toLowerCase())","(gotCov !== null)")],
 ['NWT-b6 covenant compare case-sensitive', rep("gotCov.toLowerCase() === wantCov.toLowerCase()","gotCov === wantCov")],
 ['NWT-b7 expectedCovenantIds: missing role treated as null (default)', rep("if (!Object.prototype.hasOwnProperty.call(expectedCovenantIds, role)) {","if (false) {")],
 ['NWT-b8 chain covenantId key missing tolerated', rep("if (!Object.prototype.hasOwnProperty.call(u, 'covenantId')) {","if (false) {")],
 ['NWT-b9 expectedOutpoints param made optional (default {})', rep("expectedOutpoints, expectedCovenantIds }) {\n  const roles","expectedOutpoints = {}, expectedCovenantIds }) {\n  const roles")],
 ['NWT-b10 expectedCovenantIds param made optional (default {})', rep("expectedOutpoints, expectedCovenantIds }) {\n  const roles","expectedOutpoints, expectedCovenantIds = {} }) {\n  const roles")],
 ['NWT-b11 spent flag ignored', rep("if (u.spent) throw","if (false) throw")],
 ['NWT-b12 value: accept >= want', rep("if (got !== want) {","if (got < want) {")],
 ['NWT-b13 spk compare skipped', rep("if (gotSpk !== wantSpk) {","if (false) {")],
 ['NWT-b14 code closed-set: outpoint code renamed', rep("throw E(`${role}_outpoint_drift`, `${role}_outpoint_drift — fail-closed: assertSettlementInputValuesOnChain(${step}): ${role} 的链上 outpoint(","throw E(`${role}_outpoint_moved`, `${role}_outpoint_drift — fail-closed: assertSettlementInputValuesOnChain(${step}): ${role} 的链上 outpoint(")],
 ['NWT-b15 message label dropped for value_drift (legacy regex contract)', rep("const tag = `assertSettlementInputValuesOnChain(${step}): ${role}_value_drift — fail-closed`;","const tag = `assertSettlementInputValuesOnChain(${step}): ${role} drift — fail-closed`;")],
 ['NWT-b16 wantOp format check removed (accept junk expected outpoint)', rep("if (!wantOp || typeof wantOp !== 'object' || !HEX64.test(String(wantOp.transactionId ?? '').toLowerCase()) || !Number.isInteger(wantOp.index) || wantOp.index < 0) {","if (!wantOp) {")],
 ['NWT-b17 chainCheckCodes missing a kind', rep("const kinds = ['value_drift', 'spk_drift', 'outpoint_drift', 'covenant_class_mismatch'];","const kinds = ['value_drift', 'spk_drift', 'outpoint_drift'];")],
];
const out=[];for(const [n,fn] of M){let m;try{m=fn(orig);}catch(e){out.push('?? '+n+' '+e.message);continue;}fs.writeFileSync(F,m);const r=cp.spawnSync('node',['src/lib/proto-settlement-chain-checks.test.mjs'],{encoding:'utf8'});const fails=(r.stdout.match(/\[FAIL\]/g)||[]).length;out.push((r.status===0?'SURVIVED ':'killed   ')+n+'  [FAIL lines='+fails+', exit='+r.status+']');}
fs.writeFileSync(F,orig);console.log(out.join('\n'));
