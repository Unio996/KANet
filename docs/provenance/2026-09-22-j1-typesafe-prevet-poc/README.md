# J1 · TypeSafe(Jev) 出题端预审 PoC #1 — FP/FN 实测

**日期**：2026-09-22 · **作者**：J1（younio） · **派工**：Bettor TASK `2026-09-22T10-07Z-bettor-TASK-typesafe-ruling-poc1-question-prevet-fpfn.md`
**范围**：零主链 / 零钱路 / 零 console。只读公开/合成题面，走托管 `jev-latest`。脚本在 `kasia-console/scratch/`（不入 src）。

## 一句话结论

托管 Jev 的 **noul** 能把"该题能否从所列源确定性判出唯一答案"判得相当准——**FN（垃圾放行）几乎为 0**，方向天然安全；**FP（好题被拒）对 criteria 措辞极敏感**：v1 过严 → FP 87–100%（不可用），**v2 校准后 @ 阈值 0.30 = FP 6.7% / FN 3.3%**，作为建题端 advisory 闸（人确认，D-030）已可用；FP 目标 <5% 只差 2 条好题，阈值/措辞再微调即可进。

## 方法

- 复用现有 **120 条 fixtures**（`kasia-console/scripts/prevet-fp-fn-fixtures.mjs`，30 pass + 90 critical，D-031，不新造）+ 另造 **10 条 D-032 型坏题**（题面清晰但源判不出）。
- 每条题面（`title / resolution_criteria / data_source_canonical / deadline`）问**一个 noul**：*"仅凭所列 data_source_canonical，截止后能否把该 YES/NO 市场判成唯一无歧义答案（确定性、无人工）？"*
- 决策：`noul >= 阈值` 视为通过，否则拒建。**FP = 好题(expected pass)被拒**（目标 <5%）、**FN = 垃圾(expected critical)放行**（目标 <15%），口径沿用旧 runner。
- 两版 criteria 对比灵敏度：**v1** 强求"精确阈值+取值时刻+平局规则"；**v2** 放宽——胜负/阈值题只要源权威且发布该结果即算可判，不再强求平局规则/时间戳。

## 结果

**FP/FN（仅 120 fixtures，与旧 runner 可比）**

| criteria | T=0.30 | T=0.50 | T=0.70 |
|---|---|---|---|
| v1 | FP 26/30=86.7% · FN 0/90=0.0% | FP 30/30=100% · FN 0% | FP 30/30=100% · FN 0% |
| **v2** | **FP 2/30=6.7% · FN 3/90=3.3%** | FP 10/30=33.3% · FN 0% | FP 17/30=56.7% · FN 0% |

**v2 分类 banded（pass≥0.70 / warn / critical<0.30）+ 均值 noul**

| 类别 | n | pass | warn | crit | mean |
|---|---|---|---|---|---|
| good_clear | 10 | 7 | 3 | 0 | 0.713 |
| good_multi | 10 | 2 | 8 | 0 | 0.537 |
| good_edge | 10 | 4 | 4 | 2 | 0.577 |
| bad_missing | 10 | 0 | 0 | 10 | 0.028 |
| bad_vague | 10 | 0 | 0 | 10 | 0.042 |
| bad_no_source | 10 | 0 | 0 | 10 | 0.034 |
| bait_switch | 30 | 0 | 3 | 27 | 0.142 |
| subjective_tail | 30 | 0 | 0 | 30 | 0.022 |
| d032_bad | 10 | 2 | 3 | 5 | 0.373 |

**成本/性能**：v2 = 130 次调用 / 0 错误 / 10.4s（并发 4）/ token in=77,950 out=2,860。v1 = 10.7s / in=68,850 out=2,860。

## 发现

1. **noul 对 criteria 措辞高度敏感**：同一好题（Yankees/ESPN）v1 得 0.22、v2 得 ~0.71。→ 采纳前必须在真实题库上定版 criteria + 定阈值，不能照搬 demo 值。
2. **操作点**：v2 @ **T≈0.30** 平衡最好（FP 6.7% / FN 3.3%）。要 FN=0 就抬到 0.50，但 FP 升到 33%（对 advisory 闸太激进）。建议 T=0.25–0.30 起步，按运营容忍度调。
3. **d032 诚实校正**：我 10 条"坏题"里 5 条其实**可判**（Apple vs MSFT→Yahoo 0.78 / 票房→BoxOfficeMojo 0.80 / Chiefs spread→ESPN 0.68 / 演唱会→Ticketmaster 0.54 / BTC 更高 0.55）——jev 给高分是**对的**，因为那些结构化源确实发布该结果。真正判不出的 5 条（Real Madrid/Instagram 0.05 · Team A/Twitter 0.16 · 选举/Wiki 0.04 · 马拉松/博客 0.07 · 失业率/vague 0.06）被正确压低。→ **jev 判的轴是"源能否判"，"题面清晰"本身 ≠ 可判**；对抗集需要更硬的真·判不出样本（v3 待办）。

## 建议（交 Bettor 裁）

- **采纳形态**：建题端跑一次 noul，`< T` 拒建/要运营者改源或改题；`warn` 段提示人工复核；**只作参谋、人确认**（D-030）。不进判定/退款（D-032）。
- **进设计稿前需**：① 在真实历史题库（非合成）上定版 criteria + 定阈值；② 造更硬的 D-032 对抗集重测；③ 决定 warn 段（0.30–0.70）交互。
- 本地自建 Jev 维持 **SHOULD**，未触发（本 PoC 用托管，输入公开/合成，未撞数据边界/费用）。

## 复现

```
# key 在 env（值不入任何文件）；默认跑 v2，POC_V=v1 跑对照
cd D:\KANet\kasia-console
node scratch/j1-typesafe-prevet-poc.mjs            # v2
$env:POC_V='v1'; node scratch/j1-typesafe-prevet-poc.mjs   # v1 对照
```

**版本**：node v24.19.0 · 模型解析 `jev-1.13.0`（请求 model=jev-latest）· API `POST https://api.typesafe.ai/v1/systemone` · 脚本 `kasia-console/scratch/j1-typesafe-prevet-poc.mjs`。
**原始数据**：`kasia-console/scratch/j1-typesafe-prevet-v2-*.csv|json`（130 行逐条 noul + 三阈值决策；scratch/ gitignored，附件 `poc-v2-rows.csv` 为本目录留证）。

## 边界

不改 src；不碰 `proto_*` / `pool_*` 表；不调 `:3200` / `:3202`；key 名 `TYPESAFE_API_KEY`，值不入任何文件；真实市场/余额/内网未发托管；输入仅公开/合成题面。
