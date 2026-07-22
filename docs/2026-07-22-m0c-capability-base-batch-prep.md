# M0c 能力强制基座批 · 启动准备骨架（Bettor 架构师起草）

> **Status**: DRAFT（2026-07-22 · Bettor）· 选型待拍期设计准备，**非完整设计**（完整 M0c 设计须待 Owner 拍 caller 选型 + 各子批 design→NWT 红队）
> **依据**：路线图 v0.4.2 §3 line 91-92（M0c 七项 + 预拆三子批 + "逐批 diff 预算待 J2 caller 三案对比 + M-1 清单完成后补"）+ `docs/2026-07-22-NWT-redteam-m1-2-threat-model.md` §4（七项验收对照矩阵）+ `docs/2026-07-22-m1-6-caller-identity-mechanism-comparison.md`（caller 三案）。
> **本卡目的**：路线图明确标注的 M0c "逐批 diff 预算待补"两个依赖（J2 caller 三案对比 ✅`5270f6c0`/`0ea4b3d7` + M-1 清单 ✅ 今日收口）**现已双满足**——本卡填这个待补空的**框架层**（切分/选型相关性/预算维度/启动条件），让 Owner 一拍选型即可立即启动，不被"预算没算"二次 gate。具体改动行数标"待域 owner 填"，遵守 Owner 令"给不出诚实预算写待补，不拍数换全绿"。
> **本卡性质**：设计准备文档，不改一行执行代码，不落任何 M0c 实现。

---

## 0. 前置状态（地面锚定）

- **M0c 是 Codex MF1 的答案**：选出 caller 身份机制（M-1.6）后"必须先于 M1 与任何多进程应用触达 relay 装上"——否则 M-1.2 场景 B（被攻陷 Console worker）的 B-1~B-3 在整个模块化过程一直 LANDS（红队硬门：M0c 未 armed 前任何"应用已抽离可独立触达 relay"批次=RED）。
- **caller 选型状态**：M-1.6 v0.2 NWT GREEN，Bettor 已上报 Owner（`97c3411a`）**待拍 A+C vs B**。M0c-1 的机制形态依赖此拍板（路线图 line 92 原文"机制按 M-1 选型"）。
- **能力数据地基已就绪**：M-1.1 全命令能力/效果清单（14 列，~50 命令）= M0c-2 策略 evaluator 对照的 capability matrix 来源；M-1.2 §4 七项验收矩阵 = M0c 每子批的红队核对单。

## 1. 三子批切分 + 选型相关性（本卡核心决策）

路线图预拆三子批（Owner 令"不许把隐形排期从类 C 挪到 M0c"），本卡按**是否依赖 caller 选型形态**再标一层启动条件：

| 子批 | 七项 | 内容 | 选型相关性 | 启动条件 |
|---|---|---|---|---|
| **M0c-1** | ①非自声明 caller 身份 ②默认拒绝命令暴露 | 传输边界身份验证 locus + 默认拒绝准入 | **🔴 选型相关**（A+C=relay 进程内验信封+app 自持凭证 / B=per-app socket 传输层绑定，locus 与机制不同） | **等 Owner 拍选型** |
| **M0c-2** | ③对照 capability matrix 策略 evaluator ④逐 caller 命令+钱包/市场/outpoint scope | scope 策略数据模型 + evaluator 判定逻辑 | **🟢 选型无关**（evaluator 消费 M-1.1 matrix + caller 身份【M0c-1 产出的抽象结果】，不关心身份怎么验出来的） | **可先启动设计**（依赖 M0c-1 的"caller 身份"抽象接口签名，非其实现） |
| **M0c-3** | ⑤nonce/request-id 防重放+幂等回执 ⑥审计回执绑定已认证身份 ⑦免代码吊销/禁用路径 | 去重存储 + 审计日志 + 运行时吊销 | **🟢 选型无关**（nonce/审计/吊销机制不依赖身份验证形态，M-1.2 C-3 已定 20/20 命令请求层去重全缺=统一建） | **可先启动设计** |

**关键收益**：M0c-2/M0c-3（③④⑤⑥⑦，五项/七项）选型无关，**可在 Owner 拍选型前先做设计稿**——Owner 拍板后只有 M0c-1（①②）需要按选型形态收敛，其余已就绪，压缩关键路径。M0c-1 与 M0c-2 的接缝 = "caller 身份"抽象接口（M0c-1 产出"这条命令的已认证 caller 是谁"，M0c-2 消费它做 scope 判定）——先把这个接口签名定下来，两批就能解耦并行。

## 2. 逐批 diff 预算框架（填路线图待补空的框架层）

Owner 令：钱路语义行≤50 硬上限、纯搬移≤300 预算、**给不出诚实预算写待补拿 GREEN-with-notes 不拍数**。本卡给预算**维度**，具体行数标"待域 owner 读实际代码填"（Bettor read-only 不拍未核的数）：

