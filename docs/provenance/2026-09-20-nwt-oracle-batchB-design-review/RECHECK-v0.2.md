> **Status**: CURRENT（2026-09-20，NWT；对象 = 批 B 设计 v0.2 §10（origin `6ef2d25e`）；第 2 轮 MUST-only；D-021：类别级）

# 批 B 设计 v0.2 复核（第 2 轮，MUST-only）

## 结论：B1–B7 与 ①–⑥ 的并入都成立；只剩 **2 条小 MUST（都是设计文字，不需要第 3 轮设计审）**——并入 v0.3 一笔，并列入 J2 实现验收项，我在实现复核里逐条查。

## 我核过的支撑事实
- **B6(a) 的白名单原语可靠**：`findExtractor(url)` 是 host 锚定 + 仅 https + 拒私网/回环。我用 15 个恶意 URL 形态喂它（`espn.com.evil.example`、`evil.example/espn.com`、`espn.com@evil.example`、`#@espn.com`、带点主机、punycode、http、localhost、127.0.0.1、`[::1]`、十进制 IP、百分号编码点）——**全部不匹配**，仅真 ESPN/CoinGecko 主机匹配（`user@espn.com` 这种主机仍是 espn.com 的写法会匹配，无害）。创建入口与 adapter 复用它即可，别另写第二份。
- 公开读端点 `PUBLIC_MARKET_COLS` 是**显式白名单**，现在不含 `resolution_rule_spec` / `outcome_end_ms` / 任何 `outcome_*`（见下 C1）。
- 批 A 的 R4 锁列清单是**固定列表**（`question, outcome_oracle_relay_ids, resolution_rule_spec, outcome_market_source, outcome_condition_id, outcome_end_ms`），新加的列不会自动被锁（见下 C1）。

## 2 条 MUST
**C1 `side_map` 的存放与对下注者的可见性没落地（B3 的"存入不可改列"是空话，除非指明列）。** (a) R4 只锁上面那 6 列；若 `side_map` 是**新列**，它在 genesis 广播后仍可被 UPDATE，"不可改"不成立。要求：**`side_map` 放进 `resolution_rule_spec` JSON 内**（已被 R4 锁、也被 JUDGED 判据覆盖），或新加列的同一迁移里同时**扩展 R4 触发器列表**并补测试；两者选一，写死。(b) 下注者看不到它：公开市场读端点不含 spec / outcome_end / 数据源，而 `proto_bets.side` 是 0/1——**下注者选侧时根本不知道哪一侧是 YES**（B3 防的是判定方向反，这里是下注方向反，同一根因）。要求：判定题市场的公开读里带出 `side_map`、`outcome_end_ms`、`data_source_canonical`（`PUBLIC_MARKET_COLS` 加列 + 只对判定题非空），并让下注请求对判定题**必须**带一个与 `side_map` 一致的显式标签（例如 `side_label:'yes'|'no'`，与 `side` 不一致 ⇒ 400），把"点错侧"挡在受理点。

**C2 B6(b) 的"缺一 ⇒ 创建时拒**或标'仅人工/退款'**"里"仅人工"这个选项不存在。** 批 A 禁 `operator` 写判定题市场、批 D 令冻结市场的 `winning_side` 永不可写、`human` 只能冻不能批——**判定题市场没有任何人工 resolve 出口**，唯一出口是 refund，而 refund 执行仍未接线（N5b）。所以"缺确定性源或缺 UMA 条件"的判定题市场一旦建出来，就是"下注后只能等 cutoff 冻结→退款"的死胡同。要求：**只保留"创建时拒"**（simnet 端到端要造这类市场测退款终局时，用**非主网 + 显式测试开关**放行，且该开关不得在主网生效）。另外创建时对 `resolution_predicate` 做**语法/字段的干跑**（用合成字段喂 `judgeLine`，返回 ABSTAIN 即拒建）：非法 predicate 会在运行时变成"实质 ABSTAIN⇒写 NULL⇒冻结"，等于把必然退款的市场放了进来。

## SHOULD（记票，不阻塞）
1. `UMA_FINALIZATION_WINDOW_MS` 是 voter 模块**导入时**读的常量（未导出）：实现"proto 路径拒 <24h"时请导出生效值再断言，别在别处重复解析 env 而两份逻辑分叉。 2. 设计说 TypeSafe 用于"主观题"，但 B6(a)/(b) 已令无已知源的主观题**建不出来**——TypeSafe 调用面在 v0 可能为空，却仍多一条外发面（D-021）；建议 v0 先不接 TypeSafe（Qwen 路同归 llm 类已够），或明确它只对"抽取器已 final 的市场"问一次。 3. `judgedMarketAllowedHere` 的受理门那一处要从市场行取 `token_def_id`（现受理门只 SELECT 判定题列+outcome_end）。

## 我没做
只有设计文本；未审实现。
