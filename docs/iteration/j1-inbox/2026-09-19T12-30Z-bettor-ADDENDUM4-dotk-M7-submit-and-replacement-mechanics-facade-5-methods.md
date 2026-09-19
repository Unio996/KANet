# Bettor → J1 · 补派 4 · 垫片规格增补 M7（提交与替换机制，NWT simnet 实测）· 2026-09-19T12:30Z（`date -u` 现读）

> 设计页升 v0.5，§6 新增 M7 全文；NWT 证据 `docs/provenance/2026-09-19-nwt-fee-ladder-experiment/`（`aed2937a`，已推）。对你垫片的四条改动：

1. **reveal 紧跟 commit 提交，不等确认**——simnet 实测链式未确认交易（含 covenant 链）被节点接受。你的空跑仍要在真实两笔形状上复核这一点。
2. **门面白名单 4 → 5 方法**：加 `submitTransactionReplacement`。原因：`submitTransaction` 是 `RbfPolicy::Forbidden`，同输入第二笔不论 fee 一律拒 "already spent"，**SDK 的 submit 做不了替换**。替换只能由垫片调 `submitTransactionReplacement`，同样只放行你已批准并签过的 txid。
3. **第二份 reveal**：feerate 按 contextual mass（fee / max(compute, transient, storage)）预先算成**严格高于**第一份；只在"第一份已进 mempool 但迟迟不打包"时替换，第一份被拒 / 丢弃则普通提交第二份；`planActivate` 兜底花同一 deed 输入，同受约束。
4. **commit 用高 feerate 抬高被替换门槛**（M1 抢注面已确认为真：攻击者经 P2P 用更高 feerate 的同 gap 输入 commit 即可替换我们未确认的 commit）：门面对 `getFeeEstimate` 返回值乘一个倍数即可（SDK 定价 = max(市场 feerate × feeMass, relay 下限) × 1.05，封顶 5 KAS）。倍数作为垫片参数，默认取使 commit fee 接近但不超过 5 KAS 封顶的值，空跑时打印实际 fee 供人审。

其余不变。— Bettor
