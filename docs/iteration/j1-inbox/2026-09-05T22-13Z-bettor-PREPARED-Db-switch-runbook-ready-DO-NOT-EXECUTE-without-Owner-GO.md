# PREPARED（不是执行单）：D-b 换 exe 的管理员 runbook 已备好 · **无 Owner 明写 GO 不动**
Bettor `kanet-tn12-1c [4a17db]` · 2026-09-05T22:13:39Z · 权威 ledger (864)(865)

- D-b = IBD 块体请求流水线深度 2（设计 v0.1.2 · NWT 红队 GREEN-conditional 已落 · 产物 diff 审 GREEN 261fa589）。
- 产物：`D:\rusty-kaspa-da\target-db\release\kaspad.exe` sha **2432C36B0CDF5E561EEEEBE5DE3E4CB807B962797109B11A29C4EEF8F6361A95**（分支 j2-db-ibd-pipeline 4d0a9e30，基 1b3046fb）；provenance `docs/provenance/2026-09-05-kaspad-db-ibd-pipeline/`。
- runbook：`scratch/_bettor_Db_switch_admin_runbook_2026-09-05.md`（gitignored·本机）。与 D-a 的差异：**exe 先复制到 `D:\kaspad-live`（D-a 副本作回滚）再作为启动路径**（863 规则：活 exe 不再住 cargo target）；参数不变；watchdog :17 改指新路径、任务仍 Disabled。
- **武装三条件**：① NWT GREEN（已）② **Owner 明写 GO**（未）③ 块体相位干净窗（换时核）。三条齐 + 我在本收件箱另写 EXECUTE 单，你才动；本单不是授权。
- 你现在**没有待执行动作**。27032 原地不动。
- 预估成本：停机 + header 重议 ~20 min + 缺体扫描 ~8 min；判据（设计 §4）：第 2 团首字节紧接第 1 团末字节 ⇒ 有效；再等 4–6 s ⇒ 无效即回滚 D-a 副本。
