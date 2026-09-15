> **Status**: CURRENT（v0.7）— 待 B′ 接线合入重启窗执行（时机待 Owner 选路后定），NWT 审四轮（③顺序拆分 + 3b 第4项期望值更正 + 第4步拆四笔 + 第4步改三笔精确面值，见下），改完即闭不再二审；v0.6/v0.7 为 D-021 仓库公开合规改动（v0.6 移除源 relay 真实余额数字；v0.7 移除两个 kaspa: 地址——地址能把持仓与持有人对应起来，同属 D-021 第2条——改为执行时现读+核对，验收改相对表述），均非机制变更，不需再审。Owner 授权见 ledger (1373)，源账号选择见 (1374)，proto-v0-funds relay 创建记录见 (1375)。v0.2 理由（NWT）：这次重启窗同时带 B′ 接线笔=环境第一次真走私钥解密+签名路径，"新签名路径首次被真实调用"不能和"真实花钱"叠在同一步，六项读数必须在花钱前显式跑完、任一未过不进下一步。v0.3 理由（NWT）：3a 已设好 `ADMIN_SECRET_FUNDS` 并重启，到 3b 检查点时资金路由不带 header **应为 403**（闸已启用、钥匙不对），**若仍 503 = env 没生效（key 名写错/重启没读新 env）= 真正的失败信号**——v0.2 误写成"503"会把这个失败当通过划勾，故更正。v0.4 理由（Bettor，账本 1386/1388）：fee cap 设计变更后 relay 签名输入上限 = 1.0 KAS，一个 2 KAS 的 UTXO 当手续费输入会因面值超限被拒，原型期不做自拆分逻辑 ⇒ 改成源头就转 4 笔各 0.5 KAS。v0.5 理由（账本 1402，已核实源文一致）：J2 真实编译+mass 精算三个 kind 的最小面值后，下注第二步（bet_mint_step_b/register_append）required_fee ≈0.6 KAS，0.5 KAS 的 UTXO 装不下；且找零输出与 covenant 输出同受 KIP-9 p²/v storage mass 曲线约束，"找零=0 或 ≥20M sompi"才不额外吃 mass 惩罚——0.95 KAS 使找零 ≈22.5M sompi 落最优点，且 <1.0 KAS 签名输入上限不撞等号 ⇒ Bettor 定 4 笔→3 笔，面值 0.5/0.5/0.95（合计 1.95 ≤ Owner 授权 2.0），分别供 market_genesis / bet_mint_step_a / bet_mint_step_b 用。

# 执行页：proto relay 种子转账（≤2 KAS 授权内，实转 1.95 KAS，J2 → proto-v0-funds）

1. **源**：relay `27e2b2ac-8c8e-4a3d-874e-c57ebd239757`（名 J2）。
2. **目标**：relay `e2567dfd-9dcb-40ea-91a8-a82442ee90a7`（proto-v0-funds）。
   - **地址与转前余额基线均不写在本文件**（D-021：地址能把持仓与持有人对应起来）——见 gitignored `docs-private/proto-v0-funds-seed-transfer-balances.md`。执行时凭 relay UUID 走 `GET /api/relay/<uuid>` 现读地址，并与 docs-private 记录核对一致后再用于下方④的 `to` 字段。转账金额本身（0.5/0.5/0.95，合计 1.95 ≤ Owner 授权 2.0）是原型资金操作参数，不受限，可留在本文件。
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
4. **执行（v0.5：改 3 笔精确面值，非 4 笔各 0.5）**：relay 签名输入面值上限 1.0 KAS；J2 真实编译+mass 精算三个 kind 的最小面值后（账本 1402），依次转 3 笔，**每笔都等上一笔 landed 再发下一笔**（NO-TX-NO-STATE，避免同 relay 并发 pending）：
   `POST /api/relay/27e2b2ac-8c8e-4a3d-874e-c57ebd239757/transfer`，header `X-KANet-Admin-Secret: <ADMIN_SECRET_FUNDS值>`，body `{"to":"<目标 relay e2567dfd... 现读地址，见①②说明，与 docs-private 核对一致>","amount":"<面值>"}`，依次：
   - 第1笔 `amount: "0.50000000"`（供 market_genesis）
   - 第2笔 `amount: "0.50000000"`（供 bet_mint_step_a）
   - 第3笔 `amount: "0.95000000"`（供 bet_mint_step_b）
   每笔记录返回 `txId`，landed 后再发下一笔；三笔合计 1.95 KAS（≤ Owner 授权 2.0）。
5. **验收**（相对表述，不写绝对余额）：目标 relay 链上应收到 **3 个独立 UTXO**（0.5 / 0.5 / 0.95，非合并）；源 relay 余额减少额 = 转账合计（1.95 KAS）+ 3 笔手续费；三个 `txId` 均 landed（Bettor 独立链上核）；实际转前/转后绝对余额回填 `docs-private/proto-v0-funds-seed-transfer-balances.md`，不落 COORD-LEDGER；转账机制性结果（txId、UTXO 数量核对）落 COORD-LEDGER。
