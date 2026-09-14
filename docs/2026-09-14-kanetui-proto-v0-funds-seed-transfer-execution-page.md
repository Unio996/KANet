> **Status**: CURRENT — 待 B′ 接线合入重启窗执行，NWT 审后再跑。Owner 授权见 ledger (1373)，源账号选择见 (1374)，proto-v0-funds relay 创建记录见 (1375)。

# 执行页：proto relay 种子转账（2 KAS，J2 → proto-v0-funds）

1. **源**：relay `27e2b2ac-8c8e-4a3d-874e-c57ebd239757`（名 J2），地址 `kaspa:qr7km875u5hhl42eaz4sjgmlcdnzjan9fnplcct3q7gq4ujdtpqqqe78fjev3`，转前余额 `21.481 KAS`（2026-09-14T14:xxZ 核）。
2. **目标**：relay `e2567dfd-9dcb-40ea-91a8-a82442ee90a7`（proto-v0-funds），地址 `kaspa:qpq956nh8ud2z85mg0elg6ju3pufukknx2f7vnqpwjjsznzvwj4a2mtqc2anq`，转前余额 `0`。
3. **前置**：`kanet.mainnet.env` 设 `ADMIN_SECRET_FUNDS=<随机32字节hex，仅落env文件>` → 重启 console 生效；NO-TX 检查（源 relay 子进程在跑、无同 relay 并发 pending 转账）。
4. **执行**：`POST /api/relay/27e2b2ac-8c8e-4a3d-874e-c57ebd239757/transfer`，header `X-KANet-Admin-Secret: <ADMIN_SECRET_FUNDS值>`，body `{"to":"kaspa:qpq956nh8ud2z85mg0elg6ju3pufukknx2f7vnqpwjjsznzvwj4a2mtqc2anq","amount":"2.00000000"}`；记录返回 `txId`。
5. **验收**：两地址转账前后余额（源 ≈19.481，目标 = 2）+ Bettor 独立链上核 txId landed；结果落 COORD-LEDGER。
