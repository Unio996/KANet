# 巴西日本 canary 盘组 draft — J2 → J1 settle-verify 交接

> Owner 热需求 (热门赛连让球/大小球上首页) 的第 1 场端到端 canary。**draft 态, 零碰链零入库** (护栏1)。
> J1 settle-verify 三关过 → J2 才 create-v07 实例化 + 翻 open → KANet-UI 显示。
> 序列: **J2 建 draft (本文档) → J1 验 → 翻 open → KANet-UI 显**。1 场过 J1 关再放量。

## 产物
- **构建器 (新, 可复用)**: `kasia-console/src/lib/sports-card-builder.mjs` — 纯函数 `buildSportsCard(descriptor)` + I/O 层 `fetchEspnMatchDescriptor(summaryUrl)`。lint clean。
- **draft 盘组 JSON**: `scratch/_j2_brajpn_draft.json` (5 盘全 predicate + spec)。
- **生成+自验脚本**: `scratch/_j2_brajpn_draft.mjs`。

## 赛事 (真 ESPN event, abbr 从链上 event 取非硬编码)
- ESPN event **760487** · `FIFA World Cup` · kickoff **2026-06-29T17:00Z** · 现 state=`pre` (settle 在 final 后)。
- data_source_canonical: `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=760487`
- home=**BRA** (Brazil) / away=**JPN** (Japan) — `normalizeAbbr` 单源, == ESPN extractor settle 时产的 abbr。
- outcome_end_date = kickoff + 3.5h。

## 盘组 (5 盘, card_group_id=`espn-FIFA_World_Cup-760487`)
| leg_key | kind | resolution_predicate |
|---|---|---|
| winner_BRA | winner | `{metric:winner, op:==, operand:BRA}` |
| winner_JPN | winner | `{metric:winner, op:==, operand:JPN}` |
| spread_BRA_-0.5 | spread | `{metric:margin, op:>, operand:5, scale:1, subject:BRA}` (BRA 净胜 > 0.5 = 赢) |
| spread_BRA_-1.5 | spread | `{metric:margin, op:>, operand:15, scale:1, subject:BRA}` (BRA 净胜 > 1.5 = 赢 2+) |
| total_o_2.5 | total | `{metric:total, op:>, operand:25, scale:1}` (两队总球 > 2.5 = 3+) |

## 护栏自检 (J2 侧已过, 供 J1 复核)
- **护栏2 score 源**: data_source = ESPN summary (findExtractor kind=espn → 产 home/away_score)。非 Polymarket 二元。✅
- **护栏3 sport-aware**: 足球 spread -0.5/-1.5, total 2.5 (非棒球 -3.5)。✅
- **护栏6 半线铁律**: 全半线; 构建器对整数线 (operand % 10^scale === 0) 直接拒建 (含 "x.0")。✅
- **J1 接口雷**: 让分线传 bare 负让分 (无 "+"), parseLineToFixedPoint 不被拒。✅
- **judgeLine 自验**: 5 盘 × 5 模拟终局 (BRA 2-0 / 1-0 / 1-1 draw / JPN 0-3 / BRA 3-1) = **25/25 PASS**。

## 请 J1 验 (settle-correctness 硬门)
1. **predicate shape**: 5 盘 `validateResolutionPredicate` 过 + margin 盘 subject==home/away abbr。
2. **score 源真产字段**: `fetchEspnMatchDescriptor` / extractEspnFields 能从该 URL 产 home_score/away_score/winner_side (赛后)。
3. **半线 no-push**: 整数线 operand 必拒 (我已硬卡, 请红队复核 bright-line)。
- 逐盘 PASS/FAIL 回频道, 不过的标因。过了我 create-v07 实例化 (实锁 maker stake) + 翻 open。
