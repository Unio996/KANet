# D-032 §2.6-1 参赛方已定判别 —— ESPN fixture 采集与谓词推导(J2, 2026-09-22)

按设计 v0.2.4(Codex ab99d91e MUST):落码前先抓真实 ESPN 未定席位与已定对阵两份响应进 provenance,记录 competitor/team 字段,再从真能区分具体球队与席位占位的字段推导正向的"已定"谓词。

## 1. 已定对阵(真实,活取)

- 源:`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401872932`(2026-09-22 实取,614770 字节,原样存 `espn-fixture-determined-raw.json`)。
- 赛事:Detroit Lions at Buffalo Bills,2026-09-18,`state=post`(已完)。
- 关键字段:`header.id = "401872932"`,`header.competitions[0].id = "401872932"`(两处相等,且与 URL `event` 参数逐字相等)。
- 两侧 competitor:`home.team.id="2" abbr="BUF"`、`away.team.id="8" abbr="DET"`——非空、互异。

## 2. 球队注册表(真实,活取,用作已定判据的对照物)

- 源:`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams`(2026-09-22 实取,148848 字节,原样存 `espn-fixture-teams-registry-raw.json`)。
- 32 支 NFL 球队,每支 `{id, abbreviation, displayName}`。交叉核对:上面已定对阵两侧的 `team.id`(`"2"`/`"8"`)**均能在此注册表精确解析到**(`id="2"→BUF`,`id="8"→DET`,与 summary 返回一致)。

## 3. 未定席位 —— 诚实记录:活取失败,synthetic 补位

**本次(2026-09-22)未能取到真实的未定席位 payload**。已检查的真实数据源与结果:
- NFL `scoreboard`(常规赛,当前第 3 周):全部比赛双方均已确定,无 TBD。
- NFL `scoreboard?seasontype=3&year=2026`(尝试取季后赛):API 忽略该参数、原样返回常规赛数据——说明**季后赛对阵表此时尚未在这个端点发布**(常规赛才踢 3 周,联盟通常在赛季过半后才发布季后赛种子占位)。
- MLB `scoreboard` / `scoreboard?seasontype=3`:同样只返回当前常规赛赛程(联盟赛季要到 2026-11-12 才结束,季后赛括号尚未发布)。
- `espn.com/nfl/playoffs` 页面(WebFetch 渲染):页面本身没有渲染出括号内容(该页多半靠前端 JS 拉取,静态抓取拿不到)。

**结论**:在 2026-09-22 这个时间点,主流联盟(NFL/MLB)都处在常规赛阶段,ESPN 的结构化 API 尚未发布任何带"未定席位"占位符的括号/对阵表——**不是找不到端点,是这个赛历时刻真实世界里确实没有这类数据在线**。这与设计文档 v0.2.4 预留的"若 ESPN 没有可信判别字段,设计须明说"条款情形一致(这里是"此刻没有可核验的活数据",不是"永远没有判别字段"——判别字段本身(球队注册表解析)是真实、可核验、随时可查的)。

**处置**:`espn-fixture-undetermined-synthetic.json` 是一份**明确标注为 synthetic**、但**结构与真实 payload 完全一致**(同一套 `header.competitions[0].competitors[].team.{id,abbreviation,displayName}` 嵌套,字段名不臆造)的负测 fixture——一侧用真实已定球队(`BUF id=2`,与上面注册表一致),另一侧放一个**非空、且与另一侧互异**的占位 id/abbr(`id="-1" abbr="TBD"`),模拟"老校验(非空+互异)会误判为已定,但真实注册表查无此队"的场景。这正是 §7 要求的"席位字段非空、id 互异、但载荷标明未定"负测的原始素材。

## 4. 推导出的正向"已定"谓词

**不采用**"非空 team.id + abbreviation"(v0.2.3 旧谓词,已被 Codex ab99d91e 否决——占位符也可能有稳定的合成 id)。

**采用**:两侧 `team.id` 都必须能在**该联赛的 ESPN 球队注册表**(`site.api.espn.com/apis/site/v2/sports/<sport>/<league>/teams`,与 summary 同域、同白名单、结构化、可独立核验)里精确解析到**同一个** `id`。理由:
- 真实球队的 `id` 是 ESPN 内部稳定标识符,注册表是这些 id 的权威真值来源(既有结构化源,不新引入第三方)。
- 占位符/TBD 席位即使被塞进一个"看起来正常"的 id(如本 fixture 的 `-1`,或任何未来可能出现的合成值),只要它不是该联赛 32(或对应数量)支真实球队之一,注册表解析必然失败——**不依赖猜测 ESPN 用什么字符串表示"未定"**,天然覆盖了 v0.2.3 谓词的漏洞类。
- 注册表本身按联赛缓存(TTL 待实现时定,球队名单变化频率是赛季级,不是逐请求级),不会让每次建题都多打一次 ESPN——具体缓存策略留给实现阶段(不在本 fixture 文档范围)。

**判别函数骨架**(实现阶段落码,此处只记规格): `isParticipantDetermined(team, registryTeamIds) = registryTeamIds.has(team.id)`;两侧都需为真,否则 409 `event_participants_not_determined`。

## 5. 复现

```
node scratch_fetch scripts (临时, 未入库, 过程见上): fetch site.api.espn.com/.../summary?event=401872932 与 .../teams
```
原始响应文件同目录:`espn-fixture-determined-raw.json`、`espn-fixture-teams-registry-raw.json`、`espn-fixture-undetermined-synthetic.json`。
