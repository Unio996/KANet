# Owner 终裁 — Economic Kernel 对抗轮② + Batch1(2026-07-16)

> **Status**: AUTHORITATIVE — Owner 经操作终端逐字交付, Bettor 存证入库。原文如下, 未作改动。
> **总评**: "研发方向已经明显从'继续堆功能'转向'用协议宪法反查现实系统'……团队已经开始用真实事故检验架构, 而不是用架构语言解释事故。"
> **危险预警**: "文档越来越正确、代码继续背着历史路径前进。现在必须把宪法压成 manifest、门禁、故障注入测试和用户付款前可见的 Trust Profile。"

## 裁决表

| 发现 | Owner 判断 | 指令 |
|---|---|---|
| K-16 故障隔离 | 完全同意 | **纳入 v0.1 不等 v0.2**, 措辞收紧版已给(见下), 验收=真实故障注入非"拆了进程" |
| Oracle/Verifier 命名坍缩 | 同意, 不立刻大改表 | 规范名+兼容视图, 渐进迁移 |
| T2/T3 真实权威未公开 | 同意且比命名严重 | 每市场必须在创建/API/UI/commitment 显式声明 |
| K-10 只有文档没门禁 | 同意 | 机器可读资金出口清单(manifest), 非关键词 lint |
| feeSplit caller-fed 违 K-01 | 只部分同意 | 洞在输入验证适配层非纯函数; 建统一 VerifiedSettlementInputs; 一个计算核两种入口 |
| Batch1 API 收敛 | 调查质量好但**不能落码** | C 部分/数据访问分类/故障验收未完成, 现为"调查与决策输入" |

## K-16 定稿措辞(Owner 版)

> **K-16 — Fault Containment**
> 每个生产部署必须公开其故障域和共享依赖。任一链下组件的崩溃、阻塞或资源耗尽, 不得阻止无直接依赖的资金状态机继续结算、退款或进入可达出口。

验收 = 故障注入: Broker worker 人为阻塞 30s 后 API 仍响应/Settlement worker 仍推进/TG 故障不影响退款/单子进程 OOM 可独立重启/队列有上限超时背压不转嫁故障。

## Trust Profile 改为信任向量(六轴)

`result_source / aggregation / computation / enforcement / availability / escape_authority` —— 签名证"谁说的"、ZK 证"怎么算的"、委员会证"多少人同意"、covenant 证"链强制了什么", 不得压扁为单一等级。J1 的"多数市场 UMA 绑定"论断需实时库统计支撑才可进公开口径: 按市场数/活跃资金/投注人数/outcome_oracle_hook/committee 有无/zk-native/最终 payout authority 统计, **以资金量和用户数为主维度**。

## K-10 manifest 模板(Owner 版)

```yaml
path_id:
intake_transaction:
locked_states:
normal_exit:
timeout_exit:
escape_exit:
responsible_worker:
kill_switch_effect:
fault_domain:
admin_capabilities:
required_tests:
```
Lint 只验: 每收款路径有清单/每锁定态至少一可达终态/kill switch 不同时关唯一退款 worker/文档出口对应实际测试/新 money-path 无 manifest 不得合并。

## VerifiedSettlementInputs(feeSplit 边界定稿)

`链上事实 → VerifiedSettlementInputs → feeSplit → SettlementPlan`。字段: 来源 txid/outpoint、确认深度、Agreement/fee rules commitment、bettor set commitment、pool amount、winner authority、verifier identity、input commitment。feeSplit 不自己读链, 不造第二套计算逻辑。

## ADMIN_SECRET 拆能力级权限

status signing / emergency registration / close propose / ZK handoff / ZK close broadcast / debugger dry-run 各自独立; `confirm-by-address` 标记 break-glass: 默认关、单独密钥、完整审计、宜第二方确认。

## Batch1 迁移路线(Owner 九步)

1. 停止增加新端点 2. 访问日志确认四个疑似死端点 3. v06/v07 定义为不同 `settlement_profile` 4. 新市场统一 v07 分片; 存量 v06 只留读取/结算/退款 5. 非托管路径统一 `prep→用户签名→confirm` 6. 托管测试路径可单步包装但必须标注 custody profile 7. 外部 API 稳定 URL, 协议版本与 settlement profile 进 payload+Agreement commitment 8. API 进程不得直写资金状态表, 命令交唯一生命周期 owner 9. API 与核心不共享无边界同步 SQLite 写权限(否则 DB 锁故障跨进程传播)

## 下一批优先级(Owner 钦定顺序)

1. K-16 合入规范
2. Trust Profile 单值→多轴信任向量
3. 全量现行市场 Result Authority 统计
4. money-path/exit-path/fault-domain 机器清单
5. 完成 Batch1 的 C 信任边界+数据访问分类
6. 拆分 ADMIN_SECRET 权限
7. 再开始进程拆分与 API 迁移
