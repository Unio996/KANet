# NWT 红队 — B线落3 设计(notify 层泛化+package 抽离+demo, ed050fca)

> **Status**: CURRENT
> **对象**: docs/2026-07-12-fee-split-phase3-package-notify-design.md(J2)
> **verdict**: **GREEN-with-notes——边界正确(feeSplit 纯函数不动/notify 复用既有蓝本非新造订阅);G1(sync drift)/G2(landed-proof 边界未警示)折入设计后落码 GO**

---

## 边界核实(spec v1.3 铁律 + Owner"复用接通"硬约束)

- **feeSplit() 零触碰**:落3 只加 notify.mjs 两个新函数,fee-split.mjs 本体不改一行——③好用层 NWT 边界修正(推送不进纯函数体)在设计层持续持有,非本轮重新论证。
- **非新造订阅**:J2 自查确认(06:16)notify 层不建新轮询/订阅机制,复用既有 broker-fee-emit 式 tick 的落链事件轮询+幂等管线——我读既有 `broker-fee-emit.mjs` 核实其蓝本形状(UNIQUE(txid,event_type)+INSERT OR IGNORE 幂等/kaspa_tx_log.outputs_json 取真金额),泛化后的 matchLandedFeeOutputs/emitLandedNotification 只是把"只认 broker 地址"的硬编码换成"任意角色地址",机制骨架未变。符合 Owner"复用接通,不重造"硬约束。
- **单源策略**:packages/fee-split/fee-split.mjs 是构建产物非独立实现,kasia-console/src/lib/fee-split.mjs 保持唯一源——防两份维护家族病(D-008/落2 同一铁律),方向对。

## G1 🟡 note(落码前必答,同规则55 手工配对家族): sync 机制"手动跑"= drift 面

§2.2 选定方案②(fs.copyFileSync 构建脚本,"prepublish/手动跑")。**"手动跑"正是本组件自己刚撞过的坑同族**——落1 的 F1(未知字段 commit 碰撞)已经在 `lib/fee-split.mjs` 修过一次(commit `7dfbe9ea`),若 sync 脚本不是机制强制触发,`packages/fee-split/fee-split.mjs` 完全可能停在 F1 修复前的旧快照被打包分发给第三方——**给外部集成者一份已知有漏洞的历史版本**,比"没做这个包"更糟(带着虚假的"官方组件"信任标签)。

**修法(落码时选一,不留手动)**:
- 最简:lint-kanet.mjs 加一条规则,diff 涉及 `kasia-console/src/lib/fee-split.mjs` 但同 commit 未同步更新 `packages/fee-split/fee-split.mjs` → WARN(同 R-FEERULES-CANON-BYPASS 模式,已有先例可抄);
- 或:sync 脚本产出文件顶部嵌入源文件的 git blob hash / 内容 hash,`node scripts/verify-fee-split-sync.mjs` 校验两文件语义一致,纳入 pre-commit(参考已有 lint-kanet pre-commit 钩子模式)。
两者都是"机制不给忘记的机会"而非"记得跑",与本组件自己 spec v1.2-2 的"单一共享函数非各自实现"精神一致。

## G2 🟡 note(README/notify.mjs docstring 必写,面向③好用层的第三方安全): landed-proof 边界未警示

`matchLandedFeeOutputs(outputs, feeLeaves)` 设计明确"outputs 由调用方从链读到"——**这个边界划分本身正确**(package 零链依赖,garbage-in-garbage-out 合理),但**没有一处文档警示这个边界的风险**:KANet 自己在 memory 里记了多条"kaspa_tx_log 命中 ≠ canonical / landed 浅确认 / mempool-accepted 非终审"的教训(28mln/lv3rz/D-010 事故链),这些是 KANet 团队用真实事故换来的认知。**spec §3.2 的整个卖点是"不懂链的第三方开发者十分钟跑通"**——这类开发者恰恰不知道"output 出现在一次 RPC 查询里 ≠ 这笔钱真的落地不会被 reorg 撤销"这个坑,如果天真地把 mempool-seen 或单次浅确认的 output 列表喂给 `matchLandedFeeOutputs`,会产出**假的 landed 通知**(通知用户"你收到钱了"但链上可能还没终审)。

**修法**:README §2.4(trustless 前提)旁边加一条**"landed 前提"**——明确写"`outputs` 参数必须是调用方已确认终审(建议深度 ≥ N 或走 confirmed UTXO set,而非 mempool-accepted 或单次 RPC 查询)的输出列表;本函数不做终审判定,信任调用方喂入的数据"。`matchLandedFeeOutputs` 的 JSDoc 同款警示一句。这是防止"组件本身没洞,但被天真集成方式误用出洞"的纵深,同精神见 `feedback-testnet-spend-bettor-decides-coin-plentiful` 一类"边界要写清楚不能靠猜"的纪律。

## 其余核点(过)

- **两 demo 零链零 DB**:prediction-demo.mjs 用的 `feeSplit`/`buildPredictionV1InterimRules` 是落1 已导出、我已红队审过的真实 API,签名对得上,无新攻击面。
- **十分钟验收方式**(找没碰过仓库的人冷启动计时跑)优于自证,我认可这个验收标准并愿意作为其中一位冷启动跑者。
- **DoD 分级合理**:kasia-console broker-fee-emit.mjs 真正切换到 package 泛化函数留 non-blocking 续卡(降低本轮 live 路径改动半径)——同落1/落2/合卡的分段策略,一致性好,不改变我对 live 路径零新增风险的判断。
- **不发 npm**:D-005 隔离精神类推,方向克制,同意。

## 结论

设计边界正确(纯函数不动/复用既有蓝本非新造订阅/单源策略)。**G1(sync 机制必须机制化非手动)+G2(landed-proof 边界必须显式警示防第三方误用)**折入设计后落码 GO——两点都是"防将来复发"的纵深,不阻塞本轮落码方向。落码 diff 到我复审:sync 机制实落(哪种方案)/README+notify.mjs 警示文案实落/两 demo 独立跑通(我可当冷启动计时验收人之一)。

— NWT 2026-07-12
