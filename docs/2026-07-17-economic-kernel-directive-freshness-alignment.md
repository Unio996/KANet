# PR#4 Economic Kernel 操作化指令·新鲜度对齐清单(Bettor·2026-07-17)

> **Status**: CURRENT — 供 Owner 修订 PR#4(ce321491)用;逐节对照 bshard-m3-deploy HEAD 实际落地状态。
> **结论一句话**: 方向与 7/16 终裁一致、无路线冲突;但稿子基于 7/16 00:48 旧快照(基点 2c344dfc),**P0 八项里四项已交付、两项部分交付**,且 §8 一行与已落地的"零人工闸"决策相抵触,合并前须按本清单修订,否则接位 agent 会重执行已完成项(D-002 炒陈饭族)。

## 一、合并工程问题(阻塞)

1. **合并目标错误**: j2-bshard-payout 系 7/16 Owner 分支卫生裁定的**冻结分支**,且其 tip(2c344dfc)已完整包含于 bshard-m3-deploy、零独立提交——"当前最新开发线"不成立。改 target=bshard-m3-deploy 并 rebase。
2. **CLAUDE.md 19 行排版残缺**: "当前硬边界:"下空悬,后接孤行"0."列表项,系拼贴痕迹;且该 hunk 基于旧 CLAUDE.md,rebase 后需对 7/17 版重排(铁律 0.5/0.6 编号顺序)。

## 二、逐项状态对照(§2 总表 / §11 P0 表)

| P0# | 指令要求 | HEAD 实际状态 | 修订建议 |
|---|---|---|---|
| 1 | K-16 合入 v0.1+验收矩阵 | **文本已合入**(46ad951c+NWT 忠实修正 eefe5b49,7/16);§3.2 故障注入**执行**未做 | 标"文本 DONE,注入执行 PENDING" |
| 2 | Trust Profile v1 schema+兼容映射 | **六轴 GREEN 定稿 c2aa6210**(7/16,含 NWT computation 轴补强+Committee-reads-external 独立行);兼容映射表未落 | 标"schema DONE";**§4.2 的向量副本须与 c2aa6210 逐字段核对收敛为单一 canonical**(两份并存=双真相源,正是本指令自己反对的) |
| 3 | Result Authority 全量清单三口径 | **已交付 46feca44**(7/16,资金量+用户数主维度;战略事实 oracle-hook 78.2% 资金/98.0% 用户) | 标 DONE;§5 字段清单与 46feca44 差异做一次字段级核对(如 payout_authority 列),缺的开增量小卡 |
| 4 | money-path manifest v1+存量清单 | schema **已落** 073295ae;lint 首批 4 条**已装载** d35e707c;存量条目增量中(§4.1-4.4 已 3 条+escape_exit 更正) | 标"schema+首批门禁 DONE,存量条目进行中" |
| 5 | VerifiedSettlementInputs schema | **真 PENDING**(7/16 仅裁决口径) | ✅ 保留为当前最高优先设计件 |
| 6 | Batch1 C+逐端点数据访问矩阵 | **部分交付** 21fd840d(C 部分+13/16 端点内联同步 SQLite 分类);逐端点读写矩阵/故障注入矩阵未完 | 标"部分 DONE",列剩余明细 |
| 7 | ADMIN capability matrix+break-glass 设计 | **超额完成**: 四钥匙已落码装载(8e19a913,live 403 tier 验证);confirm-by-address **已彻底移除**(120da762,三方验死,Owner"零人工闸"原则钦定) | 见冲突 C |
| 8 | 进程拆分落码 HOLD | 一致(HOLD 维持;§9.3 死端点观察=命中计数器 14c58a23 已在 7 天观察窗) | 标"HOLD 一致,步骤 2 已在跑" |

## 三、实质冲突(必须改,不是标注)

**C. §8 confirm_by_address 行**: 指令写"disabled+独立 break-glass key+第二方确认"——但现实是该通道 7/16 已**整体移除**(120da762,零在途依赖三方验死),且依据正是 Owner 本人"系统不需要人工、没有人工闸"原则钦定。按指令原文合并=暗示重建一条 break-glass 通道=倒退。改为"**REMOVED**(120da762),不再存在该 capability"。

## 四、真实待办净集合(修订后指令应聚焦的)

1. VerifiedSettlementInputs schema+V2 路径映射(P0#5,J2/J1 主责——J2 班已开)。
2. K-16 故障注入七项**执行**+验收报告(§3.2,文本已在)。
3. Trust Profile 兼容映射表+§4.3 四位置暴露(付款前 UI/TG 确认页显示信任向量=用户面,Owner 批)。
4. Batch1 剩余: 逐端点读写矩阵+故障验收矩阵(§9.2 的 4/6/8/9/10 项)。
5. KILLSWITCH-SAFE lint v2(调用图,已排期)。
6. Result Authority 字段级增量核对。

## 五、无冲突确认

§0 方向、§6 feeSplit 边界(与 7/16"纯函数无罪+适配层"裁决一致)、§9.1 v06/v07 profile 定义、§10 HOLD 清单(与现状一致)、§11"责任可由 Bettor 调整"、§12 DoD、§13 口径——均与在案决策与 ledger 状态无冲突,照单保留。
