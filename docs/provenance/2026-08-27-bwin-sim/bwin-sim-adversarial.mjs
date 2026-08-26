// NWT sim v0.2 addendum — ADVERSARIAL timestamps under the future cap.
// Q: can a mining first-mover hold difficulty low (pump DAA) UNBOUNDEDLY, or does the
//    +132s future-stamp cap (pre_ghostdag_validation.rs:40-42) bound the DAA excess?
// Mechanism: difficulty rises when measured_duration (window stamp span) < expected.
//   To KEEP measured large (difficulty low) while producing k× fast, stamps must ADVANCE
//   FASTER than real production => drift into the FUTURE => capped at real+TOL.
//   Past side (PMT) does NOT help: lagging stamps SHRINK measured => difficulty rises faster.
const TPB=100, SR=40, WIN=661, MIN=150, TOL_MS=132000, BASE=1/TPB;
function calcTargetRel(win){
  if(win.length<MIN) return win[win.length-1].tgt;
  let minI=0,maxI=0; for(let i=1;i<win.length;i++){if(win[i].ts<win[minI].ts)minI=i; if(win[i].ts>win[maxI].ts)maxI=i;}
  const minTs=win[minI].ts,maxTs=win[maxI].ts; let sum=0,n=0;
  for(let i=0;i<win.length;i++){if(i===minI)continue; sum+=win[i].tgt; n++;}
  return (sum/n)*Math.max(maxTs-minTs,1)/(TPB*SR*n);
}
// Attacker strategy: stamp at baseline cadence (100ms/block) to hold difficulty, but never
// exceed real_time+TOL (future cap). Once the cap binds, stamps pin at real+TOL.
function simAdversarial(k){
  const win=[]; const sp=SR*TPB;
  for(let i=0;i<WIN;i++) win.push({ts:-(WIN-1-i)*sp, tgt:1});
  let t=0, blocks=0, tgt=calcTargetRel(win); let maxExcess=0;
  const maxBlocks=WIN*SR*8;
  while(blocks<maxBlocks){
    const dt=TPB/(k*tgt); t+=dt; blocks++;                 // real production k× fast (dt shrinks as tgt held)
    if(blocks%SR===0){
      const desired = win[win.length-1].ts + sp;           // baseline-cadence stamp (hold difficulty)
      const cap = t + TOL_MS;                              // future cap: real+132s
      const stamp = Math.min(desired, cap);               // attacker stamps as high as allowed
      win.push({ts:stamp, tgt}); if(win.length>WIN) win.shift();
      tgt=calcTargetRel(win);
    }
    const ex=blocks - t*BASE; if(ex>maxExcess)maxExcess=ex;
  }
  const plateau=blocks - t*BASE;
  return {k, plateau, maxExcess, endT_s:t/1000};
}
console.log('=== ADVERSARIAL timestamps (max future-stamp under +132s cap) ===');
console.log('k\tB_win_adv(plateau)\tpeak\tsim_wall_s');
const rows=[];
for(const k of [1.5,2,3,5,10,50]){ const r=simAdversarial(k); rows.push(r);
  console.log(`${k}\t${r.plateau.toFixed(0)}\t\t${r.maxExcess.toFixed(0)}\t${r.endT_s.toFixed(0)}`);}
console.log('\nIf plateau stays bounded (not growing with sim length) => future cap BOUNDS the DAA-pump.');
console.log('Compare honest-model B_win(k=10)=23,959 and placeholder 55,200.');
// sanity: does the plateau grow if we 4x the sim length? (unbounded test)
console.log('\n=== unboundedness test: same k=10, longer sim ===');
for(const mult of [2,4,8]){
  const win=[]; const sp=SR*TPB; for(let i=0;i<WIN;i++) win.push({ts:-(WIN-1-i)*sp,tgt:1});
  let t=0,blocks=0,tgt=calcTargetRel(win); const mb=WIN*SR*mult;
  while(blocks<mb){const dt=TPB/(10*tgt);t+=dt;blocks++; if(blocks%SR===0){const stamp=Math.min(win[win.length-1].ts+sp,t+TOL_MS);win.push({ts:stamp,tgt});if(win.length>WIN)win.shift();tgt=calcTargetRel(win);}}
  console.log(`sim_len=${mult}× window, k=10: plateau_excess=${(blocks-t*BASE).toFixed(0)} DAA (wall ${(t/1000).toFixed(0)}s)`);
}

console.log('\n=== extreme-k ceiling (does adversarial B_win ever exceed 55,200 placeholder?) ===');
function advPlateau(k, mult){
  const win=[]; const sp=SR*TPB; for(let i=0;i<WIN;i++) win.push({ts:-(WIN-1-i)*sp,tgt:1});
  let t=0,blocks=0,tgt=calcTargetRel(win); const mb=WIN*SR*mult;
  while(blocks<mb){const dt=TPB/(k*tgt);t+=dt;blocks++; if(blocks%SR===0){const stamp=Math.min(win[win.length-1].ts+sp,t+TOL_MS);win.push({ts:stamp,tgt});if(win.length>WIN)win.shift();tgt=calcTargetRel(win);}}
  return blocks-t*BASE;
}
for(const k of [10,50,100,1000,1e6]){
  const p8=advPlateau(k,8), p16=advPlateau(k,16);
  console.log(`k=${k}: plateau@8win=${p8.toFixed(0)}  @16win=${p16.toFixed(0)}  converged=${Math.abs(p16-p8)<50}  under_55200=${p16<55200}`);
}
