const fs=require('fs'),cp=require('child_process');const F='src/lib/proto-settlement-c1.mjs';const orig=fs.readFileSync(F,'utf8');
const rep=(a,b)=>s=>{if(!s.includes(a))throw new Error('pattern not found: '+a.slice(0,60));return s.replace(a,b);};
const M=[
 ['NWT-c20 deadline timer fires at 1ms', rep("`本步总预算 ${budgetMs}ms 用尽`)), budgetMs); });","`本步总预算 ${budgetMs}ms 用尽`)), 1); });")],
 ['NWT-c21 deadline never fires (budget not enforced)', rep("`本步总预算 ${budgetMs}ms 用尽`)), budgetMs); });","`本步总预算 ${budgetMs}ms 用尽`)), 3600000); });")],
 ['NWT-c22 timer not cleared in finally', rep("} finally { clearTimeout(timer); }","} finally { }")],
];
const out=[];for(const [n,fn] of M){let m;try{m=fn(orig);}catch(e){out.push('?? '+n+' :: '+e.message);continue;}fs.writeFileSync(F,m);const r=cp.spawnSync('node',['src/lib/proto-settlement-c1.test.mjs'],{encoding:'utf8',timeout:60000});const fails=(r.stdout.match(/\[FAIL\]/g)||[]).length;out.push((r.status===0?'SURVIVED ':'killed   ')+n+'  [FAIL lines='+fails+', exit='+r.status+(r.error?', err='+r.error.code:'')+']');}
fs.writeFileSync(F,orig);console.log(out.join('\n'));
