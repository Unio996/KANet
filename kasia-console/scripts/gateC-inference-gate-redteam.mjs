// 门C 题型 gate (INFERENCE_RE 3151fcd9) 红队 fixture (NWT-tn r37)
// happy: 推理题必检 / 直接字段必不误杀 ; evasion: 换措辞推理题能否绕过(blacklist 洞)
const INFERENCE_RE = /(win|won|beat|lead|cover|lose|trail)\w*\s+by\s+(more than\s+|at least\s+|over\s+|under\s+)?\d|by (more than|at least|over|under)\s+\d+\s*(point|run|goal|score|basket|yard)|\bmargin\b|point[\s-]*spread|\bspread\b|difference between|combined\s+(score|total|points).{0,30}(over|under|>|<|above|below)|how many .*\b(more|fewer|less)\b/i;
const test = q => INFERENCE_RE.test(q.toLowerCase());

const REASONING = ['Yankees win by more than 3 runs?', 'Will Lakers cover the spread?', 'margin of victory over 10?', 'combined total points over 8.5?', 'how many more runs did NYY score?', 'Braves win by at least 5', 'point spread > 7', 'difference between scores?'];
const DIRECT = ['Will the Yankees win?', 'Braves win game 401815659?', 'Will BTC price be > 50000 USD?', 'Did Lakers win?', 'Yankees beat Red Sox?', 'price >= target?'];
// EVASION: 仍是推理题(需算 margin/差值)但换措辞避开正则 — 期望 caught, 实测 EVADED = blacklist 洞
const EVASION = ['Yankees ahead by 4 or more runs?', 'Score gap above 5?', 'Will total runs exceed 9?', 'NYY outscore BOS by 3+?', 'victory differential over 5?', 'Did NYY score at least 4 more than BOS?', 'Final score difference greater than 6?', 'Yankees up by 3 at the end?'];

let miss = 0, overkill = 0, evaded = 0;
console.log('=== happy: 推理题(应 caught) ===');
for (const q of REASONING) { const c = test(q); console.log((c ? 'caught' : 'MISS') + ' | ' + q); if (!c) miss++; }
console.log('=== happy: 直接字段题(应不误杀) ===');
for (const q of DIRECT) { const c = test(q); console.log((c ? '误杀' : 'ok') + ' | ' + q); if (c) overkill++; }
console.log('=== EVASION: 换措辞推理题(blacklist 洞) ===');
for (const q of EVASION) { const c = test(q); console.log((c ? 'caught' : 'EVADED') + ' | ' + q); if (!c) evaded++; }
console.log(`\nSUMMARY: 推理漏检=${miss}/${REASONING.length} 直接误杀=${overkill}/${DIRECT.length} 规避=${evaded}/${EVASION.length}`);
console.log(`verdict: baseline ${miss === 0 && overkill === 0 ? 'PASS' : 'FAIL'} | blacklist ${evaded === 0 ? '无规避洞' : `🟠 ${evaded} 规避洞 → 需结构化断言白名单兜底(resolution spec 预声明字段+算子)`}`);
