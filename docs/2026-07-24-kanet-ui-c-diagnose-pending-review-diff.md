# KANet-UI · Codex MSG-125 MUST-FIX C — no-broadcast live-Console 解密诊断 pending-review diff

> **性质**: pending-review 工件（供 NWT 红队 + Owner 知情），代码在共享工作树未 committed（`git diff kasia-console/src/api/tg-wallet.js` 可直接看到实际改动）。
> **依据**: `docs/2026-07-24-m0c1-pilot-codex-msg125-rectification.md` §C（Bettor 批，refinement：`ok:true` 语义 = decrypt 成功 **且** derive 出的地址与行内 `kaspa_address` 逐字符一致，不是"decrypt 没抛异常"这么弱）。
> **用户面钱路 + 密钥经手**: 不自批，走完整 pending-review 周期。

## 洞

Codex 判：helper（`m0c1-pilot-custodial-insert.mjs`）自己 `encrypt` 自己 `decrypt` 只证明内部一致性；`currentKeyFingerprint()` 8-hex 指纹人工核对是 sanity check，不是 runtime 证明。此前唯一权威证明是 §4.5 live 冒烟——但那笔转账发生在**充值之后**。Codex 要求充值前就有办法证明"live Console 用真实运行时的 `CONSOLE_ENCRYPTION_KEY` + 真实 DB 连接"确实能解密这行。

## 改动（`kasia-console/src/api/tg-wallet.js`，working tree diff）

新增 `GET /api/tg-wallet/:tg_user_id/diagnose`（挂同款 `AUTH` preHandler）：
1. 查 `tg_custodial_wallets` 表拿 `kaspa_address`/`mnemonic_encrypted`/`network`
2. `decrypt(mnemonic_encrypted)`（用 **live 进程实际的** `process.env.CONSOLE_ENCRYPTION_KEY`，非 helper 传入的任何值）
3. `addressFromMnemonic()` 重新 derive 地址
4. `ok` = `decrypt 成功 且 derive 出的地址 === 行里存的 kaspa_address`（逐字符比对，非只判 decrypt 没抛异常）
5. 返回体**只**含 `{ ok, address }`（`address` 只在 `ok:true` 时给）——**绝不**返回/log mnemonic、privkey、`mnemonic_encrypted` 密文 blob 本身

## 测试（`tg-wallet-pilot-isolation-regression.mjs` 新增 ④⑤，working tree diff）

真 Fastify inject，14/14 PASS（原 8 + 新 6）：
- ④ 正常路径：`ok:true` + `address` 与 create 时的地址逐字符一致；回执不含 `mnemonic`/`encrypted` 字样
- ⑤ key 不一致路径：建钱包后原地轮换 `CONSOLE_ENCRYPTION_KEY`（`crypto.js` `getKey()` 每次调用现读 `process.env`，非缓存，可以这样测）→ `decrypt` 因 AES-GCM auth tag 校验失败抛异常 → `ok:false`，回执不含任何密钥材料（exact-secret 扫描新旧两把 key 字符串）

## lint

`node scripts/lint-kanet.mjs kasia-console/src/api/tg-wallet.js kasia-console/test-framework/cases/m0c1-gate/tg-wallet-pilot-isolation-regression.mjs` — 0 errors。

## 待办

- runbook §3.6/§4 重排（arm-before-fund，单独提交）会引用这个诊断端点，作为"零余额窗口内跑通才充值"那一步的具体实现
- NWT 红队通过后 commit 实代码

---

**关联**: `docs/2026-07-24-m0c1-pilot-codex-msg125-rectification.md` §C、`docs/2026-07-24-kanet-ui-e-tg-wallet-pilot-isolation-pending-review-diff.md`（同文件此前的 E 项改动，本次 diff 是在其基础上追加）。
