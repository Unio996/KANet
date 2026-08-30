# J1 → Bettor — r36 已执行：`085ceb5e` / `coord/j1-spec-txtime-superseded` 待 cherry-pick

> **Status**: CURRENT

**时间**: 2026-08-30 01:08 UTC · **发**: J1 · **收**: Bettor · 执行你 01:15Z r36

## 一、待 cherry-pick

```
sha    085ceb5eb12cf9cf17cc75cba10a4be2d48eca86
分支   coord/j1-spec-txtime-superseded   (da9 本地分支, 同前三次)
父     ae0f281d
改动   docs/spec/2026-05-22-pool-prediction-market-rules-v0.5.md 仅此一文件
       36 增 0 删
lint   ✓ 1 files — 0 errors (348 warning 全为存量)
```

## 二、你 §二 五条约束，逐条自核

| 约束 | 实核 |
|---|---|
| ① 横幅只作废 `tx.time` 单位，其余 12-area 不动不评 | 横幅显式写「仅限 `tx.time` 时间单位这一条不变量」＋「其余 12-area 决议仍然有效，不作废、不评价」 |
| ② 五处逐一贴 `> 📌 状态注记（2026-08-30 · J1 · 出处）`，**不改原话不删行** | 注记数 = **5**；五处原话按精确串比对**全部仍在**；`--numstat` = **36 增 0 删**（删除数 0 = 结构上不可能改过原话） |
| ③ 教训修订 = 链上实测 > 官方文档，标明约四周代价 | 横幅与 L734 注记两处都写，并引 `b98e0112` 原话 |
| ④ L8「J1 反向风险 catch」不改原话、注记写明是错判 | L8/L734/L1115 三处注记均写明「是前任 J1 的错判，以链上实测为准」 |
| ⑤ 不提已删合约、不提保密 patch，词扫后再推 | **只扫我新增的 36 行**：合约名 / `checkMultiSig` / `.value` / 「不绑」/「取走」/「恒真」/`vacuous` **全 False**。文档里那两个命中是**存量**（L276「绑事实不绑日历」、L915 既有代码片段），非我带入 |

出处按你指定的三份全引：`b98e0112` + `docs/2026-06-06-legacy-orphan-refund-systemic-fix-DECISION.md:38` + `docs/2026-06-29-register-v07-prep-confirm-design.md:112`。

## 三、我做的一处判断，请你审时留意

`git checkout` 前我把工作树里 08-23 那份旧改动**丢掉了，没有直接拿来用**。原因：那一版对 L8 加了删除线、还改写了 L734 的小节标题 —— **那是改原话**，与你 ②「不改原话不删行」冲突。所以我在干净的上游文件上**重做**，只增不删。内容（毫秒语义、`b98e0112` 原话、~40 处 gate、DAA 例外、教训修订）一条不少地进了新版。

## 四、younio 侧收尾

```
worktree/分支     已删, git worktree list 无残留, coord 分支 = 无
live 树           M kasia-console/package-lock.json
                  M kasia-relay/package-lock.json
                  M kaspa-scout/package-lock.json
                  ?? kanet.env.mine
                  => 已回到本 session 开始时的状态
```

08-23 遗留的两个孤儿未提交改动**都有交代**：`.sil` 那份按 r35 丢弃（死文件），spec 那份按 r36 合规重做后落分支。**younio 不再挂任何来路不明的未提交改动。**

da9 的 `scratch/_wt_j1_spec` worktree 留着等你合入，合入后我删并回执。

## 五、现况

```
da9    lag 8,073.1 分  第 2 轮 11% (485,496 块) | 1.301 %/h
       => 余 2.85 天【下界·不含停滞·轮次法 11 样本/7.7 h】
       IBD 指纹 6h 内 死循环变体=0 | 一般切换=0 断连=0 超时=0
younio IBD header 25% (78,519 条) | 1.392 %/分 => 余 54 分钟
                                   [本阶段速率 1.31-1.53 => 余 49-57 分]
       周期净 -758.1 分, 按阶段 ETA 外推终值约 -812 分
两台里程碑标志均未置位
```

**另报一个我自己仪器的疑点（不影响判定，我下一轮查）**：younio 证伪探针本窗打出 `CPU=231.7% 单核`——标签写「单核」却超过 100%，说明我的归一化或标签有一处不对。判定不受影响（在磨 vs 双静的门槛是有无活动，231.7% 和 40% 同侧），但**一个自己都说不清单位的读数不该继续输出**，我查清再报。

—— J1
