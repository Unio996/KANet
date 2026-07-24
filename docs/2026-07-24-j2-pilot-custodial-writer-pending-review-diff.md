# J2 reviewed helper(m0c1-pilot-custodial-writer 新 capability) 待审 diff（2026-07-24）

跨节点传递用临时文件，审完随本次 manifest 更新一起删除。**⚠ 密钥经手场景，M0a 第五种 capability 扩张动作，全程走完整 pending-review，不自批。**

## 变更文件
1. `scripts/m0a-lib.mjs` — 新增 `m0c1-pilot-custodial-writer` capability（Bettor 裁定选②新窄 capability，非扩张 provision-writer），照 provision-writer 四约束模型对称实现。
2. `scripts/m0a-exception-manifest.json` — `_doc` 更新 + 两条新 entries（`PCW-pilot-custodial-insert` / `TF-pilot-custodial-insert-regression`）。
3. `kasia-console/scripts/m0c1-pilot-custodial-insert.mjs`（新文件）— MF2 步骤4 reviewed helper 本体。
4. `kasia-console/test-framework/cases/m0c1-gate/pilot-custodial-insert-regression.mjs`（新文件）— regression 证据 artifact。

## content_digest
```
kasia-console/scripts/m0c1-pilot-custodial-insert.mjs = 2760dcbaf1bf0ac14214cdf3074b9325e9352255e9f5b365b05ca9576491e01f
```

## 背景

`docs/2026-07-23-m0c-1-pilot-activation-runbook.md` §3.6（Owner go 后）需要一个 reviewed 路径做候选 mnemonic 的 encrypt+insert，取代 operator 手搓裸 SQL（MF2 步骤4明禁）。设计过程见 `scratch/j2-reviewed-helper-design.txt`（完整9步设计，Bettor+NWT+KANet-UI 三人红队已 GREEN 批落码，落码前 4 条 refinement 已全部纳入：①去掉没有消费方的装饰性 Buffer，纯 string+丢引用+如实标注 JS 语言限制②readback 用同一 better-sqlite3 连接避免 WAL 可见性延迟误判③--network 硬 required④--db 默认目标即生产 console.db 三处显式标注）。

## M0a 治理动作（需要你重点核）

裸 `better-sqlite3` import 碰到 M0a 边界：既有 `m0c1-provision-writer` capability 语义专锚 `m0c1_app_grants`（grant registry）写权威，我这个 helper 写的是 `tg_custodial_wallets`（不同表/不同写权威），不该混进同一 capability 名字。Bettor 裁定（选②）：新开窄 capability `m0c1-pilot-custodial-writer`，照 provision-writer 四约束模型对称实现（白名单单文件 shrink-only + content_digest TOCTOU 锚 + writer 静态负面检查[禁 relay-manager/网络面] + NWT diff 审）。Owner 已知情报备（M0a 规则"扩张走 NWT 审+Owner 知情"）。

请重点核：`scripts/m0a-lib.mjs` 里 `PILOT_CUSTODIAL_WRITER_CAP` 代码块是否跟 `PROVISION_WRITER_CAP` 那段真对称（同样四层检查：family=sqlite / 白名单命中 / content_digest 匹配 / relay-manager+网络面静态负面检查），没有偷工减料或引入跟 provision-writer 不一致的漏洞。

## 9 步设计 + no-key-leak

见 `scratch/j2-reviewed-helper-design.txt` 完整版（已经过三人红队）。核心：mnemonic 只从 stdin 读（绝不进 CLI 参数/shell history/ps），insert 前先 derive-compare（提早止损），insert 后同连接 readback 再验（Codex 字面要求，跟 insert 前是两层不同验证目标），readback 失败 DELETE 自愈 + CRITICAL，全程 log 只含 tg_user_id/address(公开信息)/PASS-FAIL 状态，绝不 log mnemonic 本身。

## 测试结果

真实调用 CLI（spawnSync + stdin 管道喂入非真实测试用 mnemonic，非 mock）：13/13 PASS（①候选匹配正常插入+readback PASS+独立解密核对②候选不匹配 abort 不写库③占位符拒绝④重复拒绝+TAINT exact-secret 扫描零 64-hex 命中）。既有回归 26/2 零新增 + G4 27/27 零回归 + provision-payee-regression 13/13 零回归 + lint 0 errors（4 文件一起过）。

## 请求
NWT 独立核实（密钥经手，格外仔细）：① `m0a-lib.mjs` 新 capability 代码块跟 provision-writer 真对称；② digest 一致；③ helper 9 步设计真落码（尤其⑦同连接 readback、⑨去 Buffer 后的诚实标注）；④ regression test 真实调用非 mock；⑤ 给 `review_ref`。
