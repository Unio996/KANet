# M0c-1 Path B Pilot 激活部署 runbook（KANet-UI·工作流④）

> **Status**: CURRENT（v0.16·Codex MSG-126 判：E/C/D/arm-before-fund 核心安全全 CLOSED + evidence 绑定 GREEN，剩 P1(收窄 /diagnose 授权，已落码 pending-review) + P2(本版，文档真相对齐) 两条有界收尾，Codex 原话"最后一轮"，待三人红队+Bettor整包整合+Codex 终审+Owner 最后拍）
> **v0.16 更新（2026-07-24，Codex MSG-126 最后一轮：P1 诊断收窄 + P2 文档真相对齐，`docs/2026-07-24-m0c1-pilot-codex-msg126-rectification.md`）**：核心安全（E/C/D/序列重排）全 CLOSED。P1（J2+KANet-UI，已落码 pending-review 见 `docs/2026-07-24-kanet-ui-p1-diagnose-narrowing-pending-review-diff.md`）：`/diagnose` 去 shared ingest secret 改三层 admin 授权（`ADMIN_DIAGNOSE_ENABLED` 默认 off + 独立 operator 凭据 + IP allowlist）+ 解密前先查 `access_mode`；新增共享 `pilot-wallet-policy.js`（`/send`+`/diagnose` 两路由共用一条规则）。P2（本版）：§4.3 诊断步骤更新鉴权方式描述；§4.5"唯一权威、最终证明"措辞收窄为"充值后又一道独立验证"（跟 §4.3 不矛盾）；§6 更正"删 env 重开 legacy"的过期声称（v0.15 durable 列上线后不再成立，env 只是 defense-in-depth）；status 更新反映 E-schema/D-fault 已落码（非 pending）。
> **v0.15 更新（2026-07-24，Codex MSG-125 二审"C/E未结构性闭"，`docs/2026-07-24-m0c1-pilot-codex-msg125-rectification.md`）**：MSG-124 五条修完后 Codex 又挖深一层：① **E 未结构性闭**（Bettor 认账第二次判轻）——env allowlist 会 fail-open（env 缺失/畸形/重启未加载时 legacy `/send` 静默重开），改用 `tg_custodial_wallets` 新增 `access_mode` durable 列（`'capability_only'`）做权威判据，env 降级 defense-in-depth（J2 认领 schema，见 `docs/2026-07-24-kanet-ui-e-tg-wallet-pilot-isolation-pending-review-diff.md` 后续更新）② **C 未闭**——helper 自读自过只证内部一致、8-hex 指纹是人工 sanity，唯一权威此前是充值后的 §4.5，Codex 要求充值前就证：新增 `GET /:tg_user_id/diagnose` no-broadcast 诊断（live 进程实际 key decrypt+derive 地址比对，KANet-UI 落码，见 `docs/2026-07-24-kanet-ui-c-diagnose-pending-review-diff.md`）③ **序列重排（arm-before-fund）**——§3.6 不再充值（只建零余额钱包+grant），新增 §4.3（零余额验证闸：C 诊断+E 隔离攻击验证）+ §4.4（验证闸全过才充值），§4.5 live 冒烟顺延到充值之后不变位置。④ D 项还差 fault-injection 测试（J2 认领：INSERT 后、readback 前受控注入异常，证明零残留行）。
> **v0.13 更新**: PILOT_WALLET_ADDRESSES durability 纪律(NWT 追问坐实)——这个 env 是 E 项隔离检查唯一判据源, pilot 结束/§(f)吊销+确认余额清零前绝不能 unset, 语义跟 §4 两 flag(删=更安全)相反(删=更危险的 fail-open), §6 回退路径明确切开不属于本次回退动作。
> **v0.14 更新（2026-07-24，Codex MSG-124 终审 5 条 MUST-FIX 全部收口，`docs/2026-07-24-m0c1-pilot-codex-msg124-rectification.md`）**：Codex 终判"G4 绑定 CLOSED/provision GREEN/M0a capability GREEN，但 A/B/C/D/E 五条 MUST-FIX 未闭+一条 over-claim（Bettor 认账: "三份 evidence 都自描述"实只 G4/"stdin 不回显"实假）"。本版一次性全改：**E**（KANet-UI 主，`fea2f4b7` 已 ship）legacy `tg-wallet.js` `/send` 对 pilot 钱包 fail-closed 隔离+去 FAUCET fallback，Bettor 全仓枚举 spend 路径确认无第三条绕过路径。**A+B**（J2，合并方案）根治"stdin 不回显"over-claim——不试图隐藏交互式终端输入，彻底不给这个选项，改用 `m0c1-pilot-candidate-generate.mjs` 同一 tick 加密落盘+`--candidate-file` 取代 stdin。**C**（J2 helper 半+KANet-UI runbook 半）`--db` 硬 required 去默认值+`currentKeyFingerprint()` 双处打印早期 sanity check+§4.5 live 冒烟升级为唯一权威最终证明。**D**（J2）`INSERT`+`readback` 包进同一 `db.transaction()`，事务内 throw 自动 ROLLBACK 取代手写 DELETE 自愈，真并发测试证明"从未提交"非"插入又清理"。真相校正（J2）两 regression evidence 补 source_commit/blob 自描述字段。33/33（helper+candidate 测试）+ 8/8（E regression）+ 13/13（provision regression）全绿，三人红队+NWT 独立复核 GREEN（review_ref=`a99c387b`/`42c96e8e`）。
> **v0.12 更新（2026-07-24，reviewed helper `5964af91` ship 后，runbook 步骤 4-6 从"待定设计"改成引用实际实现）**：§3.6 MF2 步骤 4-6 原先是"helper 具体实现留 KANet-UI+J2 联合定"的占位描述，helper（`kasia-console/scripts/m0c1-pilot-custodial-insert.mjs`）落码 ship（三人红队 GREEN + NWT loop-closer 复核 GREEN，review_ref=`bed78d93`，含 NWT 红队抓出的两个真实缺口修复：`--network` 白名单堵 typo-fallback-mainnet footgun + 非法 mnemonic 错误路径 no-leak 测试）后，本版把步骤 4-6 改写为具体命令+行为描述，非泛泛"经一个 reviewed helper"这类占位措辞。
> **v0.11 更新（2026-07-24，Codex v0.10 re-review "Remaining MUST-FIX 2"）**：明文候选 mnemonic 跨 §3（Owner go 前，offline 生成）→ §3.6（Owner go 后，真建行）两个相位，此前只说"留 scratch 不进消息"，没定义完整生命周期。补齐 6 步（Codex 原文逐字，见 `scratch/mf2-mnemonic-handoff-spec.txt`）：①隔离进程生成，mnemonic 不进 stdout/不做 shell 参数 ②仅存加密瞬态容器/受控 in-memory session，绝不明文文件/剪贴板/chat/log ③no-go/abort/mismatch → 立即销毁候选密钥，只记 public 地址/hash ④go 后经 reviewed helper 做 encrypt+insert，随即 in-process 解密 derive 地址跟候选比对，不 log secret ⑤零化瞬态明文 ⑥`tg_user_id` 必须显式唯一非空（更正 v0.10 曾写"留空/标记 pilot 专用"的错误措辞）。Codex 明确"不要求 HSM，是有界操作程序"——纯 runbook 章节扩写，非新钱路代码。步骤 4 的 reviewed helper 具体实现（新写小函数 vs 复用现有代码路径）留 KANet-UI+J2 联合定，本版只定操作程序本身。
> **依据**: `docs/2026-07-23-m0c-1-path-b-pilot-containment-design.md`（围栏设计，本 runbook 是它的部署时序落地）+ 频道 19:44-19:46（两 flag 耦合 footgun）+ 19:33 relay-utxo-topology 老坑。
> **性质**: 部署编排 runbook，非设计文档——只讲"按什么顺序、每步怎么验"。
> **v0.3 更新（2026-07-24，claim-to-code 事故后自我校准）**: v0.1/v0.2 原写"安全参数以围栏设计 doc 为准"——这正是 Codex RED 抓出的转引链风险（本 runbook 当时也没有独立验证被引用的数字是否真落码，2026-07-24 05:06 自曝）。现改为逐项标代码坐标，本文档自己对每个数字负一次独立验证责任：50 KAS 钱包顶（围栏设计 §2.2，运维配置值非代码常量）/ 2 KAS 单笔（`kasia-relay/src/lib/app-envelope.mjs:79` grant `max_amount_sompi` 字段 + `kasia-console/src/api/capability.js:126` 早拒检查）/ 3 笔每分钟限流（`capability.js:48-49` `RATE_LIMIT_WINDOW_MS`+`RATE_LIMIT_MAX`，J2 `cf680280` 落码，claim-to-code 三道核 GREEN）/ 5min custodial TTL（`app-envelope.mjs:57` `CUSTODIAL_PILOT_MAX_TTL_MS`，J1 `944f2a72` 落码）/ gateway pilot-wallet 白名单（`capability.js:206` `PILOT_WALLET_ADDRESSES`，J2 `cf680280` 落码，空=fail-closed）/ grant-scoped 白名单（`app-envelope.mjs:79` `source_scope` 字段）。均已通过 claim-to-code 三道核（自核+Bettor grep+NWT 独立扫描）确认真实存在。
> **v0.4 更新（2026-07-24 06:17，Codex MSG-121 再审 MUST-FIX 1/2 + 三处校正）**: **§3 资金 checklist 全程指错钱包**——`custodial_transfer` 实际出钱的是 `tg_custodial_wallets` 表选出的托管钱包，不是 relay 自身钱包（`relay_nodes.address`），详见 `docs/2026-07-24-m0c-1-pilot-activation-receipt-template.md` §(a)(c)(c')。本版同步修正：①§3 资金 checklist 改查 custodial 地址、删 relay split-utxos 引用 ②§4 步骤 4 的 `armReport()`/501-scaffold 措辞更新为已接线现状 ③新增 §4.5 Owner 授权后真 live 冒烟（G4 是隔离环境单元测试，不侦测真实部署配置错误，这条是 MSG-121 指出的独立验证层，之前 runbook 暗示"G4 能抓 live 配错"是假声称，已删）。
> **v0.5 更新（2026-07-24 08:xx，Codex MSG-122 pre-activation A 项：Owner-gate 时序）**: Bettor+NWT 独立核对确认的洞——v0.4 之前"Owner 显式授权"只挂在 §4.5（live 冒烟测试）前面，但真正让闸对全部真实流量生效、pilot custodial 地址暴露在真实攻击面下的动作是 §4（两 flag 原子开启）本身，不是 §4.5 那笔测试转账。旧文档把 Owner 知情同意安排在"闸已经开着"之后，等于决策权倒置给 operator。新增 **§3.5 Owner 显式 go/no-go**，作为 §4 的硬前置条件（未拿到 Owner go 不得开始 §4 步骤 1），与 §4.5 的授权检查点是两道独立的、不能互相替代的 gate（§3.5 gate "要不要开闸"，§4.5 gate "要不要发这笔测试转账"）；§4.5 原"不可逆动作前的最后一步"措辞已更正。
> **v0.6 更新（2026-07-24 09:xx，Codex 二轮 MUST-FIX：§3 排在 §3.5 前面=先动钱再问 Owner，Bettor 自认内部验证也漏掉这层）**: v0.5 的 §3.5 硬前置只挡住了 §4（flag 开启），但原 §3（资金 checklist：真充 50 KAS + 真写 grant.source_scope 进 registry）仍排在 §3.5 之前执行——Owner 表态时钱已经进了钱包、grant 已经进了 registry，是又一层"先斩后奏"，被 Codex 二轮外审抓出。v0.6 拆三段：**§3**（候选值准备，只起草钱包候选地址+grant 候选字段，不动钱不写库）→ **§3.5**（Owner 看候选值给 go，范围从"§4 前置"扩为"§3.6+§4 前置"）→ **§3.6**（Owner go 后才真充值+真 provision grant，原 §3 后半段搬到这里）。收据模板 §(c''') 同步改为记录"Owner 看到的是候选值"而非回读值。
> **v0.7 更新**: 补 `CUSTODIAL_RELAY_ID` 完整性缺口（Bettor+NWT 整序列反向扫抓出）——全文档此前只有验证性引用，从没有一步真正执行"写进 `kanet.env`"，§3/§3.5/§3.6 补齐候选记录→Owner 过目→实写入的完整链路。
> **v0.8 更新（2026-07-24，Codex 三轮反馈，Owner 明确要求这轮"全面梳理，不挤牙膏"）**: NWT+Bettor 全面自查（非等派工）抓出 4 类问题，本版一次性全改：① `source_scope`/`payee_scope` 是 membership set（JSON 数组，非标量），收据模板 §(c')(c'') 的"直接相等"框架类型不对，已改成员检查框架 ② **§2（创建 pilot relay）本身也排在 §3.5 Owner 授权之前**——建 `relay_nodes` 行是 Owner 批前的真实状态变更，跟 §3 资金那次同类问题，本版把 §2 改成"候选参数"（不实际创建），真正创建挪到 §3.6（Owner go 之后） ③ 收据 §(h) 曾硬编码具体 commit SHA 示例值（`26a23292`）作为"权威 tip"，此后多个 commit 落地已过期，改为强制现查最终轮 Codex GREEN 对应的 tip、禁止抄文档历史示例值 ④ `process.env.CUSTODIAL_RELAY_ID` 回读时机错误——console 重启前编辑 `kanet.env` 不会让已在跑的旧进程的 `process.env` 变化，§3.6 那步改核对文件内容，真正的运行时回读挪到 §4 步骤 4 重启完成之后。
> **v0.9 更新（2026-07-24，Codex 三轮完整回合，`docs/2026-07-24-m0c1-pilot-comprehensive-defect-sweep.md` 一次性全改，Bettor+NWT 派工 A1/A2/A4/B1-B6）**：v0.8 的自查还不够彻底，Codex 三轮 + Bettor/NWT 反向扫又挖出更深一层：**A1/B5**（v0.8 说"§3 允许建 `tg_custodial_wallets` 行但不充值"仍然不对——建行本身就是生成+加密 mnemonic 写入生产 DB，是 Owner 批前不该发生的真实 key material 状态变更，非"无害占位"；改为 §3 阶段纯 offline/scratch 派生地址，真正建行连同加密 mnemonic 一起移到 §3.6）**A2**（§(h) 部署钉死回读从硬编码单一 commit 值改成 `reviewed_package_commit`/`review_response_commit`/`runbook_blob_sha`/`receipt_template_blob_sha`/`g4_evidence_blob_sha` 等运行时字段组，比对基准 = 当次 Owner 决策依据的那个包；CUSTODIAL_RELAY_ID fallback 描述改成 CURRENT 时态，旧洞降级为历史 revision note）**A4**（收据"使用方法"从"§4 走完后填"改成 5 相位框架，file-vs-runtime 两层核延伸到 §(d) 两 flag）**B1-B6**（补 `m0c1-grant-provision.mjs`+doc blob+manifest 进 load-bearing 清单/source_scope 同 payee 一样是 membership/relay 候选记法改成"拟建 name"非"已存在 id"/payee_scope 强制非空+provision 必传 `--payee`（J2 落码 `efac5c36`）/Status 头版本号更正）。**这轮流程也改了**：Bettor+NWT 承诺"一次全改完→三重深核（技术成立性/整序列反向扫/claim-to-code）→一次 Codex re-review"，不再分批送审。
> **v0.10 更新（2026-07-24，NWT 三重深核后发现的两个非阻塞问题，Bettor 批 KANet-UI 收口）**：① v0.9 的"§3 offline 派生候选地址"留了一个开放问题（生产建号流程能不能指定用已派生地址）——NWT+KANet-UI 独立核实 `kasia-console/src/services/wallet.js` 的 `generateMnemonic()`/`addressFromMnemonic()` 是**纯函数不碰 DB**，只有 `tg-wallet.js:68` 那步 INSERT 才落库；§3 offline 阶段直接调这两个纯函数生成候选 mnemonic+address（不进生产 DB），§3.6 用**同一对**做真正建行（不重新生成），候选地址与生产地址因此保证逐字符相同，原开放问题收口，删掉"二选一按工具能力执行"的模糊措辞。② 收据模板 §(h)/§(g) 物理顺序颠倒（h 排在 g 前面，字母序反了，NWT 抓出），已对调，内容本身无变化。

---

## 0. 核心事实（先讲清楚在激活什么）

**pilot 激活 = arm M0c-1 闸（`ADMIN_M0C1_GATE_ARMED=1`），不是开一个孤立的小 flag。** 今晨（2026-07-23）曾因不完整的 origin 标注就 arm 这个闸，导致三断路族事故（回滚记录见 memory `feedback-arming-gate-app-tag-without-envelope-breaks-second-family` + `reference-fail-closed-gate-arming-blast-radius-transitional-tag`）。事故后 family2/family3 全修 + `R-SENDCMD-ORIGIN-REQUIRED` 升 ERROR + NWT 138 处完整枚举 + supervisor 无残留 ARMED env 确认——**re-arm 六门前置现已就位**，本次 runbook 建立在这个前提之上，不是重新评估要不要 arm。

## 1. 两个 flag 必须同批次开（footgun，见 §2.6/§2.7 围栏设计）

- `ADMIN_CAPABILITY_GATEWAY_ENABLED=1`（网关路由，capability.js 层）
- `ADMIN_M0C1_GATE_ARMED=1`（relay 授权闸，authorize.mjs 层）

**代码坐标锚定该依赖**（不是猜测）：`kasia-relay/src/lib/authorize.mjs:66` `if (!GATE_ARMED) return {decision:'allow'}` 是无条件早返回、**在 origin 分发之前**——若只开网关 flag 忘开 relay arm，网关发出的 `origin='app'` custodial_transfer 命令到 relay 后直接放行，跳过 `authorizeAppCommand → verifyAppEnvelope → checkCustodialTransferBinding` 整条链（`kasia-relay/src/relay.mjs:490` `case 'custodial_transfer'` 直接执行 `custodialSendKaspa`，零二次校验）。这天的相当一部分工作（§3.3a 绑定器/network 四值 join/no-key-leak）在这个组合下会形同虚设，只剩网关单层防线。

**§2.7 机制补强**（网关转发前查 relay armed 状态）是纵深第二层，**不是银弹**（有理论 TOCTOU 窗口）——本 runbook 的原子开启顺序才是主防线。

## 2. Pilot relay 候选参数（🔴 v0.8 修正，Codex 三轮反馈+NWT 独立定位：建 relay 是 Owner 批前的实状态变更，跟 §3 资金候选同类问题的兄弟）

**NWT 独立核实的洞**：v0.7 之前，本节（创建 pilot relay）排在 §3.5（Owner go/no-go）之前执行——建 `relay_nodes` 行（大概率还 spawn 一个 live relay 进程，非纯 DB 占位）是 Owner 审批前就发生的一次真实状态变更，即便此刻未充值未 arm、单独看无害，仍属于"先动手"范畴，跟 §3 资金/grant 那次的问题是同一个模式。v0.8 把 relay 创建也纳入"候选→Owner 批→执行"：本节只确定候选参数，**不实际调用创建 relay 的 API**。

**Footgun**（`kasia-console/src/api/relay.js:75`）：`const net = network || 'mainnet'`——创建请求体不显式传 `network` 会**静默落到 mainnet**（比选错 testnet 变体更严重，完全错链）。候选参数阶段就要把这条记下，避免执行时漏传。

- [ ] 确定候选 `network` 值 = `testnet-12`（**执行时必须显式传，不依赖默认值**——上面那条 footgun）
- [ ] 确定候选 relay name / 其他创建参数
- [ ] 候选参数整理进收据 §(c''') 的"Owner 逐项过目参数"表，供 §3.5 引用（真正的创建动作、创建后 DB 复核、`network` 字段核验，移到 §3.6，Owner go 之后才执行）

## 3. custodial 钱包 + grant 候选值准备（🔴 v0.6 重排，Codex 二轮 MUST-FIX：不动钱/不写 grant 库，先出候选值给 Owner 审）

**Codex 二轮外审抓出的洞（Bettor 自认这层也是团队内部验证漏掉的）**：v0.5 之前，本节（原"资金 checklist"）在 §3.5（Owner go/no-go）**之前**执行，等于 operator 先把 50 KAS 真充进钱包、先把 grant 真写进 registry，才轮到 Owner 表态——充值=动钱，写 grant=铸造授权，两者都不是"准备动作"，而是本身就该等 Owner 批的实际操作。旧顺序 = 先斩后奏。v0.6 拆成两段：本节只出**候选值**（不动钱、不写 registry），§3.5 Owner 看着候选值批，批完才进 §3.6 真执行。

**先读**：`docs/2026-07-24-m0c-1-pilot-activation-receipt-template.md` §(a)(c)(c')——`custodial_transfer` 实际出钱的是 `tg_custodial_wallets` 表按 `fromAddress` 选出的托管钱包（`capability.js:163-164`），**不是** pilot relay 自身的钱包（`relay_nodes.address`）。

- [ ] 🔴 v0.14 重写（Codex MSG-124 A+B 合并修法，`kasia-console/scripts/m0c1-pilot-candidate-generate.mjs`，三人红队 GREEN + NWT 独立复核 GREEN，review_ref=`a99c387b`）：v0.10-v0.13 曾设计"用 `generateMnemonic()`+`addressFromMnemonic()` 生成后手动持有在内存/交互式 stdin 喂进 helper"——Codex 抓出这个流程里"人在真终端交互式敲入 mnemonic"这一步的"不回显"声称是假的（`readline({terminal:false})` 不禁终端 echo，人在真终端敲会显示在屏上+可能被录屏留）。v0.14 根治：**不试图隐藏交互式终端输入，而是彻底不给这个选项**——跑：
  ```
  node kasia-console/scripts/m0c1-pilot-candidate-generate.mjs <label>
  ```
  生成 mnemonic+派生地址后**同一 tick**（不经任何中间 `console.log`/写盘）用 `crypto.js` `encrypt()`（跟生产同一 reviewed 加密函数）把 mnemonic 加密，写进 `scratch/pilot-candidate-<label>-<ts>.enc.json`（含 `mnemonic_encrypted`/`address`/`network`/`key_fingerprint`——`key_fingerprint` 用 `crypto.js` 新增的 `currentKeyFingerprint()` 函数产出，同 §3.6 步骤 4 用同一份函数，防指纹算法两处实现漂移）。stdout **只**打印 address（供 Owner 审批）+ 候选文件路径 + key 指纹——**从不**打印/log mnemonic 明文，一次都不，全程没有交互式终端输入这一步。**不 insert 生产 `tg_custodial_wallets` 表**（那是 §3.6 单独一步）

**🔴 v0.14 新增（MF2 步骤 4-6，接续原步骤 1-3 编号——A+B 合并后步骤 1"读入方式"从 stdin 改为读候选文件，其余步骤号不变）：**

- [ ] **[MF2 步骤 1，v0.14 更正读入方式] 隔离进程生成 + 从不经交互式终端**：上面那对 mnemonic+address 在隔离进程里生成，**从不经过任何交互式终端输入路径**（这正是根治 A 项 over-claim 的手段：没有交互路径 = 没有"是否回显"这个问题需要回答）
- [ ] **[MF2 步骤 2] 仅加密瞬态存储**：候选 mnemonic 生成后**同一 tick 加密落盘**为 `scratch/pilot-candidate-*.enc.json`（"approved encrypted transient container"的具体形态——密文文件，非明文文件）——**绝不写进明文文件、剪贴板、频道消息、日志**
- [ ] **[MF2 步骤 3] no-go / abort / mismatch 处置**：Owner 否决（no-go）、操作中止（abort）跑 `node m0c1-pilot-custodial-insert.mjs revoke --candidate-file <path>`（单纯 shred 候选文件，不碰 DB，此刻还没到 insert 步骤）；后续核对发现地址不匹配（mismatch，见 §3.6 步骤 4）由 insert 那端负责销毁。**shred 三档时机纪律（NWT 红队钉死，D 项落码时一起定的）**：只在①事务 commit 成功后（候选已用完）②genuine mismatch（候选内容本身跟批准值对不上/readback 真失败）③显式 revoke（no-go）这三种情形 shred；**绝不**在 transient infra 失败（DB locked / key 指纹不一致 / `tg_user_id` 重复 / `--network` typo 这类"候选文件本身没坏，只是这次调用参数不对"的场景）shred——那些场景允许 operator 换正确参数用**同一份候选文件**重试，shred 了就没法重试了

- [ ] 起草 grant 候选字段值（`source_scope`=上面候选地址 / `payee_scope` / `max_amount_sompi`=2 KAS / `valid_until`），**本节不跑 provision 脚本、不写入 `m0c1_app_grants` 表**——provision 是"铸造授权"本身，即便此刻 gate 还没 arm、不会被 enforce，仍属于该等 Owner 批的动作，非"准备"
- [ ] 记下 `CUSTODIAL_RELAY_ID` **拟设值**（🔴 v0.11 措辞更正：不是"§2 创建的 pilot relay id"——§2 此刻只有候选 name，relay 还没创建，没有 id 可引用；应写作"绑定到 §3.6 从这个候选 name 创建出来的那个 relay"）——目前还没写进 `kanet.env`，只是确定"届时要设成这个"（`capability.js:30`，C 项已去掉的 `FAUCET_RELAY_ID` 隐式 fallback 意味着这个值必须显式设对，写错/漏写=网关早拒或误路由到别的 relay 身份，Owner 该看这个值）
- [ ] 候选钱包地址 + 候选 grant 字段值 + `CUSTODIAL_RELAY_ID` 拟设值整理进收据 §(c''') 的"Owner 逐项过目参数"表，供 §3.5 引用
- [ ] 充值目标金额记为 **恰好 50 KAS**（围栏设计 §2.2 硬止损顶，候选值阶段只是写下这个数字，不是真充）
- [ ] **relay 自身钱包**（executor-relay，收据 §(a) 上半）保持独立日常余额管理，不需要为 pilot 专门操作，不在本节范围内（v0.3 曾误列，v0.4 删除）

## 3.5. Owner 显式 go/no-go（🔴 v0.6 更新，Codex MSG-122 pre-activation A 项 + 二轮 MUST-FIX：arm 闸本身、以及 §3 的候选钱包/grant 都要 Owner 先批，不是只等最后那笔冒烟）

**Bettor + NWT 独立核对确认的洞（v0.5）**：v0.4 之前，"Owner 显式授权"这句话只出现在 §4.5（live 冒烟测试）前面。但 §4（两 flag 原子开启）本身才是让 armed 闸对**全部真实流量**生效的那个动作——闸一开，pilot custodial 地址就暴露在真实攻击面下，**即便 operator 还没手动发 §4.5 那笔测试转账**。这才是真正不可逆（或至少高成本回退）的窗口打开点，不是 §4.5 那一笔测试转账。旧文档把 Owner 知情同意安排在"闸已经开着"之后，而不是"要不要开闸"之前，等于把决策权倒置给了 operator。

**v0.6 追加（Codex 二轮）**：本节的 go 现在也是 §3→§3.6（真充值+真写 grant）的前置闸，不只是 §4（flag 开启）的前置闸——Owner 看到的是**候选值**（还没充的钱包地址、还没插库的 grant 字段），批完才允许 §3.6 真的动钱/写库。

- [ ] **Owner 的 go 必须是对"这次激活整包具体候选参数"的知情同意，不是一句空白的"可以了"**（Bettor 定型的范围）：给 Owner 看的东西必须包含——部署 commit SHA（§(h)）、pilot relay **候选**参数（network=testnet-12+name，§2，relay 尚未创建）、专用 custodial 钱包**候选**地址（§3，尚未充值）、拟充值金额（须 = 50 KAS 硬顶，§3）、grant **候选**字段（source_scope/payee_scope/max_amount_sompi/valid_until，§3，尚未写入 registry）、`CUSTODIAL_RELAY_ID` 拟绑定对象（= §2 那个候选 name 指向的 relay，实际 id 值要等 §3.6 创建后才存在，尚未写入 `kanet.env`）、即将写入的两 flag 目标值（§(d)）、§4.5 smoke 测试参数（金额/收款地址）、回滚路径（§6）——**逐项过一遍具体值**，不是抽象地问"能不能 arm"
- [ ] **在执行 §3.6 或 §4 任何一步之前**，Owner 已就上面这包候选参数给出显式 go（非默许、非"之前讨论过就算数"——每次真实激活都是一次新的不可逆窗口打开，需要当次的显式确认，理由见频道纪律 `feedback-decision-making-discipline-consolidated`：重大决策需 Owner 终裁）
- [ ] Owner go 的方式、时间戳、**Owner 当时看到的具体候选参数快照**（或指向收据其余字段的引用）记入收据（`docs/2026-07-24-m0c-1-pilot-activation-receipt-template.md` §(c'''），位置在 §(d) flag 回读之前
- [ ] operator 未拿到这条明确记录之前，**不得**开始 §3.6（🔴 v0.15 更正：§3.6 现在只建零余额钱包+grant，不含充值——充值挪到 §4.4）或 §4 步骤 1——都已进入不允许中断的原子序列，不能"先斩后奏再补授权"
- [ ] §4.5（live 冒烟）仍保留独立的第二道 Owner 授权检查点（对"发这笔真实转账"本身的知情同意）——两道检查点不是同一件事、不能互相替代：本节 gate 的是"要不要按这套候选参数动钱+开闸"（覆盖 §3.6 执行 + §4 flag 开启两个后续动作），§4.5 gate 的是"要不要现在发这笔真实测试转账"

## 3.6. Owner go 后执行：创建 relay + 建 capability_only 钱包（零余额）+ grant 正式签发（🔴 v0.15 重排，Codex MSG-125 req 4 + finding 5"arm-before-fund"：充值挪到 §4.4，本节结束时钱包仍是零余额）

**前置条件：§3.5 Owner go 已拿到并记入收据，否则不得开始下面任何一步。** 若实际要创建/写入的值与 Owner 看到的候选值不同（哪怕只是笔误改动），必须回到 §3.5 重新过 Owner，不得自行调整后继续。

- [ ] 用 §2 候选参数创建 pilot relay：请求体**显式**带 `network: 'testnet-12'`（不依赖默认值，`relay.js:75` footgun）
- [ ] 创建后立即查 DB 复核：`SELECT network FROM relay_nodes WHERE id=?` == `testnet-12`
- [ ] 现存 31 个 relay 已审计（2026-07-23）：100% `testnet-12`，此 pilot relay 是新增第 32 个，独立核验
- [ ] 🔴 v0.10 修正（A1/B5 开放问题①收口，Bettor 批，NWT+KANet-UI 独立核实 `tg-wallet.js:58-68`）：**真正建 `tg_custodial_wallets` 行**——`generateMnemonic()`/`addressFromMnemonic()`（`kasia-console/src/services/wallet.js`）是**纯函数，不碰 DB**，只有 `sqlite.prepare(...INSERT...).run()`（`tg-wallet.js:68`）那一步才落库；`tg-wallet.js` 的 API 端点把"生成"和"插入"绑死在一次调用里，但底层两个纯函数本身可以拆开单独 offline 调用。执行：**用 §3 offline 阶段调这两个纯函数生成的那一对 mnemonic+address**（不是重新生成一对新的）——具体做法见下面 MF2 步骤 4-6，不是随便一条 INSERT 语句就完事

**🔴 v0.14 重写（Codex MSG-124 MUST-FIX A+B+C+D 全部落码，三人红队 GREEN + NWT 独立复核 GREEN，review_ref=`a99c387b`；取代 v0.11-v0.12 的 stdin 交互式方案）：**

- [ ] **[MF2 步骤 4] go → 用候选文件做 encrypt+insert，事务内 in-process 验证**：Owner 批准（§3.5 go）后跑：
  ```
  node kasia-console/scripts/m0c1-pilot-custodial-insert.mjs insert \
    --candidate-file <§3 生成的 scratch/pilot-candidate-*.enc.json 路径> \
    --tg-user-id <pilot 专用唯一标识> --approved-address <Owner 批准的候选地址> \
    --network testnet-12 --db <canonical 生产 console.db 路径，硬 required 无默认值>
  ```
  **`--candidate-file` 取代 stdin**（v0.14 A+B 根治：不再有交互式终端输入这个选项）；`--db` **硬 required 无默认值**，若指向不存在的文件直接拒绝（不静默新建——canonical DB 应该已经存在，路径打错比新建更可能是真相，这是 C 项修法：旧 helper 默认猜一个 DB 路径，猜错时自读自过、live Console 却读不到这行）。执行顺序：读候选文件 → 候选文件里的 `address` 字段先跟 `--approved-address` 比对一次 → `decrypt()`（复用 `crypto.js` reviewed 函数）→ 重新 `addressFromMnemonic()` derive 一次交叉验证（双重防线，防候选文件本身被篡改成"address 字段对但 mnemonic 不对"）→ 候选文件里存的 `key_fingerprint` 跟当前 `currentKeyFingerprint(CONSOLE_ENCRYPTION_KEY)` 比对（诊断性，非安全边界，真安全边界是下一步的 AES-GCM auth tag）→ **`INSERT` + 同事务内 `SELECT+decrypt+derive+比对` 包进同一个 `db.transaction()`**（D 项修法：事务内任何 `throw` 触发 better-sqlite3 自动 ROLLBACK，取代旧版 INSERT→SELECT→条件 DELETE 三条独立语句之间的 crash 残留窗口——旧设计本身还有"如果 DELETE 也失败呢"的洞，事务化后这个洞结构性消失）。**整个过程不 log mnemonic 本身**
- [ ] **[MF2 步骤 4，C 子项] key 指纹人工交叉核**：helper 启动时打印这次用的 `CONSOLE_ENCRYPTION_KEY` 指纹（`currentKeyFingerprint()`，sha256(key) 前 8 hex，不可逆推）；同一函数在 `kasia-console/src/index.js` 启动时也打印（供 live Console 进程侧对照）。**operator 在 insert 前人工比对这两处指纹是否一致**——这是**早期低成本 sanity check**（不一致=大概率 canonical `--db`/key 源没对齐 live Console，趁早发现比事后排查快），**不是**"live Console 能真解密这行"的权威证明（helper 自己的 readback 验证只证明"helper 自己 encrypt 的东西自己能 decrypt 回来"，即内部一致性，不证明 live Console 进程用同一把 key/同一个 DB 文件能读到这行——权威证明见下方 §4.5）
- [ ] **[MF2 步骤 5] 零化瞬态明文**：insert 事务完成（成功或失败）后，候选文件按上方"shred 三档时机纪律"处置；helper 内部把持有 mnemonic 的局部变量重新赋值为空字符串丢弃引用。**诚实标注（非过度承诺）**：mnemonic 复用 `crypto.js`/`wallet.js` 现有函数的 `string` 签名，JS `string` 不可变+由 GC 回收，**无法做到真正的内存覆写零化**（语言限制，非 helper 实现缺陷）；候选文件的 shred 同样 best-effort（文件系统层覆写在 SSD 场景下未必物理生效）——**不写"已零化"/"已物理擦除"这种过度承诺的措辞**
- [ ] **[MF2 步骤 6] 显式唯一 pilot `tg_user_id` 非空**：用一个**显式、唯一**的 pilot `tg_user_id`（专用 pilot 标识符，非复用任何既有真实用户的 id）——helper 对空值/占位符字面量（`blank`/`mark pilot`/`pilot`/`test`/`placeholder`/`todo`/`tbd`，大小写不敏感）**精确拒绝**
- [ ] `tg_custodial_wallets` 表其余字段（`network`/`created_at`/`updated_at`）由 helper 按建行流程正常填
- [ ] regression 证据：`test-framework/cases/m0c1-gate/pilot-custodial-insert-regression.mjs`（真实调用两个 CLI，`spawnSync`/`execFileSync`，非 mock），33/33 PASS——含 D 项**真并发**测试（`Promise.all` 非顺序 await，两进程抢同一 `tg_user_id`，恰好 1 个成功+DB 恰好 1 行，证明输家的 INSERT 从未提交非"插入又清理"）+ shred 三档时机逐场景验证 + key 指纹不一致场景验证
- [ ] 🔴 v0.15 新增（Codex MSG-125 MUST-FIX E 要害，durable 结构隔离，J2 认领 schema）：insert 时该行 `access_mode` 列必须写成 `'capability_only'`（`tg_custodial_wallets` 新增列，migrate.js 新版本号，`DATABASE.md` 同步更新——J2 负责，本条是 runbook 侧核对提醒）——这是 legacy `tg-wallet.js` `/send` 隔离的**权威判据**（§4.3 E 检查用的就是这一列，非仅 env allowlist；env allowlist 降级为 defense-in-depth 早拒层，durable 列才是"env 没了也拒"的结构性保证）
- [ ] 🔴 v0.15 重排：**本节到此为止钱包保持零余额，不充值**——充值挪到 §4.4（arm + 验证闸全过之后），理由见本节标题的 v0.15 更新说明
- [ ] 跑 provision 脚本正式签发 grant（`kasia-console/scripts/m0c1-grant-provision.mjs`，用 §3 起草、Owner 已批的候选字段值，非临时改动的新值；**必须显式传 `--payee`**——`m0c1-grant-provision.mjs:100` 默认 NULL，不传 = `payee_scope` 空 = 该维 NULL，J2 负责校验落码，本条是 runbook 侧的执行提醒）——grant 签发本身不涉及资金转移，零余额钱包也可以先签好授权范围
- [ ] 候选地址写入 `PILOT_WALLET_ADDRESSES` env（defense-in-depth 早拒层，非唯一权威——权威是上面的 `access_mode` 列）——🔴 v0.13（NWT 核 E 项时追问的 durability 缺口，Bettor refinement 2 原话，v0.15 后语义收窄为"补充层"但纪律不变）：这个 env 若后续被意外 unset，`access_mode='capability_only'` 那一列仍会挡住 legacy `/send`（v0.15 durable 化后的保证），但 env 早拒层失效意味着少了一层"更早、更省事"的防线，**仍然在 pilot 结束/§(f) 吊销+清空钱包之前不应该 unset**，只是不再是唯一防线
- [ ] **`CUSTODIAL_RELAY_ID` 写入 `kanet.env`**（🔴 Bettor+NWT 整序列反向扫抓出的缺口：v0.6 之前全文档只有"读取/核对 `CUSTODIAL_RELAY_ID` 值"这类验证性引用（收据 §(c'')⑤⑨），从没有一步是真正执行"把 `CUSTODIAL_RELAY_ID=xxx` 写进 `kanet.env`"这个动作——对比 §4 两 flag 那步有显式编辑指令，这里之前是空的）：写入值 = 上面刚创建的 pilot relay 的实际 id（此刻才存在），**不得留空指望 `FAUCET_RELAY_ID` 兜底**（C 项已去掉该 fallback，留空直接 503）
- [ ] 🔴 v0.8 修正（Codex 三轮反馈坐实的技术错误）：**此刻 console 进程还没重启（重启在 §4），编辑 `kanet.env` 文件不会让已在跑的进程的 `process.env` 变化**——写入后能核对的只是 `kanet.env` **文件内容**本身（`grep CUSTODIAL_RELAY_ID kanet.env` 确认写对了、跟上面创建的 pilot relay id 逐字符一致），不是 `process.env`。真正的 `process.env.CUSTODIAL_RELAY_ID` 运行时回读要等 §4 步骤 4 重启完成之后才技术上成立（§4 步骤 4 需同步补一条这项检查，见该节更新）
- [ ] 收据模板 §(c') 四值一致证明本节先做一次（此刻钱包已建、地址已定，虽然还没充值——地址本身不会因充值与否而改变，四值一致性此刻就能核；余额=0 这件事本身也是一个待核实的事实，见 §(c) 回读）

## 4. 两 flag 原子开启顺序

**核心纪律：不允许中间态**（只开一个 flag 的时间窗 = §1 描述的漏洞窗口暴露期）。**前置条件：§3.5 Owner go 已拿到并记入收据 + §3.6 建号/grant 签发已完成（🔴 v0.15：钱包此刻仍是零余额，不再要求"真充值已完成"——充值挪到 §4.4，在本节 arm 之后），否则不得开始下面任何一步。**

0. **重启前查在途请求**（NWT note2：与今日 armed=on 重启前查在途 betting/settle 同款纪律，NO-TX-NO-STATE 相关——console 若在等 `custodial_transfer` 的 `sendCommandAsync` 回执时被杀，会有"不确定是否已执行"的悬空状态）：确认无正在处理中的 custodial_transfer 请求（pilot 阶段流量本就极低，直接看 relay 日志近几分钟无 `CUSTODIAL_TRANSFER` in-flight 行即可，无需查表）。
1. 停 console（正规 stop，非强杀，防 WAL 未 flush；查 stale pidfile，见今日复现 3 次的坑）
2. `kanet.env` 同一次编辑里加两行：
   ```
   ADMIN_CAPABILITY_GATEWAY_ENABLED=1
   ADMIN_M0C1_GATE_ARMED=1
   ```
3. 启动 console（不用 timeout 包裹，防连坐杀长驻 daemon）
4. **重启后立即验证**（四钥匙同款纪律）：
   - [ ] console 新 PID + 唯一实例（无并发残留）
   - [ ] relay 群起零 crash-loop（`GATE_ARMED && !GRANT_ENVELOPE_IMPLEMENTED` 会 throw，能起来=前提满足）
   - [ ] armed 状态确认为 true（`kasia-relay/src/lib/authorize.mjs` `armReport()` 本身仍无 IPC/health endpoint 接线——见 §5；但网关侧已接线一个只读通道：`capability.js:163` `checkRelayArmed()` 调 `get_arm_status`（`origin='internal'`），2026-07-24 J2 `18e738bf` 落码，NWT round-trip 核过。用这条或日志法 `[M0c-1 gate LEGACY]` warn tell 均可，v0.3 曾错写"当前无接线的健康探针"，已更正）
   - [ ] `capability.js` 的 `GATEWAY_ENABLED()` 读到 true（curl `custodial_transfer` 路由确认从 503→非 503——该路由 2026-07-24 前是 501-scaffold-only，`18e738bf`/`cf680280` 落码后已实际 wire 业务逻辑，v0.3 的"501-scaffold"描述已过期，此处更正为探真实路由）
   - [ ] 🔴 v0.8 新增（Codex 三轮反馈，`process.env` 回读时机修正的另一半）：**重启后**（此刻新进程真正读取了新版 `kanet.env`）`process.env.CUSTODIAL_RELAY_ID` 才第一次技术上有意义可查——用 `checkRelayArmed`/日志法或等价手段确认网关侧实际解析到的 relay id == §3.6 创建的那个 pilot relay id（收据 §(c'') ⑤==⑥）。§3.6 那步做的只是文件内容核对，这里才是运行时真回读，两者都要，不能只做一个当另一个的替代
   - [ ] **端到端冒烟（NWT note1，不可省；Bettor 定型：单一真相源非另建第二套）**：上面四点只验证"两个 flag 各自读到 true"，不证明组合后请求能实走通完整链路（若 env 变量拼写错/指错 relay id，四点独立检查仍可能全绿但请求实际打不通）。**"激活成功"判据 = 跑一次 G4 E2E harness 全量用例**（`kasia-console/test-framework/cases/m0c1-gate/g4-pilot-custodial-e2e.mjs`，J1 harness 域交付，本 runbook 不重建、直接调用；v0.4=27 用例（v0.3 起改用结构化 `phase` 判据取代日志正则+META-CHECK+relay_id mismatch，D 项落码后新增 BUST⑧ 畸形 cmd 场景），含 LAND/BUST①-⑧/REPLAY/REVOCATION/TAINT，2026-07-24 claim-to-code 三道核 GREEN，sanitized evidence 见 `docs/evidence/2026-07-24-m0c1-g4-pilot-custodial-e2e-v0.4-evidence.json`）——四点独立验证 + G4 全量跑绿，两者都要。**🔴 v0.4 诚实边界（Codex MSG-121 MUST-FIX 2）：G4 是隔离环境单元测试（独立 relay 子进程+独立 DB+throwaway 密钥），验证的是授权逻辑本身对不对，不侦测真实部署环境的配置错误（env 变量拼写错/指错真实 relay id 这类问题 G4 抓不到——v0.3 曾暗示"env 拼错会被 G4 抓出"是过度声称，已删）。真实部署配置正确性靠本 runbook 逐项 checklist + §4.5 真 live 冒烟兜底。**
5. **收敛类 legacy-unmigrated 面照常不断**：跑几笔现网 pool/relay/trading 操作，确认无 fail-closed 断（今晨事故的直接回归检查）

## 4.3. 零余额验证闸（🔴 v0.15 新增，Codex MSG-125 req 4 + finding 5"arm-before-fund"）

**核心纪律：钱包此刻仍是 §3.6 建号时的零余额状态。以下两项验证必须在这个零余额窗口内全过，才允许进 §4.4 充值。** 这样即便验证过程本身出岔子（诊断端点 bug、隔离检查漏配），暴露的钱包里也没有真钱可偷——这是本次重排的核心动机（Codex：C 项的"充值前证明"和 E 项的"结构性隔离"只有排在充值之前才真正起到"先证/先隔离"的作用，排在充值之后就只是"亡羊补牢"）。

- [ ] **C 诊断**：🔴 v0.16 更正（Codex MSG-126 P1，诊断端点鉴权已收窄，不再挂 shared ingest secret）——`GET /api/tg-wallet/<pilot tg_user_id>/diagnose`，带三个 header/前置条件：`ADMIN_DIAGNOSE_ENABLED=1`（激活前显式开，用完记得关，非常驻端点）+ `x-kanet-admin-secret: <ADMIN_SECRET_PILOT_DIAGNOSE 值>`（独立 operator 级凭据，非 ingest secret）+ 从 `ADMIN_IP_ALLOWLIST` 允许的来源发起（默认 loopback）。`ok:true` 且返回的 `address` 与 §3.5 Owner 批准的候选地址逐字符一致，才算过。**这是充值前对"live Console 能真解密这行"的权威证明**（`§3.6` helper 自己的 readback 验证只是内部一致性，key 指纹人工核对只是早期 sanity check，均不能替代这一步；§4.5 那笔真转账是充值后的**又一道**独立验证，不是"本节不算数、等那边才算"）。若不一致或诊断本身报错——**停止激活**，不进 §4.4，回查是不是 canonical DB 路径/`CONSOLE_ENCRYPTION_KEY` 跟 helper 写入时用的不是同一个
- [ ] **E 隔离验证**：构造一次真实请求，持合法 `x-ingest-secret` + pilot `tg_user_id` 直接打 `POST /api/tg-wallet/<pilot tg_user_id>/send`（金额随意，反正没钱可转，这本身就是攻击场景复现）——**必须收到 403**（`tg-wallet.js` 经 `pilot-wallet-policy.js` 的 `isLegacySendAllowed()` 判定，`access_mode!=='normal'` 即拒——v0.16 起是共享策略 helper，非各自写字面量比较）。这是激活当次的**真实攻击验证**，不是引用 regression 测试报告了事——regression 证的是"这段代码逻辑对"，这一步证的是"这次激活里，这一行确实被正确标记+这条隔离确实在生效"
- [ ] 两项都过，记入收据（新增字段：诊断结果+隔离验证结果+时间戳）——**任一没过，禁止进 §4.4**

## 4.4. 充值（🔴 v0.15 新增，原 §3.6 的充值步骤移到这里，此刻已过 §4.3 验证闸）

- [ ] 用 §3.6 建好的地址充值 **恰好 50 KAS**（不多充——多充=硬止损形同虚设）
- [ ] 充值后用 relay 只读命令 `get_address_utxos`（`relay.mjs:1189`，接受任意地址参数）查该地址链上余额，确认 = 50 KAS（**不是** `GET /api/relay/:id/balance`，那个查的是 relay 自身身份钱包）
- [ ] 收据模板 §(c') 四值一致证明在充值后再做一次（§3.6 已做过一次地址层面的核对，本次补上余额=50 KAS 这个新增事实）

## 4.5. Owner 授权后真 live 冒烟（🔴 v0.4 新增，Codex MSG-121 MUST-FIX 2 要求，G4 隔离测试之外的独立验证层；🔴 v0.15：本节现在排在 §4.4 充值之后，序列不变，只是前面多了 §4.3 验证闸）

G4（§4 步骤 4）证明的是"授权逻辑写对了"，不证明"真实部署环境配对了"。两者是不同的验证层，缺一不可：

- [ ] Owner 显式授权后（🔴 v0.5 更正：真正不可逆的窗口打开点是 §3.5 的 arm 授权，本节是**第二道独立**的 Owner 授权检查点——针对"现在发这笔真实测试转账"本身，不是 arm 闸本身；v0.4 曾把这句话误写成"不可逆动作前的最后一步"，暗示只有这一道检查点，已更正，见 §3.5）
- [ ] 用真实 console（非 G4 的隔离 relay 子进程）+ 真实 grant（provision 脚本正式签发的那份，非 harness 临时生成）+ 真实 custodial 钱包（§4.4 充值的那个）跑一笔真实、最小额的 custodial_transfer
- [ ] 记录真实 txId 进本次激活的收据（`docs/2026-07-24-m0c-1-pilot-activation-receipt-template.md`，新增字段：live 冒烟 txId + 时间戳）
- [ ] 确认链上落地（`checkUtxoLanded` 或等价方式），非仅看 API 返回 `ok:true`
- [ ] 🔴 v0.16 更正（Codex MSG-126 P2，v0.14 这句"唯一权威、最终"的措辞跟 §4.3 矛盾，已收窄）：这笔真实转账的成功，是**充值之后**对"live Console 确实用同一个 DB、同一把 `CONSOLE_ENCRYPTION_KEY` 解密了这一行"的**又一次**验证（`capability.js` 的 `deriveCustodialExecFields` 内部必须真的 `decrypt(mnemonic_encrypted)` 拿到 mnemonic 才能派生出 privkey 发起转账，DB/key 不对会在这步失败非伪装成功）——**但充值前的权威证明是 §4.3 的 C 诊断**（`GET /:tg_user_id/diagnose`），本节不是"唯一/最终"依据，是 arm 后、真实业务路径上的**另一道**独立验证，跟 §4.3 是同一类证明的两次不同时间点独立发生，不是"§4.3 不算数，等这里才算数"

## 5. 已知缺口（诚实标，非 blocker，跟踪）

- `armReport()`（`authorize.mjs` 里那个函数本身）目前仍无独立 IPC 命令/health endpoint 接线（NWT 09:22 抓出的观察性 follow-up，v0.4 更正：§4 现有 `get_arm_status` 走的是 §2.7 网关互查通道，跟这条不是同一件事——健康探针专用接线仍未做）——接线是后续硬化项，归我 operator/健康探针域，非本次 pilot 激活阻塞项。
- §2.7 gateway→relay armed 状态互查已实现（`18e738bf`），**但有理论 TOCTOU 窗口**（check 与 forward 是两次独立 IPC，不是原子操作）——诚实标，主防线仍是 §1 两 flag 原子开启顺序。

## 6. 回退路径

同今晨验证过的路径：删 `kanet.env` 两行（`ADMIN_CAPABILITY_GATEWAY_ENABLED`/`ADMIN_M0C1_GATE_ARMED`）（或注释掉）→ 重启 → armed=off 全 inert，网关 503。**必须两行一起删/两行一起留**，不留中间态。

🔴 v0.16 更正（Codex MSG-126 P2，v0.13 这句话在 v0.15 durable 列上线后已过期）：**`PILOT_WALLET_ADDRESSES` 不属于这次回退动作**，但语义已随 v0.15 变化——v0.13 写的时候这个 env 是隔离的唯一判据，删了 = legacy `/send` 重新对 pilot 钱包开放；**v0.15 之后不再是这样**：权威判据是 `tg_custodial_wallets.access_mode='capability_only'` 这个 durable 列（§3.6 建号时写死），删这个 env **不会**重新打开 legacy 路径（durable 列独立生效，跟 env 存在与否无关，见 `tg-wallet-pilot-isolation-regression.mjs` ⑥⑦ 两条 env-unset/畸形场景实测）。删这个 env 仍然**不建议**——它是 defense-in-depth 早拒层，删了少一层"更早、更省事"的防线，但不再是"删了就 fail-open"的危险动作。只要 `tg_custodial_wallets` 表里 pilot 那一行还有余额，这个 env 建议保留，直到 §(f) 走完吊销+确认钱包余额清零之后再考虑一并清理。

---

**关联**: `docs/2026-07-23-m0c-1-path-b-pilot-containment-design.md`（围栏设计权威）、`docs/2026-07-23-m0c-1-mechanism-a-http-capability-gateway-design.md`（机制A 母设计）、memory `feedback-arming-gate-app-tag-without-envelope-breaks-second-family`、`reference-fail-closed-gate-arming-blast-radius-transitional-tag`。
