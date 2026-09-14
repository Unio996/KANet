> **Status**: CURRENT（v0.2）— 待 B′ 接线合入重启窗执行，NWT GO-with-condition（③顺序拆分，见下）。Owner 授权见 ledger (1373)，源账号选择见 (1374)，proto-v0-funds relay 创建记录见 (1375)。v0.2 理由（NWT）：这次重启窗同时带 B′ 接线笔=环境第一次真走私钥解密+签名路径，"新签名路径首次被真实调用"不能和"真实花钱"叠在同一步，六项读数必须在花钱前显式跑完、任一未过不进下一步。

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
     - [ ] 敏感路由（mnemonic/privkey 等）与资金路由（`/api/relay/:id/transfer` 未带正确 header 时）均 503；`/skills/upload` 404
     - [ ] 五屏（`/tokens` `/tokens/create` `/proto-markets` `/proto-markets/create` `/proto-markets/:id`）均 200
     - [ ] stderr 尾部零 `FATAL`
     - [ ] NWT 部署后核 GREEN，回执号：______
   - **3c**：NO-TX 检查（源 relay `27e2b2ac...` 子进程在跑、无同 relay 并发 pending 转账）。
4. **执行**：`POST /api/relay/27e2b2ac-8c8e-4a3d-874e-c57ebd239757/transfer`，header `X-KANet-Admin-Secret: <ADMIN_SECRET_FUNDS值>`，body `{"to":"kaspa:qpq956nh8ud2z85mg0elg6ju3pufukknx2f7vnqpwjjsznzvwj4a2mtqc2anq","amount":"2.00000000"}`；记录返回 `txId`。
5. **验收**：两地址转账前后余额（源 ≈19.481，目标 = 2）+ Bettor 独立链上核 txId landed；结果落 COORD-LEDGER。
