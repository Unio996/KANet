// D-L1 judgeLine 确定性单元测试 (J1, 2026-06-19). 跑: node kasia-console/src/lib/judgeline.test.mjs
// 守: 纯函数同输入→同输出(byte-equal 复算)/abstain 分支/整数定点边界/op 全覆盖/各 metric case。
import { judgeLine, validateResolutionPredicate, buildResolutionPredicate, __JUDGELINE_INPUT_FIELDS__ } from './judgeline.mjs';

let pass = 0, fail = 0;
function eq(got, want, name) {
  if (got === want) { pass++; }
  else { fail++; console.error(`✘ ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}

// 标准 fields: WAS @ DAL, WAS 24 - DAL 17 (WAS 胜, 净胜7, 总分41)
const F = { winner_side: 'WAS', home_team: 'DAL', away_team: 'WAS', home_score: 17, away_score: 24 };

// ── winner ──
eq(judgeLine({ metric: 'winner', op: '==', operand: 'WAS' }, F), 'YES', 'winner WAS=YES');
eq(judgeLine({ metric: 'winner', op: '==', operand: 'DAL' }, F), 'NO', 'winner DAL=NO');
eq(judgeLine({ metric: 'winner', op: '>=', operand: 'WAS' }, F), 'ABSTAIN', 'winner 非==op→ABSTAIN');
eq(judgeLine({ metric: 'winner', op: '==', operand: 'WAS' }, { ...F, winner_side: undefined }), 'ABSTAIN', 'winner 缺胜方→ABSTAIN');

// ── margin (subject 净胜分, 可负) ──
eq(judgeLine({ metric: 'margin', op: '>=', operand: 7, subject: 'WAS' }, F), 'YES', 'WAS margin7>=7=YES');
eq(judgeLine({ metric: 'margin', op: '>=', operand: 10, subject: 'WAS' }, F), 'NO', 'WAS margin7>=10=NO');
eq(judgeLine({ metric: 'margin', op: '<', operand: 0, subject: 'DAL' }, F), 'YES', 'DAL margin-7<0=YES(负)');
eq(judgeLine({ metric: 'margin', op: '>=', operand: 7, subject: 'XXX' }, F), 'ABSTAIN', 'margin subject不匹配→ABSTAIN');
eq(judgeLine({ metric: 'margin', op: '>=', operand: 7 }, F), 'ABSTAIN', 'margin 缺subject→ABSTAIN');

// ── total (整数定点: 总分41, line 40.5/41.5 用 scale=1) ──
eq(judgeLine({ metric: 'total', op: '>', operand: 405, scale: 1 }, F), 'YES', 'total41>40.5=YES(定点410>405)');
eq(judgeLine({ metric: 'total', op: '>', operand: 415, scale: 1 }, F), 'NO', 'total41>41.5=NO(定点410<415)');
eq(judgeLine({ metric: 'total', op: '==', operand: 41 }, F), 'YES', 'total41==41=YES(scale0)');
eq(judgeLine({ metric: 'total', op: '>', operand: 40, scale: 0 }, F), 'YES', 'total41>40=YES');

// ── score (subject 队得分) ──
eq(judgeLine({ metric: 'score', op: '>=', operand: 24, subject: 'WAS' }, F), 'YES', 'WAS score24>=24=YES');
eq(judgeLine({ metric: 'score', op: '>', operand: 20, subject: 'DAL' }, F), 'NO', 'DAL score17>20=NO');

// ── ABSTAIN 分支 ──
eq(judgeLine(null, F), 'ABSTAIN', 'predicate null→ABSTAIN');
eq(judgeLine({ metric: 'foo', op: '==', operand: 1 }, F), 'ABSTAIN', '未知metric→ABSTAIN');
eq(judgeLine({ metric: 'total', op: '~', operand: 41 }, F), 'ABSTAIN', '非法op→ABSTAIN');
eq(judgeLine({ metric: 'total', op: '>', operand: 41.5, scale: 1 }, F), 'ABSTAIN', 'operand非整数→ABSTAIN');
eq(judgeLine({ metric: 'total', op: '>', operand: 40 }, { ...F, home_score: undefined }), 'ABSTAIN', '缺score→ABSTAIN');
eq(judgeLine({ metric: 'total', op: '>', operand: 40, scale: 9 }, F), 'ABSTAIN', '非法scale→ABSTAIN');
eq(judgeLine({ metric: 'total', op: '>', operand: 40 }, { ...F, home_score: 17.5 }), 'ABSTAIN', 'score非整数→ABSTAIN');

// ── 平局 tie (Bettor 裁①: winner 'X赢?'平局=NO; margin/total/score 平局=正常数值防回归) ──
// 平局 fields: WAS 21 - DAL 21 (winner_side=TIE token, 净胜0, 总分42)
const T = { winner_side: 'TIE', home_team: 'DAL', away_team: 'WAS', home_score: 21, away_score: 21 };
eq(judgeLine({ metric: 'winner', op: '==', operand: 'WAS' }, T), 'NO', '平局 winner WAS=NO(显式, X没赢)');
eq(judgeLine({ metric: 'winner', op: '==', operand: 'DAL' }, T), 'NO', '平局 winner DAL=NO(显式)');
eq(judgeLine({ metric: 'margin', op: '>=', operand: 3, subject: 'WAS' }, T), 'NO', '平局 margin0>=3=NO(正常整数无特判)');
eq(judgeLine({ metric: 'margin', op: '==', operand: 0, subject: 'WAS' }, T), 'YES', '平局 margin0==0=YES(正常)');
eq(judgeLine({ metric: 'total', op: '==', operand: 42 }, T), 'YES', '平局 total42==42=YES(照算)');
eq(judgeLine({ metric: 'score', op: '==', operand: 21, subject: 'WAS' }, T), 'YES', '平局 score21==21=YES(照算)');

// ── #3 test gap 补 (NWT finding3): score 缺 subject / 数值 == / 负 operand 定点 ──
eq(judgeLine({ metric: 'score', op: '>=', operand: 20 }, F), 'ABSTAIN', 'score 缺 subject→ABSTAIN');
eq(judgeLine({ metric: 'score', op: '>=', operand: 20, subject: 'XXX' }, F), 'ABSTAIN', 'score subject不匹配→ABSTAIN');
eq(judgeLine({ metric: 'margin', op: '==', operand: 7, subject: 'WAS' }, F), 'YES', 'margin 数值==7=YES');
eq(judgeLine({ metric: 'margin', op: '==', operand: 8, subject: 'WAS' }, F), 'NO', 'margin 数值==8=NO');
eq(judgeLine({ metric: 'score', op: '==', operand: 24, subject: 'WAS' }, F), 'YES', 'score 数值==24=YES');
// 负 operand 定点: DAL 净胜 -7, 定点 scale=1(operand -65 = -6.5), -7×10=-70 < -65 → YES("DAL 净胜 < -6.5")
eq(judgeLine({ metric: 'margin', op: '<', operand: -65, scale: 1, subject: 'DAL' }, F), 'YES', '负operand定点 -70<-65=YES');
eq(judgeLine({ metric: 'margin', op: '>=', operand: -65, scale: 1, subject: 'DAL' }, F), 'NO', '负operand定点 -70>=-65=NO');

// ── 确定性: 同输入复算 1000 次 byte-identical(无随机/无时钟/无 IO 旁路) ──
{
  const p = { metric: 'margin', op: '>=', operand: 3, subject: 'WAS' };
  const first = judgeLine(p, F);
  let stable = true;
  for (let i = 0; i < 1000; i++) if (judgeLine(p, F) !== first) stable = false;
  eq(stable, true, '确定性: 1000次复算同verdict');
  eq(first, 'YES', '确定性 case verdict=YES');
}

// ── validateResolutionPredicate 半线铁律 (护栏6 · NWT FINDING-1 SEAM 单源折入 validate, 2026-06-27) ──
// 整数线 (operand 为 10^scale 整数倍) 的 margin/total/score → 净胜/总分/得分可恰好==线 = push → 二元 YES/NO 池
// 无 void/refund verdict = stranded → 建市 prevet 必拒。半线 (x.5) 必过 (不误杀)。winner 无线 → 不受约束。
// 单源点: create-v07 (建市 chokepoint) + buildResolutionPredicate (emit) 全经此 → 任何路径整数线必拒。
const vv = (p) => validateResolutionPredicate(p).valid;
eq(vv({ metric: 'margin', op: '>', operand: 5, scale: 1, subject: 'BRA' }), true, 'margin 半线 -0.5(op5 sc1) valid');
eq(vv({ metric: 'margin', op: '>', operand: 15, scale: 1, subject: 'BRA' }), true, 'margin 半线 -1.5(op15 sc1) valid');
eq(vv({ metric: 'total', op: '>', operand: 25, scale: 1 }), true, 'total 半线 2.5(op25 sc1) valid');
eq(vv({ metric: 'total', op: '>', operand: 405, scale: 1 }), true, 'total 半线 40.5(op405 sc1) valid (回归: 不误杀)');
eq(vv({ metric: 'margin', op: '>', operand: 20, scale: 1, subject: 'BRA' }), false, 'margin 整数线 2.0(op20 sc1) REJECT (push)');
eq(vv({ metric: 'margin', op: '>', operand: 3, scale: 0, subject: 'BRA' }), false, 'margin 整数线 3(op3 sc0) REJECT');
eq(vv({ metric: 'total', op: '>', operand: 200, scale: 2 }), false, 'total 整数线 2.00(op200 sc2) REJECT');
eq(vv({ metric: 'score', op: '>', operand: 10, scale: 1, subject: 'WAS' }), false, 'score 整数线 1.0(op10 sc1) REJECT');
eq(vv({ metric: 'winner', op: '==', operand: 'WAS' }), true, 'winner 无线 valid (不受半线约束)');
// buildResolutionPredicate 经 validate 自动受保护 (单源点) — 整数线在 emit 侧也拒
eq(buildResolutionPredicate({ kind: 'spread', line: '-0.5', subject: 'BRA' }).valid, true, 'build spread -0.5 valid (半线)');
eq(buildResolutionPredicate({ kind: 'spread', line: '-3', subject: 'BRA' }).valid, false, 'build spread -3 INVALID (整数线经 validate 拒)');
eq(buildResolutionPredicate({ kind: 'total', line: '2' }).valid, false, 'build total 2 INVALID (整数线)');

// ── 输入集 invariant 导出(供 NWT field_hash 集对齐) ──
eq(JSON.stringify(__JUDGELINE_INPUT_FIELDS__),
   JSON.stringify(['winner_side', 'home_team', 'away_team', 'home_score', 'away_score']),
   'judgeLine 输入集=5字段(==field_hash集)');

console.log(`\njudgeLine test: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