| 子批 | 预算维度 | 钱路语义行? | 具体行数 |
|---|---|---|---|
| **M0c-1（A+C 分支）** | ①relay.mjs 命令执行前信封验证入口（`process.on('message')` 分发点前插验证）②console HTTP 能力网关路由层 ③app 凭证 provision/颁发 | **是**（relay 分发点是钱路命令闸，验证逻辑=钱路语义行，受≤50 约束，超则拆更小权限函数） | **待 J2 填**（settler/relay 域，读 `relay.mjs:331-358` 分发点实际改动面） |
| **M0c-1（B 分支）** | ①per-app socket 传输层 ②broker/router 新组件 ③relay handler 逐个加 caller 上下文参数（M-1.6 §2 坐实"16+ 命令 handler 连锁改"） | **是**（handler 连锁改触及钱路命令） | **待 J2 填**（改动面明显大于 A+C，M-1.6 已定性） |
| **M0c-2** | ①scope 策略表 schema（DB 或配置）②evaluator 判定函数（消费 M-1.1 matrix）③接入分发点 | 部分（evaluator 判定=钱路语义，schema/数据=非钱路） | **待域 owner 填** |
| **M0c-3** | ①nonce/request-id 去重存储（复用现有 DB？M-1.2 C-3 定 relay.mjs `requestId` 仅响应关联无去重）②审计日志表（绑定 caller 身份，区别于现有链上 tx）③吊销机制（运行时禁用某 caller，免重启） | 部分（去重接入分发点=钱路，审计/吊销数据层=非钱路） | **待域 owner 填** |

**预算总量交接**：路线图 line 92 粗估 M0c "3-5 个红队批"、line 141 总量 23-35 批含 M0c。本卡不改总量估计，只把"逐批 diff 预算待补"从"完全 TBD"推进到"维度已切分、选型无关子批可先估、选型相关子批待拍"。**诚实标注**：A+C vs B 的 M0c-1 预算差是 Owner 选型 trade-off 的一部分（B 改动面大=预算高，这也是"最小改动"标准的量化依据）。

## 3. 启动条件矩阵（Owner 拍选型后的即时编排预案）

| 触发 | 立即可启动 | 仍待 |
|---|---|---|
| **现在（选型待拍）** | M0c-2/M0c-3 设计稿（选型无关，我可派域 owner 白天起草→NWT 红队）；M0c-1↔M0c-2 caller 身份抽象接口签名先定 | M0c-1 机制形态、M0c-1 预算 |
| **Owner 拍 A+C** | M0c-1（A+C）设计→NWT 红队；三子批预算 J2 域填 | 各子批 design→红队→code→diff→装载 |
| **Owner 拍 B** | M0c-1（B）设计（改动面大，M-1.6 已备 trade-off）；预算重估 | 同上 |

**红队硬门不变**（M-1.2）：M0c 三子批全部实现且拒绝/重放/scope/审计/吊销五类负向测试过之前，任何抽离应用（M1+）不得获 relay 访问（Codex note③）。M0c-2/3 先做设计不等于先放行——armed 判据是"负向测试全 fail-closed"。

## 4. 与 M-1.2 §4 七项验收矩阵交接

M0c 每子批的红队验收 = M-1.2 §4 对应负向测试全部 fail-closed（现状全 LANDS）：
- M0c-1 → A-4/B-1（伪造 app_id/进程内越权发命令→拒）
- M0c-2 → A-2/A-3/B-2/B-3（越 scope/internal 命令被 app 调→拒）
- M0c-3 → C-1~C-4（重放任意命令第二次→拒）/ B-4（越权命令审计可归因）/ B-5（运行时吊销生效）

**这张交接表 = M0c "建完没有" 的红队核对单**（M-1.2 已产出，本卡直接引用不重造）。

## 5. 待办

- **Owner 拍 caller 选型（A+C vs B）** = M0c-1 解锁的唯一前置（已上报 `97c3411a`）。
- **M0c-2/M0c-3 设计稿**：选型无关，可排白天派域 owner（settler/relay 域=J2，evaluator/scope/nonce/审计/吊销落点在 relay+console）→ NWT 红队。**非半夜抢**（团队熬夜一天，M-1 刚收口）。
- **caller 身份抽象接口签名**：M0c-1↔M0c-2 解耦接缝，先定可让两批并行（选型只改 M0c-1 的实现，不改接口）。
- **各子批 diff 预算**：J2 域读实际代码填（本卡给维度，不拍数）。

**关联**：`docs/2026-07-22-kanet-base-modularization-roadmap-v0.2.md`（§3 M0c 定义）、`docs/2026-07-22-NWT-redteam-m1-2-threat-model.md`（§4 验收矩阵）、`docs/2026-07-22-m1-6-caller-identity-mechanism-comparison.md`（选型）、`docs/2026-07-22-m1-1-command-capability-effect-matrix.md`（capability matrix 来源）。
