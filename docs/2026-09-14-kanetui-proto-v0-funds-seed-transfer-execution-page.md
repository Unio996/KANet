> **Status**: CURRENT（v0.4）— 待 B′ 接线合入重启窗执行，NWT 审三轮（③顺序拆分 + 3b 第4项期望值更正 + 第4步拆四笔，见下），改完即闭不再二审。Owner 授权见 ledger (1373)，源账号选择见 (1374)，proto-v0-funds relay 创建记录见 (1375)。v0.2 理由（NWT）：这次重启窗同时带 B′ 接线笔=环境第一次真走私钥解密+签名路径，"新签名路径首次被真实调用"不能和"真实花钱"叠在同一步，六项读数必须在花钱前显式跑完、任一未过不进下一步。v0.3 理由（NWT）：3a 已设好 `ADMIN_SECRET_FUNDS` 并重启，到 3b 检查点时资金路由不带 header **应为 403**（闸已启用、钥匙不对），**若仍 503 = env 没生效（key 名写错/重启没读新 env）= 真正的失败信号**——v0.2 误写成"503"会把这个失败当通过划勾，故更正。v0.4 理由（Bettor，账本 1386/1388）：fee cap 设计变更后 relay 签名输入上限 = 1.0 KAS，一个 2 KAS 的 UTXO 当手续费输入会因面值超限被拒，原型期不做自拆分逻辑 ⇒ 改成源头就转 4 笔各 0.5 KAS，总额仍是 Owner 授权的 2 KAS。

# 执行页：proto relay 种子转账（2 KAS，J2 → proto-v0-funds）

1. **源**：relay `27e2b2ac-8c8e-4a3d-874e-c57ebd239757`（名 J2），地址 `kaspa:qr7km875u5hhl42eaz4sjgmlcdnzjan9fnplcct3q7gq4ujdtpqqqe78fjev3`，转前余额 `21.481 KAS`（2026-09-14T14:xxZ 核）。
2. **目标**：relay `e2567dfd-9dcb-40ea-91a8-a82442ee90a7`（proto-v0-funds），地址 `kaspa:qpq956nh8ud2z85mg0elg6ju3pufukknx2f7vnqpwjjsznzvwj4a2mtqc2anq`，转前余额 `0`。
3. **前置（v0.2 三段，逐段闸，任一未过不进下一段）**：
   - **3a**：`kanet.mainnet.env` 设 `ADMIN_SECRET_FUNDS=<随机32字节hex，仅落env文件，不进聊天/账本>` → 重启 console。
   - **3b 硬闸（重启后逐条打勾，NWT 部署后核 GREEN 回执号方可进 3c）**：
     - [ ] `[silverc-pin] PASS` 恰 1 行
     - [ ] `WARMUP FAIL` 0 行
     - [ ] 参考值 `WARN` 0 行
     - [ ] 18 个 relay 全部 connected（含 proto-v0-funds）
     - [ ] **7 条资金路由**（`/api/relay/:id/transfer`、`/api/chat/local`、`/api/prediction/publish-v2`、`/api/prediction/taker-stake/:offer_id`、`/api/prediction/refund/:offer_id`、`/api/pool/market/:id/oracle/deposit`、`/api/pool/market/:id/bettor/register`，清单同 `t-loopback-authz-funds-hotfix.test.mjs`）不带 header / 带错 header → **403**（闸已启用、钥匙不对；若仍 503 = `ADMIN_SECRET_FUNDS` 没生效，视为本项 FAIL）
     - [ ] **正向探针**：`POST /api/relay/27e2b2ac-8c8e-4a3d-874e-c57ebd239757/transfer` 带正确 header、body 留空 → **400**「Recipient address (to) is required」——证明密钥真被读进去且放行到原有校验，**本探针不发任何真实转账**
     - [ ] 敏感路由（`GET /relays/:id/mnemonic`、`GET /api/relay/:id/wallets/:walletId/privkey`，走 `checkKeyExportWindow` 独立机制）→ 503；`/api/system/run`、`/api/system/download`（`ADMIN_SECRET_SYSTEM_ACTIONS` 未设）→ 503；`/skills/upload` → 404
     - [ ] 五屏（`/tokens` `/tokens/create` `/proto-markets` `/proto-markets/create` `/proto-markets/:id`）均 200
     - [ ] stderr 尾部零 `FATAL`
     - [ ] NWT 部署后核 GREEN，回执号：______
   - **3c**：NO-TX 检查（源 relay `27e2b2ac...` 子进程在跑、无同 relay 并发 pending 转账）。
4. **执行（v0.4：拆 4 笔各 0.5 KAS，非一笔 2 KAS）**：relay 签名输入面值上限 1.0 KAS（1386/1388），2 KAS 单笔会因输入超限被拒。循环 4 次，**每次都等上一笔 landed 再发下一笔**（NO-TX-NO-STATE，避免同 relay 并发 pending）：
   `POST /api/relay/27e2b2ac-8c8e-4a3d-874e-c57ebd239757/transfer`，header `X-KANet-Admin-Secret: <ADMIN_SECRET_FUNDS值>`，body `{"to":"kaspa:qpq956nh8ud2z85mg0elg6ju3pufukknx2f7vnqpwjjsznzvwj4a2mtqc2anq","amount":"0.50000000"}` × 4；每笔记录返回 `txId`，landed 后再发下一笔。四笔分别对应原型 genesis / bet 步骤A / bet 步骤B 各自要用的 UTXO。
5. **验收**：目标地址链上应见 **4 个独立 UTXO 各 0.5 KAS**（非合并成一个 2 KAS UTXO）；源余额减 2 KAS + 4 笔手续费；四个 `txId` 均 landed（Bettor 独立链上核）；结果落 COORD-LEDGER。
