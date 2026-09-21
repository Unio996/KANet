# NWT 第二轮(最后一轮):F3/F4 设计稿 v0.2 @56efccde —— 只核 M1–M4 是否落实

**结论:M2、M3、M4 落实(M4 附一处精度修正);M1 大部分落实,点名一处未落实(一句规格 + 一条突变)。不开新面。** 补上那一处后通过。

| MUST | 状态 | 依据(v0.2 章节) |
|---|---|---|
| M1 check+reserve 同步一步 + 共享函数 + HTTP 入口 | **未完全落实**(见下) | E8 补了 HTTP 入口(`api/proto.js:194-197/:297-300`)✓;`selectAndReserveFeeUtxo` 包住 E3、三处调用点 + lint `R-FEE-SELECT-ONLY-VIA-WRAPPER` ✓;"检查→选中→记入在最后一个 await 之后同一同步段"✓(builder 确为同步:`({feeUtxo,built} = selectFeeUtxoByConstruction(...))` 直接解构);T-race-interleave 含 HTTP×driver 形状 + "拆成两个 await 段"突变 ✓ |
| M2 不确定结果的释放规则 | 落实 | §3.2-B.2 三类结局(确定性成功/失败/**不确定=保持预留+≥2×IPC 超时的有界期限→先对账再释放**);明写"不允许立即释放、不允许永不释放";泄漏遥测;T-timeout-late-prepared / T-timeout-never-written 各带突变(立即释放→(a)红;永不释放→(b)红);T-leak-telemetry |
| M3 DB 派生层坏行 fail-closed | 落实 | §3.2-B.1:字节缺失/JSON 损坏/反序列化抛错 ⇒ 本次选择 HOLD + 新报警名(登记 SETTLEMENT_ALERTS),不跳过;T-corrupt-row + 突变(HOLD→跳过 红);`skippedInflightOutputs`/`skippedReservedInputs` 拆开计数 ✓ |
| M4 parity 对象 | 落实,附精度修正 | §3.3:一致性对象 = 安全资格维度,`feeMin` 是每路径显式声明的参数、不参与一致判定,"禁止为让测试变绿把 feeMin 拉齐"✓;弱注入臂保留 ✓ |

## M1 未落实的一处(补一句 + 一条突变即可)
v0.2 §3.2-A 写 `selectAndReserveFeeUtxo({ candidates, reserved, tryBuild, … })`,B.1 写"`reservedFeeOutpoints({db})` … 填进 E5 的 `inflightOutpoints`"。E5 的值在结算路径是在 `prepare('inputs')` 里算的,**早于**随后的取数 await(`verifyStepInputsOnChain`)。稿没写 **DB 派生集必须在那个同步段内重读**,而不是用 prepare 时的快照。缺了这一句,会留一个窗口:
1. A 在 t0 算 DB 派生集(此时 D 尚无 prepared 行)→ 进入取数 await;
2. D 在 A 等待期间选中同一 UTXO、写 prepared 回执(DB 已有字节),随即按 M2 规则**从内存层移除**(DB 层接管);
3. A 醒来:手里是 t0 的旧 DB 快照(无 D)+ 内存层(D 已移除)⇒ 选中 D 的 UTXO ⇒ 复现 A 臂 `inputs_spent`。
**需要补的**:① 一句规格——"`reservedFeeOutpoints` 在同步段内现读,不接受调用方预算好的快照(`reserved` 形参是活句柄/读取函数,不是 Set)";② 一条突变——"DB 派生集改用 await 之前的快照 ⇒ T-race-interleave(driver×driver 与 HTTP×driver 两形状)红"(该形状要让 D 在 A 的取数 await 期间**完成 prepared 落库并释放内存层**,才测得到这个窗口;只让 D 停在"选中未 prepared"测不到)。

## M4 的一处精度修正(不阻塞,并入同一次 v0.2.1)
§3.3 让四条路径对"**被预留 / 被 relay 拒过**"给同一判定。第四条(relay split)在 relay 包内,**看不到** console 的预留集与拒绝表,这两个维度对它无定义。请写明:被预留/被拒过只对三条 console 路径(结算/创世/下注)要求一致;split 只对 covenant 绑定 / spk 版本 / spk≠relay / unknown facts / 超 ceiling 要求一致。否则该路径的向量期望无法书写。

## 不再开新面
其余(§3.7 非 MUST 各一句、§4 状态、`submit_intents` 标 UNVERIFIED)与我上一轮的记录一致,无异议。v0.2.1 补完两处(M1 一句+一突变、M4 一句)即可视为通过;仍排在驱动退款路之后实现。
