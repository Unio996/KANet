# 电报 DM 托管 Kaspa 钱包 + broker 集成 — 设计方案 (KANet-UI lead)

> Owner 钦定·紧急 (2026-06-23 10:52, Bettor 转): 电报 DM 生成钱包→领币→下注, 门槛降到零。
> 本方案待 **Bettor 审** (Owner: 设计方案让 bettor 审一下), 通过后实现。

## 目标
DM 里零门槛玩: 无钱包 → 点"生成新钱包" → /faucet 领 10k → /bet 下注。全程不跳网页。

## ⚠ 核心取舍 (Bettor 必拍的口径)
现有 tg-bot 是 **0-key / 0-custody** (J1 S5: bot 不持 key、不碰用户钱)。本需求 = **托管钱包**(节点持加密助记词、节点代签转账) → **主动打破 0-custody**。Owner 钦定为零门槛 UX, mitigation = **测试网 only + 醒目"真钱用自己钱包"警告**(唯一 mitigation, 守住口径)。**这是本方案最大的安全语义变更, 请 Bettor 先拍这条**。

## 架构 (复用现有原语, 不重造)
1. **钱包生成**: kaspa-wasm `Mnemonic.random()` 生成 BIP39 助记词 → `addressFromMnemonic(mnemonic, 'testnet-12')`(relay.js:70 现成)派生地址。
2. **加密落库**: 助记词 `crypto.encrypt()`(aes-256-gcm, CONSOLE_ENCRYPTION_KEY, 同 bot token/relay mnemonic 那套) → 存新表。**绝不明文存 sqlite、绝不外回 API**。
3. **新表 `tg_custodial_wallets`** (migrate vNNN):
   - `tg_user_id` PK / `kaspa_address` UNIQUE / `mnemonic_encrypted` TEXT / `created_at` / `faucet_total_kas` / `last_faucet_at`
4. **签名/转账**: 节点用解密助记词派生 privkey 签转账 tx (托管)。复用 relay 钱包的 transfer 路 (relay.js wallets/withdraw/send 已有 KAS 转账签名+广播)。

## bot 命令 (tg-bot/bot.mjs)
- `/wallet` — 无钱包→生成(助记词**显示一次**+醒目警告备份)、有→显地址+余额+收款。
- `/balance` — 查余额 (RPC/relay balance)。
- `/receive` — 显地址收款 (+ 可选二维码文本)。
- `/send <addr> <amount>` — 转账 **二次确认**(显 to+amount→/confirm 才发, 防误转)。
- `/export` — 再次揭示助记词 (重警告, 仅自己 DM)。
- 钱包地址自动 `/link` → 现有 /bet /broker /earnings /faucet 直接可用 (= ④ broker 集成最小落地: 托管地址即用户身份)。

## faucet 5→10k + 双层限流 (防 Sybil, NWT 红队)
- `FAUCET_AMOUNT_KAS=10000` (env)。
- **per-TG-user 冷却**(现有 bot faucetCooldown 24h) + **per-地址 once**(现有 faucet_grants.wallet_address) + **新增全局日上限**(faucet_grants 当日 SUM(amount) ≥ GLOBAL_DAILY_CAP 则拒, 防 N 个 TG 账号×10k 薅干)。可选 TG 账号年龄启发式 (后续)。
- FaucetRelay 余额够 (查; 10k×N 需 treasury 充足, 全局上限护住)。

## 安全护栏 (Bettor + NWT, 全守)
1. 助记词 aes-256-gcm at rest, 不外回 ✓ 2. 生成时显示一次+醒目警告 ✓ 3. faucet 双层+全局上限防 Sybil ✓ 4. 转账二次确认 ✓ 5. 托管=节点持私钥风险, "真钱用自己钱包"警告是唯一 mitigation, 测试网 only ✓

## 待 Bettor 审的点
1. **0-custody→托管的语义变更** (最大): 接受吗? 还是要 non-custodial 折中(只 deep-link 用户自己签, 但那不满足 Owner "DM 里生成")? Owner 已钦定托管, 确认守口径即可。
2. 全局 faucet 日上限数值 (建议?), treasury 余额够不够 10k×预期用户。
3. 转账签名走 relay wallet 路 vs 新签名 helper — 复用哪个最稳。
4. broker 集成 ④ 范围: 最小=托管地址自动 link 即用现有 broker 流; 还是要更深?
